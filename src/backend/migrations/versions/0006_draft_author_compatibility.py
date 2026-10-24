"""Retain draft authorship on baselines that omitted the historical column."""
from alembic import op
revision = '0006'
down_revision = '0005'
branch_labels = depends_on = None

def upgrade():
    op.execute('ALTER TABLE reminder_draft ADD COLUMN IF NOT EXISTS prepared_by UUID')

def downgrade():
    # This field may predate the revision. Never drop historical authorship.
    pass
