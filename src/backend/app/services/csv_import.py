"""Strict fixed-template parsing and read-only validation, followed by atomic import."""
import csv
import io
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4
from pydantic import ValidationError
from sqlalchemy import select, func
from ..csv_schemas import CsvPreview, CsvRow, CsvError, HEADERS, MAX_BYTES, MAX_ROWS
from ..db.models import Invoice, PaymentRecord, ClientFollowupProfile, ActivityLog
from .invoices import InvoiceInput, create
from .followups import lock_rule, refresh_workspace
from .scoring import malaysia_date

def template(company, adapter):
    clients = adapter.list_clients(company)
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    today = malaysia_date(datetime.now(timezone.utc))
    if clients:
        suffix = uuid4().hex[:8].upper()
        writer.writerow([f'CSV-{suffix}-001',str(clients[0].id),(today-timedelta(days=60)).isoformat(),(today-timedelta(days=40)).isoformat(),'1000.00','200.00'])
    return output.getvalue()

def preview(db, company, adapter, text):
    result = CsvPreview()
    try:
        if len(text.encode('utf-8')) > MAX_BYTES:
            result.file_errors.append('CSV must be at most 1 MiB.')
    except UnicodeError:
        result.file_errors.append('CSV must use valid UTF-8 encoding.')
    if '\x00' in text:
        result.file_errors.append('CSV contains null bytes; save it as UTF-8 CSV, not UTF-16.')
    if result.file_errors:
        return result
    reader = csv.reader(io.StringIO(text.removeprefix('\ufeff'),newline=''),strict=True)
    try:
        if next(reader,None) != HEADERS:
            result.file_errors.append('Use the exact template headers and order: ' + ','.join(HEADERS))
            return result
        clients = {c.id:c for c in adapter.list_clients(company) if c.company_id == company}
        profiles = set(db.scalars(select(ClientFollowupProfile.client_id).where(ClientFollowupProfile.company_id == company)))
        while True:
            line = reader.line_num + 1
            cells = next(reader,None)
            if cells is None:
                break
            if not cells or all(not value.strip() for value in cells):
                continue
            if len(result.rows) == MAX_ROWS:
                result.file_errors.append('CSV supports at most 500 invoice rows; split this file into smaller batches.')
                break
            values = {key:(cells[index].strip() if index < len(cells) else '') for index,key in enumerate(HEADERS)}
            row = CsvRow(row_number=line,values=values)
            values = row.values
            result.rows.append(row)
            def error(column,message):
                row.errors.append(CsvError(column=column,message=message))
            if len(cells) != len(HEADERS):
                error('row','Each row must contain exactly six fields. Quote values containing commas.')
            if not values['invoice_no'] or len(values['invoice_no']) > 50 or any(ord(c)<32 for c in values['invoice_no']):
                error('invoice_no','Invoice number must contain 1–50 characters without control characters.')
            try:
                client_id = UUID(values['customer_id'])
                if client_id not in clients:
                    raise ValueError()
                row.customer_name = clients[client_id].name
                if client_id not in profiles:
                    error('customer_id','Customer has no configured follow-up profile.')
            except ValueError:
                error('customer_id','Choose an existing customer ID from the reference list.')
            for key in ('issue_date','due_date'):
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',values[key]):
                    error(key,'Use YYYY-MM-DD.')
            if not values['initial_payment']:
                values['initial_payment'] = '0'
            for key in ('total_amount','initial_payment'):
                if not re.fullmatch(r'\d+(?:\.\d{1,2})?',values[key]):
                    error(key,'Use a plain non-negative amount with at most two decimal places; no currency symbols or thousands separators.')
            if not row.errors:
                try:
                    data = InvoiceInput.model_validate({**values,'client_id':values['customer_id']})
                    values.update(issue_date=data.issue_date.isoformat(),due_date=data.due_date.isoformat(),total_amount=f'{data.total_amount:.2f}',initial_payment=f'{data.initial_payment:.2f}')
                    row.outstanding_amount = f'{data.total_amount-data.initial_payment:.2f}'
                except ValidationError as exc:
                    for item in exc.errors():
                        error('.'.join(map(str,item['loc'])) or 'row',item['msg'])
    except (csv.Error, ValueError) as exc:
        result.file_errors.append(f'Unable to parse CSV near line {reader.line_num}: {exc}')
    numbers = Counter(row.values['invoice_no'] for row in result.rows)
    existing = set(db.scalars(select(Invoice.invoice_no).where(Invoice.company_id == company,Invoice.invoice_no.in_(list(numbers))))) if numbers else set()
    total, payments = Decimal('0'), Decimal('0')
    for row in result.rows:
        number = row.values['invoice_no']
        if numbers[number] > 1:
            row.errors.append(CsvError(column='invoice_no',message='Invoice number is repeated in this file.'))
        if number in existing:
            row.errors.append(CsvError(column='invoice_no',message='Invoice number already exists in this company.'))
        if not row.errors:
            result.valid_count += 1
            total += Decimal(row.values['total_amount'])
            payments += Decimal(row.values['initial_payment'])
        else:
            result.invalid_count += 1
    if not result.rows and not result.file_errors:
        result.file_errors.append('CSV contains no invoice rows.')
    result.total_amount, result.initial_payment, result.outstanding_amount = f'{total:.2f}',f'{payments:.2f}',f'{total-payments:.2f}'
    result.can_import = bool(result.rows) and not result.file_errors and not result.invalid_count
    return result

class InvalidImport(ValueError):
    def __init__(self, preview):
        self.preview = preview

def export_invoices_csv(db, company, adapter):
    """Export all non-void invoices for a company using the exact import template.

    Output round-trips through preview()/import_invoices(): same headers,
    customer_id as UUID, initial_payment as the sum of recorded payments.
    """
    invoices = db.scalars(
        select(Invoice)
        .where(Invoice.company_id == company)
        .where(Invoice.status != 'void')
        .order_by(Invoice.issue_date.desc(), Invoice.invoice_no)
    ).all()
    sums = db.execute(
        select(PaymentRecord.invoice_id, func.sum(PaymentRecord.amount))
        .where(PaymentRecord.company_id == company)
        .group_by(PaymentRecord.invoice_id)
    ).all()
    paid_by_invoice = {invoice_id: total for invoice_id, total in sums}
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    for invoice in invoices:
        paid = paid_by_invoice.get(invoice.id)
        writer.writerow([
            invoice.invoice_no,
            str(invoice.client_id),
            invoice.issue_date.isoformat(),
            invoice.due_date.isoformat(),
            f'{invoice.total_amount:.2f}',
            f'{paid:.2f}' if paid else '',
        ])
    return output.getvalue()

def import_invoices(db, company, adapter, actor, text):
    lock_rule(db,company)
    checked = preview(db,company,adapter,text)
    if not checked.can_import:
        raise InvalidImport(checked)
    for row in checked.rows:
        create(db,company,adapter,actor,InvoiceInput.model_validate({**row.values,'client_id':row.values['customer_id']}),source='csv')
    db.add(ActivityLog(id=uuid4(),company_id=company,actor_type='user',actor_id=actor.id,action='invoices.csv_imported',entity_type='company',entity_id=company,
        after_state=dict(imported_count=len(checked.rows),invoice_numbers=[r.values['invoice_no'] for r in checked.rows],total_amount=checked.total_amount,initial_payment=checked.initial_payment)))
    workspace = refresh_workspace(db,company,adapter,actor.id)
    return len(checked.rows),workspace
