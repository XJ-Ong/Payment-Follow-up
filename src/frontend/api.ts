import type { Customer, Invoice, Role } from './model';

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
type ApiInvoice = {
  id: string;
  invoice_no: string;
  client_id: string;
  issue_date: string;
  due_date: string;
  total_amount: string;
  payments: string;
  outstanding_amount: string;
  status: string;
};
export async function loadWorkspace(role: Role) {
  const data = await request<{
    invoices: ApiInvoice[];
    customers: Customer[];
    as_of_date: string;
  }>('/invoices', role);
  return {
    customers: data.customers,
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
