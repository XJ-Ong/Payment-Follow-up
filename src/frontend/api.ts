import type { Customer, Invoice, Role, FollowupCalculation } from './model';

import type {
  DemoUser,
  Draft,
  DraftAction,
  DraftPayload,
  Workflow,
  OutboxRecord,
  ActivityRecord,
} from './workflowTypes';

export const demoMode = import.meta.env.VITE_DATA_MODE === 'demo';
const baseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
);
export async function request<T>(
  path: string,
  role: Role,
  body?: unknown,
  userId?: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Role': role,
      ...(userId ? { 'X-User-ID': userId } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.detail === 'string'
        ? payload.detail
        : `Request failed (${response.status}). Check the form and try again.`,
    );
  }
  return response.json();
}
export type SavedRules = {
  grace_days_by_tier: Record<string, number>;
  alert_threshold: string;
  safety_flag_days: number;
  min_spacing_days: number;
  skip_holidays: boolean;
  primary_approver_id: string;
  backup_approver_id?: string | null;
  owner_approver_id?: string | null;
  second_approval_amount?: string | null;
};
export type FollowupAlert = {
  id: string;
  invoice_id: string;
  recipient_id: string;
  trigger_type: string;
  status: string;
  reason: string;
};
export type Dashboard = {
  total_outstanding: string;
  total_overdue: string;
  queue_count: number;
  alert_count: number;
  customer_balances: { customer_id: string; name: string; balance: string }[];
  ranking_ids: string[];
};
type ApiInvoice = {
  id: string;
  invoice_no: string;
  client_id: string;
  due_date: string;
  total_amount: string;
  payments: string;
  status: string;
  workflow?: Workflow;
  calculation: FollowupCalculation;
};
export async function loadWorkspace(role: Role, refresh = true, userId?: string) {
  const data = await request<{
    invoices: ApiInvoice[];
    customers: Customer[];
    as_of_date: string;
    computed_at: string | null;
    rules: SavedRules | null;
    dashboard: Dashboard;
    alerts: FollowupAlert[];
  }>(
    refresh ? '/followups/refresh' : '/followups',
    role,
    refresh ? {} : undefined,
    userId,
  );
  const [users, outbox, activity] = await Promise.all([
    request<DemoUser[]>('/users', role, undefined, userId),
    request<OutboxRecord[]>('/outbox', role, undefined, userId),
    request<ActivityRecord[]>('/activity', role, undefined, userId),
  ]);
  return {
    users,
    outbox,
    activity,
    customers: data.customers,
    dashboard: data.dashboard,
    alerts: data.alerts,
    rules: data.rules,
    asOf: data.as_of_date,
    computedAt: data.computed_at,
    invoices: data.invoices.map(
      (row): Invoice => ({
        id: row.invoice_no,
        databaseId: row.id,
        customerId: row.client_id,
        customer: data.customers.find((c) => c.id === row.client_id),
        total: Number(row.total_amount),
        payments: Number(row.payments),
        due: row.due_date,
        status: 'Not started',
        asOf: data.as_of_date,
        financialStatus: row.status,
        workflow: row.workflow,
        calculation: row.calculation,
      }),
    ),
  };
}
export function createInvoice(
  invoice: Invoice,
  role: Role,
  issueDate: string,
  userId?: string,
) {
  return request(
    '/invoices',
    role,
    {
      invoice_no: invoice.id,
      client_id: invoice.customerId,
      issue_date: issueDate,
      due_date: invoice.due,
      total_amount: invoice.total.toFixed(2),
      initial_payment: invoice.payments.toFixed(2),
    },
    userId,
  );
}
export function recordPayment(
  invoice: Invoice,
  role: Role,
  amount: string,
  receivedDate: string,
  userId?: string,
) {
  return request(
    `/invoices/${invoice.databaseId}/payments`,
    role,
    {
      amount,
      received_date: receivedDate,
      payment_type: 'partial',
    },
    userId,
  );
}

export function changeDraft(
  invoice: Invoice,
  action: DraftAction,
  payload: DraftPayload,
  role: Role,
  userId?: string,
) {
  if (action === 'create')
    return request<Draft>(`/invoices/${invoice.databaseId}/drafts`, role, {}, userId);
  const draft = invoice.workflow?.current;
  if (!draft) return Promise.reject(new Error('No current draft. Reload the invoice.'));
  return request<Draft>(
    `/drafts/${draft.id}/${action}`,
    role,
    { version: draft.version, ...payload },
    userId,
  );
}
export function loadVersions(invoiceId: string, role: Role, userId?: string) {
  return request<Draft[]>(`/invoices/${invoiceId}/drafts`, role, undefined, userId);
}
