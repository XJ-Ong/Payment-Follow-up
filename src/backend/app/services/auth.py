"""Session authentication; browser roles and identity headers are never trusted."""
import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from pwdlib import PasswordHash
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from ..db.auth_models import LoginAccount, LoginSession, LoginThrottle
from ..db.models import ActivityLog
from ..demo_accounts import DEMO_ACCOUNTS, LEGACY_DEMO_ACCOUNTS

COOKIE = 'followup_session'
SESSION_SECONDS = 8 * 60 * 60
HASHER = PasswordHash.recommended()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))


def mode():
    value = os.getenv('AUTH_MODE', 'session').strip().lower()
    if value not in ('session', 'demo'):
        raise RuntimeError('AUTH_MODE must be session or demo')
    return value


def production():
    return os.getenv('APP_ENV', 'development').lower() == 'production'


def allowed_origins():
    raw = os.getenv('APP_ORIGIN', '') if production() else ','.join((
        os.getenv('APP_ORIGIN', ''),
        os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')))
    return {origin.strip().rstrip('/') for origin in raw.split(',') if origin.strip()}


def validate_configuration():
    mode()
    if production():
        if mode() != 'session' or os.getenv('DEMO_MODE', '').lower() in ('true', '1', 'yes'):
            raise RuntimeError('Production requires AUTH_MODE=session and DEMO_MODE=false')
        origin = os.getenv('APP_ORIGIN', '')
        if not re.fullmatch(r'https://[A-Za-z0-9.-]+(?::\d+)?', origin):
            raise RuntimeError('Production requires APP_ORIGIN to be the public HTTPS origin')


def normalize_email(email):
    email = email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+', email):
        raise ValueError('Enter a valid email address')
    return email


def password_hash(password):
    if not 12 <= len(password) <= 128:
        raise ValueError('Passwords must contain 12 to 128 characters')
    return HASHER.hash(password)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def validate_origin(request):
    if request.headers.get('origin') not in allowed_origins():
        raise HTTPException(403, 'Request origin is not allowed')
    if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
        raise HTTPException(415, 'JSON requests are required')


def staff_for(account, adapter, company):
    try:
        staff = adapter.get_user(account.staff_id)
    except LookupError:
        return None
    if account.company_id != company or staff.company_id != company or staff.role not in ('owner', 'finance'):
        return None
    return staff


def is_demo_account(account):
    """Only recognize intact seeded credentials; never disclose a changed password."""
    candidate = next((row for row in (*DEMO_ACCOUNTS, *LEGACY_DEMO_ACCOUNTS) if row['email'] == account.email), None)
    return bool(candidate and HASHER.verify(candidate['password'], account.password_hash))


def authenticate(db, request, adapter, company, *, mutation=True):
    token = request.cookies.get(COOKIE, '')
    session = db.get(LoginSession, digest(token)) if 20 <= len(token) <= 128 else None
    now = datetime.now(timezone.utc)
    if session is None or session.expires_at <= now:
        raise HTTPException(401, 'Sign in to continue')
    account = db.get(LoginAccount, session.account_id)
    staff = staff_for(account, adapter, company) if account and account.enabled and not (production() and is_demo_account(account)) else None
    if staff is None:
        raise HTTPException(401, 'Sign in to continue')
    if mutation and request.method not in ('GET', 'HEAD', 'OPTIONS'):
        validate_origin(request)
        if not secrets.compare_digest(request.headers.get('x-csrf-token', '').encode(), session.csrf_token.encode()):
            raise HTTPException(403, 'Invalid request token; reload and try again')
    return staff, session


def view(staff, session):
    return dict(user=dict(id=str(staff.id), name=staff.name, role='Owner' if staff.role == 'owner' else 'Finance'),
                csrf_token=session.csrf_token)


def login(db, email, password, adapter, company):
    now = datetime.now(timezone.utc)
    valid_email = True
    try:
        email = normalize_email(email)
    except ValueError:
        # Invalid and unknown addresses use the same outward failure.
        email = email.strip().lower()
        valid_email = False
    key = digest(email)
    db.execute(insert(LoginThrottle).values(identifier_hash=key, window_start=now, failures=0)
               .on_conflict_do_nothing(index_elements=['identifier_hash']))
    throttle = db.scalar(select(LoginThrottle).where(LoginThrottle.identifier_hash == key).with_for_update())
    if now - throttle.window_start >= timedelta(minutes=15):
        throttle.window_start, throttle.failures = now, 0
    if throttle.failures >= 5:
        db.commit()
        raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.', headers={'Retry-After': '900'})
    account = db.scalar(select(LoginAccount).where(LoginAccount.email == email).with_for_update()) if valid_email else None
    valid_password = HASHER.verify(password, account.password_hash if account else DUMMY_HASH)
    if production() and account and is_demo_account(account):
        valid_password = False
    staff = staff_for(account, adapter, company) if account and account.enabled and valid_password else None
    if staff is None:
        throttle.failures += 1
        db.commit()
        raise HTTPException(401, 'Invalid email or password')
    throttle.failures = 0
    token = secrets.token_urlsafe(32)
    session = LoginSession(token_hash=digest(token), account_id=account.id,
                           csrf_token=secrets.token_urlsafe(32), expires_at=now + timedelta(seconds=SESSION_SECONDS))
    db.execute(delete(LoginSession).where(LoginSession.expires_at <= now))
    db.add(session)
    db.add(ActivityLog(id=uuid4(), company_id=company, actor_type='user', actor_id=staff.id,
                       action='auth.login', entity_type='user', entity_id=staff.id))
    db.commit()
    return token, staff, session


def revoke_sessions(db, account_id):
    db.execute(delete(LoginSession).where(LoginSession.account_id == account_id))


def provision(db, adapter, company, staff_id, email, password):
    staff = adapter.get_user(staff_id)
    if staff.company_id != company or staff.role not in ('owner', 'finance'):
        raise ValueError('Only existing Owner or Finance staff can receive accounts')
    account = LoginAccount(id=uuid4(), company_id=company, staff_id=staff.id,
                           email=normalize_email(email), password_hash=password_hash(password), enabled=True)
    db.add(account)
    db.commit()
    return account


def reset_password(db, account, password):
    account.password_hash = password_hash(password)
    revoke_sessions(db, account.id)
    db.add(ActivityLog(id=uuid4(), company_id=account.company_id, actor_type='system',
                       action='auth.password_reset', entity_type='user', entity_id=account.staff_id))
    db.execute(delete(LoginThrottle).where(LoginThrottle.identifier_hash == digest(account.email)))
    db.commit()


def disable(db, account):
    account.enabled = False
    revoke_sessions(db, account.id)
    db.add(ActivityLog(id=uuid4(), company_id=account.company_id, actor_type='system',
                       action='auth.account_disabled', entity_type='user', entity_id=account.staff_id))
    db.commit()
