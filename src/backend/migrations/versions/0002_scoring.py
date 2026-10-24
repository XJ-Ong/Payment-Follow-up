"""Persist daily scoring eligibility and deduplicate dashboard alerts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

def upgrade():
    # Refuse conflicting pre-existing alert history rather than deleting records.
    duplicates = op.get_bind().execute(sa.text("SELECT 1 FROM alert GROUP BY snapshot_id, recipient_id, channel HAVING count(*) > 1 LIMIT 1")).first()
    if duplicates:
        raise RuntimeError("Duplicate alert history must be reviewed before migration; no records were removed")
    op.alter_column("followup_rule", "skip_holidays", server_default=sa.text("false"))
    op.add_column("priority_snapshot", sa.Column("eligible", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("priority_snapshot", sa.Column("exclusion_reasons", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("priority_snapshot", sa.Column("calculation", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.alter_column("priority_snapshot", "rank", existing_type=sa.Integer(), nullable=True)
    op.alter_column("priority_snapshot", "score", existing_type=sa.Numeric(14,2), type_=sa.Numeric(24,2))
    op.alter_column("priority_snapshot", "reason", existing_type=sa.String(255), type_=sa.Text())
    op.create_unique_constraint("uq_alert_snapshot_recipient_channel", "alert", ["snapshot_id", "recipient_id", "channel"])

def downgrade():
    raise RuntimeError("Scoring downgrade is disabled to preserve snapshot history")
