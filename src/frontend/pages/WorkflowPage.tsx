import { useRef } from 'react';
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
  const rows = invoices.filter((i) => invoiceStage(i, asOf) === stage);
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
          <p>Prepare / Finance approval / Owner if required / Simulate send</p>
        </div>
        <span className="prototype-pill">Simulated delivery</span>
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
            <p>Saved simulated dispatches. No real messages were sent.</p>
            {!outbox.length && (
              <div className="followup-empty">
                No sent reminders yet. Start in Ready, then complete approval and simulate
                sending.
              </div>
            )}
            {outbox.map((row) => {
              const invoice = invoices.find((i) => i.databaseId === row.invoice_id);
              return (
                <article className="followup-row" key={row.id}>
                  <div>
                    <strong>{row.invoice_no}</strong>
                    <p>{invoice ? getInvoiceCustomer(invoice).name : 'Customer'}</p>
                    {invoice && <p>Current outstanding: {money(outstanding(invoice))}</p>}
                    <small>
                      Version {row.version}
                      {row.historical ? ' - Historical' : ''} - Simulated sent
                    </small>
                    <details>
                      <summary>View saved receipt</summary>
                      <p>
                        {row.channel} to {row.recipient_contact} -{' '}
                        {new Date(row.sent_at).toLocaleString('en-GB', {
                          timeZone: 'Asia/Kuala_Lumpur',
                        })}
                      </p>
                      <pre>{row.approved_body}</pre>
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
                No reminders in {stage.toLowerCase()}.
                {stage === 'Ready'
                  ? ' Refresh to check current eligibility. Suppressed invoices remain visible on the dashboard.'
                  : ' Select another stage to continue a reminder.'}
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
