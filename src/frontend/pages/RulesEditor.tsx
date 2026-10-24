import { useEffect, useState } from 'react';
import { ApiError, getRules, rulesInput, type SavedRules } from '../api';
import type { Role } from '../model';
import type { DemoUser } from '../workflowTypes';
import type { RulesInput } from '../settingsTypes';

export default function RulesEditor({
  role,
  userId,
  users,
  onSave,
}: {
  role: Role;
  userId?: string;
  users: DemoUser[];
  onSave: (input: RulesInput) => Promise<SavedRules>;
}) {
  const [saved, setSaved] = useState<SavedRules | null>(null);
  const [form, setForm] = useState<RulesInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const editable = role === 'Owner';
  useEffect(() => {
    let cancelled = false;
    getRules(role, userId)
      .then((r) => {
        if (!cancelled) {
          setSaved(r);
          setForm(rulesInput(r));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, userId]);
  async function reload() {
    setLoading(true);
    setError('');
    try {
      const r = await getRules(role, userId);
      setSaved(r);
      setForm(rulesInput(r));
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load rules');
    } finally {
      setLoading(false);
    }
  }
  const approver = (id?: string | null) =>
    users.find((u) => u.id === id)?.name ?? id ?? 'Not configured';
  return (
    <section className="card rules-settings">
      <div className="section-title">
        <div>
          <h2>Follow-up rules</h2>
          <p>Saved policy for all invoices.</p>
        </div>
      </div>
      <form
        className="config-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form || busy || !editable) return;
          setBusy(true);
          setError('');
          try {
            const r = await onSave(form);
            setSaved(r);
            setForm(rulesInput(r));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to save rules');
            setConflict(e instanceof ApiError && e.status === 409);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!editable && (
          <p className="rule-note">
            Only Owner can edit company-wide rules. Finance can view saved values and edit
            customer preferences.
          </p>
        )}
        {loading && <p role="status">Loading saved rules…</p>}
        {form && (
          <fieldset disabled={busy || loading}>
            <div className="settings-group">
              <div className="settings-group-heading">
                <h3>Grace periods</h3>
                <p>
                  Set how many days each relationship tier receives before follow-up
                  begins.
                </p>
              </div>
              <div className="config-grid">
                {(['New', 'Regular', 'Key'] as const).map((t) => (
                  <label key={t}>
                    {t} grace days
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                      required
                      readOnly={!editable}
                      value={
                        Number.isNaN(form.grace_days_by_tier[t])
                          ? ''
                          : form.grace_days_by_tier[t]
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          grace_days_by_tier: {
                            ...form.grace_days_by_tier,
                            [t]: e.target.valueAsNumber,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-heading">
                <h3>Alerts &amp; approvals</h3>
                <p>Choose when balances need attention and an additional approval.</p>
              </div>
              <div className="config-grid">
                <label>
                  Alert threshold (RM-days)
                  <input
                    type="number"
                    min="0"
                    max="999999999999.99"
                    step="0.01"
                    required
                    readOnly={!editable}
                    value={form.alert_threshold}
                    onChange={(e) =>
                      setForm({ ...form, alert_threshold: e.target.value })
                    }
                  />
                </label>
                <label>
                  Safety days
                  <input
                    type="number"
                    min="1"
                    max="2147483647"
                    step="1"
                    required
                    readOnly={!editable}
                    value={
                      Number.isNaN(form.safety_flag_days) ? '' : form.safety_flag_days
                    }
                    onChange={(e) =>
                      setForm({ ...form, safety_flag_days: e.target.valueAsNumber })
                    }
                  />
                </label>
                <label>
                  High-value approval threshold (MYR)
                  <input
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step="0.01"
                    required
                    readOnly={!editable}
                    value={form.second_approval_amount}
                    onChange={(e) =>
                      setForm({ ...form, second_approval_amount: e.target.value })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-heading">
                <h3>Reminder schedule</h3>
                <p>
                  Control the interval between reminders and how overdue days are counted.
                </p>
              </div>
              <div className="config-grid">
                <label>
                  Reminder spacing (days)
                  <input
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    required
                    readOnly={!editable}
                    value={
                      Number.isNaN(form.min_spacing_days) ? '' : form.min_spacing_days
                    }
                    onChange={(e) =>
                      setForm({ ...form, min_spacing_days: e.target.valueAsNumber })
                    }
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.skip_holidays}
                  disabled={!editable}
                  onChange={(e) => setForm({ ...form, skip_holidays: e.target.checked })}
                />
                Exclude public holidays from overdue days
              </label>
              <p className="settings-help">
                Weekends count as overdue days. Priority is the outstanding balance
                multiplied by overdue days after the grace period. High-value reminders
                require Finance approval followed by a different Owner when the balance is
                above the threshold.
              </p>
            </div>
          </fieldset>
        )}
        {saved && (
          <div className="settings-group approver-settings">
            <div className="settings-group-heading">
              <h3>Approver assignments</h3>
              <p>
                Assigned reviewers for company reminders. These assignments are read-only.
              </p>
            </div>
            <div className="approver-grid">
              <div>
                <span>Primary Finance</span>
                <strong>{approver(saved.primary_approver_id)}</strong>
              </div>
              <div>
                <span>Backup Finance</span>
                <strong>{approver(saved.backup_approver_id)}</strong>
              </div>
              <div>
                <span>Owner</span>
                <strong>{approver(saved.owner_approver_id)}</strong>
              </div>
            </div>
            <p className="settings-help">
              Backup Finance covers Finance leave. High-value reminders wait while Owner
              is on leave.
            </p>
          </div>
        )}
        <p className="rule-note">
          Unsaved changes do not affect rankings. Saving recalculates all invoices;
          reminders with outdated eligibility or approval policy are invalidated, with
          their history retained.
        </p>
        {error && <p role="alert">{error}</p>}
        {(conflict || (!form && !loading)) && (
          <>
            <button
              className="button"
              type="button"
              disabled={busy || loading}
              onClick={() => void reload()}
            >
              Reload saved values
            </button>
            <p>Reload replaces your edits with the latest saved values.</p>
          </>
        )}
        {editable && (
          <div className="drawer-actions settings-actions">
            <button
              className="button"
              type="button"
              disabled={busy || loading || !saved}
              onClick={() => {
                if (saved) setForm(rulesInput(saved));
                setError('');
                setConflict(false);
              }}
            >
              Cancel changes
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                loading ||
                conflict ||
                !form ||
                JSON.stringify(form) === JSON.stringify(saved && rulesInput(saved))
              }
            >
              {busy ? 'Saving…' : 'Save and recalculate'}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
