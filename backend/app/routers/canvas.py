from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from ..auth import AuthContext, get_current_auth, require_session_access
from ..errors import APIError
from ..models import (
    AddOperation,
    CanvasDoc,
    CanvasElement,
    CanvasEnvelope,
    CanvasExport,
    CanvasSnapshot,
    ClearOperation,
    ConnectorElement,
    DeleteOperation,
    InterviewSession,
    NodeElement,
    ReorderOperation,
    StrokeElement,
    StickyElement,
    SubmitOperationsRequest,
    SubmitOperationsResponse,
    SessionState,
    TextElement,
    UpdateOperation,
)
from ..store import DatabaseStore, get_store, now_ms


router = APIRouter(prefix="/v1/sessions/{id}/canvas", tags=["Canvas"])


def _element_model(kind: str):
    return {
        "node": NodeElement,
        "sticky": StickyElement,
        "text": TextElement,
        "connector": ConnectorElement,
        "stroke": StrokeElement,
    }.get(kind)


def apply_operation(doc: CanvasDoc, envelope: CanvasEnvelope) -> None:
    operation = envelope.operation
    if isinstance(operation, AddOperation):
        doc.elements[operation.element.id] = operation.element
        if operation.element.id not in doc.order:
            doc.order.append(operation.element.id)
        return
    if isinstance(operation, UpdateOperation):
        current = doc.elements.get(operation.id)
        if current is None:
            return
        data = current.model_dump(by_alias=True)
        data.update(operation.patch)
        data["id"] = operation.id
        model = _element_model(str(data.get("kind", "")))
        if model is None:
            raise APIError("invalid", 400, "Canvas update has an unsupported element kind.")
        try:
            doc.elements[operation.id] = model.model_validate(data)
        except ValueError as exc:
            raise APIError("invalid", 400, f"Canvas update is invalid: {exc}") from exc
        return
    if isinstance(operation, DeleteOperation):
        for element_id in operation.ids:
            doc.elements.pop(element_id, None)
            if element_id in doc.order:
                doc.order.remove(element_id)
        return
    if isinstance(operation, ReorderOperation):
        if operation.id in doc.order:
            doc.order.remove(operation.id)
            if operation.to == "front":
                doc.order.append(operation.id)
            else:
                doc.order.insert(0, operation.id)
        return
    if isinstance(operation, ClearOperation):
        doc.elements.clear()
        doc.order.clear()
        return
    raise APIError("invalid", 400, "Unsupported canvas operation.")


def validate_operations(store: DatabaseStore, session_id: str, participant_id: str, envelopes: list[CanvasEnvelope]) -> None:
    session = store.get_session(session_id)
    participant = store.get_participant(participant_id)
    if participant is None or participant.sessionId != session_id or participant.leftAt is not None:
        raise APIError("forbidden", 403, "You are no longer part of this interview.")
    if session.state in {SessionState.ENDED, SessionState.ARCHIVED}:
        raise APIError("ended", 409, "This interview has ended.")
    if participant.role.value == "observer":
        raise APIError("forbidden", 403, "Observers cannot edit the canvas.")
    if participant.role.value == "candidate" and not session.candidateEditingEnabled:
        raise APIError("forbidden", 403, "The interviewer has locked editing.")
    for envelope in envelopes:
        if envelope.actorId != participant_id:
            raise APIError("forbidden", 403, "The operation actor does not match the participant.")
 

def persist_operations(store: DatabaseStore, session_id: str, participant_id: str, envelopes: list[CanvasEnvelope]) -> int:
    validate_operations(store, session_id, participant_id, envelopes)
    doc, cursor = store.get_canvas(session_id)
    processed = store.processed_operation_ids(session_id)
    fresh = []
    for envelope in envelopes:
        if envelope.clientOperationId not in processed:
            processed.add(envelope.clientOperationId)
            fresh.append(envelope)
    for envelope in fresh:
        apply_operation(doc, envelope)
    cursor += len(fresh)
    store.save_canvas(session_id, doc, cursor, [envelope.clientOperationId for envelope in fresh])
    return cursor


def _session_for_canvas(id: str, context: AuthContext, store: DatabaseStore) -> InterviewSession:
    session = store.get_session(id)
    require_session_access(context, session, store)
    return session


@router.get("", response_model=CanvasSnapshot)
def get_snapshot(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> CanvasSnapshot:
    _session_for_canvas(id, context, store)
    doc, cursor = store.get_canvas(id)
    return CanvasSnapshot(
        sessionId=id,
        doc=doc,
        operationCursor=cursor,
        updatedAt=now_ms(),
    )


@router.post("/operations", response_model=SubmitOperationsResponse)
async def submit_operations(
    id: str,
    request: SubmitOperationsRequest,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> SubmitOperationsResponse:
    _session_for_canvas(id, context, store)
    participant = store.get_participant(request.participantId)
    if participant is None or participant.sessionId != id:
        raise APIError("forbidden", 403, "That participant cannot write to this canvas.")
    if context.participant_id and context.participant_id != request.participantId:
        raise APIError("forbidden", 403, "The collaboration credential belongs to another participant.")
    if context.user_id and participant.userId != context.user_id:
        raise APIError("forbidden", 403, "The authenticated user cannot write as this participant.")
    cursor = persist_operations(store, id, request.participantId, request.envelopes)
    from .realtime import manager

    await manager.broadcast_document_update(id, request.envelopes)
    return SubmitOperationsResponse(accepted=len(request.envelopes), cursor=cursor)


@router.get("/export", response_model=CanvasExport)
def export_json(
    id: str,
    context: AuthContext = Depends(get_current_auth),
    store: DatabaseStore = Depends(get_store),
) -> CanvasExport:
    session = _session_for_canvas(id, context, store)
    doc, _ = store.get_canvas(id)
    return CanvasExport(
        session=session,
        canvas=doc,
        exportedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
