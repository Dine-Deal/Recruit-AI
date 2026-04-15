"""
scoring/semantic_score.py — Embedding-based semantic similarity.
Uses sentence-transformers/all-MiniLM-L6-v2.

Fixes:
  - Thread-safe model singleton with Lock (same pattern as spaCy fix)
  - preload_embedding_model() for startup pre-warming
  - education field handles both list-of-dicts (v3 parser) and plain string
  - All list fields filtered for None before joining
"""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np
from loguru import logger

from config import settings

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _get_model():
    global _MODEL
    if _MODEL is None:
        with _MODEL_LOCK:
            if _MODEL is None:
                from sentence_transformers import SentenceTransformer
                logger.info(f"Loading embedding model: {settings.EMBEDDING_MODEL}")
                _MODEL = SentenceTransformer(
                    settings.EMBEDDING_MODEL,
                    device=settings.EMBEDDING_DEVICE,
                )
    return _MODEL


def preload_embedding_model() -> None:
    """Call once at app startup to load the model before requests arrive."""
    _get_model()


def embed_text(text: str) -> np.ndarray:
    """Encode text → normalised float32 numpy array (384-dim)."""
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
    return vec.astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalised vectors."""
    return float(np.clip(np.dot(a, b), 0.0, 1.0))


def build_resume_embedding_text(parsed: dict) -> str:
    """Build rich text representation of a resume for embedding."""
    parts = []

    if parsed.get("name"):
        parts.append(f"Candidate: {parsed['name']}")

    # Skills — filter None values
    skills = [s for s in (parsed.get("skills") or []) if s is not None]
    if skills:
        parts.append("Skills: " + ", ".join(skills))

    # Education — v3 parser returns list of dicts; use education_display string
    edu_display = parsed.get("education_display")
    if not edu_display:
        edu_raw = parsed.get("education")
        if isinstance(edu_raw, str):
            edu_display = edu_raw
        elif isinstance(edu_raw, list):
            edu_display = " | ".join(
                e.get("display", "") for e in edu_raw
                if isinstance(e, dict) and e.get("display")
            )
    if edu_display:
        parts.append(f"Education: {edu_display}")

    if parsed.get("experience_years") is not None:
        parts.append(f"Experience: {parsed['experience_years']} years")

    companies = [c for c in (parsed.get("previous_companies") or []) if c is not None]
    if companies:
        parts.append("Worked at: " + ", ".join(companies))

    certs = [c for c in (parsed.get("certifications") or []) if c is not None]
    if certs:
        parts.append("Certifications: " + " | ".join(certs[:5]))

    projects = [p for p in (parsed.get("projects") or []) if p is not None]
    if projects:
        parts.append("Projects: " + " | ".join(projects[:3]))

    raw = (parsed.get("raw_text") or "").strip()
    if raw:
        parts.append(raw[:800])

    return "\n".join(parts)