"""
pipeline/scorer.py
──────────────────
Computes the composite candidate score:

    Final Score =
        0.70 × Semantic Similarity      (cosine sim vs JD embedding)
      + 0.20 × Skill Match Score        (overlap between candidate skills and JD skills)
      + 0.10 × Experience Match Score   (years vs minimum required)

All sub-scores are in [0, 1].  Final score is also in [0, 1].
"""

from __future__ import annotations

import re
from typing import Optional

from config import settings


# ── Skill match ───────────────────────────────────────────────────────────────

def _normalise_skill(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().strip())


def skill_match_score(
    candidate_skills: list[str],
    must_have: list[str],
    good_to_have: Optional[list[str]] = None,
) -> float:
    """
    Weighted Jaccard over must-have (weight=1.0) and good-to-have (weight=0.5).
    Returns a score in [0, 1].
    """
    if not must_have:
        return 0.5   # no requirements → neutral score

    cand_norm = {_normalise_skill(s) for s in candidate_skills}

    # Must-have hits (each worth 1 point)
    must_hits = sum(
        1 for s in must_have if _normalise_skill(s) in cand_norm
    )
    must_total = len(must_have)

    # Good-to-have hits (each worth 0.5 points)
    gtg_hits: float = 0.0
    gtg_total: float = 0.0
    if good_to_have:
        gtg_hits = sum(
            0.5 for s in good_to_have if _normalise_skill(s) in cand_norm
        )
        gtg_total = len(good_to_have) * 0.5

    numerator = must_hits + gtg_hits
    denominator = must_total + gtg_total

    return round(numerator / denominator, 4) if denominator > 0 else 0.0


# ── Experience match ──────────────────────────────────────────────────────────

def experience_score(
    candidate_years: Optional[float],
    minimum_years: Optional[int],
) -> float:
    """
    Penalises under-experience, caps reward at 2× the minimum.
    Returns a score in [0, 1].
    """
    if minimum_years is None or minimum_years <= 0:
        # No minimum → award full score if candidate has any experience
        return 1.0 if (candidate_years or 0) > 0 else 0.5

    c = candidate_years or 0.0
    m = float(minimum_years)

    if c >= 2 * m:
        return 1.0
    if c >= m:
        # Between minimum and 2× → linear scale from 0.75 → 1.0
        return round(0.75 + 0.25 * (c - m) / m, 4)
    if c > 0:
        # Below minimum → proportional penalty
        return round(0.75 * (c / m), 4)
    return 0.0


# ── Composite score ───────────────────────────────────────────────────────────

def composite_score(
    semantic_sim: float,
    skill_match: float,
    exp_match: float,
) -> float:
    """
    Weighted combination of the three sub-scores.
    Weights from config (default: 0.70 / 0.20 / 0.10).
    """
    score = (
        settings.WEIGHT_SEMANTIC * semantic_sim
        + settings.WEIGHT_SKILL * skill_match
        + settings.WEIGHT_EXPERIENCE * exp_match
    )
    return round(float(score), 4)


# ── Rank candidates ───────────────────────────────────────────────────────────

def rank_candidates(candidates: list[dict]) -> list[dict]:
    """
    Sort a list of candidate dicts by `final_score` descending.
    Adds a 1-based `rank` field.  Ties share the lower rank (dense ranking).
    Returns a new list (does not mutate input).
    """
    sorted_cands = sorted(
        candidates,
        key=lambda c: c.get("final_score", 0.0),
        reverse=True,
    )
    ranked: list[dict] = []
    current_rank = 1
    prev_score: Optional[float] = None

    for i, cand in enumerate(sorted_cands):
        score = cand.get("final_score", 0.0)
        if prev_score is not None and score < prev_score:
            current_rank = i + 1
        ranked.append({**cand, "rank": current_rank})
        prev_score = score

    return ranked


# ── Single-candidate scoring helper ──────────────────────────────────────────

def score_candidate(
    parsed: dict,
    semantic_similarity: float,
    jd: dict,
) -> dict[str, float]:
    """
    Given parsed candidate data, a precomputed semantic similarity, and the
    JD metadata dict, returns all three sub-scores and the final composite.

    jd dict fields used:
      must_have_skills      list[str]
      good_to_have_skills   list[str] | None
      minimum_experience    int | None
    """
    s_skill = skill_match_score(
        candidate_skills=parsed.get("skills", []),
        must_have=jd.get("must_have_skills") or [],
        good_to_have=jd.get("good_to_have_skills"),
    )
    s_exp = experience_score(
        candidate_years=parsed.get("experience_years"),
        minimum_years=jd.get("minimum_experience"),
    )
    s_final = composite_score(semantic_similarity, s_skill, s_exp)

    return {
        "semantic_score": round(semantic_similarity, 4),
        "skill_score": round(s_skill, 4),
        "experience_score": round(s_exp, 4),
        "final_score": s_final,
    }
