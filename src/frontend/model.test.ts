import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  getVisibleInvoices,
  getCustomerBalances,
  getTotalOutstanding,
  getGraceDays,
  cleanFilters,
  isRole,
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
  it('keeps currency subtraction at cent precision', () => {
    expect(outstanding({ ...invoice, total: 100.1, payments: 40.1 })).toBe(60);
  });
  it('uses zero for future invoices, paid balances and days inside grace', () => {
    expect(priority({ ...invoice, due: '2026-10-21' }, 3)).toBe(0);
    expect(daysOverdue({ ...invoice, due: '2026-11-10' })).toBe(0);
    expect(outstanding({ ...invoice, payments: 20000 })).toBe(0);
  });
  it('allows only Owner and Finance to approve submitted reminders', () => {
    expect(canTransition(invoice, customer, 'Owner', 'Simulated sent')).toBe(true);
    expect(canTransition(invoice, customer, 'Finance', 'Simulated sent')).toBe(true);
    expect(canTransition(invoice, customer, 'Other Staff', 'Simulated sent')).toBe(false);
    expect(canTransition(invoice, customer, 'Other Staff', 'Simulated sent')).toBe(false);
  });
  it('removes the obsolete role and lets both active roles prepare', () => {
    expect(isRole('Preparer')).toBe(false);
    for (const role of ['Owner', 'Finance'] as const) {
      expect(
        canTransition(
          { ...invoice, status: 'Not started' },
          customer,
          role,
          'Draft prepared',
        ),
      ).toBe(true);
    }
  });
  it('requires preparation and submission before approval', () => {
    const draft: Invoice = { ...invoice, status: 'Not started' };
    expect(canTransition(draft, customer, 'Finance', 'Draft prepared')).toBe(true);
    expect(canTransition(draft, customer, 'Owner', 'Simulated sent')).toBe(false);
    expect(
      canTransition(
        { ...draft, status: 'Draft prepared' },
        customer,
        'Finance',
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

describe('saved follow-up results', () => {
  const calculated: Invoice = {
    ...initialInvoices[0],
    status: 'Not started',
    calculation: {
      outstanding_amount: '60.00',
      days_overdue: 8,
      grace_days: 7,
      effective_days: 1,
      score: '60.00',
      rank: 2,
      trigger_type: 'threshold',
      eligible: true,
      exclusion_reasons: [],
      holidays_excluded: ['2026-10-20'],
      last_sent_date: null,
      reason: 'Server calculation',
    },
  };
  it('uses backend amounts and calculations despite local preview overrides', () => {
    expect(outstanding(calculated)).toBe(60);
    expect(daysOverdue(calculated)).toBe(8);
    expect(priority(calculated, 999)).toBe(60);
    expect(getGraceDays(calculated, { [calculated.customerId]: 999 })).toBe(7);
  });
  it('uses eligibility for the queue independently of approval status', () => {
    const blocked: Invoice = {
      ...calculated,
      id: 'BLOCKED',
      status: 'Needs review',
      calculation: { ...calculated.calculation!, eligible: false, rank: 1 },
    };
    const rows = getVisibleInvoices([blocked, calculated], cleanFilters, {}, 'queue');
    assert.deepEqual(
      rows.map((i) => i.id),
      [calculated.id],
    );
    assert.deepEqual(
      getVisibleInvoices([calculated, blocked], cleanFilters, {}, 'ranked').map(
        (i) => i.id,
      ),
      ['BLOCKED', calculated.id],
    );
    assert.equal(
      getVisibleInvoices(
        [calculated, blocked],
        { ...cleanFilters, status: 'Not eligible' },
        {},
        'all',
      ).length,
      1,
    );
  });
});

describe('customer outstanding balances', () => {
  it('excludes void invoices from customer balances and the chart total', () => {
    const customer = customers[0];
    const records: Invoice[] = [
      {
        ...initialInvoices[0],
        id: 'OPEN',
        customerId: customer.id,
        total: 1000,
        payments: 250,
      },
      {
        ...initialInvoices[0],
        id: 'VOID',
        customerId: customer.id,
        total: 9000,
        payments: 0,
        financialStatus: 'void',
      },
      {
        ...initialInvoices[0],
        id: 'PAID',
        customerId: customer.id,
        total: 100,
        payments: 100,
        financialStatus: 'paid',
      },
    ];
    const balances = getCustomerBalances(records, [{ ...customer, doNotContact: true }]);
    expect(balances[0].balance).toBe(750);
    expect(getTotalOutstanding(records)).toBe(750);
    expect(getTotalOutstanding(records.filter((i) => i.financialStatus === 'void'))).toBe(
      0,
    );
  });
});
