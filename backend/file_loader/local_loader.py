"""
file_loader/local_loader.py — Load resumes from a local folder path.
Supports PDF and DOCX files.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterator

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc"}


def iter_resume_files(folder_path: str | Path) -> Iterator[Path]:
    """Yield all supported resume files from a folder (non-recursive)."""
    folder = Path(folder_path)
    if not folder.exists():
        raise FileNotFoundError(f"Folder not found: {folder}")
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a directory: {folder}")

    for f in sorted(folder.rglob("*")):
        if f.suffix.lower() in SUPPORTED_EXTENSIONS and f.is_file():
            yield f


def compute_file_hash(path: Path) -> str:
    """SHA-256 hash of file contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
