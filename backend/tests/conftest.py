from __future__ import annotations

import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient

from backend.app.db import SessionLocal, get_db, init_db
from backend.app.main import app
from backend.app.routers.realtime import manager
from backend.app.store import DEMO_PASSWORD, DatabaseStore


@pytest.fixture()
def store() -> DatabaseStore:
    init_db()
    db = SessionLocal()
    store = DatabaseStore(db)
    store.seed(now=1_700_000_000_000)
    yield store
    db.close()


@pytest.fixture()
def client(store: DatabaseStore) -> TestClient:
    manager.reset()

    def override_get_db():
        yield store.db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    manager.reset()


@pytest.fixture()
def user_token(client: TestClient) -> str:
    response = client.post(
        "/v1/auth/token",
        json={"email": "maya@lattice.dev", "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
