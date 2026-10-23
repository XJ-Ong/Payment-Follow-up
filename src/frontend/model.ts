export const REFERENCE_DATE = '2026-10-22';
export type Role = 'Owner' | 'Finance' | 'Other Staff';
export const roles: Role[] = ['Owner', 'Finance', 'Other Staff'];

export function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}
export type Status =
  | 'Needs review'
  | 'Draft prepared'
  | 'Simulated sent'
  | 'Snoozed'
  | 'Not started';
export type Customer = {
  id: string;
  name: string;
  contact: string;
  initials: string;
  color: string;
  graceDays: number;
  doNotContact: boolean;
};
export type Invoice = {
  databaseId?: string;
  customer?: Customer;
  asOf?: string;
  financialStatus?: string;
  id: string;
  customerId: string;
  total: number;
  payments: number;
  due: string;
  status: Status;
  preparedBy?: string;
  sentOn?: string;
  reminder?: string;
};

export type Filters = {
  search: string;
  status: string;
  from: string;
  to: string;
};

export type GraceOverrides = Record<string, number>;
export type InvoiceScope = 'all' | 'review' | 'sent';
export type InvoiceTotals = {
  overdue: number;
  review: number;
  drafts: number;
  sent: number;
  snoozed: number;
};
export type CustomerBalance = { name: string; balance: number };
export type InvoiceInput = Pick<Invoice, 'id' | 'total' | 'payments' | 'due'>;

export const cleanFilters: Filters = {
  search: '',
  status: 'All statuses',
  from: '',
  to: '',
};

export const statuses: Status[] = [
  'Needs review',
  'Draft prepared',
  'Simulated sent',
  'Snoozed',
  'Not started',
];
export const customers: Customer[] = [
  {
    id: 'c1',
    name: 'Meridian Studio',
    contact: 'accounts@meridian.example',
    initials: 'MS',
    color: 'violet',
    graceDays: 3,
    doNotContact: false,
  },
  {
    id: 'c2',
    name: 'Bloom & Co.',
    contact: 'finance@bloom.example',
    initials: 'BC',
    color: 'green',
    graceDays: 5,
    doNotContact: false,
  },
  {
    id: 'c3',
    name: 'Northstar Technologies',
    contact: 'billing@northstar.example',
    initials: 'NT',
    color: 'blue',
    graceDays: 7,
    doNotContact: false,
  },
  {
    id: 'c4',
    name: 'Kopi Collective',
    contact: 'hello@kopi.example',
    initials: 'KC',
    color: 'orange',
    graceDays: 3,
    doNotContact: false,
  },
  {
    id: 'c5',
    name: 'Atlas Ventures',
    contact: 'accounts@atlas.example',
    initials: 'AV',
    color: 'slate',
    graceDays: 5,
    doNotContact: true,
  },
];
export const initialInvoices: Invoice[] = [
  {
    id: 'INV-2026-042',
    customerId: 'c1',
    total: 15000,
    payments: 2500,
    due: '2026-09-28',
    status: 'Needs review',
    preparedBy: 'Daniel Tan',
  },
  {
    id: 'INV-2026-039',
    customerId: 'c2',
    total: 8200,
    payments: 0,
    due: '2026-10-05',
    status: 'Needs review',
    preparedBy: 'Daniel Tan',
  },
  {
    id: 'INV-2026-045',
    customerId: 'c3',
    total: 12000,
    payments: 5000,
    due: '2026-10-10',
    status: 'Needs review',
    preparedBy: 'Daniel Tan',
  },
  {
    id: 'INV-2026-041',
    customerId: 'c4',
    total: 4600,
    payments: 0,
    due: '2026-10-08',
    status: 'Draft prepared',
    preparedBy: 'Daniel Tan',
  },
  {
    id: 'INV-2026-036',
    customerId: 'c1',
    total: 6000,
    payments: 2000,
    due: '2026-10-01',
    status: 'Simulated sent',
    sentOn: REFERENCE_DATE,
    preparedBy: 'Daniel Tan',
  },
  {
    id: 'INV-2026-044',
    customerId: 'c5',
    total: 5500,
    payments: 0,
    due: '2026-10-12',
    status: 'Snoozed',
  },
  {
    id: 'INV-2026-047',
    customerId: 'c2',
    total: 3200,
    payments: 0,
    due: '2026-10-16',
    status: 'Draft prepared',
    preparedBy: 'Daniel Tan',
  },
];
export const outstanding = (i: Invoice) =>
  Math.max(0, Math.round((i.total - i.payments) * 100) / 100);
export const daysOverdue = (i: Invoice) =>
  Math.max(
    0,
    Math.floor((Date.parse(i.asOf ?? REFERENCE_DATE) - Date.parse(i.due)) / 86400000),
  );
export const priority = (i: Invoice, grace: number) =>
  outstanding(i) * Math.max(0, daysOverdue(i) - grace);
export const money = (n: number) =>
  'MYR ' +
  n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dateLabel = (s: string) =>
  new Date(s + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
export const canApprove = (role: Role) => role === 'Owner' || role === 'Finance';
export function canTransition(
  i: Invoice,
  customer: Customer,
  role: Role,
  status: Status,
) {
  if (
    !roles.includes(role) ||
    role === 'Other Staff' ||
    customer.doNotContact ||
    outstanding(i) <= 0 ||
    i.status === 'Simulated sent'
  )
    return false;
  if (status === 'Simulated sent') return canApprove(role) && i.status === 'Needs review';
  if (status === 'Needs review') return i.status === 'Draft prepared';
  if (status === 'Draft prepared') return ['Not started', 'Snoozed'].includes(i.status);
  return status === 'Snoozed' && i.status !== 'Snoozed';
}

export function getInvoiceCustomer(invoice: Invoice): Customer {
  const customer =
    invoice.customer ?? customers.find((customer) => customer.id === invoice.customerId);
  if (!customer) throw new Error(`Unknown customer: ${invoice.customerId}`);
  return customer;
}

export function getGraceDays(invoice: Invoice, overrides: GraceOverrides): number {
  return overrides[invoice.customerId] ?? getInvoiceCustomer(invoice).graceDays;
}

export function getTotalOutstanding(invoices: Invoice[]): number {
  return invoices.reduce((total, invoice) => total + outstanding(invoice), 0);
}

export function getInvoiceTotals(invoices: Invoice[]): InvoiceTotals {
  return {
    overdue: getTotalOutstanding(invoices.filter((invoice) => daysOverdue(invoice) > 0)),
    review: invoices.filter((invoice) => invoice.status === 'Needs review').length,
    drafts: invoices.filter((invoice) => invoice.status === 'Draft prepared').length,
    sent: invoices.filter((invoice) => invoice.sentOn === REFERENCE_DATE).length,
    snoozed: invoices.filter((invoice) => invoice.status === 'Snoozed').length,
  };
}

export function getVisibleInvoices(
  invoices: Invoice[],
  filters: Filters,
  overrides: GraceOverrides,
  scope: InvoiceScope,
): Invoice[] {
  return invoices
    .filter((invoice) => {
      const matchesSearch = `${invoice.id} ${getInvoiceCustomer(invoice).name}`
        .toLowerCase()
        .includes(filters.search.toLowerCase());

      return (
        matchesSearch &&
        (filters.status === 'All statuses' || invoice.status === filters.status) &&
        (!filters.from || invoice.due >= filters.from) &&
        (!filters.to || invoice.due <= filters.to) &&
        (scope !== 'review' || invoice.status === 'Needs review') &&
        (scope !== 'sent' || invoice.status === 'Simulated sent')
      );
    })
    .sort(
      (a, b) =>
        priority(b, getGraceDays(b, overrides)) - priority(a, getGraceDays(a, overrides)),
    );
}

export function getCustomerBalances(
  invoices: Invoice[],
  clientList = customers,
): CustomerBalance[] {
  return clientList.map((customer) => ({
    name: customer.name,
    balance: getTotalOutstanding(
      invoices.filter((invoice) => invoice.customerId === customer.id),
    ),
  }));
}

export function validateInvoice(input: InvoiceInput, invoices: Invoice[]): string | null {
  const { id, total, payments, due } = input;
  if (!id || invoices.some((invoice) => invoice.id.toLowerCase() === id.toLowerCase())) {
    return 'Enter a unique invoice number.';
  }
  if (!Number.isFinite(total) || total <= 0 || payments < 0 || payments > total) {
    return 'Total must be positive. Payments must be between zero and the invoice total.';
  }
  if (!due || !Number.isFinite(Date.parse(due))) return 'Choose a valid due date.';
  return null;
}

export function validateDateRange(filters: Filters): string | null {
  return filters.from && filters.to && filters.from > filters.to
    ? 'The end date must be on or after the start date.'
    : null;
}

export function normalizeGraceDays(days: number): number {
  return Math.min(365, Math.max(0, days));
}

export function createReminderText(invoice: Invoice): string {
  const customer = getInvoiceCustomer(invoice);
  return `Hi ${customer.name},\n\nA friendly reminder that invoice ${invoice.id}, due on ${dateLabel(invoice.due)}, has an outstanding balance of ${money(outstanding(invoice))}.\n\nPlease let us know when we can expect payment, or if there is anything you need from us. If you have already paid, thank you — please share your payment reference.\n\nBest regards,\nAcme Collective`;
}

export function isReminderBlocked(invoice: Invoice): boolean {
  return getInvoiceCustomer(invoice).doNotContact || outstanding(invoice) === 0;
}

export function isReminderEditable(invoice: Invoice): boolean {
  return (
    invoice.status === 'Draft prepared' ||
    invoice.status === 'Not started' ||
    invoice.status === 'Snoozed'
  );
}
