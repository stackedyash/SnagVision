# SiteIQ — Interior Construction Monitoring Platform

AI-powered construction progress tracking for IEVO. Built for POC demo.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Tailwind + Recharts |
| Backend | FastAPI + SQLAlchemy |
| AI | Gemini API (multimodal image analysis) |
| Database | PostgreSQL 16 |
| Storage | Google Cloud Storage (local fallback for POC) |
| Vector DB | ChromaDB (for embedding history) |

---

## Quick start — Docker (recommended)

```bash
# 1. Clone and enter directory
cd siteiq

# 2. Copy and fill env file
cp backend/.env.example backend/.env
# → Add your COHERE_API_KEY at minimum

# 3. Start all services
docker-compose up --build

# 4. Open
# Frontend:  http://localhost:5173
# API docs:  http://localhost:8000/docs
```

---

## Manual setup (no Docker)

### Prerequisites
- Python 3.11+
- Node 20+
- PostgreSQL running locally

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — add COHERE_API_KEY and DATABASE_URL

# Create DB
createdb siteiq

# Run
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `COHERE_API_KEY` | Yes | Get from dashboard.cohere.com |
| `GCS_BUCKET_NAME` | No | GCS bucket (falls back to ./uploads/) |
| `GCS_PROJECT_ID` | No | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Path to GCS service account JSON |
| `SECRET_KEY` | Yes | JWT signing key — change in prod |

---

## POC walkthrough

1. **Register** at `/login` or use demo creds
2. Go to **Project setup** → create project → add floors → add units → add rooms
3. Go to **Upload** → select room → drag photos → click Upload & Analyse
4. Cohere AI analyses the image in background (~5–10 seconds)
5. Check **AI Analysis** page → see component-level breakdown + radar chart
6. Check **Floor view** → room heatmap updates automatically
7. Check **Executive dashboard** → overall progress, floor chart, delay tracker

---

## API endpoints

```
POST   /auth/register              Register user
POST   /auth/login                 Login (returns JWT)

GET    /projects                   List all projects
POST   /projects                   Create project
GET    /projects/{id}/dashboard    Executive dashboard data

POST   /projects/{id}/floors       Add floor
GET    /projects/floors/{id}/units Add unit
POST   /projects/units/{id}/rooms  Add room

POST   /uploads                    Upload media (triggers AI)
GET    /uploads/room/{id}          List room uploads

GET    /analysis/room/{id}/latest         Latest AI result
GET    /analysis/room/{id}/change-detection  History
```

Full interactive docs at `http://localhost:8000/docs`

---

## GCS setup (optional for POC)

If GCS creds not provided, all uploads save to `backend/uploads/` and serve via `/uploads/` route.
For production: create a GCS bucket, download service account JSON, set path in `.env`.

---

## Notes for sir demo

- All AI calls go through Cohere's `command-r-plus` model
- If Cohere vision isn't available on your tier, the service auto-falls back to text simulation
- Progress aggregation: room → unit → floor → project rollup triggers automatically after each upload
- Change detection flags: `progress` (+5%), `stalled` (≤2%), `rework` (−5%)
