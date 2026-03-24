"""
pipeline/orchestrator.py
─────────────────────────
The central processing pipeline.  Runs folder-by-folder and coordinates:

  1. JD retrieval (JDManager)
  2. Duplicate check (ProcessedRegistry)
  3. Text extraction + NER (resume_parser)
  4. Embedding generation (embeddings)
  5. FAISS storage (vector_store)
  6. Semantic matching + scoring (scorer)
  7. DB persistence (async SQLAlchemy)
  8. Excel report generation (excel_reporter)

Usage
─────
    orch = PipelineOrchestrator()
    result = asyncio.run(orch.run_all())
    print(result)
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Optional

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import settings
from models.database import Base, Candidate, JobRole, ProcessingLog
from pipeline.embeddings import build_resume_text, cosine_similarity, embed_text
from pipeline.excel_reporter import generate_excel_report
from pipeline.jd_manager import compute_file_hash, get_jd_manager, get_registry
from pipeline.resume_parser import parse_resume
from pipeline.scorer import rank_candidates, score_candidate
from pipeline.vector_store import get_vector_store


# ── Pipeline result schema ────────────────────────────────────────────────────

class PipelineResult:
    def __init__(self) -> None:
        self.roles_processed: list[str] = []
        self.total_resumes: int = 0
        self.skipped: int = 0
        self.errors: int = 0
        self.excel_path: Optional[Path] = None

    def __repr__(self) -> str:
        return (
            f"roles={len(self.roles_processed)} | "
            f"processed={self.total_resumes} | "
            f"skipped={self.skipped} | "
            f"errors={self.errors}"
        )

    def to_dict(self) -> dict:
        return {
            "roles": len(self.roles_processed),
            "processed": self.total_resumes,
            "skipped": self.skipped,
            "errors": self.errors,
        }


# ── Orchestrator ──────────────────────────────────────────────────────────────

class PipelineOrchestrator:
    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc"}

    def __init__(self) -> None:
        self._jd = get_jd_manager()
        self._registry = get_registry()
        self._vector_store = get_vector_store()
        self._engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)
        self._session_factory = async_sessionmaker(
            self._engine, expire_on_commit=False
        )

    # ── Role discovery ────────────────────────────────────────────────────

    def _discover_role_folders(self) -> list[Path]:
        """
        Return only folders that have an active JD.
        Uses custom_folder_path from DB if set, otherwise defaults to
        Applications/<folder_name>.
        """
        active_jds = self._jd.all_active()
        folders: list[Path] = []

        for jd_entry in active_jds:
            # Use custom path if recruiter configured one, else default
            custom = jd_entry.get("custom_folder_path", "").strip()
            if custom:
                folder = Path(custom)
            else:
                folder = jd_entry["folder_name"]

            if folder.exists() and folder.is_dir():
                folders.append(folder)
            else:
                # Create the folder automatically if it doesn't exist
                folder.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created folder: {folder}")
                folders.append(folder)

        logger.info(
            f"Processing {len(folders)} active role folder(s): "
            f"{[f.name for f in folders]}"
        )
        return sorted(folders, key=lambda p: p.name)

    def _get_unprocessed_resumes(self, folder: Path) -> list[Path]:
        """Return resume files in a folder that haven't been processed yet."""
        files: list[Path] = []
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
                continue
            try:
                h = compute_file_hash(f)
            except Exception:
                continue
            if self._registry.is_processed(h):
                logger.debug(f"Skipping (already processed): {f.name}")
            else:
                files.append(f)
        return files

    # ── DB helpers ────────────────────────────────────────────────────────

    async def _get_or_create_role(
        self, session: AsyncSession, jd_entry: dict
    ) -> JobRole:
        from sqlalchemy import select
        stmt = select(JobRole).where(JobRole.folder_name == jd_entry["folder_name"])
        result = await session.execute(stmt)
        role = result.scalar_one_or_none()

        if role is None:
            role = JobRole(
                role_name=jd_entry["role_name"],
                folder_name=jd_entry["folder_name"],
                job_description=jd_entry.get("job_description"),
                must_have_skills=jd_entry.get("must_have_skills"),
                good_to_have_skills=jd_entry.get("good_to_have_skills"),
                minimum_experience=jd_entry.get("minimum_experience"),
                status=jd_entry.get("status", "Active"),
            )
            session.add(role)
            await session.flush()

        return role

    async def _persist_candidate(
        self,
        session: AsyncSession,
        role_id: uuid.UUID,
        parsed: dict,
        file_hash: str,
        scores: dict[str, float],
    ) -> Candidate:
        cand = Candidate(
            job_role_id=role_id,
            name=parsed.get("name"),
            email=parsed.get("email"),
            phone=parsed.get("phone"),
            skills=parsed.get("skills"),
            education=parsed.get("education"),
            experience_years=parsed.get("experience_years"),
            previous_companies=parsed.get("previous_companies"),
            certifications=parsed.get("certifications"),
            projects=parsed.get("projects"),
            raw_text=parsed.get("raw_text", "")[:20000],
            file_name=parsed["file_name"],
            file_hash=file_hash,
            file_path=parsed.get("file_path"),
            semantic_score=scores["semantic_score"],
            skill_score=scores["skill_score"],
            experience_score=scores["experience_score"],
            final_score=scores["final_score"],
            role_name=jd_entry.get("role_name", ""),
            folder_name=folder_name,
            parsed_data={
                "certifications": parsed.get("certifications"),
                "projects": parsed.get("projects"),
            },
        )
        session.add(cand)
        await session.flush()
        return cand

    async def _log_processing(
        self,
        session: AsyncSession,
        file_name: str,
        file_hash: str,
        role: str,
        status: str,
        error: Optional[str] = None,
    ) -> None:
        log = ProcessingLog(
            file_name=file_name,
            file_hash=file_hash,
            role=role,
            status=status,
            error_message=error,
        )
        session.add(log)

    # ── Single-resume processing ──────────────────────────────────────────

    async def _process_resume(
        self,
        session: AsyncSession,
        resume_path: Path,
        folder_name: str,
        jd_entry: dict,
        jd_embedding: "np.ndarray",  # type: ignore[name-defined]
    ) -> Optional[dict]:
        """
        Processes one resume end-to-end.
        Returns the candidate dict (with scores) or None on failure.
        """
        import numpy as np

        file_name = resume_path.name
        file_hash = compute_file_hash(resume_path)

        try:
            # 1. Parse
            parsed = parse_resume(resume_path)

            # 2. Embed
            resume_text = build_resume_text(parsed)
            resume_vec: np.ndarray = await asyncio.get_event_loop().run_in_executor(
                None, embed_text, resume_text
            )

            # 3. Semantic similarity
            sim = cosine_similarity(resume_vec, jd_embedding)

            # 4. Composite score
            scores = score_candidate(parsed, sim, jd_entry)

            # 5. Persist to DB
            role_obj = await self._get_or_create_role(session, jd_entry)
            cand_obj = await self._persist_candidate(
                session, role_obj.id, parsed, file_hash, scores
            )

            # 6. Store in FAISS
            self._vector_store.add_vector(
                role=folder_name,
                candidate_id=str(cand_obj.id),
                vector=resume_vec,
            )

            # 7. Update registry
            self._registry.mark_processed(file_name, folder_name, file_hash)

            # 8. Log
            await self._log_processing(session, file_name, file_hash, folder_name, "success")

            candidate_dict = {
                **parsed,
                **scores,
                "id": str(cand_obj.id),
                "folder_name": folder_name,
                "role_name": jd_entry["role_name"],
            }
            logger.info(
                f"  ✓ {file_name}: final_score={scores['final_score']:.3f} "
                f"(sem={scores['semantic_score']:.2f}, "
                f"skill={scores['skill_score']:.2f}, "
                f"exp={scores['experience_score']:.2f})"
            )
            return candidate_dict

        except Exception as exc:
            logger.error(f"  ✗ {file_name}: {exc}")
            await self._log_processing(
                session, file_name, file_hash, folder_name, "error", str(exc)
            )
            return None

    # ── Per-role processing ───────────────────────────────────────────────

    async def _process_role_folder(
        self, folder: Path
    ) -> tuple[str, list[dict]]:
        """Process all unprocessed resumes in one role folder."""
        folder_name = folder.name
        role_candidates: list[dict] = []

        jd_entry = self._jd.get(folder_name)
        if jd_entry is None:
            logger.warning(
                f"No active JD found for folder '{folder_name}' — skipping folder."
            )
            return folder_name, []

        logger.info(f"Processing role: {jd_entry['role_name']} ({folder_name})")

        # Pre-compute JD embedding (once per folder)
        jd_text = jd_entry.get("job_description", "") or ""
        if not jd_text.strip():
            jd_text = " ".join(
                (jd_entry.get("must_have_skills") or [])
                + (jd_entry.get("good_to_have_skills") or [])
            )

        jd_embedding = await asyncio.get_event_loop().run_in_executor(
            None, embed_text, jd_text
        )

        unprocessed = self._get_unprocessed_resumes(folder)
        logger.info(f"  {len(unprocessed)} unprocessed resume(s) found.")

        if not unprocessed:
            return folder_name, []

        async with self._session_factory() as session:
            for resume_path in unprocessed:
                result = await self._process_resume(
                    session, resume_path, folder_name, jd_entry, jd_embedding
                )
                if result:
                    role_candidates.append(result)
            await session.commit()

        # Rank the newly processed candidates (plus previously processed in DB)
        ranked = rank_candidates(role_candidates)

        # Persist ranks back to DB
        async with self._session_factory() as session:
            for cand_dict in ranked:
                from sqlalchemy import update
                import uuid as _uuid
                cand_id = cand_dict.get("id")
                rank_val = cand_dict.get("rank")
                if cand_id and rank_val:
                    await session.execute(
                        update(Candidate)
                        .where(Candidate.id == _uuid.UUID(cand_id))
                        .values(rank=rank_val)
                    )
            await session.commit()

        return folder_name, ranked

    # ── Public entry point ────────────────────────────────────────────────

    async def run_all(self, generate_report: bool = True) -> PipelineResult:
        """
        Process all role folders and optionally generate the Excel report.
        This is the main entry point for the automated pipeline.
        """
        result = PipelineResult()
        folders = self._discover_role_folders()

        if not folders:
            logger.warning("No role folders found.  Nothing to process.")
            return result

        all_role_candidates: dict[str, list[dict]] = {}

        for folder in folders:
            role_name, candidates = await self._process_role_folder(folder)
            result.roles_processed.append(role_name)
            result.total_resumes += len(candidates)
            if candidates:
                all_role_candidates[role_name] = candidates

        if generate_report and all_role_candidates:
            result.excel_path = generate_excel_report(all_role_candidates)

        logger.info(
            f"Pipeline complete: {result.total_resumes} resumes processed "
            f"across {len(result.roles_processed)} roles."
        )
        return result

    async def run_role(
        self,
        folder_name: str,
        generate_report: bool = True,
    ) -> tuple[str, list[dict]]:
        """Process a single role folder on demand."""
        folder = settings.APPLICATIONS_DIR / folder_name
        if not folder.exists():
            raise FileNotFoundError(f"Role folder not found: {folder}")
        role_name, candidates = await self._process_role_folder(folder)
        if generate_report and candidates:
            generate_excel_report({role_name: candidates})
        return role_name, candidates