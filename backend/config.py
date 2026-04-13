"""
config.py — Lightweight settings for local-only ATS system.
No database, no authentication required.
"""
from __future__ import annotations
from pathlib import Path


class Settings:
    APP_NAME: str = "Recruit-AI"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent
    TEMP_DIR: Path = BASE_DIR / "temp_cache"
    PROCESSED_REGISTRY_PATH: Path = BASE_DIR / "processed_resumes.json"

    # NLP
    SPACY_MODEL: str = "en_core_web_sm"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DEVICE: str = "cpu"
    EMBEDDING_BATCH_SIZE: int = 32

    # Scoring weights
    WEIGHT_SEMANTIC: float = 0.70
    WEIGHT_SKILL: float = 0.20
    WEIGHT_EXPERIENCE: float = 0.10

    # Top N candidates to return
    TOP_N: int = 5

    # CORS
    ALLOWED_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]

    def ensure_directories(self) -> None:
        self.TEMP_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_directories()
