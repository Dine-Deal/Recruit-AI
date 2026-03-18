"""
tests/test_pipeline.py
─────────────────────
Unit tests for the core pipeline logic.

Run with:
    pytest tests/ -v
"""

import hashlib
import json
import tempfile
from pathlib import Path

import numpy as np
import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Scorer tests
# ─────────────────────────────────────────────────────────────────────────────

from pipeline.scorer import (
    composite_score,
    experience_score,
    rank_candidates,
    skill_match_score,
)


class TestSkillMatchScore:
    def test_perfect_match(self):
        score = skill_match_score(
            ["Python", "FastAPI", "Docker"],
            must_have=["Python", "FastAPI", "Docker"],
        )
        assert score == 1.0

    def test_no_match(self):
        score = skill_match_score(
            ["Java", "Spring"],
            must_have=["Python", "FastAPI", "Docker"],
        )
        assert score == 0.0

    def test_partial_match(self):
        score = skill_match_score(
            ["Python"],
            must_have=["Python", "FastAPI", "Docker"],
        )
        assert 0.0 < score < 1.0

    def test_case_insensitive(self):
        score = skill_match_score(
            ["PYTHON", "fastapi"],
            must_have=["python", "FastAPI"],
        )
        assert score == 1.0

    def test_good_to_have_bonus(self):
        score_without = skill_match_score(
            ["Python"],
            must_have=["Python"],
            good_to_have=["Docker", "AWS"],
        )
        score_with = skill_match_score(
            ["Python", "Docker"],
            must_have=["Python"],
            good_to_have=["Docker", "AWS"],
        )
        assert score_with > score_without

    def test_empty_must_have(self):
        score = skill_match_score(["Python"], must_have=[])
        assert score == 0.5   # neutral score for no requirements


class TestExperienceScore:
    def test_meets_minimum(self):
        score = experience_score(candidate_years=3, minimum_years=3)
        assert score >= 0.75

    def test_exceeds_double(self):
        score = experience_score(candidate_years=10, minimum_years=3)
        assert score == 1.0

    def test_below_minimum(self):
        score = experience_score(candidate_years=1, minimum_years=3)
        assert 0 < score < 0.75

    def test_zero_experience(self):
        score = experience_score(candidate_years=0, minimum_years=3)
        assert score == 0.0

    def test_no_minimum(self):
        score = experience_score(candidate_years=5, minimum_years=None)
        assert score == 1.0

    def test_none_experience(self):
        score = experience_score(candidate_years=None, minimum_years=2)
        assert score == 0.0


class TestCompositeScore:
    def test_weights_sum_to_one(self):
        """Weights defined in config should sum to 1.0."""
        from config import settings
        total = settings.WEIGHT_SEMANTIC + settings.WEIGHT_SKILL + settings.WEIGHT_EXPERIENCE
        assert abs(total - 1.0) < 1e-6

    def test_perfect_scores(self):
        score = composite_score(1.0, 1.0, 1.0)
        assert score == 1.0

    def test_zero_scores(self):
        score = composite_score(0.0, 0.0, 0.0)
        assert score == 0.0

    def test_proportional(self):
        s1 = composite_score(0.9, 0.8, 0.7)
        s2 = composite_score(0.5, 0.5, 0.5)
        assert s1 > s2


class TestRankCandidates:
    def test_sorted_descending(self):
        candidates = [
            {"name": "C", "final_score": 0.60},
            {"name": "A", "final_score": 0.90},
            {"name": "B", "final_score": 0.75},
        ]
        ranked = rank_candidates(candidates)
        scores = [c["final_score"] for c in ranked]
        assert scores == sorted(scores, reverse=True)

    def test_rank_assigned(self):
        candidates = [
            {"name": "A", "final_score": 0.90},
            {"name": "B", "final_score": 0.75},
            {"name": "C", "final_score": 0.60},
        ]
        ranked = rank_candidates(candidates)
        assert ranked[0]["rank"] == 1
        assert ranked[1]["rank"] == 2
        assert ranked[2]["rank"] == 3

    def test_ties_share_rank(self):
        candidates = [
            {"name": "A", "final_score": 0.90},
            {"name": "B", "final_score": 0.90},
            {"name": "C", "final_score": 0.60},
        ]
        ranked = rank_candidates(candidates)
        assert ranked[0]["rank"] == 1
        assert ranked[1]["rank"] == 1
        assert ranked[2]["rank"] == 3   # dense ranking skips to 3

    def test_empty_list(self):
        assert rank_candidates([]) == []


# ─────────────────────────────────────────────────────────────────────────────
# Registry tests
# ─────────────────────────────────────────────────────────────────────────────

from pipeline.jd_manager import ProcessedRegistry, compute_file_hash


class TestProcessedRegistry:
    def test_mark_and_check(self, tmp_path):
        reg = ProcessedRegistry(path=tmp_path / "reg.json")
        h = "abc123deadbeef"
        assert not reg.is_processed(h)
        reg.mark_processed("resume.pdf", "AI_Engineer", h)
        assert reg.is_processed(h)

    def test_persistence(self, tmp_path):
        path = tmp_path / "reg.json"
        reg1 = ProcessedRegistry(path=path)
        reg1.mark_processed("resume.pdf", "AI_Engineer", "hash1")

        reg2 = ProcessedRegistry(path=path)
        assert reg2.is_processed("hash1")

    def test_count(self, tmp_path):
        reg = ProcessedRegistry(path=tmp_path / "reg.json")
        assert reg.count() == 0
        reg.mark_processed("a.pdf", "role1", "h1")
        reg.mark_processed("b.pdf", "role1", "h2")
        assert reg.count() == 2


class TestFileHash:
    def test_deterministic(self, tmp_path):
        f = tmp_path / "test.pdf"
        f.write_bytes(b"hello world resume content")
        h1 = compute_file_hash(f)
        h2 = compute_file_hash(f)
        assert h1 == h2

    def test_different_content_different_hash(self, tmp_path):
        f1 = tmp_path / "a.pdf"
        f2 = tmp_path / "b.pdf"
        f1.write_bytes(b"content A")
        f2.write_bytes(b"content B")
        assert compute_file_hash(f1) != compute_file_hash(f2)

    def test_sha256_length(self, tmp_path):
        f = tmp_path / "test.pdf"
        f.write_bytes(b"test")
        h = compute_file_hash(f)
        assert len(h) == 64   # SHA-256 hex = 64 chars


# ─────────────────────────────────────────────────────────────────────────────
# Embeddings tests
# ─────────────────────────────────────────────────────────────────────────────

from pipeline.embeddings import build_resume_text, cosine_similarity


class TestCosine:
    def test_identical_vectors(self):
        v = np.array([0.5, 0.5, 0.5, 0.5], dtype=np.float32)
        v = v / np.linalg.norm(v)
        assert abs(cosine_similarity(v, v) - 1.0) < 1e-5

    def test_orthogonal_vectors(self):
        a = np.array([1, 0, 0, 0], dtype=np.float32)
        b = np.array([0, 1, 0, 0], dtype=np.float32)
        assert cosine_similarity(a, b) == 0.0

    def test_bounded(self):
        a = np.random.rand(384).astype(np.float32)
        b = np.random.rand(384).astype(np.float32)
        a /= np.linalg.norm(a)
        b /= np.linalg.norm(b)
        sim = cosine_similarity(a, b)
        assert 0.0 <= sim <= 1.0


class TestBuildResumeText:
    def test_includes_skills(self):
        parsed = {"skills": ["Python", "FastAPI"], "raw_text": ""}
        text = build_resume_text(parsed)
        assert "Python" in text
        assert "FastAPI" in text

    def test_includes_experience(self):
        parsed = {"experience_years": 4.5, "raw_text": ""}
        text = build_resume_text(parsed)
        assert "4.5" in text

    def test_truncates_raw_text(self):
        parsed = {"raw_text": "x" * 2000}
        text = build_resume_text(parsed)
        assert len(text) < 1000   # raw truncated to 800 + minor overhead


# ─────────────────────────────────────────────────────────────────────────────
# Resume parser tests (rule-based only, no spaCy — CI-safe)
# ─────────────────────────────────────────────────────────────────────────────

from pipeline.resume_parser import (
    extract_certifications,
    extract_email,
    extract_experience_years,
    extract_phone,
    extract_skills,
)


class TestExtractEmail:
    def test_basic(self):
        assert extract_email("Contact: john.doe@gmail.com for info") == "john.doe@gmail.com"

    def test_none(self):
        assert extract_email("no email here") is None

    def test_lowercased(self):
        assert extract_email("EMAIL: JOHN@EXAMPLE.COM") == "john@example.com"


class TestExtractPhone:
    def test_formats(self):
        assert extract_phone("Call me at +91-9876543210") is not None
        assert extract_phone("Phone: (555) 123-4567") is not None

    def test_none(self):
        assert extract_phone("no phone number") is None


class TestExtractExperience:
    def test_explicit_years(self):
        assert extract_experience_years("5 years of experience in ML") == 5.0
        assert extract_experience_years("3+ years experience") == 3.0

    def test_decimal(self):
        assert extract_experience_years("2.5 years experience") == 2.5

    def test_none(self):
        assert extract_experience_years("no experience info") is None


class TestExtractSkills:
    def test_finds_python(self):
        skills = extract_skills("Proficient in Python and Machine Learning")
        assert any("python" in s.lower() for s in skills)

    def test_finds_multiple(self):
        skills = extract_skills("Skills: Python, FastAPI, Docker, PostgreSQL")
        assert len(skills) >= 3

    def test_deduped(self):
        skills = extract_skills("Python Python Python")
        count = sum(1 for s in skills if "python" in s.lower())
        assert count == 1
