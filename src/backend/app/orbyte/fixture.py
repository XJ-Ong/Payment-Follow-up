"""
The synthetic Orbyte world

This is data only: MockOrbyteAdapter loads it at construction.

World: 1 company (Maju Jaya Enterprise), 4 users (Owner/Finance/Other/
Other), 10 clients, 6 projects, 3 milestones (MLS-02/03 are the S12
auto-suggest candidates), 1 leave record and 2 public holidays.

Conventions (same as app/db/demo_data.py):

- External codes ("CLI-02") translate to uuids via app.ids.external_uuid,
  so these ids match the uuids our database stores.
- Day offsets are SIGNED and relative to today: negative = past.
  Materialised into real dates inside MockOrbyteAdapter at load time.
- Money is a string ("65000.00") -> Decimal at load. Never floats.
"""

FIXTURE = {
    "company": {"id": "COMP-01", "name": "Maju Jaya Enterprise Sdn Bhd"},

    # role is the fixture code our simulated X-Role handling maps to §3:
    # owner | finance | other_staff
    "users": [
        {
            "id": "USR-01",
            "name": "Puan Farah",
            "email": "farah@majujaya.my",
            "department": "Management",
            "reports_to": None,
            "role": "owner",
        },
        {
            "id": "USR-02",
            "name": "Encik Razak",
            "email": "razak@majujaya.my",
            "department": "Finance",
            "reports_to": "USR-01",
            "role": "finance",
        },
        {
            "id": "USR-03",
            "name": "Cik Aina",
            "email": "aina@majujaya.my",
            "department": "Sales & Admin",
            "reports_to": "USR-02",
            "role": "other_staff",
        },
        {
            "id": "USR-04",
            "name": "Encik Amir",
            "email": "amir@majujaya.my",
            "department": "Operations",
            "reports_to": "USR-01",
            "role": "other_staff",
        },
    ],

    "clients": [
        {
            "client_id": "CLI-01",
            "name": "Kedai Kopi Harmoni",
            "trade": "F&B / Cafe",
            "contact_name": "Encik Lim",
            "phone": "+60123456701",
            "email": "lim@kopiharmoni.my",
        },
        {
            "client_id": "CLI-02",
            "name": "Seri Maju Trading Sdn Bhd",
            "trade": "Wholesale & Trading",
            "contact_name": "Puan Chong",
            "phone": "+60123456702",
            "email": "accounts@serimaju.com.my",
        },
        {
            "client_id": "CLI-03",
            "name": "TechNova Solutions Sdn Bhd",
            "trade": "IT Services",
            "contact_name": "Mr Tan",
            "phone": "+60123456703",
            "email": "tan@technova.my",
        },
        {
            "client_id": "CLI-04",
            "name": "BinaJaya Contractors Sdn Bhd",
            "trade": "Construction & Renovation",
            "contact_name": "Ir. Zulkifli",
            "phone": "+60123456704",
            "email": "finance@binajaya.my",
        },
        {
            "client_id": "CLI-05",
            "name": "Metro Logistics Hub Sdn Bhd",
            "trade": "Transport & Logistics",
            "contact_name": "Mr Rajan",
            "phone": "+60123456705",
            "email": "billing@metrologistics.my",
        },
        {
            "client_id": "CLI-06",
            "name": "Golden Spoon Catering",
            "trade": "Hospitality & F&B Supply",
            "contact_name": "Cik Nadia",
            "phone": "+60123456706",
            "email": "nadia@goldenspoon.my",
        },
        {
            "client_id": "CLI-07",
            "name": "Warisan Packaging Enterprise",
            "trade": "Manufacturing & Packaging",
            "contact_name": "Haji Roslan",
            "phone": "+60123456707",
            "email": "roslan@warisanpack.my",
        },
        {
            "client_id": "CLI-08",
            "name": "Apex Printworks Sdn Bhd",
            "trade": "Printing & Signage",
            "contact_name": "Ms Michelle",
            "phone": "+60123456708",
            "email": "michelle@apexprint.my",
        },
        {
            "client_id": "CLI-09",
            "name": "Selangor Fresh Mart",
            "trade": "Retail & Mini Market",
            "contact_name": "Encik Hafiz",
            "phone": "+60123456709",
            "email": "hafiz@selangorfresh.my",
        },
        {
            "client_id": "CLI-10",
            "name": "MegaKemuncak Engineering",
            "trade": "Industrial Services",
            "contact_name": "Dato' Kelvin",
            "phone": "+60123456710",
            "email": "ap@megakemuncak.com.my",
        },
    ],

    "projects": [
        {
            "id": "PRJ-01",
            "client_id": "CLI-04",
            "name": "Warehouse Racking & Structural Upgrade",
            "status": "in_progress",
            "owner_id": "USR-01",
            "contract_value": "65000.00",
            "payment_terms": 30,
        },
        {
            "id": "PRJ-02",
            "client_id": "CLI-02",
            "name": "Q3 Bulk Wholesale Hardware Supply",
            "status": "completed",
            "owner_id": "USR-01",
            "contract_value": "59500.00",
            "payment_terms": 30,
        },
        {
            "id": "PRJ-03",
            "client_id": "CLI-05",
            "name": "Fleet Maintenance & Spare Parts Contract",
            "status": "in_progress",
            "owner_id": "USR-01",
            "contract_value": "25000.00",
            "payment_terms": 30,
        },
        {
            "id": "PRJ-04",
            "client_id": "CLI-03",
            "name": "Office Server & Networking Setup",
            "status": "completed",
            "owner_id": "USR-01",
            "contract_value": "12500.00",
            "payment_terms": 30,
        },
        {
            "id": "PRJ-05",
            "client_id": "CLI-06",
            "name": "Central Kitchen Cold-Room Servicing",
            "status": "in_progress",
            "owner_id": "USR-01",
            "contract_value": "28000.00",
            "payment_terms": 30,
        },
        {
            "id": "PRJ-06",
            "client_id": "CLI-10",
            "name": "Factory Conveyor Fabrication",
            "status": "completed",
            "owner_id": "USR-01",
            "contract_value": "43000.00",
            "payment_terms": 30,
        },
    ],

    # MLS-01 is already invoiced (invoice INV-2035, source=milestone);
    # MLS-02/03 are the S12 auto-suggest candidates — completed, not yet
    # invoiced. "Already invoiced?" is answered from OUR invoice table, so
    # no invoiced flag is stored here (single source of truth).
    "milestones": [
        {
            "id": "MLS-01",
            "project_id": "PRJ-01",
            "name": "Phase 1 Foundation & Frame Delivery",
            "amount": "30000.00",
            "due_offset_days": -52,
            "completed_offset_days": -52,
        },

        # S12 candidate #1: completed yesterday, not invoiced yet
        {
            "id": "MLS-02",
            "project_id": "PRJ-01",
            "name": "Phase 2 Racking Installation & Handover",
            "amount": "15000.00",
            "due_offset_days": -3,
            "completed_offset_days": -1,
        },

        # S12 candidate #2: completed today, not invoiced yet
        {
            "id": "MLS-03",
            "project_id": "PRJ-05",
            "name": "Monthly Cold-Chain Delivery Batch #10",
            "amount": "6500.00",
            "due_offset_days": -2,
            "completed_offset_days": 0,
        },
    ],

    # S13 fixture: when active, routes approvals from Finance (USR-02) to
    # backup Owner (USR-01). Hidden unless the adapter is constructed with
    # demo_leave_active=True, so the normal demo has nobody on leave.
    "approved_leave": [
        {
            "user_id": "USR-02",
            "backup_approver_id": "USR-01",
            "from_offset_days": -1,
            "to_offset_days": 2,
            "active_in_demo_by_default": False,
        },
    ],

    # S15 fixture: counted only when followup_rule.skip_holidays = True
    # (currently False — calendar days, per Solution §15 D4).
    "public_holidays": [
        {"offset_days": -12, "name": "Malaysia Public Holiday (Sample Holiday 1)"},
        {"offset_days": -5, "name": "State Public Holiday (Sample Holiday 2)"},
    ],
}
