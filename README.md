# Payment Follow-up

A plugin concept for Orbyte's Work module that helps SMEs decide who to chase for late payment, drafts the reminder, and lets a person approve it.

> Orbyte's platform services (identity, roles, approvals, audit trail, client and project data) are **simulated** in this repo. Every Orbyte-side field and API is our own assumption.

---

## Architecture

**Current messaging scope:** Telegram sends real messages; WhatsApp and email remain simulated. The standalone transport is implemented, but integration with approvals, database delivery records and the frontend is pending. See the [messaging setup and team integration contract](docs/messaging.md) before integrating. The architecture below includes planned services, not only completed features.

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

## Database setup (local)

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) (with Compose), [Python 3.12+](https://www.python.org/downloads/), and [uv](https://docs.astral.sh/uv/).

On Windows, install `uv` and a supported Python version from PowerShell:

```powershell
winget install --id=astral-sh.uv -e
winget install --id=Python.Python.3.12 -e
```

Restart PowerShell after installation, then verify:

```powershell
uv --version
python --version
```

If `python --version` still reports an older version, use uv's managed Python directly:

```powershell
uv python install 3.12
```

From the repo root:

```bash
# 1. Create your local config (first time only)
cp .env.example .env

# 2. Start PostgreSQL + Adminer
docker compose up -d

# 3. Enter the backend project
cd src/backend

# 4. Install Python dependencies (creates .venv from uv.lock)
uv sync

# 5. Check the connection (prints the PostgreSQL version)
uv run python check_db.py

# 6. Create the 11 tables
uv run python -m app.db.init_db

# 7. Load the demo data
uv run python -m app.db.seed
```

| Command | What it does | Safe to re-run? |
|---|---|---|
| `check_db.py` | connects to the container and prints the server version | yes |
| `app.db.init_db` | applies Alembic migrations; verifies an existing schema before baseline adoption | yes |
| `app.db.seed` | inserts the demo world (1 rule set, 10 client profiles, 20 invoices, 5 payments, 3 reminder histories); refuses to run twice | yes — prints `Already seeded` |
| `app.db.seed --reset` | **drops all tables**, recreates and reseeds | **destructive** — wipes anything you entered |

**Notes**

* Steps 3–7 must run from `src/backend/` — the `app` package lives there (from the repo root you get `No module named app`).
* Demo dates are **relative to the day you seed** (an invoice due 40 days ago stays 40 days overdue whenever the demo runs). To refresh them, re-run `app.db.seed --reset`.
* Use Alembic for schema changes; review generated revisions and commit them with model changes. Do not reset the database to apply a model change.
* Browse the data in **Adminer** at <http://localhost:8080> — server `db` (the Compose service name, *not* `localhost`), username `followup`, password `followup_dev_password`, database `followup`.
* Stop the database with `docker compose down`; add `-v` to also delete the data volume (after that, run `init_db` and `seed` again).

## Connected invoice/payment milestone

The frontend now defaults to the FastAPI API. Owner and Finance can create invoices and record payments; Other Staff is restricted. The former draft-only role has been removed. `X-Role` is a demo switch, not production authentication.

From the repository root, configure `.env` using `.env.example`, then start PostgreSQL:

```powershell
docker compose up -d db
cd src/backend
uv sync
uv run alembic upgrade head
uv run python -m app.db.seed
uv run uvicorn app.main:app --reload --port 8000
```

In another terminal, from the repository root:

```powershell
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Owner can edit saved company rules in API mode; Finance and Owner can edit customer follow-up preferences. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; saved reminder versions, Finance/Owner approvals and simulated dispatch are now connected; AI and scheduled automation remain future work.

### Production security headers

The Vite development and preview servers emit baseline response headers for the frontend:
Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
Referrer-Policy and Permissions-Policy. The API emits the protections that apply to API
responses. API HSTS is enabled only when `ENABLE_HSTS=true`, because HSTS must not be sent
over local HTTP.

For production, configure the public HTTPS reverse proxy or hosting platform to preserve these
headers on every frontend response, redirect HTTP to HTTPS, and set `ENABLE_HSTS=true` for the
API. Set a production `VITE_API_URL` so the generated CSP `connect-src` allows the real API
origin. Verify the public URL with the [Mozilla HTTP Observatory](https://observatory.mozilla.org/)
after deployment; a B grade is 70–79 points, but the exact score can change as Observatory tests
and modifiers evolve. Do not use the local demo `X-Role` header as production authentication.

### API contract

- `GET /api/health`: database connectivity; 503 when unavailable.
- `GET /api/invoices`: invoice rows, adapter-backed customers/preferences and Malaysia `as_of_date`.
- `POST /api/invoices`: `invoice_no`, `client_id` (UUID), `issue_date`, `due_date`, `total_amount`, optional `initial_payment`.
- `POST /api/invoices/{uuid}/payments`: `amount`, `received_date`, optional `payment_type` (`deposit`, `partial`, `full`) and `reference_number`.

Business routes require `X-Role: Owner` or `Finance`. Unsupported/missing roles and Other Staff return 403; invalid inputs return 422; duplicate invoice numbers return 409. API money fields use decimal strings and dates use `YYYY-MM-DD`. Invoice responses include total, summed payments and calculated outstanding balance. Payment writes lock the invoice, reject overpayment and update financial status in the same transaction, including audit events.

### Migrations and checks

The initial revision uses a frozen schema snapshot. On a fresh database it creates the eleven plugin tables. On an existing database it compares the schema and adopts it only when compatible, preserving records. If it reports differences, review and reconcile them before retrying; do not blindly stamp the database. Baseline downgrade is disabled. Seeds are separate and do not overwrite existing invoices.

```powershell
# In src/backend
uv run alembic revision --autogenerate -m "describe schema change"
# Review the generated migration before applying it
uv run alembic upgrade head
uv run pytest tests -q
# At repository root
npm test
npm run build
npm run test:e2e
```

Backend integration tests create and remove a uniquely named temporary database on the configured PostgreSQL server; the local development user needs CREATE DATABASE permission. They do not write to the development database. Browser template tests explicitly use demo mode; API browser tests cover the persistent journey separately.

To include the real API browser persistence check (using the installed Edge browser):

```powershell
# In src/backend; the test manages its temporary database and API server
$env:RUN_BROWSER_TESTS='1'
uv run pytest tests -q
```

For standalone template browser checks on this Windows setup, set `$env:PLAYWRIGHT_CHANNEL='msedge'` before `npm run test:e2e`, or install the Playwright Chromium browser.


## Connected invoice/payment milestone

The frontend now defaults to the FastAPI API. Owner and Finance can create invoices and record payments; Other Staff is restricted. The former draft-only role has been removed. `X-Role` is a demo switch, not production authentication.

From the repository root, configure `.env` using `.env.example`, then start PostgreSQL:

```powershell
docker compose up -d db
cd src/backend
uv sync
uv run alembic upgrade head
uv run python -m app.db.seed
uv run uvicorn app.main:app --reload --port 8000
```

In another terminal, from the repository root:

```powershell
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Owner can edit saved company rules in API mode; Finance and Owner can edit customer follow-up preferences. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; saved reminder versions, Finance/Owner approvals and simulated dispatch are now connected; AI and scheduled automation remain future work.

### API contract

- `GET /api/health`: database connectivity; 503 when unavailable.
- `GET /api/invoices`: invoice rows, adapter-backed customers/preferences and Malaysia `as_of_date`.
- `POST /api/invoices`: `invoice_no`, `client_id` (UUID), `issue_date`, `due_date`, `total_amount`, optional `initial_payment`.
- `POST /api/invoices/{uuid}/payments`: `amount`, `received_date`, optional `payment_type` (`deposit`, `partial`, `full`) and `reference_number`.

Business routes require `X-Role: Owner` or `Finance`. Unsupported/missing roles and Other Staff return 403; invalid inputs return 422; duplicate invoice numbers return 409. API money fields use decimal strings and dates use `YYYY-MM-DD`. Invoice responses include total, summed payments and calculated outstanding balance. Payment writes lock the invoice, reject overpayment and update financial status in the same transaction, including audit events.

### Migrations and checks

The initial revision uses a frozen schema snapshot. On a fresh database it creates the eleven plugin tables. On an existing database it compares the schema and adopts it only when compatible, preserving records. If it reports differences, review and reconcile them before retrying; do not blindly stamp the database. Baseline downgrade is disabled. Seeds are separate and do not overwrite existing invoices.

```powershell
# In src/backend
uv run alembic revision --autogenerate -m "describe schema change"
# Review the generated migration before applying it
uv run alembic upgrade head
uv run pytest tests -q
# At repository root
npm test
npm run build
npm run test:e2e
```

Backend integration tests create and remove a uniquely named temporary database on the configured PostgreSQL server; the local development user needs CREATE DATABASE permission. They do not write to the development database. Browser template tests explicitly use demo mode; API browser tests cover the persistent journey separately.

To include the real API browser persistence check (using the installed Edge browser):

```powershell
# In src/backend; the test manages its temporary database and API server
$env:RUN_BROWSER_TESTS='1'
uv run pytest tests -q
```

For standalone template browser checks on this Windows setup, set `$env:PLAYWRIGHT_CHANNEL='msedge'` before `npm run test:e2e`, or install the Playwright Chromium browser.

Module Progress

✅ Frontend layout & navigation
✅ Database & migrations
✅ Frontend-backend connection
✅ Invoice listing & creation
✅ Payment recording
✅ Outstanding balance calculation
✅ Simulated roles - Preparer removed
✅ Dashboard
✅ Priority scoring & daily queue
✅ Customer profiles
✅ Rules & settings
✅ Reminder drafts
✅ Approve, skip & snooze
✅ Activity log
✅ Simulated outbox
🟡 Weekly summary
✅ English/Bahasa Malaysia template reminders
✅ Fixed-template CSV invoice import; export remains pending
✅ Milestone invoice suggestions
✅ Backup Finance approval during leave
✅ Two-person high-value approval
✅ Holiday-aware overdue calculation
✅ AI drafting, explanations & summaries (template fallback functional)
❌ Scheduled automation
