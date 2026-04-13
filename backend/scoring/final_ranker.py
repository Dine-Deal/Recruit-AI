"""
scoring/final_ranker.py — Composite scoring and ranking of candidates.

Final Score = 0.70 × Semantic + 0.20 × Skill + 0.10 × Experience
"""
from __future__ import annotations

from typing import Optional

from config import settings
from scoring.experience_score import experience_score, extract_jd_experience_requirement
from scoring.skill_score import skill_match_score


def compute_final_score(
    semantic_sim: float,
    skill_match: float,
    exp_match: float,
) -> float:
    score = (
        settings.WEIGHT_SEMANTIC * semantic_sim
        + settings.WEIGHT_SKILL * skill_match
        + settings.WEIGHT_EXPERIENCE * exp_match
    )
    return round(float(score), 4)


def score_candidate(
    parsed: dict,
    semantic_similarity: float,
    jd_text: str,
    must_have_skills: Optional[list[str]] = None,
    good_to_have_skills: Optional[list[str]] = None,
    minimum_experience: Optional[int] = None,
) -> dict:
    """
    Score a single candidate against a job description.
    Returns dict with semantic_score, skill_score, experience_score, final_score.
    """
    # Derive minimum experience from JD text if not provided
    if minimum_experience is None and jd_text:
        minimum_experience = extract_jd_experience_requirement(jd_text)

    s_skill = skill_match_score(
        candidate_skills=parsed.get("skills", []),
        jd_text=jd_text,
        must_have=must_have_skills,
        good_to_have=good_to_have_skills,
    )
    s_exp = experience_score(
        candidate_years=parsed.get("experience_years"),
        minimum_years=minimum_experience,
    )
    s_final = compute_final_score(semantic_similarity, s_skill, s_exp)

    return {
        "semantic_score": round(semantic_similarity, 4),
        "skill_score": round(s_skill, 4),
        "experience_score": round(s_exp, 4),
        "final_score": s_final,
    }


def rank_candidates(candidates: list[dict], top_n: Optional[int] = None) -> list[dict]:
    """
    Sort candidates by final_score descending, assign 1-based rank.
    Ties share the lower rank (dense ranking).
    Returns top_n candidates if specified.
    """
    sorted_cands = sorted(
        candidates,
        key=lambda c: c.get("final_score", 0.0),
        reverse=True,
    )

    ranked = []
    current_rank = 1
    prev_score: Optional[float] = None

    for i, cand in enumerate(sorted_cands):
        score = cand.get("final_score", 0.0)
        if prev_score is not None and score < prev_score:
            current_rank = i + 1
        ranked.append({**cand, "rank": current_rank})
        prev_score = score

    if top_n:
        return ranked[:top_n]
    return ranked
