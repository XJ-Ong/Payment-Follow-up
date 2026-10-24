from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from conftest import database_context
from app.db.models import ActivityLog, Invoice, PaymentRecord
from app.main import app, get_db, COMPANY
from app.services.reports import weekly_summary
from test_workflow import ADAPTER, FINANCE, OWNER, invoice

NOW = datetime(2026, 10, 24, 4, tzinfo=timezone.utc)
MONDAY = date(2026, 10, 19)


@pytest.fixture
def store():
    with database_context() as (engine, _):
        yield engine


def pay(db, invoice_id, amount, day, company=COMPANY, kind="partial"):
    payment = PaymentRecord(id=uuid4(), company_id=company, invoice_id=invoice_id,
        amount=Decimal(amount), received_date=date(2026, 10, day), payment_type=kind,
        reference_number="BANK-REF", recorded_by=FINANCE.id)
    db.add(payment)
    return payment


def report(engine, start=MONDAY, now=NOW):
    with Session(engine) as db:
        return weekly_summary(db, COMPANY, ADAPTER, start, now=now).model_dump(mode="json")


def test_collections_reconcile_settlement_deposits_dnc_void_and_company_scope(store):
    a = invoice(store, "1000")
    b = invoice(store, "500", client="CLI-07")  # do-not-contact customer still counts
    old = invoice(store, "800", client="CLI-02")
    partial = invoice(store, "1000")
    future_due = invoice(store, "600")
    void = invoice(store, "1200")
    foreign = invoice(store, "9999")
    with Session(store) as db:
        db.get(Invoice, future_due).due_date = date(2026, 11, 1)
        db.get(Invoice, void).status = "void"
        foreign_company = uuid4()
        db.get(Invoice, foreign).company_id = foreign_company
        pay(db,a,"200",18)
        pay(db,a,"100",19,kind="deposit")
        pay(db,a,"300",22)
        pay(db,a,"400",24)
        pay(db,b,"100",19)
        pay(db,b,"400",20)
        pay(db,old,"800",18)
        pay(db,partial,"150",23)
        pay(db,partial,"50",24)
        pay(db,void,"1200",21)
        pay(db,foreign,"9999",21,company=foreign_company)
        pay(db,a,"9999",21,company=foreign_company)
        db.commit()
    data = report(store)
    assert data["totals"] == dict(payments_received="1500.00", invoices_fully_paid=2, customers_paid=2)
    assert len(data["daily"]) == 7
    assert [d["amount"] for d in data["daily"]] == ["200.00","400.00","0.00","300.00","150.00","450.00","0.00"]
    assert data["period_end"] == "2026-10-24" and data["is_current_week"]
    assert data["customers"][0]["amount_received"] == "1000.00"
    assert data["customers"][0]["invoices_receiving_payments"] == 2
    assert data["customers"][0]["invoices_fully_paid"] == 1
    assert sum(Decimal(p["amount"]) for p in data["payments"]) == Decimal("1500")
    assert sum(Decimal(c["amount_received"]) for c in data["customers"]) == Decimal("1500")
    assert all(p["reference"] == "BANK-REF" for p in data["payments"])
    assert data["outstanding_now"] == dict(as_of_date="2026-10-24", total_outstanding="1400.00", total_overdue="800.00")
    previous = report(store,date(2026,10,12))
    assert previous["totals"]["payments_received"] == "1000.00"
    assert previous["totals"]["invoices_fully_paid"] == 1
    assert previous["outstanding_now"] == data["outstanding_now"]
    with Session(store) as db:
        assert db.scalar(select(func.count()).select_from(ActivityLog)) == 0


def test_received_date_not_recorded_date_and_backdated_settlement(store):
    row = invoice(store,"1000")
    with Session(store) as db:
        pay(db,row,"800",20)
        db.commit()
    assert report(store)["totals"]["invoices_fully_paid"] == 0
    with Session(store) as db:
        payment = pay(db,row,"200",18)
        payment.created_at = NOW
        db.commit()
    data = report(store)
    assert data["totals"]["payments_received"] == "800.00"
    assert data["totals"]["invoices_fully_paid"] == 1


def test_sunday_boundaries_future_dates_and_malaysia_monday(store):
    row = invoice(store,"1000")
    with Session(store) as db:
        pay(db,row,"200",18)
        pay(db,row,"300",25)
        pay(db,row,"500",26)
        db.commit()
    saturday = report(store)
    assert saturday["totals"]["payments_received"] == "0.00"
    assert saturday["outstanding_now"]["total_outstanding"] == "800.00"
    sunday = report(store,now=datetime(2026,10,25,12,tzinfo=timezone.utc))
    assert sunday["daily"][-1]["amount"] == "300.00"
    monday = report(store,start=None,now=datetime(2026,10,25,16,tzinfo=timezone.utc))
    assert monday["week_start"] == "2026-10-26"
    assert monday["period_end"] == "2026-10-26"
    assert monday["totals"]["payments_received"] == "500.00"
    assert monday["totals"]["invoices_fully_paid"] == 1


@pytest.mark.parametrize("start", [date(2026,10,20), date(2026,10,26)])
def test_invalid_week_rejected(store,start):
    with pytest.raises(ValueError,match="Monday"):
        report(store,start)


def test_empty_week_is_zero_filled(store):
    data = report(store)
    assert data["totals"] == dict(payments_received="0.00", invoices_fully_paid=0, customers_paid=0)
    assert len(data["daily"]) == 7 and all(day["amount"] == "0.00" for day in data["daily"])
    assert data["customers"] == data["payments"] == []


def test_api_permissions_and_input_validation(store):
    def database():
        with Session(store) as db:
            yield db
    app.dependency_overrides[get_db] = database
    try:
        with TestClient(app) as client:
            for role in ("Owner", "Finance"):
                result = client.get("/api/reports/weekly-summary",headers={"X-Role":role})
                assert result.status_code == 200, result.text
                assert len(result.json()["daily"]) == 7
            for role in (None, "Other Staff", "Preparer"):
                assert client.get("/api/reports/weekly-summary",headers={"X-Role":role} if role else {}).status_code == 403
            for value in ("invalid", "2026-10-20", "9999-12-27"):
                assert client.get("/api/reports/weekly-summary",params={"week_start":value},headers={"X-Role":"Owner"}).status_code == 422
            assert client.get("/api/reports/weekly-summary",headers={"X-Role":"Finance","X-User-ID":str(OWNER.id)}).status_code == 403
    finally:
        app.dependency_overrides.clear()
