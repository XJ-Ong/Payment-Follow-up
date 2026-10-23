"""
This is data only: seed.py turns it into database rows.

Conventions (the pack's originals, preserved):

- External ids ("CLI-02") translate to our uuids via app.ids.external_uuid.
- Day offsets are SIGNED and relative to today: negative = past, 0 = today,
  positive = future. Dates materialise at seed time, so "40 days overdue"
  stays true whenever the demo runs.
- Money is a string ("50000.00") -> Decimal at load. Never floats.
- Enum codes are lowercase ("new", "whatsapp", "bm") and map to the
  canonical spellings our CHECK constraints expect inside seed.py.

The scenarios in the comments match the team's golden answers pack
(expected rank, score and trigger per invoice — held outside this repo),
the oracle the scoring engine will be validated against.
"""

# One configurable rule row per company (Solution §4.1 / §5 defaults).
RULES = {
    "company_id": "COMP-01",
    "grace_days": {"new": 0, "regular": 7, "key": 14},
    "alert_threshold": 50000,
    "safety_flag_days": 30,
    "min_days_between_reminders": 5,
    "second_approval_amount": 20000,
    "skip_holidays": False,
}

# Follow-up profiles: only OUR columns. Client names, trades and contact
# details are Orbyte-owned and live in app/orbyte/fixture.py; contact_name /
# phone / email here feed the seeded reminder-history wording only.
CLIENT_PROFILES = [
    # CLI-01 Kedai Kopi Harmoni — §5 Client A: small & old, safety-rule only
    {
        "client_id": "CLI-01",
        "contact_name": "Encik Lim",
        "phone": "+60123456701",
        "email": "lim@kopiharmoni.my",
        "tier": "new",
        "preferred_channel": "whatsapp",
        "language": "bm",
        "tone": "friendly",
        "do_not_contact": False,
    },

    # CLI-02 Seri Maju Trading — §5 Client B: big & old, top rank + 2nd approval
    {
        "client_id": "CLI-02",
        "contact_name": "Puan Chong",
        "phone": "+60123456702",
        "email": "accounts@serimaju.com.my",
        "tier": "regular",
        "preferred_channel": "whatsapp",
        "language": "en",
        "tone": "neutral",
        "do_not_contact": False,
    },

    # CLI-03 TechNova Solutions — §5 Client C & §6.4 example draft
    {
        "client_id": "CLI-03",
        "contact_name": "Mr Tan",
        "phone": "+60123456703",
        "email": "tan@technova.my",
        "tier": "new",
        "preferred_channel": "whatsapp",
        "language": "en",
        "tone": "friendly",
        "do_not_contact": False,
    },

    # CLI-04 BinaJaya Contractors — key tier, deposit & partial + milestone
    {
        "client_id": "CLI-04",
        "contact_name": "Ir. Zulkifli",
        "phone": "+60123456704",
        "email": "finance@binajaya.my",
        "tier": "key",
        "preferred_channel": "email",
        "language": "bm",
        "tone": "firm",
        "do_not_contact": False,
    },

    # CLI-05 Metro Logistics Hub — multiple overdue invoices, same customer
    {
        "client_id": "CLI-05",
        "contact_name": "Mr Rajan",
        "phone": "+60123456705",
        "email": "billing@metrologistics.my",
        "tier": "regular",
        "preferred_channel": "whatsapp",
        "language": "en",
        "tone": "firm",
        "do_not_contact": False,
    },

    # CLI-06 Golden Spoon Catering — grace days > days overdue edge case
    {
        "client_id": "CLI-06",
        "contact_name": "Cik Nadia",
        "phone": "+60123456706",
        "email": "nadia@goldenspoon.my",
        "tier": "key",
        "preferred_channel": "whatsapp",
        "language": "en",
        "tone": "friendly",
        "do_not_contact": False,
    },

    # CLI-07 Warisan Packaging — do-not-contact = True edge case
    {
        "client_id": "CLI-07",
        "contact_name": "Haji Roslan",
        "phone": "+60123456707",
        "email": "roslan@warisanpack.my",
        "tier": "regular",
        "preferred_channel": "email",
        "language": "bm",
        "tone": "neutral",
        "do_not_contact": True,
    },

    # CLI-08 Apex Printworks — due today, not-yet-due and fully paid invoices
    {
        "client_id": "CLI-08",
        "contact_name": "Ms Michelle",
        "phone": "+60123456708",
        "email": "michelle@apexprint.my",
        "tier": "new",
        "preferred_channel": "whatsapp",
        "language": "en",
        "tone": "friendly",
        "do_not_contact": False,
    },

    # CLI-09 Selangor Fresh Mart — spacing-rule edge case + small overdue
    {
        "client_id": "CLI-09",
        "contact_name": "Encik Hafiz",
        "phone": "+60123456709",
        "email": "hafiz@selangorfresh.my",
        "tier": "regular",
        "preferred_channel": "whatsapp",
        "language": "bm",
        "tone": "friendly",
        "do_not_contact": False,
    },

    # CLI-10 MegaKemuncak Engineering — high-value key past grace + overpaid
    {
        "client_id": "CLI-10",
        "contact_name": "Dato' Kelvin",
        "phone": "+60123456710",
        "email": "ap@megakemuncak.com.my",
        "tier": "key",
        "preferred_channel": "email",
        "language": "en",
        "tone": "neutral",
        "do_not_contact": False,
    },
]

# 20 invoices covering every §5 / §12.3 scenario. Payments are embedded
# (seed.py splits them into payment_record rows); last_reminded_offset_days
# seeds the spacing-rule history as draft -> approval -> send_log.
INVOICES = [
    # §5 Client B: big & old (40d overdue, Regular grace) + 2nd approval >RM20k
    {
        "invoice_id": "INV-01",
        "invoice_no": "INV-2038",
        "client_id": "CLI-02",
        "project_id": "PRJ-02",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -70,
        "due_offset_days": -40,
        "total_amount": "50000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Key tier with RM5k deposit (RM35k left, 29d overdue) + 2nd approval
    {
        "invoice_id": "INV-02",
        "invoice_no": "INV-2031",
        "client_id": "CLI-10",
        "project_id": "PRJ-06",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -60,
        "due_offset_days": -29,
        "total_amount": "40000.00",
        "payments": [{"amount": "5000.00", "type": "deposit", "offset_days": -55}],
        "status_override": None,
        "last_reminded_offset_days": -10,
    },

    # Do-not-contact: ranked on dashboard, but NO draft generated
    {
        "invoice_id": "INV-03",
        "invoice_no": "INV-2030",
        "client_id": "CLI-07",
        "project_id": None,
        "milestone_id": None,
        "source": "csv",
        "issue_offset_days": -55,
        "due_offset_days": -25,
        "total_amount": "18000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Partly paid (RM30k - RM10k = RM20k left, Key 14d grace) + milestone source
    {
        "invoice_id": "INV-04",
        "invoice_no": "INV-2035",
        "client_id": "CLI-04",
        "project_id": "PRJ-01",
        "milestone_id": "MLS-01",
        "source": "milestone",
        "issue_offset_days": -52,
        "due_offset_days": -22,
        "total_amount": "30000.00",
        "payments": [{"amount": "10000.00", "type": "partial", "offset_days": -12}],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Same customer invoice 1 of 2: crosses 50k score threshold
    {
        "invoice_id": "INV-05",
        "invoice_no": "INV-2044",
        "client_id": "CLI-05",
        "project_id": "PRJ-03",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -45,
        "due_offset_days": -15,
        "total_amount": "12000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": -7,
    },

    # §5 Client C & §6.4 draft: New tier, RM8,000, 10d past due
    {
        "invoice_id": "INV-06",
        "invoice_no": "INV-2041",
        "client_id": "CLI-03",
        "project_id": "PRJ-04",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -40,
        "due_offset_days": -10,
        "total_amount": "8000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Spacing rule: score > 50k (66,000), but reminded 2d ago (< 5d spacing)
    {
        "invoice_id": "INV-07",
        "invoice_no": "INV-2039",
        "client_id": "CLI-09",
        "project_id": None,
        "milestone_id": None,
        "source": "csv",
        "issue_offset_days": -48,
        "due_offset_days": -18,
        "total_amount": "6000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": -2,
    },

    # Safety rule + key tier: score 52,500 & 35d overdue
    {
        "invoice_id": "INV-08",
        "invoice_no": "INV-2022",
        "client_id": "CLI-04",
        "project_id": "PRJ-01",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -65,
        "due_offset_days": -35,
        "total_amount": "2500.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # §5 Client A: small & old (RM500, 40d, score 20k < 50k, safety rule ONLY)
    {
        "invoice_id": "INV-09",
        "invoice_no": "INV-2019",
        "client_id": "CLI-01",
        "project_id": None,
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -70,
        "due_offset_days": -40,
        "total_amount": "500.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Deposit paid + safety rule only (RM800 left, 32d overdue, score 25,600)
    {
        "invoice_id": "INV-10",
        "invoice_no": "INV-2025",
        "client_id": "CLI-01",
        "project_id": None,
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -62,
        "due_offset_days": -32,
        "total_amount": "1200.00",
        "payments": [{"amount": "400.00", "type": "deposit", "offset_days": -60}],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Overdue but below threshold (score 27,000 < 50k, 6d < 30d safety)
    {
        "invoice_id": "INV-11",
        "invoice_no": "INV-2048",
        "client_id": "CLI-03",
        "project_id": "PRJ-04",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -36,
        "due_offset_days": -6,
        "total_amount": "4500.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Regular tier past grace (12d - 7d = 5d eff, score 16,000, no alert)
    {
        "invoice_id": "INV-12",
        "invoice_no": "INV-2046",
        "client_id": "CLI-09",
        "project_id": None,
        "milestone_id": None,
        "source": "csv",
        "issue_offset_days": -42,
        "due_offset_days": -12,
        "total_amount": "3200.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Same customer invoice 2 of 2: score 9,000 (below threshold)
    {
        "invoice_id": "INV-13",
        "invoice_no": "INV-2049",
        "client_id": "CLI-05",
        "project_id": "PRJ-03",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -39,
        "due_offset_days": -9,
        "total_amount": "4500.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Edge case: grace (14d) > days overdue (10d) -> effective days 0, score 0
    {
        "invoice_id": "INV-14",
        "invoice_no": "INV-2050",
        "client_id": "CLI-06",
        "project_id": "PRJ-05",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -40,
        "due_offset_days": -10,
        "total_amount": "15000.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Inside Regular 7d grace (5d overdue < 7d grace) -> score 0
    {
        "invoice_id": "INV-15",
        "invoice_no": "INV-2052",
        "client_id": "CLI-02",
        "project_id": "PRJ-02",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -35,
        "due_offset_days": -5,
        "total_amount": "9500.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Due today: due_offset_days 0 -> not overdue yet, score 0
    {
        "invoice_id": "INV-16",
        "invoice_no": "INV-2054",
        "client_id": "CLI-08",
        "project_id": None,
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -30,
        "due_offset_days": 0,
        "total_amount": "7400.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Not yet due: due in +5 days -> score 0, no alert
    {
        "invoice_id": "INV-17",
        "invoice_no": "INV-2055",
        "client_id": "CLI-08",
        "project_id": None,
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -25,
        "due_offset_days": 5,
        "total_amount": "6200.00",
        "payments": [],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Fully paid: outstanding 0 -> drops off all overdue lists
    {
        "invoice_id": "INV-18",
        "invoice_no": "INV-2010",
        "client_id": "CLI-08",
        "project_id": None,
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -50,
        "due_offset_days": -20,
        "total_amount": "4000.00",
        "payments": [{"amount": "4000.00", "type": "full", "offset_days": -22}],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # Edge case: overpaid (outstanding -RM200 <= 0) -> treat as paid + warning
    {
        "invoice_id": "INV-19",
        "invoice_no": "INV-2015",
        "client_id": "CLI-10",
        "project_id": "PRJ-06",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -45,
        "due_offset_days": -15,
        "total_amount": "3000.00",
        "payments": [{"amount": "3200.00", "type": "full", "offset_days": -16}],
        "status_override": None,
        "last_reminded_offset_days": None,
    },

    # §4.2 void status: cancelled/replaced bill -> ignored by scoring & queues
    {
        "invoice_id": "INV-20",
        "invoice_no": "INV-2018",
        "client_id": "CLI-06",
        "project_id": "PRJ-05",
        "milestone_id": None,
        "source": "manual",
        "issue_offset_days": -40,
        "due_offset_days": -10,
        "total_amount": "5500.00",
        "payments": [],
        "status_override": "void",
        "last_reminded_offset_days": None,
    },
]
