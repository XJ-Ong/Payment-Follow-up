"""Read-only audit API contracts. Historical values are never reconstructed."""
from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel


class AuditSummary(BaseModel):
    id: UUID
    action: str
    actor_id: UUID | None
    actor_name: str
    actor_type: str
    entity_type: str
    entity_id: UUID
    invoice_number: str | None
    customer_name: str | None
    created_at: datetime
    summary: str


class AuditDetail(AuditSummary):
    before_state: dict[str, Any] | None
    after_state: dict[str, Any] | None
    metadata: dict[str, Any] | None


class AuditActor(BaseModel):
    id: UUID | None
    name: str


class AuditPage(BaseModel):
    items: list[AuditSummary]
    total: int
    page: int
    page_size: int = 25
    actors: list[AuditActor]
    actions: list[str]
