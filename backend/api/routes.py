"""
api/routes.py — FastAPI route definitions.

Endpoints:
  POST /run-pipeline              — Accept JD + resume source, run pipeline, return Top 5
  GET  /download-resume/{filename} — Serve a resume file for download

Changes from original:
  - Removed must_have_skills, good_to_have_skills, minimum_experience Form params
  - Removed _split() helper (no longer needed)
  - Orchestrator.run() called without skill hint args
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel

from config import settings
from pipeline.jd_parser import extract_jd_text
from pipeline.orchestrator import PipelineOrchestrator

router = APIRouter()

# In-memory store for file paths during session (keyed by filename)
_file_registry: dict[str, str] = {}


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


# ── /run-pipeline ─────────────────────────────────────────────────────────────

@router.post("/run-pipeline", response_model=PipelineResponse)
async def run_pipeline(
    # JD inputs (one of: file OR text)
    jd_file: Optional[UploadFile] = File(default=None),
    jd_text: Optional[str] = Form(default=None),

    # Resume source inputs
    source_type: str = Form(...),           # "local" | "onedrive_link" | "onedrive_api"
    resume_files: List[UploadFile] = File(default=[]),
    onedrive_links: Optional[str] = Form(default=None),   # comma-separated URLs
    onedrive_folder: Optional[str] = Form(default=None),
):
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
        
        # Save uploaded files to a temp directory
        temp_dir = tempfile.mkdtemp(dir=settings.TEMP_DIR)
        temp_folder = Path(temp_dir)
        for rf in resume_files:
            if rf.filename:
                # rf.filename from webkitdirectory might include subfolders: "Dir/subdir/file.pdf"
                file_path = temp_folder / rf.filename
                file_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Use write_bytes for simplicity since we await read()
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

    # ── 3. Run pipeline ───────────────────────────────────────────────────────
    try:
        orch = PipelineOrchestrator()
        candidates = await orch.run(
            jd_text=resolved_jd_text,
            source=source,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        logger.exception("Pipeline failed")
        raise HTTPException(500, f"Pipeline error: {exc}")

    # ── 4. Register file paths for download ───────────────────────────────────
    for cand in candidates:
        fp = cand.get("file_path")
        fn = cand.get("file_name")
        if fp and fn:
            _file_registry[fn] = fp

    # ── 5. Serialize results ──────────────────────────────────────────────────
    results = []
    for c in candidates:
        # education may be list of dicts (v3 parser) or plain string (legacy)
        edu_raw = c.get("education") or []
        edu_display = c.get("education_display") or (
            edu_raw if isinstance(edu_raw, str)
            else " | ".join(e.get("display", "") for e in edu_raw if isinstance(e, dict))
        )
        edu_detail = edu_raw if isinstance(edu_raw, list) else []

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

    return PipelineResponse(
        success=True,
        message=f"Pipeline completed. Top {len(results)} candidates ranked.",
        total_processed=len(candidates),
        candidates=results,
    )


# ── /download-resume ──────────────────────────────────────────────────────────

@router.get("/download-resume/{filename}")
async def download_resume(filename: str):
    """
    Download a resume file by filename.
    For local files: serves directly.
    For OneDrive cached files: serves from temp cache.
    """
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