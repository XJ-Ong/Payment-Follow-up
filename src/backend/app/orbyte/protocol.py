"""The OrbyteAdapter protocol — the seam between our plugin and Orbyte.

Everything the plugin needs from Orbyte's side of the data (Solution.md
§9.1, Appendix A) is expressed as methods on this Protocol. Services accept
an `OrbyteAdapter`, never a concrete class:

    def build_daily_queue(adapter: OrbyteAdapter, ...) -> ...: ...

The MVP injects MockOrbyteAdapter (fixture JSON, synthetic data). A real
deployment swaps in an HTTP-backed adapter calling Orbyte's APIs — one
constructor change at the wiring layer, no service rewrites. That is what
makes the "fits Orbyte, reusable" claim real (§11.2, rule 1).

Keep this surface minimal: only the reads the services actually perform.
Every method raises LookupError for an unknown id — a missing reference is
a bug to surface loudly, not a None to paper over.
"""

from datetime import date
from typing import Protocol
from uuid import UUID

from .schemas import (
    AppUser,
    ApprovedLeave,
    Client,
    Company,
    Milestone,
    Project,
    PublicHoliday,
)


class OrbyteAdapter(Protocol):
    def get_company(self, company_id: UUID) -> Company:
        """The company (tenant) the plugin is running for."""
        ...

    def get_user(self, user_id: UUID) -> AppUser:
        """One user — approvers, preparers, recipients of alerts."""
        ...

    def list_users(self, company_id: UUID) -> list[AppUser]:
        """Everyone in the company (role switcher, approver candidates)."""
        ...

    def get_client(self, client_id: UUID) -> Client:
        """One customer (Orbyte's client list — names, contacts)."""
        ...

    def list_clients(self, company_id: UUID) -> list[Client]:
        """All customers of the company (dashboard grouping, CSV import)."""
        ...

    def get_project(self, project_id: UUID) -> Project:
        """One project belonging to a client."""
        ...

    def list_projects(self, client_id: UUID) -> list[Project]:
        """Projects of one client."""
        ...

    def get_milestone(self, milestone_id: UUID) -> Milestone:
        """One project milestone (invoice source for S12)."""
        ...

    def list_approved_leave(self, user_id: UUID, on_date: date) -> list[ApprovedLeave]:
        """Approved leave covering `on_date` for `user_id` (S13 routing)."""
        ...

    def list_public_holidays(self, company_id: UUID, start: date, end: date) -> list[PublicHoliday]:
        """Public holidays of the company within [start, end] (S15)."""
        ...
