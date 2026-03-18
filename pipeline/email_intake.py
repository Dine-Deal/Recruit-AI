"""
pipeline/email_intake.py
────────────────────────
Connects to Microsoft Outlook via the Graph API, detects emails with resume
attachments, identifies the target job role, and saves attachments into
role-specific folders under Applications/.

Flow
────
1.  Authenticate via MSAL (client-credentials).
2.  Poll the recruiter mailbox for unread/new emails.
3.  For each email: detect role from subject / body / metadata.
4.  Download PDF/DOCX attachments.
5.  Save to Applications/<RoleName>/<filename>.
6.  Mark email as read so it is not reprocessed.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional

import httpx
import msal
from loguru import logger

from config import settings


# ── Auth ──────────────────────────────────────────────────────────────────────

class GraphAuthProvider:
    """Handles MSAL token acquisition with automatic refresh."""

    def __init__(self) -> None:
        self._app = msal.ConfidentialClientApplication(
            client_id=settings.MS_CLIENT_ID,
            client_credential=settings.MS_CLIENT_SECRET.get_secret_value(),
            authority=f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}",
        )
        self._token: Optional[str] = None
        self._expires_at: float = 0.0

    def get_token(self) -> str:
        if self._token and time.time() < self._expires_at - 60:
            return self._token

        result = self._app.acquire_token_for_client(scopes=settings.MS_GRAPH_SCOPE)

        if "access_token" not in result:
            raise RuntimeError(f"MSAL token error: {result.get('error_description')}")

        self._token = result["access_token"]
        self._expires_at = time.time() + result.get("expires_in", 3600)
        return self._token

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.get_token()}",
            "Content-Type": "application/json",
        }


# ── Role detection ────────────────────────────────────────────────────────────

ROLE_KEYWORDS: dict[str, list[str]] = {
    "AI_Engineer": ["ai engineer", "artificial intelligence engineer", "ai/ml engineer"],
    "Data_Scientist": ["data scientist", "data science"],
    "ML_Engineer": ["ml engineer", "machine learning engineer"],
    "Backend_Developer": ["backend developer", "back-end developer", "backend engineer"],
    "Frontend_Developer": ["frontend developer", "front-end developer", "ui developer"],
    "Full_Stack_Developer": ["full stack", "fullstack"],
    "DevOps_Engineer": ["devops engineer", "platform engineer", "sre"],
    "Data_Engineer": ["data engineer", "data pipeline"],
}


def detect_role_from_text(text: str) -> str:
    """
    Returns the best-matching folder name or 'Unclassified'.
    Searches the lowercased text against ROLE_KEYWORDS.
    """
    lower = text.lower()
    for folder_name, keywords in ROLE_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return folder_name
    return "Unclassified"


def detect_role(subject: str, body: str) -> str:
    """Try subject first, fall back to body."""
    role = detect_role_from_text(subject)
    if role == "Unclassified":
        role = detect_role_from_text(body)
    return role


# ── Attachment helpers ────────────────────────────────────────────────────────

RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}


def is_resume_attachment(name: str, content_type: str) -> bool:
    ext = Path(name).suffix.lower()
    if ext in RESUME_EXTENSIONS:
        return True
    if content_type in (
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ):
        return True
    return False


def safe_filename(name: str) -> str:
    """Strip characters that are unsafe for filenames."""
    return re.sub(r'[<>:"/\\|?*]', "_", name)


# ── Core intake service ───────────────────────────────────────────────────────

class EmailIntakeService:
    GRAPH_BASE = "https://graph.microsoft.com/v1.0"

    def __init__(self) -> None:
        self._auth = GraphAuthProvider()
        self._client = httpx.Client(timeout=30)
        self._applications_dir = settings.APPLICATIONS_DIR
        self._applications_dir.mkdir(parents=True, exist_ok=True)

    # ── Low-level API calls ───────────────────────────────────────────────

    def _get(self, url: str, params: Optional[dict] = None) -> dict:
        resp = self._client.get(url, headers=self._auth.headers, params=params)
        resp.raise_for_status()
        return resp.json()

    def _patch(self, url: str, payload: dict) -> None:
        resp = self._client.patch(url, headers=self._auth.headers, json=payload)
        resp.raise_for_status()

    def _download_bytes(self, url: str) -> bytes:
        resp = self._client.get(url, headers=self._auth.headers)
        resp.raise_for_status()
        return resp.content

    # ── Email listing ─────────────────────────────────────────────────────

    def fetch_unread_emails(self, top: int = 50) -> list[dict]:
        """
        Returns up to `top` unread emails from the recruiter inbox that
        contain at least one attachment.
        """
        url = f"{self.GRAPH_BASE}/users/{settings.MS_USER_EMAIL}/mailFolders/inbox/messages"
        params = {
            "$filter": "isRead eq false and hasAttachments eq true",
            "$top": str(top),
            "$select": "id,subject,body,from,receivedDateTime,hasAttachments",
        }
        data = self._get(url, params)
        return data.get("value", [])

    def fetch_attachments(self, message_id: str) -> list[dict]:
        url = (
            f"{self.GRAPH_BASE}/users/{settings.MS_USER_EMAIL}"
            f"/messages/{message_id}/attachments"
        )
        data = self._get(url)
        return data.get("value", [])

    def mark_as_read(self, message_id: str) -> None:
        url = f"{self.GRAPH_BASE}/users/{settings.MS_USER_EMAIL}/messages/{message_id}"
        self._patch(url, {"isRead": True})

    # ── Saving ────────────────────────────────────────────────────────────

    def save_attachment(
        self, attachment: dict, role_folder: str
    ) -> Optional[Path]:
        name = attachment.get("name", "resume")
        content_type = attachment.get("contentType", "")
        if not is_resume_attachment(name, content_type):
            return None

        folder = self._applications_dir / role_folder
        folder.mkdir(parents=True, exist_ok=True)

        safe_name = safe_filename(name)
        dest = folder / safe_name

        # Rename if file already exists with different content
        counter = 1
        while dest.exists():
            stem = Path(safe_name).stem
            suffix = Path(safe_name).suffix
            dest = folder / f"{stem}_{counter}{suffix}"
            counter += 1

        # Graph API returns content as base64 in `contentBytes`
        import base64
        raw = attachment.get("contentBytes")
        if raw:
            dest.write_bytes(base64.b64decode(raw))
            logger.info(f"Saved attachment → {dest}")
            return dest

        return None

    # ── Main orchestration ────────────────────────────────────────────────

    def run_once(self) -> dict[str, int]:
        """
        Process one batch of unread emails.
        Returns a summary dict: {role_name: count_saved}
        """
        summary: dict[str, int] = {}

        try:
            emails = self.fetch_unread_emails()
        except Exception as exc:
            logger.error(f"Failed to fetch emails: {exc}")
            return summary

        for email in emails:
            msg_id = email["id"]
            subject = email.get("subject", "")
            body_content = email.get("body", {}).get("content", "")
            role = detect_role(subject, body_content)

            try:
                attachments = self.fetch_attachments(msg_id)
            except Exception as exc:
                logger.warning(f"Could not fetch attachments for {msg_id}: {exc}")
                continue

            saved = 0
            for att in attachments:
                path = self.save_attachment(att, role)
                if path:
                    saved += 1

            if saved:
                summary[role] = summary.get(role, 0) + saved
                logger.info(f"Email {msg_id}: role={role}, saved {saved} resume(s)")

            try:
                self.mark_as_read(msg_id)
            except Exception as exc:
                logger.warning(f"Could not mark {msg_id} as read: {exc}")

        return summary

    def run_polling_loop(self) -> None:
        """
        Infinite polling loop — intended to be run in a background thread or
        started as a separate process/service.
        """
        logger.info(
            f"Email intake polling started "
            f"(interval={settings.EMAIL_POLL_INTERVAL_SECONDS}s)"
        )
        while True:
            summary = self.run_once()
            if summary:
                logger.info(f"Intake summary: {summary}")
            time.sleep(settings.EMAIL_POLL_INTERVAL_SECONDS)
