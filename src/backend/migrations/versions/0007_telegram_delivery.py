"""Customer Telegram mappings and durable delivery claims; retain WhatsApp history."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = '0007'
down_revision = '0006'
branch_labels = depends_on = None


def channel_checks(telegram):
    channels = "'Email', 'WhatsApp', 'Telegram'" if telegram else "'Email', 'WhatsApp'"
    for table, column, name in [('client_followup_profile','preferred_channel','ck_cfp_preferred_channel'),
                                ('reminder_draft','channel','ck_reminder_draft_channel'),
                                ('send_log','channel','ck_send_log_channel')]:
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, f"{column} IN ({channels})")
    op.drop_constraint('ck_send_log_status','send_log',type_='check')
    op.create_check_constraint('ck_send_log_status','send_log',
        "(channel = 'Telegram' AND status = 'sent') OR (channel IN ('Email', 'WhatsApp') AND status = 'simulated')" if telegram else "status IN ('simulated')")


def upgrade():
    op.add_column('client_followup_profile', sa.Column('telegram_chat_id', sa.String(64), nullable=True))
    op.create_check_constraint('ck_cfp_telegram_chat_id','client_followup_profile',"telegram_chat_id IS NULL OR telegram_chat_id ~ '^-?[1-9][0-9]*$'")
    op.add_column('send_log', sa.Column('provider_message_id', sa.String(100), nullable=True))
    channel_checks(True)
    op.create_table('delivery_attempt',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('company_id', pg.UUID(as_uuid=True), nullable=False),
        sa.Column('draft_id', pg.UUID(as_uuid=True), sa.ForeignKey('reminder_draft.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('initiated_by', pg.UUID(as_uuid=True), nullable=False),
        sa.Column('recipient_contact', sa.String(255), nullable=False),
        sa.Column('approved_body', sa.Text(), nullable=False),
        sa.Column('content_digest', sa.String(64), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('provider_message_id', sa.String(100)),
        sa.Column('error_code', sa.String(100)),
        sa.Column('retry_after_seconds', sa.Integer()),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('draft_id', name='uq_delivery_attempt_draft'),
        sa.CheckConstraint("status IN ('sending', 'sent', 'failed', 'unknown')",name='ck_delivery_attempt_status'))
    op.create_index('ix_delivery_attempt_company_status','delivery_attempt',['company_id','status'])
    op.create_index('ix_delivery_attempt_company_id','delivery_attempt',['company_id'])


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM delivery_attempt) OR EXISTS (SELECT 1 FROM client_followup_profile WHERE telegram_chat_id IS NOT NULL OR preferred_channel='Telegram') OR EXISTS (SELECT 1 FROM reminder_draft WHERE channel='Telegram') OR EXISTS (SELECT 1 FROM send_log WHERE channel='Telegram')")):
        raise RuntimeError('Cannot downgrade while Telegram mappings or delivery history exist')
    op.drop_table('delivery_attempt')
    channel_checks(False)
    op.drop_column('send_log','provider_message_id')
    op.drop_constraint('ck_cfp_telegram_chat_id','client_followup_profile',type_='check')
    op.drop_column('client_followup_profile','telegram_chat_id')
