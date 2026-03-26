"""
pipeline/jd_manager.py
──────────────────────
Manages the Job Description master Excel file (JD_Master.xlsx) and the
processed-resume registry (JSON file).
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from loguru import logger

from config import settings


# ── Column aliases ────────────────────────────────────────────────────────────

_COL_ROLE   = ["role name", "role"]
_COL_FOLDER = ["folder name", "folder"]
_COL_JD     = ["job description", "jd", "description"]
_COL_MUST   = ["must have skills", "must have", "required skills"]
_COL_NICE   = ["good to have skills", "good to have", "optional skills"]
_COL_EXP    = ["minimum experience", "min experience", "min exp", "experience"]
_COL_STATUS = ["status", "active"]


def _find_col(df: pd.DataFrame, aliases: list[str]) -> Optional[str]:
    lower_cols = {c.lower(): c for c in df.columns}
    for alias in aliases:
        if alias in lower_cols:
            return lower_cols[alias]
    return None


def _parse_skill_list(cell) -> list[str]:
    if not cell or isinstance(cell, float):
        return []
    parts = re.split(r"[,;|]", str(cell))
    return [p.strip() for p in parts if p.strip()]


# ── JD Manager ────────────────────────────────────────────────────────────────

class JDManager:
    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path or settings.JD_MASTER_PATH
        self._jds: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            logger.warning(f"JD_Master not found at {self._path}; starting empty.")
            return
        try:
            df = pd.read_excel(self._path, sheet_name=0)
            df.columns = df.columns.str.strip()

            col_role   = _find_col(df, _COL_ROLE)
            col_folder = _find_col(df, _COL_FOLDER)
            col_jd     = _find_col(df, _COL_JD)
            col_must   = _find_col(df, _COL_MUST)
            col_nice   = _find_col(df, _COL_NICE)
            col_exp    = _find_col(df, _COL_EXP)
            col_status = _find_col(df, _COL_STATUS)

            loaded = 0
            for _, row in df.iterrows():
                folder = str(row[col_folder]).strip() if col_folder else ""
                if not folder or folder.lower() in ("nan", ""):
                    continue
                status = str(row.get(col_status, "Active")).strip() if col_status else "Active"
                entry = {
                    "role_name":           str(row[col_role]).strip() if col_role else folder,
                    "folder_name":         folder,
                    "job_description":     str(row[col_jd]).strip() if col_jd else "",
                    "must_have_skills":    _parse_skill_list(row.get(col_must)) if col_must else [],
                    "good_to_have_skills": _parse_skill_list(row.get(col_nice)) if col_nice else [],
                    "minimum_experience":  int(row[col_exp]) if col_exp and str(row[col_exp]).isdigit() else 0,
                    "status":              status,
                }
                self._jds[folder] = entry
                loaded += 1

            logger.info(f"Loaded {loaded} JDs from {self._path}")
        except Exception as exc:
            logger.error(f"Failed to load JD_Master: {exc}")

    def get(self, folder_name: str) -> Optional[dict]:
        entry = self._jds.get(folder_name)
        if entry and entry.get("status", "Active").lower() == "active":
            return entry
        return None

    def all_active(self) -> list[dict]:
        return [e for e in self._jds.values() if e.get("status", "Active").lower() == "active"]

    def upsert(self, jd: dict) -> None:
        folder = jd["folder_name"]
        self._jds[folder] = {**self._jds.get(folder, {}), **jd}
        self._save()
        logger.info(f"Upserted JD for '{folder}'")

    def _save(self) -> None:
        rows = []
        for entry in self._jds.values():
            rows.append({
                "Role Name":           entry.get("role_name", ""),
                "Folder Name":         entry.get("folder_name", ""),
                "Job Description":     entry.get("job_description", ""),
                "Must Have Skills":    ", ".join(entry.get("must_have_skills") or []),
                "Good to Have Skills": ", ".join(entry.get("good_to_have_skills") or []),
                "Minimum Experience":  entry.get("minimum_experience", 0),
                "Status":              entry.get("status", "Active"),
            })
        df = pd.DataFrame(rows)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with pd.ExcelWriter(self._path, engine="openpyxl", mode="w") as writer:
            df.to_excel(writer, index=False, sheet_name="JD_Master")
        logger.info(f"JD_Master saved: {len(rows)} roles")

    def reload(self) -> None:
        self._jds.clear()
        self._load()


# ── Processed resume registry ─────────────────────────────────────────────────

class ProcessedRegistry:
    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path or settings.PROCESSED_REGISTRY_PATH
        self._registry: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                with open(self._path, "r") as f:
                    self._registry = json.load(f)
                logger.info(f"Registry loaded: {len(self._registry)} entries")
            except json.JSONDecodeError:
                logger.warning("Registry JSON corrupted; starting fresh.")
                self._registry = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._registry, f, indent=2)

    def is_processed(self, file_hash: str) -> bool:
        return file_hash in self._registry

    def mark_processed(self, file_name: str, role: str, file_hash: str) -> None:
        self._registry[file_hash] = {
            "file_name":    file_name,
            "role":         role,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        self._save()

    def count(self) -> int:
        return len(self._registry)


# ── File hashing ──────────────────────────────────────────────────────────────

def compute_file_hash(path: Path) -> str:
    """SHA-256 hash from a file path."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def compute_bytes_hash(content: bytes) -> str:
    """SHA-256 hash directly from bytes — used for uploaded files."""
    return hashlib.sha256(content).hexdigest()


# ── Singletons ────────────────────────────────────────────────────────────────

_jd_manager: Optional[JDManager] = None
_registry:   Optional[ProcessedRegistry] = None


def get_jd_manager() -> JDManager:
    global _jd_manager
    if _jd_manager is None:
        _jd_manager = JDManager()
    return _jd_manager


def get_registry() -> ProcessedRegistry:
    global _registry
    if _registry is None:
        _registry = ProcessedRegistry()
    return _registry