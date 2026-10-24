"""Database-backed demo API. X-Role is simulation, not authentication."""
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .db.models import Invoice, PaymentRecord, ClientFollowupProfile, FollowupRule, ActivityLog, WeeklySummary
from .db.session import SessionLocal
from .ids import external_uuid
from .orbyte.mock import MockOrbyteAdapter
from .orbyte.schemas import AppUser
from .workflow_schemas import DraftMutation, DraftView, OutboxView, ActivityView, WorkflowView
from .services import workflow
from .followup_schemas import WorkspaceView, RuleView, SettingsSaveView
from .settings_schemas import ProfileInput, ProfileView, RulesInput
from .services import settings
from .services import invoices as invoice_ops, csv_import, milestones, summary
from .services.invoices import InvoiceInput, PaymentInput
from .csv_schemas import CsvInput, CsvPreview, CsvImportResult
from .services.followups import ConfigurationError, lock_rule, refresh_workspace, read_workspace
from .followup_schemas import SummaryInput, SummaryView

app = FastAPI(title="Payment Follow-up")
app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()], allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Role", "X-User-ID"])

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    if os.getenv("ENABLE_HSTS", "").lower() in ("1", "true", "yes"):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

COMPANY = external_uuid("COMP-01")
adapter = MockOrbyteAdapter(demo_leave_active=os.getenv("DEMO_FINANCE_LEAVE", "").lower() == "true", demo_owner_leave_active=os.getenv("DEMO_OWNER_LEAVE", "").lower() == "true")

def get_db():
    with SessionLocal() as session:
        yield session

def get_role(x_role: Annotated[str | None, Header()] = None,
             x_user_id: Annotated[str | None, Header()] = None):
    codes = {"Owner": "owner", "Finance": "finance"}
    if x_role not in codes:
        raise HTTPException(403, "Owner or Finance access required")
    try:
        user_id = UUID(x_user_id) if x_user_id else external_uuid("USR-01" if x_role == "Owner" else "USR-02")
        actor = adapter.get_user(user_id)
    except (ValueError, LookupError):
        raise HTTPException(403, "Unknown demo user") from None
    if actor.company_id != COMPANY or actor.role != codes[x_role]:
        raise HTTPException(403, "Demo user does not match the role or company")
    return actor

DB = Annotated[Session, Depends(get_db)]
Role = Annotated[AppUser, Depends(get_role)]
def paid(db, invoice):
    return invoice_ops.paid(db,COMPANY,invoice)

def customer(db, client):
    profile = db.get(ClientFollowupProfile, client.id)
    rule = db.scalar(select(FollowupRule).where(FollowupRule.company_id == COMPANY))
    valid = profile is not None and profile.company_id == COMPANY
    if rule is None:
        raise ConfigurationError("Missing company follow-up rules")
    if not valid:
        raise ConfigurationError(f"Missing follow-up profile for customer {client.name}")
    tier = profile.relationship_tier
    return dict(id=str(client.id), name=client.name, contact=client.email or client.phone or "", initials="".join(n[0] for n in client.name.split()[:2]), color="blue", graceDays=(rule.grace_days_by_tier.get(tier, 0) if rule else 0), doNotContact=profile.do_not_contact if valid else False)

def serialize(db, invoice):
    return invoice_ops.serialize(db,COMPANY,invoice)

def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Invoice number already exists or record conflicts") from None

@app.get("/api/health")
def health(db: DB):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(503, "Database unavailable") from None
    return {"status": "ok"}

@app.get("/api/invoices")
def invoices(db: DB, role: Role):
    rows = db.scalars(select(Invoice).where(Invoice.company_id == COMPANY).order_by(Invoice.invoice_no)).all()
    return {"invoices": [serialize(db, row) for row in rows], "customers": [customer(db, c) for c in adapter.list_clients(COMPANY)], "as_of_date": datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).date().isoformat()}

@app.post("/api/invoices", status_code=201)
def create_invoice(data: InvoiceInput, db: DB, role: Role):
    lock_rule(db, COMPANY)
    try:
        invoice = invoice_ops.create(db,COMPANY,adapter,role,data)
        refresh_workspace(db, COMPANY, adapter, role.id)
        commit(db)
        return serialize(db, invoice)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Invoice number already exists") from None

@app.post("/api/invoices/{invoice_id}/payments", status_code=201)
def record_payment(invoice_id: UUID, data: PaymentInput, db: DB, role: Role):
    lock_rule(db, COMPANY)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.company_id == COMPANY).with_for_update())
    if invoice is None:
        raise HTTPException(404, "Invoice not found")
    invoice_ops.add_payment(db,COMPANY,invoice,data,role)
    refresh_workspace(db, COMPANY, adapter, role.id)
    commit(db)
    return serialize(db, invoice)


@app.exception_handler(ConfigurationError)
async def configuration_error(request: Request, error: ConfigurationError):
    return JSONResponse(status_code=409, content={"detail": str(error)})


@app.get("/api/followups", response_model=WorkspaceView)
def followups(db: DB, role: Role):
    return personalize(db, read_workspace(db, COMPANY), role)


@app.post("/api/followups/refresh", response_model=WorkspaceView)
def refresh_followups(db: DB, role: Role):
    result = refresh_workspace(db, COMPANY, adapter, role.id)
    commit(db)
    return personalize(db, result, role)


def personalize(db, workspace, actor):
    result = workspace.model_copy(deep=True)
    views = workflow.workflow_views(db, COMPANY, adapter, actor)
    for invoice in result.invoices:
        if invoice.id in views:
            invoice.workflow = WorkflowView.model_validate(views[invoice.id])
    return result


@app.get("/api/users")
def users(role: Role):
    return [{"id": str(u.id), "name": u.name, "role": u.role, "is_default": u.id == external_uuid("USR-01" if u.role == "owner" else "USR-02")} for u in sorted(adapter.list_users(COMPANY), key=lambda u: str(u.id)) if u.role in ("owner", "finance")]


@app.post("/api/invoices/{invoice_id}/drafts", response_model=DraftView, status_code=201)
def create_reminder(invoice_id: UUID, db: DB, role: Role):
    try:
        draft = workflow.create_draft(db, COMPANY, adapter, role, invoice_id)
        refresh_workspace(db, COMPANY, adapter, role.id)
        result = workflow.draft_view(db,draft,adapter,role)
        commit(db)
        return result
    except workflow.WorkflowError as error:
        db.rollback()
        raise HTTPException(error.code,str(error)) from None


@app.get("/api/invoices/{invoice_id}/drafts", response_model=list[DraftView])
def reminder_versions(invoice_id: UUID, db: DB, role: Role):
    invoice = db.scalar(select(Invoice).where(Invoice.company_id == COMPANY,Invoice.id == invoice_id))
    if invoice is None:
        raise HTTPException(404,"Invoice not found")
    drafts = db.scalars(select(workflow.ReminderDraft).where(workflow.ReminderDraft.company_id == COMPANY,workflow.ReminderDraft.invoice_id == invoice_id).order_by(workflow.ReminderDraft.version.desc())).all()
    return [workflow.draft_view(db,d,adapter,role) for d in drafts]


@app.post("/api/drafts/{draft_id}/{action}", response_model=DraftView)
def reminder_action(draft_id: UUID, action: Literal["versions","submit","approve","edit-approve","skip","snooze","send"], data: DraftMutation, db: DB, role: Role):
    try:
        draft = workflow.mutate(db,COMPANY,adapter,role,draft_id,action,data)
        result = workflow.draft_view(db,draft,adapter,role)
        commit(db)
        return result
    except workflow.WorkflowError as error:
        if error.persist:
            commit(db)
        else:
            db.rollback()
        raise HTTPException(error.code,str(error)) from None
    except ConfigurationError as error:
        db.rollback()
        if action == "send":
            blocked = db.scalar(select(workflow.ReminderDraft).where(workflow.ReminderDraft.company_id == COMPANY,workflow.ReminderDraft.id == draft_id))
            if blocked is not None:
                workflow.audit(db,COMPANY,role.id,"send.blocked",blocked.invoice_id,blocked,dict(reason=str(error)))
                commit(db)
        raise HTTPException(409,str(error)) from None


@app.get("/api/outbox", response_model=list[OutboxView])
def outbox(db: DB, role: Role):
    records = db.scalars(select(workflow.SendLog).join(workflow.ReminderDraft,workflow.ReminderDraft.id == workflow.SendLog.draft_id).join(Invoice,Invoice.id == workflow.ReminderDraft.invoice_id).where(workflow.SendLog.company_id == COMPANY,workflow.ReminderDraft.company_id == COMPANY,Invoice.company_id == COMPANY).order_by(workflow.SendLog.sent_at.desc())).all()
    return [workflow.send_record(db,COMPANY,r) for r in records]


def activity_rows(db, actor, invoice_id=None):
    query = select(ActivityLog).where(ActivityLog.company_id == COMPANY,ActivityLog.action != "followups.refreshed")
    if invoice_id is not None:
        query = query.where(ActivityLog.entity_type == "invoice",ActivityLog.entity_id == invoice_id)
    return [dict(id=str(a.id),action=a.action,actor_id=str(a.actor_id) if a.actor_id else None,
        actor_name=workflow.user_name(adapter,a.actor_id),entity_type=a.entity_type,entity_id=str(a.entity_id),
        invoice_id=str(a.entity_id) if a.entity_type == "invoice" else None,created_at=a.created_at,details=a.after_state)
        for a in db.scalars(query.order_by(ActivityLog.created_at.desc(),ActivityLog.id.desc()))]


@app.get("/api/activity", response_model=list[ActivityView])
def activity(db: DB, role: Role):
    return activity_rows(db,role)


@app.get("/api/invoices/{invoice_id}/timeline", response_model=list[ActivityView])
def timeline(invoice_id: UUID, db: DB, role: Role):
    if db.scalar(select(Invoice.id).where(Invoice.company_id == COMPANY,Invoice.id == invoice_id)) is None:
        raise HTTPException(404,"Invoice not found")
    return activity_rows(db,role,invoice_id)


@app.get('/api/customers/{client_id}/profile', response_model=ProfileView)
def read_customer_profile(client_id: UUID, db: DB, role: Role):
    rule = lock_rule(db,COMPANY)
    profile, client = settings.get_profile(db,COMPANY,adapter,client_id)
    return settings.profile_view(profile,client,rule)

@app.get('/api/settings/rules', response_model=RuleView)
def read_rules(db: DB, role: Role):
    return settings.rule_view(lock_rule(db,COMPANY))

def save_configuration(db, role, data, client_id=None):
    try:
        workspace, invalidated = settings.save_settings(db,COMPANY,adapter,role,data,client_id)
        result = SettingsSaveView(workspace=personalize(db,workspace,role),invalidated_journeys=invalidated)
        commit(db)
        return result
    except Exception:
        db.rollback()
        raise

@app.post('/api/customers/{client_id}/profile', response_model=SettingsSaveView)
def save_customer_profile(client_id: UUID, data: ProfileInput, db: DB, role: Role):
    return save_configuration(db,role,data,client_id)

@app.post('/api/settings/rules', response_model=SettingsSaveView)
def save_rules(data: RulesInput, db: DB, role: Role):
    return save_configuration(db,role,data)


@app.get('/api/invoices/import/template')
def invoice_csv_template(role: Role):
    return Response(csv_import.template(COMPANY,adapter),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="invoice-template.csv"'})

@app.post('/api/invoices/import/preview', response_model=CsvPreview)
def preview_invoice_csv(data: CsvInput, db: DB, role: Role):
    return csv_import.preview(db,COMPANY,adapter,data.csv_text)

@app.post('/api/invoices/import', response_model=CsvImportResult)
def import_invoice_csv(data: CsvInput, db: DB, role: Role):
    try:
        count, workspace = csv_import.import_invoices(db,COMPANY,adapter,role,data.csv_text)
        result = CsvImportResult(imported_count=count,workspace=personalize(db,workspace,role))
        db.commit()
        return result
    except csv_import.InvalidImport as error:
        db.rollback()
        return JSONResponse(status_code=409,content={'detail':'Fix all CSV errors before importing. No invoices were saved.','preview':error.preview.model_dump(mode='json')})
    except IntegrityError:
        db.rollback()
        checked = csv_import.preview(db,COMPANY,adapter,data.csv_text)
        return JSONResponse(status_code=409,content={'detail':'Import conflicted with another write. No invoices were saved. Preview again before importing.','preview':checked.model_dump(mode='json')})
    except Exception:
        db.rollback()
        raise

@app.get('/api/invoices/export/csv')
def export_invoices_csv_endpoint(db: DB, role: Role):
    """Download all non-void invoices as CSV in the import template format."""
    try:
        content = csv_import.export_invoices_csv(db,COMPANY,adapter)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500,'Export failed; try again.')
    return Response(content,media_type='text/csv',headers={'Content-Disposition':f'attachment; filename="invoices-export-{date.today().isoformat()}.csv"'})

@app.get('/api/milestones/unbilled')
def list_unbilled_milestones(db: DB, role: Role):
    """Completed milestones not yet invoiced, oldest completion first (S12)."""
    try:
        candidates = milestones.list_completed_unbilled(COMPANY, db, adapter)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500,'Failed to fetch milestones; try again.')
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch milestones: {e}") from e
    return {"milestones": candidates, "count": len(candidates)}

@app.get('/api/milestones/{milestone_id}/suggest-invoice')
def suggest_invoice_for_milestone(milestone_id: UUID, db: DB, role: Role):
    """Pre-filled invoice data for a completed milestone (S12)."""
    try:
        suggestion = milestones.suggest_invoice(milestone_id, db, adapter)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except LookupError:
        raise HTTPException(404, "Milestone not found") from None
    except Exception as e:
        raise HTTPException(500, f"Failed to generate suggestion: {e}") from e
    return suggestion


@app.post('/api/summaries/generate', response_model=SummaryView)
def generate_weekly_summary(data: SummaryInput, db: DB, role: Role):
    """Calculate the week's metrics in code and attach the narrative (S10, AI-3).

    Regenerating the same week_start replaces that summary in place.
    """
    if data.week_end < data.week_start:
        raise HTTPException(422, "week_end must be on or after week_start")
    try:
        summary_id = summary.generate_summary(COMPANY, data.week_start, data.week_end, role.id, db,
                                              data.language, adapter)
        commit(db)
    except ConfigurationError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from None
    except (SQLAlchemyError, ValueError) as error:
        db.rollback()
        raise HTTPException(500, f"Failed to generate summary: {error}") from error
    return _summary_view(db, summary_id)


@app.get('/api/summaries/{summary_id}', response_model=SummaryView)
def get_weekly_summary(summary_id: UUID, db: DB, role: Role):
    """Retrieve a generated weekly summary."""
    return _summary_view(db, summary_id)


def _summary_view(db: DB, summary_id: UUID) -> SummaryView:
    row = db.get(WeeklySummary, summary_id)
    if row is None or row.company_id != COMPANY:
        raise HTTPException(404, "Summary not found")
    return SummaryView(id=row.id, week_start=row.week_start, week_end=row.week_end, metrics=row.metrics,
                       narrative=row.narrative, written_by=row.written_by, generated_at=row.generated_at)
