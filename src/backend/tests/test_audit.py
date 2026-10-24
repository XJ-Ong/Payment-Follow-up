"""Audit reads use isolated PostgreSQL and never change recorded history."""
from datetime import datetime, timezone
from uuid import uuid4
import pytest
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from app.main import COMPANY, adapter
from app.db.models import ActivityLog, Invoice
from app.ids import external_uuid

HEADERS = {"X-Role": "Finance"}


def seed_events(database):
    engine, _ = database
    token = uuid4().hex[:10]
    client = adapter.list_clients(COMPANY)[0]
    ids = [uuid4() for _ in range(29)]
    foreign = uuid4()
    invoice_id = uuid4()
    with Session(engine) as db:
        db.add(Invoice(id=invoice_id, company_id=COMPANY, client_id=client.id,
                       invoice_no=f'AUDIT-{token}', issue_date=datetime(2026, 1, 1).date(),
                       due_date=datetime(2026, 1, 2).date(), total_amount='125.50', status='open', source='manual'))
        for i, id in enumerate(ids):
            db.add(ActivityLog(id=id, company_id=COMPANY, actor_type='user',
                actor_id=external_uuid('USR-02'), action=f'audit.{token}', entity_type='invoice',
                entity_id=invoice_id, created_at=datetime(2026, 10, 23, 16, 0, tzinfo=timezone.utc),
                before_state={'amount': '125.50'}, after_state={'amount': '100.00'}, meta={'source': 'test'}))
        db.add(ActivityLog(id=foreign, company_id=uuid4(), actor_type='user', actor_id=external_uuid('USR-02'),
            action=f'audit.{token}', entity_type='invoice', entity_id=invoice_id))
        db.commit()
    return token, ids, foreign, client, invoice_id


def test_audit_filters_pagination_detail_and_isolation(client, database):
    token, ids, foreign, customer, _ = seed_events(database)
    params = dict(action=f'audit.{token}', date_from='2026-10-24', date_to='2026-10-24')
    def get(**extra):
        result = client.get('/api/audit', headers=HEADERS, params=params | extra)
        assert result.status_code == 200, result.text
        return result.json()
    first = get()
    assert first['total'] == 29 and len(first['items']) == 25
    second = get(page=2)
    ordered = [item['id'] for item in first['items'] + second['items']]
    assert ordered == [str(id) for id in sorted(ids, reverse=True)]
    assert get(search=f'AUDIT-{token}')['total'] == 29
    assert get(search=customer.name.lower())['total'] == 29
    assert get(search=adapter.get_user(external_uuid('USR-02')).name)['total'] == 29
    assert get(actor=str(external_uuid('USR-01')))['total'] == 0
    assert get(actor=str(external_uuid('USR-02')))['total'] == 29
    assert get(actor_type='user')['total'] == 29
    assert get(actor_type='system')['total'] == 0
    assert get(actor_type='ai')['total'] == 0
    assert get(search='%')['total'] == 0
    assert get(search='no-such-customer')['total'] == 0
    assert get(date_from='2026-10-23', date_to='2026-10-23')['total'] == 0
    assert get(date_from='2026-10-25', date_to='2026-10-25')['total'] == 0
    detail = client.get(f'/api/audit/{ids[0]}', headers={'X-Role': 'Owner'}).json()
    assert detail['before_state'] == {'amount': '125.50'}
    assert detail['after_state'] == {'amount': '100.00'}
    assert detail['metadata'] == {'source': 'test'}
    assert detail['customer_name'] == customer.name
    assert detail['invoice_number'] == f'AUDIT-{token}'
    assert client.get(f'/api/audit/{foreign}', headers=HEADERS).status_code == 404
    assert client.get(f'/api/audit/{uuid4()}', headers=HEADERS).status_code == 404
    assert client.get('/api/audit', params={'date_from':'2026-10-25','date_to':'2026-10-24'}, headers=HEADERS).status_code == 422
    for params in ({'page':0}, {'actor':'bad'}, {'actor_type':'invalid'}, {'date_to':'9999-12-31'}, {'date_from':'0001-01-01'}):
        assert client.get('/api/audit', params=params, headers=HEADERS).status_code == 422


@pytest.mark.parametrize('role', [None, 'Other Staff', 'Preparer'])
def test_audit_restricted(client, role):
    headers = {'X-Role': role} if role else {}
    assert client.get('/api/audit', headers=headers).status_code == 403
    assert client.get(f'/api/audit/{uuid4()}', headers=headers).status_code == 403
    assert client.get('/api/audit', headers={'X-Role':'Owner','X-User-ID':str(external_uuid('USR-02'))}).status_code == 403


def test_audit_historical_and_refresh_exclusion(client, database):
    engine, _ = database
    historical, hidden, profile, ai = uuid4(), uuid4(), uuid4(), uuid4()
    with Session(engine) as db:
        db.add_all([
            ActivityLog(id=ai, company_id=COMPANY, actor_type='ai', action='test.ai_event', entity_type='company', entity_id=COMPANY),
            ActivityLog(id=historical, company_id=COMPANY, actor_type='user', actor_id=None,
                        action='draft.approved', entity_type='invoice', entity_id=uuid4(), after_state={'version':1}),
            ActivityLog(id=hidden, company_id=COMPANY, actor_type='system', action='followups.refreshed', entity_type='company', entity_id=COMPANY),
            ActivityLog(id=profile, company_id=COMPANY, actor_type='user', actor_id=external_uuid('USR-02'),
                        action='customer.profile_updated', entity_type='customer', entity_id=adapter.list_clients(COMPANY)[0].id,
                        before_state={'tone':'Gentle'}, after_state={'tone':'Firm'})])
        db.commit()
        before = db.scalar(select(func.count()).select_from(ActivityLog))
    page = client.get('/api/audit', headers=HEADERS, params={'action':'followups.refreshed'}).json()
    assert page['total'] == 0
    ai_rows = client.get('/api/audit', headers=HEADERS, params={'actor_type':'ai'}).json()['items']
    assert any(row['id'] == str(ai) and row['actor_name'] == 'AI' for row in ai_rows)
    assert all(row['actor_type'] == 'ai' for row in ai_rows)
    assert client.get(f'/api/audit/{hidden}', headers=HEADERS).status_code == 404
    detail = client.get(f'/api/audit/{historical}', headers=HEADERS).json()
    assert detail['invoice_number'] is None and detail['before_state'] is None
    assert detail['actor_name'] == 'Unknown historical author'
    assert client.get('/api/audit', headers=HEADERS, params={'actor':'unattributed'}).json()['total'] >= 1
    changed = client.get(f'/api/audit/{profile}', headers=HEADERS).json()
    assert changed['customer_name'] == adapter.list_clients(COMPANY)[0].name
    assert changed['before_state'] == {'tone':'Gentle'}
    assert client.get('/api/activity', headers=HEADERS).status_code == 200
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(ActivityLog)) == before


def test_audit_malaysia_midnight_bounds(client, database):
    engine, _ = database
    action = 'midnight.' + uuid4().hex
    ids = [uuid4() for _ in range(4)]
    times = ['2026-10-23T15:59:59.999999+00:00', '2026-10-23T16:00:00+00:00',
             '2026-10-24T15:59:59.999999+00:00', '2026-10-24T16:00:00+00:00']
    with Session(engine) as db:
        for id, time in zip(ids, times):
            db.add(ActivityLog(id=id, company_id=COMPANY, actor_type='system', action=action,
                              entity_type='company', entity_id=COMPANY, created_at=datetime.fromisoformat(time)))
        db.commit()
    data = client.get('/api/audit', headers=HEADERS, params=dict(action=action, actor_type='system', date_from='2026-10-24', date_to='2026-10-24')).json()
    assert [item['id'] for item in data['items']] == [str(ids[2]), str(ids[1])]
    assert data['total'] == 2
