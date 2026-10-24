# Payment Follow-up API — CSV & Rules Reference

All endpoints are simulated for the hackathon demo. Authentication is **not** real: roles are passed via headers.

## Common headers

| Header | Values | Notes |
|---|---|---|
| `X-Role` | `Owner`, `Finance`, `Other Staff` | Required on every business endpoint. `Other Staff` receives `403` everywhere; only Owner/Finance are permitted. |
| `X-User-ID` | Orbyte user UUID (optional) | Defaults: `USR-01` (Owner), `USR-02` (Finance). For Finance with a specific user, pass e.g. `USR-05`. |

Errors: `403` invalid role, `409` conflict/stale revision, `422` validation.

---

## CSV Import

Column format (exact headers and order, case-sensitive):

```
invoice_no,customer_id,issue_date,due_date,total_amount,initial_payment
```

- `customer_id` — Orbyte customer UUID (use the template or `GET /api/invoices` to look up IDs). The customer must have a configured follow-up profile.
- Dates — `YYYY-MM-DD`. `due_date` must be on/after `issue_date`.
- Amounts — plain decimals, no currency symbols or thousands separators, max 2 decimal places. `total_amount` > 0; `initial_payment` ≥ 0 and ≤ total (may be empty → treated as `0`).
- Limits — max 500 rows, max 1 MiB, UTF-8 (BOM tolerated).
- Duplicate `invoice_no` within the file or already existing in the company blocks the row.

### Download template

```
GET /api/invoices/import/template
```

Returns `text/csv` with one example row: `invoice-template.csv`.

### Preview (read-only validation)

```
POST /api/invoices/import/preview
Content-Type: application/json

{ "csv_text": "<raw CSV content>" }
```

Response (`CsvPreview`):

```json
{
  "rows": [
    {
      "row_number": 2,
      "values": { "invoice_no": "...", "customer_id": "...", "issue_date": "...", "due_date": "...", "total_amount": "...", "initial_payment": "..." },
      "customer_name": "Restoran Pak Ali",
      "outstanding_amount": "900.00",
      "errors": [ { "column": "due_date", "message": "Use YYYY-MM-DD." } ]
    }
  ],
  "file_errors": [],
  "valid_count": 1,
  "invalid_count": 0,
  "can_import": true,
  "total_amount": "1000.10",
  "initial_payment": "100.10",
  "outstanding_amount": "900.00"
}
```

`can_import` is true only when there is at least one row, no file errors, and no invalid rows. Any invalid row blocks the entire import.

### Import

```
POST /api/invoices/import
Content-Type: application/json

{ "csv_text": "<raw CSV content>" }
```

- Runs the same validation as preview; on any error returns `409` with `{ "detail": "...", "preview": { ... } }` and **no data is saved** (atomic).
- Each imported invoice records one initial payment (received on the issue date) when `initial_payment` > 0.
- Response `200`: `{ "imported_count": 4, "workspace": { ... } }` (full refreshed workspace).
- Invoice numbers already in the company → `409`.

---

## CSV Export

```
GET /api/invoices/export/csv
```

**Permissions:** Owner or Finance (`Other Staff` → `403`).

**Response headers:**

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="invoices-export-YYYY-MM-DD.csv"
```

**Format:** identical to the import template — the export can be edited and re-imported directly (round-trip safe):

```
invoice_no,customer_id,issue_date,due_date,total_amount,initial_payment
INV-2001,3f0a...,2026-08-15,2026-09-14,15000.00,5000.00
```

**Behaviour:**

- Excludes `void` invoices; includes fully paid ones.
- `initial_payment` = total of **all** recorded payments for that invoice (summed, not just the first); empty when no payments.
- Ordered by issue date descending, then invoice number.

**JavaScript download example:**

```javascript
const response = await fetch('/api/invoices/export/csv', {
  headers: { 'X-Role': currentRole, 'X-User-ID': currentUserId }
});

if (response.ok) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'invoices-export.csv';
  a.click();
  window.URL.revokeObjectURL(url);
}
```

---

## Invoice & Workspace

### List invoices

```
GET /api/invoices
```

**Permissions:** Owner or Finance. Returns `{ "invoices": [ ...InvoiceView ], "as_of_date": "YYYY-MM-DD" }` with adapter-backed customer preferences and Malaysia-localised `as_of_date`.

### Create invoice

```
POST /api/invoices
Content-Type: application/json

{ "invoice_no": "...", "client_id": "<uuid>", "issue_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD", "total_amount": "5000.00",
  "initial_payment": "0.00",            // optional
  "project_id": "<uuid>", "milestone_id": "<uuid>",  // optional (S12)
  "source": "manual" }                  // optional; derived from milestone_id when omitted
```

**Errors:** `409` "Invoice number already exists", `422` "Unknown customer" / "Due date must be on or after issue date".

### Record payment

```
POST /api/invoices/{invoice_id}/payments
Content-Type: application/json

{ "amount": "500.00", "received_date": "YYYY-MM-DD",
  "payment_type": "deposit|partial|full",   // optional
  "reference_number": "..." }               // optional
```

**Errors:** `422` "Payment exceeds outstanding balance or invoice is void", `422` "Full payment must equal outstanding balance".

### Workspace view

```
GET /api/followups
```

Full personalized `WorkspaceView` — same shape as the response of `POST /api/followups/refresh` (customers, invoices with `calculation`, rules, dashboard, queue/alerts).

```
POST /api/followups/refresh
```

Recomputes priority scores and today's queue. Logs `followups.refreshed` (excluded from the activity feed). This is the manual alternative to the optional scheduler job.

---

## Reminder Drafts & Approval Workflow

The draft state machine: `draft` → (submit) → `pending_approval` → (approve) → `approved` → (send) → `sent`. Every action requires a body of `{ "version": <int> }` (optimistic concurrency: use the draft's current `version`).

### Create a draft

```
POST /api/invoices/{invoice_id}/drafts
```

Generates a reminder (AI when enabled, otherwise template) in the customer's language/tone/channel. Returns `201` with a `DraftView` (`status: "draft"`, `written_by: "ai" | "template"`, `allowed_actions`).

### List draft versions

```
GET /api/invoices/{invoice_id}/drafts
```

All versions, newest first.

### Draft actions

```
POST /api/drafts/{draft_id}/{action}
Content-Type: application/json

{ "version": 1 }
```

| Action | From state | Effect |
|---|---|---|
| `submit` | `draft` | Sends for approval; routes to the assigned approver (leave backup supported). |
| `approve` | `pending_approval` | Records an approval. High-value drafts (`second_approval_amount`) need Owner as second approver. |
| `edit-approve` | `pending_approval` | Approve with an edited body: `{ "version": 1, "body": "..." }`. |
| `skip` | `draft` / `pending_approval` | Closes the draft with a `reason`. |
| `snooze` | `draft` / `pending_approval` | Pauses until `snooze_until` (date). |
| `send` | `approved` | Simulated dispatch into the outbox — **no real message is ever sent**. |

**Permissions:** acting user must match the assigned approver for `approve`/`edit-approve`; otherwise `403` "Action is not permitted for this user or workflow state".

### Outbox (simulated sending)

```
GET /api/outbox
```

Prepared/sent message previews with `status: "simulated"` and the target `channel`.

### Timeline & activity

```
GET /api/invoices/{invoice_id}/timeline    # activity for one invoice
GET /api/activity                          # company-wide audit trail
```

Each row: `action`, `actor_type` (`user` / `system`), `actor_id`, `actor_name`, `entity_type`, `entity_id`, `created_at`, `details`.

---

## Customers & Users

```
GET  /api/customers/{client_id}/profile     # follow-up profile (tier, grace days, channel, language, tone, do-not-contact)
POST /api/customers/{client_id}/profile     # update (Owner or Finance; optimistic revision)
GET  /api/users                             # simulated directory (Owner/Finance/backup approvers)
```

**Errors:** `404` "Customer not found", `422` `Customer has no contact detail for {channel}`.

---

## Health

```
GET /api/health
```

`200` when the database is reachable, `503` "Database unavailable" otherwise.

---

## Milestone Billing Suggestions

Auto-suggest an invoice from a completed project milestone (S12). Milestone,
project and client data come from Orbyte; "already billed" is answered from
our invoice table (`invoice.milestone_id` is the single source of truth).

### List unbilled milestones

```
GET /api/milestones/unbilled
```

**Permissions:** Owner or Finance.

**Response** (`200`):

```json
{
  "milestones": [
    {
      "milestone_id": "00000000-0000-4000-8000-000000000402",
      "milestone_name": "Phase 2 Racking Installation & Handover",
      "milestone_value": "15000.00",
      "completed_date": "2026-10-23",
      "project_id": "00000000-0000-4000-8000-000000000301",
      "project_name": "Warehouse Racking & Structural Upgrade",
      "client_id": "00000000-0000-4000-8000-000000000204",
      "client_name": "BinaJaya Contractors Sdn Bhd",
      "payment_terms_days": 30
    }
  ],
  "count": 2
}
```

**Behaviour:**

- Returns only **completed** milestones (have `completed_date`)
- Excludes milestones already linked to a non-void invoice
- Skips cancelled projects
- Sorted by completion date (oldest first) — most urgent to bill
- Empty array if no unbilled milestones
- In the demo seed, `MLS-01` is already invoiced (INV-2035), so the demo
  shows **2** unbilled milestones: `MLS-02` and `MLS-03`

**Use case:** a "Ready to Bill" list in the frontend → user selects one →
suggest invoice.

---

### Suggest invoice for milestone

```
GET /api/milestones/{milestone_id}/suggest-invoice
```

**Permissions:** Owner or Finance.

**Path parameters:**
- `milestone_id` — UUID of the completed milestone

**Response** (`200`):

```json
{
  "invoice_no": "INV-20261024-000402",
  "client_id": "00000000-0000-4000-8000-000000000204",
  "project_id": "00000000-0000-4000-8000-000000000301",
  "milestone_id": "00000000-0000-4000-8000-000000000402",
  "issue_date": "2026-10-23",
  "due_date": "2026-11-22",
  "total_amount": "15000.00",
  "source": "milestone",
  "_context": {
    "milestone_name": "Phase 2 Racking Installation & Handover",
    "project_name": "Warehouse Racking & Structural Upgrade",
    "client_name": "BinaJaya Contractors Sdn Bhd",
    "payment_terms_days": 30
  }
}
```

**Calculations:**
- `invoice_no` — auto-generated: `INV-YYYYMMDD-<6-char-id-suffix>`
- `issue_date` — milestone's `completed_date`
- `due_date` — `issue_date` + project's `payment_terms` (default 30 if unset)
- `total_amount` — milestone's `amount`
- `_context` — metadata for UI display only (not persisted to the invoice)

**Errors:**
- `404 Milestone not found` — unknown milestone id
- `409 Cannot bill incomplete milestone` — milestone not completed yet
- `409 Milestone already billed` — a non-void invoice already references it

---

### Creating the invoice (frontend flow)

1. User clicks "Suggest Invoice" on a milestone
2. `GET /api/milestones/{id}/suggest-invoice` → pre-filled invoice data
3. Show in modal/form (user can edit `invoice_no`, `due_date`, `total_amount`)
4. User clicks "Create Invoice"
5. `POST /api/invoices` with the edited data — **include `project_id`,
   `milestone_id` and `source: "milestone"`** so the invoice links back to
   the milestone and it disappears from the unbilled list

```js
const suggestion = await fetch(`/api/milestones/${id}/suggest-invoice`, { headers }).then(r => r.json());

await fetch('/api/invoices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Role': 'Finance' },
  body: JSON.stringify({
    invoice_no: suggestion.invoice_no,       // maybe edited
    client_id: suggestion.client_id,
    issue_date: suggestion.issue_date,
    due_date: suggestion.due_date,           // maybe edited
    total_amount: suggestion.total_amount,   // maybe edited
    project_id: suggestion.project_id,       // pass through
    milestone_id: suggestion.milestone_id,   // pass through
    source: suggestion.source                // "milestone"
  })
});
```

`POST /api/invoices` now accepts optional `project_id`, `milestone_id` and
`source` fields. The database enforces one invoice per milestone (unique
index), so a duplicate link returns `409`. The suggested `invoice_no` is
**not** reserved — if it is taken by the time the user submits, `POST`
returns `409` and the user must change the number.

---

## AI Features

Payment Follow-up uses AI to draft reminders, explain rankings, and generate weekly summaries. All AI features have template fallbacks and require human approval.

### AI Drafting (AI-1)

**How it works:**
- System automatically generates draft reminders for invoices in Today's Queue
- AI writes message in customer's preferred language and tone
- Number verification ensures amounts/dates match exactly
- Falls back to template if AI unavailable or verification fails
- Draft marked with "AI-written" or "Template" tag

**Metadata stored:**
- `written_by`: "ai" or "template"
- `ai_model`: model name (e.g., "meta-llama/Llama-2-7b-chat-hf")
- `prompt_version`: version string for tracking
- `verification_result`: number check details

**Guardrails:**
- AI never sends (approval required)
- Numbers verified against source data
- No legal threats or service disruption mentions
- Template fallback on any failure

### Ranking Explanations (AI-2)

**Where used:** Dashboard and Today's Queue

**Example:**
> "BinaJaya Contractors has RM 15,000.00 outstanding for 10 days, scoring 150,000 RM-days above the alert threshold."

Currently template-based (deterministic). Can be upgraded to AI in future.

### Weekly Summary (AI-3)

**Endpoint:** `POST /api/summaries/generate`

**Request:**
```json
{
  "week_start": "2026-10-21",
  "week_end": "2026-10-27",
  "language": "English"
}
```

**Response:**
```json
{
  "summary_id": "uuid"
}
```

**Then fetch:** `GET /api/summaries/{summary_id}`

Returns:
- `metrics`: calculated numbers (code-driven)
- `narrative`: AI-written paragraph (or template)
- `written_by`: "ai" or "template"

---

## Scheduler (Optional)

The system can automate daily scoring refresh and weekly summary generation. This is **optional** — all features remain accessible via manual REST endpoints.

### Configuration

Set environment variables to enable:

```bash
ENABLE_SCHEDULER=true  # Enable automated jobs
DAILY_CHECK_HOUR=9  # Hour (0-23) in Malaysia time
ENABLE_WEEKLY_SUMMARY=true  # Optional: auto-generate weekly summaries
WEEKLY_SUMMARY_DAY=monday  # Day for weekly summary
WEEKLY_SUMMARY_HOUR=9  # Hour for weekly summary
```

### Daily Scoring Refresh

**Schedule:** Daily at configured hour (default 9 AM MYT)  
**Action:** Calls `refresh_workspace()` to recalculate all priority scores  
**Logging:** Creates activity log entry with action `scheduler.daily_scoring`

**Equivalent manual operation:**
```bash
POST /api/followups/refresh
```

### Weekly Summary Generation

**Schedule:** Weekly on configured day at configured hour (optional)  
**Action:** Generates summary for previous Monday-Sunday  
**Logging:** Creates activity log entry with action `scheduler.weekly_summary`

**Equivalent manual operation:**
```bash
POST /api/summaries/generate
Body: {"week_start": "2026-10-21", "week_end": "2026-10-27"}
```

### Activity Log

Scheduler jobs log to activity log with `actor_type: "system"`:
- `scheduler.daily_scoring` - successful daily refresh
- `scheduler.daily_scoring_failed` - daily refresh error
- `scheduler.weekly_summary` - successful weekly summary
- `scheduler.weekly_summary_failed` - weekly summary error

**Query scheduler logs:**
```bash
GET /api/activity
```
(Filter responses by `action` containing `scheduler`.)

### Disabling

Set `ENABLE_SCHEDULER=false` (default) to disable all automated jobs. The application works identically with manual operations.

---

## Company Rules

### Get current rules

```
GET /api/settings/rules
```

**Permissions:** Owner or Finance.

```json
{
  "revision": 3,
  "grace_days_by_tier": { "New": 0, "Regular": 7, "Key": 14 },
  "alert_threshold": "50000.00",
  "safety_flag_days": 30,
  "min_spacing_days": 7,
  "skip_holidays": false,
  "primary_approver_id": "00000000-0000-4000-8000-000000000102",
  "backup_approver_id": "00000000-0000-4000-8000-000000000105",
  "owner_approver_id": "00000000-0000-4000-8000-000000000101",
  "second_approval_amount": "100000.00"
}
```

Money fields are strings to preserve precision. Tier keys are capitalized: `New` / `Regular` / `Key`.

### Update rules

```
POST /api/settings/rules
Content-Type: application/json
```

**Permissions:** **Owner only** (Finance → `403 Only Owner can edit company rules`).

```json
{
  "revision": 3,
  "grace_days_by_tier": { "New": 0, "Regular": 10, "Key": 14 },
  "alert_threshold": "60000.00",
  "safety_flag_days": 30,
  "min_spacing_days": 7,
  "skip_holidays": false,
  "second_approval_amount": "100000.00"
}
```

**Notes:**

- `revision` is **required** (optimistic concurrency). Send the value from the latest `GET`; if it changed in the meantime the API returns `409 Saved values changed. Reload saved values before saving again.`
- Validation: `revision` ≥ 1; grace days 0..2147483647 per tier; `safety_flag_days` > 0; `min_spacing_days` ≥ 0; amounts ≥ 0 (alert ≤ 14 digits / 2 dp, second approval ≤ 12 digits / 2 dp). Unknown fields are rejected (`422`).
- Approver IDs (`primary_approver_id`, `backup_approver_id`, `owner_approver_id`) are set by seeding/configuration, not by this endpoint.
- Every accepted change is written to the activity log as `rules.updated` with full before/after state, bumps `revision`, and refreshes the workspace (invalidating affected journeys).
- No-op saves (nothing changed) return normally without logging or bumping the revision.

**Response** (`200`):

```json
{
  "workspace": { ... },
  "invalidated_journeys": 0
}
```

`workspace` is the full personalized `WorkspaceView` (same shape as `GET /api/followups`) so the frontend can refresh everything in one round-trip. `invalidated_journeys` counts drafts whose journeys were invalidated by the rule change.

---

## Field descriptions (rules)

| Field | Meaning |
|---|---|
| `grace_days_by_tier` | Extra days before follow-up starts, per customer tier (`New`/`Regular`/`Key`) |
| `alert_threshold` | Score (RM × days overdue) at or above which an alert is raised |
| `safety_flag_days` | Days overdue that always raise an alert regardless of amount |
| `min_spacing_days` | Minimum days between reminders to the same customer |
| `second_approval_amount` | Outstanding amount at or above which Owner second approval is required |
| `skip_holidays` | Exclude Malaysian public holidays from overdue-day calculations |
| `revision` | Optimistic-concurrency token; increments on every persisted change |
