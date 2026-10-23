"""Public API types; decimals are strings to preserve precision on the wire."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel

class CustomerView(BaseModel):
    id: UUID
    name: str
    contact: str
    initials: str
    color: str
    graceDays: int
    doNotContact: bool

class RuleView(BaseModel):
    grace_days_by_tier: dict[str, int]
    alert_threshold: str
    safety_flag_days: int
    min_spacing_days: int
    skip_holidays: bool
    primary_approver_id: UUID

class CalculationView(BaseModel):
    outstanding_amount: str
    days_overdue: int
    grace_days: int
    effective_days: int
    score: str
    rank: int | None
    trigger_type: Literal["threshold", "safety_rule", "both"] | None
    eligible: bool
    exclusion_reasons: list[str]
    holidays_excluded: list[date]
    last_sent_date: date | None
    reason: str

class InvoiceView(BaseModel):
    id: UUID
    invoice_no: str
    client_id: UUID
    issue_date: date
    due_date: date
    total_amount: str
    payments: str
    outstanding_amount: str
    status: str
    calculation: CalculationView

class AlertView(BaseModel):
    id: UUID
    invoice_id: UUID
    snapshot_id: UUID
    recipient_id: UUID
    trigger_type: str
    status: str
    reason: str

class BalanceView(BaseModel):
    customer_id: UUID
    name: str
    balance: str

class DashboardView(BaseModel):
    total_outstanding: str
    total_overdue: str
    queue_count: int
    alert_count: int
    customer_balances: list[BalanceView]
    ranking_ids: list[UUID]

class WorkspaceView(BaseModel):
    as_of_date: date
    computed_at: datetime | None
    customers: list[CustomerView]
    invoices: list[InvoiceView]
    rules: RuleView | None
    dashboard: DashboardView
    queue_ids: list[UUID]
    alerts: list[AlertView]
