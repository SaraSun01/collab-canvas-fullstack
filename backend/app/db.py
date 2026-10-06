from __future__ import annotations

import os
from collections.abc import Generator, Mapping

from sqlalchemy import BigInteger, Boolean, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


DEFAULT_DATABASE_URL = "sqlite:///./backend/collab_canvas.db"


def normalize_database_url(database_url: str) -> str:
    """Use psycopg for PostgreSQL URLs that omit an explicit driver."""
    if database_url.startswith("postgres://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgres://")
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
    return database_url


def database_url_from_environment(environment: Mapping[str, str] | None = None) -> str:
    values = os.environ if environment is None else environment
    configured_url = values.get("SDIP_DATABASE_URL") or values.get("DATABASE_URL")
    return normalize_database_url(configured_url or DEFAULT_DATABASE_URL)


DATABASE_URL = database_url_from_environment()

engine_options: dict[str, object] = {"future": True, "pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
    if DATABASE_URL in {"sqlite://", "sqlite:///:memory:"} or ":memory:" in DATABASE_URL:
        engine_options["poolclass"] = StaticPool

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[int] = mapped_column(BigInteger)
    password_hash: Mapped[str] = mapped_column(Text)


class InterviewSessionRow(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(255), index=True)
    title: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(32), index=True)
    candidate_editing_enabled: Mapped[bool] = mapped_column(Boolean)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    scheduled_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    started_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ended_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger, index=True)


class GuestLinkRow(Base):
    __tablename__ = "guest_links"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    token: Mapped[str] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role_granted: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger)


class ParticipantRow(Base):
    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    user_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))
    color: Mapped[str] = mapped_column(String(32))
    joined_at: Mapped[int] = mapped_column(BigInteger)
    left_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)


class CanvasDocumentRow(Base):
    __tablename__ = "canvas_documents"

    session_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[str] = mapped_column(Text)
    operation_cursor: Mapped[int] = mapped_column(BigInteger)


class CanvasOperationRow(Base):
    __tablename__ = "canvas_operations"

    session_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(255), primary_key=True)


class AuditEventRow(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    event_type: Mapped[str] = mapped_column(String(255))
    actor: Mapped[str] = mapped_column(String(255))
    at: Mapped[int] = mapped_column(BigInteger)


class RevokedTokenRow(Base):
    __tablename__ = "revoked_tokens"

    token: Mapped[str] = mapped_column(Text, primary_key=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
