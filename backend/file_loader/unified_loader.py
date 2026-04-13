"""
file_loader/unified_loader.py — Unified interface for local and OneDrive sources.

Accepts a source descriptor dict:
  {"type": "local", "path": "/path/to/folder"}
  {"type": "onedrive_link", "links": ["https://1drv.ms/..."]}
  {"type": "onedrive_api", "folder_path": "/Resumes/SWE"}
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Iterator

from loguru import logger

from config import settings
from file_loader.local_loader import compute_file_hash, iter_resume_files
from file_loader.onedrive_loader import OneDriveGraphLoader, download_from_share_link


class UnifiedLoader:
    def __init__(self) -> None:
        self._cache_dir = settings.TEMP_DIR / "onedrive_cache"
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._registry = _load_registry()

    def load_files(self, source: dict) -> list[Path]:
        """
        Load resume files from the given source descriptor.
        Returns a list of local Paths (cached if remote).
        """
        source_type = source.get("type", "local")

        if source_type == "local":
            return self._load_local(source["path"])
        elif source_type == "onedrive_link":
            return self._load_onedrive_links(source.get("links", []))
        elif source_type == "onedrive_api":
            return self._load_onedrive_api(source.get("folder_path", "/"))
        else:
            raise ValueError(f"Unknown source type: {source_type}")

    def _load_local(self, folder_path: str) -> list[Path]:
        try:
            files = list(iter_resume_files(folder_path))
            logger.info(f"Local loader: found {len(files)} files in {folder_path}")
            return files
        except (FileNotFoundError, NotADirectoryError) as exc:
            logger.error(str(exc))
            raise

    def _load_onedrive_links(self, links: list[str]) -> list[Path]:
        paths = []
        for link in links:
            try:
                p = download_from_share_link(link, self._cache_dir)
                paths.append(p)
            except Exception as exc:
                logger.warning(f"Failed to download OneDrive link {link}: {exc}")
        logger.info(f"OneDrive links: downloaded {len(paths)}/{len(links)} files")
        return paths

    def _load_onedrive_api(self, folder_path: str) -> list[Path]:
        loader = OneDriveGraphLoader()
        paths = loader.download_folder(folder_path, self._cache_dir)
        logger.info(f"OneDrive API: downloaded {len(paths)} files from {folder_path}")
        return paths

    def filter_unprocessed(self, files: list[Path]) -> list[Path]:
        """Return only files not yet in the processed registry."""
        result = []
        for f in files:
            try:
                h = compute_file_hash(f)
            except Exception:
                continue
            if h not in self._registry:
                result.append(f)
            else:
                logger.debug(f"Skipping duplicate: {f.name}")
        return result

    def mark_processed(self, path: Path, file_hash: str) -> None:
        """Mark a file as processed in the registry."""
        import datetime
        self._registry[file_hash] = {
            "file_name": path.name,
            "hash": file_hash,
            "processed_timestamp": datetime.datetime.utcnow().isoformat(),
        }
        _save_registry(self._registry)

    def clear_cache(self) -> None:
        """Remove cached OneDrive files."""
        if self._cache_dir.exists():
            shutil.rmtree(self._cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)


# ── Registry helpers ──────────────────────────────────────────────────────────

def _load_registry() -> dict:
    path = settings.PROCESSED_REGISTRY_PATH
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_registry(registry: dict) -> None:
    path = settings.PROCESSED_REGISTRY_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(registry, f, indent=2)
