"""
config.py — Centralised application settings loaded from environment / .env
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Application ───────────────────────────────────────────────────────────
    APP_NAME: str = "AI-ATS"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://user:pass@ep-xxx-pooler.neon.tech/neondb"
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    # ── File Paths ────────────────────────────────────────────────────────────
    BASE_DIR: Path = Path(__file__).resolve().parent
    APPLICATIONS_DIR: Path = Field(default=Path("Applications"))
    OUTPUT_DIR: Path = Field(default=Path("Outputs"))
    JD_MASTER_PATH: Path = Field(default=Path("JD_Master.xlsx"))
    PROCESSED_REGISTRY_PATH: Path = Field(default=Path("processed_resumes.json"))
    FAISS_INDEX_DIR: Path = Field(default=Path("faiss_indices"))
    CANDIDATE_RANKING_OUTPUT: Path = Field(default=Path("Outputs/Candidate_Ranking.xlsx"))

    # ── NLP & Embeddings ──────────────────────────────────────────────────────
    SPACY_MODEL: str = "en_core_web_lg"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_BATCH_SIZE: int = 32
    EMBEDDING_DEVICE: str = "cpu"   # "cuda" if GPU available

    # ── Scoring Weights ───────────────────────────────────────────────────────
    WEIGHT_SEMANTIC: float = 0.70
    WEIGHT_SKILL: float = 0.20
    WEIGHT_EXPERIENCE: float = 0.10

    # ── Microsoft Graph / Outlook ─────────────────────────────────────────────
    MS_TENANT_ID: str = ""
    MS_CLIENT_ID: str = ""
    MS_CLIENT_SECRET: SecretStr = SecretStr("")
    MS_USER_EMAIL: str = ""          # recruiter mailbox
    MS_GRAPH_SCOPE: list[str] = ["https://graph.microsoft.com/.default"]
    EMAIL_POLL_INTERVAL_SECONDS: int = 300   # 5 min

    # ── Auth (JWT) ────────────────────────────────────────────────────────────
    SECRET_KEY: SecretStr = SecretStr("CHANGE_ME_IN_PRODUCTION_use_openssl_rand_hex_32")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480   # 8 hrs

    # ── CORS ──────────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: list[AnyHttpUrl | str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:4173"]

    def ensure_directories(self) -> None:
        """Create all required directories on startup."""
        for d in [
            self.APPLICATIONS_DIR,
            self.OUTPUT_DIR,
            self.FAISS_INDEX_DIR,
        ]:
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()