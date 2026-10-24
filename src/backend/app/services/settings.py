"""Company-locked, revision-checked preference and rule edits."""
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from ..db.models import ActivityLog, ClientFollowupProfile, ReminderDraft
from ..settings_schemas import ProfileInput, ProfileView
from ..followup_schemas import RuleView
from .followups import ConfigurationError, lock_rule, refresh_workspace

def profile_view(profile, client, rule):
    return ProfileView(client_id=client.id, name=client.name, email=client.email, phone=client.phone,
        grace_days=rule.grace_days_by_tier[profile.relationship_tier],
        **{key: getattr(profile,key) for key in ProfileInput.model_fields})

def rule_view(rule):
    return RuleView.model_validate({key: (f'{getattr(rule,key):.2f}' if key in ('alert_threshold','second_approval_amount') else getattr(rule,key)) for key in RuleView.model_fields})

def get_profile(db, company, adapter, client_id):
    try:
        client = adapter.get_client(client_id)
    except LookupError:
        raise HTTPException(404, 'Customer not found') from None
    if client.company_id != company:
        raise HTTPException(404, 'Customer not found')
    profile = db.scalar(select(ClientFollowupProfile).where(ClientFollowupProfile.client_id == client_id, ClientFollowupProfile.company_id == company).execution_options(populate_existing=True))
    if profile is None:
        raise ConfigurationError('Missing customer follow-up profile')
    return profile, client

def save_settings(db, company, adapter, actor, data, client_id=None):
    if actor.company_id != company or actor.role not in ('owner','finance') or (client_id is None and actor.role != 'owner'):
        raise HTTPException(403, 'Only Owner can edit company rules' if client_id is None else 'Owner or Finance required')
    rule = lock_rule(db, company)
    if client_id is None:
        target, before, action, entity = rule, rule_view(rule).model_dump(mode='json'), 'rules.updated', 'company'
    else:
        target, client = get_profile(db,company,adapter,client_id)
        before = profile_view(target,client,rule).model_dump(mode='json')
        action, entity = 'customer.profile_updated', 'customer'
    if target.revision != data.revision:
        raise HTTPException(409, 'Saved values changed. Reload saved values before saving again.')
    if client_id is not None:
        contact = client.email if data.preferred_channel == 'Email' else client.phone
        if not contact or not contact.strip():
            raise HTTPException(422, f'Customer has no contact detail for {data.preferred_channel}')
    active = set(db.scalars(select(ReminderDraft.id).where(ReminderDraft.company_id == company, ReminderDraft.is_current)))
    values = data.model_dump(exclude={'revision'})
    if client_id is None:
        values['grace_days_by_tier'] = {**rule.grace_days_by_tier, **values['grace_days_by_tier']}
    changed = any(getattr(target,key) != value for key,value in values.items())
    if changed:
        for key,value in values.items():
            setattr(target,key,value)
        target.revision += 1
        db.flush()
        after = (rule_view(rule) if client_id is None else profile_view(target,client,rule)).model_dump(mode='json')
        db.add(ActivityLog(id=uuid4(),company_id=company,actor_type='user',actor_id=actor.id,
            action=action,entity_type=entity,entity_id=client_id or company,before_state=before,after_state=after))
    # All effects, including invalidations and snapshots, stay in the caller's transaction.
    workspace = refresh_workspace(db,company,adapter,actor.id)
    remaining = set(db.scalars(select(ReminderDraft.id).where(ReminderDraft.company_id == company, ReminderDraft.is_current)))
    return workspace, len(active - remaining)
