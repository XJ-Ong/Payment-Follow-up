"""Pure follow-up policy: no database or web dependencies."""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

MALAYSIA = ZoneInfo("Asia/Kuala_Lumpur")


def malaysia_date(now: datetime) -> date:
    if now.tzinfo is None:
        raise ValueError("A timezone-aware timestamp is required")
    return now.astimezone(MALAYSIA).date()


@dataclass(frozen=True)
class Calculation:
    outstanding: Decimal
    days_overdue: int
    grace_days: int
    effective_days: int
    score: Decimal
    trigger_type: str | None
    eligible: bool
    exclusion_reasons: tuple[str, ...]
    holidays_excluded: tuple[date, ...]
    last_sent_date: date | None
    reason: str


def calculate(*, total: Decimal, payments: Decimal, due_date: date,
              as_of: date, status: str, grace_days: int,
              alert_threshold: Decimal, safety_flag_days: int,
              min_spacing_days: int, do_not_contact: bool,
              skip_holidays: bool = False, holidays: tuple[date, ...] = (),
              last_sent_date: date | None = None) -> Calculation:
    outstanding = max(Decimal("0.00"), total - payments)
    excluded = tuple(sorted({d for d in holidays if due_date < d <= as_of})) if skip_holidays else ()
    overdue = max(0, (as_of - due_date).days - len(excluded))
    effective = max(0, overdue - grace_days)
    score = outstanding * effective
    threshold = score >= alert_threshold
    safety = overdue >= safety_flag_days
    trigger = "both" if threshold and safety else "threshold" if threshold else "safety_rule" if safety else None
    reasons = []
    if status == "void":
        reasons.append("Invoice is void")
    if outstanding <= 0 or status == "paid":
        reasons.append("No outstanding balance")
    if overdue <= 0:
        reasons.append("Invoice is not overdue")
    if do_not_contact:
        reasons.append("Customer is marked do not contact")
    if last_sent_date is not None and (as_of - last_sent_date).days < min_spacing_days:
        next_ordinal = last_sent_date.toordinal() + min_spacing_days
        reasons.append(f"Reminder spacing: wait until {date.fromordinal(next_ordinal).isoformat()}" if next_ordinal <= date.max.toordinal()
                       else "Reminder spacing: waiting period exceeds the supported calendar range")
    if trigger is None:
        reasons.append("Below alert threshold and safety-rule age")
    label = {"both": "Threshold and safety rule reached", "threshold": "Alert threshold reached", "safety_rule": "Safety-rule age reached", None: "No alert triggered"}[trigger]
    reason = f"MYR {outstanding:.2f} x max(0, {overdue} - {grace_days}) = {score:.2f} RM-days. {label}."
    return Calculation(outstanding, overdue, grace_days, effective, score, trigger,
                       not reasons, tuple(reasons), excluded, last_sent_date, reason)


def ranking_key(invoice_no: str, invoice_id: str, calculation: Calculation):
    return (-calculation.score, -calculation.days_overdue, invoice_no, invoice_id)
