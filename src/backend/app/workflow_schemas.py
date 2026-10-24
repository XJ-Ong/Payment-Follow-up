from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel, Field

class DraftMutation(BaseModel):
    version: int = Field(ge=1)
    body: str | None = Field(default=None, min_length=1, max_length=10000)
    reason: str = Field(default="Reviewer decision", min_length=1, max_length=1000)
    snooze_until: date | None = None

class ApprovalView(BaseModel):
    id: UUID
    approver_id: UUID
    approver_name: str
    approval_step: int
    decision: str
    decided_at: datetime
    historical: bool

class DraftView(BaseModel):
    id: UUID
    invoice_id: UUID
    invoice_no: str
    version: int
    status: str
    body: str
    channel: str
    language: str
    tone: str
    written_by: str
    ai_model: str | None = None
    prompt_version: str | None = None
    verification_result: dict | None = None
    recipient: str
    prepared_by: UUID | None
    author_name: str
    historical: bool
    is_current: bool
    supersedes_id: UUID | None
    created_at: datetime
    required_approvals: int
    assigned_approver_id: UUID | None
    assigned_approver_name: str | None
    waiting_reason: str | None
    allowed_actions: list[str]
    approvals: list[ApprovalView]

class WorkflowView(BaseModel):
    current: DraftView | None
    latest: DraftView | None
    suppressed_until: date | None
    suppression_reason: str | None

class OutboxView(BaseModel):
    id: UUID
    draft_id: UUID
    invoice_id: UUID
    invoice_no: str
    version: int
    channel: str
    recipient_contact: str
    approved_body: str
    sent_at: datetime
    status: str
    historical: bool

class ActivityView(BaseModel):
    id: UUID
    action: str
    actor_id: UUID | None
    actor_name: str
    entity_type: str
    entity_id: UUID
    invoice_id: UUID | None
    created_at: datetime
    details: dict | None
