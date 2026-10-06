from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import auth_headers


def test_seeded_sessions_and_session_lifecycle(client: TestClient, user_token: str) -> None:
    headers = auth_headers(user_token)
    listed = client.get("/v1/sessions", headers=headers)
    assert listed.status_code == 200
    assert {session["id"] for session in listed.json()} == {
        "ses_rate_limiter",
        "ses_url_shortener",
        "ses_chat_system",
    }

    created = client.post(
        "/v1/sessions",
        headers=headers,
        json={"title": "  New interview ", "prompt": "Draw a system", "durationMinutes": 30},
    )
    assert created.status_code == 201
    session_id = created.json()["id"]
    assert created.json()["title"] == "New interview"

    started = client.post(f"/v1/sessions/{session_id}/start", headers=headers)
    assert started.status_code == 200
    assert started.json()["state"] == "live"

    updated = client.patch(
        f"/v1/sessions/{session_id}",
        headers=headers,
        json={"candidateEditingEnabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["candidateEditingEnabled"] is False

    ended = client.post(f"/v1/sessions/{session_id}/end", headers=headers)
    assert ended.status_code == 200
    assert ended.json()["state"] == "ended"


def test_guest_link_resolve_join_and_revoke(client: TestClient, user_token: str) -> None:
    headers = auth_headers(user_token)
    created = client.post(
        "/v1/sessions",
        headers=headers,
        json={"title": "Guest flow", "prompt": "Prompt", "durationMinutes": 45},
    )
    session_id = created.json()["id"]
    rotated = client.post(f"/v1/sessions/{session_id}/guest-links", headers=headers)
    assert rotated.status_code == 201
    link = rotated.json()

    resolved = client.get(f"/v1/join/{link['token']}")
    assert resolved.status_code == 200
    assert resolved.json()["session"]["id"] == session_id

    joined = client.post(f"/v1/join/{link['token']}", json={"displayName": "Ada"})
    assert joined.status_code == 201
    guest_token = joined.json()["collaborationToken"]
    participant_id = joined.json()["participant"]["id"]

    participants = client.get(
        f"/v1/sessions/{session_id}/participants",
        headers=auth_headers(guest_token),
    )
    assert participants.status_code == 200
    assert any(participant["id"] == participant_id for participant in participants.json())

    revoked = client.delete(
        f"/v1/sessions/{session_id}/guest-links/{link['id']}",
        headers=headers,
    )
    assert revoked.status_code == 204
    assert client.get(f"/v1/join/{link['token']}").status_code == 410
