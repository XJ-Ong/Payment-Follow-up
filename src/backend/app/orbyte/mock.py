"""MockOrbyteAdapter — the MVP stand-in for Orbyte's APIs.

Implements the OrbyteAdapter protocol over the inlined synthetic world in
app/orbyte/fixture.py (1 company, 5 users, 10 clients, 6 projects,
4 milestones, 1 leave record, 2 holidays). Same conventions as seed.py:

- External codes ("CLI-02") become uuids via app.ids.external_uuid, so the
  ids in the fixture match the uuids our database already stores.
- Dates are stored as day offsets and materialised against today, so the
  fixture stays valid whenever the demo runs.
- Fixture quirks (snake keys like "client_id", string money) are
  absorbed here; services only ever see the clean pydantic shapes.

This class is the only place that knows the fixture layout. When a real
Orbyte HTTP adapter replaces it, nothing outside this class changes.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from decimal import Decimal
from uuid import UUID

from ..ids import external_uuid
from .fixture import FIXTURE
from .schemas import (
    AppUser,
    ApprovedLeave,
    Client,
    Company,
    Milestone,
    Project,
    PublicHoliday,
)


class MockOrbyteAdapter:
    """Read-only Orbyte simulation backed by one inlined fixture.

    demo_leave_active: the fixture marks its single leave record
    inactive by default (active_in_demo_by_default=False) so the normal
    demo runs with nobody on leave. Pass demo_leave_active=True to
    activate it and exercise S13 backup-approver routing.
    """

    def __init__(self, *, demo_leave_active: bool = False, demo_owner_leave_active: bool = False, reference_date: date | None = None) -> None:
        today = reference_date or datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Kuala_Lumpur")).date()
        company_id = external_uuid(FIXTURE["company"]["id"])
        self._company = Company(id=company_id, name=FIXTURE["company"]["name"])

        self._users: dict[UUID, AppUser] = {}
        for row in FIXTURE["users"]:
            user = AppUser(
                id=external_uuid(row["id"]),
                company_id=company_id,
                name=row["name"],
                email=row.get("email"),
                department=row.get("department"),
                reports_to=external_uuid(row["reports_to"]) if row.get("reports_to") else None,
                role=row["role"],
            )
            self._users[user.id] = user

        self._clients: dict[UUID, Client] = {}
        for row in FIXTURE["clients"]:
            client = Client(
                id=external_uuid(row["client_id"]),
                company_id=company_id,
                name=row["name"],
                trade=row.get("trade"),
                contact_name=row.get("contact_name"),
                phone=row.get("phone"),
                email=row.get("email"),
            )
            self._clients[client.id] = client

        self._projects: dict[UUID, Project] = {}
        for row in FIXTURE["projects"]:
            project = Project(
                id=external_uuid(row["id"]),
                client_id=external_uuid(row["client_id"]),
                name=row["name"],
                status=row["status"],
                owner_id=external_uuid(row["owner_id"]) if row.get("owner_id") else None,
                contract_value=(
                    Decimal(row["contract_value"])
                    if row.get("contract_value") is not None
                    else None
                ),
                payment_terms=row.get("payment_terms"),
            )
            self._projects[project.id] = project

        self._milestones: dict[UUID, Milestone] = {}
        for row in FIXTURE["milestones"]:
            milestone = Milestone(
                id=external_uuid(row["id"]),
                project_id=external_uuid(row["project_id"]),
                name=row["name"],
                amount=Decimal(row["amount"]) if row.get("amount") is not None else None,
                due_date=(
                    today + timedelta(days=row["due_offset_days"])
                    if row.get("due_offset_days") is not None
                    else None
                ),
                completed_date=(
                    today + timedelta(days=row["completed_offset_days"])
                    if row.get("completed_offset_days") is not None
                    else None
                ),
            )
            self._milestones[milestone.id] = milestone

        # Inactive fixture data stays hidden unless explicitly activated.
        self._leaves: list[ApprovedLeave] = []
        for row in FIXTURE["approved_leave"]:
            active = row.get("active_in_demo_by_default", False) or (demo_leave_active and row["user_id"] == "USR-02") or (demo_owner_leave_active and row["user_id"] == "USR-01")
            if not active:
                continue
            self._leaves.append(
                ApprovedLeave(
                    user_id=external_uuid(row["user_id"]),
                    from_date=today + timedelta(days=row["from_offset_days"]),
                    to_date=today + timedelta(days=row["to_offset_days"]),
                    backup_approver_id=(
                        external_uuid(row["backup_approver_id"])
                        if row.get("backup_approver_id")
                        else None
                    ),
                )
            )

        self._holidays: list[PublicHoliday] = []
        for row in FIXTURE["public_holidays"]:
            self._holidays.append(
                PublicHoliday(date=today + timedelta(days=row["offset_days"]), name=row["name"])
            )

    # ---- OrbyteAdapter protocol ----

    def get_company(self, company_id: UUID) -> Company:
        if company_id != self._company.id:
            raise LookupError(f"unknown company {company_id}")
        return self._company

    def get_user(self, user_id: UUID) -> AppUser:
        try:
            return self._users[user_id]
        except KeyError:
            raise LookupError(f"unknown user {user_id}") from None

    def list_users(self, company_id: UUID) -> list[AppUser]:
        self._check_company(company_id)
        return list(self._users.values())

    def get_client(self, client_id: UUID) -> Client:
        try:
            return self._clients[client_id]
        except KeyError:
            raise LookupError(f"unknown client {client_id}") from None

    def list_clients(self, company_id: UUID) -> list[Client]:
        self._check_company(company_id)
        return list(self._clients.values())

    def get_project(self, project_id: UUID) -> Project:
        try:
            return self._projects[project_id]
        except KeyError:
            raise LookupError(f"unknown project {project_id}") from None

    def list_projects(self, client_id: UUID) -> list[Project]:
        return [p for p in self._projects.values() if p.client_id == client_id]

    def get_milestone(self, milestone_id: UUID) -> Milestone:
        try:
            return self._milestones[milestone_id]
        except KeyError:
            raise LookupError(f"unknown milestone {milestone_id}") from None

    def list_milestones(self, project_id: UUID) -> list[Milestone]:
        return [m for m in self._milestones.values() if m.project_id == project_id]

    def list_approved_leave(self, user_id: UUID, on_date: date) -> list[ApprovedLeave]:
        return [
            lv
            for lv in self._leaves
            if lv.user_id == user_id and lv.from_date <= on_date <= lv.to_date
        ]

    def list_public_holidays(self, company_id: UUID, start: date, end: date) -> list[PublicHoliday]:
        self._check_company(company_id)
        return [h for h in self._holidays if start <= h.date <= end]

    # ---- Internal helpers ----

    def _check_company(self, company_id: UUID) -> None:
        if company_id != self._company.id:
            raise LookupError(f"unknown company {company_id}")
