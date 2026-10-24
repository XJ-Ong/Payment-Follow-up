"""Optimistic revisions for editable company rules and customer preferences."""
from alembic import op
import sqlalchemy as sa
revision = '0005'
down_revision = '0004'
branch_labels = depends_on = None

def upgrade():
    for table in ('followup_rule', 'client_followup_profile'):
        op.add_column(table, sa.Column('revision', sa.Integer(), nullable=False, server_default=sa.text('1')))
        op.create_check_constraint(f'ck_{table}_revision', table, 'revision > 0')

def downgrade():
    for table in ('client_followup_profile', 'followup_rule'):
        op.drop_constraint(f'ck_{table}_revision', table, type_='check')
        op.drop_column(table, 'revision')
