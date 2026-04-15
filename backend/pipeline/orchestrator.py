"""
pipeline/orchestrator.py — Core processing pipeline.

Memory fixes for cloud deployment (Render free tier):
  1. ThreadPoolExecutor reduced from 4 → 1 worker (sequential resume processing)
     Prevents 4 simultaneous spaCy loads that OOM-kill the server
  2. Both models (spaCy + embedding) are pre-warmed once at startup via
     preload_models(), not lazily on first request
  3. .doc files (legacy Word) are skipped gracefully — python-docx cannot
     read binary .doc format, only .docx
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from loguru import logger

from config import settings
from file_loader.local_loader import compute_file_hash
from file_loader.unified_loader import UnifiedLoader
from nlp.resume_parser import parse_resume, preload_nlp
from scoring.final_ranker import rank_candidates, score_candidate
from scoring.semantic_score import (
    build_resume_embedding_text,
    cosine_similarity,
    embed_text,
    preload_embedding_model,
)

# Single worker — prevents concurrent spaCy loads that spike RAM
_executor = ThreadPoolExecutor(max_workers=1)


async def _run_in_executor(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, fn, *args)
def preload_models():
       # your model loading logic here
       pass

def preload_models() -> None:
    """
    Pre-warm both models at startup.
    Call this from main.py startup event so models are loaded once into
    shared memory before any request arrives.
    Avoids 30-60s spike on first request and prevents concurrent loads.
    """
    logger.info("Pre-loading NLP models at startup...")
    preload_nlp()
    preload_embedding_model()
    logger.info("Models ready.")


class PipelineOrchestrator:
    def __init__(self) -> None:
        self._loader = UnifiedLoader()

    async def run(
        self,
        jd_text: str,
        source: dict,
    ) -> list[dict]:
        """
        Main entry point.
        Returns list of ranked candidate dicts (Top N).
        Resumes are processed sequentially (max_workers=1) to minimise RAM.
        """
        # 1. Load files
        logger.info(f"Loading files from source: {source}")
        files = await _run_in_executor(self._loader.load_files, source)
        logger.info(f"Total files loaded: {len(files)}")

        if not files:
            logger.warning("No resume files found.")
            return []

        # 2. Filter duplicates
        unprocessed = self._loader.filter_unprocessed(files)
        logger.info(f"Unprocessed (new) files: {len(unprocessed)}")

        # If all already processed, still score them against the new JD
        files_to_process = unprocessed if unprocessed else files

        # 3. Embed JD once
        logger.info("Embedding job description...")
        jd_embedding = await _run_in_executor(embed_text, jd_text)

        # 4. Process each resume sequentially (not in parallel)
        candidates: list[dict] = []
        for resume_path in files_to_process:
            result = await self._process_one(
                resume_path,
                jd_text=jd_text,
                jd_embedding=jd_embedding,
            )
            if result:
                candidates.append(result)
                try:
                    h = compute_file_hash(resume_path)
                    self._loader.mark_processed(resume_path, h)
                except Exception:
                    pass

        # 5. Rank and return Top N
        ranked = rank_candidates(candidates, top_n=settings.TOP_N)
        logger.info(f"Pipeline complete. Ranked {len(ranked)} candidates.")
        return ranked

    async def _process_one(
        self,
        resume_path: Path,
        jd_text: str,
        jd_embedding,
    ) -> Optional[dict]:
        """Parse and score a single resume. Returns candidate dict or None."""
        # Skip legacy .doc files — python-docx cannot read binary .doc
        if resume_path.suffix.lower() == ".doc":
            logger.warning(
                f"  Skipping {resume_path.name}: legacy .doc format not supported. "
                "Convert to .docx and re-upload."
            )
            return None

        try:
            # Parse
            parsed = await _run_in_executor(parse_resume, resume_path)

            # Embed
            resume_text = build_resume_embedding_text(parsed)
            resume_vec = await _run_in_executor(embed_text, resume_text)

            # Score
            sim = cosine_similarity(resume_vec, jd_embedding)
            scores = score_candidate(
                parsed=parsed,
                semantic_similarity=sim,
                jd_text=jd_text,
            )

            candidate = {**parsed, **scores}
            logger.info(
                f"  ✓ {resume_path.name}: final={scores['final_score']:.3f} "
                f"(sem={scores['semantic_score']:.2f}, "
                f"skill={scores['skill_score']:.2f}, "
                f"exp={scores['experience_score']:.2f})"
            )
            return candidate

        except Exception as exc:
            logger.exception(f"  ✗ {resume_path.name}: {exc}")
            return None