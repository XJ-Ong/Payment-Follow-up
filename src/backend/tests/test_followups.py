from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from conftest import database_context
from app.db.models import (ActivityLog, Alert, ClientFollowupProfile, FollowupRule,
    Invoice, PaymentRecord, PrioritySnapshot, ReminderDraft, SendLog)
from app.ids import external_uuid
from app.main import app, get_db, COMPANY, adapter
from app.services.followups import ConfigurationError, refresh_workspace, read_workspace

NOW = datetime(2026,10,23,4,0,tzinfo=timezone.utc)
TODAY = date(2026,10,23)
FINANCE = external_uuid("USR-02")
HEADERS = {"X-Role": "Finance"}

@pytest.fixture
def store():
    with database_context() as (engine, config):
        yield engine, config


def invoice(db, number="INV-A", total="2500.00", age=40, client="CLI-01", status="open"):
    row = Invoice(id=uuid4(), company_id=COMPANY, client_id=external_uuid(client), invoice_no=number,
        issue_date=TODAY-timedelta(days=100), due_date=TODAY-timedelta(days=age), total_amount=Decimal(total), source="manual", status=status)
    db.add(row)
    db.flush()
    return row


def payment(db, row, amount):
    db.add(PaymentRecord(id=uuid4(), company_id=COMPANY, invoice_id=row.id, amount=Decimal(amount), received_date=TODAY, payment_type="partial", recorded_by=FINANCE))
    db.flush()


def sent(db, row, days_ago=2):
    draft = ReminderDraft(id=uuid4(), company_id=COMPANY, invoice_id=row.id, version=1, channel="Email", language="English", tone="Friendly", written_by="template", verification_result={}, status="sent", body="Synthetic history")
    db.add(draft)
    db.flush()
    db.add(SendLog(id=uuid4(), company_id=COMPANY, draft_id=draft.id, channel="Email", recipient_contact="test@example.test", approved_body=draft.body, sent_at=NOW-timedelta(days=days_ago), status="simulated"))
    db.flush()


def refresh(engine, now=NOW):
    with Session(engine) as db:
        result = refresh_workspace(db, COMPANY, adapter, FINANCE, now=now)
        db.commit()
        return result.model_dump(mode="json")


def by_number(result):
    return {i["invoice_no"]: i for i in result["invoices"]}


def test_rank_queue_totals_and_invoice_spacing(store):
    engine, _ = store
    with Session(engine) as db:
        a = invoice(db, "INV-A")
        b = invoice(db, "INV-B")  # same customer, same score; not blocked by A's send
        sent(db, a)
        invoice(db, "DNC", total="5000", client="CLI-07")
        invoice(db, "SAFETY", total="500")
        invoice(db, "LOW", total="100", age=10)
        invoice(db, "GRACE", total="100", age=5, client="CLI-02")
        invoice(db, "FUTURE", total="100", age=-1)
        invoice(db, "VOID", total="100", status="void")
        paid = invoice(db, "PAID", total="100", status="paid")
        payment(db, paid, "100")
        db.commit()
    result = refresh(engine)
    rows = by_number(result)
    assert rows["DNC"]["calculation"]["rank"] == 1
    assert rows["INV-A"]["calculation"]["rank"] < rows["INV-B"]["calculation"]["rank"]
    queued = {r["invoice_no"] for r in result["invoices"] if r["id"] in result["queue_ids"]}
    assert queued == {"INV-B", "SAFETY"}
    assert rows["INV-A"]["calculation"]["exclusion_reasons"][0].startswith("Reminder spacing")
    assert not rows["DNC"]["calculation"]["eligible"]
    assert result["dashboard"]["total_outstanding"] == "10800.00"
    balances = {c["customer_id"]: c["balance"] for c in result["dashboard"]["customer_balances"]}
    assert balances[str(external_uuid("CLI-01"))] == "5700.00"
    assert balances[str(external_uuid("CLI-07"))] == "5000.00"
    assert result["dashboard"]["total_overdue"] == "10700.00"
    assert result["dashboard"]["alert_count"] == 2
    assert all(a["recipient_id"] == str(FINANCE) for a in result["alerts"])


def test_idempotent_snapshots_and_saved_read_no_writes(store):
    engine, _ = store
    with Session(engine) as db:
        empty = read_workspace(db, COMPANY)
        assert empty.computed_at is None
        assert db.scalar(select(func.count()).select_from(PrioritySnapshot)) == 0
        invoice(db)
        db.commit()
    first = refresh(engine)
    second = refresh(engine)
    assert first == second  # same injected instant; alert IDs and snapshot IDs stable
    with Session(engine) as db:
        before = db.scalar(select(func.count()).select_from(ActivityLog))
        assert db.scalar(select(func.count()).select_from(PrioritySnapshot)) == 1
        assert db.scalar(select(func.count()).select_from(Alert)) == 1
        assert read_workspace(db, COMPANY).model_dump(mode="json") == second
        assert db.scalar(select(func.count()).select_from(ActivityLog)) == before


def test_concurrent_refreshes(store):
    engine, _ = store
    with Session(engine) as db:
        invoice(db)
        db.commit()
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: refresh(engine), range(3)))
    assert all(r["dashboard"]["queue_count"] == 1 for r in results)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PrioritySnapshot)) == 1
        assert db.scalar(select(func.count()).select_from(Alert)) == 1


def test_alert_decisions_and_payment_ineligibility(store):
    engine, _ = store
    with Session(engine) as db:
        row = invoice(db)
        row_id = row.id
        db.commit()
    refresh(engine)
    with Session(engine) as db:
        db.scalar(select(Alert)).status = "seen"
        db.scalar(select(FollowupRule)).alert_threshold = Decimal("1000000")
        db.commit()
    result = refresh(engine)
    assert result["alerts"][0]["status"] == "seen"
    assert result["alerts"][0]["trigger_type"] == "safety_rule"
    with Session(engine) as db:
        row = db.get(Invoice, row_id)
        payment(db, row, "2500")
        row.status = "paid"
        db.commit()
    result = refresh(engine)
    assert not result["queue_ids"]
    with Session(engine) as db:
        assert db.scalar(select(Alert)).status == "dismissed"
        snapshot = db.scalar(select(PrioritySnapshot))
        assert snapshot.rank is None
        assert not snapshot.eligible
        assert snapshot.outstanding_amount == 0


def test_history_retained_across_days(store):
    engine, _ = store
    with Session(engine) as db:
        row = invoice(db)
        row_id = row.id
        db.commit()
    refresh(engine)
    with Session(engine) as db:
        payment(db, db.get(Invoice, row_id), "1000")
        db.commit()
    refresh(engine, NOW+timedelta(days=1))
    with Session(engine) as db:
        history = db.scalars(select(PrioritySnapshot).order_by(PrioritySnapshot.as_of_date)).all()
        assert len(history) == 2
        assert history[0].outstanding_amount == Decimal("2500")
        assert history[1].outstanding_amount == Decimal("1500")
        assert db.scalar(select(Alert).where(Alert.snapshot_id == history[0].id)).status == "dismissed"


def test_refresh_failure_rolls_back_and_keeps_last_success(store, monkeypatch):
    engine, _ = store
    with Session(engine) as db:
        invoice(db)
        db.commit()
    saved = refresh(engine)
    with Session(engine) as db:
        original_add = db.add
        def fail_on_audit(row, *args, **kwargs):
            if isinstance(row, ActivityLog):
                raise RuntimeError("simulated persistence failure after snapshot/alert flush")
            original_add(row, *args, **kwargs)
        monkeypatch.setattr(db, "add", fail_on_audit)
        with pytest.raises(RuntimeError):
            refresh_workspace(db, COMPANY, adapter, FINANCE, now=NOW+timedelta(days=1))
        db.rollback()
    with Session(engine) as db:
        assert read_workspace(db, COMPANY).model_dump(mode="json") == saved
        assert db.scalar(select(func.count()).select_from(PrioritySnapshot)) == 1


@pytest.mark.parametrize("missing", ["rules", "profile"])
def test_configuration_error_blocks_refresh_and_rolls_back_invoice_write(store, missing):
    engine, _ = store
    with Session(engine) as db:
        if missing == "rules":
            db.delete(db.scalar(select(FollowupRule)))
        else:
            db.delete(db.get(ClientFollowupProfile, external_uuid("CLI-01")))
        db.commit()
    def session():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            assert client.post("/api/followups/refresh", headers=HEADERS).status_code == 409
            response = client.post("/api/invoices", headers=HEADERS, json=dict(invoice_no="ROLLBACK", client_id=str(external_uuid("CLI-01")), issue_date="2026-10-01", due_date="2026-10-23", total_amount="100"))
            assert response.status_code == 409
            assert "Missing" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Invoice)) == 0
        assert db.scalar(select(func.count()).select_from(PrioritySnapshot)) == 0


def test_permissions_company_isolation_and_payment_atomicity(store):
    engine, _ = store
    with Session(engine) as db:
        row = invoice(db)
        row_id = row.id
        other = Invoice(id=uuid4(), company_id=uuid4(), client_id=uuid4(), invoice_no="PRIVATE", issue_date=TODAY, due_date=TODAY, total_amount=100, source="manual")
        db.add(other)
        db.commit()
    def session():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            for role in [None, "Other Staff", "Preparer"]:
                headers = {} if role is None else {"X-Role": role}
                assert client.get("/api/followups", headers=headers).status_code == 403
                assert client.post("/api/followups/refresh", headers=headers).status_code == 403
            for role in ["Owner", "Finance"]:
                result = client.post("/api/followups/refresh", headers={"X-Role": role})
                assert result.status_code == 200, result.text
                assert all(i["invoice_no"] != "PRIVATE" for i in result.json()["invoices"])
            paid = client.post(f"/api/invoices/{row_id}/payments", headers=HEADERS, json={"amount": "2500", "received_date": "2026-10-23"})
            assert paid.status_code == 201, paid.text
            saved = client.get("/api/followups", headers=HEADERS).json()
            assert not saved["queue_ids"]
            assert by_number(saved)["INV-A"]["calculation"]["outstanding_amount"] == "0.00"
    finally:
        app.dependency_overrides.clear()


def test_migration_refuses_duplicate_history_without_removing_it():
    with database_context("0001") as (engine, config):
        with engine.begin() as db:
            invoice_id, snapshot_id = uuid4(), uuid4()
            rule_id = db.scalar(text("SELECT id FROM followup_rule"))
            db.execute(text("INSERT INTO invoice (id,company_id,client_id,invoice_no,issue_date,due_date,total_amount,source) VALUES (:id,:company,:client,'LEGACY','2026-10-01','2026-10-23',100,'manual')"), dict(id=invoice_id,company=COMPANY,client=external_uuid("CLI-01")))
            db.execute(text("INSERT INTO priority_snapshot (id,company_id,invoice_id,rule_id,as_of_date,computed_at,outstanding_amount,days_overdue,grace_days,effective_days,score,rank,reason,rule_snapshot) VALUES (:id,:company,:invoice,:rule,'2026-10-23',now(),100,30,0,30,3000,1,'Legacy','{}')"), dict(id=snapshot_id,company=COMPANY,invoice=invoice_id,rule=rule_id))
            for _ in range(2):
                db.execute(text("INSERT INTO alert (id,company_id,snapshot_id,recipient_id,trigger_type,channel,status) VALUES (:id,:company,:snapshot,:recipient,'safety_rule','dashboard','new')"), dict(id=uuid4(),company=COMPANY,snapshot=snapshot_id,recipient=FINANCE))
        with pytest.raises(RuntimeError, match="Duplicate alert history"):
            command.upgrade(config, "head")
        with engine.connect() as db:
            assert db.scalar(text("SELECT count(*) FROM alert")) == 2
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0001"


def test_holiday_adapter_integration_and_rule_snapshot(store):
    from app.orbyte.schemas import PublicHoliday
    engine, _ = store
    class HolidayAdapter:
        def __getattr__(self, name):
            return getattr(adapter, name)
        def list_public_holidays(self, company, start, end):
            assert company == COMPANY
            return [PublicHoliday(date=date(2026,10,22), name="Mock holiday"), PublicHoliday(date=date(2026,10,22), name="Duplicate holiday")]
    with Session(engine) as db:
        invoice(db, total="1000", age=4)
        rule = db.scalar(select(FollowupRule))
        rule.skip_holidays = True
        rule.alert_threshold = Decimal("3000")
        db.commit()
    with Session(engine) as db:
        result = refresh_workspace(db, COMPANY, HolidayAdapter(), FINANCE, now=NOW)
        db.commit()
        snapshot = db.scalar(select(PrioritySnapshot))
        assert snapshot.rule_snapshot["skip_holidays"] is True
    detail = result.invoices[0].calculation
    assert detail.days_overdue == 3
    assert detail.score == "3000.00"
    assert detail.eligible
    assert detail.holidays_excluded == [date(2026,10,22)]


def test_payment_rollback_after_configuration_failure_preserves_workspace(store):
    engine, _ = store
    with Session(engine) as db:
        row = invoice(db)
        row_id = row.id
        db.commit()
    saved = refresh(engine)
    with Session(engine) as db:
        db.delete(db.get(ClientFollowupProfile, external_uuid("CLI-02")))
        db.commit()
    def session():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            response = client.post(f"/api/invoices/{row_id}/payments", headers=HEADERS, json={"amount": "100", "received_date": "2026-10-23"})
            assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PaymentRecord)) == 0
        assert db.get(Invoice, row_id).status == "open"
        assert read_workspace(db, COMPANY).model_dump(mode="json") == saved


def test_migrated_schema_matches_models(store):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from app.db.base import Base
    engine, _ = store
    with engine.connect() as db:
        assert compare_metadata(MigrationContext.configure(db, opts={"compare_type": True}), Base.metadata) == []


def test_saved_workspace_uses_last_transaction_when_timestamps_match(store):
    engine,_ = store
    with Session(engine) as db:
        row = invoice(db)
        row_id = row.id
        db.commit()
    refresh(engine)
    with Session(engine) as db:
        row = db.get(Invoice,row_id)
        payment(db,row,"2500")
        row.status = "paid"
        db.commit()
    last = refresh(engine)  # deliberately the exact same injected timestamp
    with Session(engine) as db:
        assert read_workspace(db,COMPANY).model_dump(mode="json") == last
        assert not read_workspace(db,COMPANY).queue_ids
