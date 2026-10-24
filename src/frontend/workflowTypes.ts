export type DemoUser = {
  id: string;
  name: string;
  role: 'owner' | 'finance';
  is_default: boolean;
};
export type Approval = {
  id: string;
  approver_id: string;
  approver_name: string;
  approval_step: number;
  decision: string;
  decided_at: string;
  historical: boolean;
};
export type Draft = {
  id: string;
  invoice_id: string;
  invoice_no: string;
  version: number;
  status: string;
  body: string;
  channel: string;
  language: string;
  tone: string;
  recipient: string;
  prepared_by: string | null;
  author_name: string;
  historical: boolean;
  is_current: boolean;
  supersedes_id: string | null;
  created_at: string;
  required_approvals: number;
  assigned_approver_id: string | null;
  assigned_approver_name: string | null;
  waiting_reason: string | null;
  allowed_actions: string[];
  approvals: Approval[];
};
export type Workflow = {
  current: Draft | null;
  latest: Draft | null;
  suppressed_until: string | null;
  suppression_reason: string | null;
};
export type OutboxRecord = {
  id: string;
  draft_id: string;
  invoice_id: string;
  invoice_no: string;
  version: number;
  channel: string;
  recipient_contact: string;
  approved_body: string;
  sent_at: string;
  status: string;
  historical: boolean;
};
export type ActivityRecord = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  entity_type: string;
  entity_id: string;
  invoice_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
};
export type DraftAction =
  | 'create'
  | 'versions'
  | 'submit'
  | 'approve'
  | 'edit-approve'
  | 'skip'
  | 'snooze'
  | 'send';
export type DraftPayload = { body?: string; reason?: string; snooze_until?: string };

export function reminderStatus(status: string) {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending_approval: 'Awaiting Finance approval',
    pending_second_approval: 'Awaiting Owner approval',
    approved: 'Approved',
    sent: 'Simulated sent',
    skipped: 'Skipped',
    snoozed: 'Snoozed',
    superseded: 'Superseded',
    invalidated: 'Invalidated',
  };
  return labels[status] ?? status;
}
export function activityLabel(action: string) {
  const labels: Record<string, string> = {
    'rules.updated': 'Company rules updated',
    'customer.profile_updated': 'Customer preferences updated',
    'invoice.created': 'Invoice created',
    'payment.recorded': 'Payment recorded',
    'draft.version_created': 'Draft version saved',
    'draft.submitted': 'Submitted for Finance approval',
    'draft.approved': 'Reminder version approved',
    'draft.invalidated': 'Reminder invalidated',
    'draft.skipped': 'Reminder skipped',
    'draft.snoozed': 'Reminder snoozed',
    'send.blocked': 'Simulated send blocked',
    'reminder.simulated_sent': 'Simulated reminder sent',
  };
  return labels[action] ?? action;
}
