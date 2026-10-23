"""Integration tests use an isolated PostgreSQL database, removed afterwards."""
from pathlib import Path
from uuid import uuid4
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.main import app, get_db, COMPANY, adapter
from app.db.session import engine as source_engine

@pytest.fixture(scope="module")
def database():
    name = "followup_test_" + uuid4().hex
    admin = create_engine(source_engine.url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(source_engine.url.set(database=name))
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["engine"] = engine
    try:
        command.upgrade(config, "head")
        yield engine, config
    finally:
        engine.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()

@pytest.fixture
def client(database):
    engine, _ = database
    def db():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()

def payload():
    return dict(invoice_no="TEST-" + uuid4().hex[:8], client_id=str(adapter.list_clients(COMPANY)[0].id), issue_date="2026-10-01", due_date="2026-10-23", total_amount="100.10", initial_payment="10.00")

@pytest.mark.parametrize("role", [None, "Preparer", "Other Staff", "invalid"])
def test_permissions(client, role):
    headers = {} if role is None else {"X-Role": role}
    assert client.get("/api/invoices", headers=headers).status_code == 403
    assert client.post("/api/invoices", json=payload(), headers=headers).status_code == 403

@pytest.mark.parametrize("role", ["Owner", "Finance"])
def test_payment_journey(client, role):
    headers = {"X-Role": role}
    data = payload()
    created = client.post("/api/invoices", headers=headers, json=data)
    assert created.status_code == 201, created.text
    invoice = created.json()
    assert invoice["outstanding_amount"] == "90.10"
    assert client.post("/api/invoices", headers=headers, json=data).status_code == 409
    path = f'/api/invoices/{invoice["id"]}/payments'
    assert client.post(path, headers={"X-Role": "Other Staff"}, json={"amount": "1", "received_date": "2026-10-23"}).status_code == 403
    for amount, code in [("91.00", 422), ("0", 422), ("0.001", 422), ("NaN", 422), ("30.10", 201), ("60.00", 201)]:
        response = client.post(path, headers=headers, json={"amount": amount, "received_date": "2026-10-23"})
        assert response.status_code == code, response.text
    saved = next(row for row in client.get("/api/invoices", headers=headers).json()["invoices"] if row["id"] == invoice["id"])
    assert saved["payments"] == "100.10"
    assert saved["outstanding_amount"] == "0.00"
    assert saved["status"] == "paid"

@pytest.mark.parametrize("changes", [{"due_date": "2026-09-30"}, {"client_id": str(uuid4())}, {"initial_payment": "101.00"}, {"total_amount": "0"}, {"invoice_no": "   "}])
def test_validation(client, changes):
    assert client.post("/api/invoices", headers={"X-Role": "Finance"}, json=payload() | changes).status_code == 422

def test_health_and_missing(client):
    health = client.get("/api/health")
    assert health.json() == {"status": "ok"}
    assert health.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    assert health.headers["referrer-policy"] == "no-referrer"
    assert health.headers["permissions-policy"] == "camera=(), geolocation=(), microphone=()"
    assert "strict-transport-security" not in health.headers
    assert client.post(f"/api/invoices/{uuid4()}/payments", headers={"X-Role": "Finance"}, json={"amount": "1", "received_date": "2026-10-23"}).status_code == 404

def test_existing_baseline(database):
    engine, config = database
    with engine.begin() as c:
        before = c.scalar(text("SELECT count(*) FROM invoice"))
        c.execute(text("DELETE FROM alembic_version"))
    command.upgrade(config, "head")
    with engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM invoice")) == before

def test_schema_drift(database):
    engine, config = database
    with engine.begin() as c:
        c.execute(text("DELETE FROM alembic_version"))
        c.execute(text("ALTER TABLE invoice ADD COLUMN unexpected text"))
    try:
        with pytest.raises(RuntimeError, match="differs from baseline"):
            command.upgrade(config, "head")
    finally:
        with engine.begin() as c:
            c.execute(text("ALTER TABLE invoice DROP COLUMN unexpected"))
        command.upgrade(config, "head")


def test_concurrent_payment_rechecks_locked_balance(client):
    from concurrent.futures import ThreadPoolExecutor
    headers = {"X-Role": "Finance"}
    invoice = client.post("/api/invoices", headers=headers, json=payload() | {"initial_payment": "0.00"}).json()
    def pay(_):
        return client.post(f'/api/invoices/{invoice["id"]}/payments', headers=headers, json={"amount": "80.00", "received_date": "2026-10-23"}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(pay, range(2))) == [201, 422]


def test_tenant_isolation(client, database):
    from datetime import date
    from decimal import Decimal
    from app.db.models import Invoice
    engine, _ = database
    other_id = uuid4()
    with Session(engine) as session:
        session.add(Invoice(id=other_id, company_id=uuid4(), client_id=uuid4(), invoice_no="OTHER-COMPANY", issue_date=date(2026,10,1), due_date=date(2026,10,23), total_amount=Decimal("100"), source="manual"))
        session.commit()
    headers = {"X-Role": "Owner"}
    assert all(row["id"] != str(other_id) for row in client.get("/api/invoices", headers=headers).json()["invoices"])
    assert client.post(f"/api/invoices/{other_id}/payments", headers=headers, json={"amount": "1", "received_date": "2026-10-23"}).status_code == 404


@pytest.mark.skipif(not __import__('os').environ.get("RUN_BROWSER_TESTS"), reason="Set RUN_BROWSER_TESTS=1 for browser integration")
def test_browser_persistence(database):
    import subprocess
    import threading
    import time
    import uvicorn
    from app.main import app, get_db
    engine, _ = database
    def db():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = db
    from fastapi.middleware.cors import CORSMiddleware
    # The test frontend has its own origin; production origins remain environment configured.
    test_app = CORSMiddleware(app, allow_origins=["http://127.0.0.1:5188"], allow_methods=["GET", "POST"], allow_headers=["X-Role", "Content-Type"])
    server = uvicorn.Server(uvicorn.Config(test_app, host="127.0.0.1", port=8001, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    frontend = None
    try:
        deadline = time.monotonic() + 15
        while not server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("Test API startup timed out")
            time.sleep(.05)
        root = Path(__file__).resolve().parents[3]
        import os
        import urllib.request
        frontend = subprocess.Popen(["node", str(root / "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5188", "--strictPort"], cwd=root, env=os.environ | {"VITE_DATA_MODE": "api", "VITE_API_URL": "http://127.0.0.1:8001"})
        deadline = time.monotonic() + 30
        while True:
            try:
                urllib.request.urlopen("http://127.0.0.1:5188", timeout=1).close()
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError("Test frontend startup timed out")
                time.sleep(.1)
        subprocess.run(["node", str(root / "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.api.config.ts"], cwd=root, check=True, timeout=120)
    finally:
        if frontend is not None:
            frontend.terminate()
            frontend.wait(timeout=10)
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()
