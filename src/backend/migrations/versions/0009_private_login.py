"""Private login accounts, sessions and login attempt limits."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0009'
down_revision = '0008'
branch_labels = depends_on = None


def upgrade():
    op.create_table('login_account',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('staff_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(254), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(512), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.UniqueConstraint('company_id', 'staff_id'))
    op.create_table('login_session',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('login_account.id', ondelete='CASCADE'), nullable=False),
        sa.Column('csrf_token', sa.String(64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_login_session_account_id', 'login_session', ['account_id'])
    op.create_index('ix_login_session_expires_at', 'login_session', ['expires_at'])
    op.create_table('login_throttle',
        sa.Column('identifier_hash', sa.String(64), primary_key=True),
        sa.Column('window_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('failures', sa.Integer(), nullable=False))


def downgrade():
    op.drop_table('login_throttle')
    op.drop_table('login_session')
    op.drop_table('login_account')
