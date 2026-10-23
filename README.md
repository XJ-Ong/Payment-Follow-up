# Payment Follow-up

A plugin concept for Orbyte's Work module that helps SMEs decide who to chase for late payment, drafts the reminder, and lets a person approve it.

> Orbyte's platform services (identity, roles, approvals, audit trail, client and project data) are **simulated** in this repo. Every Orbyte-side field and API is our own assumption.

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

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Saved follow-up rules are read-only in API mode. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; durable reminder workflow, dual approvals and dispatch remain future integration work.

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

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Saved follow-up rules are read-only in API mode. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; durable reminder workflow, dual approvals and dispatch remain future integration work.

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
🟡 Customer profiles
🟡 Rules & settings
🟡 Reminder drafts
🟡 Approve, skip & snooze
🟡 Activity log
🟡 Simulated outbox
🟡 Weekly summary
🟡 English/Bahasa Malaysia reminders
❌ CSV import/export
❌ Milestone invoice suggestions
❌ Backup approval during leave
❌ Two-person high-value approval
✅ Holiday-aware overdue calculation
❌ AI drafting, explanations & summaries
❌ Scheduled automation

## Scoring, alerts and daily queue milestone

Apply `uv run alembic upgrade head` in `src/backend` before starting the API. Revision `0002` adds saved eligibility/calculation fields, makes rank optional for unranked invoices, widens score capacity and prevents duplicate alerts for the same snapshot, recipient and channel. Existing invoice/payment records are preserved. Conflicting duplicate legacy alerts cause migration to stop for review, rather than deleting history.

### Policy

- Reference dates use `Asia/Kuala_Lumpur`; timestamps are timezone-aware.
- Outstanding = max(0, invoice total - recorded payments).
- Overdue days = days after the due date through the reference date. Optional holiday mode excludes distinct adapter-supplied public holidays in this interval. Weekends still count. Holiday mode defaults to off.
- Effective days = max(0, overdue days - tier grace). Score = outstanding x effective days, in RM-days.
- Threshold alert: score **at least** the configured threshold. Safety alert: overdue days **at least** the configured safety age. Both triggers can apply; the safety rule can trigger even while inside a longer grace period.
- Queue = alert-triggered invoices that are overdue, have a positive balance, are not paid/void, allow contact, and meet reminder spacing. Spacing is **per invoice**, using its latest simulated send date in Malaysia time. Exactly the configured spacing passes.
- Rankings include unpaid overdue invoices even when contact or spacing blocks the queue. Order: score descending, overdue days descending, invoice number ascending, UUID ascending. Paid, future and void invoices remain accessible under Invoices & Payments but have no active rank.
- Dashboard totals exclude void invoices and include do-not-contact balances. The backend returns customer balances, scores, ranks, eligibility and explanations; frontend local rule previews cannot override API-mode calculations.
- Missing company rules, incomplete grace configuration, missing customer profiles or an invalid primary approver return a configuration error (409). These errors roll back invoice/payment writes too.

Default seed rules: New/Regular/Key grace 0/7/14 days, threshold 50,000 RM-days, safety age 30 days, spacing five days. These are configurable demo assumptions, not researched business rules. Rules are read-only in the API UI for this milestone.

### Worked examples

| Invoice scenario | Calculation | Result |
|---|---|---|
| MYR 2,500 outstanding, 40 days overdue, New tier | 2,500 x (40 - 0) = 100,000 | Both rules; queue if contact/spacing permit |
| MYR 500 outstanding, 40 days overdue, New tier | 500 x 40 = 20,000 | Safety rule only; queue if eligible |
| MYR 10,000 outstanding, 5 days overdue, Regular tier | 10,000 x max(0, 5 - 7) = 0 | No alert; outside queue |
| First scenario, last sent two days ago | Same score; five-day spacing fails | Ranked with exclusion reason; outside queue |
| First scenario, do-not-contact customer | Same score; contact check fails | Ranked and included in balances; outside queue |
| Invoice paid in full | Outstanding and score become zero | Retained snapshot, no active rank or queue entry |

### Follow-up API

- `POST /api/followups/refresh`: calculate and persist today's results, then return the typed workspace. No request body is required.
- `GET /api/followups`: read the last successful saved workspace without creating records. Before the first successful refresh, returns an empty workspace with `computed_at: null`.
- Both require `X-Role: Owner` or `Finance`. Existing invoice/payment endpoints remain available and refresh eligibility inside their write transactions.
- The workspace contains `as_of_date`, `computed_at`, `customers`, `invoices` with `calculation`, `rules`, `dashboard`, `queue_ids` and `alerts`. Money and score values are decimal strings; dates are ISO dates. GET returns the saved reference date, which may be earlier than today until refreshed.

Snapshots are refreshed in place for the current Malaysia date; earlier dates are preserved. Current-day snapshots also retain paid/ineligible invoices with null ranks. Company rule-row locking serializes refreshes and invoice/payment writes. Each successful refresh appends an audit event containing the saved workspace for consistent readback, including empty datasets. Failures keep the last successful workspace intact.

Dashboard alerts go to the configured primary approver; leave routing is deferred. Refresh preserves existing alert decisions. It updates current trigger details and dismisses active alerts that lose eligibility, belong to an earlier date or have an outdated recipient. It does not reopen an already dismissed/actioned decision; queue eligibility is separate from alert acknowledgement. No email, WhatsApp or reminder dispatch is performed.

Initial API-mode load, Refresh now and successful invoice/payment writes use the backend workspace. Dashboard shows rankings and active alerts; Today's Queue uses eligibility instead of approval status. Calculation details show exclusions and holiday/spacing inputs. Standalone `VITE_DATA_MODE=demo` remains a local template preview.

### Verification

The backend suite covers scoring boundaries, holiday/weekend/year boundaries, Malaysia midnight, per-invoice spacing, duplicate/concurrent refreshes, alert decisions, historical snapshots, transactional rollback, migration compatibility, permissions and company isolation. With `RUN_BROWSER_TESTS=1`, it also runs real API browser checks for payment persistence, rankings, suppression reasons and queue removal after payment/reload. Template browser screenshots are written to ignored `test-results/` so tests do not overwrite reference artwork.

Saved reminder drafting, version-bound approvals, leave routing, two-person approval, simulated dispatch, AI and scheduled refresh jobs remain subsequent milestones. Refresh is manual/on-load/on-write; there is no automatic daily scheduler yet.
