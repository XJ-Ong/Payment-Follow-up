"""Private account administration: python -m app.manage_accounts --help."""
import argparse
from getpass import getpass
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db.auth_models import LoginAccount
from .db.session import SessionLocal
from .ids import external_uuid
from .orbyte.mock import MockOrbyteAdapter
from .services import auth
from .demo_accounts import DEMO_ACCOUNTS


def seed_users(db, adapter, company):
    if auth.production():
        raise ValueError('Demo user seeding is disabled in production')
    results = []
    for row in DEMO_ACCOUNTS:
        staff_id = external_uuid(row['staff'])
        staff = adapter.get_user(staff_id)
        if staff.company_id != company or staff.role not in ('owner', 'finance'):
            raise ValueError('Demo staff does not belong to this workspace')
        existing = db.scalar(select(LoginAccount).where(
            (LoginAccount.email == row['email']) |
            ((LoginAccount.company_id == company) & (LoginAccount.staff_id == staff_id))))
        if existing is not None:
            results.append((row['label'], 'preserved existing account'))
            continue
        db.add(LoginAccount(id=uuid4(), company_id=company, staff_id=staff_id,
                            email=row['email'], password_hash=auth.password_hash(row['password']), enabled=True))
        db.flush()
        results.append((row['label'], 'created'))
    db.commit()
    return results


def main():
    parser = argparse.ArgumentParser(description='Manage private team login accounts')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list-staff')
    sub.add_parser('seed-users', help='Create missing local demo logins without overwriting existing staff accounts')
    create = sub.add_parser('provision')
    create.add_argument('--staff', required=True, help='Existing staff UUID or USR-01 style code')
    create.add_argument('--email', required=True)
    for name in ('reset-password', 'disable'):
        sub.add_parser(name).add_argument('--email', required=True)
    args = parser.parse_args()
    adapter, company = MockOrbyteAdapter(), external_uuid('COMP-01')
    with SessionLocal() as db:
        try:
            if args.command == 'seed-users':
                for label, result in seed_users(db, adapter, company):
                    print(f'{label}: {result}')
                print('Active demo credentials appear at the bottom of the local login page.')
                return
            if args.command == 'list-staff':
                for staff in adapter.list_users(company):
                    if staff.role in ('owner', 'finance'):
                        account = db.scalar(select(LoginAccount).where(LoginAccount.staff_id == staff.id, LoginAccount.company_id == company))
                        print(staff.id, staff.name, staff.role, account.email if account else '(no login)',
                              'enabled' if account and account.enabled else 'disabled' if account else '')
                return
            if args.command == 'provision':
                staff_id = external_uuid(args.staff) if args.staff.startswith('USR-') else UUID(args.staff)
                password = getpass('New password (12-128 characters): ')
                if password != getpass('Confirm password: '):
                    raise ValueError('Passwords do not match')
                auth.provision(db, adapter, company, staff_id, args.email, password)
            else:
                account = db.scalar(select(LoginAccount).where(LoginAccount.email == auth.normalize_email(args.email), LoginAccount.company_id == company))
                if account is None:
                    raise ValueError('Account not found')
                if args.command == 'disable':
                    auth.disable(db, account)
                else:
                    password = getpass('New password (12-128 characters): ')
                    if password != getpass('Confirm password: '):
                        raise ValueError('Passwords do not match')
                    auth.reset_password(db, account, password)
            print('Account updated. No password is displayed.')
        except IntegrityError:
            db.rollback()
            parser.exit(1, 'An account already exists for that email or staff identity.\n')
        except (ValueError, LookupError) as error:
            db.rollback()
            parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
