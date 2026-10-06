from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .errors import APIError
from .db import SessionLocal, UserRow, init_db
from .routers import auth, canvas, realtime, sessions
from .store import DatabaseStore

FRONTEND_DIR = Path(
    os.getenv(
        "FRONTEND_DIR",
        str(Path(__file__).resolve().parents[2] / "frontend" / "dist"),
    )
).resolve()
FRONTEND_INDEX = FRONTEND_DIR / "index.html"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as db:
        if db.get(UserRow, "user_owner") is None:
            DatabaseStore(db).seed()
    yield


app = FastAPI(
    title="Collab Canvas Aid API",
    version="0.1.0",
    description="SQLAlchemy-backed backend for the collaborative system-design interview canvas.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(APIError)
async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
        headers={"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None,
    )


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        content = detail
    else:
        content = {"code": "invalid", "message": str(detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=dict(exc.headers or {}),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "invalid",
            "message": "Request validation failed.",
            "details": {"errors": exc.errors()},
        },
    )


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", tags=["System"], response_model=None)
def root() -> FileResponse | dict[str, str]:
    if FRONTEND_INDEX.is_file():
        return FileResponse(FRONTEND_INDEX)
    return {
        "name": "Collab Canvas Aid API",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(canvas.router)
app.include_router(realtime.router)


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    """Serve static frontend files and fall back to the SPA entry point."""
    if path.startswith("v1/"):
        raise HTTPException(status_code=404, detail="Not found")

    requested = (FRONTEND_DIR / path).resolve()
    try:
        requested.relative_to(FRONTEND_DIR)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Not found") from error

    if requested.is_file():
        return FileResponse(requested)
    if FRONTEND_INDEX.is_file():
        return FileResponse(FRONTEND_INDEX)
    raise HTTPException(status_code=404, detail="Not found")
