import { useMemo, useRef, useState } from 'react';
import { Check, Search, Send, X } from 'lucide-react';
import { getInvoiceCustomer, money, outstanding, type Invoice } from '../model';
import { reminderStatus, type OutboxRecord } from '../workflowTypes';
import { invoiceStage, nextStep, stages, type FollowupStage } from '../followupStages';

export default function WorkflowPage({
  invoices,
  outbox,
  stage,
  asOf,
  loading,
  error,
  onRetry,
  onStage,
  onReview,
}: {
  invoices: Invoice[];
  outbox: OutboxRecord[];
  stage: FollowupStage;
  asOf: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onStage: (stage: FollowupStage) => void;
  onReview: (id: string) => void;
}) {
  const tabs = useRef<HTMLDivElement>(null);
  const [customerFilter, setCustomerFilter] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const normalizedCustomer = customerFilter.trim().toLowerCase();
  const normalizedInvoice = invoiceFilter.trim().toLowerCase();
  const matchesInvoice = (invoice: Invoice | undefined) =>
    !!invoice &&
    (!normalizedCustomer ||
      getInvoiceCustomer(invoice).name.toLowerCase().includes(normalizedCustomer)) &&
    (!normalizedInvoice || invoice.id.toLowerCase().includes(normalizedInvoice));
  const rows = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoiceStage(invoice, asOf) === stage && matchesInvoice(invoice),
      ),
    [invoices, asOf, stage, normalizedCustomer, normalizedInvoice],
  );
  const sentRows = useMemo(
    () =>
      outbox.filter((row) =>
        matchesInvoice(invoices.find((invoice) => invoice.databaseId === row.invoice_id)),
      ),
    [outbox, invoices, normalizedCustomer, normalizedInvoice],
  );
  const hasFilters = Boolean(normalizedCustomer || normalizedInvoice);
  const actions = {
    Ready: 'Prepare reminder',
    Drafts: 'Continue draft',
    'Awaiting approval': 'Review approval',
    'Ready to send': 'Preview and send',
    Sent: 'View receipt',
    Deferred: 'View deferral',
  };
  return (
    <section className="card followups-workspace">
      <div className="section-title">
        <div>
          <h2>Follow-ups</h2>
          <p>
            Prepare / Send (one approval) / Finance then Owner approval (two approvals)
          </p>
        </div>
        <span className="prototype-pill">Telegram live / WhatsApp & Email simulated</span>
      </div>
      <div
        className="followup-tabs"
        role="tablist"
        aria-label="Reminder stages"
        ref={tabs}
      >
        {stages.map((item, index) => (
          <button
            key={item}
            id={`stage-${index}`}
            role="tab"
            aria-selected={stage === item}
            aria-controls="followup-stage-panel"
            tabIndex={stage === item ? 0 : -1}
            onClick={() => onStage(item)}
            onKeyDown={(event) => {
              const offset =
                event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              const target =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? stages.length - 1
                    : (index + offset + stages.length) % stages.length;
              if (!offset && !['Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              onStage(stages[target]);
              tabs.current?.querySelectorAll<HTMLButtonElement>('button')[target].focus();
            }}
          >
            {item}{' '}
            <span>
              {item === 'Sent'
                ? outbox.length
                : invoices.filter((i) => invoiceStage(i, asOf) === item).length}
            </span>
          </button>
        ))}
      </div>
      <div className="followup-filters" aria-label="Filter follow-ups">
        <label>
          <span>Customer</span>
          <div className="followup-filter-input">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Filter by customer"
              placeholder="Search customer"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
            />
          </div>
        </label>
        <label>
          <span>Invoice</span>
          <div className="followup-filter-input">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Filter by invoice number"
              placeholder="Search invoice"
              value={invoiceFilter}
              onChange={(event) => setInvoiceFilter(event.target.value)}
            />
          </div>
        </label>
        {hasFilters && (
          <button
            className="button followup-filter-clear"
            type="button"
            onClick={() => {
              setCustomerFilter('');
              setInvoiceFilter('');
            }}
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id="followup-stage-panel"
        aria-labelledby={`stage-${stages.indexOf(stage)}`}
        aria-busy={loading}
      >
        {loading ? (
          <p role="status">Loading saved follow-ups...</p>
        ) : error ? (
          <div role="alert">
            <p>Could not refresh follow-ups. Your last loaded results are retained.</p>
            <button className="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : stage === 'Sent' ? (
          <>
            <p>
              Saved delivery receipts. Telegram is real delivery; Email and WhatsApp
              receipts are simulated.
            </p>
            {!sentRows.length && (
              <div className="followup-empty">
                {hasFilters
                  ? 'No sent reminders match these filters.'
                  : 'No sent reminders yet. Start in Ready, then complete approval and send.'}
              </div>
            )}
            {sentRows.map((row) => {
              const invoice = invoices.find((i) => i.databaseId === row.invoice_id);
              return (
                <article className="followup-row" key={row.id}>
                  <div>
                    <strong>{row.invoice_no}</strong>
                    <p>{invoice ? getInvoiceCustomer(invoice).name : 'Customer'}</p>
                    {invoice && <p>Current outstanding: {money(outstanding(invoice))}</p>}
                    <small>
                      Version {row.version}
                      {row.historical ? ' - Historical' : ''} -{' '}
                      {row.status === 'sent' ? 'Telegram accepted' : 'Simulated sent'}
                    </small>
                    <details>
                      <summary>View saved receipt</summary>
                      <section
                        className="receipt-chat"
                        aria-label={`Saved message to ${row.recipient_contact}`}
                      >
                        <div className="receipt-chat-header">
                          <span className="receipt-chat-avatar" aria-hidden="true">
                            {invoice ? (
                              getInvoiceCustomer(invoice).initials
                            ) : (
                              <Send size={20} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {invoice
                                ? getInvoiceCustomer(invoice).name
                                : row.recipient_contact}
                            </strong>
                            <span>
                              {row.channel} / {row.recipient_contact}
                            </span>
                          </div>
                          <span className="receipt-chat-status">
                            {row.status === 'sent'
                              ? 'Telegram accepted'
                              : 'Simulated sent'}
                          </span>
                        </div>
                        <div className="receipt-chat-body">
                          <time className="receipt-chat-date" dateTime={row.sent_at}>
                            {new Date(row.sent_at).toLocaleDateString('en-GB', {
                              timeZone: 'Asia/Kuala_Lumpur',
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </time>
                          <div className="receipt-message">
                            <p className="receipt-message-text">{row.approved_body}</p>
                            <div className="receipt-message-meta">
                              <time dateTime={row.sent_at}>
                                {new Date(row.sent_at).toLocaleTimeString('en-GB', {
                                  timeZone: 'Asia/Kuala_Lumpur',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                              <Check size={15} aria-hidden="true" />
                              <span className="sr-only">
                                {row.status === 'sent'
                                  ? 'Telegram accepted'
                                  : 'Simulated sent'}
                              </span>
                            </div>
                          </div>
                          <p className="receipt-chat-caption">
                            Saved receipt / Malaysia time /{' '}
                            {row.status === 'sent'
                              ? `Telegram message ID: ${row.provider_message_id ?? 'not recorded'}. Acceptance is not a read receipt.`
                              : 'No real message was sent'}
                          </p>
                        </div>
                      </section>
                      {invoice && (
                        <button className="button" onClick={() => onReview(invoice.id)}>
                          View reminder history
                        </button>
                      )}
                    </details>
                  </div>
                </article>
              );
            })}
          </>
        ) : (
          <>
            {!rows.length && (
              <div className="followup-empty">
                {hasFilters
                  ? 'No reminders match these filters.'
                  : `No reminders in ${stage.toLowerCase()}. ${
                      stage === 'Ready'
                        ? 'Refresh to check current eligibility. Suppressed invoices remain visible on the dashboard.'
                        : 'Select another stage to continue a reminder.'
                    }`}
              </div>
            )}
            {rows.map((invoice) => (
              <article className="followup-row" key={invoice.id}>
                <div>
                  <strong>{getInvoiceCustomer(invoice).name}</strong>
                  <p>
                    {invoice.id} - {money(outstanding(invoice))} outstanding
                  </p>
                  <span className="stage-label">
                    {invoice.workflow?.current
                      ? reminderStatus(invoice.workflow.current.status)
                      : stage}
                  </span>
                  <p className="muted">
                    {stage === 'Deferred'
                      ? `Deferred until ${invoice.workflow?.suppressed_until} (Malaysia) - ${invoice.workflow?.suppression_reason}`
                      : `Next: ${nextStep(invoice)}`}
                  </p>
                </div>
                <button className="button primary" onClick={() => onReview(invoice.id)}>
                  {actions[stage]}
                </button>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
