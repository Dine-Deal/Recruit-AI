"""
pipeline/orchestrator.py — Core processing pipeline.

Flow:
  JD text → embed → foreach resume:
    1. Parse (NER + text extraction)
    2. Embed resume text
    3. Cosine semantic similarity
    4. Skill + experience scoring
    5. Composite score
  → Rank → Return Top N

Changes from original:
  - Removed must_have_skills, good_to_have_skills, minimum_experience
    params from run() and _process_one()
  - score_candidate() called without skill hint args (auto-derives from JD text)
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
from nlp.resume_parser import parse_resume
from scoring.final_ranker import rank_candidates, score_candidate
from scoring.semantic_score import build_resume_embedding_text, cosine_similarity, embed_text


_executor = ThreadPoolExecutor(max_workers=4)


async def _run_in_executor(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, fn, *args)


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
        Skill requirements and experience minimum are auto-derived from JD text.
        """
        # 1. Load files
        logger.info(f"Loading files from source: {source}")
        files = await _run_in_executor(self._loader.load_files, source)
        logger.info(f"Total files loaded: {len(files)}")

        if not files:
            logger.warning("No resume files found.")
            return []

        # 2. Embed JD once
        logger.info("Embedding job description...")
        jd_embedding = await _run_in_executor(embed_text, jd_text)

        # 3. Process each resume concurrently with limit of 50
        candidates: list[dict] = []
        semaphore = asyncio.Semaphore(50)

        async def process_file(resume_path: Path):
            async with semaphore:
                try:
                    h = compute_file_hash(resume_path)
                    cached = self._loader.get_cached_parsed(h)
                    if cached:
                        # Cached duplicate: re-score directly
                        resume_text = build_resume_embedding_text(cached)
                        resume_vec = await _run_in_executor(embed_text, resume_text)
                        sim = cosine_similarity(resume_vec, jd_embedding)
                        scores = score_candidate(
                            parsed=cached,
                            semantic_similarity=sim,
                            jd_text=jd_text,
                        )
                        c = {**cached, **scores}
                        c["file_path"] = str(resume_path)
                        logger.info(f"  ✓ {resume_path.name} (CACHED): final={c['final_score']:.3f}")
                        return c
                    else:
                        # New file: Parse and save
                        c = await self._process_one(resume_path, jd_text, jd_embedding)
                        if c:
                            parsed_only = {k: v for k, v in c.items() if k not in ["semantic_score", "skill_score", "experience_score", "final_score", "rank"]}
                            self._loader.save_cached_parsed(h, parsed_only)
                            self._loader.mark_processed(resume_path, h)
                        return c
                except Exception as exc:
                    logger.error(f"  ✗ {resume_path.name}: {exc}")
                    return None

        tasks = [process_file(fp) for fp in files]
        results = await asyncio.gather(*tasks)
        
        for r in results:
            if r:
                candidates.append(r)

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
        try:
            # Parse
            parsed = await _run_in_executor(parse_resume, resume_path)

            # Embed
            resume_text = build_resume_embedding_text(parsed)
            resume_vec = await _run_in_executor(embed_text, resume_text)

            # Score — skill hints auto-derived from JD text
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
            logger.error(f"  ✗ {resume_path.name}: {exc}")
            return None