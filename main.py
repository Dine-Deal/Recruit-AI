"""
main.py — FastAPI application entry point
"""

from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
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


def _extract_neon_host(db_url: str) -> str | None:
    m = re.search(r"@([^/]+)/", db_url)
    return m.group(1) if m else None


async def _wake_neon(host: str) -> None:
    url = f"https://{host}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.get(url)
        logger.info(f"Neon wake ping sent to {host}")
    except Exception as e:
        logger.warning(f"Neon wake ping failed: {type(e).__name__}")


async def _create_tables_with_retry(max_attempts: int = 5) -> None:
    db_url = settings.DATABASE_URL
    host = _extract_neon_host(db_url)

    if host and "neon.tech" in host:
        logger.info(f"Neon detected — waking {host}…")
        await _wake_neon(host)
        await asyncio.sleep(5)

    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database ready ✓")
            return
        except Exception as exc:
            if attempt == max_attempts:
                logger.warning(
                    f"DB not ready after {max_attempts} attempts ({type(exc).__name__}). "
                    "App will start and reconnect later."
                )
                return
            wait = attempt * 5
            logger.warning(
                f"DB attempt {attempt}/{max_attempts} failed: {type(exc).__name__}. "
                f"Retrying in {wait}s…"
            )
            await asyncio.sleep(wait)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    await _create_tables_with_retry()
    yield
    await engine.dispose()
    logger.info("Shutting down ATS API.")


app = FastAPI(
    title="AI-ATS API",
    description="AI-powered Applicant Tracking System",
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
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
    try:
        from sqlalchemy import text
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"unavailable ({type(e).__name__})"

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