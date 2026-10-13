# Collaborative Canvas Aid

Collaborative Canvas Aid is a full-stack system-design interview workspace. An interviewer creates an interview session, shares a guest link, and works with candidates on a shared architecture canvas in real time. The application stores sessions, participants, canvas documents, operations, and audit events for later review.

Repository: [SaraSun01/collab-canvas-fullstack](https://github.com/SaraSun01/collab-canvas-fullstack)

> **Render demo URL:** Not defined in the repository. Add the deployed URL here once it has been verified.

## Features

- Interview session lifecycle: create, start, end, archive, and duplicate sessions.
- Session metadata for titles, prompts, durations, and candidate-editing permissions.
- Revocable guest links for candidate access, with participant tracking and roles.
- Shared canvas with architecture components, text, sticky notes, connectors, freehand pen, highlighter, eraser, selection, pan, zoom, undo, and redo controls.
- Component palette organized into General, Data, Messaging, Network, Compute, and AI categories.
- Real-time document updates, participant presence, cursor updates, and WebSocket reconnect handling.
- Server-side authorization for owners, interviewers, candidates, and observers.
- Persistent canvas snapshots, operation history, session audit events, and JSON export.
- Read-only review view for ended interviews.
- FastAPI serves the compiled frontend and API from the same container image.

## Tech stack

| Area | Technologies |
| --- | --- |
| Frontend | React, TypeScript, TanStack Router/Start, Vite, Tailwind CSS, Radix UI, Lucide icons |
| Backend | Python 3.12, FastAPI, Uvicorn, Pydantic |
| Persistence | SQLAlchemy, PostgreSQL with `psycopg`, SQLite fallback for local development |
| Authentication | Bearer access tokens, session-scoped collaboration tokens, PBKDF2-HMAC password hashing |
| Testing | Pytest, HTTPX, WebSocket tests, Vitest, Testing Library, Playwright |
| DevOps | Docker, Docker Compose, multi-stage Docker builds, GitHub Actions, Render Docker Web Service deployment |

## Architecture

The browser loads the static React application from FastAPI. The frontend uses authenticated REST requests for session, authentication, participant, canvas, and audit operations. It uses a WebSocket connection for room membership, presence, session changes, and real-time canvas updates.

In Docker Compose, the app container connects to the PostgreSQL service through SQLAlchemy. When run outside Compose, the backend can use SQLite by default or any supported SQLAlchemy database URL. On startup, the backend creates the schema and seeds an empty database with development data.

~~~mermaid
flowchart LR
    Browser[Browser]
    Frontend[React / Vite frontend]
    API[FastAPI application]
    REST[REST API /v1]
    WS[WebSocket collaboration]
    ORM[SQLAlchemy]
    DB[(PostgreSQL)]
    Static[Compiled frontend files]

    Browser --> Frontend
    Frontend --> REST
    Frontend --> WS
    REST --> API
    WS --> API
    API --> ORM
    ORM --> DB
    API --> Static
~~~

The API contract is maintained in [`openapi.yaml`](./openapi.yaml). When the backend is running, FastAPI also exposes interactive documentation at [`/docs`](http://localhost:8000/docs).

## Getting started with Docker Compose

### Prerequisites

- Docker Desktop with Docker Compose v2
- Git

### Start the complete application

From the repository root:

~~~powershell
git clone https://github.com/SaraSun01/collab-canvas-fullstack.git
cd collab-canvas-fullstack
docker compose up --build -d
~~~

The application is available at:

- Frontend and API: <http://localhost:8000>
- Health check: <http://localhost:8000/health>
- FastAPI documentation: <http://localhost:8000/docs>

The Compose stack starts PostgreSQL first, waits for its container health check, and then starts the app. PostgreSQL data is stored in the named `postgres-data` volume.

Check the application directly if needed:

~~~powershell
curl.exe http://127.0.0.1:8000/health
~~~

Stop the services while preserving the local PostgreSQL volume:

~~~powershell
docker compose down
~~~

To also remove the local PostgreSQL volume and its data:

~~~powershell
docker compose down -v
~~~

## Development setup

The Docker image is the supported way to run the complete application. The frontend and backend can also be run separately for development.

### Backend

From the repository root:

~~~powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload
~~~

The backend listens on `http://127.0.0.1:8000` by default. Without `SDIP_DATABASE_URL` or `DATABASE_URL`, it uses the local SQLite database at `backend/collab_canvas.db`.

The Makefile provides equivalent backend commands:

~~~powershell
make install
make run
~~~

### Frontend

In a separate terminal:

~~~powershell
cd frontend
npm ci
npm run dev
~~~

The frontend API client defaults to `http://127.0.0.1:8000`. To point it at another backend, set `VITE_API_URL` before starting Vite. The available frontend environment variable names are documented in [`frontend/.env.example`](./frontend/.env.example); keep local values in an ignored `.env.local` file.

### Database configuration

The backend reads database configuration in this order:

1. `SDIP_DATABASE_URL`
2. `DATABASE_URL`
3. The local SQLite fallback

PostgreSQL URLs using `postgres://` or `postgresql://` are normalized to the bundled `psycopg` driver. Docker Compose sets `SDIP_DATABASE_URL` to its PostgreSQL service automatically.

## Testing

### Backend unit tests

From the repository root:

~~~powershell
python -m pytest backend/tests -q
~~~

Or:

~~~powershell
make test
~~~

### Frontend unit tests

~~~powershell
cd frontend
npm ci
npm test
~~~

### Compose integration tests

Start the stack first:

~~~powershell
docker compose up --build -d
~~~

Then, from the repository root:

~~~powershell
python -m pytest backend/integration_tests -q
~~~

Or:

~~~powershell
make integration-test
~~~

These tests cover static frontend serving, seeded authentication, session lifecycle, guest access, canvas persistence, and authenticated WebSocket behavior.

### Playwright end-to-end test

With Compose still running:

~~~powershell
cd e2e
npm.cmd ci
npm.cmd run install:browsers
npm.cmd test
~~~

The E2E test uses two isolated browser contexts to create an interview as the interviewer, share its guest link, join as a candidate, edit the canvas, and verify the change in the interviewer context.

From the repository root, the Makefile target is also available after E2E dependencies have been installed:

~~~powershell
make e2e
~~~

## CI/CD

The GitHub Actions workflow is [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). It runs on pushes to `main` and `master`, pull requests, and manual dispatches.

The pipeline is ordered as follows:

1. Backend and frontend test jobs run in parallel.
2. The Compose job runs only after both test jobs pass.
3. The Compose job builds the multi-stage image, starts PostgreSQL and the app, waits for `/health`, runs the integration tests, installs Chromium, and runs the Playwright E2E test.
4. Compose logs are collected and the stack is stopped even when a test fails.
5. An optional Render health check runs after successful non-PR workflow runs when the repository variable `RENDER_SERVICE_URL` is configured. It requests `/health` and does not deploy anything.

The workflow contains no AWS, OIDC, or cloud-provider deployment configuration. Render auto-deployment remains an external Render setting triggered by commits to the configured branch; this repository’s GitHub Actions workflow does not call the Render API or replace that behavior. If merges must be blocked until CI passes, configure required GitHub branch-protection checks for the workflow.

## Deployment on Render

There is no `render.yaml` or verified Render service URL checked into this repository. Configure the Render service externally as a Docker Web Service using the repository root as the Docker build context and [`Dockerfile`](./Dockerfile) as the Dockerfile.

For the current image, configure:

- Health Check Path: `/health`
- Container host: `0.0.0.0`
- Container port: `8000`, or a Docker command override that uses Render’s `PORT` value:

  ~~~sh
  sh -c 'exec uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-8000}"'
  ~~~

Set these production environment variables in Render without committing their values:

| Variable | Purpose |
| --- | --- |
| `SDIP_DATABASE_URL` | Connection URL for the Render PostgreSQL database. This takes precedence over the SQLite fallback. |
| `CANVAS_AUTH_SECRET` | Long, random secret used to sign bearer and collaboration tokens. |

Render supplies `PORT` for web services. `FRONTEND_DIR` and the local SQLite fallback are already configured by the Dockerfile, while `POSTGRES_*` variables belong to the local Compose setup. `VITE_API_URL` defaults to `/` in the Docker build because the backend serves the frontend and API from the same origin.

Before exposing a public deployment, replace development authentication defaults and set a production `CANVAS_AUTH_SECRET`. Do not place database URLs, passwords, or secrets in this README or in committed environment files.

## Project structure

~~~text
canvas_homework/
├── .github/
│   └── workflows/
│       └── ci.yml
├── backend/
│   ├── app/
│   │   ├── auth.py
│   │   ├── db.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── store.py
│   │   └── routers/
│   │       ├── auth.py
│   │       ├── canvas.py
│   │       ├── realtime.py
│   │       └── sessions.py
│   ├── integration_tests/
│   ├── tests/
│   └── requirements.txt
├── e2e/
│   ├── interview.spec.ts
│   ├── package.json
│   └── playwright.config.ts
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── routes/
│   │   └── services/
│   ├── package.json
│   ├── vite.config.ts
│   ├── vite.static.config.ts
│   └── vitest.config.ts
├── .dockerignore
├── .gitignore
├── Dockerfile
├── docker-compose.yaml
├── Makefile
└── openapi.yaml
~~~

