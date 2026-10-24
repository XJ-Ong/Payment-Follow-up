"""Version-bound approval workflow. All mutations share the company rule lock."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
from uuid import UUID, uuid4

from sqlalchemy import func, select

from ..db.models import (ActivityLog, Approval, ClientFollowupProfile, FollowupRule,
                         Invoice, PaymentRecord, ReminderDraft, SendLog, DeliveryAttempt)
from .followups import ConfigurationError, lock_rule, refresh_workspace
from .scoring import malaysia_date

ACTIVE = ("draft", "pending_approval", "pending_second_approval", "approved")


class WorkflowError(ValueError):
    def __init__(self, detail, code=409, persist=False):
        super().__init__(detail)
        self.code, self.persist = code, persist


def user_name(adapter, user_id):
    if user_id is None:
        return "Unknown historical author"
    try:
        return adapter.get_user(user_id).name
    except LookupError:
        return str(user_id)


def audit(db, company, actor, action, invoice_id, draft=None, details=None, now=None, actor_type="user"):
    db.add(ActivityLog(id=uuid4(), company_id=company, actor_type=actor_type, actor_id=actor,
        action=action, entity_type="invoice", entity_id=invoice_id,
        after_state={"invoice_id": str(invoice_id), "draft_id": str(draft.id) if draft else None,
                     "version": draft.version if draft else None, "status": draft.status if draft else None,
                     **(details or {})}, created_at=now or datetime.now(timezone.utc)))


def configuration(rule, adapter, company):
    ids = (rule.primary_approver_id, rule.backup_approver_id, rule.owner_approver_id)
    if any(i is None for i in ids) or len(set(ids)) != 3:
        raise ConfigurationError("Configure distinct primary Finance, backup Finance and Owner approvers")
    for user_id, role in zip(ids, ("finance", "finance", "owner")):
        try:
            user = adapter.get_user(user_id)
        except LookupError as error:
            raise ConfigurationError("Configured workflow approver is missing") from error
        if user.company_id != company or user.role != role:
            raise ConfigurationError(f"Configured {role} approver must belong to this company")


def facts_for(db, company, invoice, adapter):
    client = adapter.get_client(invoice.client_id)
    profile = db.scalar(select(ClientFollowupProfile).where(ClientFollowupProfile.client_id == invoice.client_id, ClientFollowupProfile.company_id == company))
    if client.company_id != company or profile is None:
        raise ConfigurationError("Missing company customer follow-up profile")
    paid = db.scalar(select(func.coalesce(func.sum(PaymentRecord.amount), 0)).where(PaymentRecord.company_id == company, PaymentRecord.invoice_id == invoice.id))
    recipient = (profile.telegram_chat_id if profile.preferred_channel == "Telegram" else
                 client.email if profile.preferred_channel == "Email" else client.phone)
    return dict(invoice_no=invoice.invoice_no, due_date=invoice.due_date.isoformat(), total_amount=f"{invoice.total_amount:.2f}",
        outstanding_amount=f"{max(Decimal('0'), invoice.total_amount-paid):.2f}", currency="MYR", customer_id=str(client.id),
        customer_name=client.name, company_name=adapter.get_company(company).name,
        recipient=recipient or "", channel=profile.preferred_channel, language=profile.language, tone=profile.tone)


def policy_for(rule, facts):
    return dict(required_approvals=2 if Decimal(facts["outstanding_amount"]) > rule.second_approval_amount else 1,
        threshold=f"{rule.second_approval_amount:.2f}", finance_id=str(rule.primary_approver_id),
        backup_finance_id=str(rule.backup_approver_id), owner_id=str(rule.owner_approver_id))


def template(facts):
    amount, number, due = facts["outstanding_amount"], facts["invoice_no"], facts["due_date"]
    name, company = facts["customer_name"], facts["company_name"]
    if facts["language"] == "Bahasa Malaysia":
        opening = {"Friendly": "Peringatan mesra", "Neutral": "Peringatan pembayaran", "Firm": "Tindakan pembayaran diperlukan"}[facts["tone"]]
        return f"Salam {name},\n\n{opening}: invois {number}, bertarikh akhir {due}, mempunyai baki tertunggak MYR {amount}. Sila maklumkan jangkaan tarikh pembayaran. Jika pembayaran telah dibuat, sila kongsikan rujukan pembayaran.\n\nTerima kasih,\n{company}"
    opening = {"Friendly": "A friendly reminder", "Neutral": "Payment reminder", "Firm": "Payment follow-up requiring your attention"}[facts["tone"]]
    return f"Hello {name},\n\n{opening}: invoice {number}, due {due}, has an outstanding balance of MYR {amount}. Please confirm your expected payment date. If you have already paid, please share your payment reference.\n\nThank you,\n{company}"


def validate_body(body, facts):
    body = body.strip()
    if facts["channel"] == "Telegram" and len(body.encode('utf-16-le')) // 2 > 4096:
        raise WorkflowError("Telegram reminders must contain at most 4,096 characters. Edit before approval.", 422)
    if not body or len(body) > 10000:
        raise WorkflowError("Reminder text must contain between 1 and 10,000 characters", 422)
    if any(token not in body for token in (facts["invoice_no"], facts["due_date"], facts["outstanding_amount"], facts["company_name"])):
        raise WorkflowError("Keep the invoice number, due date, exact balance and company identity in the reminder", 422)
    if any(term in body.casefold() for term in ("service disruption", "credit hold", "legal action", "suspend service", "tindakan undang", "henti perkhidmatan", "gantung perkhidmatan")):
        raise WorkflowError("Reminder text cannot threaten legal action or service disruption", 422)
    return body


def assigned(draft, adapter, today):
    policy = draft.approval_policy
    if policy.get("required_approvals") == 1 or draft.status not in ("pending_approval", "pending_second_approval"):
        return None, None
    if draft.status == "pending_second_approval":
        owner = UUID(policy["owner_id"])
        if adapter.list_approved_leave(owner, today):
            return None, "Waiting for Owner to return from approved leave"
        return owner, None
    primary, backup = UUID(policy["finance_id"]), UUID(policy["backup_finance_id"])
    if not adapter.list_approved_leave(primary, today):
        return primary, None
    if not adapter.list_approved_leave(backup, today):
        return backup, "Primary Finance is on leave; routed to backup Finance"
    return None, "Waiting for an available Finance approver"


def first_assigned(draft, adapter, today):
    primary, backup = UUID(draft.approval_policy["finance_id"]), UUID(draft.approval_policy["backup_finance_id"])
    if not adapter.list_approved_leave(primary, today):
        return primary
    return backup if not adapter.list_approved_leave(backup, today) else None


def digest(draft):
    return sha256(json.dumps([draft.body, draft.facts, draft.approval_policy], sort_keys=True).encode()).hexdigest()


def draft_view(db, draft, adapter, actor=None, now=None):
    today = malaysia_date(now or datetime.now(timezone.utc))
    invoice = db.get(Invoice, draft.invoice_id)
    assignee, waiting = assigned(draft, adapter, today) if not draft.is_legacy else (None, "Historical record; not dispatchable")
    actions = []
    delivery = db.scalar(select(DeliveryAttempt).where(DeliveryAttempt.company_id == draft.company_id, DeliveryAttempt.draft_id == draft.id))
    if actor is not None and actor.company_id == draft.company_id and actor.role in ("owner", "finance") and draft.is_current and not draft.is_legacy:
        actions = ["versions", "skip", "snooze"]
        if draft.approval_policy.get("required_approvals") == 1:
            if draft.status in ACTIVE:
                actions.append("send")
        else:
            if draft.status == "draft":
                actions.append("submit")
            if draft.status in ("pending_approval", "pending_second_approval") and assignee == actor.id:
                actions.append("approve")
            if draft.status in ("pending_approval", "pending_second_approval", "approved") and first_assigned(draft, adapter, today) == actor.id:
                actions.append("edit-approve")
            if draft.status == "approved":
                actions.append("send")
    if delivery and draft.status != "sent":
        if delivery.status in ("sending", "unknown"):
            actions = []
            waiting = ("Telegram delivery is in progress. Refresh to check the saved result." if delivery.status == "sending" else
                       "Telegram delivery outcome is unknown. Do not resend; check Telegram and resolve this delivery before preparing another reminder.")
        elif delivery.status == "failed":
            actions = [a for a in actions if a != "send"]
            waiting = "Telegram rejected the attempt or could not connect. Correct the setup, then edit and save a fresh version for approval before trying again."
    approvals = db.scalars(select(Approval).where(Approval.company_id == draft.company_id, Approval.draft_id == draft.id).order_by(Approval.approval_step)).all()
    sender_approval = any(a.context.get("approval_mode") == "send" for a in approvals)
    return dict(id=str(draft.id), invoice_id=str(draft.invoice_id), invoice_no=invoice.invoice_no, version=draft.version,
        status=draft.status, body=draft.body, channel=draft.channel, language=draft.language, tone=draft.tone,
        recipient=draft.facts.get("recipient", ""), prepared_by=str(draft.prepared_by) if draft.prepared_by else None,
        author_name=user_name(adapter, draft.prepared_by), historical=draft.is_legacy, is_current=draft.is_current,
        supersedes_id=str(draft.supersedes_id) if draft.supersedes_id else None, created_at=draft.created_at,
        required_approvals=draft.approval_policy.get("required_approvals", 0), assigned_approver_id=str(assignee) if assignee else None,
        assigned_approver_name=user_name(adapter, assignee) if assignee else None, waiting_reason=waiting,
        delivery={key: getattr(delivery,key) for key in ("id","status","provider_message_id","error_code","retry_after_seconds","started_at","finished_at")} if delivery else None,
        allowed_actions=actions, approvals=[dict(id=str(a.id), approver_id=str(a.approver_id), approver_name=user_name(adapter,a.approver_id), approval_step=a.approval_step, decision=a.decision, decided_at=a.decided_at, historical=a.is_legacy or (sender_approval and a.context.get("approval_mode") != "send")) for a in approvals])


def workflow_views(db, company, adapter, actor=None, now=None):
    drafts = db.scalars(select(ReminderDraft).where(ReminderDraft.company_id == company).order_by(ReminderDraft.version.desc())).all()
    latest, current = {}, {}
    for draft in drafts:
        latest.setdefault(draft.invoice_id, draft)
        if draft.is_current:
            current[draft.invoice_id] = draft
    result = {}
    for invoice in db.scalars(select(Invoice).where(Invoice.company_id == company)):
        result[invoice.id] = dict(current=draft_view(db,current[invoice.id],adapter,actor,now) if invoice.id in current else None,
            latest=draft_view(db,latest[invoice.id],adapter,actor,now) if invoice.id in latest else None,
            suppressed_until=invoice.followup_suppressed_until, suppression_reason=invoice.followup_suppression_reason)
    return result


def synchronize(db, company, adapter, rule, rows, calculations, actor_id, now):
    from .delivery import recover_interrupted
    recover_interrupted(db,company,now)
    uncertain = set(db.scalars(select(ReminderDraft.invoice_id).join(DeliveryAttempt, DeliveryAttempt.draft_id == ReminderDraft.id)
        .where(ReminderDraft.company_id == company, DeliveryAttempt.company_id == company, DeliveryAttempt.status.in_(("sending","unknown")))))
    active = {d.invoice_id: d for d in db.scalars(select(ReminderDraft).where(ReminderDraft.company_id == company, ReminderDraft.is_current))}
    for invoice, _ in rows:
        c = calculations[invoice.id]
        reasons = list(c.exclusion_reasons)
        draft = active.get(invoice.id)
        if draft is not None:
            changed = draft.is_legacy or draft.facts != facts_for(db,company,invoice,adapter) or draft.approval_policy != policy_for(rule,draft.facts)
            if changed or not c.eligible:
                draft.status, draft.is_current = "invalidated", False
                audit(db,company,actor_id,"draft.invalidated",invoice.id,draft,dict(reason="Invoice facts, policy or eligibility changed"),now)
            else:
                reasons.append(f"Active reminder journey: {draft.status}")
        if invoice.followup_suppressed_until and malaysia_date(now) < invoice.followup_suppressed_until:
            reasons.append(f"Follow-up suppressed until {invoice.followup_suppressed_until}: {invoice.followup_suppression_reason}")
        if invoice.id in uncertain:
            reasons.append("Telegram delivery is in progress or its outcome is unknown; do not resend")
        calculations[invoice.id] = replace(c, eligible=c.eligible and not reasons, exclusion_reasons=tuple(reasons))
    db.flush()


def authorize_actor(company, adapter, actor):
    try:
        known = adapter.get_user(actor.id)
    except LookupError as error:
        raise WorkflowError("Unknown workflow user",403) from error
    if known.company_id != company or actor.company_id != company or known.role != actor.role or actor.role not in ("owner","finance"):
        raise WorkflowError("Owner or Finance identity in this company is required",403)


def create_draft(db, company, adapter, actor, invoice_id, now=None):
    authorize_actor(company,adapter,actor)
    rule = lock_rule(db,company)
    now = now or datetime.now(timezone.utc)
    configuration(rule,adapter,company)
    workspace = refresh_workspace(db,company,adapter,actor.id,now=now)
    row = next((i for i in workspace.invoices if i.id == invoice_id), None)
    if row is None:
        raise WorkflowError("Invoice not found",404)
    if not row.calculation.eligible:
        raise WorkflowError("Invoice is not eligible: " + "; ".join(row.calculation.exclusion_reasons))
    invoice = db.get(Invoice,invoice_id)
    facts = facts_for(db,company,invoice,adapter)
    if not facts["recipient"]:
        raise WorkflowError("Customer has no contact for the selected channel",422)
    draft = new_version(db,company,invoice,adapter,actor,rule,facts,now=now)
    return draft


def new_version(db,company,invoice,adapter,actor,rule,facts,previous=None,body=None,now=None):
    if previous is not None:
        previous.is_current, previous.status = False, "superseded"
        db.flush()  # release partial unique index before inserting the new current version
    version = (db.scalar(select(func.max(ReminderDraft.version)).where(ReminderDraft.invoice_id == invoice.id, ReminderDraft.company_id == company)) or 0)+1
    body = validate_body(body if body is not None else template(facts),facts)
    draft = ReminderDraft(id=uuid4(),company_id=company,invoice_id=invoice.id,version=version,prepared_by=actor.id,
        facts=facts,approval_policy=policy_for(rule,facts),is_current=True,is_legacy=False,supersedes_id=previous.id if previous else None,
        body=body,channel=facts["channel"],language=facts["language"],tone=facts["tone"],written_by="human" if previous else "template",
        verification_result={"facts_checked":True,"source":"template" if previous is None else "human"},status="draft",created_at=now)
    db.add(draft)
    db.flush()
    audit(db,company,actor.id,"draft.version_created",invoice.id,draft,now=now)
    return draft


def approve(db,company,draft,adapter,actor,now,decision="approve"):
    assignee, reason = assigned(draft,adapter,malaysia_date(now))
    if assignee != actor.id:
        raise WorkflowError(reason or "This approval is assigned to a different user",403)
    step = 1 if draft.status == "pending_approval" else 2
    if db.scalar(select(Approval.id).where(Approval.draft_id == draft.id, Approval.approver_id == actor.id)):
        raise WorkflowError("Two distinct approvers are required")
    db.add(Approval(id=uuid4(),company_id=company,draft_id=draft.id,approver_id=actor.id,approval_step=step,decision=decision,
        is_legacy=False,context={"assigned_to":str(assignee),"role":actor.role,"content_digest":digest(draft)},decided_at=now))
    draft.status = "pending_second_approval" if step == 1 and draft.approval_policy["required_approvals"] == 2 else "approved"
    db.flush()
    audit(db,company,actor.id,"draft.approved",draft.invoice_id,draft,dict(step=step),now)


def send_record(db, company, record):
    draft = db.get(ReminderDraft,record.draft_id)
    invoice = db.get(Invoice,draft.invoice_id)
    return dict(id=str(record.id),draft_id=str(draft.id),invoice_id=str(invoice.id),invoice_no=invoice.invoice_no,
        version=draft.version,channel=record.channel,recipient_contact=record.recipient_contact,approved_body=record.approved_body,
        sent_at=record.sent_at,status=record.status,historical=draft.is_legacy,provider_message_id=record.provider_message_id)


def mutate(db,company,adapter,actor,draft_id,action,data,now=None):
    authorize_actor(company,adapter,actor)
    rule = lock_rule(db,company)
    now = now or datetime.now(timezone.utc)
    draft = db.scalar(select(ReminderDraft).where(ReminderDraft.company_id == company,ReminderDraft.id == draft_id).with_for_update())
    if draft is None:
        raise WorkflowError("Draft not found",404)
    if data.version != draft.version:
        raise WorkflowError("Stale draft version; reload before acting")
    if draft.is_legacy:
        raise WorkflowError("Historical draft cannot be dispatched or reviewed")
    if action == "send":
        existing = db.scalar(select(SendLog).where(SendLog.company_id == company,SendLog.draft_id == draft.id))
        if existing:
            return draft
    if not draft.is_current or draft.status not in ACTIVE:
        if action == "send":
            audit(db,company,actor.id,"send.blocked",draft.invoice_id,draft,dict(reason="Draft is no longer current"),now)
            refresh_workspace(db,company,adapter,actor.id,now=now)
            raise WorkflowError("Draft is no longer current; create a new version",persist=True)
        raise WorkflowError("Draft is no longer current; reload before acting")
    configuration(rule,adapter,company)
    invoice = db.get(Invoice,draft.invoice_id)
    # Refresh rechecks facts and eligibility and may invalidate the current journey.
    refresh_workspace(db,company,adapter,actor.id,now=now)
    if not draft.is_current:
        if action == "send":
            audit(db,company,actor.id,"send.blocked",invoice.id,draft,dict(reason="Facts or eligibility changed"),now)
            raise WorkflowError("Reminder facts or eligibility changed; create a fresh draft",persist=True)
        raise WorkflowError("Reminder facts or eligibility changed; refresh and create a fresh draft",persist=True)
    actions = draft_view(db,draft,adapter,actor,now)["allowed_actions"]
    if action not in actions:
        if action == "send":
            audit(db,company,actor.id,"send.blocked",invoice.id,draft,dict(reason="Draft has not received final approval"),now)
            raise WorkflowError("Draft has not received final approval",persist=True)
        if action in ("submit", "approve") and draft.status not in (("draft",) if action == "submit" else ("pending_approval", "pending_second_approval")):
            raise WorkflowError("Conflicting workflow state; reload before acting")
        raise WorkflowError("Action is not permitted for this user or workflow state",403)
    if action in ("versions","edit-approve"):
        if data.body is None:
            raise WorkflowError("Reminder body is required",422)
        facts = facts_for(db,company,invoice,adapter)
        draft = new_version(db,company,invoice,adapter,actor,rule,facts,previous=draft,body=data.body,now=now)
        if action == "edit-approve":
            draft.status = "pending_approval"
            approve(db,company,draft,adapter,actor,now,"edit_approve")
    elif action == "submit":
        draft.status = "pending_approval"
        audit(db,company,actor.id,"draft.submitted",invoice.id,draft,now=now)
    elif action == "approve":
        approve(db,company,draft,adapter,actor,now)
    elif action in ("skip","snooze"):
        until = malaysia_date(now)+timedelta(days=1) if action == "skip" else data.snooze_until
        if until is None or until <= malaysia_date(now):
            raise WorkflowError("Snooze date must be a future Malaysia date",422)
        invoice.followup_suppressed_until, invoice.followup_suppression_reason = until, data.reason
        draft.status, draft.is_current = ("skipped" if action == "skip" else "snoozed"),False
        audit(db,company,actor.id,f"draft.{draft.status}",invoice.id,draft,dict(reason=data.reason,until=until.isoformat()),now)
    elif action == "send":
        validate_body(draft.body, draft.facts)
        if not draft.facts.get("recipient"):
            raise WorkflowError("Customer has no contact for the selected channel", 422)
        required = draft.approval_policy["required_approvals"]
        if required == 1:
            # Append the sender's effective approval; earlier decisions remain immutable.
            db.add(Approval(id=uuid4(), company_id=company, draft_id=draft.id,
                approver_id=actor.id, approval_step=1, decision="approve", is_legacy=False,
                context={"approval_mode": "send", "role": actor.role,
                         "assigned_to": str(actor.id), "content_digest": digest(draft)}, decided_at=now))
            draft.status = "approved"
            audit(db,company,actor.id,"draft.approved",invoice.id,draft,
                  dict(step=1, approval_mode="send"),now)
            db.flush()
        else:
            approvals = db.scalars(select(Approval).where(Approval.company_id == company,Approval.draft_id == draft.id,Approval.is_legacy.is_(False)).order_by(Approval.approval_step)).all()
            valid = len(approvals) == required and len({a.approver_id for a in approvals}) == required
            for a in approvals:
                expected = {draft.approval_policy["finance_id"],draft.approval_policy["backup_finance_id"]} if a.approval_step == 1 else {draft.approval_policy["owner_id"]}
                valid = valid and str(a.approver_id) in expected and a.decision in ("approve","edit_approve") and a.context.get("content_digest") == digest(draft) and a.context.get("assigned_to") == str(a.approver_id)
            if not valid:
                audit(db,company,actor.id,"send.blocked",invoice.id,draft,dict(reason="Required version-bound approvals are missing"),now)
                raise WorkflowError("Required approvals are invalid or missing",persist=True)
        if draft.channel == "Telegram":
            # Only delivery.dispatch may claim, commit and perform the external request.
            validate_body(draft.body,draft.facts)
            return draft
        db.add(SendLog(id=uuid4(),company_id=company,draft_id=draft.id,channel=draft.channel,
            recipient_contact=draft.facts["recipient"],approved_body=draft.body,sent_at=now,status="simulated"))
        draft.status,draft.is_current = "sent",False
        audit(db,company,actor.id,"reminder.simulated_sent",invoice.id,draft,now=now)
    db.flush()
    refresh_workspace(db,company,adapter,actor.id,now=now)
    return draft
