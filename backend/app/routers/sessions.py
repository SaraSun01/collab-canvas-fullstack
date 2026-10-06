from __future__ import annotations

from fastapi import APIRouter, Depends, status

from ..auth import (
    AuthContext,
    get_current_auth,
    require_owner,
    require_session_access,
    require_session_manager,
    require_user,
)
from ..errors import APIError
from ..models import (
    AuditEvent,
    CanvasDoc,
    CreateSessionRequest,
    GuestLink,
    InterviewSession,
    JoinSessionRequest,
    JoinSessionResponse,
    Participant,
    ResolvedGuestLink,
    Role,
    SessionState,
    UpdateSessionRequest,
)
from ..store import MAX_PARTICIPANTS, DatabaseStore, get_store, new_id, now_ms


router = APIRouter(prefix="/v1", tags=["Sessions"])


def _actor(context: AuthContext, store: DatabaseStore) -> str:
    if context.user_id:
        user = store.get_user(context.user_id)
        if user:
            return user.displayName
    if context.participant_id:
        participant = store.get_participant(context.participant_id)
        if participant:
            return participant.displayName
    return "system"


def _session(context: AuthContext, session_id: str, store: DatabaseStore) -> InterviewSession:
    session = store.get_session(session_id)
    require_session_access(context, session, store)
    return session


async def _broadcast_session(session: InterviewSession, ended: bool = False) -> None:
    from .realtime import manager

    await manager.broadcast_session(session, ended=ended)


@router.get("/sessions", response_model=list[InterviewSession])
def list_sessions(context: AuthContext = Depends(get_current_auth), store: DatabaseStore = Depends(get_store)) -> list[InterviewSession]:
    user = require_user(context, store)
    return store.list_sessions(user.id)


@router.post("/sessions", response_model=InterviewSession, status_code=status.HTTP_201_CREATED)
def create_session(
    request: CreateSessionRequest,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    user = require_user(context, store)
    now = now_ms()
    session = InterviewSession(
        id=new_id("ses"),
        ownerUserId=user.id,
        title=request.title.strip() or "Untitled interview",
        prompt=request.prompt.strip(),
        state=SessionState.DRAFT,
        candidateEditingEnabled=True,
        durationMinutes=request.durationMinutes,
        scheduledAt=None,
        startedAt=None,
        endedAt=None,
        createdAt=now,
        updatedAt=now,
    )
    store.save_session(session)
    store.get_canvas(session.id)
    store.add_audit(session.id, "session.created", user.displayName, now)
    return session


@router.get("/sessions/{id}", response_model=InterviewSession)
def get_session(id: str, context: AuthContext = Depends(get_current_auth), store: DatabaseStore = Depends(get_store)) -> InterviewSession:
    return _session(context, id, store)


@router.patch("/sessions/{id}", response_model=InterviewSession)
async def update_session(
    id: str,
    request: UpdateSessionRequest,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    session = store.get_session(id)
    require_session_manager(context, session, store)
    changes = request.model_dump(exclude_unset=True)
    if not changes:
        raise APIError("invalid", 400, "At least one session field must be provided.")
    for key, value in changes.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(session, key, value)
    session.updatedAt = now_ms()
    if "candidateEditingEnabled" in changes:
        store.add_audit(id, "permission.changed", _actor(context, store), session.updatedAt)
    store.save_session(session)
    await _broadcast_session(session)
    return session


@router.post("/sessions/{id}/start", response_model=InterviewSession)
async def start_session(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    session = store.get_session(id)
    require_session_manager(context, session, store)
    if session.state in {SessionState.ENDED, SessionState.ARCHIVED}:
        raise APIError("invalid", 409, "This interview cannot be started from its current state.")
    now = now_ms()
    session.state = SessionState.LIVE
    session.startedAt = session.startedAt or now
    session.endedAt = None
    session.updatedAt = now
    store.add_audit(id, "session.started", _actor(context, store), now)
    store.save_session(session)
    await _broadcast_session(session)
    return session


@router.post("/sessions/{id}/end", response_model=InterviewSession)
async def end_session(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    session = store.get_session(id)
    require_session_manager(context, session, store)
    if session.state == SessionState.ARCHIVED:
        raise APIError("invalid", 409, "This interview is archived.")
    now = now_ms()
    session.state = SessionState.ENDED
    session.endedAt = now
    session.candidateEditingEnabled = False
    session.updatedAt = now
    store.add_audit(id, "session.ended", _actor(context, store), now)
    store.save_session(session)
    await _broadcast_session(session, ended=True)
    return session


@router.post("/sessions/{id}/archive", response_model=InterviewSession)
def archive_session(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    session = store.get_session(id)
    require_owner(context, session)
    session.state = SessionState.ARCHIVED
    session.updatedAt = now_ms()
    store.add_audit(id, "session.archived", _actor(context, store), session.updatedAt)
    store.save_session(session)
    return session


@router.post("/sessions/{id}/duplicate", response_model=InterviewSession, status_code=status.HTTP_201_CREATED)
def duplicate_session(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> InterviewSession:
    source = store.get_session(id)
    user = require_user(context, store)
    require_owner(context, source)
    now = now_ms()
    copy = source.model_copy(deep=True)
    copy.id = new_id("ses")
    copy.ownerUserId = user.id
    copy.title = f"{source.title} (copy)"
    copy.state = SessionState.DRAFT
    copy.candidateEditingEnabled = True
    copy.startedAt = None
    copy.endedAt = None
    copy.createdAt = now
    copy.updatedAt = now
    store.save_session(copy)
    source_doc, _ = store.get_canvas(id)
    store.save_canvas(copy.id, source_doc.model_copy(deep=True), 0, [])
    store.add_audit(copy.id, "session.created", user.displayName, now)
    return copy


@router.get("/sessions/{id}/guest-links", response_model=GuestLink | None)
def get_guest_link(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> GuestLink | None:
    session = store.get_session(id)
    require_owner(context, session)
    return store.current_guest_link(id)


@router.post("/sessions/{id}/guest-links", response_model=GuestLink, status_code=status.HTTP_201_CREATED)
def rotate_guest_link(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> GuestLink:
    session = store.get_session(id)
    require_owner(context, session)
    now = now_ms()
    for link in store.guest_links(id):
        if link.sessionId == id and link.revokedAt is None:
            link.revokedAt = now
            store.save_link(link)
    link = store.create_guest_link(id, now)
    store.add_audit(id, "link.rotated", _actor(context, store), now)
    return link


@router.delete("/sessions/{id}/guest-links/{linkId}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_guest_link(
    id: str,
    linkId: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> None:
    session = store.get_session(id)
    require_owner(context, session)
    link = store.get_link(linkId)
    if link is None or link.sessionId != id:
        raise APIError("not_found", 404, "That guest link does not exist.")
    if link.revokedAt is None:
        link.revokedAt = now_ms()
        store.save_link(link)
        store.add_audit(id, "link.revoked", _actor(context, store), link.revokedAt)


def _resolve_link(token: str, store: DatabaseStore) -> tuple[InterviewSession, GuestLink]:
    link = store.find_link_by_token(token)
    if link is None:
        raise APIError("not_found", 404, "This invite link is not valid.")
    if link.revokedAt is not None:
        raise APIError("revoked", 410, "This invite link was revoked by the interviewer.")
    if link.expiresAt is not None and link.expiresAt < now_ms():
        raise APIError("expired", 410, "This invite link has expired.")
    session = store.get_session(link.sessionId)
    if session.state == SessionState.ARCHIVED:
        raise APIError("ended", 410, "This interview is no longer available.")
    return session, link


@router.get("/join/{token}", response_model=ResolvedGuestLink, tags=["Guest access"])
def resolve_guest_token(token: str, store: DatabaseStore = Depends(get_store)) -> ResolvedGuestLink:
    session, link = _resolve_link(token, store)
    return ResolvedGuestLink(session=session, link=link)


@router.post("/join/{token}", response_model=JoinSessionResponse, status_code=status.HTTP_201_CREATED, tags=["Guest access"])
def join_with_token(
    token: str,
    request: JoinSessionRequest,
    store: DatabaseStore = Depends(get_store),
) -> JoinSessionResponse:
    from ..auth import create_collaboration_token

    session, link = _resolve_link(token, store)
    if session.state == SessionState.ENDED:
        raise APIError("ended", 410, "This interview has ended and is read-only.")
    active = store.active_participants(session.id)
    if len(active) >= (link.maxUses or MAX_PARTICIPANTS):
        raise APIError("at_capacity", 409, "This interview is already full.")
    participant = Participant(
        id=new_id("par"),
        sessionId=session.id,
        userId=None,
        displayName=request.displayName.strip() or "Guest",
        role=Role(link.roleGranted),
        color=("rose", "amber", "accent")[len(active) % 3],
        joinedAt=now_ms(),
        leftAt=None,
        online=True,
    )
    store.add_participant(participant)
    store.add_audit(session.id, "participant.joined", participant.displayName, participant.joinedAt)
    return JoinSessionResponse(
        session=session,
        participant=participant,
        collaborationToken=create_collaboration_token(participant),
    )


@router.post("/sessions/{id}/participants/owner", response_model=Participant)
def join_as_owner(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> Participant:
    from ..auth import require_user

    session = store.get_session(id)
    user = require_user(context, store)
    require_owner(context, session)
    existing = store.find_participant(id, user.id)
    if existing:
        existing.leftAt = None
        existing.online = True
        store.save_participant(existing)
        return existing
    participant = Participant(
        id=new_id("par"),
        sessionId=id,
        userId=user.id,
        displayName=user.displayName,
        role=Role.OWNER,
        color="accent",
        joinedAt=now_ms(),
        leftAt=None,
        online=True,
    )
    store.add_participant(participant)
    return participant


@router.get("/sessions/{id}/participants", response_model=list[Participant])
def list_participants(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> list[Participant]:
    session = store.get_session(id)
    require_session_access(context, session, store)
    return sorted(store.session_participants(id), key=lambda participant: participant.joinedAt)


@router.delete("/sessions/{id}/participants/{participantId}", status_code=status.HTTP_204_NO_CONTENT)
def remove_participant(
    id: str,
    participantId: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> None:
    session = store.get_session(id)
    require_session_manager(context, session, store)
    participant = store.get_participant(participantId)
    if participant is None or participant.sessionId != id:
        raise APIError("not_found", 404, "That participant is not in this interview.")
    participant.leftAt = now_ms()
    participant.online = False
    store.save_participant(participant)
    store.add_audit(id, "participant.removed", _actor(context, store), participant.leftAt)


@router.get("/sessions/{id}/audit", response_model=list[AuditEvent])
def audit_log(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> list[AuditEvent]:
    session = store.get_session(id)
    require_session_manager(context, session, store)
    return store.list_audit(id)
