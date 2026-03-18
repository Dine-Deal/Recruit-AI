"""
models/database.py — Neon PostgreSQL only
"""

from __future__ import annotations

import ssl as _ssl
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.ext.asyncio import (
    AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from config import settings

# ── Engine ────────────────────────────────────────────────────────────────────
# DATABASE_URL must be the pooler endpoint:
# postgresql+asyncpg://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname
# No ?sslmode or &channel_binding in the URL — SSL handled via connect_args

_ssl_ctx = _ssl.create_default_context()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=3,
    max_overflow=2,
    pool_timeout=30,
    pool_recycle=600,
    pool_pre_ping=True,
    connect_args={
        "ssl": _ssl_ctx,
        "timeout": 30,
        "command_timeout": 30,
        "server_settings": {"application_name": "ats_system"},
    },
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


class Base(AsyncAttrs, DeclarativeBase):
    pass


class JobRole(Base):
    __tablename__ = "job_roles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role_name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    folder_name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    job_description: Mapped[Optional[str]] = mapped_column(Text)
    must_have_skills: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    good_to_have_skills: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    minimum_experience: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="Active")
    custom_folder_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="job_role", passive_deletes=True,
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_role_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_roles.id", ondelete="SET NULL"), nullable=True,
    )
    name: Mapped[Optional[str]] = mapped_column(String(300))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    skills: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    education: Mapped[Optional[str]] = mapped_column(Text)
    experience_years: Mapped[Optional[float]] = mapped_column(Float)
    previous_companies: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    certifications: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    projects: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String))
    raw_text: Mapped[Optional[str]] = mapped_column(Text)
    role_name: Mapped[Optional[str]] = mapped_column(String(200))
    folder_name: Mapped[Optional[str]] = mapped_column(String(200))
    semantic_score: Mapped[Optional[float]] = mapped_column(Float)
    skill_score: Mapped[Optional[float]] = mapped_column(Float)
    experience_score: Mapped[Optional[float]] = mapped_column(Float)
    final_score: Mapped[Optional[float]] = mapped_column(Float)
    rank: Mapped[Optional[int]] = mapped_column(Integer)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(1000))
    parsed_data: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    job_role: Mapped[Optional["JobRole"]] = relationship(back_populates="candidates")

    __table_args__ = (
        UniqueConstraint("folder_name", "file_hash", name="uq_candidate_folder_hash"),
    )


class ProcessingLog(Base):
    __tablename__ = "processing_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(500))
    file_hash: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())