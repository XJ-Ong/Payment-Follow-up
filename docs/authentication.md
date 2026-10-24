# Private team authentication and publishing

The default is real session authentication (`AUTH_MODE=session`,
`VITE_AUTH_MODE=session`). There is no public signup and no default account.
Login accounts attach to existing Orbyte staff IDs; their role comes from the
adapter, preserving approval assignments, leave routing, and audit history.
This release supports the existing single company and Owner/Finance identities.

## Local setup

From the project root, install frontend dependencies with `npm install`. In
`src/backend`, install backend dependencies and migrate:

```bash
uv sync
uv run alembic upgrade head
uv run python -m app.manage_accounts list-staff
uv run python -m app.manage_accounts provision --staff USR-01 --email owner@your-company.com
```

Use your real team login email; the command prompts privately for a 12–128
character password and confirmation. Never put passwords on the command line.
`--staff` accepts the UUID printed by `list-staff` or an existing `USR-01` code.
Each staff identity and login email can have only one account. Use the command
again with an eligible Finance staff ID to give a Finance user access.

Set these non-secret configuration values in the root `.env`:

```dotenv
AUTH_MODE=session
DEMO_MODE=false
APP_ENV=development
APP_ORIGIN=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
VITE_AUTH_MODE=session
VITE_DATA_MODE=api
VITE_API_URL=http://localhost:8000
```

Keep `DATABASE_URL` and any provider credentials in `.env` or the deployment's
secret store. Start the backend with `uv run uvicorn app.main:app --reload --port
8000` from `src/backend`, and `npm run dev` from the project root. Open
`http://localhost:5173`. Use the same hostname for frontend and backend during
local development (both `localhost`, or both `127.0.0.1`) for cookie consistency.
Restart backend/frontend development processes after configuration changes.

## Local demo user seed

After migrating, run this from `src/backend`:

```bash
uv run python -m app.manage_accounts seed-users
```

This creates missing demonstration accounts for existing Owner, Finance, and
Backup Finance staff. It is repeatable and never overwrites existing staff logins,
resets changed passwords, or re-enables disabled accounts. If you already provisioned
an account for a staff identity, that account is preserved and its demo login is skipped.

Refresh the local login page to see the active seeded emails and passwords at the
bottom. Click an account to fill the form, then sign in. Only enabled accounts still
using their original seeded passwords show a password. Your existing Owner login is
also listed by email, with a prompt to enter its current password; that password is
never exposed or reset.

The section is development-only and is absent from published builds. The endpoint
returns no credentials in production; seeding is refused there, and the known demo
passwords cannot authenticate or retain sessions in production. Before publishing a
seeded database, disable the demonstration accounts or reset their passwords privately.

## Account recovery and revocation

From `src/backend`:

```bash
uv run python -m app.manage_accounts reset-password --email owner@your-company.com
uv run python -m app.manage_accounts disable --email finance@your-company.com
```

Password reset asks for a new password privately. Both operations revoke all
sessions for that account. Resetting a password also clears that account's login
throttle. Disabling does not change historical staff assignments or approvals.
A disabled account cannot sign in, including after a password reset.

## Replit publishing

Use the existing Reserved VM deployment with the PostgreSQL database. No
authentication provider or email service is needed. Provision the Owner in the
**deployment's database**, not just a separate development database.

Set production secrets/configuration:

```dotenv
APP_ENV=production
AUTH_MODE=session
DEMO_MODE=false
APP_ORIGIN=https://your-actual-published-host.replit.app
ENABLE_SCHEDULER=false
```

Also configure `DATABASE_URL`, plus AI/Telegram secrets only for features you use.
`APP_ORIGIN` must be the exact public HTTPS origin, without a trailing slash or
path; change it if you move to a custom domain. Production startup refuses demo
authentication and missing/invalid public origin configuration. Enable scheduled
jobs separately once publishing works; a single VM avoids duplicate scheduler
instances.

Build command, from the repository root:

```bash
npm ci
npm run build:publish
cd src/backend
uv sync --frozen
uv run alembic upgrade head
```

Start command, from the repository root (configure Replit's exposed port as 8000):

```bash
cd src/backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`build:publish` forces real login, API-backed data, and same-origin `/api` calls,
overriding development `VITE_*` values. FastAPI serves `dist/` and the API on one
port; do not publish the Vite development server. Secure session cookies rely on
Replit's public HTTPS connection. Session state resides in PostgreSQL and survives
server restarts. Do not expose a separate unprotected backend.

After deploying, verify the login page loads, unauthenticated `/api/invoices`
returns 401, valid credentials work, logout revokes access, and Finance cannot
save Owner-only rules. Public `/api/health` returns only service status. API docs
are disabled in production. Serve different app instances from the same database
if scaling later; keep scheduled jobs single-instance.

## API session contract

- `POST /api/auth/login`: JSON `{ "email": "...", "password": "..." }` with an
  allowed `Origin`. Returns `{ "user": { "id", "name", "role" }, "csrf_token" }`
  and an HttpOnly SameSite=Lax session cookie (Secure in production).
- `GET /api/auth/me`: with the cookie, returns the same user and CSRF token.
- `POST /api/auth/logout`: cookie, JSON `{}`, allowed `Origin`, and
  `X-CSRF-Token`; revokes the session, clears the cookie, and returns 204.
- All business API routes require the cookie. Mutations additionally require
  JSON content, an allowed `Origin`, and `X-CSRF-Token`. Browser-supplied `X-Role`
  and `X-User-Id` never change the authenticated identity in session mode.
- `/api/ai-test` also requires Owner access. Its previous unauthenticated terminal
  command must now include a signed-in session and request token.

Session tokens are random, stored only as hashes, and expire after eight hours.
Authentication responses and API data use `Cache-Control: no-store`. Five failed
sign-ins per normalized email in a 15-minute window trigger a temporary throttle;
unknown and disabled accounts receive the same invalid-credentials message.
Passwords are Argon2-hashed and are never returned. There are no browser-stored
bearer tokens or public account provisioning endpoints.

## Demo and tests

Header simulation is available only when the backend is explicitly configured
with `AUTH_MODE=demo` and `DEMO_MODE=true`. The corresponding frontend must use
`VITE_AUTH_MODE=demo`. `VITE_DATA_MODE=demo` chooses the standalone fixture preview;
`VITE_DATA_MODE=api` uses a demo-header backend. Neither is a publishing setting.

Backend tests set demo mode explicitly for existing workflow suites and test
real sessions separately against isolated databases. Browser tests use separate
Vite instances for demo workflows and the session login flow. Run:

```bash
npm run build:publish
npm run test:e2e
cd src/backend
uv run pytest tests -q
```
