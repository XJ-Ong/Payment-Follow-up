"""Commit intent before Telegram I/O. Ambiguous outcomes are never retried."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy import select
from ..db.models import DeliveryAttempt, ReminderDraft, SendLog
from ..messaging import Message, MessagingService
from ..messaging.service import DeliveryResult
from .followups import lock_rule, refresh_workspace
from . import workflow


def recover_interrupted(db, company, now):
    attempts = db.scalars(select(DeliveryAttempt).where(DeliveryAttempt.company_id == company,
        DeliveryAttempt.status == 'sending', DeliveryAttempt.started_at < now - timedelta(minutes=2)))
    for attempt in attempts:
        attempt.status, attempt.error_code, attempt.finished_at = 'unknown', 'interrupted_attempt', now
        draft = db.get(ReminderDraft, attempt.draft_id)
        workflow.audit(db,company,None,'telegram.unknown',draft.invoice_id,draft,
            dict(attempt_id=str(attempt.id),initiated_by=str(attempt.initiated_by),reason='Interrupted delivery; acceptance is unknown'),now,actor_type='system')
    db.flush()


def dispatch(db, company, adapter, actor, draft_id, data, *, now=None, sender=None):
    workflow.authorize_actor(company,adapter,actor)
    lock_rule(db,company)
    draft = db.scalar(select(ReminderDraft).where(ReminderDraft.company_id == company,ReminderDraft.id == draft_id).with_for_update())
    if draft is None:
        raise workflow.WorkflowError('Draft not found',404)
    if data.version != draft.version:
        raise workflow.WorkflowError('Stale draft version; reload before acting')
    if draft.channel != 'Telegram':
        return workflow.mutate(db,company,adapter,actor,draft_id,'send',data,now=now)
    existing = db.scalar(select(DeliveryAttempt).where(DeliveryAttempt.company_id == company,DeliveryAttempt.draft_id == draft.id))
    if existing:
        # Includes failed/unknown: a repeated HTTP request never becomes another dispatch.
        return draft
    draft = workflow.mutate(db,company,adapter,actor,draft_id,'send',data,now=now)
    started = now or datetime.now(timezone.utc)
    message = Message(channel='Telegram',recipient=draft.facts['recipient'],body=draft.body)
    attempt = DeliveryAttempt(id=uuid4(),company_id=company,draft_id=draft.id,initiated_by=actor.id,
        recipient_contact=message.recipient,approved_body=message.body,content_digest=workflow.digest(draft),
        status='sending',started_at=started)
    db.add(attempt)
    workflow.audit(db,company,actor.id,'telegram.requested',draft.invoice_id,draft,dict(attempt_id=str(attempt.id)),started)
    db.flush()
    attempt_id = attempt.id
    # Keep the claim even if the process dies after Telegram accepts the request.
    db.commit()
    try:
        result = (sender or MessagingService.from_env()).send(message)
    except Exception:
        # Do not expose token-bearing exception strings or blindly retry an uncertain send.
        result = DeliveryResult(channel='Telegram',status='unknown',error_code='transport_uncertain')
    finished = now or datetime.now(timezone.utc)
    lock_rule(db,company)
    attempt = db.scalar(select(DeliveryAttempt).where(DeliveryAttempt.company_id == company,DeliveryAttempt.id == attempt_id).with_for_update())
    draft = db.scalar(select(ReminderDraft).where(ReminderDraft.company_id == company,ReminderDraft.id == draft_id).execution_options(populate_existing=True))
    attempt.status, attempt.finished_at = result.status, finished
    attempt.provider_message_id, attempt.error_code = result.provider_message_id, result.error_code
    attempt.retry_after_seconds = result.retry_after_seconds
    if result.status == 'sent':
        db.add(SendLog(id=uuid4(),company_id=company,draft_id=draft.id,channel='Telegram',
            recipient_contact=attempt.recipient_contact,approved_body=attempt.approved_body,
            sent_at=finished,status='sent',provider_message_id=result.provider_message_id))
        draft.status, draft.is_current = 'sent',False
    workflow.audit(db,company,None,f'telegram.{result.status}',draft.invoice_id,draft,
        dict(attempt_id=str(attempt.id),initiated_by=str(attempt.initiated_by),provider_message_id=result.provider_message_id,
             error_code=result.error_code,retry_after_seconds=result.retry_after_seconds),finished,actor_type='system')
    db.flush()
    refresh_workspace(db,company,adapter,actor.id,now=finished)
    return draft
