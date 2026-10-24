# Running on Replit

This import keeps its existing React/Vite frontend and FastAPI/PostgreSQL backend.

- Use Run to start the **Payment Follow-up** workflow. It runs Vite on port 5000
  and FastAPI on the internal port 8000.
- Vite proxies `/api` to FastAPI. The browser uses same-origin requests, so there
  is no need to set `VITE_API_URL` for Replit.
- Python dependencies are installed in Replit's managed Python environment.
  The root `pyproject.toml` and `uv.lock` record that environment; the original
  backend package remains under `src/backend`.
- `DATABASE_URL` is supplied by Replit. Never copy credentials into source files.
- The development database was initialized with the repository's migrations
  and sample invoices. To initialize an empty development database manually:
  `cd src/backend && python -m app.db.seed`. Do not use `--reset` unless you intend
  to delete the data. Do not add database migrations or seeds to server startup.

## Development-only demo

Development environment settings enable `DEMO_MODE=true`, `VITE_DATA_MODE=api`
and `AI_MODE=template`. Roles and Orbyte services are simulated, not authenticated.
Use only sample data. Do not publish with simulated roles enabled.
Template reminders need no AI key. AI model access and real Telegram delivery
require separate service configuration and have not been enabled.

## Checks

- Frontend: `npm run build`
- Frontend model tests: `npm test` (Node 22 is configured for TypeScript support).
- Backend: `cd src/backend && python -m pytest tests`
  (tests create and clean up isolated temporary PostgreSQL databases).

## Publishing configuration

Replit builds the Vite frontend with `npm run build` and runs FastAPI with
`bash scripts/start-prod.sh`. FastAPI serves the built frontend and its `/api`
routes from the same origin. These commands are configured for Autoscale
publishing.

Publishing this demo does not add real authentication. `DEMO_MODE` is
development-only and production API requests fail closed until authentication
is implemented. Do not enable the simulated role headers on a public deployment.

Known imported test issue: `test_suggest_invoice_issue_date_is_completed_date`
compares the server's UTC date with Malaysia-local fixture dates, and can fail
between midnight and 08:00 Malaysia time. This is separate from Replit startup.
