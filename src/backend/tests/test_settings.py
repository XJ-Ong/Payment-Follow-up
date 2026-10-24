"""Configuration writes, concurrency, rollback and reminder protection on PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from alembic import command
from conftest import database_context
from app.main import app, get_db, COMPANY
from app.db.models import ActivityLog, FollowupRule, ClientFollowupProfile, ReminderDraft, Approval, PrioritySnapshot, Invoice, SendLog
from app.ids import external_uuid
from app.services import settings
from app.services.followups import refresh_workspace, read_workspace
from test_workflow import ADAPTER, FINANCE, OWNER, NOW, TODAY, invoice, create, act, approved

@pytest.fixture
def setup(monkeypatch):
    with database_context() as (engine, config):
        def db():
            with Session(engine) as session:
                yield session
        app.dependency_overrides[get_db] = db
        monkeypatch.setattr('app.main.adapter', ADAPTER)
        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)
        monkeypatch.setattr('app.services.followups.datetime', FixedDateTime)
        try:
            with TestClient(app) as client:
                yield client, engine, config
        finally:
            app.dependency_overrides.clear()

OWNER_HEADERS = {'X-Role':'Owner'}
FINANCE_HEADERS = {'X-Role':'Finance'}
PATH = f'/api/customers/{external_uuid("CLI-01")}/profile'

def profile_payload(client):
    return {k:v for k,v in client.get(PATH,headers=FINANCE_HEADERS).json().items() if k in settings.ProfileInput.model_fields}

def rule_payload(client):
    from app.settings_schemas import RulesInput
    return {k:v for k,v in client.get('/api/settings/rules',headers=OWNER_HEADERS).json().items() if k in RulesInput.model_fields}

def test_saved_profile_recalculates_audits_and_preserves_financial_totals(setup):
    client, engine, _ = setup
    row, draft = approved(engine)
    before = client.post('/api/followups/refresh',headers=FINANCE_HEADERS).json()
    payload = profile_payload(client)
    response = client.post(PATH,headers=FINANCE_HEADERS,json=payload | {'do_not_contact':True})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['invalidated_journeys'] == 1
    assert data['workspace']['dashboard']['total_outstanding'] == before['dashboard']['total_outstanding']
    assert str(row) not in data['workspace']['queue_ids']
    assert client.get(PATH,headers=FINANCE_HEADERS).json()['revision'] == payload['revision'] + 1
    saved = client.get('/api/followups',headers=FINANCE_HEADERS).json()
    assert saved['customers'][0]['profile'] is not None
    with Session(engine) as db:
        event = db.scalar(select(ActivityLog).where(ActivityLog.action == 'customer.profile_updated'))
        assert event.actor_id == FINANCE.id
        assert event.before_state['do_not_contact'] is False and event.after_state['do_not_contact'] is True
        assert db.get(ReminderDraft, draft['id']).status == 'invalidated'
        assert db.scalar(select(func.count()).select_from(Approval)) == 1

@pytest.mark.parametrize('field,value', [('language','English'),('tone','Firm'),('preferred_channel','Email')])
def test_message_preference_changes_invalidate_only_affected_customer(setup, field, value):
    client, engine, _ = setup
    _, first = approved(engine)
    unrelated = create(engine,invoice(engine,client='CLI-02'))
    payload = profile_payload(client)
    if payload[field] == value:
        value = {'language':'Bahasa Malaysia','tone':'Neutral','preferred_channel':'Telegram'}[field]
    result = client.post(PATH,headers=FINANCE_HEADERS,json=payload | {field:value} | ({'telegram_chat_id':'123456'} if value == 'Telegram' else {}))
    assert result.status_code == 200, result.text
    assert result.json()['invalidated_journeys'] == 1
    with Session(engine) as db:
        assert db.get(ReminderDraft,first['id']).is_current is False
        assert db.get(ReminderDraft,unrelated['id']).is_current is True

def test_rules_owner_only_and_scoring_retains_valid_approvals(setup):
    client, engine, _ = setup
    row, draft = approved(engine)
    payload = rule_payload(client)
    changed = payload | {'grace_days_by_tier':{'New':3,'Regular':9,'Key':16},'skip_holidays':True}
    assert client.post('/api/settings/rules',headers=FINANCE_HEADERS,json=changed).status_code == 403
    response = client.post('/api/settings/rules',headers=OWNER_HEADERS,json=changed)
    assert response.status_code == 200, response.text
    assert response.json()['invalidated_journeys'] == 0
    result = next(i for i in response.json()['workspace']['invoices'] if i['id'] == str(row))
    assert result['calculation']['grace_days'] == 3
    assert result['calculation']['score'] == '35000.00'
    assert len(result['calculation']['holidays_excluded']) == 2
    with Session(engine) as db:
        assert db.get(ReminderDraft,draft['id']).status == 'approved'
    policy = rule_payload(client) | {'second_approval_amount':'500.00'}
    result = client.post('/api/settings/rules',headers=OWNER_HEADERS,json=policy)
    assert result.json()['invalidated_journeys'] == 1
    fresh = create(engine,row)
    fresh = act(engine,fresh,'submit')
    assert fresh['required_approvals'] == 2

def test_tier_and_rule_eligibility_changes(setup):
    client, engine, _ = setup
    row = invoice(engine)
    regular = invoice(engine, client='CLI-02')
    initial = client.post('/api/followups/refresh',headers=FINANCE_HEADERS).json()['dashboard']['ranking_ids']
    assert initial.index(str(row)) < initial.index(str(regular))
    result = client.post(PATH,headers=FINANCE_HEADERS,json=profile_payload(client) | {'relationship_tier':'Key'})
    ranking = result.json()['workspace']['dashboard']['ranking_ids']
    assert ranking.index(str(row)) > ranking.index(str(regular))
    calc = next(i for i in result.json()['workspace']['invoices'] if i['id'] == str(row))['calculation']
    assert calc['score'] == '26000.00' and calc['grace_days'] == 14
    draft = create(engine,row)
    change = rule_payload(client) | {'safety_flag_days':100, 'alert_threshold':'999999.00'}
    result = client.post('/api/settings/rules',headers=OWNER_HEADERS,json=change).json()
    assert result['invalidated_journeys'] == 1
    assert str(row) not in result['workspace']['queue_ids']

@pytest.mark.parametrize('path,headers', [(PATH,FINANCE_HEADERS),('/api/settings/rules',OWNER_HEADERS)])
def test_revision_conflicts_and_concurrent_writes(setup,path,headers):
    client, _, _ = setup
    data = profile_payload(client) if path == PATH else rule_payload(client)
    change = {'tone':'Firm'} if path == PATH else {'min_spacing_days':6}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post(path,headers=headers,json=data | change).status_code,range(2)))
    assert sorted(results) == [200,409]
    assert client.post(path,headers=headers,json=data | change).status_code == 409
    current = profile_payload(client) if path == PATH else rule_payload(client)
    assert current['revision'] == data['revision'] + 1
    assert client.post(path,headers=headers,json=current).status_code == 200
    assert client.get(path,headers=headers).json()['revision'] == current['revision']

def test_validation_and_isolation(setup,monkeypatch):
    client, engine, _ = setup
    payload = profile_payload(client)
    for headers in ({},{'X-Role':'Other Staff'},{'X-Role':'Preparer'},{'X-Role':'Owner','X-User-ID':str(FINANCE.id)}):
        assert client.get(PATH,headers=headers).status_code == 403
        assert client.post('/api/settings/rules',headers=headers,json=rule_payload(client)).status_code == 403
    for change in ({'language':'French'},{'do_not_contact':'false'},{'revision':0},{'email':'external@example.test'}):
        assert client.post(PATH,headers=FINANCE_HEADERS,json=payload | change).status_code == 422
    rules = rule_payload(client)
    for change in ({'min_spacing_days':-1},{'safety_flag_days':0},{'safety_flag_days':1.5},{'alert_threshold':'NaN'},{'alert_threshold':'1.001'},{'second_approval_amount':'10000000000.00'},{'grace_days_by_tier':{'New':0}}):
        assert client.post('/api/settings/rules',headers=OWNER_HEADERS,json=rules | change).status_code == 422
    assert client.get(f'/api/customers/{uuid4()}/profile',headers=FINANCE_HEADERS).status_code == 404
    original = ADAPTER.get_client
    monkeypatch.setattr(ADAPTER,'get_client',lambda id: original(id).model_copy(update={'company_id':uuid4()}))
    assert client.get(PATH,headers=FINANCE_HEADERS).status_code == 404
    assert client.post(PATH,headers=FINANCE_HEADERS,json=payload).status_code == 404
    monkeypatch.setattr(ADAPTER,'get_client',lambda id: original(id).model_copy(update={'email':None}))
    assert client.post(PATH,headers=FINANCE_HEADERS,json=payload | {'preferred_channel':'Email'}).status_code == 422

def test_refresh_failure_rolls_back_configuration_revision_audit_and_journey(setup,monkeypatch):
    client, engine, _ = setup
    _, draft = approved(engine)
    payload = rule_payload(client)
    with Session(engine) as db:
        rule = db.scalar(select(FollowupRule))
        pointer = rule.latest_workspace_event_id
        count = db.scalar(select(func.count()).select_from(ActivityLog))
    def failure(*args,**kwargs):
        # Exercise rollback after snapshot and workflow side effects have been flushed.
        refresh_workspace(*args,**kwargs)
        raise RuntimeError('Injected refresh failure')
    monkeypatch.setattr(settings,'refresh_workspace',failure)
    with pytest.raises(RuntimeError,match='Injected refresh failure'):
        client.post('/api/settings/rules',headers=OWNER_HEADERS,json=payload | {'second_approval_amount':'500'})
    assert rule_payload(client) == payload
    with Session(engine) as db:
        assert db.scalar(select(FollowupRule.latest_workspace_event_id)) == pointer
        assert db.scalar(select(func.count()).select_from(ActivityLog)) == count
        assert db.get(ReminderDraft,draft['id']).is_current is True

def test_revision_migration_preserves_existing_values():
    with database_context('0004') as (engine,config):
        with engine.connect() as c:
            before = c.execute(text('SELECT company_id, alert_threshold FROM followup_rule')).all()
            profiles = c.scalar(text('SELECT count(*) FROM client_followup_profile'))
        command.upgrade(config,'head')
        with engine.connect() as c:
            assert c.execute(text('SELECT company_id, alert_threshold FROM followup_rule')).all() == before
            assert c.scalar(text('SELECT count(*) FROM client_followup_profile WHERE revision=1')) == profiles
            assert c.scalar(text('SELECT revision FROM followup_rule')) == 1
        command.check(config)

def test_spacing_history_snapshot_retention_and_backup_authorship(setup):
    client, engine, _ = setup
    row, draft = approved(engine)
    act(engine,draft,'send')
    with Session(engine) as db:
        refresh_workspace(db,COMPANY,ADAPTER,OWNER.id,now=NOW-timedelta(days=1))
        db.commit()
        history = [(s.id,s.score,s.reason) for s in db.scalars(select(PrioritySnapshot).where(PrioritySnapshot.as_of_date == TODAY-timedelta(days=1)))]
        sent = [(s.id,s.approved_body,s.recipient_contact) for s in db.scalars(select(SendLog))]
    payload = rule_payload(client)
    result = client.post('/api/settings/rules',headers=OWNER_HEADERS,json=payload | {'min_spacing_days':0})
    assert result.status_code == 200
    assert str(row) in result.json()['workspace']['queue_ids']
    # The full integer range remains valid even when the next date is beyond year 9999.
    result = client.post('/api/settings/rules',headers=OWNER_HEADERS,json=rule_payload(client) | {'min_spacing_days':2147483647})
    assert result.status_code == 200 and str(row) not in result.json()['workspace']['queue_ids']
    headers = {'X-Role':'Finance','X-User-ID':str(external_uuid('USR-05'))}
    result = client.post(PATH,headers=headers,json=profile_payload(client) | {'tone':'Firm'})
    assert result.status_code == 200
    with Session(engine) as db:
        assert [(s.id,s.score,s.reason) for s in db.scalars(select(PrioritySnapshot).where(PrioritySnapshot.as_of_date == TODAY-timedelta(days=1)))] == history
        assert [(s.id,s.approved_body,s.recipient_contact) for s in db.scalars(select(SendLog))] == sent
        event = db.scalar(select(ActivityLog).where(ActivityLog.action == 'customer.profile_updated'))
        assert event.actor_id == external_uuid('USR-05')
        assert db.scalar(select(ActivityLog).where(ActivityLog.action == 'rules.updated')).actor_id == OWNER.id
