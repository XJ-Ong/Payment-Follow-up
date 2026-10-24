from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from conftest import database_context
from app.db.models import ActivityLog, Approval, ClientFollowupProfile, FollowupRule, Invoice, PaymentRecord, ReminderDraft, SendLog
from app.ids import external_uuid
from app.main import app, get_db, COMPANY
from app.orbyte.mock import MockOrbyteAdapter
from app.services.followups import refresh_workspace, read_workspace
from app.services.workflow import create_draft, draft_view, mutate, WorkflowError
from app.workflow_schemas import DraftMutation

TODAY = date(2026,10,24)
NOW = datetime(2026,10,24,4,tzinfo=timezone.utc)
ADAPTER = MockOrbyteAdapter(reference_date=TODAY)
FINANCE = ADAPTER.get_user(external_uuid("USR-02"))
BACKUP = ADAPTER.get_user(external_uuid("USR-05"))
OWNER = ADAPTER.get_user(external_uuid("USR-01"))

@pytest.fixture
def world():
    with database_context() as (engine, config):
        yield engine, config


def invoice(engine, total="1000", client="CLI-01"):
    with Session(engine) as db:
        row = Invoice(id=uuid4(),company_id=COMPANY,client_id=external_uuid(client),invoice_no="WF-"+uuid4().hex[:8],issue_date=TODAY-timedelta(days=60),due_date=TODAY-timedelta(days=40),total_amount=Decimal(total),source="manual",status="open")
        db.add(row)
        db.commit()
        return row.id


def create(engine, invoice_id, actor=FINANCE, adapter=ADAPTER, now=NOW):
    with Session(engine) as db:
        draft = create_draft(db,COMPANY,adapter,actor,invoice_id,now=now)
        refresh_workspace(db,COMPANY,adapter,actor.id,now=now)
        result = draft_view(db,draft,adapter,actor,now)
        db.commit()
        return result


def act(engine, draft, action, actor=FINANCE, adapter=ADAPTER, now=NOW, **payload):
    with Session(engine) as db:
        try:
            row = mutate(db,COMPANY,adapter,actor,uuid_from(draft["id"]),action,DraftMutation(version=draft["version"],**payload),now=now)
            result = draft_view(db,row,adapter,actor,now)
            db.commit()
            return result
        except WorkflowError as error:
            db.commit() if error.persist else db.rollback()
            raise


def uuid_from(value):
    from uuid import UUID
    return UUID(value)


def approved(engine, total="1000", adapter=ADAPTER):
    invoice_id = invoice(engine,total)
    draft = create(engine,invoice_id,adapter=adapter)
    draft = act(engine,draft,"submit",adapter=adapter)
    first = BACKUP if adapter.list_approved_leave(FINANCE.id,TODAY) else FINANCE
    draft = act(engine,draft,"approve",actor=first,adapter=adapter)
    if draft["required_approvals"] == 2:
        draft = act(engine,draft,"approve",actor=OWNER,adapter=adapter)
    return invoice_id,draft


@pytest.mark.parametrize("language,tone,opening", [("English","Friendly","friendly reminder"),("English","Neutral","Payment reminder"),("English","Firm","requiring your attention"),("Bahasa Malaysia","Friendly","Peringatan mesra"),("Bahasa Malaysia","Neutral","Peringatan pembayaran"),("Bahasa Malaysia","Firm","Tindakan pembayaran diperlukan")])
def test_bilingual_channel_and_tone_templates(world,language,tone,opening):
    engine,_ = world
    with Session(engine) as db:
        profile = db.get(ClientFollowupProfile,external_uuid("CLI-01"))
        profile.language,profile.tone,profile.preferred_channel = language,tone,"Email"
        db.commit()
    draft = create(engine,invoice(engine),actor=OWNER)
    assert draft["author_name"] == OWNER.name
    assert opening in draft["body"]
    assert "1000.00" in draft["body"] and "Maju Jaya" in draft["body"]
    assert draft["channel"] == "Email"
    assert "lim@" in draft["recipient"]
    assert "\n\n" in draft["body"]


def test_standard_approval_separate_send_and_history(world):
    engine,_ = world
    invoice_id,draft = approved(engine)
    assert draft["status"] == "approved"
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 0
    sent = act(engine,draft,"send",actor=OWNER)
    assert sent["status"] == "sent"
    act(engine,sent,"send",actor=BACKUP)  # idempotent across actors
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 1
        record = db.scalar(select(SendLog))
        assert record.approved_body == draft["body"]
        assert record.recipient_contact == draft["recipient"]
        saved = read_workspace(db,COMPANY)
        assert invoice_id not in saved.queue_ids
        assert any(a.action == "reminder.simulated_sent" for a in db.scalars(select(ActivityLog)))


@pytest.mark.parametrize("amount,count", [("20000.00",1),("20000.01",2)])
def test_exact_high_value_boundary_and_order(world,amount,count):
    engine,_ = world
    draft = create(engine,invoice(engine,amount),actor=OWNER)
    assert draft["required_approvals"] == count
    draft = act(engine,draft,"submit",actor=OWNER)
    with pytest.raises(WorkflowError) as error:
        act(engine,draft,"approve",actor=OWNER)
    assert error.value.code == 403
    draft = act(engine,draft,"approve")
    if count == 2:
        assert draft["status"] == "pending_second_approval"
        with pytest.raises(WorkflowError):
            act(engine,draft,"approve")
        with pytest.raises(WorkflowError):
            act(engine,draft,"send")
        draft = act(engine,draft,"approve",actor=OWNER)
    assert draft["status"] == "approved"
    assert len({a["approver_id"] for a in draft["approvals"]}) == count


def test_backup_finance_and_owner_leave(world):
    engine,_ = world
    leave = MockOrbyteAdapter(demo_leave_active=True,reference_date=TODAY)
    draft = create(engine,invoice(engine,"30000"),adapter=leave)
    draft = act(engine,draft,"submit",adapter=leave)
    assert draft["assigned_approver_id"] == str(BACKUP.id)
    with pytest.raises(WorkflowError):
        act(engine,draft,"approve",actor=FINANCE,adapter=leave)
    draft = act(engine,draft,"approve",actor=BACKUP,adapter=leave)
    owner_leave = MockOrbyteAdapter(demo_leave_active=True,demo_owner_leave_active=True,reference_date=TODAY)
    with Session(engine) as db:
        view = draft_view(db,db.get(ReminderDraft,uuid_from(draft["id"])),owner_leave,OWNER,NOW)
        assert "Waiting for Owner" in view["waiting_reason"]
        assert "approve" not in view["allowed_actions"]
    with pytest.raises(WorkflowError):
        act(engine,draft,"approve",actor=OWNER,adapter=owner_leave)
    draft = act(engine,draft,"approve",actor=OWNER,adapter=leave)
    assert draft["status"] == "approved"


def test_immutable_versions_and_edit_approve_resets_owner_step(world):
    engine,_ = world
    draft = create(engine,invoice(engine,"30000"))
    original = draft
    draft = act(engine,draft,"submit")
    draft = act(engine,draft,"approve")
    changed = act(engine,draft,"edit-approve",body=draft["body"]+"\nPlease confirm receipt.")
    assert changed["version"] == 2
    assert changed["status"] == "pending_second_approval"
    assert len(changed["approvals"]) == 1
    assert changed["supersedes_id"] == original["id"]
    with pytest.raises(WorkflowError):
        act(engine,original,"approve",actor=OWNER)
    with Session(engine) as db:
        previous = db.get(ReminderDraft,uuid_from(original["id"]))
        assert previous.body == original["body"] and previous.status == "superseded"
        previous.body = "tamper"
        with pytest.raises(DBAPIError):
            db.commit()
        db.rollback()
        approval = db.scalar(select(Approval).where(Approval.draft_id == uuid_from(original["id"])))
        approval.decision = "skip"
        with pytest.raises(DBAPIError):
            db.commit()


def test_save_pending_or_approved_edit_requires_fresh_finance_approval(world):
    engine,_ = world
    _,draft = approved(engine,"30000")
    edited = act(engine,draft,"versions",actor=OWNER,body=draft["body"]+"\nThank you for reviewing.")
    assert edited["status"] == "draft" and edited["approvals"] == []
    with pytest.raises(WorkflowError):
        act(engine,edited,"approve",actor=OWNER)
    with pytest.raises(WorkflowError):
        act(engine,draft,"send")


@pytest.mark.parametrize("action,days", [("skip",1),("snooze",3)])
def test_suppression_expiry_in_malaysia_and_new_draft(world,action,days):
    engine,_ = world
    invoice_id = invoice(engine)
    draft = create(engine,invoice_id)
    payload = dict(reason="Follow up later")
    if action == "snooze":
        payload["snooze_until"] = TODAY+timedelta(days=days)
    terminal = act(engine,draft,action,**payload)
    assert not terminal["is_current"]
    deadline = datetime(2026,10,24+days,0,tzinfo=timezone(timedelta(hours=8)))
    with Session(engine) as db:
        before = refresh_workspace(db,COMPANY,ADAPTER,FINANCE.id,now=deadline-timedelta(seconds=1))
        assert invoice_id not in before.queue_ids
        db.commit()
    with Session(engine) as db:
        after = refresh_workspace(db,COMPANY,ADAPTER,FINANCE.id,now=deadline)
        assert invoice_id in after.queue_ids
        db.commit()
    resumed = create(engine,invoice_id,now=deadline)
    assert resumed["version"] == 2 and resumed["approvals"] == []


def test_invalid_snooze_and_bad_edit_roll_back(world):
    engine,_ = world
    draft = create(engine,invoice(engine))
    with pytest.raises(WorkflowError):
        act(engine,draft,"snooze",snooze_until=TODAY)
    with pytest.raises(WorkflowError):
        act(engine,draft,"versions",body="Missing verified facts")
    with Session(engine) as db:
        assert db.get(ReminderDraft,uuid_from(draft["id"])).is_current
        assert db.scalar(select(func.count()).select_from(ReminderDraft)) == 1


@pytest.mark.parametrize("change", ["payment","void","dnc","recipient","policy"])
def test_send_rechecks_facts_and_eligibility_and_records_block(world,change):
    engine,_ = world
    invoice_id,draft = approved(engine)
    changed_adapter = ADAPTER
    with Session(engine) as db:
        if change == "payment":
            db.add(PaymentRecord(id=uuid4(),company_id=COMPANY,invoice_id=invoice_id,amount=1,received_date=TODAY,payment_type="partial",recorded_by=FINANCE.id))
        elif change == "void":
            db.get(Invoice,invoice_id).status = "void"
        elif change == "dnc":
            db.get(ClientFollowupProfile,external_uuid("CLI-01")).do_not_contact = True
        elif change == "policy":
            db.scalar(select(FollowupRule)).second_approval_amount = 500
        elif change == "recipient":
            changed_adapter = MockOrbyteAdapter(reference_date=TODAY)
            client_id = external_uuid("CLI-01")
            changed_adapter._clients[client_id] = changed_adapter._clients[client_id].model_copy(update={"phone":"+60111111111"})
        db.commit()
    with pytest.raises(WorkflowError):
        act(engine,draft,"send",adapter=changed_adapter)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 0
        assert db.get(ReminderDraft,uuid_from(draft["id"])).status == "invalidated"
        assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "send.blocked"))


def test_duplicate_create_approve_and_send_concurrency(world):
    engine,_ = world
    invoice_id = invoice(engine)
    def create_once(_):
        try:
            return create(engine,invoice_id)
        except WorkflowError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        drafts = list(pool.map(create_once,range(2)))
    draft = next(d for d in drafts if d)
    assert sum(d is not None for d in drafts) == 1
    draft = act(engine,draft,"submit")
    def approve_once(_):
        try:
            return act(engine,draft,"approve")
        except WorkflowError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve_once,range(2)))
    draft = next(d for d in results if d)
    assert sum(d is not None for d in results) == 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: act(engine,draft,"send"),range(2)))
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 1


def test_api_identity_selected_authorship_timeline_and_isolation(world,monkeypatch):
    import app.main as main
    engine,_ = world
    monkeypatch.setattr(main,"adapter",ADAPTER)
    def db():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = db
    try:
        with TestClient(app) as client:
            for role,user in [("Owner",BACKUP.id),("Finance",OWNER.id),("Finance",uuid4()),("Finance","invalid")]:
                assert client.get("/api/invoices",headers={"X-Role":role,"X-User-ID":str(user)}).status_code == 403
            headers = {"X-Role":"Finance","X-User-ID":str(BACKUP.id)}
            created = client.post("/api/invoices",headers=headers,json=dict(invoice_no="BACKUP-INVOICE",client_id=str(external_uuid("CLI-01")),issue_date="2026-08-01",due_date="2026-08-02",total_amount="1000",initial_payment="1"))
            assert created.status_code == 201, created.text
            invoice_id = created.json()["id"]
            draft = client.post(f"/api/invoices/{invoice_id}/drafts",headers=headers)
            assert draft.status_code == 201, draft.text
            assert draft.json()["prepared_by"] == str(BACKUP.id)
            timeline = client.get(f"/api/invoices/{invoice_id}/timeline",headers=headers).json()
            assert any(a["actor_id"] == str(BACKUP.id) and a["action"] == "payment.recorded" for a in timeline)
            assert client.get(f"/api/invoices/{uuid4()}/timeline",headers=headers).status_code == 404
            assert client.post(f"/api/drafts/{uuid4()}/approve",headers=headers,json={"version":1}).status_code == 404
            assert client.get("/api/outbox",headers={"X-Role":"Other Staff"}).status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_legacy_migration_preserves_author_history_and_custom_settings():
    with database_context("0002") as (engine,config):
        author, draft_id, invoice_id = external_uuid("USR-03"),uuid4(),uuid4()
        with engine.begin() as db:
            db.execute(text("INSERT INTO invoice (id,company_id,client_id,invoice_no,issue_date,due_date,total_amount,source) VALUES (:id,:company,:client,'LEGACY','2026-10-01','2026-10-23',100,'manual')"),dict(id=invoice_id,company=COMPANY,client=external_uuid("CLI-01")))
            db.execute(text("INSERT INTO reminder_draft (id,company_id,invoice_id,prepared_by,version,channel,language,tone,body,written_by,verification_result,status) VALUES (:id,:company,:invoice,:author,1,'Email','English','Friendly','Historical content','template','{}','approved')"),dict(id=draft_id,company=COMPANY,invoice=invoice_id,author=author))
            db.execute(text("UPDATE followup_rule SET min_spacing_days=9"))
        command.upgrade(config,"head")
        with Session(engine) as db:
            draft = db.get(ReminderDraft,draft_id)
            assert draft.is_legacy and not draft.is_current
            assert draft.prepared_by == author and draft.body == "Historical content"
            rule = db.scalar(select(FollowupRule))
            assert rule.min_spacing_days == 9
            assert rule.backup_approver_id == BACKUP.id and rule.owner_approver_id == OWNER.id
        with pytest.raises(WorkflowError):
            act(engine,{"id":str(draft_id),"version":1},"send")


def test_skip_closes_approved_journey_and_expiry_requires_new_approvals(world):
    engine,_ = world
    invoice_id,draft = approved(engine)
    terminal = act(engine,draft,"skip",actor=OWNER,reason="Customer asked for tomorrow")
    assert terminal["status"] == "skipped" and len(terminal["approvals"]) == 1
    resumed = create(engine,invoice_id,now=NOW+timedelta(days=1))
    assert resumed["approvals"] == [] and resumed["status"] == "draft"
    with pytest.raises(WorkflowError):
        act(engine,draft,"send",now=NOW+timedelta(days=1))


def test_send_spacing_and_paid_recheck(world):
    engine,_ = world
    invoice_id,draft = approved(engine)
    with Session(engine) as db:
        history = ReminderDraft(id=uuid4(),company_id=COMPANY,invoice_id=invoice_id,version=2,channel="Email",language="English",tone="Friendly",body="Legacy simulated send",written_by="template",verification_result={},status="sent",is_current=False,is_legacy=True)
        db.add(history)
        db.flush()
        db.add(SendLog(id=uuid4(),company_id=COMPANY,draft_id=history.id,channel="Email",recipient_contact="test@example.test",approved_body=history.body,sent_at=NOW-timedelta(days=1),status="simulated"))
        db.commit()
    with pytest.raises(WorkflowError):
        act(engine,draft,"send")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 1
        assert db.get(ReminderDraft,uuid_from(draft["id"])).status == "invalidated"


def test_current_version_tokens_and_cross_company_scope(world,monkeypatch):
    import app.main as main
    engine,_ = world
    monkeypatch.setattr(main,"adapter",ADAPTER)
    invoice_id,draft = approved(engine)
    with Session(engine) as db:
        foreign_company,foreign_invoice,foreign_draft = uuid4(),uuid4(),uuid4()
        db.add(Invoice(id=foreign_invoice,company_id=foreign_company,client_id=uuid4(),invoice_no="FOREIGN",issue_date=TODAY,due_date=TODAY,total_amount=100,source="manual"))
        db.flush()
        db.add(ReminderDraft(id=foreign_draft,company_id=foreign_company,invoice_id=foreign_invoice,version=1,channel="Email",language="English",tone="Friendly",body="PRIVATE",written_by="template",verification_result={},status="draft"))
        db.commit()
    def database():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = database
    headers = {"X-Role":"Finance"}
    try:
        with TestClient(app) as client:
            stale = client.post(f"/api/drafts/{draft['id']}/send",headers=headers,json={"version":draft["version"]+1})
            assert stale.status_code == 409
            assert client.get(f"/api/invoices/{foreign_invoice}/drafts",headers=headers).status_code == 404
            assert client.post(f"/api/drafts/{foreign_draft}/submit",headers=headers,json={"version":1}).status_code == 404
            assert "PRIVATE" not in client.get("/api/activity",headers=headers).text
            assert "FOREIGN" not in client.get("/api/outbox",headers=headers).text
    finally:
        app.dependency_overrides.clear()


def test_configuration_failure_on_send_is_audited(world,monkeypatch):
    import app.main as main
    engine,_ = world
    monkeypatch.setattr(main,"adapter",ADAPTER)
    _,draft = approved(engine)
    with Session(engine) as db:
        db.delete(db.get(ClientFollowupProfile,external_uuid("CLI-02")))
        db.commit()
    def database():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = database
    try:
        with TestClient(app) as client:
            response = client.post(f"/api/drafts/{draft['id']}/send",headers={"X-Role":"Finance"},json={"version":draft["version"]})
            assert response.status_code == 409
            assert "Missing follow-up profile" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 0
        assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "send.blocked"))


def test_seed_reset_can_reapply_workflow_migrations_and_preserves_authorship():
    import os
    import subprocess
    import sys
    from pathlib import Path
    with database_context(reference=False) as (engine,config):
        environment = os.environ | {"DATABASE_URL":engine.url.render_as_string(hide_password=False)}
        root = Path(__file__).resolve().parents[1]
        for options in [[],["--reset"]]:
            result = subprocess.run([sys.executable,"-m","app.db.seed",*options],cwd=root,env=environment,capture_output=True,text=True,timeout=30)
            assert result.returncode == 0, result.stderr
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(Invoice)) == 20
            assert db.scalar(select(FollowupRule)).owner_approver_id == OWNER.id
            assert all(d.prepared_by == FINANCE.id and d.is_legacy for d in db.scalars(select(ReminderDraft)))
