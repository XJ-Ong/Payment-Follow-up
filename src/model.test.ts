import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  customers,
  daysOverdue,
  initialInvoices,
  outstanding,
  priority,
  type Invoice,
} from './model.ts';
const expect = (actual: unknown) => ({
  toBe: (value: unknown) => assert.equal(actual, value),
  toHaveLength: (value: number) => assert.equal((actual as unknown[]).length, value),
});
describe('demo invoice policy', () => {
  const invoice = initialInvoices[0];
  const customer = customers[0];
  it('reconciles totals, payments and fixed-date priority', () => {
    expect(outstanding(invoice)).toBe(12500);
    expect(daysOverdue(invoice)).toBe(24);
    expect(priority(invoice, customer.graceDays)).toBe(262500);
    expect(initialInvoices.reduce((n, i) => n + outstanding(i), 0)).toBe(45000);
    expect(initialInvoices.filter((i) => i.status === 'Needs review')).toHaveLength(3);
  });
  it('uses zero for future invoices, paid balances and days inside grace', () => {
    expect(priority({ ...invoice, due: '2026-10-21' }, 3)).toBe(0);
    expect(daysOverdue({ ...invoice, due: '2026-11-10' })).toBe(0);
    expect(outstanding({ ...invoice, payments: 20000 })).toBe(0);
  });
  it('allows only Owner and Finance to approve submitted reminders', () => {
    expect(canTransition(invoice, customer, 'Owner', 'Simulated sent')).toBe(true);
    expect(canTransition(invoice, customer, 'Finance', 'Simulated sent')).toBe(true);
    expect(canTransition(invoice, customer, 'Preparer', 'Simulated sent')).toBe(false);
    expect(canTransition(invoice, customer, 'Other Staff', 'Simulated sent')).toBe(false);
  });
  it('requires preparation and submission before approval', () => {
    const draft: Invoice = { ...invoice, status: 'Not started' };
    expect(canTransition(draft, customer, 'Preparer', 'Draft prepared')).toBe(true);
    expect(canTransition(draft, customer, 'Owner', 'Simulated sent')).toBe(false);
    expect(
      canTransition(
        { ...draft, status: 'Draft prepared' },
        customer,
        'Preparer',
        'Needs review',
      ),
    ).toBe(true);
    expect(
      canTransition(
        { ...draft, status: 'Simulated sent' },
        customer,
        'Owner',
        'Simulated sent',
      ),
    ).toBe(false);
  });
  it('blocks drafts and sends for do-not-contact and paid invoices', () => {
    expect(
      canTransition(initialInvoices[5], customers[4], 'Owner', 'Draft prepared'),
    ).toBe(false);
    expect(
      canTransition(
        invoice,
        { ...customer, doNotContact: true },
        'Finance',
        'Simulated sent',
      ),
    ).toBe(false);
    expect(
      canTransition(
        { ...invoice, payments: invoice.total },
        customer,
        'Owner',
        'Simulated sent',
      ),
    ).toBe(false);
  });
});
