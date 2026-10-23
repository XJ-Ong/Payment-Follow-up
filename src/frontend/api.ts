import type { Customer, Invoice, Role, FollowupCalculation } from './model';

export const demoMode = import.meta.env.VITE_DATA_MODE === 'demo';
const baseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
);
export async function request<T>(path: string, role: Role, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Role': role,
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
  calculation: FollowupCalculation;
};
export async function loadWorkspace(role: Role, refresh = true) {
  const data = await request<{
    invoices: ApiInvoice[];
    customers: Customer[];
    as_of_date: string;
    computed_at: string | null;
    rules: SavedRules | null;
    dashboard: Dashboard;
    alerts: FollowupAlert[];
  }>(refresh ? '/followups/refresh' : '/followups', role, refresh ? {} : undefined);
  return {
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
        calculation: row.calculation,
      }),
    ),
  };
}
export function createInvoice(invoice: Invoice, role: Role, issueDate: string) {
  return request('/invoices', role, {
    invoice_no: invoice.id,
    client_id: invoice.customerId,
    issue_date: issueDate,
    due_date: invoice.due,
    total_amount: invoice.total.toFixed(2),
    initial_payment: invoice.payments.toFixed(2),
  });
}
export function recordPayment(
  invoice: Invoice,
  role: Role,
  amount: string,
  receivedDate: string,
) {
  return request(`/invoices/${invoice.databaseId}/payments`, role, {
    amount,
    received_date: receivedDate,
    payment_type: 'partial',
  });
}
