"""Weekly summary generation (S10): metrics by code, narrative by template/AI.

All numbers are calculated from our own tables with the deterministic scoring
function; the narrative is produced by ``ai_service.generate_weekly_narrative``
from exactly those numbers (solution_v2.md §6: rules and code decide, AI writes).
"""
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import (ActivityLog, Approval, ClientFollowupProfile, FollowupRule,
                         Invoice, PaymentRecord, ReminderDraft, WeeklySummary)
from ..orbyte.protocol import OrbyteAdapter
from . import ai_service
from .followups import ConfigurationError
from .scoring import MALAYSIA, calculate

MONEY_KEYS = ("total_overdue", "change_from_last_week", "amount_collected")
TOP_CUSTOMER_COUNT = 5
SNOOZE_HORIZON_DAYS = 7


def _week_bounds(week_start, week_end):
    """Week window in UTC using Malaysia business days (store UTC, count MYT)."""
    start = datetime.combine(week_start, time.min, tzinfo=MALAYSIA).astimezone(timezone.utc)
    end = datetime.combine(week_end + timedelta(days=1), time.min, tzinfo=MALAYSIA).astimezone(timezone.utc)
    return start, end


def _overdue_total(invoices, payments_by_invoice, profiles, rule, as_of, holidays):
    """Sum of outstanding on overdue invoices as of ``as_of`` (recomputed, never stored)."""
    total = Decimal("0.00")
    for invoice in invoices:
        if invoice.status == "void":
            continue
        profile = profiles.get(invoice.client_id)
        if profile is None:
            raise ConfigurationError(f"Invoice {invoice.invoice_no} has an unknown customer or missing company profile")
        paid = sum((amount for received, amount in payments_by_invoice.get(invoice.id, ()) if received <= as_of),
                   Decimal("0.00"))
        calc = calculate(total=invoice.total_amount, payments=paid, due_date=invoice.due_date, as_of=as_of,
                         status=invoice.status, grace_days=rule.grace_days_by_tier[profile.relationship_tier],
                         alert_threshold=rule.alert_threshold, safety_flag_days=rule.safety_flag_days,
                         min_spacing_days=rule.min_spacing_days, do_not_contact=profile.do_not_contact,
                         skip_holidays=rule.skip_holidays, holidays=holidays, last_sent_date=None)
        if calc.outstanding > 0 and calc.days_overdue > 0:
            total += calc.outstanding
    return total


def calculate_weekly_metrics(company_id: UUID, week_start, week_end, db: Session,
                             adapter: OrbyteAdapter) -> dict:
    """Calculate the week's metrics from data (solution_v2.md §10.3).

    Returns a dict whose money values are ``Decimal`` (for narrative formatting)
    and counts are ints; ``generate_summary`` converts to JSON-safe strings for
    storage.
    """
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == company_id))
    if rule is None:
        raise ConfigurationError("Missing company follow-up rules; load the reference seed data")
    profiles = {p.client_id: p for p in db.scalars(
        select(ClientFollowupProfile).where(ClientFollowupProfile.company_id == company_id))}
    invoices = db.scalars(select(Invoice).where(Invoice.company_id == company_id)).all()
    payment_rows = db.execute(select(PaymentRecord.invoice_id, PaymentRecord.received_date, PaymentRecord.amount)
                              .where(PaymentRecord.company_id == company_id)).all()
    payments_by_invoice: dict[UUID, list] = {}
    for invoice_id, received, amount in payment_rows:
        payments_by_invoice.setdefault(invoice_id, []).append((received, amount))

    start, end = _week_bounds(week_start, week_end)
    previous_week_end = week_start - timedelta(days=1)
    earliest_due = min((i.due_date for i in invoices), default=week_end)
    holidays = ()
    if rule.skip_holidays and earliest_due <= week_end:
        holidays = tuple(h.date for h in adapter.list_public_holidays(
            company_id, earliest_due, max(week_end, previous_week_end)))

    total_overdue = _overdue_total(invoices, payments_by_invoice, profiles, rule, week_end, holidays)
    previous_overdue = _overdue_total(invoices, payments_by_invoice, profiles, rule, previous_week_end, holidays)
    collected = sum((amount for _, received, amount in payment_rows if week_start <= received <= week_end),
                    Decimal("0.00"))

    drafted = db.scalar(select(func.count()).select_from(ReminderDraft)
                        .where(ReminderDraft.company_id == company_id,
                               ReminderDraft.created_at >= start, ReminderDraft.created_at < end)) or 0
    approved = db.scalar(select(func.count()).select_from(Approval)
                         .where(Approval.company_id == company_id,
                                Approval.decision.in_(("approve", "edit_approve")),
                                Approval.decided_at >= start, Approval.decided_at < end)) or 0
    skipped = db.scalar(select(func.count()).select_from(ActivityLog)
                        .where(ActivityLog.company_id == company_id,
                               ActivityLog.action.in_(("draft.skipped", "draft.snoozed")),
                               ActivityLog.created_at >= start, ActivityLog.created_at < end)) or 0
    snoozed_next = db.scalar(select(func.count()).select_from(Invoice)
                             .where(Invoice.company_id == company_id,
                                    Invoice.followup_suppressed_until.isnot(None),
                                    Invoice.followup_suppressed_until > week_end,
                                    Invoice.followup_suppressed_until <= week_end + timedelta(days=SNOOZE_HORIZON_DAYS))) or 0

    # Top customers by priority score at week end (overdue balances only).
    clients = {c.id: c for c in adapter.list_clients(company_id)}
    per_customer: dict[UUID, dict] = {}
    for invoice in invoices:
        if invoice.status == "void" or invoice.client_id not in clients:
            continue
        profile = profiles.get(invoice.client_id)
        if profile is None:
            continue
        paid = sum((amount for received, amount in payments_by_invoice.get(invoice.id, ()) if received <= week_end),
                   Decimal("0.00"))
        calc = calculate(total=invoice.total_amount, payments=paid, due_date=invoice.due_date, as_of=week_end,
                         status=invoice.status, grace_days=rule.grace_days_by_tier[profile.relationship_tier],
                         alert_threshold=rule.alert_threshold, safety_flag_days=rule.safety_flag_days,
                         min_spacing_days=rule.min_spacing_days, do_not_contact=profile.do_not_contact,
                         skip_holidays=rule.skip_holidays, holidays=holidays, last_sent_date=None)
        if calc.outstanding <= 0 or calc.days_overdue <= 0:
            continue
        bucket = per_customer.setdefault(invoice.client_id, {"amount": Decimal("0.00"), "score": Decimal("0.00")})
        bucket["amount"] += calc.outstanding
        bucket["score"] += calc.score
    top_customers = [
        {"name": clients[cid].name, "amount": f"{bucket['amount']:.2f}", "score": f"{bucket['score']:.2f}"}
        for cid, bucket in sorted(per_customer.items(), key=lambda item: (-item[1]["score"], clients[item[0]].name))[:TOP_CUSTOMER_COUNT]
    ]

    return {
        "total_overdue": total_overdue,
        "change_from_last_week": total_overdue - previous_overdue,
        "amount_collected": collected,
        "reminders_drafted": int(drafted),
        "reminders_approved": int(approved),
        "reminders_skipped": int(skipped),
        "items_snoozed_next_week": int(snoozed_next),
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "top_customers": top_customers,
    }


def _json_metrics(metrics: dict) -> dict:
    return {key: (f"{value:.2f}" if isinstance(value, Decimal) else value) for key, value in metrics.items()}


def generate_summary(company_id: UUID, week_start, week_end, actor_id: UUID, db: Session,
                     language: str = "English", adapter: OrbyteAdapter = None) -> UUID:
    """Calculate the metrics, write the narrative and store the summary.

    Regenerating the same week updates the existing row (unique per week_start).
    Returns the summary id.
    """
    if week_end < week_start:
        raise ValueError("week_end must be on or after week_start")
    metrics = calculate_weekly_metrics(company_id, week_start, week_end, db, adapter)
    narrative, meta = ai_service.generate_weekly_narrative(metrics, language)
    written_by = meta["source"]  # "template" for MVP; "ai" when the model drafts it.
    stored = _json_metrics(metrics)
    summary = db.scalar(select(WeeklySummary).where(WeeklySummary.company_id == company_id,
                                                    WeeklySummary.week_start == week_start))
    if summary is None:
        summary = WeeklySummary(id=uuid4(), company_id=company_id, week_start=week_start, week_end=week_end,
                                metrics=stored, narrative=narrative, written_by=written_by, generated_by=actor_id)
        db.add(summary)
    else:
        summary.week_end, summary.metrics, summary.narrative = week_end, stored, narrative
        summary.written_by, summary.generated_by = written_by, actor_id
    # Model and prompt version are only stored when the model actually wrote it
    # (weekly_summary CHECK: ai_model/prompt_version NULL unless written_by = 'ai').
    summary.ai_model = meta["model"] if written_by == "ai" else None
    summary.prompt_version = meta["prompt_version"] if written_by == "ai" else None
    db.flush()
    return summary.id
