import type { Customer, Invoice, Role } from './model';
import { createInvoice, type SavedRules } from './api';

/** Temporary local-development fixtures, saved through the ordinary invoice API. */
export async function addTestData(
  customers: Customer[],
  rules: SavedRules,
  asOf: string,
  role: Role,
  userId?: string,
) {
  const contact = customers.find((c) => !c.doNotContact);
  const blocked = customers.find((c) => c.doNotContact);
  if (!contact)
    throw new Error(
      'No contactable customer is configured. Load the database seeds first.',
    );
  const shift = (days: number) => {
    const date = new Date(`${asOf}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const grace = Math.max(0, ...Object.values(rules.grace_days_by_tier));
  const overdue = Math.max(
    40,
    rules.safety_flag_days + grace + 1,
    Math.ceil(Number(rules.alert_threshold) / 1000) + grace + 1,
  );
  const threshold = Number(rules.second_approval_amount ?? '20000');
  const standard = Math.min(1000, threshold > 0 ? threshold : 1000);
  const examples = [
    { label: 'STANDARD', total: standard, payment: 0, due: -overdue, customer: contact },
    {
      label: 'HIGH-VALUE',
      total: threshold + 10000,
      payment: 0,
      due: -overdue,
      customer: contact,
    },
    ...(threshold > 0
      ? [
          {
            label: 'AT-THRESHOLD',
            total: threshold,
            payment: 0,
            due: -overdue,
            customer: contact,
          },
        ]
      : []),
    {
      label: 'PARTIAL',
      total: standard + 500,
      payment: 500,
      due: -overdue,
      customer: contact,
    },
    { label: 'PAID', total: 1000, payment: 1000, due: -overdue, customer: contact },
    { label: 'FUTURE', total: 1000, payment: 0, due: 14, customer: contact },
    ...(blocked
      ? [
          {
            label: 'DO-NOT-CONTACT',
            total: 1500,
            payment: 0,
            due: -overdue,
            customer: blocked,
          },
        ]
      : []),
  ];
  const batch =
    `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`.toUpperCase();
  let created = 0;
  for (const example of examples) {
    const invoice: Invoice = {
      id: `TEST-${batch}-${example.label}`,
      customerId: example.customer.id,
      total: example.total,
      payments: example.payment,
      due: shift(example.due),
      status: 'Not started',
    };
    try {
      await createInvoice(invoice, role, shift(-overdue - 10), userId);
      created += 1;
    } catch (error) {
      throw new Error(
        `${created} test invoices added before the request failed. ${error instanceof Error ? error.message : 'Try again when the API is available.'}`,
      );
    }
  }
  return created;
}
