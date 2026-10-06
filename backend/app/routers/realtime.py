from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..auth import AuthContext, authenticate_token, get_current_auth, has_session_access
from ..errors import APIError
from ..models import (
    CanvasDoc,
    DocumentUpdateMessage,
    ErrorResponse,
    InterviewSession,
    JoinRoomMessage,
    PermissionChangedMessage,
    PingMessage,
    PongMessage,
    Presence,
    PresenceSnapshotMessage,
    PresenceUpdateMessage,
    RealtimeErrorMessage,
    RoomJoinedMessage,
    SessionEndedMessage,
)
from ..store import DatabaseStore, get_store
from .canvas import persist_operations


router = APIRouter(tags=["Collaboration"])


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, dict[int, tuple[WebSocket, str]]] = {}
        self.presences: dict[str, dict[str, Presence]] = {}
        self.announced_operation_ids: dict[str, set[str]] = {}

    def reset(self) -> None:
        self.connections.clear()
        self.presences.clear()
        self.announced_operation_ids.clear()

    def register(self, session_id: str, websocket: WebSocket, participant_id: str) -> None:
        self.connections.setdefault(session_id, {})[id(websocket)] = (websocket, participant_id)
        self.presences.setdefault(session_id, {})

    def unregister(self, session_id: str, websocket: WebSocket, participant_id: str) -> None:
        room = self.connections.get(session_id, {})
        room.pop(id(websocket), None)
        self.presences.get(session_id, {}).pop(participant_id, None)
        if not room:
            self.connections.pop(session_id, None)

    def set_presence(self, session_id: str, presence: Presence) -> None:
        self.presences.setdefault(session_id, {})[presence.participantId] = presence

    def presence_list(self, session_id: str) -> list[Presence]:
        return list(self.presences.get(session_id, {}).values())

    async def broadcast(self, session_id: str, payload: dict[str, Any]) -> None:
        stale: list[int] = []
        for connection_id, (websocket, _) in list(self.connections.get(session_id, {}).items()):
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(connection_id)
        for connection_id in stale:
            self.connections.get(session_id, {}).pop(connection_id, None)

    async def broadcast_presence(self, session_id: str) -> None:
        message = PresenceSnapshotMessage(
            type="presence_snapshot",
            sessionId=session_id,
            presences=self.presence_list(session_id),
        )
        await self.broadcast(session_id, message.model_dump(mode="json", by_alias=True))

    async def broadcast_document_update(self, session_id: str, envelopes) -> None:
        announced = self.announced_operation_ids.setdefault(session_id, set())
        fresh = []
        for envelope in envelopes:
            if envelope.clientOperationId not in announced:
                announced.add(envelope.clientOperationId)
                fresh.append(envelope)
        if not fresh:
            return
        message = DocumentUpdateMessage(type="document_update", sessionId=session_id, envelopes=fresh)
        await self.broadcast(session_id, message.model_dump(mode="json", by_alias=True))

    async def broadcast_session(self, session: InterviewSession, ended: bool = False) -> None:
        if ended:
            message = SessionEndedMessage(type="session_ended", sessionId=session.id, session=session)
        else:
            message = PermissionChangedMessage(type="permission_changed", sessionId=session.id, session=session)
        await self.broadcast(session.id, message.model_dump(mode="json", by_alias=True))


manager = ConnectionManager()


def _token_from_websocket(websocket: WebSocket) -> str | None:
    authorization = websocket.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return websocket.query_params.get("token")


def _error_payload(session_id: str, code: str, message: str) -> dict[str, Any]:
    error = RealtimeErrorMessage(
        type="error",
        sessionId=session_id,
        error=ErrorResponse(code=code, message=message),
    )
    return error.model_dump(mode="json", by_alias=True)


async def _close_with_error(websocket: WebSocket, code: int, message: str) -> None:
    try:
        await websocket.close(code=code, reason=message)
    except Exception:
        pass


@router.get("/v1/sessions/{id}/realtime", status_code=426, include_in_schema=True)
def realtime_upgrade_hint(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> None:
    """Document the HTTP-shaped WebSocket endpoint for clients that inspect OpenAPI."""
    session = store.get_session(id)
    if not has_session_access(context, session, store):
        raise APIError("forbidden", 403, "You do not have access to this interview.")
    raise APIError("invalid", 426, "Use a WebSocket upgrade for this endpoint.")


@router.websocket("/v1/sessions/{id}/realtime")
async def realtime_socket(websocket: WebSocket, id: str, store: DatabaseStore = Depends(get_store)) -> None:
    token = _token_from_websocket(websocket)
    if not token:
        await _close_with_error(websocket, 4401, "A bearer token is required.")
        return
    try:
        context = authenticate_token(token, store)
        session = store.get_session(id)
        if not has_session_access(context, session, store):
            raise APIError("forbidden", 403, "You do not have access to this interview.")
    except APIError as exc:
        await _close_with_error(websocket, 4403 if exc.status_code == 403 else 4401, exc.message)
        return

    await websocket.accept()
    participant_id: str | None = None
    try:
        first = await websocket.receive_json()
        join = JoinRoomMessage.model_validate(first)
        if join.sessionId != id:
            raise APIError("invalid", 400, "The room does not match the WebSocket path.")
        participant = store.get_participant(join.participantId)
        if participant is None or participant.sessionId != id or participant.leftAt is not None:
            raise APIError("forbidden", 403, "That participant cannot join this room.")
        if context.participant_id and context.participant_id != participant.id:
            raise APIError("forbidden", 403, "The collaboration credential belongs to another participant.")
        if context.user_id and participant.userId != context.user_id and context.participant_id is None:
            raise APIError("forbidden", 403, "The authenticated user cannot join as this participant.")

        participant_id = participant.id
        participant.online = True
        store.save_participant(participant)
        manager.register(id, websocket, participant_id)
        doc, cursor = store.get_canvas(id)
        joined = RoomJoinedMessage(
            type="room_joined",
            sessionId=id,
            snapshot=doc,
            participants=store.session_participants(id),
            presences=manager.presence_list(id),
            cursor=cursor,
        )
        await websocket.send_json(joined.model_dump(mode="json", by_alias=True))
        await manager.broadcast_presence(id)

        while True:
            raw = await websocket.receive_json()
            message_type = raw.get("type")
            if message_type == "ping":
                ping = PingMessage.model_validate(raw)
                await websocket.send_json(PongMessage(type="pong", sessionId=id, correlationId=ping.correlationId).model_dump(mode="json"))
            elif message_type == "document_update":
                message = DocumentUpdateMessage.model_validate(raw)
                if message.sessionId != id:
                    raise APIError("invalid", 400, "The message room does not match the WebSocket path.")
                if any(envelope.actorId != participant_id for envelope in message.envelopes):
                    raise APIError("forbidden", 403, "The operation actor does not match the participant.")
                cursor = persist_operations(store, id, participant_id, message.envelopes)
                await manager.broadcast_document_update(id, message.envelopes)
                _ = cursor
            elif message_type == "presence_update":
                message = PresenceUpdateMessage.model_validate(raw)
                if message.sessionId != id or message.presence.participantId != participant_id:
                    raise APIError("forbidden", 403, "Presence must belong to the connected participant.")
                manager.set_presence(id, message.presence)
                await manager.broadcast_presence(id)
            else:
                await websocket.send_json(_error_payload(id, "invalid", "Unsupported realtime message type."))
    except WebSocketDisconnect:
        pass
    except (APIError, ValidationError) as exc:
        if isinstance(exc, APIError):
            payload = _error_payload(id, exc.code, exc.message)
        else:
            payload = _error_payload(id, "invalid", "The realtime message is invalid.")
        try:
            await websocket.send_json(payload)
        except Exception:
            pass
    finally:
        if participant_id:
            manager.unregister(id, websocket, participant_id)
            participant = store.get_participant(participant_id)
            if participant:
                participant.online = False
                store.save_participant(participant)
            await manager.broadcast_presence(id)
