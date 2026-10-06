from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import auth_headers


def test_realtime_join_and_ping(client: TestClient, user_token: str) -> None:
    with client.websocket_connect(
        "/v1/sessions/ses_rate_limiter/realtime",
        headers=auth_headers(user_token),
    ) as websocket:
        websocket.send_json(
            {
                "type": "join_room",
                "version": 1,
                "sessionId": "ses_rate_limiter",
                "participantId": "par_owner_live",
            }
        )
        joined = websocket.receive_json()
        assert joined["type"] == "room_joined"
        assert joined["cursor"] == 4

        # Joining also publishes the initial presence snapshot.
        initial_presence = websocket.receive_json()
        assert initial_presence["type"] == "presence_snapshot"

        websocket.send_json(
            {
                "type": "ping",
                "version": 1,
                "sessionId": "ses_rate_limiter",
                "correlationId": "c1",
            }
        )
        pong = websocket.receive_json()
        assert pong["type"] == "pong"
        assert pong["correlationId"] == "c1"
