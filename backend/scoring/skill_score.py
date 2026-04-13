"""
scoring/skill_score.py — Skill overlap-based scoring.

Fix: _norm() now handles None input safely.
     skill_match_score filters out None/non-string values before processing.
"""
from __future__ import annotations

import re
from typing import Optional


def _norm(s) -> str:
    """Normalise a skill string. Returns empty string if input is None."""
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).lower().strip())


def skill_match_score(
    candidate_skills: list,
    jd_text: str,
    must_have: Optional[list[str]] = None,
    good_to_have: Optional[list[str]] = None,
) -> float:
    """
    Weighted Jaccard over must-have (weight 1.0) and good-to-have (weight 0.5).
    Falls back to keyword overlap with JD text if no explicit skill lists.
    Returns score in [0, 1].
    """
    # Guard: filter out None / non-string values before any processing
    safe_skills = [s for s in (candidate_skills or []) if s is not None and isinstance(s, str)]

    cand_norm = {_norm(s) for s in safe_skills}

    # If explicit skill lists exist, use Jaccard
    if must_have:
        safe_must = [s for s in must_have if s is not None]
        must_hits = sum(1 for s in safe_must if _norm(s) in cand_norm)
        must_total = len(safe_must)

        gtg_hits = 0.0
        gtg_total = 0.0
        if good_to_have:
            safe_gtg = [s for s in good_to_have if s is not None]
            gtg_hits = sum(0.5 for s in safe_gtg if _norm(s) in cand_norm)
            gtg_total = len(safe_gtg) * 0.5

        numerator = must_hits + gtg_hits
        denominator = must_total + gtg_total
        return round(numerator / denominator, 4) if denominator > 0 else 0.0

    # Fallback: keyword overlap with raw JD text
    if not jd_text or not safe_skills:
        return 0.5  # neutral

    jd_lower = jd_text.lower()
    hits = sum(1 for skill in safe_skills if _norm(skill) in jd_lower)
    # Normalize: more than 10 matching skills → 1.0
    return round(min(hits / 10.0, 1.0), 4)