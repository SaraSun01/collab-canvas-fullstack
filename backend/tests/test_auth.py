from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import auth_headers
from backend.app.store import DatabaseStore


def test_login_me_and_password_is_hashed(client: TestClient, store: DatabaseStore) -> None:
    owner = store.get_user("user_owner")
    assert owner is not None
    assert owner.passwordHash != "demo-password"
    assert owner.passwordHash.startswith("pbkdf2_sha256$")

    response = client.post(
        "/v1/auth/token",
        json={"email": "maya@lattice.dev", "password": "demo-password"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]

    me = client.get("/v1/auth/me", headers=auth_headers(payload["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == "maya@lattice.dev"
    assert "password" not in me.json()


def test_invalid_password_and_revoked_token(client: TestClient, user_token: str) -> None:
    bad = client.post(
        "/v1/auth/token",
        json={"email": "maya@lattice.dev", "password": "wrong"},
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "invalid"

    signed_out = client.post("/v1/auth/signout", headers=auth_headers(user_token))
    assert signed_out.status_code == 204
    me = client.get("/v1/auth/me", headers=auth_headers(user_token))
    assert me.status_code == 401
