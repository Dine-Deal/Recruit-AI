"""
pipeline/jd_parser.py — Extract text from uploaded JD files (PDF/DOCX/TXT).
"""
from __future__ import annotations

from pathlib import Path


def extract_jd_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _from_pdf(path)
    if suffix in (".docx", ".doc"):
        return _from_docx(path)
    if suffix == ".txt":
        return path.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"Unsupported JD file type: {suffix}")


def _from_pdf(path: Path) -> str:
    import pdfplumber
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            raw = page.extract_text()
            if raw:
                parts.append(raw)
    return "\n".join(parts)


def _from_docx(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
