"""Isolated PostgreSQL fixtures; never mutate the configured development database."""
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text, insert, inspect
from sqlalchemy.orm import Session
import os
# Set before importing app.main (load_dotenv never overrides existing values):
# disable the per-IP rate limiter for the suite (covered explicitly in test_api.py)
# and enable the X-Role simulation (the demo gate has its own dedicated test).
os.environ["RATE_LIMIT_PER_MINUTE"] = "0"
os.environ["DEMO_MODE"] = "true"
from app.main import app, get_db, COMPANY
from app.db.session import engine as source_engine
from app.db.models import FollowupRule, ClientFollowupProfile
from app.db.demo_data import RULES, CLIENT_PROFILES
from app.ids import external_uuid


def seed_reference(engine):
    with Session(engine) as db:
        values = dict(id=uuid4(), company_id=COMPANY, grace_days_by_tier={k.title(): v for k,v in RULES["grace_days"].items()},
            alert_threshold=RULES["alert_threshold"], safety_flag_days=RULES["safety_flag_days"], min_spacing_days=RULES["min_days_between_reminders"], second_approval_amount=RULES["second_approval_amount"], skip_holidays=False, primary_approver_id=external_uuid("USR-02"), backup_approver_id=external_uuid("USR-01"))
        if "owner_approver_id" in {c["name"] for c in inspect(engine).get_columns("followup_rule")}:
            values.update(backup_approver_id=external_uuid("USR-05"),owner_approver_id=external_uuid("USR-01"))
        db.execute(insert(FollowupRule.__table__).values(**values))
        for row in CLIENT_PROFILES:
            db.execute(insert(ClientFollowupProfile.__table__).values(client_id=external_uuid(row["client_id"]), company_id=COMPANY, relationship_tier=row["tier"].title(), preferred_channel={"email": "Email", "whatsapp": "WhatsApp"}[row["preferred_channel"]], language={"en": "English", "bm": "Bahasa Malaysia"}[row["language"]], tone=row["tone"].title(), do_not_contact=row["do_not_contact"]))
        db.commit()


@contextmanager
def database_context(revision="head", reference=True):
    name = "followup_test_" + uuid4().hex
    admin = create_engine(source_engine.url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(source_engine.url.set(database=name))
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["engine"] = engine
    try:
        command.upgrade(config, revision)
        if reference:
            seed_reference(engine)
        yield engine, config
    finally:
        engine.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="module")
def database():
    with database_context() as data:
        yield data


@pytest.fixture
def client(database):
    engine, _ = database
    def db():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
