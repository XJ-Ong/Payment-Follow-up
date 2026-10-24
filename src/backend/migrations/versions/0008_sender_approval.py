"""Append sender approval without rewriting earlier approval history."""
from alembic import op
import sqlalchemy as sa
revision = "0008"
down_revision = "0007"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("uq_approval_draft_step", "approval", type_="unique")
    op.create_index("uq_approval_draft_step", "approval", ["draft_id", "approval_step"], unique=True,
                    postgresql_where=sa.text("coalesce(context->>'approval_mode', '') <> 'send'"))
    op.drop_index("uq_approval_distinct_actor", table_name="approval")
    op.create_index("uq_approval_distinct_actor", "approval", ["draft_id", "approver_id"], unique=True,
                    postgresql_where=sa.text("NOT is_legacy AND decision IN ('approve', 'edit_approve') AND coalesce(context->>'approval_mode', '') <> 'send'"))
    op.create_index("uq_approval_sender", "approval", ["draft_id"], unique=True,
                    postgresql_where=sa.text("context->>'approval_mode' = 'send'"))


def downgrade():
    raise RuntimeError("Downgrade is disabled to preserve sender approval history")
