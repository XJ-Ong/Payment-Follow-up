"""Pydantic shapes for the seven Orbyte-owned entities (Solution.md Appendix A).

These models are the contract between our plugin and Orbyte's side of the
data. The MVP backs them with the in-app fixture (app/orbyte/fixture.py)
through MockOrbyteAdapter; a real deployment would back the same shapes
with HTTP calls to Orbyte's API. Services depend on these shapes and the
adapter protocol, never on the fixture itself.

By the time a fixture row becomes one of these models, MockOrbyteAdapter has
already translated external codes ("CLI-02") to uuids and materialised the
fixture's day offsets into real dates — so the fields below are plain uuids,
Decimals and dates.
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AdapterModel(BaseModel):
    """Frozen: adapter entities are reference data, never mutated."""

    model_config = ConfigDict(frozen=True)


# --- Company ---
class Company(AdapterModel):
    id: UUID
    name: str


# --- Users ---
class AppUser(AdapterModel):
    id: UUID
    company_id: UUID
    name: str
    email: str | None = None
    department: str | None = None
    reports_to: UUID | None = None
    role: str  # fixture codes: owner, finance, other_staff


# --- Clients ---
class Client(AdapterModel):
    id: UUID
    company_id: UUID
    name: str
    trade: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None


# --- Projects ---
class Project(AdapterModel):
    id: UUID
    client_id: UUID
    name: str
    status: str  # in_progress, completed
    owner_id: UUID | None = None
    contract_value: Decimal | None = None
    payment_terms: int | None = None  # days


# --- Milestones ---
# The fixture's "invoiced" flag is deliberately not carried over: whether a
# milestone is already invoiced is answered by OUR invoice table (invoice
# .milestone_id), which stays the single source of truth for S12 suggestions.
class Milestone(AdapterModel):
    id: UUID
    project_id: UUID
    name: str
    amount: Decimal | None = None
    due_date: date | None = None
    completed_date: date | None = None


# --- Approved leave ---
class ApprovedLeave(AdapterModel):
    user_id: UUID
    from_date: date
    to_date: date
    backup_approver_id: UUID | None = None


# --- Public holidays ---
class PublicHoliday(AdapterModel):
    date: date
    name: str
