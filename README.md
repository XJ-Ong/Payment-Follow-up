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
| ORM and schema | SQLAlchemy 2.0, `create_all` plus a seed script (no migrations in the MVP) |
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
| `app.db.init_db` | creates any missing tables (`create_all`); never drops or alters existing ones | yes |
| `app.db.seed` | inserts the demo world (1 rule set, 10 client profiles, 20 invoices, 5 payments, 3 reminder histories); refuses to run twice | yes — prints `Already seeded` |
| `app.db.seed --reset` | **drops all tables**, recreates and reseeds | **destructive** — wipes anything you entered |

**Notes**

* Steps 3–7 must run from `src/backend/` — the `app` package lives there (from the repo root you get `No module named app`).
* Demo dates are **relative to the day you seed** (an invoice due 40 days ago stays 40 days overdue whenever the demo runs). To refresh them, re-run `app.db.seed --reset`.
* There is no migration tool in the MVP: after changing a model, re-create from scratch with `app.db.seed --reset`.
* Browse the data in **Adminer** at <http://localhost:8080> — server `db` (the Compose service name, *not* `localhost`), username `followup`, password `followup_dev_password`, database `followup`.
* Stop the database with `docker compose down`; add `-v` to also delete the data volume (after that, run `init_db` and `seed` again).