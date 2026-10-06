from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import auth_headers


def test_owner_can_join_read_and_write_canvas(client: TestClient, user_token: str) -> None:
    headers = auth_headers(user_token)
    joined = client.post("/v1/sessions/ses_url_shortener/participants/owner", headers=headers)
    assert joined.status_code == 200
    participant_id = joined.json()["id"]

    snapshot = client.get("/v1/sessions/ses_url_shortener/canvas", headers=headers)
    assert snapshot.status_code == 200
    assert snapshot.json()["doc"]["schemaVersion"] == 1

    envelope = {
        "clientOperationId": "op_test_1",
        "actorId": participant_id,
        "sentAt": 1700000000000,
        "operation": {
            "type": "add",
            "element": {
                "id": "el_test",
                "createdBy": participant_id,
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000,
                "kind": "node",
                "componentType": "service",
                "x": 10,
                "y": 20,
                "width": 120,
                "height": 60,
                "label": "API",
                "color": "accent",
            },
        },
    }
    submitted = client.post(
        "/v1/sessions/ses_url_shortener/canvas/operations",
        headers=headers,
        json={"participantId": participant_id, "envelopes": [envelope]},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["accepted"] == 1

    duplicate = client.post(
        "/v1/sessions/ses_url_shortener/canvas/operations",
        headers=headers,
        json={"participantId": participant_id, "envelopes": [envelope]},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["cursor"] == submitted.json()["cursor"]

    refreshed = client.get("/v1/sessions/ses_url_shortener/canvas", headers=headers)
    assert refreshed.json()["doc"]["elements"]["el_test"]["label"] == "API"


def test_locked_candidate_cannot_submit_operations(client: TestClient, user_token: str) -> None:
    headers = auth_headers(user_token)
    link = client.post("/v1/sessions/ses_rate_limiter/guest-links", headers=headers).json()
    joined = client.post(f"/v1/join/{link['token']}", json={"displayName": "Candidate"})
    candidate_headers = auth_headers(joined.json()["collaborationToken"])
    participant_id = joined.json()["participant"]["id"]

    locked = client.patch(
        "/v1/sessions/ses_rate_limiter",
        headers=headers,
        json={"candidateEditingEnabled": False},
    )
    assert locked.status_code == 200

    rejected = client.post(
        "/v1/sessions/ses_rate_limiter/canvas/operations",
        headers=candidate_headers,
        json={
            "participantId": participant_id,
            "envelopes": [
                {
                    "clientOperationId": "op_locked",
                    "actorId": participant_id,
                    "sentAt": 1700000000000,
                    "operation": {"type": "clear"},
                }
            ],
        },
    )
    assert rejected.status_code == 403
    assert rejected.json()["code"] == "forbidden"
