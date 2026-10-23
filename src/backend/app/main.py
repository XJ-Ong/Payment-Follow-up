"""Database-backed demo API. X-Role is simulation, not authentication."""
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .db.models import Invoice, PaymentRecord, ClientFollowupProfile, FollowupRule, ActivityLog
from .db.session import SessionLocal
from .ids import external_uuid
from .orbyte.mock import MockOrbyteAdapter

app = FastAPI(title="Payment Follow-up")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Role"])
COMPANY = external_uuid("COMP-01")
adapter = MockOrbyteAdapter()

def get_db():
    with SessionLocal() as session:
        yield session

def get_role(x_role: Annotated[str | None, Header()] = None):
    if x_role not in ("Owner", "Finance", "Other Staff"):
        raise HTTPException(403, "Unsupported or missing demo role")
    if x_role == "Other Staff":
        raise HTTPException(403, "Owner or Finance access required")
    return x_role

DB = Annotated[Session, Depends(get_db)]
Role = Annotated[str, Depends(get_role)]
Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]

class InvoiceInput(BaseModel):
    invoice_no: str = Field(min_length=1, max_length=50, pattern=r".*\S.*")
    client_id: UUID
    issue_date: date
    due_date: date
    total_amount: Money
    initial_payment: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)

    @model_validator(mode="after")
    def validate_dates_and_payment(self):
        self.invoice_no = self.invoice_no.strip()
        if self.due_date < self.issue_date:
            raise ValueError("Due date must be on or after issue date")
        if self.initial_payment > self.total_amount:
            raise ValueError("Payment exceeds invoice total")
        return self

class PaymentInput(BaseModel):
    amount: Money
    received_date: date
    payment_type: Literal["deposit", "partial", "full"] = "partial"
    reference_number: str | None = Field(default=None, max_length=100)

def paid(db, invoice):
    return db.scalar(select(func.coalesce(func.sum(PaymentRecord.amount), 0)).where(PaymentRecord.invoice_id == invoice.id, PaymentRecord.company_id == COMPANY))

def customer(db, client):
    profile = db.get(ClientFollowupProfile, client.id)
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == COMPANY))
    valid = profile is not None and profile.company_id == COMPANY
    tier = profile.relationship_tier if valid else "New"
    return dict(id=str(client.id), name=client.name, contact=client.email or client.phone or "", initials="".join(n[0] for n in client.name.split()[:2]), color="blue", graceDays=(rule.grace_days_by_tier.get(tier, 0) if rule else 0), doNotContact=profile.do_not_contact if valid else False)

def serialize(db, invoice):
    payments = paid(db, invoice)
    return dict(id=str(invoice.id), invoice_no=invoice.invoice_no, client_id=str(invoice.client_id), issue_date=invoice.issue_date.isoformat(), due_date=invoice.due_date.isoformat(), total_amount=format(invoice.total_amount, ".2f"), payments=format(payments, ".2f"), outstanding_amount=format(invoice.total_amount-payments, ".2f"), status=invoice.status)

def audit(db, role, action, invoice):
    db.add(ActivityLog(id=uuid4(), company_id=COMPANY, actor_type="user", actor_id=external_uuid("USR-01" if role == "Owner" else "USR-02"), action=action, entity_type="invoice", entity_id=invoice.id, after_state=serialize(db, invoice)))

def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Invoice number already exists or record conflicts") from None

@app.get("/api/health")
def health(db: DB):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(503, "Database unavailable") from None
    return {"status": "ok"}

@app.get("/api/invoices")
def invoices(db: DB, role: Role):
    rows = db.scalars(select(Invoice).where(Invoice.company_id == COMPANY).order_by(Invoice.invoice_no)).all()
    return {"invoices": [serialize(db, row) for row in rows], "customers": [customer(db, c) for c in adapter.list_clients(COMPANY)], "as_of_date": datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).date().isoformat()}

@app.post("/api/invoices", status_code=201)
def create_invoice(data: InvoiceInput, db: DB, role: Role):
    try:
        client = adapter.get_client(data.client_id)
    except LookupError:
        raise HTTPException(422, "Unknown customer") from None
    if client.company_id != COMPANY:
        raise HTTPException(422, "Unknown customer")
    invoice = Invoice(id=uuid4(), company_id=COMPANY, client_id=data.client_id, invoice_no=data.invoice_no, issue_date=data.issue_date, due_date=data.due_date, total_amount=data.total_amount, source="manual", status="open")
    db.add(invoice)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Invoice number already exists") from None
    if data.initial_payment:
        add_payment(db, invoice, PaymentInput(amount=data.initial_payment, received_date=data.issue_date, payment_type="deposit"), role)
    audit(db, role, "invoice.created", invoice)
    commit(db)
    return serialize(db, invoice)

def add_payment(db, invoice, data, role):
    balance = invoice.total_amount - paid(db, invoice)
    if invoice.status == "void" or data.amount > balance:
        raise HTTPException(422, "Payment exceeds outstanding balance or invoice is void")
    if data.payment_type == "full" and data.amount != balance:
        raise HTTPException(422, "Full payment must equal outstanding balance")
    db.add(PaymentRecord(id=uuid4(), company_id=COMPANY, invoice_id=invoice.id, amount=data.amount, received_date=data.received_date, payment_type=data.payment_type, reference_number=data.reference_number, recorded_by=external_uuid("USR-01" if role == "Owner" else "USR-02")))
    invoice.status = "paid" if data.amount == balance else "partially_paid"
    db.flush()
    audit(db, role, "payment.recorded", invoice)

@app.post("/api/invoices/{invoice_id}/payments", status_code=201)
def record_payment(invoice_id: UUID, data: PaymentInput, db: DB, role: Role):
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.company_id == COMPANY).with_for_update())
    if invoice is None:
        raise HTTPException(404, "Invoice not found")
    add_payment(db, invoice, data, role)
    commit(db)
    return serialize(db, invoice)
