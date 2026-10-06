from __future__ import annotations

from fastapi.testclient import TestClient
from backend.app.main import FRONTEND_INDEX
from backend.app.db import SessionLocal
from backend.app.store import DatabaseStore


def test_root_is_available(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    if FRONTEND_INDEX.is_file():
        assert "text/html" in response.headers["content-type"]
        assert '<div id="root"></div>' in response.text
    else:
        assert response.json()["status"] == "ok"


def test_state_persists_across_database_sessions(store: DatabaseStore) -> None:
    session = store.get_session("ses_url_shortener")
    session.title = "Persisted title"
    store.save_session(session)

    with SessionLocal() as second_db:
        reloaded = DatabaseStore(second_db).get_session("ses_url_shortener")

    assert reloaded.title == "Persisted title"
