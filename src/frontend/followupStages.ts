import type { Invoice } from './model';
export const stages = [
  'Ready',
  'Drafts',
  'Awaiting approval',
  'Ready to send',
  'Sent',
  'Deferred',
] as const;
export type FollowupStage = (typeof stages)[number];
export function invoiceStage(invoice: Invoice, asOf: string): FollowupStage | null {
  const status = invoice.workflow?.current?.status;
  if (status === 'draft') return 'Drafts';
  if (status?.startsWith('pending')) return 'Awaiting approval';
  if (status === 'approved') return 'Ready to send';
  if (invoice.workflow?.suppressed_until && invoice.workflow.suppressed_until > asOf)
    return 'Deferred';
  if (invoice.calculation?.eligible) return 'Ready';
  if (invoice.workflow?.latest?.status === 'sent') return 'Sent';
  return null;
}
export function nextStep(invoice: Invoice): string {
  const draft = invoice.workflow?.current;
  if (
    !draft &&
    invoice.workflow?.suppressed_until &&
    invoice.workflow.suppressed_until > (invoice.asOf ?? '')
  )
    return `Wait until ${invoice.workflow.suppressed_until} (Malaysia), then refresh eligibility`;
  if (
    !draft &&
    invoice.workflow?.latest?.status === 'sent' &&
    !invoice.calculation?.eligible
  )
    return 'View the saved delivery receipt in Sent';
  if (!draft)
    return invoice.calculation?.eligible
      ? 'Prepare reminder by Finance or Owner'
      : 'Review eligibility and history';
  if (draft.waiting_reason) return draft.waiting_reason;
  if (draft.status === 'draft') return 'Submit for Finance approval by Finance or Owner';
  if (draft.status === 'approved')
    return draft.channel === 'Telegram'
      ? 'Preview and send via Telegram by Finance or Owner'
      : 'Preview and simulate send by Finance or Owner';
  return `Review ${draft.status === 'pending_second_approval' ? 'Owner' : 'Finance'} approval by ${draft.assigned_approver_name ?? 'the assigned approver'}`;
}
