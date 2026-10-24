"""Use transaction order, not timestamp ties, for saved workspace readback."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
revision = "0004"
down_revision = "0003"
branch_labels = depends_on = None


def upgrade():
    op.add_column("followup_rule", sa.Column("latest_workspace_event_id", pg.UUID(), nullable=True))
    op.create_foreign_key("fk_rule_latest_workspace_event", "followup_rule", "activity_log", ["latest_workspace_event_id"], ["id"], ondelete="RESTRICT")


def downgrade():
    op.drop_constraint("fk_rule_latest_workspace_event", "followup_rule", type_="foreignkey")
    op.drop_column("followup_rule", "latest_workspace_event_id")
