# Compose integration tests

These tests run from the host against the app exposed by `docker-compose.yaml`.
They cover:

- health and static frontend serving, including the `/new` SPA route;
- seeded authentication and authenticated session lifecycle;
- guest-link resolution, joining, and canvas write/read persistence;
- authenticated WebSocket room join, presence snapshot, and ping/pong.

Start the stack first:

```powershell
docker compose up --build -d
```

Run the suite:

```powershell
python -m pytest backend/integration_tests -q
```

The target defaults to `http://127.0.0.1:8000`. Override it with
`SDIP_BASE_URL` when the app is exposed on another host or port.

Stop the stack when finished:

```powershell
docker compose down
```
