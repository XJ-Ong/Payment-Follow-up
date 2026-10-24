"""Company-scoped, paginated reads of existing audit events."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import and_, func, or_, select
from ..db.models import ActivityLog, Invoice

MALAYSIA = ZoneInfo("Asia/Kuala_Lumpur")


def base(company):
    return select(ActivityLog).where(ActivityLog.company_id == company,
                                    ActivityLog.action != "followups.refreshed")


def references(adapter, company):
    return {c.id: c.name for c in adapter.list_clients(company)}


def actor_name(users, actor_id):
    return users.get(actor_id, str(actor_id) if actor_id else "Unknown historical author")


def summary(event, invoice, clients, users):
    facts = event.after_state or {}
    customer = clients.get(invoice.client_id) if invoice else (
        clients.get(event.entity_id) if event.entity_type == "customer" else None)
    text = facts.get("reason")
    if not text:
        if event.action == "invoices.csv_imported":
            text = f"{facts.get('imported_count', facts.get('count', 'Batch of'))} invoices imported"
        elif facts.get("version") is not None:
            text = f"Version {facts['version']}" + (f" · {facts['status']}" if facts.get('status') else "")
        elif event.action in ("invoice.created", "payment.recorded") and facts.get("outstanding_amount") is not None:
            text = f"Saved outstanding balance: MYR {facts['outstanding_amount']}"
        elif event.action in ("rules.updated", "customer.profile_updated"):
            keys = [key.replace('_', ' ') for key, value in facts.items()
                    if key != 'revision' and (event.before_state or {}).get(key) != value]
            text = "Updated " + ", ".join(keys) if keys else "Configuration updated"
        else:
            text = "Company settings" if event.entity_type == "company" else "Recorded event"
    return dict(id=event.id, action=event.action, actor_id=event.actor_id,
                actor_name=actor_name(users, event.actor_id) if event.actor_id else
                    ("AI" if event.actor_type == "ai" else event.actor_type.title() if event.actor_type != "user" else "Unknown historical author"),
                actor_type=event.actor_type, entity_type=event.entity_type, entity_id=event.entity_id,
                invoice_number=invoice.invoice_no if invoice else None, customer_name=customer,
                created_at=event.created_at, summary=str(text))


def read_page(db, company, adapter, search, date_from, date_to, actor, action, page, actor_type=None):
    clients = references(adapter, company)
    users = {u.id: u.name for u in adapter.list_users(company)}
    query = base(company).outerjoin(Invoice, and_(Invoice.company_id == company,
        ActivityLog.entity_type == "invoice", Invoice.id == ActivityLog.entity_id))
    if search:
        needle = search.casefold()
        client_ids = [id for id, name in clients.items() if needle in name.casefold()]
        user_ids = [id for id, name in users.items() if needle in name.casefold()]
        # contains(autoescape=True) treats user-entered % and _ literally.
        query = query.where(or_(func.lower(Invoice.invoice_no).contains(needle, autoescape=True),
            Invoice.client_id.in_(client_ids),
            and_(ActivityLog.entity_type == "customer", ActivityLog.entity_id.in_(client_ids)),
            ActivityLog.actor_id.in_(user_ids),
            func.lower(ActivityLog.actor_type).contains(needle, autoescape=True)))
    if date_from:
        query = query.where(ActivityLog.created_at >= datetime.combine(date_from, time.min, MALAYSIA).astimezone(timezone.utc))
    if date_to:
        query = query.where(ActivityLog.created_at < datetime.combine(date_to, time.min, MALAYSIA).astimezone(timezone.utc) + timedelta(days=1))
    if actor:
        query = query.where(ActivityLog.actor_id.is_(None) if actor == "unattributed" else ActivityLog.actor_id == actor)
    if action:
        query = query.where(ActivityLog.action == action)
    if actor_type:
        query = query.where(ActivityLog.actor_type == actor_type)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.add_columns(Invoice).order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
                      .offset((page - 1) * 25).limit(25)).all()
    actors = db.scalars(base(company).with_only_columns(ActivityLog.actor_id).distinct()).all()
    actions = db.scalars(base(company).with_only_columns(ActivityLog.action).distinct().order_by(ActivityLog.action)).all()
    return dict(items=[summary(e, inv, clients, users) for e, inv in rows], total=total, page=page,
                actors=sorted([dict(id=id, name=actor_name(users, id) if id else "System / unknown actor") for id in actors], key=lambda a: a['name']), actions=actions)


def read_detail(db, company, adapter, event_id):
    event = db.scalar(base(company).where(ActivityLog.id == event_id))
    if event is None:
        return None
    invoice = db.scalar(select(Invoice).where(Invoice.company_id == company, Invoice.id == event.entity_id)) if event.entity_type == "invoice" else None
    users = {u.id: u.name for u in adapter.list_users(company)}
    return dict(**summary(event, invoice, references(adapter, company), users),
                before_state=event.before_state, after_state=event.after_state, metadata=event.meta)
