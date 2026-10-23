# Remove the Preparer role (align codebase with Solution v2.0)

**Date:** 23 Oct 2026 | **Status:** approved (team decision, solution_v2.md §14)

## Context

Solution.md v1.1 defined four roles (Owner, Finance, Preparer, Other staff). v2.0 removes the Preparer: the AI/system drafts automatically, and Owner or Finance is the single human reviewer. Roles are now Owner, Finance, Other staff. The DB and Orbyte adapter were built against v1.1; this change aligns them.

## Scope

Only the data/adapter layer exists so far (`app/api`, `app/services`, frontend are empty), so the change is small. "Drop completely" = no preparer user, no preparer references, and the `prepared_by` column is removed, not repurposed.

## Changes

1. **`app/orbyte/fixture.py`** — remove user USR-03 (Cik Aina, role `preparer`); world becomes 3 users. Update docstring and role comment to `owner | finance | other_staff`.
2. **`app/orbyte/schemas.py`** — `AppUser.role` comment becomes `owner, finance, other_staff`.
3. **`app/orbyte/protocol.py`** — `get_user` docstring drops "preparers".
4. **`app/db/models.py`** — delete `ReminderDraft.prepared_by` column.
5. **`app/db/seed.py`** — delete `PREPARER_ID` and its use on seeded reminder-history drafts.
6. **Re-seed** — `uv run python -m app.db.seed --reset` (no migrations in MVP; synthetic data is fully regenerable per README).

## Not changed (already v2-compatible)

- `FollowupRule` approver columns: seed already sets primary=Finance, backup=Owner, matching v2 D9.
- Scoring, approval steps, send-log, leave routing, role comments elsewhere (none reference preparer).
- README (no preparer mentions).

## Verification

- `grep -ri preparer src/` returns nothing.
- Backend imports cleanly; `app.db.seed --reset` succeeds against local Postgres (if running).
