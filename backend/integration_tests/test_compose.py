from __future__ import annotations

import json
import os
import re
from collections.abc import Generator
from urllib.parse import quote, urlsplit, urlunsplit
from uuid import uuid4

import httpx
import pytest
from websockets.sync.client import connect


BASE_URL = os.getenv("SDIP_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL = os.getenv("SDIP_TEST_EMAIL", "maya@lattice.dev")
PASSWORD = os.getenv("SDIP_TEST_PASSWORD", "demo-password")


@pytest.fixture(scope="session")
def client() -> Generator[httpx.Client, None, None]:
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as api:
        try:
            response = api.get("/health")
        except httpx.HTTPError as error:
            pytest.fail(
                "The Compose app is not reachable at "
                f"{BASE_URL}. Start it with `docker compose up --build`. Error: {error}"
            )
        assert response.status_code == 200, response.text
        yield api


def auth_token(client: httpx.Client) -> str:
    response = client.post("/v1/auth/token", json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_session(client: httpx.Client, token: str, label: str) -> tuple[str, dict[str, str]]:
    response = client.post(
        "/v1/sessions",
        headers=auth_headers(token),
        json={
            "title": f"Compose integration {label} {uuid4().hex[:8]}",
            "prompt": "Verify the production stack.",
            "durationMinutes": 30,
        },
    )
    assert response.status_code == 201, response.text
    session_id = response.json()["id"]
    return session_id, auth_headers(token)


def finish_session(client: httpx.Client, session_id: str, headers: dict[str, str]) -> None:
    ended = client.post(f"/v1/sessions/{session_id}/end", headers=headers)
    if ended.status_code == 200:
        archived = client.post(f"/v1/sessions/{session_id}/archive", headers=headers)
        assert archived.status_code == 200, archived.text


def websocket_url() -> str:
    parsed = urlsplit(BASE_URL)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment)).rstrip("/")


def test_compose_serves_health_and_static_frontend(client: httpx.Client) -> None:
    health = client.get("/health")
    assert health.json() == {"status": "ok"}

    root = client.get("/")
    assert root.status_code == 200
    assert "text/html" in root.headers["content-type"]
    assert '<div id="root"></div>' in root.text

    new_page = client.get("/new")
    assert new_page.status_code == 200
    assert '<div id="root"></div>' in new_page.text

    script_match = re.search(r'<script[^>]+src="([^"]+\.js)"', root.text)
    assert script_match is not None
    script = client.get(script_match.group(1))
    assert script.status_code == 200
    assert "text/javascript" in script.headers["content-type"]


def test_compose_auth_and_session_lifecycle(client: httpx.Client) -> None:
    token = auth_token(client)
    headers = auth_headers(token)

    me = client.get("/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL

    listed = client.get("/v1/sessions", headers=headers)
    assert listed.status_code == 200
    assert {session["id"] for session in listed.json()} >= {
        "ses_rate_limiter",
        "ses_url_shortener",
        "ses_chat_system",
    }

    session_id, headers = create_session(client, token, "lifecycle")
    try:
        updated = client.patch(
            f"/v1/sessions/{session_id}",
            headers=headers,
            json={"candidateEditingEnabled": False},
        )
        assert updated.status_code == 200
        assert updated.json()["candidateEditingEnabled"] is False

        started = client.post(f"/v1/sessions/{session_id}/start", headers=headers)
        assert started.status_code == 200
        assert started.json()["state"] == "live"

        ended = client.post(f"/v1/sessions/{session_id}/end", headers=headers)
        assert ended.status_code == 200
        assert ended.json()["state"] == "ended"

        archived = client.post(f"/v1/sessions/{session_id}/archive", headers=headers)
        assert archived.status_code == 200
        assert archived.json()["state"] == "archived"
    finally:
        finish_session(client, session_id, headers)


def test_compose_guest_access_and_canvas_persistence(client: httpx.Client) -> None:
    token = auth_token(client)
    owner_headers = auth_headers(token)
    session_id, _ = create_session(client, token, "guest-canvas")

    link_response = client.post(f"/v1/sessions/{session_id}/guest-links", headers=owner_headers)
    assert link_response.status_code == 201, link_response.text
    link = link_response.json()

    resolved = client.get(f"/v1/join/{link['token']}")
    assert resolved.status_code == 200
    assert resolved.json()["session"]["id"] == session_id

    joined = client.post(f"/v1/join/{link['token']}", json={"displayName": "Compose Candidate"})
    assert joined.status_code == 201, joined.text
    guest = joined.json()
    guest_headers = auth_headers(guest["collaborationToken"])

    snapshot = client.get(f"/v1/sessions/{session_id}/canvas", headers=guest_headers)
    assert snapshot.status_code == 200
    assert snapshot.json()["doc"]["schemaVersion"] == 1

    participant_id = guest["participant"]["id"]
    envelope = {
        "clientOperationId": f"compose-{uuid4().hex}",
        "actorId": participant_id,
        "sentAt": 1_700_000_000_000,
        "operation": {
            "type": "add",
            "element": {
                "id": f"compose-node-{uuid4().hex}",
                "createdBy": participant_id,
                "createdAt": 1_700_000_000_000,
                "updatedAt": 1_700_000_000_000,
                "kind": "node",
                "componentType": "service",
                "x": 10,
                "y": 20,
                "width": 120,
                "height": 60,
                "label": "Compose node",
                "color": "accent",
            },
        },
    }
    submitted = client.post(
        f"/v1/sessions/{session_id}/canvas/operations",
        headers=guest_headers,
        json={"participantId": participant_id, "envelopes": [envelope]},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["accepted"] == 1

    refreshed = client.get(f"/v1/sessions/{session_id}/canvas", headers=guest_headers)
    assert refreshed.status_code == 200
    assert envelope["operation"]["element"]["id"] in refreshed.json()["doc"]["elements"]

    finish_session(client, session_id, owner_headers)


def test_compose_websocket_join_and_ping(client: httpx.Client) -> None:
    token = auth_token(client)
    session_id, headers = create_session(client, token, "websocket")
    participant_response = client.post(f"/v1/sessions/{session_id}/participants/owner", headers=headers)
    assert participant_response.status_code == 200, participant_response.text
    participant_id = participant_response.json()["id"]

    url = (
        f"{websocket_url()}/v1/sessions/{quote(session_id)}/realtime"
        f"?token={quote(token)}"
    )
    try:
        with connect(url, open_timeout=10, close_timeout=10) as websocket:
            websocket.send(
                json.dumps(
                    {
                        "type": "join_room",
                        "version": 1,
                        "sessionId": session_id,
                        "participantId": participant_id,
                    }
                )
            )
            joined = json.loads(websocket.recv(timeout=10))
            assert joined["type"] == "room_joined"
            assert joined["sessionId"] == session_id

            presence = json.loads(websocket.recv(timeout=10))
            assert presence["type"] == "presence_snapshot"

            websocket.send(
                json.dumps(
                    {
                        "type": "ping",
                        "version": 1,
                        "sessionId": session_id,
                        "correlationId": "compose-ping",
                    }
                )
            )
            pong = json.loads(websocket.recv(timeout=10))
            assert pong["type"] == "pong"
            assert pong["correlationId"] == "compose-ping"
    finally:
        finish_session(client, session_id, headers)
