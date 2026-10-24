"""Tests for the milestone-to-invoice suggestion service and endpoints (S12).

Fixture world (app/orbyte/fixture.py):
- MLS-01 (PRJ-01/CLI-04 BinaJaya, RM30000, completed 52d ago) — in the demo
  DB an invoice already references it, but the isolated test DB starts
  empty, so all three completed milestones are unbilled here until a test
  bills one.
- MLS-02 (PRJ-01/CLI-04, RM15000, completed 1d ago) — S12 candidate.
- MLS-03 (PRJ-05/CLI-06 Golden Spoon, RM6500, completed today) — S12 candidate.
- MLS-04 (PRJ-01, RM20000, not completed) — never a billing candidate.
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.db.models import Approval, Invoice, PrioritySnapshot, ReminderDraft, SendLog
from app.ids import external_uuid
from app.orbyte.mock import MockOrbyteAdapter
from app.services import milestones

COMPANY = external_uuid("COMP-01")
MST_01 = external_uuid("MLS-01")
MST_02 = external_uuid("MLS-02")
MST_03 = external_uuid("MLS-03")
MST_04 = external_uuid("MLS-04")


@pytest.fixture(autouse=True)
def _clean_milestone_invoices(database):
    """The database fixture is module-scoped; remove milestone-linked
    invoices created by a test so later tests start from a clean slate.
    Dependent rows (drafts, snapshots) must go first (FK ondelete=RESTRICT)."""
    yield
    with Session(database[0]) as db:
        invoice_ids = [row[0] for row in db.query(Invoice.id).filter(Invoice.milestone_id.isnot(None)).all()]
        if invoice_ids:
            draft_ids = [row[0] for row in db.query(ReminderDraft.id).filter(ReminderDraft.invoice_id.in_(invoice_ids)).all()]
            if draft_ids:
                db.query(SendLog).filter(SendLog.draft_id.in_(draft_ids)).delete(synchronize_session=False)
                db.query(Approval).filter(Approval.draft_id.in_(draft_ids)).delete(synchronize_session=False)
            db.query(ReminderDraft).filter(ReminderDraft.invoice_id.in_(invoice_ids)).delete(synchronize_session=False)
            db.query(PrioritySnapshot).filter(PrioritySnapshot.invoice_id.in_(invoice_ids)).delete(synchronize_session=False)
            db.query(Invoice).filter(Invoice.id.in_(invoice_ids)).delete(synchronize_session=False)
            db.commit()


def _bill(db, milestone_id, *, client_id="CLI-04", project_id="PRJ-01", amount="30000.00", invoice_no=None):
    db.add(Invoice(
        id=uuid4(),
        company_id=COMPANY,
        client_id=external_uuid(client_id),
        project_id=external_uuid(project_id),
        milestone_id=milestone_id,
        invoice_no=invoice_no or f"INV-TEST-{milestone_id.hex[:6].upper()}",
        issue_date=date.today(),
        due_date=date.today() + timedelta(days=30),
        total_amount=Decimal(amount),
        status="open",
        source="milestone",
    ))
    db.commit()


# ---- Unit tests: list_completed_unbilled ----

def test_list_completed_unbilled_returns_three_candidates(database):
    with Session(database[0]) as db:
        candidates = milestones.list_completed_unbilled(COMPANY, db, MockOrbyteAdapter())

    assert len(candidates) == 3
    names = {c["milestone_name"] for c in candidates}
    assert "Phase 1 Foundation & Frame Delivery" in names
    assert "Phase 2 Racking Installation & Handover" in names
    assert "Monthly Cold-Chain Delivery Batch #10" in names

    c = candidates[0]
    for key in ("milestone_id", "milestone_name", "milestone_value", "completed_date",
                "project_id", "project_name", "client_id", "client_name", "payment_terms_days"):
        assert key in c


def test_list_completed_unbilled_excludes_incomplete(database):
    with Session(database[0]) as db:
        candidates = milestones.list_completed_unbilled(COMPANY, db, MockOrbyteAdapter())
    assert str(MST_04) not in {c["milestone_id"] for c in candidates}


def test_list_completed_unbilled_sorted_oldest_first(database):
    with Session(database[0]) as db:
        candidates = milestones.list_completed_unbilled(COMPANY, db, MockOrbyteAdapter())
    dates = [c["completed_date"] for c in candidates]
    assert dates == sorted(dates)


def test_completed_unbilled_excludes_already_billed(database):
    with Session(database[0]) as db:
        adapter = MockOrbyteAdapter()
        assert len(milestones.list_completed_unbilled(COMPANY, db, adapter)) == 3

        _bill(db, MST_01)

        after = milestones.list_completed_unbilled(COMPANY, db, adapter)
        assert len(after) == 2
        assert str(MST_01) not in {c["milestone_id"] for c in after}


def test_completed_unbilled_ignores_void_invoices(database):
    with Session(database[0]) as db:
        adapter = MockOrbyteAdapter()
        _bill(db, MST_01)
        invoice = db.query(Invoice).filter(Invoice.milestone_id == MST_01).one()
        invoice.status = "void"
        db.commit()

        after = milestones.list_completed_unbilled(COMPANY, db, adapter)
        assert len(after) == 3


# ---- Unit tests: suggest_invoice ----

def test_suggest_invoice_generates_valid_data(database):
    with Session(database[0]) as db:
        suggestion = milestones.suggest_invoice(MST_02, db, MockOrbyteAdapter())

    assert suggestion["invoice_no"].startswith("INV-")
    assert suggestion["client_id"] == str(external_uuid("CLI-04"))
    assert suggestion["project_id"] == str(external_uuid("PRJ-01"))
    assert suggestion["milestone_id"] == str(MST_02)
    assert suggestion["total_amount"] == "15000.00"
    assert suggestion["source"] == "milestone"
    assert suggestion["_context"]["milestone_name"] == "Phase 2 Racking Installation & Handover"
    assert suggestion["_context"]["client_name"] == "BinaJaya Contractors Sdn Bhd"
    assert suggestion["_context"]["payment_terms_days"] == 30


def test_suggest_invoice_calculates_due_date_from_payment_terms(database):
    with Session(database[0]) as db:
        suggestion = milestones.suggest_invoice(MST_02, db, MockOrbyteAdapter())
    issue = date.fromisoformat(suggestion["issue_date"])
    due = date.fromisoformat(suggestion["due_date"])
    assert (due - issue).days == 30


def test_suggest_invoice_issue_date_is_completed_date(database):
    with Session(database[0]) as db:
        suggestion = milestones.suggest_invoice(MST_02, db, MockOrbyteAdapter())
    assert suggestion["issue_date"] == (date.today() - timedelta(days=1)).isoformat()


def test_suggest_invoice_rejects_incomplete_milestone(database):
    with Session(database[0]) as db:
        with pytest.raises(ValueError, match="incomplete"):
            milestones.suggest_invoice(MST_04, db, MockOrbyteAdapter())


def test_suggest_invoice_rejects_already_billed(database):
    with Session(database[0]) as db:
        _bill(db, MST_01)
        with pytest.raises(ValueError, match="already billed"):
            milestones.suggest_invoice(MST_01, db, MockOrbyteAdapter())


def test_suggest_invoice_unknown_milestone_raises_lookup_error(database):
    with Session(database[0]) as db:
        with pytest.raises(LookupError):
            milestones.suggest_invoice(uuid4(), db, MockOrbyteAdapter())


# ---- API integration tests ----

def test_api_unbilled_milestones_requires_permission(client):
    response = client.get('/api/milestones/unbilled', headers={'X-Role': 'Other Staff'})
    assert response.status_code == 403


def test_api_unbilled_milestones_returns_candidates(client):
    response = client.get('/api/milestones/unbilled', headers={'X-Role': 'Owner'})
    assert response.status_code == 200

    data = response.json()
    assert data["count"] == 3
    milestone = data["milestones"][0]
    assert "milestone_id" in milestone
    assert "milestone_name" in milestone
    assert "client_name" in milestone


def test_api_suggest_invoice_returns_valid_structure(client):
    response = client.get(f'/api/milestones/{MST_02}/suggest-invoice', headers={'X-Role': 'Finance'})
    assert response.status_code == 200

    data = response.json()
    assert data["invoice_no"].startswith("INV-")
    assert data["client_id"]
    assert data["milestone_id"] == str(MST_02)
    assert data["total_amount"] == "15000.00"


def test_api_suggest_invoice_rejects_incomplete_milestone(client):
    response = client.get(f'/api/milestones/{MST_04}/suggest-invoice', headers={'X-Role': 'Owner'})
    assert response.status_code == 409
    assert "incomplete" in response.text.lower()


def test_api_suggest_invoice_rejects_already_billed(client, database):
    with Session(database[0]) as db:
        _bill(db, MST_01)
    response = client.get(f'/api/milestones/{MST_01}/suggest-invoice', headers={'X-Role': 'Owner'})
    assert response.status_code == 409
    assert "already billed" in response.text.lower()


def test_api_suggest_invoice_returns_404_for_invalid_id(client):
    response = client.get(f'/api/milestones/{uuid4()}/suggest-invoice', headers={'X-Role': 'Owner'})
    assert response.status_code == 404


def test_api_create_invoice_from_suggestion_links_milestone(client):
    """POST /api/invoices with the suggestion data links the milestone."""
    suggestion = client.get(f'/api/milestones/{MST_02}/suggest-invoice', headers={'X-Role': 'Finance'}).json()

    payload = {k: suggestion[k] for k in ("invoice_no", "client_id", "issue_date", "due_date",
                                          "total_amount", "project_id", "milestone_id", "source")}
    response = client.post('/api/invoices', headers={'X-Role': 'Finance'}, json=payload)
    assert response.status_code == 201
    assert response.json()["invoice_no"] == suggestion["invoice_no"]

    # Milestone no longer listed as unbilled.
    unbilled = client.get('/api/milestones/unbilled', headers={'X-Role': 'Owner'}).json()
    assert str(MST_02) not in {m["milestone_id"] for m in unbilled["milestones"]}
    assert unbilled["count"] == 2


def test_api_create_invoice_rejects_duplicate_milestone_link(client):
    """A second invoice for the same milestone is rejected (unique index)."""
    payload = {
        "invoice_no": "INV-DUP-A",
        "client_id": str(external_uuid("CLI-04")),
        "issue_date": date.today().isoformat(),
        "due_date": (date.today() + timedelta(days=30)).isoformat(),
        "total_amount": "15000.00",
        "project_id": str(external_uuid("PRJ-01")),
        "milestone_id": str(MST_02),
        "source": "milestone",
    }
    first = client.post('/api/invoices', headers={'X-Role': 'Finance'}, json=payload)
    assert first.status_code == 201

    second = client.post('/api/invoices', headers={'X-Role': 'Finance'},
                         json=payload | {"invoice_no": "INV-DUP-B"})
    assert second.status_code == 409


@pytest.mark.parametrize('changes', [
    {'milestone_id': str(uuid4())},
    {'milestone_id': str(MST_04)},
    {'project_id': None},
    {'client_id': str(external_uuid('CLI-06')), 'project_id': str(external_uuid('PRJ-05'))},
])
def test_api_create_invoice_rejects_invalid_milestone_link(client, changes):
    suggestion = client.get(f'/api/milestones/{MST_02}/suggest-invoice', headers={'X-Role': 'Finance'}).json()
    response = client.post('/api/invoices', headers={'X-Role': 'Finance'}, json=suggestion | changes)
    assert response.status_code == 422, response.text
    unbilled = client.get('/api/milestones/unbilled', headers={'X-Role': 'Owner'}).json()
    assert str(MST_02) in {m['milestone_id'] for m in unbilled['milestones']}
