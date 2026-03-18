"""
pipeline/resume_parser.py  — v2
────────────────────────────────
Fixes over v1:
  • Skills: strict vocabulary-only extraction + garbage filter
  • Name: 4-strategy fallback chain (NER → first-line → label → email prefix)
  • Experience: catches "over X years", "X+ years", date ranges
  • Companies: NER ORG + known-company suffix heuristic
  • Certifications: dedicated section parser (not keyword scan)
  • Projects: multi-pattern section parser
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import pdfplumber
import spacy
from docx import Document as DocxDocument
from loguru import logger

from config import settings


# ── spaCy singleton ───────────────────────────────────────────────────────────

_NLP: Optional[spacy.Language] = None


def get_nlp() -> spacy.Language:
    global _NLP
    if _NLP is None:
        logger.info(f"Loading spaCy model: {settings.SPACY_MODEL}")
        _NLP = spacy.load(settings.SPACY_MODEL)
    return _NLP


# ── Tech skills vocabulary (strict — only real skills) ────────────────────────

TECH_SKILLS: set[str] = {
    # Languages
    "python", "java", "scala", "kotlin", "swift", "go", "golang", "rust",
    "c++", "c#", "ruby", "javascript", "typescript", "php", "r", "matlab",
    "julia", "dart", "bash", "shell", "perl", "groovy",
    # Web frontend
    "react", "vue", "angular", "svelte", "next.js", "nuxt", "html", "css",
    "sass", "tailwind", "bootstrap", "graphql", "webpack", "vite",
    "react.js", "angular.js", "vue.js",
    # Backend
    "fastapi", "django", "flask", "spring", "spring boot", "express",
    "express.js", "node.js", "nestjs", "nestjs", "laravel", "rails",
    "asp.net", "gin", "fiber",
    # DevOps / Infra
    "docker", "kubernetes", "terraform", "ansible", "helm", "nginx",
    "apache", "jenkins", "ci/cd", "github actions", "gitlab ci",
    "aws", "azure", "gcp", "google cloud", "lambda", "ec2", "s3", "rds",
    "ecs", "eks", "cloudfront", "sqs", "sns", "eventbridge",
    "azure ml", "vertex ai", "kubeflow", "mlflow", "airflow",
    # Data / ML / AI
    "machine learning", "deep learning", "nlp",
    "natural language processing", "computer vision",
    "llm", "transformers", "pytorch", "tensorflow", "keras",
    "scikit-learn", "xgboost", "lightgbm", "catboost",
    "spark", "pyspark", "hadoop", "kafka", "airflow", "dbt",
    "mlops", "mlflow", "kubeflow", "feast", "faiss",
    "hugging face", "langchain", "langgraph", "openai", "gemini",
    "rag", "retrieval augmented generation", "agentic", "prompt engineering",
    "generative ai", "llm evaluation", "vector database",
    "pandas", "numpy", "matplotlib", "seaborn", "plotly",
    "tableau", "power bi", "looker",
    # Databases
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "cassandra", "dynamodb", "sqlite", "neo4j", "clickhouse",
    "snowflake", "bigquery", "databricks",
    # Tools
    "git", "github", "gitlab", "jira", "postman", "swagger",
    "streamlit", "gradio", "flask", "fastapi",
    "socket.io", "websockets", "grpc", "rest", "rest apis",
    "microservices", "etl", "data pipeline", "feature engineering",
    "new relic", "cloudwatch", "grafana", "prometheus",
    # Certs / platforms (as skills)
    "aws solutions architect", "google cloud", "azure devops",
    "full stack", "devops", "agile", "scrum",
}

# Normalise skill names for matching
SKILL_SYNONYMS = {
    "ml": "machine learning", "ai": "artificial intelligence",
    "nlp": "natural language processing", "dl": "deep learning",
    "cv": "computer vision", "pytorch": "pytorch", "torch": "pytorch",
    "sklearn": "scikit-learn", "scikit learn": "scikit-learn",
    "postgres": "postgresql", "k8s": "kubernetes", "tf": "tensorflow",
    "js": "javascript", "ts": "typescript", "node": "node.js",
    "nodejs": "node.js", "react.js": "react", "reactjs": "react",
    "mongo": "mongodb", "llms": "llm",
    "large language models": "llm", "gen ai": "generative ai",
    "genai": "generative ai", "rag": "retrieval augmented generation",
}


def _norm(s: str) -> str:
    return SKILL_SYNONYMS.get(s.lower().strip(), s.lower().strip())


# Lines / tokens that must NEVER appear in skills list
SKILL_BLACKLIST_PATTERNS = [
    r"^\d",                          # starts with digit
    r"%",                            # percentage
    r"\d{4}",                        # contains year
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec",  # months
    r"present|current|till|since",   # date qualifiers
    r"^(hobbies|languages|education|experience|projects|"
    r"certifications?|awards?|skills?|summary|profile|"
    r"objective|references?|activities|co-curricular|"
    r"additional|links?|page\s*\d)$",  # section headers
    r"travelling|cooking|listening|reading|gaming|photography",  # hobbies
    r"cgpa|gpa|marks|score|grade",    # academic scores
    r"intern|fresher|engineer\b",     # job titles (too generic)
    r"\band\b|\bthe\b|\bfor\b|\bwith\b|\busing\b",  # filler words
    r"^\s*[•·\-–—]\s*$",            # lone bullets
    r"[<>{}()\[\]\/\\]",             # special chars
]

BLACKLIST_RE = [re.compile(p, re.IGNORECASE) for p in SKILL_BLACKLIST_PATTERNS]


def _is_valid_skill(s: str) -> bool:
    """Return True only if s looks like a real technical skill."""
    s = s.strip()
    if not s or len(s) < 2 or len(s) > 60:
        return False
    for pat in BLACKLIST_RE:
        if pat.search(s):
            return False
    return True


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_text_from_pdf(path: Path) -> str:
    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            raw = page.extract_text()
            if raw:
                parts.append(raw)
    return "\n".join(parts)


def extract_text_from_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    paragraphs.append(cell.text.strip())
    return "\n".join(paragraphs)


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_text_from_pdf(path)
    if suffix in (".docx", ".doc"):
        return extract_text_from_docx(path)
    raise ValueError(f"Unsupported file type: {suffix}")


# ── Field extractors ──────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"(\+?\d[\d\s\-().]{7,14}\d)")


def extract_email(text: str) -> Optional[str]:
    m = _EMAIL_RE.search(text)
    return m.group(0).lower() if m else None


def extract_phone(text: str) -> Optional[str]:
    m = _PHONE_RE.search(text)
    return re.sub(r"\s+", " ", m.group(0)).strip() if m else None


# ── Experience years (v2) ─────────────────────────────────────────────────────

def extract_experience_years(text: str) -> Optional[float]:
    # Pattern 1: "over 13 years", "5+ years of experience", "3 yrs"
    patterns = [
        r"(?:over|more\s+than|around|approximately)?\s*(\d+\.?\d*)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)",
        r"experience\s*[:\-–]?\s*(\d+\.?\d*)\s*\+?\s*(?:years?|yrs?)",
        r"(\d+\.?\d*)\s*\+?\s*(?:years?|yrs?)\s+of\s+(?:professional|industry|work|overall|total)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return float(m.group(1))

    # Pattern 2: Date ranges — "Jan 2019 – Mar 2023", "Jun 2018 – Sep 2019"
    from datetime import datetime
    now = datetime.now()

    ranges = re.findall(
        r"(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{4})"
        r"\s*[-–—to]+\s*"
        r"((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}"
        r"|present|current|now|till\s+present|\d{4})",
        text, re.IGNORECASE,
    )

    total_months = 0
    seen = set()
    for start_str, end_str in ranges:
        key = (start_str, end_str.lower().strip())
        if key in seen:
            continue
        seen.add(key)
        try:
            s = int(start_str)
            end_clean = end_str.lower().strip()
            if any(w in end_clean for w in ("present", "current", "now", "till")):
                e, em = now.year, now.month
            else:
                e_match = re.search(r"\d{4}", end_str)
                e = int(e_match.group()) if e_match else now.year
                em = 12
            months = (e - s) * 12 + (em - 1)
            if 3 < months < 600:   # between 3 months and 50 years
                total_months += months
        except Exception:
            pass

    if total_months > 0:
        return round(total_months / 12, 1)

    return None


# ── Skills (v2) ───────────────────────────────────────────────────────────────

SKILL_SECTION_HEADERS_RE = re.compile(
    r"^(technical\s+skills?|skills?\s*(?:&\s*expertise)?|technologies|"
    r"tech(?:nical)?\s+stack|core\s+competencies?|expertise|proficiencies|"
    r"tools?\s*(?:&\s*technologies)?)",
    re.IGNORECASE,
)

NEXT_SECTION_RE = re.compile(
    r"^(experience|work\s+experience|employment|education|projects?|"
    r"certifications?|awards?|publications?|languages?|references?|"
    r"hobbies|interests?|summary|profile|objective|achievements?)",
    re.IGNORECASE,
)


def extract_skills(text: str) -> list[str]:
    found: set[str] = set()

    # 1. Vocabulary scan on entire text (most reliable)
    lower = text.lower()
    for skill in TECH_SKILLS:
        if re.search(r"\b" + re.escape(skill) + r"\b", lower):
            # Normalise display: title case for short, capitalize for long
            display = skill.title() if len(skill) <= 4 else skill.capitalize()
            found.add(display)

    # 2. Skills section explicit parsing (catches unlisted tools)
    lines = text.splitlines()
    in_skills = False
    for line in lines:
        stripped = line.strip()
        if SKILL_SECTION_HEADERS_RE.match(stripped):
            in_skills = True
            continue
        if in_skills:
            if not stripped or NEXT_SECTION_RE.match(stripped):
                in_skills = False
                continue
            # Split by common delimiters
            parts = re.split(r"[,|•·;/\t]", stripped)
            for part in parts:
                clean = re.sub(r"^[\s•·\-–—:]+|[\s•·\-–—:]+$", "", part).strip()
                # Only add if it passes the blacklist and is reasonably short
                if _is_valid_skill(clean) and 2 <= len(clean) <= 50:
                    found.add(clean)

    # 3. Filter the final set again with blacklist
    final = [s for s in found if _is_valid_skill(s)]
    return sorted(set(final))


# ── Name extraction (v2 — 4 strategies) ──────────────────────────────────────

_TITLE_WORDS = {
    "senior", "lead", "principal", "staff", "junior", "associate",
    "engineer", "developer", "manager", "director", "analyst",
    "consultant", "architect", "scientist", "specialist", "officer",
    "intern", "fresher", "head", "vp", "cto", "ceo", "coo",
}


def _looks_like_name(text: str) -> bool:
    """Heuristic: 2–4 capitalised words, no digits, not a job title."""
    words = text.strip().split()
    if not (2 <= len(words) <= 4):
        return False
    if any(c.isdigit() for c in text):
        return False
    if not all(w[0].isupper() for w in words if w and w[0].isalpha()):
        return False
    lower_words = {w.lower() for w in words}
    if lower_words & _TITLE_WORDS:
        return False
    return True


def extract_name(text: str, nlp: spacy.Language) -> Optional[str]:
    # Strategy 1: spaCy PERSON entity in first 400 chars
    doc = nlp(text[:400])
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            name = ent.text.strip()
            if 3 < len(name) < 60 and _looks_like_name(name):
                return name

    # Strategy 2: First non-empty lines that look like a name
    for line in text.splitlines()[:10]:
        stripped = line.strip()
        # Skip lines with special chars, URLs, emails, phones
        if not stripped or "@" in stripped or "http" in stripped:
            continue
        if re.search(r"\d{4}|\+\d|linkedin|github", stripped, re.IGNORECASE):
            continue
        if _looks_like_name(stripped):
            return stripped

    # Strategy 3: "Name:" label
    m = re.search(r"(?:full\s+)?name\s*[:\-]\s*([A-Z][a-z]+(?: [A-Z][a-z]+)+)", text, re.I)
    if m:
        return m.group(1).strip()

    # Strategy 4: Derive from email (john.doe@... → John Doe)
    email = extract_email(text)
    if email:
        local = email.split("@")[0]
        parts = re.split(r"[._\-]", local)
        parts = [p.capitalize() for p in parts if p.isalpha() and len(p) > 1]
        if 2 <= len(parts) <= 3:
            return " ".join(parts)

    return None


# ── Education ─────────────────────────────────────────────────────────────────

_DEGREE_RE = re.compile(
    r"\b(b\.?tech|m\.?tech|b\.?e\b|m\.?e\b|bachelor|master|phd|ph\.d|"
    r"mba|m\.?sc|b\.?sc|b\.?com|diploma|graduate|postgraduate|"
    r"doctor(?:ate)?|associate|b\.?s\b|m\.?s\b)\b",
    re.IGNORECASE,
)


def extract_education(text: str) -> Optional[str]:
    edu_lines: list[str] = []
    for line in text.splitlines():
        if _DEGREE_RE.search(line):
            clean = line.strip()
            if 5 < len(clean) < 200:
                edu_lines.append(clean)
    return " | ".join(edu_lines[:3]) if edu_lines else None


# ── Companies (v2) ────────────────────────────────────────────────────────────

COMPANY_SUFFIXES = re.compile(
    r"\b(pvt\.?\s*ltd\.?|ltd\.?|llc|inc\.?|corp\.?|corporation|"
    r"technologies|technology|solutions|systems|services|consulting|"
    r"consultancy|analytics|labs?|studio|ventures|group|global|"
    r"management|enterprises?|networks?)\b",
    re.IGNORECASE,
)

# Pattern: "Company Name   Month YYYY – Month YYYY" (experience line)
EXPERIENCE_COMPANY_RE = re.compile(
    r"^([A-Z][A-Za-z\s&,.()\-/]+?)\s+"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|[A-Z][a-z]+)?\s*"
    r"(?:19|20)\d{2}",
    re.MULTILINE,
)


def extract_companies(text: str, nlp: spacy.Language) -> list[str]:
    companies: set[str] = set()

    # Method 1: spaCy ORG entities
    doc = nlp(text[:4000])
    for ent in doc.ents:
        if ent.label_ == "ORG":
            name = ent.text.strip()
            if (COMPANY_SUFFIXES.search(name) or len(name.split()) >= 2) and len(name) < 80:
                companies.add(name)

    # Method 2: Lines matching "Company   YYYY" pattern in experience section
    for m in EXPERIENCE_COMPANY_RE.finditer(text):
        candidate = m.group(1).strip().rstrip(",")
        if 3 < len(candidate) < 60 and not candidate.isupper():
            companies.add(candidate)

    # Filter out obvious non-companies
    NON_COMPANY = {
        "bachelor", "master", "university", "college", "school",
        "institute", "education", "skills", "experience", "projects",
    }
    result = [
        c for c in companies
        if not any(w.lower() in NON_COMPANY for w in c.split())
        and len(c) > 3
    ]
    return list(dict.fromkeys(result))[:8]


# ── Certifications (v2 — section-based) ──────────────────────────────────────

CERT_SECTION_RE = re.compile(
    r"^(certifications?|courses?\s*(?:&\s*certifications?)?|"
    r"licenses?\s*(?:&\s*certifications?)?|professional\s+development|"
    r"training\s*(?:&\s*certifications?)?)",
    re.IGNORECASE,
)

CERT_END_RE = re.compile(
    r"^(awards?|education|projects?|experience|work|employment|"
    r"skills?|languages?|references?|publications?|hobbies|additional|links?)",
    re.IGNORECASE,
)

# Certification keyword patterns for inline detection
CERT_KEYWORD_RE = re.compile(
    r"\b(certified|certification|certificate|aws\s|azure\s|google\s+cloud|"
    r"gcp\s|microsoft\s|databricks|coursera|udemy|edx|stanford|deeplearning|"
    r"hackerrank|leetcode|udacity|pmp|cka|cks|scrum|cissp|comptia)\b",
    re.IGNORECASE,
)


def extract_certifications(text: str) -> list[str]:
    certs: list[str] = []
    lines = text.splitlines()
    in_cert_section = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if CERT_SECTION_RE.match(stripped):
            in_cert_section = True
            continue

        if in_cert_section:
            if CERT_END_RE.match(stripped):
                in_cert_section = False
                continue
            # Clean bullet points and add
            clean = re.sub(r"^[\s•·\-–—▪◦\uf0b7]+", "", stripped).strip()
            if 5 < len(clean) < 200:
                certs.append(clean)

    # Fallback: scan for certification keywords if section not found
    if not certs:
        for line in lines:
            stripped = line.strip()
            if CERT_KEYWORD_RE.search(stripped):
                clean = re.sub(r"^[\s•·\-–—▪◦\uf0b7]+", "", stripped).strip()
                if 5 < len(clean) < 200:
                    # Exclude lines that are clearly not cert lines
                    if not re.search(r"(experience|developed|built|managed|led|designed)", clean, re.I):
                        certs.append(clean)

    return list(dict.fromkeys(certs))[:12]


# ── Projects (v2) ─────────────────────────────────────────────────────────────

PROJECT_SECTION_RE = re.compile(
    r"^((?:key\s+|notable\s+|personal\s+|major\s+)?projects?|"
    r"academic\s+projects?|portfolio)",
    re.IGNORECASE,
)

PROJECT_END_RE = re.compile(
    r"^(education|certifications?|skills?|awards?|languages?|"
    r"references?|hobbies|additional|links?|publications?)",
    re.IGNORECASE,
)


def extract_projects(text: str) -> list[str]:
    projects: list[str] = []
    lines = text.splitlines()
    in_projects = False
    current_project: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if PROJECT_SECTION_RE.match(stripped):
            in_projects = True
            continue

        if in_projects:
            if PROJECT_END_RE.match(stripped):
                if current_project:
                    projects.append(" ".join(current_project[:2]))
                break

            # A new project starts when line has a pipe "|" (tech stack line)
            # or is a short title-like line without bullet prefix
            clean = re.sub(r"^[\s•·\-–—▪◦\uf0b7]+", "", stripped).strip()

            if "|" in clean and len(clean) < 200:
                if current_project:
                    projects.append(current_project[0])
                current_project = [clean.split("|")[0].strip()]
            elif not clean.startswith("–") and not clean.startswith("-") and len(clean) < 100 and len(clean) > 5:
                if len(current_project) == 0:
                    current_project = [clean]
                elif len(current_project) == 1:
                    current_project.append(clean)
            # Stop after 10 projects
            if len(projects) >= 10:
                break

    if current_project and len(projects) < 10:
        projects.append(current_project[0])

    return list(dict.fromkeys(projects))[:10]


# ── Main parse function ───────────────────────────────────────────────────────

def parse_resume(path: Path) -> dict:
    """Full pipeline: extract text → all field extractors."""
    try:
        raw_text = extract_text(path)
    except Exception as exc:
        logger.error(f"Text extraction failed for {path.name}: {exc}")
        return {"raw_text": "", "file_name": path.name, "file_path": str(path)}

    # Clean unicode bullets and control characters
    raw_text = re.sub(r"[\uf0b7\uf0a7\uf0d8\uf076]", "•", raw_text)
    raw_text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", raw_text)

    nlp = get_nlp()

    result: dict = {
        "name":               extract_name(raw_text, nlp),
        "email":              extract_email(raw_text),
        "phone":              extract_phone(raw_text),
        "skills":             extract_skills(raw_text),
        "education":          extract_education(raw_text),
        "experience_years":   extract_experience_years(raw_text),
        "previous_companies": extract_companies(raw_text, nlp),
        "certifications":     extract_certifications(raw_text),
        "projects":           extract_projects(raw_text),
        "raw_text":           raw_text,
        "file_name":          path.name,
        "file_path":          str(path),
    }

    logger.debug(
        f"Parsed {path.name}: name={result['name']}, "
        f"skills={len(result['skills'])}, exp={result['experience_years']}yrs, "
        f"companies={len(result['previous_companies'])}, "
        f"certs={len(result['certifications'])}"
    )
    return result