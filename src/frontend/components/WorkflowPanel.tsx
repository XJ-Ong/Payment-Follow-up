import { nextStep } from '../followupStages';
import { reminderStatus, activityLabel } from '../workflowTypes';
import { useEffect, useState } from 'react';
import { loadVersions, sessionAuth } from '../api';
import type { Invoice, Role } from '../model';
import type { Draft, DraftAction, DraftPayload, ActivityRecord } from '../workflowTypes';

function DraftSource({ draft }: { draft: Draft }) {
  const label =
    {
      ai: 'AI-generated',
      template: 'Template-generated',
      human: 'Human-written',
    }[draft.written_by] ?? 'Source unavailable';
  const reason = draft.verification_result?.fallback_reason;
  const failedAttempt =
    typeof reason === 'string' &&
    (reason === 'verification_failed' || reason.startsWith('ai_error:'));
  return (
    <div className="draft-source">
      <span className="template-tag">{label}</span>
      {draft.written_by === 'template' && (
        <p className="text-caption">
          {failedAttempt
            ? 'AI could not produce a usable reminder. A template was used instead.'
            : 'This reminder was prepared using a template.'}
        </p>
      )}
    </div>
  );
}

export default function WorkflowPanel({
  invoice,
  role,
  userId,
  activity,
  onAction,
  onEditPreferences,
}: {
  onEditPreferences?: () => void;
  invoice: Invoice;
  role: Role;
  userId?: string;
  activity: ActivityRecord[];
  onAction: (action: DraftAction, payload: DraftPayload) => Promise<void>;
}) {
  const draft = invoice.workflow?.current;
  const latest = invoice.workflow?.latest;
  const [text, setText] = useState(draft?.body ?? '');
  const [reason, setReason] = useState('Reviewer decision');
  const [until, setUntil] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Draft[]>([]);
  useEffect(() => {
    setText(draft?.body ?? '');
  }, [draft?.id, draft?.body]);
  useEffect(() => {
    let cancelled = false;
    if (invoice.databaseId)
      loadVersions(invoice.databaseId, role, userId)
        .then((rows) => {
          if (!cancelled) setVersions(rows);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    return () => {
      cancelled = true;
    };
  }, [invoice.databaseId, latest?.id, latest?.status, role, userId]);
  async function act(action: DraftAction) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onAction(action, {
        ...(['versions', 'edit-approve'].includes(action) ? { body: text } : {}),
        ...(['skip', 'snooze'].includes(action) ? { reason } : {}),
        ...(action === 'snooze' ? { snooze_until: until } : {}),
      });
      setEditing(false);
      setDefer(null);
      setMore(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save reminder');
    } finally {
      setBusy(false);
    }
  }
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const [defer, setDefer] = useState<'skip' | 'snooze' | null>(null);
  const shown = draft ?? latest;
  const dirty = !!draft && text !== draft.body;
  const allowed = draft?.allowed_actions ?? [];
  const singleApproval = shown?.required_approvals === 1;
  const primary = dirty
    ? allowed.includes('versions')
      ? 'versions'
      : null
    : allowed.includes('send')
      ? 'send'
      : draft?.status === 'draft'
        ? allowed.includes('submit')
          ? 'submit'
          : null
        : allowed.includes('approve')
          ? 'approve'
          : allowed.includes('send')
            ? 'send'
            : null;
  const labels: Record<string, string> = {
    versions: 'Save draft',
    submit: 'Submit for Finance approval',
    approve: 'Approve current version',
    send: draft?.channel === 'Telegram' ? 'Send via Telegram' : 'Simulate send',
  };
  const progress = singleApproval
    ? ['Prepare', 'Send', 'Sent']
    : ['Prepare', 'Finance approval', 'Owner approval', 'Ready to send', 'Sent'];
  const position =
    shown?.status === 'sent'
      ? progress.length - 1
      : singleApproval
        ? dirty || !draft
          ? 0
          : 1
        : shown?.status === 'approved'
          ? progress.length - 2
          : shown?.status === 'pending_second_approval'
            ? 2
            : shown?.status === 'pending_approval'
              ? 1
              : 0;
  return (
    <section className="detail-section workflow-panel">
      <h3>Reminder journey</h3>
      {onEditPreferences && (
        <section aria-label="Customer reminder preferences">
          <h4>Customer preferences</h4>
          <p>
            {invoice.customer?.profile
              ? `${invoice.customer.profile.language} ? ${invoice.customer.profile.tone} ? ${invoice.customer.profile.preferred_channel}`
              : 'Preferences are not available. Open the editor to load saved values.'}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  'Discard unsaved reminder text and edit customer preferences?',
                )
              ) {
                onEditPreferences();
              }
            }}
          >
            Edit customer preferences
          </button>
          <p className="text-caption">
            Changes apply to future reminders for this customer and may invalidate
            existing drafts and approvals.
          </p>
        </section>
      )}
      <ol className="journey-progress" aria-label="Reminder progress">
        {progress.map((step, index) => (
          <li
            key={step}
            aria-current={position === index ? 'step' : undefined}
            className={index < position ? 'complete' : ''}
          >
            <span>{index < position ? '✓' : index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className="journey-next" role="status">
        <strong>
          {draft
            ? singleApproval && !draft.delivery
              ? 'Ready to send'
              : reminderStatus(draft.status)
            : latest
              ? reminderStatus(latest.status)
              : invoice.calculation?.eligible
                ? 'Ready to prepare'
                : 'Not currently eligible'}
        </strong>
        <p>
          Next: {dirty ? 'Save a new version by Finance or Owner' : nextStep(invoice)}
        </p>
        {draft?.assigned_approver_name && !allowed.includes('approve') && (
          <p>
            {sessionAuth ? (
              <>
                Waiting for {draft.assigned_approver_name}. Only the assigned approver can
                review this reminder.
              </>
            ) : (
              <>
                To review, select {draft.assigned_approver_name} using Demo identity. Your
                identity will not change automatically.
              </>
            )}
          </p>
        )}
        {singleApproval && <p>Sending also records your approval.</p>}
        {draft?.waiting_reason && <p>{draft.waiting_reason}</p>}
        {latest?.status === 'invalidated' && !draft && (
          <p>
            Invoice or recipient facts changed. Previous approvals cannot be reused.
            Prepare a fresh reminder when eligible.
          </p>
        )}
        {invoice.workflow?.suppressed_until && (
          <p>
            Deferred until {invoice.workflow.suppressed_until} (Malaysia):{' '}
            {invoice.workflow.suppression_reason}
          </p>
        )}
        {!draft &&
          !invoice.calculation?.eligible &&
          invoice.calculation?.exclusion_reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
      </div>
      {!draft && invoice.calculation?.eligible && (
        <div>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void act('create')}
          >
            {busy ? 'Preparing...' : 'Create reminder draft'}
          </button>
          <p className="text-caption">
            Uses AI when configured; otherwise uses a template. Review the message before
            approval.
          </p>
        </div>
      )}
      {shown && (
        <>
          <p>
            Version {shown.version} - Prepared by {shown.author_name}
            {shown.historical ? ' - Historical record, not dispatchable' : ''}
          </p>
          <DraftSource draft={shown} />
          <dl className="reminder-recipient">
            <div>
              <dt>Recipient</dt>
              <dd>{shown.recipient}</dd>
            </div>
            <div>
              <dt>Preferences</dt>
              <dd>
                {shown.channel} - {shown.language} - {shown.tone}
              </dd>
            </div>
          </dl>
          {draft && (draft.status === 'draft' || editing) ? (
            <label>
              Saved reminder text
              <textarea
                aria-label="Saved reminder text"
                value={text}
                readOnly={!allowed.includes('versions')}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                disabled={busy}
              />
            </label>
          ) : (
            <div className="approved-message">
              <strong>
                {shown.status === 'approved'
                  ? shown.channel === 'Telegram'
                    ? 'Approved preview - real Telegram delivery'
                    : 'Approved preview - simulated delivery only'
                  : 'Saved reminder message'}
              </strong>
              <pre>{shown.body}</pre>
            </div>
          )}
          {draft && (
            <>
              {dirty && (
                <p role="status">
                  Unsaved edits. Save a new version before continuing; previous approvals
                  will not carry over.
                </p>
              )}
              <div className="approval-summary">
                <strong>
                  {singleApproval
                    ? 'Approval recorded when sent'
                    : 'Approval progress - '}{' '}
                  {!singleApproval && (
                    <>
                      {
                        shown.approvals.filter(
                          (a) =>
                            ['approve', 'edit_approve'].includes(a.decision) &&
                            !a.historical,
                        ).length
                      }{' '}
                      / {shown.required_approvals}
                    </>
                  )}
                </strong>
                <ul>
                  {shown.approvals.map((a) => (
                    <li key={a.id}>
                      {a.historical
                        ? 'Historical approval'
                        : singleApproval
                          ? 'Sender approval'
                          : a.approval_step === 1
                            ? 'Finance'
                            : 'Owner'}
                      : {a.approver_name} - {a.decision} -{' '}
                      {new Date(a.decided_at).toLocaleString('en-GB', {
                        timeZone: 'Asia/Kuala_Lumpur',
                      })}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="drawer-actions journey-actions">
                {primary && !defer && (
                  <button
                    className="button primary"
                    disabled={busy || (dirty && !text.trim())}
                    onClick={() => void act(primary as DraftAction)}
                  >
                    {busy
                      ? primary === 'send'
                        ? 'Sending...'
                        : 'Saving...'
                      : labels[primary]}
                  </button>
                )}
                {allowed.includes('versions') && draft.status !== 'draft' && !editing && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setEditing(true)}
                  >
                    Edit reminder
                  </button>
                )}
                {editing && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setText(draft.body);
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                {allowed.some((a) => ['skip', 'snooze'].includes(a)) && (
                  <button
                    className="button"
                    aria-expanded={more}
                    disabled={busy}
                    onClick={() => setMore(!more)}
                  >
                    More actions
                  </button>
                )}
              </div>
              {editing && (
                <p>
                  {singleApproval
                    ? 'Editing creates a new version. Sending the saved version records your approval.'
                    : 'Editing creates a new version and resets approval to Finance.'}
                </p>
              )}
              {editing && dirty && allowed.includes('edit-approve') && (
                <button
                  className="button"
                  disabled={busy || !text.trim()}
                  onClick={() => void act('edit-approve')}
                >
                  Edit and approve new version
                </button>
              )}
              {more && (
                <div className="drawer-actions">
                  {(['skip', 'snooze'] as const)
                    .filter((a) => allowed.includes(a))
                    .map((a) => (
                      <button
                        className="button"
                        key={a}
                        disabled={busy}
                        onClick={() => setDefer(a)}
                      >
                        {a === 'skip' ? 'Skip today' : 'Snooze'}
                      </button>
                    ))}
                </div>
              )}
              {defer && (
                <form
                  className="defer-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(defer);
                  }}
                >
                  <h4>
                    {defer === 'skip'
                      ? 'Skip until the next Malaysia day'
                      : 'Snooze reminder'}
                  </h4>
                  <label>
                    Decision reason
                    <input
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={1000}
                      disabled={busy}
                    />
                  </label>
                  {defer === 'snooze' && (
                    <label>
                      Snooze until (Malaysia date)
                      <input
                        type="date"
                        required
                        min={
                          invoice.asOf
                            ? new Date(new Date(invoice.asOf).getTime() + 86400000)
                                .toISOString()
                                .slice(0, 10)
                            : undefined
                        }
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => setDefer(null)}
                  >
                    Cancel
                  </button>
                  <button className="button primary" disabled={busy}>
                    Confirm {defer}
                  </button>
                </form>
              )}
              {!primary && !dirty && (
                <p>
                  {draft.waiting_reason ??
                    (draft.assigned_approver_name
                      ? `Waiting for ${draft.assigned_approver_name} to approve.`
                      : 'No next action is assigned to this user.')}
                </p>
              )}
            </>
          )}
          {shown.status === 'sent' && (
            <div className="journey-next">
              <strong>
                {shown.channel === 'Telegram'
                  ? 'Telegram delivery saved'
                  : 'Simulated dispatch saved'}
              </strong>
              <p>
                The exact approved body and recipient are recorded in Follow-ups / Sent.
                {shown.channel === 'Telegram'
                  ? 'Telegram accepted this message. This is not a read receipt.'
                  : 'No real message was delivered.'}
              </p>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {shown?.delivery && (
        <div className="journey-next" role="status">
          <strong>Telegram delivery: {shown.delivery.status}</strong>
          {shown.delivery.provider_message_id && (
            <p>Telegram message ID: {shown.delivery.provider_message_id}</p>
          )}
          {shown.delivery.error_code && <p>Result: {shown.delivery.error_code}</p>}
          {shown.delivery.retry_after_seconds != null && (
            <p>
              Provider waiting period: {shown.delivery.retry_after_seconds} seconds. No
              automatic retry.
            </p>
          )}
          {shown.delivery.status === 'unknown' && (
            <p>
              The message may have been accepted. Do not resend; check Telegram before
              resolving this delivery.
            </p>
          )}
          {shown.delivery.status === 'sending' && (
            <p>Delivery is in progress. Refresh the workspace to check the result.</p>
          )}
        </div>
      )}
      <details>
        <summary>Draft version history ({versions.length})</summary>
        {versions.map((v) => (
          <article key={v.id}>
            <strong>
              Version {v.version} - {reminderStatus(v.status)}
              {v.historical ? ' (historical)' : ''}
            </strong>
            <p>{v.author_name}</p>
            <DraftSource draft={v} />
            <pre style={{ whiteSpace: 'pre-wrap' }}>{v.body}</pre>
            <ul>
              {v.approvals.map((a) => (
                <li key={a.id}>
                  {a.historical
                    ? 'Historical approval'
                    : v.required_approvals === 1
                      ? 'Sender approval'
                      : `Step ${a.approval_step}`}
                  : {a.approver_name} - {a.decision} -{' '}
                  {new Date(a.decided_at).toLocaleString('en-GB', {
                    timeZone: 'Asia/Kuala_Lumpur',
                  })}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </details>
      <details>
        <summary>Invoice activity timeline</summary>
        {activity
          .filter((a) => a.invoice_id === invoice.databaseId)
          .map((a) => (
            <p key={a.id}>
              {activityLabel(a.action)} - {a.actor_name} -{' '}
              {new Date(a.created_at).toLocaleString('en-GB', {
                timeZone: 'Asia/Kuala_Lumpur',
              })}
              {a.details?.reason ? ` - ${a.details.reason}` : ''}
            </p>
          ))}
      </details>
    </section>
  );
}
