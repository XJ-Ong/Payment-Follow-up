"""Immutable draft versions, distinct approvers and invoice suppression."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
revision = "0003"
down_revision = "0002"
branch_labels = depends_on = None


def upgrade():
    op.add_column("followup_rule", sa.Column("owner_approver_id", pg.UUID(), nullable=True))
    op.add_column("invoice", sa.Column("followup_suppressed_until", sa.Date(), nullable=True))
    op.add_column("invoice", sa.Column("followup_suppression_reason", sa.Text(), nullable=True))
    # prepared_by already exists in the frozen baseline. Restore its ORM mapping;
    # do not overwrite legacy authors or infer identities for unknown history.
    for name in ("facts", "approval_policy"):
        op.add_column("reminder_draft", sa.Column(name, pg.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("reminder_draft", sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("reminder_draft", sa.Column("is_legacy", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("reminder_draft", sa.Column("supersedes_id", pg.UUID(), sa.ForeignKey("reminder_draft.id", ondelete="RESTRICT"), nullable=True))
    op.drop_constraint("ck_reminder_draft_status", "reminder_draft", type_="check")
    op.create_check_constraint("ck_reminder_draft_status", "reminder_draft", "status IN ('draft','pending_approval','pending_second_approval','approved','sent','skipped','snoozed','superseded','invalidated')")
    op.create_index("uq_reminder_current_invoice", "reminder_draft", ["invoice_id"], unique=True, postgresql_where=sa.text("is_current"))
    op.add_column("approval", sa.Column("is_legacy", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("approval", sa.Column("context", pg.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.create_index("uq_approval_distinct_actor", "approval", ["draft_id", "approver_id"], unique=True, postgresql_where=sa.text("NOT is_legacy AND decision IN ('approve','edit_approve')"))
    # Only migrate the known synthetic default. Custom routing is left untouched.
    op.execute("""UPDATE followup_rule SET owner_approver_id='00000000-0000-4000-8000-000000000101', backup_approver_id='00000000-0000-4000-8000-000000000105'
      WHERE company_id='00000000-0000-4000-8000-000000000001'
      AND primary_approver_id='00000000-0000-4000-8000-000000000102'
      AND backup_approver_id='00000000-0000-4000-8000-000000000101'""")
    op.execute("""CREATE OR REPLACE FUNCTION protect_reminder_content() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(NEW.body,NEW.channel,NEW.language,NEW.tone,NEW.facts,NEW.approval_policy,NEW.prepared_by,NEW.version,NEW.company_id,NEW.invoice_id,NEW.supersedes_id,NEW.is_legacy,NEW.written_by,NEW.verification_result)
         IS DISTINCT FROM ROW(OLD.body,OLD.channel,OLD.language,OLD.tone,OLD.facts,OLD.approval_policy,OLD.prepared_by,OLD.version,OLD.company_id,OLD.invoice_id,OLD.supersedes_id,OLD.is_legacy,OLD.written_by,OLD.verification_result)
      THEN RAISE EXCEPTION 'Reminder content is immutable; create a new version'; END IF;
      RETURN NEW;
    END $$""")
    op.execute("CREATE TRIGGER reminder_content_immutable BEFORE UPDATE ON reminder_draft FOR EACH ROW EXECUTE FUNCTION protect_reminder_content()")
    op.execute("""CREATE OR REPLACE FUNCTION protect_approval_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Approval history is append-only'; END $$""")
    op.execute("CREATE TRIGGER approval_history_immutable BEFORE UPDATE OR DELETE ON approval FOR EACH ROW EXECUTE FUNCTION protect_approval_history()")


def downgrade():
    raise RuntimeError("Workflow downgrade is disabled to preserve approval history")
