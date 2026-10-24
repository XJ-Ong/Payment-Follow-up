from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel


class CollectionTotals(BaseModel):
    payments_received: str
    invoices_fully_paid: int
    customers_paid: int


class DailyCollection(BaseModel):
    date: date
    amount: str


class CustomerCollection(BaseModel):
    customer_id: UUID
    name: str
    amount_received: str
    invoices_receiving_payments: int
    invoices_fully_paid: int


class WeeklyPayment(BaseModel):
    id: UUID
    received_date: date
    invoice_id: UUID
    invoice_no: str
    customer_name: str
    amount: str
    reference: str | None


class OutstandingSnapshot(BaseModel):
    as_of_date: date
    total_outstanding: str
    total_overdue: str


class WeeklySummary(BaseModel):
    week_start: date
    week_end: date
    period_end: date
    current_week_start: date
    is_current_week: bool
    generated_at: datetime
    totals: CollectionTotals
    daily: list[DailyCollection]
    customers: list[CustomerCollection]
    payments: list[WeeklyPayment]
    outstanding_now: OutstandingSnapshot
