import { useState } from 'react';
import {
  Ban,
  CreditCard,
  MessageSquareText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  outstanding,
  daysOverdue,
  priority,
  money,
  dateLabel,
  canApprove,
  getInvoiceCustomer,
  type Invoice,
  type Role,
} from '../model';
import Modal from './Modal';

type Panel = 'payment' | 'void' | null;

/** Invoice-management popup: details plus Record payment, Void, and Review follow-up. */
export default function InvoiceActionCard({
  invoice: i,
  graceDays,
  role,
  onClose,
  onPayment,
  onVoid,
  onReview,
}: {
  invoice: Invoice;
  graceDays: number;
  role: Role;
  onClose: () => void;
  onPayment: (amount: string, receivedDate: string, reference: string) => Promise<void>;
  onVoid: (reason: string) => Promise<void>;
  onReview: () => void;
}) {
  const c = getInvoiceCustomer(i);
  const balance = outstanding(i);
  const isVoid = i.financialStatus === 'void';
  const isPaid = !isVoid && balance <= 0;
  const allowed = canApprove(role);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const statusLabel = isVoid
    ? 'Void'
    : isPaid
      ? 'Paid'
      : i.payments > 0
        ? 'Partially paid'
        : 'Open';

  const voidBlocker = isVoid
    ? 'Invoice is already void'
    : !allowed
      ? 'Only Owner and Finance can void invoices'
      : i.payments > 0
        ? 'Invoices with recorded payments cannot be voided'
        : '';
  const payBlocker = isVoid
    ? 'Void invoices cannot take payments'
    : isPaid
      ? 'Invoice is fully paid'
      : !allowed
        ? 'Only Owner and Finance can record payments'
        : '';
  const reviewBlocker = isVoid
    ? 'Void invoices are excluded from follow-up'
    : isPaid
      ? 'Nothing outstanding to follow up'
      : c.doNotContact
        ? 'Customer is marked do not contact'
        : '';

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError('');
    try {
      await action();
      setPanel(null);
      setConfirming(false);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  function toggle(next: Panel) {
    setError('');
    setConfirming(false);
    setPanel((current) => (current === next ? null : next));
  }

  return (
    <Modal title={`Invoice ${i.id}`} subtitle={c.name} onClose={onClose}>
      <div className="invoice-card" id="invoice-action-card">
        <div
          className={`invoice-card-hero status-${statusLabel.toLowerCase().replace(' ', '-')}`}
        >
          <div>
            <span className="invoice-card-label">Outstanding</span>
            <strong className="invoice-card-amount">{money(balance)}</strong>
          </div>
          <span className="invoice-card-status">{statusLabel}</span>
        </div>

        <section aria-label="Invoice details">
          <h3 className="invoice-card-section-title">Invoice details</h3>
          <dl className="invoice-card-grid">
            <div>
              <dt>Due date</dt>
              <dd>{dateLabel(i.due)}</dd>
            </div>
            <div>
              <dt>Days overdue</dt>
              <dd>{isVoid || isPaid ? '—' : daysOverdue(i)}</dd>
            </div>
            <div>
              <dt>Invoice total</dt>
              <dd>{money(i.total)}</dd>
            </div>
            <div>
              <dt>Payments received</dt>
              <dd>{money(i.payments)}</dd>
            </div>
            <div>
              <dt>Priority score</dt>
              <dd>{isVoid ? '—' : priority(i, graceDays).toLocaleString('en-MY')}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{c.doNotContact ? 'Do not contact' : c.contact || '—'}</dd>
            </div>
          </dl>
        </section>

        <div className="invoice-card-actions" role="group" aria-label="Invoice actions">
          <button
            id="card-action-payment"
            className={`button primary card-action ${panel === 'payment' ? 'active' : ''}`}
            disabled={!!payBlocker}
            title={payBlocker || 'Record a payment against this invoice'}
            aria-expanded={panel === 'payment'}
            onClick={() => toggle('payment')}
          >
            <CreditCard size={18} />
            <span>Record payment</span>
          </button>
          <button
            id="card-action-review"
            className="button card-action"
            disabled={!!reviewBlocker}
            title={reviewBlocker || 'Open the follow-up review'}
            onClick={onReview}
          >
            <MessageSquareText size={18} />
            <span>Review follow-up</span>
          </button>
          <button
            id="card-action-void"
            className={`button card-action card-action-void ${panel === 'void' ? 'active' : ''}`}
            disabled={!!voidBlocker}
            title={voidBlocker || 'Cancel this invoice permanently'}
            aria-expanded={panel === 'void'}
            onClick={() => toggle('void')}
          >
            <Ban size={18} />
            <span>Void invoice</span>
          </button>
        </div>

        {(payBlocker || voidBlocker) &&
          !isVoid &&
          !isPaid &&
          i.payments > 0 &&
          allowed && (
            <p className="invoice-card-hint">
              <ShieldCheck size={14} /> Voiding is only available before any payment is
              recorded.
            </p>
          )}

        {panel === 'payment' && (
          <form
            className="invoice-card-panel"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const amount = Number(form.get('amount'));
              const received = String(form.get('received') ?? '');
              const receivedTime = Date.parse(`${received}T00:00:00`);
              const asOf = i.asOf ?? new Date().toISOString().slice(0, 10);
              const asOfTime = Date.parse(`${asOf}T00:00:00`);
              if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
                setError(
                  'Payment must be greater than zero and no more than the outstanding balance.',
                );
                return;
              }
              if (!received || !Number.isFinite(receivedTime)) {
                setError('Choose a valid payment date.');
                return;
              }
              if (i.issueDate && received < i.issueDate) {
                setError('Payment date cannot be before the invoice issue date.');
                return;
              }
              if (receivedTime > asOfTime) {
                setError('Payment date cannot be in the future.');
                return;
              }
              void run(() =>
                onPayment(String(amount), received, String(form.get('reference') ?? '')),
              );
            }}
          >
            <h3 className="invoice-card-section-title">Record payment</h3>
            <div className="invoice-card-fields">
              <label>
                Amount (MYR)
                <input
                  id="card-payment-amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={balance}
                  defaultValue={balance.toFixed(2)}
                  required
                />
              </label>
              <label>
                Received date
                <input
                  id="card-payment-date"
                  name="received"
                  type="date"
                  min={i.issueDate}
                  max={i.asOf}
                  defaultValue={i.asOf}
                  required
                />
              </label>
              <label className="span-2">
                Reference (optional)
                <input
                  id="card-payment-reference"
                  name="reference"
                  maxLength={100}
                  placeholder="e.g. bank transfer ref"
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="invoice-card-error">
                {error}
              </p>
            )}
            <div className="invoice-card-panel-footer">
              <button type="button" className="button" onClick={() => toggle(null)}>
                Cancel
              </button>
              <button
                id="card-payment-submit"
                className="button primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save payment'}
              </button>
            </div>
          </form>
        )}

        {panel === 'void' && (
          <div className="invoice-card-panel void-panel">
            <h3 className="invoice-card-section-title">Void invoice</h3>
            <label>
              Reason for voiding
              <textarea
                id="card-void-reason"
                rows={3}
                maxLength={500}
                value={reason}
                placeholder="e.g. Duplicate invoice, replaced by INV-1042"
                onChange={(event) => {
                  setReason(event.target.value);
                  setConfirming(false);
                }}
              />
            </label>
            {confirming && (
              <p className="void-warning" role="alert">
                <TriangleAlert size={16} />
                This cannot be undone. The invoice will be removed from all follow-up
                queues.
              </p>
            )}
            {error && (
              <p role="alert" className="invoice-card-error">
                {error}
              </p>
            )}
            <div className="invoice-card-panel-footer">
              <button type="button" className="button" onClick={() => toggle(null)}>
                Cancel
              </button>
              <button
                id="card-void-submit"
                className="button danger"
                disabled={saving || reason.trim().length < 3}
                onClick={() =>
                  confirming ? void run(() => onVoid(reason.trim())) : setConfirming(true)
                }
              >
                {saving ? 'Voiding…' : confirming ? 'Confirm void' : 'Void invoice'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
