"""
scoring/semantic_score.py — Embedding-based semantic similarity.

Uses fastembed (ONNX Runtime) instead of sentence-transformers (PyTorch).

Why the switch:
  torch==2.3.0 uses ~200-300MB RSS just to be imported, which combined
  with spaCy (~50MB) and FastAPI base (~80MB) exceeds Render's 512MB limit.
  fastembed uses onnxruntime (~50MB) — same quality, ~5x lower memory.

Model: BAAI/bge-small-en-v1.5 (384-dim, ~67MB, ONNX)
"""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np
from loguru import logger

_MODEL = None
_MODEL_LOCK = threading.Lock()

# fastembed model to use — small, fast, ONNX-based
_FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"


def _get_model():
    global _MODEL
    if _MODEL is None:
        with _MODEL_LOCK:
            if _MODEL is None:
                from fastembed import TextEmbedding
                logger.info(f"Loading embedding model (fastembed): {_FASTEMBED_MODEL}")
                _MODEL = TextEmbedding(model_name=_FASTEMBED_MODEL)
                logger.info("Embedding model ready.")
    return _MODEL


def preload_embedding_model() -> None:
    """Call once at app startup to load the model before requests arrive."""
    _get_model()


def embed_text(text: str) -> np.ndarray:
    """Encode text → normalised float32 numpy array (384-dim)."""
    model = _get_model()
    # fastembed returns a generator of numpy arrays
    vec = list(model.embed([text]))[0]
    # Normalise to unit vector for cosine similarity via dot product
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
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