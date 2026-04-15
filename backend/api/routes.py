"""
api/routes.py — FastAPI route definitions.

Endpoints:
  POST /run-pipeline              — Start pipeline job; returns job_id immediately
  GET  /job-status/{job_id}       — Poll for result (pending | done | error)
  GET  /download-resume/{filename} — Serve a resume file for download

Why background jobs?
  Render's free-tier HTTP proxy drops connections idle for >60 seconds.
  The pipeline takes 3-5 minutes for 6 resumes, so a direct await would
  always be killed by the proxy before the response arrives.
  Solution: return a job_id immediately, let the frontend poll every 3s.
"""
from __future__ import annotations

import asyncio
import tempfile
import uuid
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel

from config import settings
from pipeline.jd_parser import extract_jd_text
from pipeline.orchestrator import PipelineOrchestrator

router = APIRouter()

# ── In-memory stores ──────────────────────────────────────────────────────────

# File paths for download (keyed by filename)
_file_registry: dict[str, str] = {}

# Job store: job_id → {"status": "pending"|"done"|"error", "result": ..., "error": ...}
_jobs: dict[str, dict] = {}


# ── Request / Response schemas ────────────────────────────────────────────────

class CandidateResult(BaseModel):
    rank: int
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    skills: list[str]
    experience_years: Optional[float]
    education: Optional[str]
    education_detail: list[dict] = []
    previous_companies: list[str]
    certifications: list[str]
    semantic_score: float
    skill_score: float
    experience_score: float
    final_score: float
    file_name: str
    file_path: Optional[str]


class PipelineResponse(BaseModel):
    success: bool
    message: str
    total_processed: int
    candidates: list[CandidateResult]


class JobStarted(BaseModel):
    job_id: str
    status: str  # always "pending" on creation


class JobStatus(BaseModel):
    job_id: str
    status: str  # "pending" | "done" | "error"
    result: Optional[PipelineResponse] = None
    error: Optional[str] = None


# ── Background worker ─────────────────────────────────────────────────────────

def _serialize_candidates(candidates: list[dict]) -> list[CandidateResult]:
    results = []
    for c in candidates:
        edu_raw = c.get("education") or []
        edu_display = c.get("education_display") or (
            edu_raw if isinstance(edu_raw, str)
            else " | ".join(e.get("display", "") for e in edu_raw if isinstance(e, dict))
        )
        edu_detail = edu_raw if isinstance(edu_raw, list) else []

        # Register for download
        fp = c.get("file_path")
        fn = c.get("file_name")
        if fp and fn:
            _file_registry[fn] = fp

        results.append(
            CandidateResult(
                rank=c.get("rank", 0),
                name=c.get("name"),
                email=c.get("email"),
                phone=c.get("phone"),
                skills=c.get("skills") or [],
                experience_years=c.get("experience_years"),
                education=edu_display,
                education_detail=edu_detail,
                previous_companies=c.get("previous_companies") or [],
                certifications=c.get("certifications") or [],
                semantic_score=c.get("semantic_score", 0.0),
                skill_score=c.get("skill_score", 0.0),
                experience_score=c.get("experience_score", 0.0),
                final_score=c.get("final_score", 0.0),
                file_name=c.get("file_name", ""),
                file_path=c.get("file_path"),
            )
        )
    return results


async def _run_pipeline_job(job_id: str, jd_text: str, source: dict) -> None:
    """Background coroutine that runs the pipeline and stores the result in _jobs."""
    try:
        orch = PipelineOrchestrator()
        candidates = await orch.run(jd_text=jd_text, source=source)
        results = _serialize_candidates(candidates)
        _jobs[job_id] = {
            "status": "done",
            "result": PipelineResponse(
                success=True,
                message=f"Pipeline completed. Top {len(results)} candidates ranked.",
                total_processed=len(candidates),
                candidates=results,
            ),
        }
        logger.info(f"Job {job_id} completed with {len(results)} candidates.")
    except Exception as exc:
        logger.exception(f"Job {job_id} failed: {exc}")
        _jobs[job_id] = {"status": "error", "error": str(exc)}


# ── POST /run-pipeline ────────────────────────────────────────────────────────

@router.post("/run-pipeline", response_model=JobStarted)
async def run_pipeline(
    background_tasks: BackgroundTasks,
    # JD inputs (one of: file OR text)
    jd_file: Optional[UploadFile] = File(default=None),
    jd_text: Optional[str] = Form(default=None),
    # Resume source inputs
    source_type: str = Form(...),
    resume_files: List[UploadFile] = File(default=[]),
    onedrive_links: Optional[str] = Form(default=None),
    onedrive_folder: Optional[str] = Form(default=None),
):
    """
    Start the screening pipeline as a background job.
    Returns immediately with a job_id.
    Poll GET /job-status/{job_id} for progress and results.
    """
    # ── 1. Extract JD text ────────────────────────────────────────────────────
    resolved_jd_text = ""

    if jd_file and jd_file.filename:
        suffix = Path(jd_file.filename).suffix.lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await jd_file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)
        try:
            resolved_jd_text = extract_jd_text(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)
    elif jd_text and jd_text.strip():
        resolved_jd_text = jd_text.strip()

    if not resolved_jd_text:
        raise HTTPException(
            status_code=400,
            detail="Provide either a JD file or paste JD text.",
        )

    # ── 2. Build source descriptor ────────────────────────────────────────────
    if source_type == "local":
        if not resume_files:
            raise HTTPException(400, "resume_files is required for source_type=local")

        temp_dir = tempfile.mkdtemp(dir=settings.TEMP_DIR)
        temp_folder = Path(temp_dir)
        for rf in resume_files:
            if rf.filename:
                file_path = temp_folder / rf.filename
                file_path.parent.mkdir(parents=True, exist_ok=True)
                content = await rf.read()
                file_path.write_bytes(content)

        source = {"type": "local", "path": str(temp_folder)}

    elif source_type == "onedrive_link":
        if not onedrive_links:
            raise HTTPException(400, "onedrive_links is required for source_type=onedrive_link")
        links = [l.strip() for l in onedrive_links.split(",") if l.strip()]
        source = {"type": "onedrive_link", "links": links}

    elif source_type == "onedrive_api":
        source = {"type": "onedrive_api", "folder_path": onedrive_folder or "/"}

    else:
        raise HTTPException(400, f"Unknown source_type: {source_type}")

    # ── 3. Start background job ───────────────────────────────────────────────
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "pending"}
    background_tasks.add_task(
        asyncio.ensure_future,
        _run_pipeline_job(job_id, resolved_jd_text, source),
    )
    logger.info(f"Job {job_id} queued for source: {source_type}")
    return JobStarted(job_id=job_id, status="pending")


# ── GET /job-status/{job_id} ──────────────────────────────────────────────────

@router.get("/job-status/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    """Poll this endpoint every 3 seconds until status is 'done' or 'error'."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"Job '{job_id}' not found.")

    return JobStatus(
        job_id=job_id,
        status=job["status"],
        result=job.get("result"),
        error=job.get("error"),
    )


# ── GET /download-resume ──────────────────────────────────────────────────────

@router.get("/download-resume/{filename}")
async def download_resume(filename: str):
    """Download a resume file by filename."""
    file_path = _file_registry.get(filename)

    if not file_path:
        raise HTTPException(404, f"Resume '{filename}' not found. Run the pipeline first.")

    path = Path(file_path)
    if not path.exists():
        raise HTTPException(404, f"File no longer available on disk: {filename}")

    media_type = "application/pdf" if filename.lower().endswith(".pdf") else "application/octet-stream"
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type=media_type,
    )