from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .models import InterviewSession, Participant, Role, User, UserRecord

if TYPE_CHECKING:
    from .store import DatabaseStore


PASSWORD_ITERATIONS = 310_000
ACCESS_TOKEN_TTL = 3_600
TOKEN_SECRET = os.getenv("CANVAS_AUTH_SECRET", "local-development-secret").encode("utf-8")

bearer_scheme = HTTPBearer(auto_error=False)


def _get_auth_store(db: Session = Depends(get_db)):
    from .store import DatabaseStore

    return DatabaseStore(db)


@dataclass(frozen=True)
class AuthContext:
    token: str
    kind: str
    user_id: str | None = None
    participant_id: str | None = None
    session_id: str | None = None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        expected = _unb64(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _unb64(salt_text), iterations)
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def _signed_token(payload: dict[str, Any]) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    unsigned = f"{_b64(json.dumps(header, separators=(',', ':')).encode())}.{_b64(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(TOKEN_SECRET, unsigned.encode("ascii"), hashlib.sha256).digest()
    return f"{unsigned}.{_b64(signature)}"


def _decode_token(token: str) -> dict[str, Any]:
    try:
        header_text, payload_text, signature_text = token.split(".", 2)
        unsigned = f"{header_text}.{payload_text}"
        expected = hmac.new(TOKEN_SECRET, unsigned.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(signature_text)):
            raise ValueError("invalid signature")
        header = json.loads(_unb64(header_text))
        payload = json.loads(_unb64(payload_text))
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            raise ValueError("invalid header")
        if not isinstance(payload, dict) or int(payload.get("exp", 0)) <= int(time.time()):
            raise ValueError("expired token")
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        raise APIError("invalid", 401, "Invalid or expired bearer token.") from None


def create_access_token(user: UserRecord, ttl: int = ACCESS_TOKEN_TTL) -> str:
    now = int(time.time())
    return _signed_token(
        {
            "sub": user.id,
            "kind": "user",
            "iat": now,
            "exp": now + ttl,
            "jti": secrets.token_hex(12),
        }
    )


def create_collaboration_token(participant: Participant, ttl: int = ACCESS_TOKEN_TTL) -> str:
    now = int(time.time())
    return _signed_token(
        {
            "sub": participant.id,
            "kind": "collaboration",
            "user_id": participant.userId,
            "participant_id": participant.id,
            "session_id": participant.sessionId,
            "iat": now,
            "exp": now + ttl,
            "jti": secrets.token_hex(12),
        }
    )


def authenticate_token(token: str, store: DatabaseStore) -> AuthContext:
    if store.is_token_revoked(token):
        raise APIError("invalid", 401, "This bearer token has been revoked.")
    payload = _decode_token(token)
    kind = payload.get("kind")
    if kind == "user":
        user_id = payload.get("sub")
        if not isinstance(user_id, str) or store.get_user(user_id) is None:
            raise APIError("invalid", 401, "The token's user no longer exists.")
        return AuthContext(token=token, kind=kind, user_id=user_id)
    if kind == "collaboration":
        participant_id = payload.get("participant_id")
        session_id = payload.get("session_id")
        if not isinstance(participant_id, str) or not isinstance(session_id, str):
            raise APIError("invalid", 401, "Invalid collaboration credential.")
        participant = store.get_participant(participant_id)
        if participant is None or participant.sessionId != session_id or participant.leftAt is not None:
            raise APIError("invalid", 401, "This collaboration credential is no longer active.")
        return AuthContext(
            token=token,
            kind=kind,
            user_id=participant.userId,
            participant_id=participant.id,
            session_id=participant.sessionId,
        )
    raise APIError("invalid", 401, "Invalid bearer token.")


def get_current_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    store: DatabaseStore = Depends(_get_auth_store),
) -> AuthContext:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid", "message": "A bearer token is required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return authenticate_token(credentials.credentials, store)
    except APIError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


def require_user(context: AuthContext, store: DatabaseStore) -> UserRecord:
    if context.user_id is None:
        raise APIError("forbidden", 403, "A signed-in user account is required.")
    user = store.get_user(context.user_id)
    if user is None:
        raise APIError("invalid", 401, "The authenticated user no longer exists.")
    return user


def public_user(user: UserRecord) -> User:
    return User.model_validate(user.model_dump(exclude={"passwordHash"}))


def has_session_access(context: AuthContext, session: InterviewSession, store: DatabaseStore) -> bool:
    if context.user_id == session.ownerUserId:
        return True
    if context.participant_id:
        participant = store.get_participant(context.participant_id)
        return bool(
            participant
            and participant.sessionId == session.id
            and participant.leftAt is None
        )
    return False


def require_session_access(context: AuthContext, session: InterviewSession, store: DatabaseStore) -> None:
    if not has_session_access(context, session, store):
        raise APIError("forbidden", 403, "You do not have access to this interview.")


def require_session_manager(context: AuthContext, session: InterviewSession, store: DatabaseStore) -> None:
    if context.user_id == session.ownerUserId:
        return
    if context.participant_id:
        participant = store.get_participant(context.participant_id)
        if participant and participant.sessionId == session.id and participant.role in {Role.OWNER, Role.INTERVIEWER}:
            return
    raise APIError("forbidden", 403, "Only the owner or an interviewer may manage this interview.")


def require_owner(context: AuthContext, session: InterviewSession) -> None:
    if context.user_id != session.ownerUserId:
        raise APIError("forbidden", 403, "Only the session owner may perform this action.")
