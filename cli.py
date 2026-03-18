#!/usr/bin/env python3
"""
cli.py — Command-line interface for the AI-ATS system.

Usage
─────
  # Run the full processing pipeline
  python cli.py run

  # Process a single role
  python cli.py run --role AI_Engineer

  # Seed an example JD_Master.xlsx
  python cli.py seed-jd

  # Create a first recruiter user
  python cli.py create-user --email admin@company.com --password secret123

  # Show pipeline status summary
  python cli.py status
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


def cmd_run(args):
    from pipeline.orchestrator import PipelineOrchestrator
    orch = PipelineOrchestrator()
    if args.role:
        result = asyncio.run(orch.run_role(args.role))
        print(f"✓ Role '{result[0]}': {len(result[1])} candidates processed.")
    else:
        result = asyncio.run(orch.run_all())
        print(result)
        if result.excel_path:
            print(f"✓ Excel report → {result.excel_path}")


def cmd_seed_jd(_args):
    """Create a sample JD_Master.xlsx with 5 roles."""
    import pandas as pd
    from config import settings

    data = [
        {
            "Role Name": "AI Engineer",
            "Folder Name": "AI_Engineer",
            "Job Description": (
                "We are looking for an AI Engineer with strong hands-on experience "
                "in building production LLM applications, NLP pipelines, and RAG systems. "
                "The candidate should be proficient in Python, FastAPI, and vector databases. "
                "Experience with cloud deployment (AWS/GCP/Azure) is highly desirable."
            ),
            "Must Have Skills": "Python, NLP, LLM, FastAPI, Vector Database",
            "Good to Have Skills": "Docker, AWS, LangChain, RAG",
            "Minimum Experience": 2,
            "Status": "Active",
        },
        {
            "Role Name": "Data Scientist",
            "Folder Name": "Data_Scientist",
            "Job Description": (
                "We seek a Data Scientist experienced in statistical modelling, machine learning, "
                "and data storytelling. The ideal candidate has strong Python skills, experience "
                "with Scikit-learn, XGBoost, and can communicate insights to business stakeholders."
            ),
            "Must Have Skills": "Python, Machine Learning, SQL, Scikit-learn, Statistics",
            "Good to Have Skills": "Deep Learning, TensorFlow, Tableau",
            "Minimum Experience": 1,
            "Status": "Active",
        },
        {
            "Role Name": "ML Engineer",
            "Folder Name": "ML_Engineer",
            "Job Description": (
                "ML Engineer to build, train, and deploy machine learning models at scale. "
                "Strong Python and cloud skills required. Experience with MLflow, Kubernetes, "
                "and model serving frameworks (TorchServe, Triton) preferred."
            ),
            "Must Have Skills": "Python, PyTorch, MLflow, Kubernetes, Docker",
            "Good to Have Skills": "Triton, AWS SageMaker, Spark",
            "Minimum Experience": 2,
            "Status": "Active",
        },
        {
            "Role Name": "Backend Developer",
            "Folder Name": "Backend_Developer",
            "Job Description": (
                "Backend Developer to build scalable REST APIs and microservices. "
                "Experience with Python (FastAPI/Django) or Node.js. "
                "Strong database skills (PostgreSQL, Redis). CI/CD, Docker experience required."
            ),
            "Must Have Skills": "Python, FastAPI, PostgreSQL, Docker, REST API",
            "Good to Have Skills": "Redis, Kafka, Kubernetes, Go",
            "Minimum Experience": 2,
            "Status": "Active",
        },
        {
            "Role Name": "Frontend Developer",
            "Folder Name": "Frontend_Developer",
            "Job Description": (
                "Frontend Developer to build modern web UIs using React. "
                "Proficient in TypeScript, Tailwind CSS, and state management. "
                "Experience with testing (Jest, Cypress) and CI/CD pipelines."
            ),
            "Must Have Skills": "React, TypeScript, HTML, CSS, JavaScript",
            "Good to Have Skills": "Next.js, Tailwind, Jest, GraphQL",
            "Minimum Experience": 1,
            "Status": "Active",
        },
    ]

    df = pd.DataFrame(data)
    out = settings.JD_MASTER_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="JD_Master")

    print(f"✓ JD_Master.xlsx created at {out} with {len(data)} roles.")

    # Also create the folder structure
    for entry in data:
        folder = settings.APPLICATIONS_DIR / entry["Folder Name"]
        folder.mkdir(parents=True, exist_ok=True)
    print(f"✓ Application folders created under {settings.APPLICATIONS_DIR}/")


async def _create_user_async(email: str, password: str):
    from passlib.context import CryptContext
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from config import settings
    from models.database import Base, User

    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async with SessionLocal() as session:
        from sqlalchemy import select
        existing = await session.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            print(f"User {email} already exists.")
            return
        user = User(email=email, hashed_password=pwd_ctx.hash(password), is_superuser=True)
        session.add(user)
        await session.commit()
        print(f"✓ User created: {email}")

    await engine.dispose()


def cmd_create_user(args):
    asyncio.run(_create_user_async(args.email, args.password))


def cmd_status(_args):
    from config import settings
    from pipeline.jd_manager import get_jd_manager, get_registry

    print("\n── AI-ATS System Status ──────────────────────────────")
    print(f"  Applications dir : {settings.APPLICATIONS_DIR}")
    print(f"  JD Master        : {settings.JD_MASTER_PATH} ({'✓' if settings.JD_MASTER_PATH.exists() else '✗ missing'})")
    print(f"  FAISS indices    : {settings.FAISS_INDEX_DIR}")
    print(f"  Excel output     : {settings.CANDIDATE_RANKING_OUTPUT}")

    print("\n── Job Roles ─────────────────────────────────────────")
    jd = get_jd_manager()
    for role in jd.all_active():
        folder = settings.APPLICATIONS_DIR / role["folder_name"]
        n = len(list(folder.glob("*.pdf")) + list(folder.glob("*.docx"))) if folder.exists() else 0
        print(f"  {role['role_name']:<28} {n} resume(s) in folder")

    reg = get_registry()
    print(f"\n── Registry ──────────────────────────────────────────")
    print(f"  Processed resumes: {reg.count()}")
    print()


# ── Argument parsing ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AI-ATS Pipeline CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command")

    # run
    p_run = sub.add_parser("run", help="Run the processing pipeline")
    p_run.add_argument("--role", type=str, default=None, help="Process a specific role folder only")

    # seed-jd
    sub.add_parser("seed-jd", help="Create a sample JD_Master.xlsx")

    # create-user
    p_user = sub.add_parser("create-user", help="Create a recruiter user account")
    p_user.add_argument("--email", required=True)
    p_user.add_argument("--password", required=True)

    # status
    sub.add_parser("status", help="Show system status")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "seed-jd":
        cmd_seed_jd(args)
    elif args.command == "create-user":
        cmd_create_user(args)
    elif args.command == "status":
        cmd_status(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
