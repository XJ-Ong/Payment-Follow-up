"""Transactional daily refresh and immutable workspace readback."""
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import (ActivityLog, Alert, ClientFollowupProfile, FollowupRule,
                         Invoice, PaymentRecord, PrioritySnapshot, ReminderDraft, SendLog)
from ..followup_schemas import WorkspaceView
from ..orbyte.protocol import OrbyteAdapter
from .scoring import calculate, malaysia_date, ranking_key


class ConfigurationError(ValueError):
    pass


def lock_rule(db: Session, company: UUID) -> FollowupRule:
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == company)
                     .with_for_update().execution_options(populate_existing=True))
    if rule is None:
        raise ConfigurationError("Missing company follow-up rules; load the reference seed data")
    if any(tier not in rule.grace_days_by_tier or type(rule.grace_days_by_tier[tier]) is not int
           or rule.grace_days_by_tier[tier] < 0 for tier in ("New", "Regular", "Key")):
        raise ConfigurationError("Grace days must be non-negative integers for New, Regular and Key")
    return rule


def read_workspace(db: Session, company: UUID, now: datetime | None = None) -> WorkspaceView:
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == company))
    saved = None
    if rule is not None and rule.latest_workspace_event_id is not None:
        saved = db.scalar(select(ActivityLog).where(ActivityLog.company_id == company,ActivityLog.id == rule.latest_workspace_event_id,ActivityLog.action == "followups.refreshed"))
    if saved is None:
        # Legacy workspaces have no pointer until their first refresh on this revision.
        saved = db.scalar(select(ActivityLog).where(ActivityLog.company_id == company,
                         ActivityLog.action == "followups.refreshed").order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(1))
    if saved is not None:
        return WorkspaceView.model_validate(saved.after_state)
    return WorkspaceView(as_of_date=malaysia_date(now or datetime.now(timezone.utc)), computed_at=None,
        customers=[], invoices=[], rules=None, alerts=[], queue_ids=[],
        dashboard=dict(total_outstanding="0.00", total_overdue="0.00", queue_count=0,
                       alert_count=0, customer_balances=[], ranking_ids=[]))


def refresh_workspace(db: Session, company: UUID, adapter: OrbyteAdapter,
                      actor_id: UUID, *, now: datetime | None = None) -> WorkspaceView:
    rule = lock_rule(db, company)
    now = now or datetime.now(timezone.utc)  # after acquiring the company lock
    as_of = malaysia_date(now)
    try:
        approver = adapter.get_user(rule.primary_approver_id)
    except LookupError as error:
        raise ConfigurationError("Primary approver is missing from reference data") from error
    if approver.company_id != company or approver.role not in ("owner", "finance"):
        raise ConfigurationError("Primary approver must be an Owner or Finance user in this company")
    clients = {c.id: c for c in adapter.list_clients(company)}
    profiles = {p.client_id: p for p in db.scalars(select(ClientFollowupProfile).where(ClientFollowupProfile.company_id == company))}
    missing = set(clients) - set(profiles)
    if missing:
        raise ConfigurationError("Missing follow-up profile for customer(s): " + ", ".join(sorted(clients[c].name for c in missing)))
    # One aggregate query provides a consistent invoice/payment view for this refresh.
    payment_totals = select(PaymentRecord.invoice_id, func.sum(PaymentRecord.amount).label("paid")).where(PaymentRecord.company_id == company).group_by(PaymentRecord.invoice_id).subquery()
    rows = db.execute(select(Invoice, func.coalesce(payment_totals.c.paid, 0)).outerjoin(payment_totals, Invoice.id == payment_totals.c.invoice_id).where(Invoice.company_id == company).order_by(Invoice.invoice_no, Invoice.id)).all()
    last_sent = dict(db.execute(select(ReminderDraft.invoice_id, func.max(SendLog.sent_at)).join(SendLog, SendLog.draft_id == ReminderDraft.id).where(ReminderDraft.company_id == company, SendLog.company_id == company, SendLog.status == "simulated").group_by(ReminderDraft.invoice_id)).all())
    earliest = min((invoice.due_date for invoice, _ in rows), default=as_of)
    holidays = tuple(h.date for h in adapter.list_public_holidays(company, earliest, as_of)) if rule.skip_holidays and earliest <= as_of else ()
    rules = dict(grace_days_by_tier=rule.grace_days_by_tier, alert_threshold=f"{rule.alert_threshold:.2f}", safety_flag_days=rule.safety_flag_days, min_spacing_days=rule.min_spacing_days, skip_holidays=rule.skip_holidays, primary_approver_id=str(rule.primary_approver_id), backup_approver_id=str(rule.backup_approver_id) if rule.backup_approver_id else None, owner_approver_id=str(rule.owner_approver_id) if rule.owner_approver_id else None, second_approval_amount=f"{rule.second_approval_amount:.2f}")
    calculations = {}
    for invoice, payments in rows:
        if invoice.client_id not in clients or invoice.client_id not in profiles:
            raise ConfigurationError(f"Invoice {invoice.invoice_no} has an unknown customer or missing company profile")
        profile = profiles[invoice.client_id]
        calculations[invoice.id] = calculate(total=invoice.total_amount, payments=payments,
            due_date=invoice.due_date, as_of=as_of, status=invoice.status,
            grace_days=rule.grace_days_by_tier[profile.relationship_tier], alert_threshold=rule.alert_threshold,
            safety_flag_days=rule.safety_flag_days, min_spacing_days=rule.min_spacing_days,
            do_not_contact=profile.do_not_contact, skip_holidays=rule.skip_holidays, holidays=holidays,
            last_sent_date=malaysia_date(last_sent[invoice.id]) if invoice.id in last_sent else None)
    from .workflow import synchronize, workflow_views
    synchronize(db, company, adapter, rule, rows, calculations, actor_id, now)
    ranked = sorted((i for i, _ in rows if i.status not in ("void", "paid") and calculations[i.id].outstanding > 0 and calculations[i.id].days_overdue > 0), key=lambda i: ranking_key(i.invoice_no, str(i.id), calculations[i.id]))
    ranks = {i.id: rank for rank, i in enumerate(ranked, 1)}
    snapshots = {s.invoice_id: s for s in db.scalars(select(PrioritySnapshot).where(PrioritySnapshot.company_id == company, PrioritySnapshot.as_of_date == as_of))}
    workflows = workflow_views(db, company, adapter, now=now)
    invoice_views = []
    for invoice, payments in rows:
        c = calculations[invoice.id]
        detail = dict(outstanding_amount=f"{c.outstanding:.2f}", days_overdue=c.days_overdue,
            grace_days=c.grace_days, effective_days=c.effective_days, score=f"{c.score:.2f}", rank=ranks.get(invoice.id),
            trigger_type=c.trigger_type, eligible=c.eligible, exclusion_reasons=list(c.exclusion_reasons),
            holidays_excluded=[d.isoformat() for d in c.holidays_excluded],
            last_sent_date=c.last_sent_date.isoformat() if c.last_sent_date else None, reason=c.reason)
        snapshot = snapshots.get(invoice.id)
        if snapshot is None:
            snapshot = PrioritySnapshot(id=uuid4(), company_id=company, invoice_id=invoice.id, as_of_date=as_of)
            db.add(snapshot)
            snapshots[invoice.id] = snapshot
        snapshot.rule_id = rule.id
        snapshot.computed_at = now
        snapshot.outstanding_amount = c.outstanding
        snapshot.days_overdue = c.days_overdue
        snapshot.grace_days = c.grace_days
        snapshot.effective_days = c.effective_days
        snapshot.score = c.score
        snapshot.rank = ranks.get(invoice.id)
        snapshot.reason = c.reason
        snapshot.rule_snapshot = rules
        snapshot.eligible = c.eligible
        snapshot.exclusion_reasons = list(c.exclusion_reasons)
        snapshot.calculation = detail
        invoice_views.append(dict(id=str(invoice.id), invoice_no=invoice.invoice_no,
            client_id=str(invoice.client_id), issue_date=invoice.issue_date.isoformat(), due_date=invoice.due_date.isoformat(),
            total_amount=f"{invoice.total_amount:.2f}", payments=f"{payments:.2f}", outstanding_amount=f"{c.outstanding:.2f}", status=invoice.status, calculation=detail, workflow=workflows[invoice.id]))
    db.flush()
    # Old alerts stay as history; only current eligible alerts remain active.
    alerts = db.scalars(select(Alert).where(Alert.company_id == company)).all()
    snapshot_history = {s.id: s for s in db.scalars(select(PrioritySnapshot).where(PrioritySnapshot.company_id == company))}
    for alert in alerts:
        source = snapshot_history.get(alert.snapshot_id)
        current = source is not None and source.as_of_date == as_of and source.invoice_id in calculations and calculations[source.invoice_id].eligible and alert.recipient_id == rule.primary_approver_id
        if not current and alert.status in ("new", "seen") and alert.channel == "dashboard":
            alert.status = "dismissed"
    existing = {(a.snapshot_id, a.recipient_id, a.channel): a for a in alerts}
    for invoice in ranked:
        c = calculations[invoice.id]
        if not c.eligible:
            continue
        snapshot = snapshots[invoice.id]
        key = (snapshot.id, rule.primary_approver_id, "dashboard")
        alert = existing.get(key)
        if alert is None:
            alert = Alert(id=uuid4(), company_id=company, snapshot_id=snapshot.id,
                recipient_id=rule.primary_approver_id, trigger_type=c.trigger_type, channel="dashboard", status="new")
            db.add(alert)
            alerts.append(alert)
        else:
            alert.trigger_type = c.trigger_type
    db.flush()
    alert_views = []
    for a in sorted(alerts, key=lambda a: str(a.id)):
        snapshot = snapshot_history.get(a.snapshot_id)
        if snapshot is not None and snapshot.as_of_date == as_of and snapshot.eligible and a.channel == "dashboard" and a.recipient_id == rule.primary_approver_id:
            alert_views.append(dict(id=str(a.id), invoice_id=str(snapshot.invoice_id), snapshot_id=str(snapshot.id), recipient_id=str(a.recipient_id), trigger_type=a.trigger_type, status=a.status, reason=snapshot.reason))
    customers = []
    for client in clients.values():
        p = profiles[client.id]
        customers.append(dict(id=str(client.id), name=client.name, contact=client.email or client.phone or "", initials="".join(n[0] for n in client.name.split()[:2]), color="blue", graceDays=rule.grace_days_by_tier[p.relationship_tier], doNotContact=p.do_not_contact))
    balances = {c: Decimal("0.00") for c in clients}
    total_overdue = Decimal("0.00")
    for invoice, _ in rows:
        if invoice.status == "void":
            continue
        c = calculations[invoice.id]
        balances[invoice.client_id] += c.outstanding
        if c.days_overdue > 0:
            total_overdue += c.outstanding
    queue = [str(i.id) for i in ranked if calculations[i.id].eligible]
    workspace = WorkspaceView.model_validate(dict(as_of_date=as_of.isoformat(), computed_at=now,
        customers=customers, invoices=invoice_views, rules=rules, queue_ids=queue, alerts=alert_views,
        dashboard=dict(total_outstanding=f"{sum(balances.values(), Decimal('0.00')):.2f}", total_overdue=f"{total_overdue:.2f}", queue_count=len(queue),
            alert_count=sum(a["status"] in ("new", "seen") for a in alert_views),
            customer_balances=[dict(customer_id=str(c), name=clients[c].name, balance=f"{balance:.2f}") for c, balance in balances.items()], ranking_ids=[str(i.id) for i in ranked])))
    event = ActivityLog(id=uuid4(), company_id=company, actor_type="user", actor_id=actor_id,
        action="followups.refreshed", entity_type="company", entity_id=company,
        after_state=workspace.model_dump(mode="json"), created_at=now)
    db.add(event)
    db.flush()
    rule.latest_workspace_event_id = event.id
    db.flush()
    return workspace
