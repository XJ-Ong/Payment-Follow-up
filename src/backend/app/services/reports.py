"""Read-only collections reports, attributed by payment received date."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import and_, select
from ..db.models import FollowupRule, Invoice, PaymentRecord
from ..report_schemas import WeeklySummary
from .followups import ConfigurationError
from .scoring import malaysia_date


def weekly_summary(db, company, adapter, week_start=None, *, now=None):
    now = now or datetime.now(timezone.utc)
    today = malaysia_date(now)
    current_week = today - timedelta(days=today.weekday())
    start = week_start or current_week
    if start.weekday() != 0 or start > current_week:
        raise ValueError("Choose a Monday on or before the current week")
    end = start + timedelta(days=6)
    period_end = min(end, today)
    clients = {c.id: c for c in adapter.list_clients(company)}
    # One query keeps invoices, full payment histories and current balances consistent.
    rows = db.execute(select(Invoice, PaymentRecord).outerjoin(PaymentRecord, and_(
        PaymentRecord.invoice_id == Invoice.id, PaymentRecord.company_id == company,
        PaymentRecord.received_date <= today)).where(
            Invoice.company_id == company, Invoice.status != "void").order_by(
                Invoice.invoice_no, Invoice.id, PaymentRecord.received_date,
                PaymentRecord.created_at, PaymentRecord.id)).all()
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == company))
    earliest = min((invoice.due_date for invoice, _ in rows), default=today)
    holidays = {h.date for h in adapter.list_public_holidays(company, earliest, today)} if rule and rule.skip_holidays and earliest <= today else set()
    daily = {start + timedelta(days=n): Decimal("0.00") for n in range(7)}
    customers, payments, histories = {}, [], {}
    for invoice, payment in rows:
        if invoice.client_id not in clients:
            raise ConfigurationError(f"Invoice {invoice.invoice_no} has an unknown company customer")
        history = histories.setdefault(invoice.id, dict(invoice=invoice, paid=Decimal("0.00"), settled=None))
        if payment is None:
            continue
        history["paid"] += payment.amount
        if history["settled"] is None and history["paid"] >= invoice.total_amount:
            history["settled"] = payment.received_date
        if not start <= payment.received_date <= period_end:
            continue
        client = clients[invoice.client_id]
        customer = customers.setdefault(client.id, dict(customer_id=client.id, name=client.name,
            amount_received=Decimal("0.00"), invoices=set(), settled=set()))
        customer["amount_received"] += payment.amount
        customer["invoices"].add(invoice.id)
        daily[payment.received_date] += payment.amount
        payments.append(dict(id=payment.id, received_date=payment.received_date,
            invoice_id=invoice.id, invoice_no=invoice.invoice_no, customer_name=client.name,
            amount=f"{payment.amount:.2f}", reference=payment.reference_number))
    outstanding, overdue, fully_paid = Decimal("0.00"), Decimal("0.00"), 0
    for history in histories.values():
        invoice = history["invoice"]
        balance = max(Decimal("0.00"), invoice.total_amount - history["paid"])
        outstanding += balance
        overdue_days = (today - invoice.due_date).days - sum(invoice.due_date < day <= today for day in holidays)
        if overdue_days > 0:
            overdue += balance
        if history["settled"] and start <= history["settled"] <= period_end:
            fully_paid += 1
            customers[invoice.client_id]["settled"].add(invoice.id)
    ranked = sorted(customers.values(), key=lambda c: (-c["amount_received"], c["name"].casefold(), str(c["customer_id"])))
    payments.sort(key=lambda p: (-p["received_date"].toordinal(), p["invoice_no"], str(p["id"])))
    return WeeklySummary.model_validate(dict(week_start=start, week_end=end, period_end=period_end,
        current_week_start=current_week, is_current_week=start == current_week, generated_at=now,
        totals=dict(payments_received=f"{sum(daily.values(), Decimal('0.00')):.2f}",
            invoices_fully_paid=fully_paid, customers_paid=len(customers)),
        daily=[dict(date=day, amount=f"{amount:.2f}") for day, amount in daily.items()],
        customers=[dict(customer_id=c["customer_id"], name=c["name"], amount_received=f"{c['amount_received']:.2f}",
            invoices_receiving_payments=len(c["invoices"]), invoices_fully_paid=len(c["settled"])) for c in ranked],
        payments=payments, outstanding_now=dict(as_of_date=today,
            total_outstanding=f"{outstanding:.2f}", total_overdue=f"{overdue:.2f}")))
