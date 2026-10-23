"""Seed the database from the inlined demo world (app/db/demo_data.py).

Run from src/backend:
    uv run python -m app.db.seed           # seed (no-op if invoices exist)
    uv run python -m app.db.seed --reset   # drop all tables, recreate, seed

Data lives in demo_data.py: day offsets materialise relative to today, so
overdue days stay correct whenever the demo runs.

How the demo world maps onto our schema (translated, not copied):
- External ids ("CLI-02") map to our uuids via app.ids.external_uuid.
- Enum codes map to the canonical spellings our CHECK constraints expect
  ("new" -> "New", "whatsapp" -> "WhatsApp", "en" -> "English", ...).
- rules.min_days_between_reminders maps to column min_spacing_days (5).
- last_reminded_offset_days has no column; it becomes the spacing-rule
  history our schema does have: a sent reminder_draft + approval + send_log,
  seeded for the three flagged invoices (system wake-up state).
- Only plugin-owned tables are seeded. Orbyte entities (company, users,
  client details, projects, milestones, leave, holidays) live in
  app/orbyte/fixture.py and are served by MockOrbyteAdapter.
"""

import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, text

from ..ids import external_uuid
from .base import Base
from .demo_data import CLIENT_PROFILES, INVOICES, RULES
from .models import (
    Approval,
    ClientFollowupProfile,
    FollowupRule,
    Invoice,
    PaymentRecord,
    ReminderDraft,
    SendLog,
)
from .session import SessionLocal, engine

# The rule row is plugin-owned (not an Orbyte ref), so it keeps its own
# fixed uuid like before.
RULE_ID = UUID("00000000-0000-4000-8000-000000000002")

COMPANY_ID = external_uuid("COMP-01")
FINANCE_ID = external_uuid("USR-02")  # primary approver (leader's leave fixture)
OWNER_ID = external_uuid("USR-01")  # backup approver + second approval

TODAY = date.today()
NOW_UTC = datetime.now(timezone.utc)

# --- Fixture code -> canonical enum value (our CHECK constraints) ---
TIER = {"new": "New", "regular": "Regular", "key": "Key"}
CHANNEL = {"whatsapp": "WhatsApp", "email": "Email"}
LANGUAGE = {"en": "English", "bm": "Bahasa Malaysia"}
TONE = {"friendly": "Friendly", "neutral": "Neutral", "firm": "Firm"}


# --- Small helpers ---


def _date_at(offset_days: int) -> date:
    """Fixture offsets are signed: negative = days in the past."""
    return TODAY + timedelta(days=offset_days)


def _derive_status(total: Decimal, payments: list, status_override: str | None) -> str:
    if status_override:
        return status_override
    paid = sum((Decimal(str(p["amount"])) for p in payments), Decimal("0"))
    if paid <= 0:
        return "open"
    if paid >= total:
        return "paid"
    return "partially_paid"


def _reminder_body(profile: dict, invoice_no: str, amount: Decimal) -> str:
    """Template wording for seeded reminder history (written_by = 'template')."""
    contact = profile["contact_name"]
    if profile["language"] == "bm":
        return (
            f"Hai {contact}, peringatan mesra bahawa invois {invoice_no} "
            f"berjumlah RM {amount} telah melepasi tarikh akhir. Terima kasih!"
        )
    return (
        f"Hi {contact}, a friendly reminder that invoice {invoice_no} "
        f"for RM {amount} is now past due. Thank you!"
    )


def _recipient_contact(profile: dict) -> str:
    return profile["phone"] if profile["preferred_channel"] == "whatsapp" else profile["email"]


# --- Seed ---


def seed(reset: bool = False) -> None:
    if reset:
        print("Resetting: dropping all tables...")
        Base.metadata.drop_all(engine)
        with engine.begin() as connection:
            if connection.dialect.has_table(connection, "alembic_version"):
                connection.execute(text("DELETE FROM alembic_version"))
    from .init_db import init_db
    init_db()

    with SessionLocal() as session:
        existing = session.scalar(select(func.count()).select_from(Invoice))
        if existing:
            print(f"Already seeded ({existing} invoices). Use --reset to start over.")
            return

        session.add(
            FollowupRule(
                id=RULE_ID,
                company_id=COMPANY_ID,
                # Keys restated in our canonical tier spellings ("New", ...).
                grace_days_by_tier={TIER[k]: v for k, v in RULES["grace_days"].items()},
                alert_threshold=Decimal(str(RULES["alert_threshold"])),
                safety_flag_days=RULES["safety_flag_days"],
                min_spacing_days=RULES["min_days_between_reminders"],
                second_approval_amount=Decimal(str(RULES["second_approval_amount"])),
                skip_holidays=RULES["skip_holidays"],
                primary_approver_id=FINANCE_ID,
                backup_approver_id=OWNER_ID,
            )
        )

        # Profiles: only our columns. Client names, trades and contact details
        # are Orbyte-owned and arrive through the adapter, not this table.
        profile_by_client: dict[str, dict] = {}
        for row in CLIENT_PROFILES:
            profile_by_client[row["client_id"]] = row
            session.add(
                ClientFollowupProfile(
                    client_id=external_uuid(row["client_id"]),
                    company_id=COMPANY_ID,
                    relationship_tier=TIER[row["tier"]],
                    preferred_channel=CHANNEL[row["preferred_channel"]],
                    language=LANGUAGE[row["language"]],
                    tone=TONE[row["tone"]],
                    do_not_contact=row["do_not_contact"],
                )
            )

        # Invoices, with their embedded payments collected on the side.
        invoice_rows = []
        for row in INVOICES:
            total = Decimal(str(row["total_amount"]))
            invoice_rows.append((row, total))
            session.add(
                Invoice(
                    company_id=COMPANY_ID,
                    client_id=external_uuid(row["client_id"]),
                    project_id=external_uuid(row["project_id"]) if row["project_id"] else None,
                    milestone_id=external_uuid(row["milestone_id"]) if row["milestone_id"] else None,
                    invoice_no=row["invoice_no"],
                    issue_date=_date_at(row["issue_offset_days"]),
                    due_date=_date_at(row["due_offset_days"]),
                    total_amount=total,
                    status=_derive_status(total, row["payments"], row["status_override"]),
                    source=row["source"],
                )
            )

        # Payments need the invoice uuids, so flush the inserts first
        # (session runs with autoflush off; see session.py).
        session.flush()
        invoice_ids = dict(
            session.execute(select(Invoice.invoice_no, Invoice.id)).all()
        )

        for row, total in invoice_rows:
            for i, payment in enumerate(row["payments"], start=1):
                session.add(
                    PaymentRecord(
                        company_id=COMPANY_ID,
                        invoice_id=invoice_ids[row["invoice_no"]],
                        amount=Decimal(str(payment["amount"])),
                        received_date=_date_at(payment["offset_days"]),
                        payment_type=payment["type"],
                        reference_number=f"{row['invoice_id']}-PAY-{i:02d}",
                        recorded_by=FINANCE_ID,
                    )
                )

        # Spacing-rule history: invoices flagged with last_reminded_offset_days
        # wake up with an already-sent reminder (draft -> approval -> send_log).
        for row, total in invoice_rows:
            reminded = row.get("last_reminded_offset_days")
            if reminded is None:
                continue
            profile = profile_by_client[row["client_id"]]
            sent_at = NOW_UTC + timedelta(days=reminded)
            body = _reminder_body(profile, row["invoice_no"], total)
            draft = ReminderDraft(
                company_id=COMPANY_ID,
                invoice_id=invoice_ids[row["invoice_no"]],
                snapshot_id=None,  # no snapshot row for pre-existing history
                prepared_by=FINANCE_ID,
                version=1,
                channel=CHANNEL[profile["preferred_channel"]],
                language=LANGUAGE[profile["language"]],
                tone=TONE[profile["tone"]],
                body=body,
                written_by="template",
                verification_result={"source": "seed_history"},
                status="sent",
            )
            session.add(draft)
            session.flush()  # draft.id needed by approval and send_log
            session.add(
                Approval(
                    company_id=COMPANY_ID,
                    draft_id=draft.id,
                    approver_id=FINANCE_ID,
                    approval_step=1,
                    decision="approve",
                    comment="seeded history",
                    decided_at=sent_at,
                )
            )
            session.add(
                SendLog(
                    company_id=COMPANY_ID,
                    draft_id=draft.id,
                    channel=CHANNEL[profile["preferred_channel"]],
                    recipient_contact=_recipient_contact(profile),
                    approved_body=body,
                    sent_at=sent_at,
                    status="simulated",
                )
            )

        session.commit()

        counts = {
            table.__tablename__: session.scalar(select(func.count()).select_from(table))
            for table in (
                FollowupRule,
                ClientFollowupProfile,
                Invoice,
                PaymentRecord,
                ReminderDraft,
                Approval,
                SendLog,
            )
        }
        print(f"Seeded demo data ({TODAY.isoformat()}):")
        for table, count in counts.items():
            print(f"  {table}: {count}")


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
