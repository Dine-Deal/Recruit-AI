"""
pipeline/orchestrator.py
─────────────────────────
Pipeline that reads roles directly from the database (not JD_Master.xlsx).
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import settings
from models.database import Base, Candidate, JobRole, ProcessingLog
from pipeline.embeddings import build_resume_text, cosine_similarity, embed_text
from pipeline.excel_reporter import generate_excel_report
from pipeline.jd_manager import compute_file_hash, get_registry
from pipeline.resume_parser import parse_resume
from pipeline.scorer import rank_candidates, score_candidate
from pipeline.vector_store import get_vector_store


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
        self._registry  = get_registry()
        self._vector_store = get_vector_store()
        self._engine    = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            connect_args={"ssl": "require", "timeout": 30},
        )
        self._session_factory = async_sessionmaker(
            self._engine, expire_on_commit=False
        )

    # ── Role loading from DB ──────────────────────────────────────────────────

    async def _load_active_roles(
        self, owner_id: Optional[uuid.UUID] = None, folder_name: Optional[str] = None
    ) -> list[JobRole]:
        """Load active roles from DB — optionally filtered by owner or folder."""
        async with self._session_factory() as session:
            stmt = select(JobRole).where(JobRole.status == "Active")
            if owner_id:
                stmt = stmt.where(JobRole.owner_id == owner_id)
            if folder_name:
                stmt = stmt.where(JobRole.folder_name == folder_name)
            result = await session.execute(stmt)
            return list(result.scalars().all())

    def _resolve_folder(self, role: JobRole) -> Path:
        """Resolve the actual folder path for a role."""
        folder_name = role.folder_name or ""
        if folder_name.startswith(("C:\\", "C:/", "\\\\", "//")) or "/" in folder_name[1:3]:
            return Path(folder_name)
        elif "\\" in folder_name or "/" in folder_name:
            return Path(folder_name)
        else:
            return settings.APPLICATIONS_DIR / folder_name

    def _get_unprocessed_resumes(self, folder: Path) -> list[Path]:
        if not folder.exists():
            folder.mkdir(parents=True, exist_ok=True)
            return []
        files = []
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
                continue
            file_hash = compute_file_hash(f)
            if self._registry.is_processed(str(folder.name), file_hash):
                continue
            files.append(f)
        return files

    # ── Core processing ───────────────────────────────────────────────────────

    async def _process_resume(
        self,
        resume_path: Path,
        role: JobRole,
        jd_embedding: list[float],
        session: AsyncSession,
    ) -> Optional[dict]:
        """Parse, embed, score and persist one resume. Returns candidate dict or None."""
        file_hash = compute_file_hash(resume_path)
        folder_name = role.folder_name

        # Double-check not already in DB
        from sqlalchemy import and_
        existing = await session.execute(
            select(Candidate).where(
                and_(
                    Candidate.folder_name == folder_name,
                    Candidate.file_hash == file_hash,
                )
            )
        )
        if existing.scalar_one_or_none():
            logger.debug(f"Skipping duplicate: {resume_path.name}")
            return None

        try:
            # Parse
            parsed = parse_resume(resume_path)

            # Embed
            resume_text = build_resume_text(parsed)
            resume_embedding = embed_text(resume_text)

            # Store in FAISS
            vs = self._vector_store
            role_index = vs.get_or_create(folder_name)
            vs.add(role_index, resume_embedding, str(resume_path))

            # Score
            scores = score_candidate(
                resume_embedding=resume_embedding,
                jd_embedding=jd_embedding,
                candidate_skills=parsed.get("skills", []),
                must_have_skills=role.must_have_skills or [],
                good_to_have_skills=role.good_to_have_skills or [],
                experience_years=parsed.get("experience_years"),
                minimum_experience=role.minimum_experience or 0,
            )

            # Persist to DB
            candidate = Candidate(
                job_role_id=role.id,
                role_name=role.role_name,
                folder_name=folder_name,
                name=parsed.get("name"),
                email=parsed.get("email"),
                phone=parsed.get("phone"),
                skills=parsed.get("skills", []),
                education=parsed.get("education"),
                experience_years=parsed.get("experience_years"),
                previous_companies=parsed.get("previous_companies", []),
                certifications=parsed.get("certifications", []),
                projects=parsed.get("projects", []),
                raw_text=(parsed.get("raw_text", ""))[:20000],
                file_name=resume_path.name,
                file_hash=file_hash,
                file_path=str(resume_path),
                semantic_score=scores["semantic_score"],
                skill_score=scores["skill_score"],
                experience_score=scores["experience_score"],
                final_score=scores["final_score"],
                parsed_data={
                    "certifications": parsed.get("certifications"),
                    "projects": parsed.get("projects"),
                },
            )
            session.add(candidate)
            await session.commit()
            await session.refresh(candidate)

            # Mark as processed in registry
            self._registry.mark_processed(folder_name, file_hash, resume_path.name)

            logger.info(
                f"✓ {resume_path.name} | score={scores['final_score']:.3f} | "
                f"role={role.role_name}"
            )
            return {
                "id": str(candidate.id),
                "name": candidate.name,
                "final_score": candidate.final_score,
                "rank": None,
            }

        except Exception as exc:
            logger.error(f"✗ Failed {resume_path.name}: {exc}")
            await session.rollback()
            return None

    async def _rank_and_persist(self, role: JobRole, candidates: list[dict]) -> None:
        """Re-rank all candidates for a role and persist ranks to DB."""
        if not candidates:
            return

        async with self._session_factory() as session:
            # Load all candidates for this role from DB
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

    async def run_all(
        self,
        owner_id: Optional[uuid.UUID] = None,
        generate_report: bool = True,
    ) -> PipelineResult:
        """Run pipeline for all active roles (optionally filtered by owner)."""
        result = PipelineResult()
        roles = await self._load_active_roles(owner_id=owner_id)

        if not roles:
            logger.warning("No active roles found in DB. Add roles in the Job Roles tab.")
            return result

        role_candidates: dict[str, list] = {}

        for role in roles:
            folder = self._resolve_folder(role)
            logger.info(f"Processing role: {role.role_name} → {folder}")

            if not role.job_description:
                logger.warning(f"Role '{role.role_name}' has no JD — skipping")
                continue

            jd_embedding = embed_text(role.job_description)
            unprocessed = self._get_unprocessed_resumes(folder)
            logger.info(f"  Found {len(unprocessed)} new resume(s) in {folder}")

            processed_candidates = []
            async with self._session_factory() as session:
                for resume_path in unprocessed:
                    cand = await self._process_resume(
                        resume_path, role, jd_embedding, session
                    )
                    if cand:
                        processed_candidates.append(cand)
                        result.total_resumes += 1
                    else:
                        result.skipped += 1

            await self._rank_and_persist(role, processed_candidates)
            result.roles_processed.append(role.role_name)
            role_candidates[role.role_name] = processed_candidates

        if generate_report and result.total_resumes > 0:
            try:
                result.excel_path = generate_excel_report(role_candidates)
            except Exception as exc:
                logger.error(f"Excel report failed: {exc}")

        logger.info(f"Pipeline complete: {result}")
        return result

    async def run_role(
        self,
        folder_name: str,
        owner_id: Optional[uuid.UUID] = None,
        jd_override: Optional[str] = None,
    ) -> PipelineResult:
        """Run pipeline for a single role by folder_name."""
        result = PipelineResult()
        roles = await self._load_active_roles(
            owner_id=owner_id, folder_name=folder_name
        )

        if not roles:
            # Try without owner filter (for backward compat)
            roles = await self._load_active_roles(folder_name=folder_name)

        if not roles:
            logger.warning(f"No active role found for folder '{folder_name}'")
            return result

        role = roles[0]
        jd_text = jd_override or role.job_description

        if not jd_text:
            logger.warning(f"Role '{role.role_name}' has no JD — cannot score resumes")
            return result

        folder = self._resolve_folder(role)
        logger.info(f"Processing role: {role.role_name} → {folder}")

        jd_embedding = embed_text(jd_text)
        unprocessed  = self._get_unprocessed_resumes(folder)
        logger.info(f"  Found {len(unprocessed)} new resume(s)")

        processed_candidates = []
        async with self._session_factory() as session:
            for resume_path in unprocessed:
                cand = await self._process_resume(
                    resume_path, role, jd_embedding, session
                )
                if cand:
                    processed_candidates.append(cand)
                    result.total_resumes += 1
                else:
                    result.skipped += 1

        await self._rank_and_persist(role, processed_candidates)
        result.roles_processed.append(role.role_name)

        try:
            result.excel_path = generate_excel_report(
                {role.role_name: processed_candidates}
            )
        except Exception as exc:
            logger.error(f"Excel report failed: {exc}")

        logger.info(f"Pipeline complete: {result}")
        return result