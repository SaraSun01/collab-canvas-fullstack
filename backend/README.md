# Collab Canvas Aid backend

This is a modular FastAPI implementation of the contract in the repository-root `openapi.yaml`.
It uses SQLAlchemy with SQLite by default. Data survives process restarts, and the database can be changed with the `SDIP_DATABASE_URL` or `DATABASE_URL` environment variable. `SDIP_DATABASE_URL` takes precedence.

## Run

From the repository root:

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload
```

The default database is `sqlite:///./backend/collab_canvas.db`. To use another SQLAlchemy-compatible database, set `SDIP_DATABASE_URL` or `DATABASE_URL` before starting the server. `SDIP_DATABASE_URL` takes precedence. PostgreSQL URLs using `postgres://` or `postgresql://` are automatically configured to use the bundled `psycopg` driver.

```powershell
$env:DATABASE_URL = "sqlite:///./backend/local.db"
python -m uvicorn backend.app.main:app --reload
```

For PostgreSQL:

```powershell
$env:SDIP_DATABASE_URL = "postgresql+psycopg://sdip:password@localhost:5432/sdip"
python -m uvicorn backend.app.main:app --reload
```

The seeded user is:

- Email: `maya@lattice.dev`
- Password: `demo-password`

Use `POST /v1/auth/token` to get a bearer token. The interactive API docs are available at `/docs`.

## Docker

From the repository root:

```powershell
docker build -t sdip:latest .
docker run --rm -p 8000:8000 `
  -v sdip-data:/data `
  -e SDIP_DATABASE_URL=sqlite:////data/sdip.db `
  --name sdip sdip:latest
```

The container serves the frontend and API from `http://localhost:8000`. The
SQLite database is stored in the `sdip-data` volume. Set
`SDIP_DATABASE_URL` at runtime to use PostgreSQL or another SQLAlchemy-compatible database, for example:

```powershell
docker run --rm -p 8000:8000 `
  -e SDIP_DATABASE_URL=postgresql+psycopg://sdip:password@host.docker.internal:5432/sdip `
  --name sdip sdip:latest
```

## Docker Compose

Start the app with PostgreSQL:

```powershell
docker compose -f docker-compose.yaml up --build
```

The app is available at `http://localhost:8000`. The PostgreSQL data is
stored in the `postgres-data` volume. Set `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, or `APP_PORT` before starting Compose to override the
development defaults.

## Test

```powershell
python -m pytest backend/tests -q
```
