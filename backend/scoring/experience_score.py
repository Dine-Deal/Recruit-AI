"""
scoring/experience_score.py — Experience matching with context-aware scoring.
"""
from __future__ import annotations

import re
from typing import Optional


def extract_jd_experience_requirement(jd_text: str) -> Optional[int]:
    """Extract minimum experience years from JD text."""
    patterns = [
        r"(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)",
        r"minimum\s+(\d+)\s+(?:years?|yrs?)",
        r"at\s+least\s+(\d+)\s+(?:years?|yrs?)",
    ]
    for pat in patterns:
        m = re.search(pat, jd_text, re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def experience_score(
    candidate_years: Optional[float],
    minimum_years: Optional[int],
) -> float:
    """
    Penalises under-experience, caps reward at 2× the minimum.
    Returns score in [0, 1].
    """
    if minimum_years is None or minimum_years <= 0:
        return 1.0 if (candidate_years or 0) > 0 else 0.5

    c = candidate_years or 0.0
    m = float(minimum_years)

    if c >= 2 * m:
        return 1.0
    if c >= m:
        return round(0.75 + 0.25 * (c - m) / m, 4)
    if c > 0:
        return round(0.75 * (c / m), 4)
    return 0.0
