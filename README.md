# Recruit AI — AI-Powered Resume Screening System

A lightweight, fully-local resume screening system that ranks candidates against a Job Description using semantic AI matching.

**No database · No authentication · No cloud required**

---

## Architecture

```
recruit-ai/
├── backend/
│   ├── main.py                   # FastAPI app entry point
│   ├── config.py                 # Settings (no DB/auth)
│   ├── requirements.txt
│   ├── processed_resumes.json    # Duplicate-check registry (auto-updated)
│   ├── api/
│   │   └── routes.py             # POST /run-pipeline, GET /download-resume/{id}
│   ├── file_loader/
│   │   ├── local_loader.py       # Read resumes from local folder
│   │   ├── onedrive_loader.py    # Download from OneDrive (share links + Graph API)
│   │   └── unified_loader.py     # Hybrid abstraction + duplicate hash check
│   ├── nlp/
│   │   └── resume_parser.py      # spaCy en_core_web_sm NER + text extraction
│   ├── scoring/
│   │   ├── semantic_score.py     # MiniLM-L6-v2 embeddings
│   │   ├── skill_score.py        # Jaccard + keyword overlap
│   │   ├── experience_score.py   # Context-aware experience scoring
│   │   └── final_ranker.py       # 0.70/0.20/0.10 composite + ranking
│   └── pipeline/
│       ├── orchestrator.py       # End-to-end async pipeline
│       └── jd_parser.py          # Extract text from JD files (PDF/DOCX/TXT)
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── pages/Home.jsx
    │   ├── components/
    │   │   ├── JDInput.jsx         # Upload or paste JD
    │   │   ├── ResumeSourceInput.jsx  # Local folder or OneDrive
    │   │   ├── RunPipelineButton.jsx
    │   │   ├── CandidateCard.jsx   # Expandable card with score breakdown
    │   │   └── CandidateTable.jsx  # Cards + table view toggle
    │   └── services/api.js
    ├── package.json
    └── vite.config.js
```

---

## Processing Pipeline

```
JD (text or file)
  → Extract JD text
  → Embed JD with MiniLM-L6-v2

Resume Source (local folder or OneDrive)
  → File discovery (PDF, DOCX)
  → Duplicate check (SHA-256 hash vs processed_resumes.json)

For each resume:
  → Text extraction (pdfplumber / python-docx)
  → NER parsing (spaCy en_core_web_sm):
      name, email, phone, skills, experience, education,
      companies, projects, certifications
  → Embed resume text (MiniLM-L6-v2)
  → Cosine semantic similarity vs JD embedding
  → Skill match score (Jaccard overlap)
  → Experience match score (context-aware)
  → Final Score = 0.70×Semantic + 0.20×Skill + 0.10×Experience

→ Rank all candidates
→ Return Top 5
```

---

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+

---

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate       # macOS/Linux
# venv\Scripts\activate        # Windows

# Install dependencies
pip install -r requirements.txt

# Download spaCy model
python -m spacy download en_core_web_sm

# (Optional) OneDrive API credentials — only needed for Graph API mode
cp .env.example .env
# Edit .env with: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_USER_EMAIL

# Start backend
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000  
API docs: http://localhost:8000/docs

---

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs at: http://localhost:3000

---

## Usage

1. Open `http://localhost:3000`
2. **Job Description** — Paste text directly or upload a PDF/DOCX/TXT file
3. **Resume Source**
   - **Local Folder**: Enter absolute path (e.g. `/home/user/resumes` or `C:\Resumes`)
   - **OneDrive Share Links**: Paste public share links (comma-separated)
   - **OneDrive API**: Enter folder path (requires `.env` credentials)
4. Optionally add skill hints and minimum experience for better accuracy
5. Click **Run Pipeline**
6. View Top 5 ranked candidates with score breakdown
7. Download any resume with the **⬇ Download Resume** button

---

## OneDrive Configuration (optional)

For **Share Links** mode: No configuration needed. Just paste the public link(s).

For **Graph API** mode, create a `backend/.env` file:

```env
MS_TENANT_ID=your-tenant-id
MS_CLIENT_ID=your-app-client-id
MS_CLIENT_SECRET=your-client-secret
MS_USER_EMAIL=user@yourdomain.com
```

Register an Azure app with `Files.Read.All` permission and grant admin consent.

---

## Scoring Formula

| Component | Weight | Method |
|-----------|--------|--------|
| Semantic Similarity | 70% | Cosine similarity between JD and resume embeddings (MiniLM-L6-v2) |
| Skill Match | 20% | Jaccard overlap of must-have/good-to-have skills; falls back to keyword scan |
| Experience Match | 10% | Proportional scoring against minimum experience requirement |

---

## API Reference

### `POST /run-pipeline`

**Form fields:**

| Field | Type | Description |
|-------|------|-------------|
| `jd_file` | File (optional) | JD as PDF/DOCX/TXT |
| `jd_text` | string (optional) | JD as plain text |
| `source_type` | string | `local` \| `onedrive_link` \| `onedrive_api` |
| `local_folder` | string | Absolute folder path (for `local`) |
| `onedrive_links` | string | Comma-separated share URLs (for `onedrive_link`) |
| `onedrive_folder` | string | OneDrive folder path (for `onedrive_api`) |
| `must_have_skills` | string | Comma-separated skills (optional) |
| `good_to_have_skills` | string | Comma-separated skills (optional) |
| `minimum_experience` | int | Minimum years required (optional) |

**Response:**
```json
{
  "success": true,
  "message": "Pipeline completed. Top 5 candidates ranked.",
  "total_processed": 12,
  "candidates": [
    {
      "rank": 1,
      "name": "Jane Smith",
      "email": "jane@example.com",
      "phone": "+1 555 0100",
      "skills": ["Python", "React", "Docker"],
      "experience_years": 5.0,
      "semantic_score": 0.82,
      "skill_score": 0.75,
      "experience_score": 1.0,
      "final_score": 0.731,
      "file_name": "jane_smith_resume.pdf"
    }
  ]
}
```

### `GET /download-resume/{filename}`

Returns the resume file as a downloadable binary response.

---

## Duplicate Handling

`processed_resumes.json` tracks processed files by SHA-256 hash. If you run the pipeline again with the same files, they are skipped. To reprocess all files, delete `processed_resumes.json`.

---

## Notes

- First run downloads the MiniLM-L6-v2 model (~90MB) — cached locally after that
- spaCy `en_core_web_sm` must be downloaded once via `python -m spacy download en_core_web_sm`
- OneDrive cached files are stored in `backend/temp_cache/`
- No Docker, no database, no authentication required
