import { useState, type FormEvent } from 'react';
import { Plus, ShieldCheck, Upload } from 'lucide-react';
import { type Customer, type Invoice, validateInvoice } from '../model';
import Modal from './Modal';

export default function AddInvoiceDialog({
  customers,
  onClose,
  onAdd,
  invoices,
  onImport,
}: {
  customers: Customer[];
  onClose: () => void;
  onAdd: (i: Invoice, issueDate: string) => Promise<void>;
  invoices: Invoice[];
  onImport?: () => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const id = String(data.get('id')).trim();
    const total = Number(data.get('total'));
    const payments = Number(data.get('payments'));
    const issue = String(data.get('issue'));
    const due = String(data.get('due'));
    if (!issue || !due || due < issue) {
      setError('Due date must be on or after the issue date.');
      return;
    }
    const validationError = validateInvoice({ id, total, payments, due }, invoices);
    if (validationError) return setError(validationError);
    setSaving(true);
    try {
      await onAdd(
        {
          id,
          customerId: String(data.get('customer')),
          total,
          payments,
          due,
          status: 'Not started',
        },
        issue,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save invoice');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Add an invoice"
      subtitle="Create an invoice for this demo."
      onClose={onClose}
    >
      <form onSubmit={submit} className="dialog-body">
        {onImport && (
          <div className="invoice-entry-options">
            <span>Adding multiple invoices?</span>
            <button type="button" className="button" onClick={onImport} disabled={saving}>
              <Upload size={15} />
              Import CSV
            </button>
          </div>
        )}
        <label>
          Invoice number
          <input
            name="id"
            defaultValue={`INV-2026-${String(invoices.length + 48).padStart(3, '0')}`}
            required
            maxLength={40}
          />
        </label>
        <label>
          Customer
          <select name="customer">
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Invoice total (MYR)
            <input
              name="total"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              required
            />
          </label>
          <label>
            Payments received (MYR)
            <input
              name="payments"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
              required
            />
          </label>
        </div>
        <label>
          Issue date
          <input
            name="issue"
            type="date"
            defaultValue={new Date().toLocaleDateString('en-CA', {
              timeZone: 'Asia/Kuala_Lumpur',
            })}
            required
          />
        </label>
        <label>
          Due date
          <input name="due" type="date" required />
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="note">
          <ShieldCheck size={17} />
          Demo only. No payment or message will be sent.
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            <Plus size={16} />
            Add Invoice
          </button>
        </div>
      </form>
    </Modal>
  );
}
