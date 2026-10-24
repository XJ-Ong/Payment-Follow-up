"""Milestone-to-invoice suggestion service (S12).

Reads completed-but-unbilled project milestones through the Orbyte adapter
and generates pre-filled invoice data. The invoice table is the single
source of truth for "already billed" (invoice.milestone_id).
"""
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Invoice
from ..orbyte.protocol import OrbyteAdapter

DEFAULT_PAYMENT_TERMS = 30


def list_completed_unbilled(company_id: UUID, db: Session, adapter: OrbyteAdapter) -> list[dict]:
    """Completed milestones not yet linked to a non-void invoice.

    Returns dicts with milestone + project + client context, sorted by
    completion date (oldest first — most urgent to bill).
    """
    billed_milestone_ids = set(
        db.scalars(
            select(Invoice.milestone_id)
            .where(Invoice.company_id == company_id)
            .where(Invoice.milestone_id.isnot(None))
            .where(Invoice.status != "void")
        ).all()
    )

    candidates = []
    for client in adapter.list_clients(company_id):
        for project in adapter.list_projects(client.id):
            if project.status == "cancelled":
                continue
            for milestone in adapter.list_milestones(project.id):
                if milestone.completed_date is None:
                    continue
                if milestone.id in billed_milestone_ids:
                    continue
                candidates.append(
                    {
                        "milestone_id": str(milestone.id),
                        "milestone_name": milestone.name,
                        "milestone_value": str(milestone.amount) if milestone.amount is not None else None,
                        "completed_date": milestone.completed_date.isoformat(),
                        "project_id": str(project.id),
                        "project_name": project.name,
                        "client_id": str(client.id),
                        "client_name": client.name,
                        "payment_terms_days": project.payment_terms or DEFAULT_PAYMENT_TERMS,
                    }
                )

    candidates.sort(key=lambda c: c["completed_date"])
    return candidates


def suggest_invoice(milestone_id: UUID, db: Session, adapter: OrbyteAdapter) -> dict:
    """Pre-filled invoice data for a completed milestone.

    Returns a dict shaped for POST /api/invoices (plus a `_context`
    metadata block for UI display, which is not persisted).
    Raises ValueError for business-rule violations, LookupError for
    unknown references.
    """
    milestone = adapter.get_milestone(milestone_id)

    if milestone.completed_date is None:
        raise ValueError("Cannot bill incomplete milestone")

    project = adapter.get_project(milestone.project_id)
    client = adapter.get_client(project.client_id)

    existing = db.scalar(
        select(Invoice.id)
        .where(Invoice.milestone_id == milestone_id)
        .where(Invoice.status != "void")
        .limit(1)
    )
    if existing:
        raise ValueError("Milestone already billed")

    today = date.today()
    # Demo UUIDs share a zero prefix, so take the distinctive tail.
    suggested_invoice_no = f"INV-{today.strftime('%Y%m%d')}-{milestone_id.hex[-6:].upper()}"

    payment_terms_days = project.payment_terms or DEFAULT_PAYMENT_TERMS
    issue_date = milestone.completed_date
    due_date = issue_date + timedelta(days=payment_terms_days)

    return {
        "invoice_no": suggested_invoice_no,
        "client_id": str(client.id),
        "project_id": str(project.id),
        "milestone_id": str(milestone_id),
        "issue_date": issue_date.isoformat(),
        "due_date": due_date.isoformat(),
        "total_amount": f"{milestone.amount:.2f}" if milestone.amount is not None else None,
        "source": "milestone",
        # Metadata for UI display (not part of the persisted invoice).
        "_context": {
            "milestone_name": milestone.name,
            "project_name": project.name,
            "client_name": client.name,
            "payment_terms_days": payment_terms_days,
        },
    }
