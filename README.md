# Payment Follow-up

A plugin concept for Orbyte's Work module that helps SMEs decide who to chase for late payment, drafts the reminder, and lets a person approve it.

> Orbyte's platform services (identity, roles, approvals, audit trail, client and project data) are **simulated** in this repo. Every Orbyte-side field and API is our own assumption.

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- [Python 3.12+](https://www.python.org/downloads/)
- [uv](https://docs.astral.sh/uv/) for Python dependency management
- [Node.js 18+](https://nodejs.org/) for the frontend


### 1. Database Setup

```bash
# Copy environment config
cp .env.example .env

# Start PostgreSQL
docker compose up -d db

# Navigate to backend
cd src/backend

# Install dependencies
uv sync

# Run migrations and seed data
uv run python -m app.db.init_db
uv run python -m app.db.seed
```

### 2. Start Backend

```bash
# From src/backend
uv run uvicorn app.main:app --reload --port 8000
```

Backend runs at: http://localhost:8000

### 3. Start Frontend

```bash
# From project root
npm install
npm run dev
```

Frontend runs at: http://localhost:5173

### 4. Test AI Integration (Optional)

```bash
# Test Ollama/AI connection
curl -X POST http://localhost:8000/api/ai-test
```

See [OLLAMA_INTEGRATION.md](OLLAMA_INTEGRATION.md) for AI setup details.

---

## Architecture

```
+---------------------------------------------------------------+
|  Browser: React (Vite) single-page app                        |
+------------------------------+--------------------------------+
                               | HTTPS, JSON (/api/...)
                               | X-Role header (simulated login)
+------------------------------v--------------------------------+
|  FastAPI application (one deployable service)                 |
|                                                               |
|  API routes (thin; role checked in one dependency)            |
|        |                                                      |
|  Services (plain Python, no web or DB code in the logic)      |
|   - scoring        deterministic, unit-tested                 |
|   - workflow       drafts, approvals, second approver         |
|   - ai_service     prompt -> model -> number check -> fallback|
|   - audit          append-only activity log                   |
|   - scheduler      daily check (APScheduler)                  |
|        |                                  |                   |
+--------+----------------------------------+-------------------+
         |                                  |
+--------v----------+            +----------v-------------------+
| PostgreSQL        |            | Orbyte adapter (Protocol)    |
| our own tables    |            |  MockOrbyteAdapter -> JSON   |
|                   |            |  OrbyteApiAdapter (future)   |
+-------------------+            +------------------------------+

+----------------------------------+
| Runpod Serverless endpoint       |  called only by ai_service
| open model served with vLLM      |  (OpenAI-compatible API)
+----------------------------------+
```


---

## Tech stack

| Layer | Choice |
|---|---|
| Backend language and framework | Python, FastAPI |
| Validation | Pydantic |
| Money | `Decimal` in Python, `NUMERIC` in Postgres, currency MYR |
| Time | Store UTC, calculate days overdue in `Asia/Kuala_Lumpur` |
| Database | PostgreSQL |
| ORM and schema | SQLAlchemy 2.0, Alembic migrations plus a separate seed script |
| Frontend | React, Vite, Tailwind CSS, shadcn/ui, Recharts |
| Scheduler | APScheduler inside the FastAPI process, plus a Refresh now button |
| AI model | served with vLLM on a Runpod Serverless endpoint |
| AI client | `openai` Python library pointed at the Runpod URL |
| Orbyte simulation | Python `Protocol` interface, `MockOrbyteAdapter` reading JSON seed files |
| Roles | Simulated: role switcher sends `X-Role`, checked by a FastAPI dependency |
| Testing | pytest |
| Local development | Docker Compose for a per-developer Postgres |
| Hosting | Replit (Reserved VM), with its own Replit PostgreSQL |
| Source control | GitHub: `main` (final, deployed), `dev` (integration), personal branches |

The frontend source is in [`src/frontend`](src/frontend), while the backend package is in
[`src/backend`](src/backend).

---

## Configuration

Key environment variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql+psycopg2://followup:followup_dev_password@localhost:5432/followup

# AI (optional)
AI_MODE=template  # or 'ai' to enable
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=https://your-ollama-endpoint/v1
AI_MODEL=qwen2.5-coder:1.5b

# Demo mode (enables X-Role header simulation)
DEMO_MODE=true

# Frontend
VITE_API_URL=http://localhost:8000
VITE_DATA_MODE=api

# Scheduler (optional)
ENABLE_SCHEDULER=false
DAILY_CHECK_HOUR=9
```

---

## Development

### Database Commands

```bash
# From src/backend

# Check connection
uv run python check_db.py

# Run migrations
uv run alembic upgrade head

# Seed demo data
uv run python -m app.db.seed

# Reset database (destructive!)
uv run python -m app.db.seed --reset

# Create new migration
uv run alembic revision --autogenerate -m "description"
```

**Browse data:** Adminer at http://localhost:8080
- Server: `db`
- Username: `followup`
- Password: `followup_dev_password`
- Database: `followup`

### Testing

```bash
# Backend tests (from src/backend)
uv run pytest tests -q

# Frontend tests (from project root)
npm test
npm run test:e2e

# Include browser API tests
$env:RUN_BROWSER_TESTS='1'  # PowerShell
uv run pytest tests -q
```

### API Endpoints

**Health:**
- `GET /api/health` - Database connectivity check

**Invoices:**
- `GET /api/invoices` - List invoices
- `POST /api/invoices` - Create invoice
- `POST /api/invoices/{id}/payments` - Record payment

**Workflow:**
- `GET /api/workspace` - Dashboard data
- `POST /api/followups/refresh` - Refresh priority scores
- `GET /api/queue` - Today's follow-up queue
- `POST /api/drafts/{id}/approve` - Approve reminder

**Settings:**
- `GET /api/settings/rules` - Company rules
- `POST /api/settings/rules` - Update rules
- `GET /api/customers/{id}/profile` - Customer profile

**AI:**
- `POST /api/ai-test` - Test AI connection

**Auth:** All business routes require `X-Role: Owner` or `Finance` (demo mode only)

---

## Security

**Demo Mode:**
- `DEMO_MODE=true` enables `X-Role` header simulation
- **NOT** real authentication - logs warning on startup
- Disable on any public deployment

**Production Requirements:**
- Real JWT/session authentication
- Multi-tenant company scoping
- Secrets manager for AI keys
- HTTPS with HSTS (`ENABLE_HSTS=true`)
- Proper CORS configuration

**Built-in Protections:**
- Rate limiting (1200 req/min default)
- CORS validation at startup
- AI prompt sanitization (injection protection)
- Number verification on AI outputs
- Audit logging for all actions

---

## Optional Features

### Scheduler

Automate daily scoring and weekly summaries:

```bash
# In .env
ENABLE_SCHEDULER=true
DAILY_CHECK_HOUR=9
ENABLE_WEEKLY_SUMMARY=true
WEEKLY_SUMMARY_DAY=monday
WEEKLY_SUMMARY_HOUR=9
```

Without scheduler, use manual endpoints or "Refresh Now" button.

---

## Project Status

✅ **Completed:**
- Frontend layout & navigation
- Database & migrations
- Invoice management & payments
- Priority scoring & daily queue
- Customer profiles & rules
- Reminder drafts with approve/skip/snooze
- Activity log & audit trail
- Role-based access (Owner, Finance, Other Staff)
- English/Bahasa Malaysia support
- CSV import/export
- Milestone invoice suggestions
- Backup approver during leave
- Two-person high-value approval
- Holiday-aware calculations
- AI drafting with template fallback
- Optional scheduled automation

🟡 **In Progress:**
- Real messaging (Telegram partial, WhatsApp/Email simulated)
- Weekly summary refinements

---

## Troubleshooting

**"No module named app"**
- Run commands from `src/backend`, not project root

**Port already in use**
- Change `--port 8000` to another port
- Or stop other services using the port

**Database connection failed**
- Ensure Docker is running: `docker compose ps`
- Check DATABASE_URL in `.env`

**AI unavailable**
- Set `AI_MODE=template` to use templates
- Or configure Ollama endpoint

**Frontend can't reach API**
- Check VITE_API_URL matches backend port
- Verify CORS_ORIGINS includes frontend URL
- Restart Vite after .env changes

---

## License

[Apache 2.0](LICENSE)