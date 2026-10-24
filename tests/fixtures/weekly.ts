export const customer = {
  id: 'c1',
  name: 'Meridian Studio',
  contact: 'accounts@example.com',
  initials: 'MS',
  color: 'blue',
  graceDays: 3,
  doNotContact: false,
};
export const workspace = {
  as_of_date: '2026-10-24',
  computed_at: '2026-10-24T04:00:00Z',
  rules: null,
  alerts: [],
  customers: [customer],
  invoices: [
    {
      id: 'i1',
      invoice_no: 'WEEK-001',
      client_id: 'c1',
      total_amount: '1000.00',
      payments: '600.00',
      issue_date: '2026-09-01',
      due_date: '2026-10-01',
      status: 'partially_paid',
    },
  ],
  dashboard: {
    total_outstanding: '400.00',
    total_overdue: '400.00',
    queue_count: 0,
    alert_count: 0,
    ranking_ids: ['i1'],
    customer_balances: [{ customer_id: 'c1', name: customer.name, balance: '400.00' }],
  },
};
export const summary = {
  week_start: '2026-10-19',
  week_end: '2026-10-25',
  period_end: '2026-10-24',
  current_week_start: '2026-10-19',
  is_current_week: true,
  generated_at: '2026-10-24T04:00:00Z',
  totals: { payments_received: '600.00', invoices_fully_paid: 0, customers_paid: 1 },
  daily: Array.from({ length: 7 }, (_, n) => ({
    date: `2026-10-${19 + n}`,
    amount: n === 0 ? '600.00' : '0.00',
  })),
  customers: [
    {
      customer_id: 'c1',
      name: customer.name,
      amount_received: '600.00',
      invoices_receiving_payments: 1,
      invoices_fully_paid: 0,
    },
  ],
  payments: [
    {
      id: 'p1',
      received_date: '2026-10-19',
      invoice_id: 'i1',
      invoice_no: 'WEEK-001',
      customer_name: customer.name,
      amount: '600.00',
      reference: 'BANK-001',
    },
  ],
  outstanding_now: {
    as_of_date: '2026-10-24',
    total_outstanding: '400.00',
    total_overdue: '400.00',
  },
};
