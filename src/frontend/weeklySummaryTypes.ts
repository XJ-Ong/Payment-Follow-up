export type WeeklySummary = {
  week_start: string;
  week_end: string;
  period_end: string;
  current_week_start: string;
  is_current_week: boolean;
  generated_at: string;
  totals: {
    payments_received: string;
    invoices_fully_paid: number;
    customers_paid: number;
  };
  daily: { date: string; amount: string }[];
  customers: {
    customer_id: string;
    name: string;
    amount_received: string;
    invoices_receiving_payments: number;
    invoices_fully_paid: number;
  }[];
  payments: {
    id: string;
    received_date: string;
    invoice_id: string;
    invoice_no: string;
    customer_name: string;
    amount: string;
    reference: string | null;
  }[];
  outstanding_now: {
    as_of_date: string;
    total_outstanding: string;
    total_overdue: string;
  };
};
