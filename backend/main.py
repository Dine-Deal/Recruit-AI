"""
main.py — FastAPI application entry point.
No database, no authentication. Fully local execution.

Memory fix: both spaCy and the embedding model are loaded once at startup
via preload_models(), before any request arrives. This prevents them from
being loaded concurrently mid-request which caused OOM kills on Render.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from config import settings
from api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from pipeline.orchestrator import preload_models
    logger.info("Starting Recruit-AI — pre-loading models...")
    preload_models()
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered Resume Screening System — local, no DB, no auth",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}