from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class SessionState(str, Enum):
    DRAFT = "draft"
    LIVE = "live"
    ENDED = "ended"
    ARCHIVED = "archived"


class Role(str, Enum):
    OWNER = "owner"
    INTERVIEWER = "interviewer"
    CANDIDATE = "candidate"
    OBSERVER = "observer"


class User(BaseModel):
    id: str
    email: str
    displayName: str
    createdAt: int


class UserRecord(User):
    passwordHash: str


class InterviewSession(BaseModel):
    id: str
    ownerUserId: str
    title: str
    prompt: str
    state: SessionState
    candidateEditingEnabled: bool
    durationMinutes: int = Field(ge=1)
    scheduledAt: int | None = None
    startedAt: int | None = None
    endedAt: int | None = None
    createdAt: int
    updatedAt: int


class GuestLink(BaseModel):
    id: str
    sessionId: str
    token: str
    roleGranted: Literal["interviewer", "candidate", "observer"]
    expiresAt: int | None = None
    maxUses: int | None = Field(default=None, ge=1)
    revokedAt: int | None = None
    createdAt: int


class Participant(BaseModel):
    id: str
    sessionId: str
    userId: str | None = None
    displayName: str
    role: Role
    color: str
    joinedAt: int
    leftAt: int | None = None
    online: bool = False


class Point(BaseModel):
    x: float
    y: float


class Presence(BaseModel):
    participantId: str
    displayName: str
    color: str
    cursor: Point | None = None
    selection: list[str] = Field(default_factory=list)


class AuditEvent(BaseModel):
    id: str
    sessionId: str
    type: str
    actor: str
    at: int


class ElementBase(BaseModel):
    id: str
    createdBy: str
    createdAt: int
    updatedAt: int


class NodeElement(ElementBase):
    kind: Literal["node"]
    componentType: str
    x: float
    y: float
    width: float
    height: float
    label: str
    description: str | None = None
    color: Literal["neutral", "accent", "amber", "rose"]


class StickyElement(ElementBase):
    kind: Literal["sticky"]
    x: float
    y: float
    width: float
    height: float
    text: str
    color: Literal["neutral", "accent", "amber", "rose"]


class TextElement(ElementBase):
    kind: Literal["text"]
    x: float
    y: float
    text: str
    size: float
    color: Literal["neutral", "accent", "amber", "rose"]


class ConnectorEndpoint(BaseModel):
    elementId: str | None = None
    x: float | None = None
    y: float | None = None


class ConnectorElement(ElementBase):
    kind: Literal["connector"]
    from_: ConnectorEndpoint = Field(alias="from")
    to: ConnectorEndpoint
    style: Literal["straight", "elbow", "curved"]
    arrowStart: bool
    arrowEnd: bool
    dashed: bool
    width: float
    label: str | None = None
    color: Literal["neutral", "accent", "amber", "rose"]

    model_config = ConfigDict(populate_by_name=True)


class StrokeElement(ElementBase):
    kind: Literal["stroke"]
    points: list[tuple[float, float]]
    color: Literal["neutral", "accent", "amber", "rose"]
    width: float
    tool: Literal["pen", "highlighter"]


CanvasElement = Union[NodeElement, StickyElement, TextElement, ConnectorElement, StrokeElement]


class CanvasDoc(BaseModel):
    schemaVersion: int = Field(ge=1)
    elements: dict[str, CanvasElement] = Field(default_factory=dict)
    order: list[str] = Field(default_factory=list)


class CanvasSnapshot(BaseModel):
    sessionId: str
    doc: CanvasDoc
    operationCursor: int = Field(ge=0)
    updatedAt: int


class AddOperation(BaseModel):
    type: Literal["add"]
    element: CanvasElement = Field(discriminator="kind")


class UpdateOperation(BaseModel):
    type: Literal["update"]
    id: str
    patch: dict[str, Any]
    at: int


class DeleteOperation(BaseModel):
    type: Literal["delete"]
    ids: list[str] = Field(min_length=1)


class ReorderOperation(BaseModel):
    type: Literal["reorder"]
    id: str
    to: Literal["front", "back"]


class ClearOperation(BaseModel):
    type: Literal["clear"]


CanvasOperation = Union[AddOperation, UpdateOperation, DeleteOperation, ReorderOperation, ClearOperation]


class CanvasEnvelope(BaseModel):
    clientOperationId: str
    actorId: str
    sentAt: int
    operation: CanvasOperation = Field(discriminator="type")


class CreateSessionRequest(BaseModel):
    title: str
    prompt: str
    durationMinutes: int = Field(ge=1)


class UpdateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    prompt: str | None = None
    candidateEditingEnabled: bool | None = None
    durationMinutes: int | None = Field(default=None, ge=1)


class JoinSessionRequest(BaseModel):
    displayName: str = Field(max_length=100)


class ResolvedGuestLink(BaseModel):
    session: InterviewSession
    link: GuestLink


class JoinSessionResponse(BaseModel):
    session: InterviewSession
    participant: Participant
    collaborationToken: str


class SubmitOperationsRequest(BaseModel):
    participantId: str
    envelopes: list[CanvasEnvelope] = Field(min_length=1)


class SubmitOperationsResponse(BaseModel):
    accepted: int = Field(ge=0)
    cursor: int = Field(ge=0)


class CanvasExport(BaseModel):
    session: InterviewSession
    canvas: CanvasDoc
    exportedAt: str


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class TokenRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class RealtimeEnvelope(BaseModel):
    type: str
    version: Literal[1] = 1
    sessionId: str
    correlationId: str | None = None


class JoinRoomMessage(RealtimeEnvelope):
    type: Literal["join_room"]
    participantId: str


class DocumentUpdateMessage(RealtimeEnvelope):
    type: Literal["document_update"]
    envelopes: list[CanvasEnvelope] = Field(min_length=1)


class PresenceUpdateMessage(RealtimeEnvelope):
    type: Literal["presence_update"]
    presence: Presence


class PingMessage(RealtimeEnvelope):
    type: Literal["ping"]


class RoomJoinedMessage(RealtimeEnvelope):
    type: Literal["room_joined"]
    snapshot: CanvasDoc
    participants: list[Participant]
    presences: list[Presence]
    cursor: int


class PresenceSnapshotMessage(RealtimeEnvelope):
    type: Literal["presence_snapshot"]
    presences: list[Presence]


class PermissionChangedMessage(RealtimeEnvelope):
    type: Literal["permission_changed"]
    session: InterviewSession


class SessionEndedMessage(RealtimeEnvelope):
    type: Literal["session_ended"]
    session: InterviewSession


class RealtimeErrorMessage(RealtimeEnvelope):
    type: Literal["error"]
    error: ErrorResponse


class PongMessage(RealtimeEnvelope):
    type: Literal["pong"]
