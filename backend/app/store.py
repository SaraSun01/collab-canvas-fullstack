from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid

from fastapi import Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .auth import hash_password
from .db import (
    AuditEventRow,
    CanvasDocumentRow,
    CanvasOperationRow,
    GuestLinkRow,
    InterviewSessionRow,
    ParticipantRow,
    RevokedTokenRow,
    UserRow,
    get_db,
)
from .errors import APIError
from .models import (
    AuditEvent,
    CanvasDoc,
    ConnectorElement,
    GuestLink,
    InterviewSession,
    NodeElement,
    Participant,
    Role,
    SessionState,
    UserRecord,
)


DEMO_PASSWORD = "demo-password"
MAX_PARTICIPANTS = 10


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def new_guest_token() -> str:
    return secrets.token_hex(24)


def guest_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class DatabaseStore:
    """Database-backed repository using SQLAlchemy's database-agnostic session API."""

    def __init__(self, db: Session):
        self.db = db

    def seed(self, now: int | None = None) -> None:
        for model in (
            CanvasOperationRow,
            CanvasDocumentRow,
            AuditEventRow,
            ParticipantRow,
            GuestLinkRow,
            InterviewSessionRow,
            UserRow,
            RevokedTokenRow,
        ):
            self.db.execute(delete(model))

        now = now if now is not None else now_ms()
        owner = UserRecord(
            id="user_owner",
            email="maya@lattice.dev",
            displayName="Maya Kern",
            createdAt=now - 30 * 86_400_000,
            passwordHash=hash_password(DEMO_PASSWORD),
        )
        self._insert_user(owner)

        live = InterviewSession(
            id="ses_rate_limiter",
            ownerUserId=owner.id,
            title="Design a rate limiter",
            prompt="Design a distributed rate limiter that handles 100k req/s with per-user quotas. Cover the data path, storage, and failure modes.",
            state=SessionState.LIVE,
            candidateEditingEnabled=True,
            durationMinutes=45,
            scheduledAt=None,
            startedAt=now - 34 * 60_000,
            endedAt=None,
            createdAt=now - 3 * 86_400_000,
            updatedAt=now - 60_000,
        )
        draft = InterviewSession(
            id="ses_url_shortener",
            ownerUserId=owner.id,
            title="Design a URL shortener",
            prompt="Design a URL shortener serving 500M redirects per day.",
            state=SessionState.DRAFT,
            candidateEditingEnabled=True,
            durationMinutes=45,
            scheduledAt=now + 86_400_000,
            startedAt=None,
            endedAt=None,
            createdAt=now - 86_400_000,
            updatedAt=now - 86_400_000,
        )
        ended = InterviewSession(
            id="ses_chat_system",
            ownerUserId=owner.id,
            title="Design a chat system",
            prompt="Design a realtime chat system for 10M daily users.",
            state=SessionState.ENDED,
            candidateEditingEnabled=False,
            durationMinutes=60,
            scheduledAt=None,
            startedAt=now - 2 * 86_400_000,
            endedAt=now - 2 * 86_400_000 + 48 * 60_000,
            createdAt=now - 4 * 86_400_000,
            updatedAt=now - 2 * 86_400_000,
        )
        for session in (live, draft, ended):
            self._insert_session(session)
            if session.id == live.id:
                self._insert_canvas(session.id, self._seed_rate_limiter_doc(now), 4)
            else:
                self._insert_canvas(session.id, CanvasDoc(schemaVersion=1, elements={}, order=[]), 0)

        link = self.create_guest_link(live.id, now=now, commit=False)
        self._insert_participant(
            Participant(
                id="par_owner_live",
                sessionId=live.id,
                userId=owner.id,
                displayName=owner.displayName,
                role=Role.OWNER,
                color="accent",
                joinedAt=now - 35 * 60_000,
                leftAt=None,
                online=True,
            )
        )
        self._insert_participant(
            Participant(
                id="par_priya",
                sessionId=live.id,
                userId=None,
                displayName="Priya Raman",
                role=Role.CANDIDATE,
                color="rose",
                joinedAt=now - 33 * 60_000,
                leftAt=None,
                online=True,
            )
        )
        self._insert_participant(
            Participant(
                id="par_jordan",
                sessionId=ended.id,
                userId=None,
                displayName="Jordan Diaz",
                role=Role.CANDIDATE,
                color="amber",
                joinedAt=ended.startedAt or now,
                leftAt=ended.endedAt,
                online=False,
            )
        )
        self._insert_audit(live.id, "session.created", owner.displayName, live.createdAt)
        self._insert_audit(live.id, "link.created", owner.displayName, link.createdAt)
        self._insert_audit(live.id, "session.started", owner.displayName, live.startedAt or now)
        self.db.commit()

    def _seed_rate_limiter_doc(self, now: int) -> CanvasDoc:
        base = {"createdBy": "par_owner_live", "createdAt": now - 30 * 60_000, "updatedAt": now - 30 * 60_000}
        doc = CanvasDoc(schemaVersion=1, elements={}, order=[])
        nodes = [
            ("el_client", "client", 80, 180, 140, 68, "Client", "web / mobile", "neutral"),
            ("el_gateway", "gateway", 320, 120, 155, 68, "API Gateway", "auth / routing", "neutral"),
            ("el_limiter", "service", 320, 320, 155, 68, "Rate Limiter", "token bucket", "accent"),
            ("el_cache", "cache", 600, 220, 140, 68, "Redis Cache", "counters", "accent"),
        ]
        for element_id, component_type, x, y, width, height, label, description, color in nodes:
            doc.elements[element_id] = NodeElement(
                id=element_id,
                **base,
                kind="node",
                componentType=component_type,
                x=x,
                y=y,
                width=width,
                height=height,
                label=label,
                description=description,
                color=color,
            )
            doc.order.append(element_id)
        for element_id, from_id, to_id, label in (
            ("el_c1", "el_client", "el_gateway", "HTTPS"),
            ("el_c2", "el_gateway", "el_limiter", "check"),
            ("el_c3", "el_limiter", "el_cache", "read/write"),
        ):
            doc.elements[element_id] = ConnectorElement(
                id=element_id,
                **base,
                kind="connector",
                **{"from": {"elementId": from_id}},
                to={"elementId": to_id},
                style="elbow",
                arrowStart=False,
                arrowEnd=True,
                dashed=False,
                width=2,
                label=label,
                color="neutral",
            )
            doc.order.append(element_id)
        return doc

    def _insert_user(self, user: UserRecord) -> None:
        self.db.add(
            UserRow(
                id=user.id,
                email=user.email,
                display_name=user.displayName,
                created_at=user.createdAt,
                password_hash=user.passwordHash,
            )
        )

    def _insert_session(self, session: InterviewSession) -> None:
        self.db.add(
            InterviewSessionRow(
                id=session.id,
                owner_user_id=session.ownerUserId,
                title=session.title,
                prompt=session.prompt,
                state=session.state.value,
                candidate_editing_enabled=session.candidateEditingEnabled,
                duration_minutes=session.durationMinutes,
                scheduled_at=session.scheduledAt,
                started_at=session.startedAt,
                ended_at=session.endedAt,
                created_at=session.createdAt,
                updated_at=session.updatedAt,
            )
        )

    def _insert_canvas(self, session_id: str, doc: CanvasDoc, cursor: int) -> None:
        self.db.add(
            CanvasDocumentRow(
                session_id=session_id,
                schema_version=doc.schemaVersion,
                payload=json.dumps(doc.model_dump(mode="json", by_alias=True)),
                operation_cursor=cursor,
            )
        )

    def _insert_participant(self, participant: Participant) -> None:
        self.db.add(
            ParticipantRow(
                id=participant.id,
                session_id=participant.sessionId,
                user_id=participant.userId,
                display_name=participant.displayName,
                role=participant.role.value,
                color=participant.color,
                joined_at=participant.joinedAt,
                left_at=participant.leftAt,
                online=participant.online,
            )
        )

    def _insert_audit(self, session_id: str, event_type: str, actor: str, at: int) -> AuditEvent:
        event = AuditEvent(id=new_id("aud"), sessionId=session_id, type=event_type, actor=actor, at=at)
        self.db.add(AuditEventRow(id=event.id, session_id=session_id, event_type=event.type, actor=actor, at=at))
        return event

    @staticmethod
    def _user(row: UserRow) -> UserRecord:
        return UserRecord(id=row.id, email=row.email, displayName=row.display_name, createdAt=row.created_at, passwordHash=row.password_hash)

    @staticmethod
    def _session(row: InterviewSessionRow) -> InterviewSession:
        return InterviewSession(
            id=row.id,
            ownerUserId=row.owner_user_id,
            title=row.title,
            prompt=row.prompt,
            state=SessionState(row.state),
            candidateEditingEnabled=row.candidate_editing_enabled,
            durationMinutes=row.duration_minutes,
            scheduledAt=row.scheduled_at,
            startedAt=row.started_at,
            endedAt=row.ended_at,
            createdAt=row.created_at,
            updatedAt=row.updated_at,
        )

    @staticmethod
    def _link(row: GuestLinkRow) -> GuestLink:
        return GuestLink(
            id=row.id,
            sessionId=row.session_id,
            token=row.token,
            roleGranted=row.role_granted,
            expiresAt=row.expires_at,
            maxUses=row.max_uses,
            revokedAt=row.revoked_at,
            createdAt=row.created_at,
        )

    @staticmethod
    def _participant(row: ParticipantRow) -> Participant:
        return Participant(
            id=row.id,
            sessionId=row.session_id,
            userId=row.user_id,
            displayName=row.display_name,
            role=Role(row.role),
            color=row.color,
            joinedAt=row.joined_at,
            leftAt=row.left_at,
            online=row.online,
        )

    @staticmethod
    def _audit(row: AuditEventRow) -> AuditEvent:
        return AuditEvent(id=row.id, sessionId=row.session_id, type=row.event_type, actor=row.actor, at=row.at)

    def get_user(self, user_id: str) -> UserRecord | None:
        row = self.db.get(UserRow, user_id)
        return self._user(row) if row else None

    def find_user_by_email(self, email: str) -> UserRecord | None:
        row = self.db.scalar(select(UserRow).where(UserRow.email.ilike(email)))
        return self._user(row) if row else None

    def get_session(self, session_id: str) -> InterviewSession:
        row = self.db.get(InterviewSessionRow, session_id)
        if row is None:
            raise APIError("not_found", 404, "That interview does not exist.")
        return self._session(row)

    def list_sessions(self, owner_user_id: str) -> list[InterviewSession]:
        rows = self.db.scalars(
            select(InterviewSessionRow)
            .where(InterviewSessionRow.owner_user_id == owner_user_id)
            .order_by(InterviewSessionRow.updated_at.desc())
        ).all()
        return [self._session(row) for row in rows if SessionState(row.state) != SessionState.ARCHIVED]

    def save_session(self, session: InterviewSession) -> None:
        row = self.db.get(InterviewSessionRow, session.id)
        if row is None:
            self._insert_session(session)
        else:
            row.owner_user_id = session.ownerUserId
            row.title = session.title
            row.prompt = session.prompt
            row.state = session.state.value
            row.candidate_editing_enabled = session.candidateEditingEnabled
            row.duration_minutes = session.durationMinutes
            row.scheduled_at = session.scheduledAt
            row.started_at = session.startedAt
            row.ended_at = session.endedAt
            row.updated_at = session.updatedAt
        self.db.commit()

    def create_guest_link(self, session_id: str, now: int | None = None, commit: bool = True) -> GuestLink:
        now = now if now is not None else now_ms()
        token = new_guest_token()
        link = GuestLink(
            id=new_id("lnk"),
            sessionId=session_id,
            token=token,
            roleGranted="candidate",
            expiresAt=None,
            maxUses=MAX_PARTICIPANTS,
            revokedAt=None,
            createdAt=now,
        )
        self.db.add(
            GuestLinkRow(
                id=link.id,
                session_id=session_id,
                token=token,
                token_hash=guest_token_hash(token),
                role_granted=link.roleGranted,
                expires_at=link.expiresAt,
                max_uses=link.maxUses,
                revoked_at=link.revokedAt,
                created_at=link.createdAt,
            )
        )
        if commit:
            self.db.commit()
        return link

    def get_link(self, link_id: str) -> GuestLink | None:
        row = self.db.get(GuestLinkRow, link_id)
        return self._link(row) if row else None

    def find_link_by_token(self, token: str) -> GuestLink | None:
        row = self.db.scalar(select(GuestLinkRow).where(GuestLinkRow.token_hash == guest_token_hash(token)))
        return self._link(row) if row else None

    def current_guest_link(self, session_id: str) -> GuestLink | None:
        row = self.db.scalar(
            select(GuestLinkRow)
            .where(GuestLinkRow.session_id == session_id, GuestLinkRow.revoked_at.is_(None))
            .order_by(GuestLinkRow.created_at.desc())
        )
        return self._link(row) if row else None

    def guest_links(self, session_id: str) -> list[GuestLink]:
        rows = self.db.scalars(
            select(GuestLinkRow)
            .where(GuestLinkRow.session_id == session_id)
            .order_by(GuestLinkRow.created_at.desc())
        ).all()
        return [self._link(row) for row in rows]

    def save_link(self, link: GuestLink) -> None:
        row = self.db.get(GuestLinkRow, link.id)
        if row is None:
            raise APIError("not_found", 404, "That guest link does not exist.")
        row.revoked_at = link.revokedAt
        self.db.commit()

    def get_participant(self, participant_id: str) -> Participant | None:
        row = self.db.get(ParticipantRow, participant_id)
        return self._participant(row) if row else None

    def save_participant(self, participant: Participant) -> None:
        row = self.db.get(ParticipantRow, participant.id)
        if row is None:
            self._insert_participant(participant)
        else:
            row.session_id = participant.sessionId
            row.user_id = participant.userId
            row.display_name = participant.displayName
            row.role = participant.role.value
            row.color = participant.color
            row.joined_at = participant.joinedAt
            row.left_at = participant.leftAt
            row.online = participant.online
        self.db.commit()

    def find_participant(self, session_id: str, user_id: str) -> Participant | None:
        row = self.db.scalar(
            select(ParticipantRow).where(ParticipantRow.session_id == session_id, ParticipantRow.user_id == user_id)
        )
        return self._participant(row) if row else None

    def active_participants(self, session_id: str) -> list[Participant]:
        rows = self.db.scalars(
            select(ParticipantRow).where(ParticipantRow.session_id == session_id, ParticipantRow.left_at.is_(None))
        ).all()
        return [self._participant(row) for row in rows]

    def session_participants(self, session_id: str) -> list[Participant]:
        rows = self.db.scalars(
            select(ParticipantRow).where(ParticipantRow.session_id == session_id).order_by(ParticipantRow.joined_at)
        ).all()
        return [self._participant(row) for row in rows]

    def add_participant(self, participant: Participant) -> None:
        self._insert_participant(participant)
        self.db.commit()

    def add_audit(self, session_id: str, event_type: str, actor: str, at: int | None = None) -> AuditEvent:
        event = self._insert_audit(session_id, event_type, actor, at if at is not None else now_ms())
        self.db.commit()
        return event

    def list_audit(self, session_id: str) -> list[AuditEvent]:
        rows = self.db.scalars(
            select(AuditEventRow).where(AuditEventRow.session_id == session_id).order_by(AuditEventRow.at.desc())
        ).all()
        return [self._audit(row) for row in rows]

    def get_canvas(self, session_id: str) -> tuple[CanvasDoc, int]:
        row = self.db.get(CanvasDocumentRow, session_id)
        if row is None:
            doc = CanvasDoc(schemaVersion=1, elements={}, order=[])
            self._insert_canvas(session_id, doc, 0)
            self.db.commit()
            return doc, 0
        return CanvasDoc.model_validate(json.loads(row.payload)), row.operation_cursor

    def processed_operation_ids(self, session_id: str) -> set[str]:
        rows = self.db.scalars(
            select(CanvasOperationRow.operation_id).where(CanvasOperationRow.session_id == session_id)
        ).all()
        return set(rows)

    def save_canvas(self, session_id: str, doc: CanvasDoc, cursor: int, operation_ids: list[str]) -> None:
        row = self.db.get(CanvasDocumentRow, session_id)
        if row is None:
            self._insert_canvas(session_id, doc, cursor)
        else:
            row.schema_version = doc.schemaVersion
            row.payload = json.dumps(doc.model_dump(mode="json", by_alias=True))
            row.operation_cursor = cursor
        for operation_id in operation_ids:
            self.db.add(CanvasOperationRow(session_id=session_id, operation_id=operation_id))
        self.db.commit()

    def revoke_token(self, token: str) -> None:
        if not self.is_token_revoked(token):
            self.db.add(RevokedTokenRow(token=token))
            self.db.commit()

    def is_token_revoked(self, token: str) -> bool:
        return self.db.get(RevokedTokenRow, token) is not None


def get_store(db: Session = Depends(get_db)) -> DatabaseStore:
    return DatabaseStore(db)
