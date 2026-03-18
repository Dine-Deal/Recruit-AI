"""
pipeline/embeddings.py
──────────────────────
Generates semantic vector embeddings from resume / JD text using
sentence-transformers/all-MiniLM-L6-v2.

Features
────────
• Lazy model loading (loaded on first use, shared globally)
• Batch encoding for efficiency
• Deterministic vectors (same text → same vector)
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from loguru import logger
from sentence_transformers import SentenceTransformer

from config import settings


# ── Singleton model ───────────────────────────────────────────────────────────

_MODEL: Optional[SentenceTransformer] = None


def get_model() -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        logger.info(f"Loading embedding model: {settings.EMBEDDING_MODEL}")
        _MODEL = SentenceTransformer(
            settings.EMBEDDING_MODEL,
            device=settings.EMBEDDING_DEVICE,
        )
    return _MODEL


# ── Public API ────────────────────────────────────────────────────────────────

def embed_text(text: str) -> np.ndarray:
    """
    Encode a single text string → 1-D float32 numpy array (384-dim for MiniLM).
    Normalised to unit length for cosine similarity via dot product.
    """
    model = get_model()
    vec = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
    return vec.astype(np.float32)


def embed_texts(texts: list[str]) -> np.ndarray:
    """
    Encode a list of texts → 2-D float32 array of shape (N, 384).
    Uses internal batching for memory efficiency.
    """
    model = get_model()
    vecs = model.encode(
        texts,
        batch_size=settings.EMBEDDING_BATCH_SIZE,
        normalize_embeddings=True,
        show_progress_bar=len(texts) > 20,
        convert_to_numpy=True,
    )
    return vecs.astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """
    Cosine similarity between two normalised unit vectors.
    Since vectors are already L2-normalised, this reduces to a dot product.
    Returns a float in [0, 1].
    """
    return float(np.clip(np.dot(a, b), 0.0, 1.0))


def build_resume_text(parsed: dict) -> str:
    """
    Construct a rich, coherent text representation of a parsed resume
    for embedding — includes all semantic fields.
    """
    parts: list[str] = []

    if parsed.get("name"):
        parts.append(f"Candidate: {parsed['name']}")

    if parsed.get("skills"):
        parts.append("Skills: " + ", ".join(parsed["skills"]))

    if parsed.get("education"):
        parts.append(f"Education: {parsed['education']}")

    if parsed.get("experience_years") is not None:
        parts.append(f"Experience: {parsed['experience_years']} years")

    if parsed.get("previous_companies"):
        parts.append("Worked at: " + ", ".join(parsed["previous_companies"]))

    if parsed.get("certifications"):
        parts.append("Certifications: " + " | ".join(parsed["certifications"][:5]))

    if parsed.get("projects"):
        parts.append("Projects: " + " | ".join(parsed["projects"][:3]))

    # Append a portion of the raw text for coverage (first 800 chars)
    raw = (parsed.get("raw_text") or "").strip()
    if raw:
        parts.append(raw[:800])

    return "\n".join(parts)
