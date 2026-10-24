"""Real session authentication against an isolated migrated PostgreSQL database."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.main import app, adapter, COMPANY, get_db, get_role
from app.db.auth_models import LoginAccount, LoginSession, LoginThrottle
from app.db.models import ActivityLog
from app.ids import external_uuid
from app.services import auth

PASSWORD = 'a-private-test-password-123'
ORIGIN = {'Origin': 'http://testserver'}


@pytest.fixture
def authenticated_world(database, monkeypatch):
    engine, _ = database
    monkeypatch.setenv('AUTH_MODE', 'session')
    monkeypatch.setenv('DEMO_MODE', 'false')
    monkeypatch.setenv('APP_ORIGIN', 'http://testserver')
    with Session(engine) as db:
        for table in (LoginSession, LoginThrottle, LoginAccount):
            db.execute(delete(table))
        db.commit()
        auth.provision(db, adapter, COMPANY, external_uuid('USR-01'), 'owner@example.test', PASSWORD)
        auth.provision(db, adapter, COMPANY, external_uuid('USR-02'), 'finance@example.test', PASSWORD)
    def connection():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = connection
    try:
        with TestClient(app) as client:
            yield client, engine
    finally:
        app.dependency_overrides.clear()


def sign_in(client, email='owner@example.test', password=PASSWORD):
    return client.post('/api/auth/login', headers=ORIGIN, json={'email': email, 'password': password})


def mutation_headers(client):
    return ORIGIN | {'X-CSRF-Token': client.get('/api/auth/me').json()['csrf_token']}


def test_private_api_and_spoofed_headers(authenticated_world):
    client, _ = authenticated_world
    for path in ('/api/invoices', '/api/users', '/api/followups', '/api/settings/rules', '/api/outbox', '/api/activity', '/api/audit'):
        response = client.get(path, headers={'X-Role': 'Owner', 'X-User-Id': str(external_uuid('USR-01'))})
        assert response.status_code == 401, response.text
    assert client.post('/api/ai-test').status_code == 401
    assert client.get('/api/health').json() == {'status': 'ok'}


def test_login_normalization_cookie_persistence_and_identity(authenticated_world):
    client, engine = authenticated_world
    response = sign_in(client, ' OWNER@EXAMPLE.TEST ')
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['user']['id'] == str(external_uuid('USR-01'))
    assert data['user']['role'] == 'Owner'
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie and 'max-age=28800' in cookie
    assert 'secure' not in cookie
    assert response.headers['cache-control'] == 'no-store'
    assert PASSWORD not in response.text
    token = client.cookies.get(auth.COOKIE)
    with Session(engine) as db:
        session = db.scalar(select(LoginSession))
        assert session.token_hash == auth.digest(token) and session.token_hash != token
        account = db.scalar(select(LoginAccount).where(LoginAccount.email == 'owner@example.test'))
        assert account.password_hash.startswith('$argon2') and PASSWORD not in account.password_hash
        event = db.scalar(select(ActivityLog).where(ActivityLog.action == 'auth.login'))
        assert event.actor_id == external_uuid('USR-01')
    # A new HTTP client / application lifespan uses the same database session.
    with TestClient(app) as second:
        second.cookies.set(auth.COOKIE, token)
        assert second.get('/api/auth/me').json() == data
        assert second.get('/api/invoices').status_code == 200


def test_invalid_credentials_are_generic_and_throttled(authenticated_world):
    client, engine = authenticated_world
    unknown = sign_in(client, 'missing@example.test', 'wrong password').json()
    assert sign_in(client, password='wrong password').json() == unknown
    assert sign_in(client, 'bad\x00@example.test', 'wrong password').json() == unknown
    for _ in range(4):
        assert sign_in(client, password='wrong password').status_code == 401
    assert sign_in(client).status_code == 429
    with Session(engine) as db:
        row = db.get(LoginThrottle, auth.digest('owner@example.test'))
        row.window_start = datetime.now(timezone.utc) - timedelta(minutes=16)
        db.commit()
    assert sign_in(client).status_code == 200


def test_csrf_origin_and_finance_role_are_enforced(authenticated_world):
    client, _ = authenticated_world
    assert client.post('/api/auth/login', json={'email': 'owner@example.test', 'password': PASSWORD}).status_code == 403
    assert sign_in(client, 'finance@example.test').status_code == 200
    assert client.get('/api/auth/me', headers={'X-Role': 'Owner'}).json()['user']['role'] == 'Finance'
    for headers in (ORIGIN, {'Origin': 'https://evil.test', 'X-CSRF-Token': mutation_headers(client)['X-CSRF-Token']}, ORIGIN | {'X-CSRF-Token': 'wrong'}):
        assert client.post('/api/followups/refresh', json={}, headers=headers).status_code == 403
    response = client.post('/api/followups/refresh', json={}, headers=mutation_headers(client))
    assert response.status_code == 200, response.text
    assert client.post('/api/ai-test', json={}, headers=mutation_headers(client)).status_code == 403
    response = client.post('/api/settings/rules', json={
        'revision': 1, 'grace_days_by_tier': {'New': 0, 'Regular': 7, 'Key': 14},
        'alert_threshold': '1000', 'safety_flag_days': 30, 'min_spacing_days': 3,
        'skip_holidays': False, 'second_approval_amount': '1000',
    }, headers=mutation_headers(client) | {'X-Role': 'Owner'})
    assert response.status_code == 403


def test_logout_rotation_and_expiry(authenticated_world):
    client, engine = authenticated_world
    assert sign_in(client).status_code == 200
    previous = client.cookies.get(auth.COOKIE)
    assert sign_in(client).status_code == 200
    assert client.cookies.get(auth.COOKIE) != previous
    with Session(engine) as db:
        assert db.get(LoginSession, auth.digest(previous)) is None
    assert client.post('/api/auth/logout', json={}, headers=mutation_headers(client)).status_code == 204
    assert client.get('/api/auth/me').status_code == 401
    assert sign_in(client).status_code == 200
    with Session(engine) as db:
        session = db.get(LoginSession, auth.digest(client.cookies.get(auth.COOKIE)))
        session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.get('/api/invoices').status_code == 401


def test_reset_disable_and_account_validation(authenticated_world):
    client, engine = authenticated_world
    assert sign_in(client).status_code == 200
    with Session(engine) as db:
        account = db.scalar(select(LoginAccount).where(LoginAccount.email == 'owner@example.test'))
        with pytest.raises(ValueError):
            auth.password_hash('short')
        with pytest.raises(ValueError):
            auth.password_hash('x' * 129)
        with pytest.raises(ValueError):
            auth.provision(db, adapter, COMPANY, external_uuid('USR-03'), 'staff@example.test', PASSWORD)
        auth.reset_password(db, account, PASSWORD + '-new')
    assert client.get('/api/auth/me').status_code == 401
    assert sign_in(client).status_code == 401
    assert sign_in(client, password=PASSWORD + '-new').status_code == 200
    with Session(engine) as db:
        account = db.scalar(select(LoginAccount).where(LoginAccount.email == 'owner@example.test'))
        auth.disable(db, account)
    assert client.get('/api/auth/me').status_code == 401
    assert sign_in(client, password=PASSWORD + '-new').status_code == 401


def test_secure_cookie_production_config_and_login_redaction(authenticated_world, monkeypatch):
    client, _ = authenticated_world
    marker = 'SENSITIVE' * 40
    response = client.post('/api/auth/login', headers=ORIGIN, json={'email': 'owner@example.test', 'password': marker})
    assert response.status_code == 422 and marker not in response.text
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('APP_ORIGIN', 'https://testserver')
    auth.validate_configuration()
    response = client.post('/api/auth/login', headers={'Origin': 'https://testserver'}, json={'email': 'owner@example.test', 'password': PASSWORD})
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie']
    monkeypatch.setenv('AUTH_MODE', 'demo')
    with pytest.raises(RuntimeError, match='Production requires'):
        with TestClient(app):
            pass
    monkeypatch.setenv('AUTH_MODE', 'session')
    monkeypatch.setenv('DEMO_MODE', 'true')
    with pytest.raises(RuntimeError, match='Production requires'):
        auth.validate_configuration()


def test_all_business_routes_require_identity():
    for route in app.routes:
        if not getattr(route, 'path', '').startswith('/api/') or route.path.startswith('/api/auth/') or route.path == '/api/health':
            continue
        assert any(dependency.call == get_role for dependency in route.dependant.dependencies), route.path


def test_spa_and_api_fallback(authenticated_world):
    client, _ = authenticated_world
    response = client.get('/')
    assert response.status_code == 200
    assert 'text/html' in response.headers['content-type']
    assert "script-src 'self'" in response.headers['content-security-policy']
    assert client.get('/login').status_code == 200
    assert client.get('/api/not-a-route').status_code == 404
    assert client.get('/assets/not-a-file.js').status_code == 404


def test_account_commands_prompt_privately_and_revoke_access(authenticated_world, monkeypatch, capsys):
    from app import manage_accounts
    client, engine = authenticated_world
    monkeypatch.setattr(manage_accounts, 'SessionLocal', lambda: Session(engine))
    monkeypatch.setattr(manage_accounts, 'getpass', lambda _: PASSWORD)
    monkeypatch.setattr('sys.argv', ['manage_accounts', 'provision', '--staff', 'USR-05', '--email', 'backup@example.test'])
    manage_accounts.main()
    assert PASSWORD not in capsys.readouterr().out

    assert sign_in(client, 'backup@example.test').status_code == 200
    monkeypatch.setattr('sys.argv', ['manage_accounts', 'list-staff'])
    manage_accounts.main()
    output = capsys.readouterr().out
    assert 'backup@example.test' in output and PASSWORD not in output
    monkeypatch.setattr('sys.argv', ['manage_accounts', 'reset-password', '--email', 'backup@example.test'])
    manage_accounts.main()
    assert client.get('/api/auth/me').status_code == 401
    assert sign_in(client, 'backup@example.test').status_code == 200
    monkeypatch.setattr('sys.argv', ['manage_accounts', 'disable', '--email', 'backup@example.test'])
    manage_accounts.main()
    assert client.get('/api/auth/me').status_code == 401
    assert PASSWORD not in capsys.readouterr().out


def test_demo_seed_is_repeatable_and_preserves_private_accounts(authenticated_world):
    from app.manage_accounts import seed_users
    from app.demo_accounts import DEMO_ACCOUNTS
    client, engine = authenticated_world
    with Session(engine) as db:
        original = db.scalar(select(LoginAccount).where(LoginAccount.email == 'owner@example.test')).password_hash
        seed_users(db, adapter, COMPANY)
        seed_users(db, adapter, COMPANY)
        assert len(db.scalars(select(LoginAccount)).all()) == 3
        assert db.scalar(select(LoginAccount).where(LoginAccount.email == 'owner@example.test')).password_hash == original
    accounts = client.get('/api/auth/demo-accounts').json()['accounts']
    assert [row['label'] for row in accounts] == ['Owner', 'Backup Finance']
    assert accounts[0] == {'label': 'Owner', 'email': 'owner@example.test', 'password': None}
    backup = DEMO_ACCOUNTS[2]
    assert sign_in(client, backup['email'], backup['password']).status_code == 200
    assert client.get('/api/auth/me').json()['user']['role'] == 'Finance'
    with Session(engine) as db:
        account = db.scalar(select(LoginAccount).where(LoginAccount.email == backup['email']))
        auth.reset_password(db, account, PASSWORD)
        seed_users(db, adapter, COMPANY)
    assert client.get('/api/auth/demo-accounts').json()['accounts'] == [{'label': 'Owner', 'email': 'owner@example.test', 'password': None}]
    assert sign_in(client, backup['email'], PASSWORD).status_code == 200


def test_fresh_demo_accounts_and_production_guard(authenticated_world, monkeypatch):
    from app.manage_accounts import seed_users
    from app.demo_accounts import DEMO_ACCOUNTS
    client, engine = authenticated_world
    with Session(engine) as db:
        db.execute(delete(LoginSession))
        db.execute(delete(LoginAccount))
        db.commit()
        assert all(status == 'created' for _, status in seed_users(db, adapter, COMPANY))
    assert len(client.get('/api/auth/demo-accounts').json()['accounts']) == 3
    owner = DEMO_ACCOUNTS[0]
    assert sign_in(client, owner['email'], owner['password']).status_code == 200
    assert client.get('/api/auth/me').json()['user']['role'] == 'Owner'
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('APP_ORIGIN', 'https://testserver')
    assert client.get('/api/auth/demo-accounts').json()['accounts'] == []
    assert client.get('/api/auth/me').status_code == 401
    response = client.post('/api/auth/login', headers={'Origin': 'https://testserver'}, json={'email': owner['email'], 'password': owner['password']})
    assert response.status_code == 401
    with Session(engine) as db:
        with pytest.raises(ValueError, match='disabled in production'):
            seed_users(db, adapter, COMPANY)
