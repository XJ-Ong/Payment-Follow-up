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

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Saved follow-up rules are read-only in API mode. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; saved reminder versions, Finance/Owner approvals and simulated dispatch are now connected; AI and scheduled automation remain future work.

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

Set `VITE_API_URL=http://localhost:8000` and `VITE_DATA_MODE=api`. Restart Vite after changing environment variables. Backend `CORS_ORIGINS` is a comma-separated list of allowed local frontend origins. For a standalone template preview use `VITE_DATA_MODE=demo`; those template edits are not persisted. API mode saves invoices/payments and uses the current Malaysia date. Saved follow-up rules are read-only in API mode. Scoring, dashboard alerts and queue eligibility are calculated and saved by the backend; saved reminder versions, Finance/Owner approvals and simulated dispatch are now connected; AI and scheduled automation remain future work.

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
✅ Reminder drafts
✅ Approve, skip & snooze
✅ Activity log
✅ Simulated outbox
🟡 Weekly summary
✅ English/Bahasa Malaysia template reminders
❌ CSV import/export
❌ Milestone invoice suggestions
✅ Backup Finance approval during leave
✅ Two-person high-value approval
✅ Holiday-aware overdue calculation
❌ AI drafting, explanations & summaries
❌ Scheduled automation

## Saved reminders and approval workflow

Run `uv run alembic upgrade head` from `src/backend` before starting the API. Revision `0003` preserves invoice, payment, draft, approval and send history. It restores the existing draft-author mapping, adds immutable fact/policy snapshots and version supersession, adds invoice skip/snooze deadlines, and enforces one current draft per invoice plus distinct approvers per new version. Database triggers reject changes to saved message content and existing approval decisions. Legacy drafts/approvals remain explicitly historical and cannot be dispatched through the new workflow.

Revision `0004` adds an explicit latest-workspace event pointer, updated under the same company lock. Saved readback follows transaction order even when refresh timestamps are identical; older records remain unchanged.

The known synthetic default routing is migrated to primary Finance **Encik Razak**, backup Finance **Puan Nadia**, and Owner **Puan Farah**. Other routing configurations are preserved; custom companies must configure distinct company-scoped Finance/backup Finance/Owner users before using the workflow. Rules remain read-only in the current UI.

### Policy and lifecycle

1. Open an eligible queue invoice and choose **Create template draft**. Saved customer channel, language and tone select a deterministic English/Bahasa Malaysia template. No AI is called.
2. **Save new version** creates immutable content and facts, superseding the old version. The required invoice number, due date, exact outstanding balance and company name must remain in the text. Unsaved edits must be saved before submitting, approving or sending.
3. **Submit for Finance approval** routes the current version to primary Finance, or backup Finance during primary Finance's approved leave. Finance may approve a draft it prepared.
4. Outstanding balance **strictly above** the configured threshold (seed: MYR 20,000) requires a distinct Owner approval after Finance. Exactly MYR 20,000 requires only Finance. The policy is captured with the version and revalidated at submission/review; a changed policy or financial/contact facts invalidates the journey and requires a fresh version.
5. Editing after an approval closes the old version and starts Finance review again. **Edit and approve new version** is available only to the currently assigned first Finance approver; it never transfers the old version's approvals.
6. Owner leave leaves a high-value reminder waiting. Backup Finance never substitutes for Owner.
7. Final approval exposes an approved preview. **Simulate send** separately rechecks current facts, balance, status, contact suppression, per-invoice spacing and exact version-bound approvals. The outbox records the approved body and recipient atomically; repeated sends create no duplicates. Nothing is delivered externally.

Active journeys leave Today's Queue and remain accessible through **Reminder Workflow** and **Invoices & Payments**. Rankings retain them with a workflow exclusion reason. Full or partial payments and changed recipient/policy/eligibility invalidate active journeys during refresh; their old approvals remain historical. A sent invoice can return after its configured reminder spacing if it still qualifies.

**Skip today** and **Snooze** close the current journey and its approval validity. Skip expires at the next Malaysia midnight; snooze expires at midnight on the chosen future Malaysia date. Expiry allows ordinary queue eligibility to be checked again and requires a new draft/approvals. These changes persist across reloads.

### Demo identities and leave

`X-Role` remains the simulated role switch. Optional `X-User-ID` selects a concrete mock identity and must match both the role and company. Omitting it keeps the existing default Owner/primary Finance identities. This is demo identity, not real authentication. The Finance user selector exposes primary and backup users; authorship, payments and audit events use the selected user.

To exercise approved-leave fixtures, set these backend variables in the root `.env` and restart the API:

```env
DEMO_FINANCE_LEAVE=true
DEMO_OWNER_LEAVE=false
```

With Finance leave enabled, submit a reminder, select **Puan Nadia (Backup Finance)** and approve as that user. Set Owner leave to true to verify that high-value reminders wait after Finance approval. Leave fixtures cover the adapter's startup reference date from one day before through two days after; restart to reset a demo scenario. Real leave data would come from the Orbyte adapter.

### Workflow API

- `GET /api/users`: available company Owner/Finance demo users and default identity flags.
- `POST /api/invoices/{invoice_id}/drafts`: create an eligible template draft.
- `GET /api/invoices/{invoice_id}/drafts`: immutable version history with authors and decisions.
- `POST /api/drafts/{draft_id}/{action}`: actions `versions`, `submit`, `approve`, `edit-approve`, `skip`, `snooze`, `send`.
- Every version action requires `{ "version": 1 }` for the exact current version; edits also require `body`, suppression accepts `reason`, and snooze requires `snooze_until` as an ISO date. Stale versions/conflicting states return 409, unauthorized identities/assignments return 403, and invalid content/dates return 422.
- `GET /api/outbox`, `GET /api/activity`, `GET /api/invoices/{invoice_id}/timeline`: company-scoped saved dispatches and activity.
- Follow-up workspaces now include each invoice's `workflow`, current/latest version, assignment, suppression deadline and actor-specific `allowed_actions`. Financial status remains separate. Permissions are recomputed for the requesting identity rather than trusting the permissions in a prior saved workspace.

Blocked sends create audit events and no dispatch. Missing configuration also blocks sending. Other failed conflicting edits are rolled back. All writes share the existing company rule-row lock, so approval, payment, version and dispatch races cannot bypass the workflow.

### Run and verify

```powershell
# Backend terminal
cd src/backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
# Frontend terminal, from the repository root
npm run dev
```

Use API mode (`VITE_DATA_MODE=api`). Start with Queue -> Create template draft -> Reminder Workflow -> Finance approval -> Owner approval when required -> approved preview -> Simulate send -> Simulated Outbox/Activity Log. Reload between steps to verify persistence. Standalone demo mode keeps the original template behavior.

```powershell
# From src/backend
uv run pytest tests -q
$env:RUN_BROWSER_TESTS='1'
uv run pytest tests -q -s
# From repository root
npm test
npm run build
$env:PLAYWRIGHT_CHANNEL='msedge'
npm run test:e2e
```

Tests use isolated temporary databases. The leave-control endpoint used by browser tests is registered only on the test harness, never on the production API. AI, real Email/WhatsApp delivery, automatic scheduling, CSV/milestones and full weekly reporting remain outside this milestone.


Verification for this milestone: 75 backend unit/integration tests, nine frontend model tests, five API browser journeys (including the mobile workflow drawer), and the standalone template regression suite. Fresh seed/reset is tested in a temporary database, including reapplying migrations when immutability functions already exist. Migration checks report no ungenerated schema changes. The development database retains 21 invoices, eight payments and its three existing draft/approval/send records each.


### Follow-ups workspace

In API mode, open **Follow-ups** to work through **Ready > Drafts > Awaiting approval > Ready to send > Sent**. **Deferred** contains active skips and snoozes. Stage counts and permissions come from saved backend results; Sent shows saved simulated dispatches, including historical records.

Select the demo identity at the top of the workspace. Open a reminder to see its progress, next responsible person and primary action. Save edits as a new version before submitting; editing reviewed content resets approvals. Standard reminders require Finance; reminders above MYR 20,000 require Finance then a distinct Owner. Approval remains separate from **Simulate send**.

The reminder stays open after each transition. Closing returns to its current stage. Use **More actions** for skip/snooze, and expand **Invoice, payment and calculation details** to record a payment or inspect scoring. Payment-driven invalidation and blocked eligibility explain why an action is unavailable. Saved receipts, versions and activity remain available after reload. Standalone demo navigation is unchanged.

UX verification: 75 backend regression tests passed (browser wrapper skipped in the default run), 9 frontend unit tests passed, 7 API browser journeys passed, 4 standalone demo browser tests passed, and the production build and changed-file formatting checks passed. Browser coverage includes sent receipts/history, stage transitions, Finance/Owner approval, leave routing, payment invalidation, skip/snooze across reload, failed-save text retention, keyboard tabs and mobile containment.

Temporary testing helper: when running the Vite development app in API mode, Owner and Finance can click **Add test data** beside Demo identity. With the seeded defaults this adds seven uniquely prefixed TEST invoices: standard, high value, exact approval threshold, partial payment, paid, future due and do-not-contact. Existing records are kept; every click adds a fresh batch through the ordinary invoice/payment APIs. Dates use the loaded Malaysia reference date and overdue examples account for saved grace/safety rules. The app opens Follow-ups > Ready after adding them; paid/future/blocked examples remain in Invoices & Payments. The helper is hidden from production builds and standalone demo mode. If a request fails partway, the notification reports how many invoices were saved.
