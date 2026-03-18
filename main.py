"""
main.py — FastAPI application entry point
"""

from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from api.routes import (
    auth_router,
    candidates_router,
    pipeline_router,
    reports_router,
    roles_router,
    upload_router,
)
from config import settings
from models.database import Base, engine


# ── Neon wakeup helper ────────────────────────────────────────────────────────

def _extract_neon_host(db_url: str) -> str | None:
    """
    Extract the hostname from the DATABASE_URL so we can ping it via HTTPS
    to wake Neon's compute endpoint before connecting.
    e.g. postgresql+asyncpg://user:pass@ep-xxx.neon.tech/db → ep-xxx.neon.tech
    """
    m = re.search(r"@([^/]+)/", db_url)
    return m.group(1) if m else None


async def _wake_neon(host: str) -> bool:
    """
    Send a simple HTTPS request to the Neon host.
    This triggers compute wakeup before the TCP DB connection attempt.
    Returns True if the host responded (even with an error — just needs to be reachable).
    """
    url = f"https://{host}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.get(url)
        return True
    except Exception:
        return True   # Any response (including SSL errors) means the host is awake


# ── DB startup with smart retry ───────────────────────────────────────────────

async def _create_tables_with_retry(max_attempts: int = 5) -> None:
    """
    1. HTTP-ping Neon to wake the compute endpoint.
    2. Wait a moment for the DB to become ready.
    3. Retry the SQLAlchemy connection up to max_attempts times.
    """
    db_url = settings.DATABASE_URL
    host = _extract_neon_host(db_url)

    if host and "neon.tech" in host:
        logger.info(f"Neon detected — sending HTTP wakeup ping to {host}…")
        await _wake_neon(host)
        logger.info("Wakeup ping sent. Waiting 5s for compute to resume…")
        await asyncio.sleep(5)

    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables verified. ✓")
            return
        except Exception as exc:
            err_msg = str(exc).strip() or type(exc).__name__
            if attempt == max_attempts:
                # DO NOT raise — let the app start anyway
                # pool_pre_ping=True will reconnect on first API request
                logger.warning(
                    f"DB not ready after {max_attempts} attempts ({err_msg}). "
                    "App starting anyway — will reconnect on first request."
                )
                return
            wait = attempt * 5
            logger.warning(f"DB attempt {attempt}/{max_attempts} failed: {err_msg}. Retrying in {wait}s…")
            await asyncio.sleep(wait)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    await _create_tables_with_retry()
    yield
    await engine.dispose()
    logger.info("Shutting down ATS API.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI-ATS API",
    description="AI-powered Applicant Tracking System — Resume Processing & Ranking",
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(roles_router)
app.include_router(candidates_router)
app.include_router(pipeline_router)
app.include_router(reports_router)
app.include_router(upload_router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Health check — also wakes Neon if needed."""
    try:
        from sqlalchemy import text
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"unavailable ({type(e).__name__}: {str(e)[:80]})"
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "database": db_status,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )