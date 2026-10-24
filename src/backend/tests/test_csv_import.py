import csv
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.main import COMPANY, adapter
from app.ids import external_uuid
from app.csv_schemas import HEADERS, MAX_BYTES
from app.db.models import Invoice, PaymentRecord, ActivityLog, PrioritySnapshot, Alert, FollowupRule, ClientFollowupProfile
from app.services import csv_import
from app.services.scoring import malaysia_date

H = {'X-Role':'Finance','X-User-ID':str(external_uuid('USR-05'))}
PREVIEW = '/api/invoices/import/preview'
IMPORT = '/api/invoices/import'
TODAY = malaysia_date(datetime.now(timezone.utc))

def row(**changes):
    return dict(invoice_no='CSV-'+uuid4().hex[:12],customer_id=str(external_uuid('CLI-01')),issue_date=(TODAY-timedelta(days=60)).isoformat(),due_date=(TODAY-timedelta(days=40)).isoformat(),total_amount='1000.10',initial_payment='100.10') | changes

def content(rows, headers=HEADERS, ending='\r\n'):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream,lineterminator=ending)
    writer.writerow(headers)
    for item in rows:
        writer.writerow([item.get(key,'') for key in headers])
    return stream.getvalue()

def send(client,rows,path=PREVIEW):
    return client.post(path,headers=H,json={'csv_text':content(rows)})

def counts(engine):
    with Session(engine) as db:
        return [db.scalar(select(func.count()).select_from(table)) for table in (Invoice,PaymentRecord,ActivityLog,PrioritySnapshot,Alert)]

def test_preview_is_read_only_and_reports_precise_decimal_totals(client,database):
    before = counts(database[0])
    text = '\ufeff'+content([row(invoice_no='QUOTED,"'+uuid4().hex[:5],total_amount='0.30',initial_payment='0.10'),row(initial_payment='')],ending='\n')+'\n,,,,,\n'
    result = client.post(PREVIEW,headers=H,json={'csv_text':text}).json()
    assert result['can_import'] and result['valid_count'] == 2
    assert result['total_amount'] == '1000.40' and result['initial_payment'] == '0.10'
    assert result['outstanding_amount'] == '1000.30'
    assert result['rows'][0]['row_number'] == 2 and result['rows'][0]['customer_name']
    assert counts(database[0]) == before

@pytest.mark.parametrize('change,column',[
    ({'invoice_no':''},'invoice_no'),({'invoice_no':'x'*51},'invoice_no'),({'customer_id':str(uuid4())},'customer_id'),
    ({'issue_date':'10/01/2026'},'issue_date'),({'due_date':'2026-02-30'},'due_date'),
    ({'due_date':'2000-01-01'},'row'),({'total_amount':'0'},'total_amount'),({'total_amount':'-1'},'total_amount'),
    ({'total_amount':'RM 100'},'total_amount'),({'total_amount':'1,000.00'},'total_amount'),({'total_amount':'NaN'},'total_amount'),
    ({'total_amount':'1e3'},'total_amount'),({'total_amount':'1.001'},'total_amount'),({'total_amount':'10000000000.00'},'total_amount'),
    ({'initial_payment':'1001'},'row'),({'initial_payment':'-1'},'initial_payment'),
])
def test_row_errors_block_the_entire_file(client,database,change,column):
    rows = [row(),row(**change)]
    before = counts(database[0])
    result = send(client,rows).json()
    assert not result['can_import'] and result['invalid_count'] == 1
    assert any(e['column'] == column for e in result['rows'][1]['errors'])
    rejected = send(client,rows,IMPORT)
    assert rejected.status_code == 409 and rejected.json()['preview']['invalid_count'] == 1
    assert counts(database[0]) == before

@pytest.mark.parametrize('text',[
    '', ','.join(HEADERS)+'\n', ','.join(reversed(HEADERS))+'\n',
    ','.join(HEADERS+['extra'])+'\n', ','.join(HEADERS)+'\n"unterminated',
    ','.join(HEADERS)+'\n\x00',
])
def test_file_errors(client,text):
    result = client.post(PREVIEW,headers=H,json={'csv_text':text})
    assert result.status_code == 200
    assert result.json()['file_errors'] and not result.json()['can_import']

def test_shape_and_size_limits(client):
    assert client.post(PREVIEW,headers=H,json={'csv_text':'x'*(MAX_BYTES+1)}).status_code == 422
    assert client.post(PREVIEW,headers=H,json={'csv_text':'\u00e9'*(MAX_BYTES//2+1)}).json()['file_errors']
    assert send(client,[row() for _ in range(500)]).json()['can_import']
    too_many = send(client,[row() for _ in range(501)]).json()
    assert not too_many['can_import'] and too_many['file_errors']
    text = content([row()])+',extra,field\n'
    assert client.post(PREVIEW,headers=H,json={'csv_text':text}).json()['invalid_count'] == 1

def test_import_persists_initial_payments_status_actor_and_queue(client,database):
    records = [row(),row(initial_payment='1000.10'),row(due_date=(TODAY+timedelta(days=14)).isoformat()),row(customer_id=str(external_uuid('CLI-07')))]
    before = counts(database[0])
    response = send(client,records,IMPORT)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['imported_count'] == 4
    saved = {i['invoice_no']:i for i in result['workspace']['invoices']}
    assert saved[records[0]['invoice_no']]['outstanding_amount'] == '900.00'
    assert saved[records[1]['invoice_no']]['status'] == 'paid'
    assert saved[records[0]['invoice_no']]['id'] in result['workspace']['queue_ids']
    for item in records[1:]:
        assert saved[item['invoice_no']]['id'] not in result['workspace']['queue_ids']
    with Session(database[0]) as db:
        ids = list(db.scalars(select(Invoice.id).where(Invoice.invoice_no.in_([r['invoice_no'] for r in records]))))
        assert all(i.source == 'csv' for i in db.scalars(select(Invoice).where(Invoice.id.in_(ids))))
        payments = list(db.scalars(select(PaymentRecord).where(PaymentRecord.invoice_id.in_(ids))))
        assert len(payments) == 4 and all(p.recorded_by == external_uuid('USR-05') for p in payments)
        assert all(p.received_date.isoformat() == records[0]['issue_date'] for p in payments)
        events = list(db.scalars(select(ActivityLog).where(ActivityLog.action=='invoices.csv_imported')))
        assert events[-1].actor_id == external_uuid('USR-05')
    before_retry = counts(database[0])
    assert send(client,records,IMPORT).status_code == 409
    assert counts(database[0]) == before_retry
    reloaded = client.get('/api/followups',headers=H).json()
    assert all(any(i['invoice_no']==r['invoice_no'] for i in reloaded['invoices']) for r in records)

def test_duplicate_rows_and_database_changes_after_preview(client):
    record = row()
    duplicate = send(client,[record,record]).json()
    assert duplicate['invalid_count'] == 2
    assert send(client,[record]).json()['can_import']
    manual = {'invoice_no':record['invoice_no'],'client_id':record['customer_id'],**{k:record[k] for k in ['issue_date','due_date','total_amount','initial_payment']}}
    assert client.post('/api/invoices',headers=H,json=manual).status_code == 201
    conflict = send(client,[record,row()],IMPORT)
    assert conflict.status_code == 409
    assert 'already exists' in conflict.json()['preview']['rows'][0]['errors'][0]['message']

def test_concurrent_imports_are_serialized(client):
    records = [row(),row()]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _:send(client,records,IMPORT).status_code,range(2)))
    assert sorted(results) == [200,409]

@pytest.mark.parametrize('failure_point',['insert','refresh'])
def test_rollback_after_partial_work(client,database,monkeypatch,failure_point):
    before = counts(database[0])
    with Session(database[0]) as db:
        pointer = db.scalar(select(FollowupRule.latest_workspace_event_id).where(FollowupRule.company_id==COMPANY))
    original = getattr(csv_import,'create' if failure_point=='insert' else 'refresh_workspace')
    calls = 0
    def fail(*args,**kwargs):
        nonlocal calls
        calls += 1
        value = original(*args,**kwargs)
        if failure_point=='refresh' or calls==2:
            raise RuntimeError('Injected batch failure')
        return value
    monkeypatch.setattr(csv_import,'create' if failure_point=='insert' else 'refresh_workspace',fail)
    with pytest.raises(RuntimeError,match='Injected batch failure'):
        send(client,[row(),row()],IMPORT)
    assert counts(database[0]) == before
    with Session(database[0]) as db:
        assert db.scalar(select(FollowupRule.latest_workspace_event_id).where(FollowupRule.company_id==COMPANY)) == pointer

def test_permissions_template_and_company_isolation(client,database,monkeypatch):
    for role in (None,'Other Staff','Preparer'):
        headers = {'X-Role':role} if role else {}
        assert client.get('/api/invoices/import/template',headers=headers).status_code == 403
        assert client.post(PREVIEW,headers=headers,json={'csv_text':content([row()])}).status_code == 403
        assert client.post(IMPORT,headers=headers,json={'csv_text':content([row()])}).status_code == 403
    template = client.get('/api/invoices/import/template',headers={'X-Role':'Owner'})
    assert template.status_code == 200 and 'attachment' in template.headers['content-disposition']
    assert client.post(PREVIEW,headers=H,json={'csv_text':template.text}).json()['can_import']
    foreign_id = uuid4()
    with Session(database[0]) as db:
        db.add(Invoice(id=uuid4(),company_id=foreign_id,client_id=uuid4(),invoice_no='SHARED-'+str(foreign_id),issue_date=TODAY,due_date=TODAY,total_amount=Decimal('10'),source='manual',status='open'))
        db.commit()
    assert send(client,[row(invoice_no='SHARED-'+str(foreign_id))]).json()['can_import']
    original = adapter.list_clients
    monkeypatch.setattr(adapter,'list_clients',lambda company:[c.model_copy(update={'company_id':foreign_id}) for c in original(company)])
    assert send(client,[row()]).json()['invalid_count'] == 1

def test_missing_profile_reports_configuration_error_per_row(client,database):
    with Session(database[0]) as db:
        target = db.get(ClientFollowupProfile,external_uuid('CLI-10'))
        # Roll back the temporary removal after checking through a dedicated transaction below.
        values = {c.name:getattr(target,c.name) for c in ClientFollowupProfile.__table__.columns}
        db.delete(target);db.commit()
    try:
        result=send(client,[row(customer_id=str(external_uuid('CLI-10')))]).json()
        assert 'profile' in result['rows'][0]['errors'][0]['message']
    finally:
        with Session(database[0]) as db:
            db.add(ClientFollowupProfile(**values));db.commit()
