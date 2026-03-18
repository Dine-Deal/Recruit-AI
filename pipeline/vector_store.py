"""
pipeline/vector_store.py
─────────────────────────
Manages per-role FAISS indices on disk.

Design
──────
• One FAISS flat-IP index per role  (inner-product on normalised vectors = cosine sim)
• Index stored at: faiss_indices/<role_name>.index
• Metadata (candidate_ids) stored at: faiss_indices/<role_name>.json
• Thread-safe for concurrent reads; writes are serialised per index

Usage
─────
    store = VectorStore()
    store.add_vector(role="AI_Engineer", candidate_id="uuid-...", vector=np.array(...))
    results = store.search(role="AI_Engineer", query_vector=jd_embedding, top_k=20)
    # → [{"candidate_id": ..., "score": 0.91}, ...]
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

import faiss
import numpy as np
from loguru import logger

from config import settings

EMBEDDING_DIM = 384   # all-MiniLM-L6-v2 output dimension


class RoleIndex:
    """In-memory FAISS index + metadata for one job role."""

    def __init__(self, role: str, index_path: Path, meta_path: Path) -> None:
        self.role = role
        self.index_path = index_path
        self.meta_path = meta_path
        self._lock = threading.Lock()

        if index_path.exists() and meta_path.exists():
            self.index = faiss.read_index(str(index_path))
            with open(meta_path, "r") as f:
                self.candidate_ids: list[str] = json.load(f)
            logger.info(
                f"Loaded FAISS index for '{role}': "
                f"{self.index.ntotal} vectors"
            )
        else:
            # FlatIP = flat inner-product (cosine sim on normalised vectors)
            self.index = faiss.IndexFlatIP(EMBEDDING_DIM)
            self.candidate_ids = []

    def add(self, candidate_id: str, vector: np.ndarray) -> None:
        vec = np.expand_dims(vector, axis=0).astype(np.float32)
        with self._lock:
            self.index.add(vec)
            self.candidate_ids.append(candidate_id)
            self._persist()

    def search(self, query: np.ndarray, top_k: int = 20) -> list[dict]:
        if self.index.ntotal == 0:
            return []
        q = np.expand_dims(query, axis=0).astype(np.float32)
        k = min(top_k, self.index.ntotal)
        scores, indices = self.index.search(q, k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            results.append({
                "candidate_id": self.candidate_ids[idx],
                "score": float(np.clip(score, 0.0, 1.0)),
            })
        return results

    def _persist(self) -> None:
        faiss.write_index(self.index, str(self.index_path))
        with open(self.meta_path, "w") as f:
            json.dump(self.candidate_ids, f)

    def rebuild(self, candidate_ids: list[str], vectors: np.ndarray) -> None:
        """Replace the entire index with a new set of vectors (for re-indexing)."""
        with self._lock:
            self.index.reset()
            self.candidate_ids = []
            if len(candidate_ids):
                vecs = vectors.astype(np.float32)
                self.index.add(vecs)
                self.candidate_ids = list(candidate_ids)
            self._persist()


class VectorStore:
    """
    Registry of per-role FAISS indices.
    Instantiate once and reuse across the application.
    """

    def __init__(self) -> None:
        self._dir = settings.FAISS_INDEX_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._indices: dict[str, RoleIndex] = {}
        self._global_lock = threading.Lock()

    def _get_or_create(self, role: str) -> RoleIndex:
        if role not in self._indices:
            with self._global_lock:
                if role not in self._indices:
                    idx_path = self._dir / f"{role}.index"
                    meta_path = self._dir / f"{role}.json"
                    self._indices[role] = RoleIndex(role, idx_path, meta_path)
        return self._indices[role]

    def add_vector(
        self,
        role: str,
        candidate_id: str,
        vector: np.ndarray,
    ) -> None:
        """Add a single candidate embedding to the role index."""
        idx = self._get_or_create(role)
        idx.add(candidate_id, vector)

    def search(
        self,
        role: str,
        query_vector: np.ndarray,
        top_k: int = 20,
    ) -> list[dict]:
        """
        Semantic search against the role index.
        Returns up to `top_k` results sorted by cosine similarity desc.
        """
        idx = self._get_or_create(role)
        return idx.search(query_vector, top_k=top_k)

    def count(self, role: str) -> int:
        """Number of vectors stored for a role."""
        if role not in self._indices:
            return 0
        return self._indices[role].index.ntotal

    def available_roles(self) -> list[str]:
        """Roles that have persisted FAISS indices on disk."""
        return [p.stem for p in self._dir.glob("*.index")]


# Module-level singleton
_store: Optional[VectorStore] = None


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
