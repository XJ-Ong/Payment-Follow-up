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
