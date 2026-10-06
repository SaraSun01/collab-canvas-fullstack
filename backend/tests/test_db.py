from __future__ import annotations

from backend.app.db import database_url_from_environment, normalize_database_url


def test_normalizes_common_postgres_url_forms() -> None:
    assert normalize_database_url("postgres://user:pass@db.example/sdip") == (
        "postgresql+psycopg://user:pass@db.example/sdip"
    )
    assert normalize_database_url("postgresql://user:pass@db.example/sdip") == (
        "postgresql+psycopg://user:pass@db.example/sdip"
    )
    assert normalize_database_url("postgresql+psycopg://user:pass@db.example/sdip") == (
        "postgresql+psycopg://user:pass@db.example/sdip"
    )


def test_sdip_database_url_takes_precedence() -> None:
    assert database_url_from_environment(
        {
            "SDIP_DATABASE_URL": "postgresql://sdip:secret@db.example/sdip",
            "DATABASE_URL": "sqlite:///ignored.db",
        }
    ) == "postgresql+psycopg://sdip:secret@db.example/sdip"
