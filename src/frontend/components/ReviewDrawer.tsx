import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock3,
  FileText,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  outstanding,
  daysOverdue,
  priority,
  money,
  dateLabel,
  canApprove,
  type Invoice,
  type Role,
  type Status,
  getInvoiceCustomer,
  createReminderText,
  isReminderBlocked,
  isReminderEditable,
} from '../model';
import StatusBadge from './StatusBadge';
import Modal from './Modal';

export default function ReviewDrawer({
  invoice: i,
  graceDays,
  role,
  onClose,
  onStatus,
  databaseMode = false,
  onPayment,
}: {
  databaseMode?: boolean;
  onPayment?: (amount: string, receivedDate: string) => Promise<void>;
  invoice: Invoice;
  graceDays: number;
  role: Role;
  onClose: () => void;
  onStatus: (s: Status, text: string) => void;
}) {
  const c = getInvoiceCustomer(i);
  const [text, setText] = useState(i.reminder ?? createReminderText(i));
  const [paymentError, setPaymentError] = useState('');
  const [saving, setSaving] = useState(false);
  const blocked = isReminderBlocked(i);
  const editable = isReminderEditable(i);
  return (
    <Modal
      title="Review follow-up"
      subtitle={`${i.id} · ${c.name}`}
      onClose={onClose}
      drawer
    >
      <div className="drawer-body">
        {databaseMode && (
          <section className="detail-section">
            <p>
              Invoice and payment data is saved. Reminder workflow integration is the next
              stage.
            </p>
            <p>Financial status: {i.financialStatus}</p>
            {outstanding(i) > 0 && i.financialStatus !== 'void' && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setSaving(true);
                  setPaymentError('');
                  try {
                    await onPayment?.(
                      String(form.get('amount')),
                      String(form.get('received')),
                    );
                  } catch (err) {
                    setPaymentError(
                      err instanceof Error ? err.message : 'Unable to record payment',
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label>
                  Payment amount (MYR)
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={outstanding(i)}
                    required
                  />
                </label>
                <label>
                  Received date
                  <input name="received" type="date" defaultValue={i.asOf} required />
                </label>
                {paymentError && <p role="alert">{paymentError}</p>}
                <button className="button primary" disabled={saving}>
                  Record payment
                </button>
              </form>
            )}
          </section>
        )}

        <div className="drawer-status">
          <StatusBadge status={i.status} />
          <span className="prototype-pill">Simulated delivery</span>
        </div>
        <section className="detail-section">
          <h3>Invoice details</h3>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{c.name}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{dateLabel(i.due)}</dd>
            </div>
            <div>
              <dt>Invoice total</dt>
              <dd>{money(i.total)}</dd>
            </div>
            <div>
              <dt>Payments received</dt>
              <dd>− {money(i.payments)}</dd>
            </div>
            <div className="detail-total">
              <dt>Outstanding</dt>
              <dd>{money(outstanding(i))}</dd>
            </div>
          </dl>
        </section>
        <section className="calculation">
          <h3>
            <SlidersHorizontal size={16} />
            Priority calculation
          </h3>
          <div>
            <span>{money(outstanding(i))}</span>
            <span>×</span>
            <span>
              max(0, {daysOverdue(i)} − {graceDays})
            </span>
          </div>
          <p>
            {daysOverdue(i)} days overdue · {graceDays} customer grace days
          </p>
          <strong>
            {priority(i, graceDays).toLocaleString('en-MY')} <small>priority score</small>
          </strong>
        </section>
        {blocked ? (
          <div className="blocked-note">
            <ShieldCheck size={21} />
            <div>
              <strong>
                {c.doNotContact
                  ? 'This customer is marked do not contact'
                  : 'No outstanding balance'}
              </strong>
              <p>
                Drafts and simulated delivery are blocked. The balance remains visible for
                reporting.
              </p>
            </div>
          </div>
        ) : (
          <>
            <section className="detail-section">
              <div className="reminder-title">
                <h3>Reminder preview</h3>
                <span className="template-tag">Template</span>
              </div>
              <p className="muted">To: {c.contact}</p>
              <textarea
                aria-label="Reminder text"
                value={text}
                readOnly={!editable}
                onChange={(e) => setText(e.target.value)}
                rows={11}
              />
              <p className="text-caption">
                Template-generated text · No AI or messaging service connected
              </p>
            </section>
            <section className="approval-progress">
              <h3>Approval progress</h3>
              <div className="progress-step">
                <span
                  className={
                    i.status !== 'Not started' && i.status !== 'Snoozed' ? 'complete' : ''
                  }
                >
                  <Check size={13} />
                </span>
                <div>
                  <strong>Prepare reminder</strong>
                  <small>
                    {i.preparedBy
                      ? `Prepared by ${i.preparedBy}`
                      : 'Create a template draft'}
                  </small>
                </div>
              </div>
              <div className="progress-step">
                <span className={i.status === 'Simulated sent' ? 'complete' : ''}>
                  {i.status === 'Simulated sent' ? <Check size={13} /> : '2'}
                </span>
                <div>
                  <strong>Human approval</strong>
                  <small>Owner or Finance approval required</small>
                </div>
              </div>
              <div className="progress-step">
                <span className={i.status === 'Simulated sent' ? 'complete' : ''}>
                  {i.status === 'Simulated sent' ? <Check size={13} /> : '3'}
                </span>
                <div>
                  <strong>Simulated delivery</strong>
                  <small>
                    {i.sentOn
                      ? `Recorded ${dateLabel(i.sentOn)} · no real message sent`
                      : 'Added to the demo outbox after approval'}
                  </small>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      <div className="drawer-footer">
        {!canApprove(role) && (
          <p>
            <ShieldCheck size={14} />
            Owner and Finance can prepare and approve drafts.
          </p>
        )}
        {!databaseMode && !blocked && i.status !== 'Simulated sent' && (
          <div className="drawer-actions">
            <button
              className="button"
              disabled={i.status === 'Snoozed'}
              onClick={() => onStatus('Snoozed', text)}
            >
              <Clock3 size={15} />
              Snooze
            </button>
            {editable && i.status !== 'Draft prepared' ? (
              <button
                className="button primary"
                disabled={!text.trim()}
                onClick={() => onStatus('Draft prepared', text)}
              >
                <FileText size={16} />
                Prepare draft
              </button>
            ) : i.status === 'Draft prepared' ? (
              <button
                className="button primary"
                disabled={!text.trim()}
                onClick={() => onStatus('Needs review', text)}
              >
                Submit for review
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="button primary"
                disabled={!canApprove(role)}
                onClick={() => onStatus('Simulated sent', text)}
              >
                <ShieldCheck size={16} />
                Approve simulated send
              </button>
            )}
          </div>
        )}
        <small>Demo policy only. No real messages or payments are processed.</small>
      </div>
    </Modal>
  );
}
