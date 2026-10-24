"""Real-delivery workflow tests use fake transports, never project credentials."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from uuid import uuid4
import json
import httpx
import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from conftest import database_context
from test_workflow import ADAPTER, FINANCE, OWNER, NOW, TODAY, invoice, create, act, approved
from app.main import app, get_db, COMPANY
from app.db.models import Approval, ActivityLog, ClientFollowupProfile, DeliveryAttempt, FollowupRule, Invoice, PaymentRecord, ReminderDraft, SendLog
from app.ids import external_uuid
from app.messaging import MessagingService, DeliveryResult
from app.services import delivery, workflow
from app.services.followups import refresh_workspace
from app.workflow_schemas import DraftMutation


@pytest.fixture
def setup(monkeypatch):
    with database_context() as (engine, config):
        def db():
            with Session(engine) as session:
                yield session
        app.dependency_overrides[get_db] = db
        monkeypatch.setattr('app.main.adapter',ADAPTER)
        try:
            with TestClient(app) as client:
                yield client,engine,config
        finally:
            app.dependency_overrides.clear()


def telegram(engine):
    with Session(engine) as db:
        profile = db.get(ClientFollowupProfile,external_uuid('CLI-01'))
        profile.preferred_channel, profile.telegram_chat_id = 'Telegram','123456789'
        db.commit()


def send(engine,draft,sender,now=NOW,actor=FINANCE):
    with Session(engine) as db:
        try:
            result = delivery.dispatch(db,COMPANY,ADAPTER,actor,draft['id'],DraftMutation(version=draft['version']),now=now,sender=sender)
            view = workflow.draft_view(db,result,ADAPTER,actor,now)
            db.commit()
            return view
        except workflow.WorkflowError as error:
            db.commit() if error.persist else db.rollback()
            raise


def service(handler):
    return MessagingService('synthetic-token',transport=httpx.MockTransport(handler))


@pytest.mark.parametrize('total,required',[('1000',1),('20000',1),('20000.01',2)])
def test_telegram_approved_exact_body_sent_once_and_persisted(setup,total,required):
    client,engine,_ = setup
    telegram(engine)
    row,draft = approved(engine,total)
    assert draft['required_approvals'] == required
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200,json={'ok':True,'result':{'message_id':789}})
    sender = service(handler)
    first, second = send(engine,draft,sender), send(engine,draft,sender)
    assert first['status'] == second['status'] == 'sent'
    assert first['delivery']['provider_message_id'] == '789'
    assert len(calls) == 1 and calls[0]['text'] == draft['body'] and calls[0]['chat_id'] == '123456789'
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(DeliveryAttempt)) == 1
        assert db.scalar(select(func.count()).select_from(SendLog)) == 1
        event = db.scalar(select(ActivityLog).where(ActivityLog.action == 'telegram.sent'))
        assert event.actor_type == 'system' and event.actor_id is None
        assert event.after_state['initiated_by'] == str(FINANCE.id)
        refreshed = refresh_workspace(db,COMPANY,ADAPTER,FINANCE.id,now=NOW)
        result = next(i for i in refreshed.invoices if i.id == row)
        assert not result.calculation.eligible and result.calculation.last_sent_date == TODAY
    receipt = client.get('/api/outbox',headers={'X-Role':'Owner'}).json()[0]
    assert receipt['status'] == 'sent' and receipt['provider_message_id'] == '789'
    assert receipt['approved_body'] == draft['body']


@pytest.mark.parametrize('status,code', [('failed','telegram_403'),('failed','telegram_429'),('unknown','transport_uncertain')])
def test_failures_and_unknown_are_durable_and_never_blindly_retried(setup,status,code):
    _,engine,_ = setup
    telegram(engine)
    row,draft = approved(engine)
    class Sender:
        calls = 0
        def send(self,message):
            self.calls += 1
            return DeliveryResult(channel='Telegram',status=status,error_code=code,retry_after_seconds=60 if code == 'telegram_429' else None)
    sender = Sender()
    result = send(engine,draft,sender)
    assert result['delivery']['status'] == status
    assert 'send' not in result['allowed_actions']
    assert send(engine,draft,sender)['delivery']['status'] == status and sender.calls == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 0
        current = db.get(ReminderDraft,draft['id'])
        if status == 'unknown':
            assert not workflow.draft_view(db,current,ADAPTER,FINANCE,NOW)['allowed_actions']
        else:
            assert 'versions' in result['allowed_actions']
    if status == 'unknown':
        with pytest.raises(workflow.WorkflowError):
            act(engine,draft,'versions',body=draft['body']+'\nAgain')


def test_concurrent_duplicate_requests_share_the_committed_claim(setup):
    _,engine,_ = setup
    telegram(engine)
    _,draft = approved(engine)
    entered, release = Event(),Event()
    class Sender:
        calls = 0
        def send(self,message):
            self.calls += 1
            entered.set()
            assert release.wait(10)
            return DeliveryResult(channel='Telegram',status='sent',provider_message_id='456')
    sender = Sender()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send,engine,draft,sender)
        assert entered.wait(10)
        try:
            second = pool.submit(send,engine,draft,sender).result(timeout=10)
            assert second['delivery']['status'] == 'sending'
            assert second['allowed_actions'] == []
        finally:
            release.set()
        assert first.result()['status'] == 'sent'
    assert sender.calls == 1


def test_interrupted_claim_recovers_as_unknown_and_blocks_new_journeys(setup):
    _,engine,_ = setup
    telegram(engine)
    row,draft = approved(engine)
    with Session(engine) as db:
        db.add(DeliveryAttempt(id=uuid4(),company_id=COMPANY,draft_id=draft['id'],initiated_by=FINANCE.id,
            recipient_contact=draft['recipient'],approved_body=draft['body'],content_digest='x'*64,
            status='sending',started_at=NOW-timedelta(minutes=3)))
        workspace = refresh_workspace(db,COMPANY,ADAPTER,FINANCE.id,now=NOW)
        db.commit()
        assert db.scalar(select(DeliveryAttempt)).status == 'unknown'
        assert row not in workspace.queue_ids
    with pytest.raises(workflow.WorkflowError):
        create(engine,row)


def test_mapping_validation_whatsapp_demo_revision_and_invalidation(setup):
    client,engine,_ = setup
    _,draft = approved(engine)
    path = f'/api/customers/{external_uuid("CLI-01")}/profile'
    headers = {'X-Role':'Finance'}
    saved = client.get(path,headers=headers).json()
    from app.settings_schemas import ProfileInput
    values = {key:saved[key] for key in ProfileInput.model_fields}
    for mapping in (None,'','@customer','0',' 123','1'*65):
        assert client.post(path,headers=headers,json=values | dict(preferred_channel='Telegram',telegram_chat_id=mapping)).status_code == 422
    assert client.post(path,headers=headers,json=values | dict(preferred_channel='WhatsApp')).status_code == 200
    result = client.post(path,headers=headers,json=values | dict(preferred_channel='Telegram',telegram_chat_id='123456789'))
    assert result.status_code == 200, result.text
    assert result.json()['invalidated_journeys'] == 1
    assert client.get(path,headers=headers).json()['telegram_chat_id'] == '123456789'
    assert client.post(path,headers=headers,json=values).status_code == 409
    assert client.post(path,headers={'X-Role':'Other Staff'},json=values).status_code == 403
    with Session(engine) as db:
        assert db.get(ReminderDraft,draft['id']).status == 'invalidated'


def test_send_requires_current_facts_approvals_and_company_identity(setup,monkeypatch):
    client,engine,_ = setup
    telegram(engine)
    row = invoice(engine,'30000')
    draft = act(engine,create(engine,row),'submit')
    class NeverSend:
        def send(self,message):
            pytest.fail('Network called without valid approvals')
    monkeypatch.setattr(delivery.MessagingService,'from_env',lambda:NeverSend())
    url = f"/api/drafts/{draft['id']}/send"
    for headers,expected in [({'X-Role':'Other Staff'},403),({'X-Role':'Finance','X-User-ID':str(OWNER.id)},403),({'X-Role':'Finance'},409)]:
        assert client.post(url,headers=headers,json={'version':draft['version']}).status_code == expected
    assert client.post(f'/api/drafts/{uuid4()}/send',headers={'X-Role':'Finance'},json={'version':1}).status_code == 404
    draft = act(engine,draft,'approve')
    with pytest.raises(workflow.WorkflowError):
        send(engine,draft,NeverSend())
    draft = act(engine,draft,'approve',actor=OWNER)
    with Session(engine) as db:
        db.get(ClientFollowupProfile,external_uuid('CLI-01')).telegram_chat_id = '987654321'
        db.commit()
    with pytest.raises(workflow.WorkflowError):
        send(engine,draft,NeverSend())
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(DeliveryAttempt)) == 0


def test_telegram_length_checked_before_approval_and_whatsapp_demo_drafts(setup):
    _,engine,_ = setup
    telegram(engine)
    draft = create(engine,invoice(engine))
    with pytest.raises(workflow.WorkflowError,match='4,096'):
        act(engine,draft,'versions',body=draft['body']+'😀'*2100)
    with Session(engine) as db:
        db.get(ClientFollowupProfile,external_uuid('CLI-01')).preferred_channel='WhatsApp'
        db.commit()
    simulated = create(engine,invoice(engine))
    assert simulated['channel'] == 'WhatsApp'
    assert simulated['recipient'] == ADAPTER.get_client(external_uuid('CLI-01')).phone


def test_migration_preserves_existing_history_and_schema():
    with database_context('0006') as (engine,config):
        with engine.connect() as db:
            before = db.execute(text('SELECT client_id,preferred_channel FROM client_followup_profile ORDER BY client_id')).all()
        command.upgrade(config,'head')
        with engine.connect() as db:
            assert db.execute(text('SELECT client_id,preferred_channel FROM client_followup_profile ORDER BY client_id')).all() == before
            assert db.scalar(text('SELECT count(*) FROM delivery_attempt')) == 0
        command.check(config)


@pytest.mark.parametrize('change',['paid','void','dnc'])
def test_telegram_dispatch_rechecks_payment_and_contact_eligibility(setup,change):
    _,engine,_ = setup
    telegram(engine)
    row,draft = approved(engine)
    with Session(engine) as db:
        if change == 'paid':
            db.add(PaymentRecord(id=uuid4(),company_id=COMPANY,invoice_id=row,amount='1000',received_date=TODAY,payment_type='full',recorded_by=FINANCE.id))
            db.get(Invoice,row).status='paid'
        elif change == 'void':
            db.get(Invoice,row).status='void'
        else:
            db.get(ClientFollowupProfile,external_uuid('CLI-01')).do_not_contact=True
        db.commit()
    class NeverSend:
        def send(self,message):
            pytest.fail('Ineligible invoice reached Telegram')
    with pytest.raises(workflow.WorkflowError):
        send(engine,draft,NeverSend())


def test_accepted_but_result_transaction_failed_is_not_resent(setup,monkeypatch):
    _,engine,_ = setup
    telegram(engine)
    _,draft = approved(engine)
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200,json={'ok':True,'result':{'message_id':123}})
    sender = service(handler)
    original = delivery.refresh_workspace
    def fail(*args,**kwargs):
        raise RuntimeError('Injected finalization failure')
    monkeypatch.setattr(delivery,'refresh_workspace',fail)
    with pytest.raises(RuntimeError,match='finalization'):
        send(engine,draft,sender)
    monkeypatch.setattr(delivery,'refresh_workspace',original)
    assert send(engine,draft,sender)['delivery']['status'] == 'sending'
    assert len(calls) == 1
    with Session(engine) as db:
        refresh_workspace(db,COMPANY,ADAPTER,FINANCE.id,now=NOW+timedelta(minutes=3))
        db.commit()
        assert db.scalar(select(DeliveryAttempt)).status == 'unknown'
        assert db.scalar(select(func.count()).select_from(SendLog)) == 0


def test_missing_configuration_is_saved_as_failure_without_network(setup):
    _,engine,_ = setup
    telegram(engine)
    _,draft = approved(engine)
    result = send(engine,draft,MessagingService(None))
    assert result['delivery']['status'] == 'failed'
    assert result['delivery']['error_code'] == 'not_configured'


def test_whatsapp_approved_journey_is_simulated_without_external_delivery(setup,monkeypatch):
    client,engine,_ = setup
    row = invoice(engine)
    with Session(engine) as db:
        facts = {**workflow.facts_for(db,COMPANY,db.get(Invoice,row),ADAPTER),'channel':'WhatsApp',
                 'recipient':ADAPTER.get_client(external_uuid('CLI-01')).phone}
        saved = ReminderDraft(id=uuid4(),company_id=COMPANY,invoice_id=row,version=1,prepared_by=FINANCE.id,
            channel='WhatsApp',language=facts['language'],tone=facts['tone'],body=workflow.template(facts),written_by='template',
            verification_result={'facts_checked':True},facts=facts,approval_policy=workflow.policy_for(db.scalar(select(FollowupRule)),facts),
            status='approved',is_current=True,is_legacy=False)
        db.add(saved)
        db.flush()
        db.add(Approval(id=uuid4(),company_id=COMPANY,draft_id=saved.id,approver_id=FINANCE.id,approval_step=1,
            decision='approve',is_legacy=False,context={'content_digest':workflow.digest(saved),'assigned_to':str(FINANCE.id),'role':'finance'}))
        draft = {'id':str(saved.id),'invoice_id':str(row),'version':1}
        db.commit()
    monkeypatch.setattr(delivery.MessagingService,'from_env',lambda:pytest.fail('WhatsApp must not call a real sender'))
    response = client.post(f"/api/drafts/{draft['id']}/send",headers={'X-Role':'Finance'},json={'version':draft['version']})
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'sent' and response.json()['delivery'] is None
    assert client.post(f"/api/drafts/{draft['id']}/send",headers={'X-Role':'Finance'},json={'version':draft['version']}).status_code == 200
    history = client.get(f"/api/invoices/{draft['invoice_id']}/drafts",headers={'X-Role':'Owner'}).json()
    assert history[0]['channel'] == 'WhatsApp' and 'send' not in history[0]['allowed_actions']
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SendLog)) == 1
        assert db.scalar(select(SendLog.status)) == 'simulated'
        assert db.scalar(select(func.count()).select_from(DeliveryAttempt)) == 0


@pytest.mark.parametrize("actor", [FINANCE, OWNER])
@pytest.mark.parametrize("outcome", ["sent", "failed", "unknown"])
def test_single_approval_fresh_telegram_draft_records_sender_once(setup, actor, outcome):
    _,engine,_ = setup
    telegram(engine)
    draft = create(engine,invoice(engine),actor=OWNER)
    class Sender:
        calls = 0
        def send(self, message):
            self.calls += 1
            return DeliveryResult(channel="Telegram", status=outcome,
                provider_message_id="123" if outcome == "sent" else None,
                error_code=None if outcome == "sent" else "test_failure")
    sender = Sender()
    result = send(engine,draft,sender,actor=actor)
    assert result["delivery"]["status"] == outcome
    assert (result["status"] == "sent") == (outcome == "sent")
    assert len(result["approvals"]) == 1
    assert result["approvals"][0]["approver_id"] == str(actor.id)
    send(engine,draft,sender,actor=OWNER)
    assert sender.calls == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Approval)) == 1
        attempt = db.scalar(select(DeliveryAttempt))
        assert attempt.initiated_by == actor.id
        assert db.scalar(select(func.count()).select_from(SendLog)) == (1 if outcome == "sent" else 0)
