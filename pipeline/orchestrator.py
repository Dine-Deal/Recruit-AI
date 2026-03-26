"""
pipeline/orchestrator.py
─────────────────────────
Processes uploaded resume bytes directly. No local folder scanning.
Accepts batched calls — each batch is deduplicated by file hash.
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Optional

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import settings
from models.database import Candidate, JobRole
from pipeline.embeddings import build_resume_text, embed_text
from pipeline.excel_reporter import generate_excel_report
from pipeline.jd_manager import compute_bytes_hash, get_registry
from pipeline.resume_parser import parse_resume_bytes
from pipeline.scorer import score_candidate
from pipeline.vector_store import get_vector_store


# ── Uploaded file container ───────────────────────────────────────────────────

class UploadedFile:
    def __init__(self, filename: str, content: bytes):
        self.filename = filename
        self.content  = content
        self.suffix   = Path(filename).suffix.lower()


# ── Pipeline result ───────────────────────────────────────────────────────────

class PipelineResult:
    def __init__(self) -> None:
        self.roles_processed: list[str] = []
        self.total_resumes: int = 0
        self.skipped: int = 0
        self.errors: int = 0
        self.excel_path: Optional[Path] = None

    def to_dict(self) -> dict:
        return {
            "roles":     len(self.roles_processed),
            "processed": self.total_resumes,
            "skipped":   self.skipped,
            "errors":    self.errors,
            "excel":     str(self.excel_path) if self.excel_path else None,
        }

    def __repr__(self) -> str:
        return (
            f"roles={len(self.roles_processed)} | "
            f"processed={self.total_resumes} | "
            f"skipped={self.skipped} | "
            f"errors={self.errors}"
        )


# ── Orchestrator ──────────────────────────────────────────────────────────────

class PipelineOrchestrator:
    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc"}

    def __init__(self) -> None:
        self._registry     = get_registry()
        self._vector_store = get_vector_store()
        self._engine       = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            connect_args={"ssl": "require", "timeout": 30},
        )
        self._session_factory = async_sessionmaker(
            self._engine, expire_on_commit=False
        )

    # ── Role loading ──────────────────────────────────────────────────────────

    async def _load_active_roles(
        self,
        owner_id:    Optional[uuid.UUID] = None,
        folder_name: Optional[str]       = None,
    ) -> list[JobRole]:
        async with self._session_factory() as session:
            stmt = select(JobRole).where(JobRole.status == "Active")
            if owner_id:
                stmt = stmt.where(JobRole.owner_id == owner_id)
            if folder_name:
                stmt = stmt.where(JobRole.folder_name == folder_name)
            result = await session.execute(stmt)
            return list(result.scalars().all())

    # ── File filtering ────────────────────────────────────────────────────────

    def _filter_supported(self, files: list[UploadedFile]) -> list[UploadedFile]:
        return [f for f in files if f.suffix in self.SUPPORTED_EXTENSIONS]

    def _filter_unprocessed(self, files: list[UploadedFile]) -> list[UploadedFile]:
        out = []
        for f in files:
            h = compute_bytes_hash(f.content)
            if self._registry.is_processed(h):
                logger.debug(f"Already processed, skipping: {f.filename}")
            else:
                out.append(f)
        return out

    # ── Core processing ───────────────────────────────────────────────────────

    async def _process_resume(
        self,
        uploaded:     UploadedFile,
        role:         JobRole,
        jd_embedding: list[float],
        session:      AsyncSession,
    ) -> Optional[dict]:
        file_hash   = compute_bytes_hash(uploaded.content)
        folder_name = role.folder_name

        existing = await session.execute(
            select(Candidate).where(
                and_(
                    Candidate.folder_name == folder_name,
                    Candidate.file_hash   == file_hash,
                )
            )
        )
        if existing.scalar_one_or_none():
            logger.debug(f"Duplicate in DB: {uploaded.filename}")
            return None

        try:
            parsed           = parse_resume_bytes(uploaded.content, uploaded.suffix, uploaded.filename)
            resume_text      = build_resume_text(parsed)
            resume_embedding = embed_text(resume_text)

            vs         = self._vector_store
            role_index = vs.get_or_create(folder_name)
            vs.add(role_index, resume_embedding, uploaded.filename)

            scores = score_candidate(
                resume_embedding    = resume_embedding,
                jd_embedding        = jd_embedding,
                candidate_skills    = parsed.get("skills", []),
                must_have_skills    = role.must_have_skills    or [],
                good_to_have_skills = role.good_to_have_skills or [],
                experience_years    = parsed.get("experience_years"),
                minimum_experience  = role.minimum_experience  or 0,
            )

            candidate = Candidate(
                job_role_id         = role.id,
                role_name           = role.role_name,
                folder_name         = folder_name,
                name                = parsed.get("name"),
                email               = parsed.get("email"),
                phone               = parsed.get("phone"),
                skills              = parsed.get("skills", []),
                education           = parsed.get("education"),
                experience_years    = parsed.get("experience_years"),
                previous_companies  = parsed.get("previous_companies", []),
                certifications      = parsed.get("certifications", []),
                projects            = parsed.get("projects", []),
                raw_text            = (parsed.get("raw_text", ""))[:20000],
                file_name           = uploaded.filename,
                file_hash           = file_hash,
                file_path           = uploaded.filename,
                semantic_score      = scores["semantic_score"],
                skill_score         = scores["skill_score"],
                experience_score    = scores["experience_score"],
                final_score         = scores["final_score"],
                parsed_data         = {
                    "certifications": parsed.get("certifications"),
                    "projects":       parsed.get("projects"),
                },
            )
            session.add(candidate)
            await session.commit()
            await session.refresh(candidate)

            self._registry.mark_processed(
                file_name = uploaded.filename,
                role      = role.role_name,
                file_hash = file_hash,
            )

            logger.info(f"✓ {uploaded.filename} | score={scores['final_score']:.3f} | role={role.role_name}")
            return {
                "id":          str(candidate.id),
                "name":        candidate.name,
                "final_score": candidate.final_score,
                "rank":        None,
            }

        except Exception as exc:
            logger.error(f"✗ Failed {uploaded.filename}: {exc}")
            await session.rollback()
            return None

    # ── Ranking ───────────────────────────────────────────────────────────────

    async def _rank_and_persist(self, role: JobRole) -> None:
        async with self._session_factory() as session:
            result = await session.execute(
                select(Candidate)
                .where(Candidate.job_role_id == role.id)
                .order_by(Candidate.final_score.desc())
            )
            all_candidates = list(result.scalars().all())
            for rank, cand in enumerate(all_candidates, start=1):
                cand.rank = rank
            await session.commit()
            logger.info(f"Ranked {len(all_candidates)} candidates for {role.role_name}")

    # ── Public API ────────────────────────────────────────────────────────────

    async def run_with_files(
        self,
        uploaded_files:  list[UploadedFile],
        jd_text:         Optional[str]       = None,
        jd_file_bytes:   Optional[bytes]     = None,
        jd_file_suffix:  Optional[str]       = None,
        folder_name:     Optional[str]       = None,
        owner_id:        Optional[uuid.UUID] = None,
        generate_report: bool                = True,
    ) -> PipelineResult:
        result = PipelineResult()

        roles = await self._load_active_roles(owner_id=owner_id, folder_name=folder_name)
        if not roles:
            roles = await self._load_active_roles(folder_name=folder_name)
        if not roles:
            logger.warning("No active roles found.")
            return result

        supported   = self._filter_supported(uploaded_files)
        unprocessed = self._filter_unprocessed(supported)
        result.skipped += len(uploaded_files) - len(unprocessed)

        logger.info(
            f"Batch: total={len(uploaded_files)} | "
            f"supported={len(supported)} | new={len(unprocessed)} | skipped={result.skipped}"
        )

        if not unprocessed:
            logger.info("All files in this batch already processed.")
            return result

        role_candidates: dict[str, list] = {}

        for role in roles:
            # JD resolution: passed text → uploaded JD file → saved role JD
            jd_resolved = jd_text

            if not jd_resolved and jd_file_bytes and jd_file_suffix:
                try:
                    jd_parsed   = parse_resume_bytes(jd_file_bytes, jd_file_suffix, "jd_file")
                    jd_resolved = jd_parsed.get("raw_text", "")
                except Exception as exc:
                    logger.warning(f"Could not parse JD file: {exc}")

            if not jd_resolved:
                jd_resolved = role.job_description

            if not jd_resolved:
                logger.warning(f"Role '{role.role_name}' has no JD — skipping batch")
                result.skipped += len(unprocessed)
                continue

            jd_embedding         = embed_text(jd_resolved)
            processed_candidates = []

            async with self._session_factory() as session:
                for uploaded in unprocessed:
                    cand = await self._process_resume(uploaded, role, jd_embedding, session)
                    if cand:
                        processed_candidates.append(cand)
                        result.total_resumes += 1
                    else:
                        result.errors += 1

            await self._rank_and_persist(role)
            result.roles_processed.append(role.role_name)
            role_candidates[role.role_name] = processed_candidates

        if generate_report and result.total_resumes > 0:
            try:
                result.excel_path = generate_excel_report(role_candidates)
            except Exception as exc:
                logger.error(f"Excel report failed: {exc}")

        logger.info(f"Batch complete: {result}")
        return result

    # ── Legacy stubs ──────────────────────────────────────────────────────────

    async def run_all(
        self,
        owner_id: Optional[uuid.UUID] = None,
        generate_report: bool = True,
    ) -> PipelineResult:
        logger.warning("run_all() has no files — use run_with_files() instead.")
        return PipelineResult()

    async def run_role(
        self,
        folder_name: str,
        owner_id: Optional[uuid.UUID] = None,
        jd_override: Optional[str] = None,
    ) -> PipelineResult:
        logger.warning("run_role() has no files — use run_with_files() instead.")
        return PipelineResult()