"""Shared invoice validation and transactional writes; callers own commit/refresh."""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from ..db.models import Invoice, PaymentRecord, ActivityLog
from .scoring import malaysia_date

Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]

class InvoiceInput(BaseModel):
    invoice_no: str = Field(min_length=1, max_length=50, pattern=r'.*\S.*')
    client_id: UUID
    project_id: UUID | None = None
    issue_date: date
    due_date: date
    total_amount: Money
    initial_payment: Decimal = Field(default=Decimal('0'), ge=0, max_digits=12, decimal_places=2)

    @model_validator(mode='after')
    def validate_dates_and_payment(self):
        self.invoice_no = self.invoice_no.strip()
        if self.due_date < self.issue_date:
            raise ValueError('Due date must be on or after issue date')
        if self.initial_payment > self.total_amount:
            raise ValueError('Payment exceeds invoice total')
        return self

class PaymentInput(BaseModel):
    amount: Money
    received_date: date
    payment_type: Literal['deposit','partial','full'] = 'partial'
    reference_number: str | None = Field(default=None, max_length=100)

class VoidInput(BaseModel):
    reason: str = Field(min_length=3, max_length=500, pattern=r'.*\S.*')

    @model_validator(mode='after')
    def strip_reason(self):
        self.reason = self.reason.strip()
        if len(self.reason) < 3:
            raise ValueError('Reason must be at least 3 characters')
        return self

def paid(db, company, invoice):
    return db.scalar(select(func.coalesce(func.sum(PaymentRecord.amount),0)).where(PaymentRecord.invoice_id == invoice.id, PaymentRecord.company_id == company))

def serialize(db, company, invoice):
    payments = paid(db,company,invoice)
    return dict(id=str(invoice.id),invoice_no=invoice.invoice_no,client_id=str(invoice.client_id),issue_date=invoice.issue_date.isoformat(),due_date=invoice.due_date.isoformat(),total_amount=f'{invoice.total_amount:.2f}',payments=f'{payments:.2f}',outstanding_amount=f'{max(Decimal("0"),invoice.total_amount-payments):.2f}',status=invoice.status)

def audit(db, company, actor, action, invoice):
    db.add(ActivityLog(id=uuid4(),company_id=company,actor_type='user',actor_id=actor.id,action=action,entity_type='invoice',entity_id=invoice.id,after_state=serialize(db,company,invoice)))

def add_payment(db, company, invoice, data, actor):
    balance = invoice.total_amount - paid(db,company,invoice)
    today = malaysia_date(datetime.now(timezone.utc))
    if invoice.status == 'void':
        raise HTTPException(422,'Void invoices cannot accept payments')
    if invoice.status == 'paid' or balance <= 0:
        raise HTTPException(422,'Invoice is already fully paid')
    if data.received_date < invoice.issue_date:
        raise HTTPException(422,'Payment date cannot be before the invoice issue date')
    if data.received_date > today:
        raise HTTPException(422,'Payment date cannot be in the future')
    if data.amount > balance:
        raise HTTPException(422,'Payment cannot exceed the outstanding balance')
    if data.payment_type == 'full' and data.amount != balance:
        raise HTTPException(422,'Full payment must equal outstanding balance')
    db.add(PaymentRecord(id=uuid4(),company_id=company,invoice_id=invoice.id,amount=data.amount,received_date=data.received_date,payment_type=data.payment_type,reference_number=data.reference_number,recorded_by=actor.id))
    invoice.status = 'paid' if data.amount == balance else 'partially_paid'
    db.flush()
    audit(db,company,actor,'payment.recorded',invoice)

def void(db, company, invoice, data, actor):
    """Final cancellation. Only invoices with no recorded payments can be voided."""
    if invoice.status == 'void':
        raise HTTPException(409,'Invoice is already void')
    if paid(db,company,invoice) > 0:
        raise HTTPException(422,'Invoices with recorded payments cannot be voided')
    invoice.status = 'void'
    db.flush()
    db.add(ActivityLog(id=uuid4(),company_id=company,actor_type='user',actor_id=actor.id,action='invoice.voided',entity_type='invoice',entity_id=invoice.id,after_state={**serialize(db,company,invoice),'reason':data.reason}))

def create(db, company, adapter, actor, data, source='manual'):
    try:
        client = adapter.get_client(data.client_id)
    except LookupError:
        raise HTTPException(422,'Unknown customer') from None
    if client.company_id != company:
        raise HTTPException(422,'Unknown customer')
    if data.project_id is not None:
        try:
            project = adapter.get_project(data.project_id)
        except LookupError:
            raise HTTPException(422,'Unknown project') from None
        if project.client_id != client.id:
            raise HTTPException(422,'Project must belong to the selected client')
    invoice = Invoice(id=uuid4(),company_id=company,client_id=data.client_id,project_id=data.project_id,invoice_no=data.invoice_no,issue_date=data.issue_date,due_date=data.due_date,total_amount=data.total_amount,source=source,status='open')
    db.add(invoice)
    db.flush()
    if data.initial_payment:
        add_payment(db,company,invoice,PaymentInput(amount=data.initial_payment,received_date=data.issue_date,payment_type='deposit'),actor)
    audit(db,company,actor,'invoice.created',invoice)
    return invoice
