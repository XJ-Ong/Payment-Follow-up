import { useState, type FormEvent } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { customers, type Invoice, validateInvoice } from '../model';
import Modal from './Modal';

export default function AddInvoiceDialog({
  onClose,
  onAdd,
  invoices,
}: {
  onClose: () => void;
  onAdd: (i: Invoice) => void;
  invoices: Invoice[];
}) {
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const id = String(data.get('id')).trim();
    const total = Number(data.get('total'));
    const payments = Number(data.get('payments'));
    const due = String(data.get('due'));
    const validationError = validateInvoice({ id, total, payments, due }, invoices);
    if (validationError) return setError(validationError);
    onAdd({
      id,
      customerId: String(data.get('customer')),
      total,
      payments,
      due,
      status: 'Not started',
    });
  }
  return (
    <Modal
      title="Add an invoice"
      subtitle="Create a synthetic invoice for your demo workspace."
      onClose={onClose}
    >
      <form onSubmit={submit} className="dialog-body">
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
          <button className="button primary" type="submit">
            <Plus size={16} />
            Add Invoice
          </button>
        </div>
      </form>
    </Modal>
  );
}
