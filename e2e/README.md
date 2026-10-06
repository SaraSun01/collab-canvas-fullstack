# End-to-end tests

This suite drives the frontend served by the app service in `docker-compose.yaml`.
It uses two isolated Playwright browser contexts to verify the interviewer and candidate workflow:

- sign in as the seeded interviewer;
- create and share an interview;
- join the invite as a candidate;
- place a canvas component as the candidate;
- observe that component from the interviewer context.

Start Compose from the repository root:

```powershell
docker compose up --build -d
```

Install the E2E dependencies and Chromium once:

```powershell
cd e2e
npm.cmd install
npm.cmd run install:browsers
```

Run the test:

```powershell
npm.cmd test
```

The default target is `http://127.0.0.1:8000`. Set `SDIP_BASE_URL` to run against another app URL.
