"""
file_loader/onedrive_loader.py — Fetch resumes from OneDrive.

Supports:
  1. Public share links (e.g. https://1drv.ms/... or SharePoint share links)
  2. Microsoft Graph API with OAuth2 client credentials
"""
from __future__ import annotations

import base64
import os
import re
import tempfile
from pathlib import Path
from typing import Iterator
from urllib.parse import urlencode

import requests
from loguru import logger

from config import settings

# Regex to detect direct download or sharing links
_ONEDRIVE_SHARE_RE = re.compile(
    r"https?://(?:1drv\.ms|onedrive\.live\.com|.*sharepoint\.com).*",
    re.IGNORECASE,
)

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc"}


# ── Public share link downloader ──────────────────────────────────────────────

def _share_link_to_download_url(share_url: str) -> str:
    """
    Convert a OneDrive/SharePoint share link to a direct download URL.
    For 1drv.ms short links, encode as base64u and use Graph API.
    """
    # Try direct download URL (SharePoint embed or download link already)
    if "download=1" in share_url or "?e=" in share_url:
        return share_url

    # Encode for Graph API sharing URL pattern
    # https://docs.microsoft.com/en-us/graph/api/shares-get
    encoded = base64.b64encode(share_url.encode()).decode()
    # Convert base64 to base64url (no padding, replace chars)
    b64url = encoded.rstrip("=").replace("+", "-").replace("/", "_")
    return f"https://api.onedrive.com/v1.0/shares/u!{b64url}/root/content"


def download_from_share_link(share_url: str, dest_dir: Path) -> Path:
    """Download a single file from a OneDrive public share link."""
    download_url = _share_link_to_download_url(share_url)

    logger.info(f"Downloading from OneDrive share: {share_url}")
    resp = requests.get(download_url, timeout=30, allow_redirects=True)
    resp.raise_for_status()

    # Determine filename from Content-Disposition or URL
    cd = resp.headers.get("Content-Disposition", "")
    fname_match = re.search(r'filename[*]?=["\']?([^"\';\n]+)', cd)
    if fname_match:
        fname = fname_match.group(1).strip().strip("\"'")
    else:
        # Fallback: last segment of URL
        fname = share_url.rstrip("/").split("/")[-1].split("?")[0]
        if not any(fname.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
            fname += ".pdf"

    dest = dest_dir / fname
    dest.write_bytes(resp.content)
    logger.info(f"Downloaded: {fname} ({len(resp.content)} bytes)")
    return dest


# ── Graph API folder downloader ────────────────────────────────────────────────

class OneDriveGraphLoader:
    """
    Downloads files from a OneDrive folder using Microsoft Graph API
    with OAuth2 client credentials (app-only auth).

    Required environment variables (or .env):
      MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_USER_EMAIL
    """

    GRAPH_BASE = "https://graph.microsoft.com/v1.0"

    def __init__(self) -> None:
        self.tenant_id = os.getenv("MS_TENANT_ID", "")
        self.client_id = os.getenv("MS_CLIENT_ID", "")
        self.client_secret = os.getenv("MS_CLIENT_SECRET", "")
        self.user_email = os.getenv("MS_USER_EMAIL", "")
        self._token: str | None = None

    def _get_token(self) -> str:
        if self._token:
            return self._token
        url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }
        resp = requests.post(url, data=data, timeout=15)
        resp.raise_for_status()
        self._token = resp.json()["access_token"]
        return self._token

    def _get(self, endpoint: str) -> dict:
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        resp = requests.get(f"{self.GRAPH_BASE}{endpoint}", headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def list_files(self, folder_path: str = "/") -> list[dict]:
        """List files in a user's OneDrive folder."""
        if folder_path == "/":
            endpoint = f"/users/{self.user_email}/drive/root/children"
        else:
            endpoint = f"/users/{self.user_email}/drive/root:/{folder_path}:/children"

        data = self._get(endpoint)
        return data.get("value", [])

    def download_file(self, item: dict, dest_dir: Path) -> Path:
        """Download a single OneDrive file item to dest_dir."""
        fname = item["name"]
        download_url = item.get("@microsoft.graph.downloadUrl") or item.get("downloadUrl")
        if not download_url:
            raise ValueError(f"No download URL for item: {fname}")

        dest = dest_dir / fname
        resp = requests.get(download_url, timeout=60)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        logger.info(f"Downloaded from OneDrive: {fname}")
        return dest

    def download_folder(self, folder_path: str, dest_dir: Path) -> list[Path]:
        """Download all supported resume files from a OneDrive folder."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        items = self.list_files(folder_path)
        paths = []
        for item in items:
            name = item.get("name", "")
            if any(name.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
                try:
                    p = self.download_file(item, dest_dir)
                    paths.append(p)
                except Exception as exc:
                    logger.warning(f"Failed to download {name}: {exc}")
        return paths
