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


async def _prewarm_models() -> None:
    """
    Load the embedding model and spaCy into memory at startup.
    This prevents the first pipeline run from OOM-crashing Render
    by front-loading the heavy imports before any request arrives.
    """
    try:
        logger.info("Pre-warming embedding model…")
        from pipeline.embeddings import get_model
        await asyncio.get_event_loop().run_in_executor(None, get_model)
        logger.info("Embedding model ready ✓")
    except Exception as exc:
        logger.warning(f"Embedding model pre-warm failed: {exc}")

    try:
        logger.info("Pre-warming spaCy model…")
        from pipeline.resume_parser import get_nlp
        await asyncio.get_event_loop().run_in_executor(None, get_nlp)
        logger.info("spaCy model ready ✓")
    except Exception as exc:
        logger.warning(f"spaCy pre-warm failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")

    # Start DB init in background (non-blocking)
    asyncio.create_task(_create_tables_with_retry())

    # Pre-warm ML models so first pipeline run doesn't OOM
    asyncio.create_task(_prewarm_models())

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

# ── CORS — explicitly list all allowed origins ────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://recruitai-sand.vercel.app",   # production frontend
        "http://localhost:5173",                # Vite dev
        "http://localhost:3000",                # CRA dev
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
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
        async with asyncio.timeout(2):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        db_status = "connected"
    except asyncio.TimeoutError:
        db_status = "initializing"
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