"""
api/routes.py — All FastAPI route definitions for the ATS system.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from loguru import logger
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.database import Candidate, JobRole, User, get_db
from pipeline.jd_manager import get_jd_manager
from pipeline.orchestrator import PipelineOrchestrator, UploadedFile


# ── Security ──────────────────────────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


def create_access_token(sub: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    data = {"sub": sub, "exp": expire}
    return jwt.encode(
        data,
        settings.SECRET_KEY.get_secret_value(),
        algorithm=settings.ALGORITHM,
    )


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[settings.ALGORITHM],
        )
        email: str = payload.get("sub")
        if not email:
            raise cred_exc
    except JWTError:
        raise cred_exc

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise cred_exc
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class JobRoleIn(BaseModel):
    role_name: str
    folder_name: str
    job_description: Optional[str] = None
    must_have_skills: Optional[list[str]] = None
    good_to_have_skills: Optional[list[str]] = None
    minimum_experience: Optional[int] = 0
    status: str = "Active"
    custom_folder_path: Optional[str] = None


class JobRoleOut(BaseModel):
    id: uuid.UUID
    role_name: str
    folder_name: str
    job_description: Optional[str]
    must_have_skills: Optional[list[str]]
    good_to_have_skills: Optional[list[str]]
    minimum_experience: Optional[int]
    status: str
    custom_folder_path: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CandidateOut(BaseModel):
    id: uuid.UUID
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    skills: Optional[list[str]]
    education: Optional[str]
    experience_years: Optional[float]
    previous_companies: Optional[list[str]]
    certifications: Optional[list[str]]
    semantic_score: Optional[float]
    skill_score: Optional[float]
    experience_score: Optional[float]
    final_score: Optional[float]
    rank: Optional[int]
    file_name: str
    file_path: Optional[str]
    role_name: Optional[str]
    folder_name: Optional[str]
    processed_at: datetime

    class Config:
        from_attributes = True


class PipelineStatusOut(BaseModel):
    status: str
    message: str


# ── Auth ──────────────────────────────────────────────────────────────────────

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: DB) -> dict:
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user = User(
        email=payload.email,
        hashed_password=pwd_context.hash(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    await db.commit()
    return {"message": "User created", "email": payload.email}


@auth_router.post("/token", response_model=TokenOut)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DB,
) -> TokenOut:
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not pwd_context.verify(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    token = create_access_token(user.email)
    return TokenOut(access_token=token)


# ── Roles ─────────────────────────────────────────────────────────────────────

roles_router = APIRouter(prefix="/roles", tags=["roles"])


@roles_router.get("/", response_model=list[JobRoleOut])
async def list_roles(db: DB, user: CurrentUser) -> list[JobRole]:
    result = await db.execute(
        select(JobRole).where(JobRole.owner_id == user.id).order_by(JobRole.role_name)
    )
    return result.scalars().all()


@roles_router.get("/{role_id}", response_model=JobRoleOut)
async def get_role(role_id: uuid.UUID, db: DB, user: CurrentUser) -> JobRole:
    result = await db.execute(select(JobRole).where(JobRole.id == role_id, JobRole.owner_id == user.id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")
    return role


@roles_router.post("/", response_model=JobRoleOut, status_code=201)
async def create_role(payload: JobRoleIn, db: DB, user: CurrentUser) -> JobRole:
    existing = await db.execute(
        select(JobRole).where(
            JobRole.folder_name == payload.folder_name,
            JobRole.owner_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            400,
            f"A role with folder_name '{payload.folder_name}' already exists. "
            "Use Edit to update it instead.",
        )
    role = JobRole(**payload.model_dump(), owner_id=user.id)
    db.add(role)
    await db.commit()
    await db.refresh(role)
    get_jd_manager().upsert(payload.model_dump())
    return role


@roles_router.put("/{role_id}", response_model=JobRoleOut)
async def update_role(
    role_id: uuid.UUID, payload: JobRoleIn, db: DB, user: CurrentUser
) -> JobRole:
    result = await db.execute(select(JobRole).where(JobRole.id == role_id, JobRole.owner_id == user.id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")
    role.role_name           = payload.role_name
    role.job_description     = payload.job_description
    role.must_have_skills    = payload.must_have_skills
    role.good_to_have_skills = payload.good_to_have_skills
    role.minimum_experience  = payload.minimum_experience
    role.status              = payload.status
    await db.commit()
    await db.refresh(role)
    get_jd_manager().upsert(payload.model_dump())
    logger.info(f"Role '{role.role_name}' updated — candidates preserved.")
    return role


@roles_router.delete("/{role_id}")
async def delete_role(
    role_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    delete_candidates: bool = Query(default=False),
) -> Response:
    result = await db.execute(select(JobRole).where(JobRole.id == role_id, JobRole.owner_id == user.id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")
    count_result = await db.execute(
        select(func.count(Candidate.id)).where(Candidate.job_role_id == role_id)
    )
    candidate_count = count_result.scalar() or 0
    if delete_candidates and candidate_count > 0:
        cands = await db.execute(select(Candidate).where(Candidate.job_role_id == role_id))
        for cand in cands.scalars().all():
            await db.delete(cand)
        logger.warning(f"Deleted {candidate_count} candidates for role '{role.role_name}'")
    else:
        logger.info(f"Role '{role.role_name}' deleted — {candidate_count} candidate(s) preserved.")
    await db.delete(role)
    await db.commit()
    return Response(status_code=204)


# ── Candidates ────────────────────────────────────────────────────────────────

candidates_router = APIRouter(prefix="/candidates", tags=["candidates"])


@candidates_router.get("/", response_model=list[CandidateOut])
async def list_candidates(
    db: DB,
    user: CurrentUser,
    role_id: Optional[uuid.UUID] = None,
    min_score: float = Query(default=0.0, ge=0, le=1),
    min_experience: float = Query(default=0.0, ge=0),
    skills: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Candidate]:
    stmt = (
        select(Candidate)
        .join(JobRole, Candidate.job_role_id == JobRole.id)
        .where(JobRole.owner_id == user.id)
        .order_by(Candidate.final_score.desc())
    )
    if role_id:
        stmt = stmt.where(Candidate.job_role_id == role_id)
    if min_score > 0:
        stmt = stmt.where(Candidate.final_score >= min_score)
    if min_experience > 0:
        stmt = stmt.where(Candidate.experience_years >= min_experience)
    if skills:
        skill_list = [s.strip().lower() for s in skills.split(",")]
        for skill in skill_list:
            stmt = stmt.where(
                func.lower(func.array_to_string(Candidate.skills, " ")).contains(skill)
            )
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@candidates_router.get("/{candidate_id}", response_model=CandidateOut)
async def get_candidate(candidate_id: uuid.UUID, db: DB, _: CurrentUser) -> Candidate:
    result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = result.scalar_one_or_none()
    if not cand:
        raise HTTPException(404, "Candidate not found")
    return cand


@candidates_router.get("/{candidate_id}/download")
async def download_resume(
    candidate_id: uuid.UUID, db: DB, _: CurrentUser
) -> FileResponse:
    result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = result.scalar_one_or_none()
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not cand.file_path or not Path(cand.file_path).exists():
        raise HTTPException(404, "Resume file not found on disk")
    return FileResponse(
        path=cand.file_path,
        filename=cand.file_name,
        media_type="application/octet-stream",
    )


# ── Pipeline ──────────────────────────────────────────────────────────────────

pipeline_router = APIRouter(prefix="/pipeline", tags=["pipeline"])
_pipeline_status: dict = {"running": False, "last_run": None, "last_result": None}


async def _run_pipeline_bg(
    uploaded_files: list[UploadedFile],
    jd_text:        Optional[str],
    role:           Optional[str],
    owner_id:       uuid.UUID,
) -> None:
    try:
        orch   = PipelineOrchestrator()
        result = await orch.run_with_files(
            uploaded_files  = uploaded_files,
            jd_text         = jd_text,
            folder_name     = role,
            owner_id        = owner_id,
            generate_report = True,
        )
        _pipeline_status["last_result"] = result.to_dict()
        _pipeline_status["last_run"]    = datetime.now(timezone.utc).isoformat()
        logger.info(f"Pipeline complete: {result}")
    except Exception as exc:
        logger.error(f"Pipeline background run failed: {exc}")
        _pipeline_status["last_result"] = f"Error: {exc}"
    finally:
        _pipeline_status["running"] = False


@pipeline_router.post("/run", response_model=PipelineStatusOut)
async def trigger_pipeline(
    background_tasks: BackgroundTasks,
    current_user:     CurrentUser,
    files:    List[UploadFile]     = File(...),
    jd_text:  Optional[str]        = Form(None),
    jd_file:  Optional[UploadFile] = File(None),
    role:     Optional[str]        = Form(None),
) -> PipelineStatusOut:
    if _pipeline_status["running"]:
        raise HTTPException(409, "Pipeline is already running")

    # Read all file bytes eagerly before handing to background task
    uploaded: list[UploadedFile] = []
    for f in files:
        content = await f.read()
        uploaded.append(UploadedFile(filename=f.filename or "resume", content=content))

    # Read JD file bytes if provided
    jd_text_resolved = jd_text
    if not jd_text_resolved and jd_file:
        jd_bytes  = await jd_file.read()
        jd_suffix = Path(jd_file.filename or "jd.pdf").suffix.lower()
        try:
            from pipeline.resume_parser import parse_resume_bytes
            jd_parsed        = parse_resume_bytes(jd_bytes, jd_suffix, jd_file.filename or "jd")
            jd_text_resolved = jd_parsed.get("raw_text", "")
        except Exception as exc:
            logger.warning(f"Could not parse JD file: {exc}")

    _pipeline_status["running"] = True
    background_tasks.add_task(
        _run_pipeline_bg,
        uploaded,
        jd_text_resolved,
        role,
        current_user.id,
    )

    return PipelineStatusOut(
        status  = "started",
        message = f"Processing {len(uploaded)} resume(s) for role={role or 'ALL'}",
    )


@pipeline_router.get("/status", response_model=dict)
async def pipeline_status(_: CurrentUser) -> dict:
    return _pipeline_status


# ── Reports ───────────────────────────────────────────────────────────────────

reports_router = APIRouter(prefix="/reports", tags=["reports"])


@reports_router.get("/download")
async def download_report(_: CurrentUser) -> FileResponse:
    path = settings.CANDIDATE_RANKING_OUTPUT
    if not path.exists():
        raise HTTPException(404, "Report not yet generated — run the pipeline first.")
    return FileResponse(
        path     = str(path),
        filename = "Candidate_Ranking.xlsx",
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ── Upload ────────────────────────────────────────────────────────────────────

upload_router = APIRouter(prefix="/upload", tags=["upload"])


@upload_router.post("/resume", status_code=201)
async def upload_resume(
    _: CurrentUser,
    file: UploadFile = File(...),
    role_folder: str = Form(...),
) -> dict:
    allowed_ext = {".pdf", ".docx", ".doc"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed_ext:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    dest_dir = settings.APPLICATIONS_DIR / role_folder
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest    = dest_dir / (file.filename or "resume" + ext)
    content = await file.read()
    dest.write_bytes(content)
    return {"message": "Resume uploaded", "path": str(dest), "role": role_folder}