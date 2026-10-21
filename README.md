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
 