# AI-ATS — AI-Powered Applicant Tracking System

An end-to-end automated recruitment pipeline that processes job applications from Microsoft Outlook, extracts structured candidate data using NLP, performs semantic job matching via vector embeddings, ranks candidates, and presents results through an Excel report and a React recruiter dashboard.

---

## Architecture Overview

```
Outlook Emails
      │
      ▼ (Microsoft Graph API)
Role-Based Resume Storage
  Applications/
  ├── AI_Engineer/
  ├── Data_Scientist/
  ├── ML_Engineer/
  └── ...
      │
      ▼ (folder-by-folder)
JD Master (JD_Master.xlsx)  ──►  JD Retrieval
Duplicate Registry           ──►  Skip check
      │
      ▼
┌─────────────────────────────────────────┐
│        AI Processing Pipeline           │
│                                         │
│  1. Resume Parsing (spaCy NER)          │
│  2. Embedding (all-MiniLM-L6-v2)        │
│  3. FAISS Vector Store                  │
│  4. Semantic Matching (cosine sim)      │
│  5. Composite Scoring                   │
│     0.70×semantic + 0.20×skill          │
│     + 0.10×experience                  │
│  6. Candidate Ranking                   │
└─────────────────────────────────────────┘
      │
      ▼
PostgreSQL (persistent storage)
      │
      ├──► Excel Report (Candidate_Ranking.xlsx)
      │
      └──► FastAPI REST API
                 │
                 ▼
           React Dashboard
           (ranked candidates, filters,
            JD editor, resume download)
```

---

## Project Structure

```
ats_system/
├── config.py                   # Centralised settings (pydantic-settings)
├── main.py                     # FastAPI application entry point
├── cli.py                      # Command-line interface
├── requirements.txt            # Python dependencies
├── docker-compose.yml          # Full-stack Docker deployment
├── Dockerfile.api              # API service Docker image
│
├── models/
│   └── database.py             # SQLAlchemy async ORM models
│
├── pipeline/
│   ├── email_intake.py         # Microsoft Graph email polling
│   ├── resume_parser.py        # PDF/DOCX text extraction + NER
│   ├── embeddings.py           # Sentence-transformer embeddings
│   ├── vector_store.py         # FAISS per-role index management
│   ├── jd_manager.py           # JD_Master.xlsx + processed registry
│   ├── scorer.py               # Composite scoring + ranking
│   ├── excel_reporter.py       # Candidate_Ranking.xlsx generation
│   └── orchestrator.py         # Pipeline coordination
│
├── api/
│   └── routes.py               # All FastAPI routes (auth, roles, candidates...)
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx            # React entry point
│   │   └── App.jsx             # Full dashboard (login, candidates, JD editor)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile.frontend
│
└── tests/
    └── test_pipeline.py        # pytest unit tests
```

---

## Quick Start

### Option A — Docker Compose (recommended)

```bash
# 1. Clone and enter the project
cd ats_system

# 2. Create environment file
cat > .env << 'EOF'
MS_TENANT_ID=your-azure-tenant-id
MS_CLIENT_ID=your-app-client-id
MS_CLIENT_SECRET=your-client-secret
MS_USER_EMAIL=recruiter@yourcompany.com
SECRET_KEY=$(openssl rand -hex 32)
EOF

# 3. Seed the JD Master and folder structure
python cli.py seed-jd

# 4. Start all services
docker-compose up -d

# 5. Create a recruiter account
python cli.py create-user --email admin@company.com --password yourpassword

# 6. Open the dashboard
open http://localhost:3000
```

### Option B — Local development

```bash
# 1. Create a virtual environment
python -m venv venv && source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt
python -m spacy download en_core_web_lg

# 3. Start PostgreSQL (via Docker or local install)
docker run -d --name ats-pg -e POSTGRES_USER=ats_user \
  -e POSTGRES_PASSWORD=ats_pass -e POSTGRES_DB=ats_db \
  -p 5432:5432 postgres:16-alpine

# 4. Configure environment
cp .env.example .env   # then edit with your credentials

# 5. Seed job descriptions
python cli.py seed-jd

# 6. Create a user
python cli.py create-user --email admin@company.com --password secret

# 7. Start the API
uvicorn main:app --reload --port 8000

# 8. Start the frontend (in a separate terminal)
cd frontend && npm install && npm run dev
```

---

## Microsoft Graph API Setup

1. Go to **Azure Portal → Azure Active Directory → App registrations → New registration**
2. Name: `ATS-Resume-Reader`
3. Supported account types: *Accounts in this organizational directory only*
4. Under **API permissions**, add:
   - `Mail.Read` (Application permission)
   - `Mail.ReadWrite` (Application permission — to mark emails as read)
5. **Grant admin consent**
6. Under **Certificates & secrets**, create a new client secret
7. Copy the **Tenant ID**, **Client ID**, and **Client Secret** into your `.env`

---

## Running the Pipeline

```bash
# Process ALL role folders
python cli.py run

# Process a specific role only
python cli.py run --role AI_Engineer

# Check system status
python cli.py status
```

Via the API (after authentication):
```bash
# Trigger via REST
curl -X POST http://localhost:8000/pipeline/run \
  -H "Authorization: Bearer <token>"

# Check status
curl http://localhost:8000/pipeline/status \
  -H "Authorization: Bearer <token>"

# Download the Excel report
curl -OJ http://localhost:8000/reports/download \
  -H "Authorization: Bearer <token>"
```

---

## JD_Master.xlsx Schema

| Column               | Description                                  |
|----------------------|----------------------------------------------|
| Role Name            | Human-readable role title                    |
| Folder Name          | Must match the folder under `Applications/`  |
| Job Description      | Full JD text used for semantic embedding     |
| Must Have Skills     | Comma-separated required skills              |
| Good to Have Skills  | Comma-separated preferred skills             |
| Minimum Experience   | Integer years required                       |
| Status               | `Active` or `Inactive`                       |

---

## Scoring Algorithm

| Component            | Weight | Description                              |
|----------------------|--------|------------------------------------------|
| Semantic similarity  | 70%    | Cosine similarity of resume vs JD embeds |
| Skill match          | 20%    | Weighted Jaccard over must/nice skills   |
| Experience match     | 10%    | Years vs minimum required (penalised)    |

Final score is in `[0, 1]`.  Scores are persisted to PostgreSQL and shown in the dashboard.

---

## API Endpoints

| Method | Endpoint                         | Description                     |
|--------|----------------------------------|---------------------------------|
| POST   | `/auth/token`                    | Login (OAuth2 password)         |
| POST   | `/auth/register`                 | Register recruiter               |
| GET    | `/roles/`                        | List all job roles               |
| POST   | `/roles/`                        | Create role (syncs to Excel)     |
| PUT    | `/roles/{id}`                    | Update role                      |
| GET    | `/candidates/`                   | List candidates (with filters)   |
| GET    | `/candidates/{id}`               | Get candidate detail             |
| GET    | `/candidates/{id}/download`      | Download resume file             |
| POST   | `/pipeline/run`                  | Trigger pipeline (background)    |
| GET    | `/pipeline/status`               | Pipeline run status              |
| GET    | `/reports/download`              | Download Excel report            |
| POST   | `/upload/resume`                 | Manually upload a resume         |
| GET    | `/health`                        | Health check                     |

Full interactive docs at `http://localhost:8000/docs`

---

## Running Tests

```bash
pytest tests/ -v
```

---

## Configuration Reference (`.env`)

```env
DATABASE_URL=postgresql+asyncpg://ats_user:ats_pass@localhost:5432/ats_db

MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_USER_EMAIL=recruiter@company.com
EMAIL_POLL_INTERVAL_SECONDS=300

SECRET_KEY=   # openssl rand -hex 32
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DEVICE=cpu   # or cuda

WEIGHT_SEMANTIC=0.70
WEIGHT_SKILL=0.20
WEIGHT_EXPERIENCE=0.10

APPLICATIONS_DIR=Applications
JD_MASTER_PATH=JD_Master.xlsx
CANDIDATE_RANKING_OUTPUT=Outputs/Candidate_Ranking.xlsx
```

---

## Production Considerations

- **Secrets**: Use AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault — never commit `.env` to git
- **GPU acceleration**: Set `EMBEDDING_DEVICE=cuda` and use `faiss-gpu` for large scale (10k+ resumes)
- **Background jobs**: Replace `BackgroundTasks` with Celery + Redis for robust async processing
- **FAISS scaling**: For millions of vectors, switch from `IndexFlatIP` to `IndexIVFFlat` with proper nlist tuning
- **Email polling**: Consider Azure Event Grid webhooks instead of polling for real-time intake
- **Database**: Add connection pooling via PgBouncer in production
- **Monitoring**: Add Prometheus metrics endpoint and Grafana dashboard

---

## License

MIT — see LICENSE file.
