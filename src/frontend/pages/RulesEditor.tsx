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
    <section className="card">
      <div className="section-title">
        <div>
          <h2>Follow-up rules</h2>
          <p>Saved policy used by all invoices in this company.</p>
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
            <h3>Grace days by relationship tier</h3>
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
                  onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })}
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
                  value={Number.isNaN(form.safety_flag_days) ? '' : form.safety_flag_days}
                  onChange={(e) =>
                    setForm({ ...form, safety_flag_days: e.target.valueAsNumber })
                  }
                />
              </label>
              <label>
                Reminder spacing (days)
                <input
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  required
                  readOnly={!editable}
                  value={Number.isNaN(form.min_spacing_days) ? '' : form.min_spacing_days}
                  onChange={(e) =>
                    setForm({ ...form, min_spacing_days: e.target.valueAsNumber })
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
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.skip_holidays}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, skip_holidays: e.target.checked })}
              />
              Exclude public holidays from overdue days
            </label>
            <p>
              Weekends count. Priority = outstanding balance × max(0, overdue days − grace
              days). High-value reminders require Finance then a distinct Owner when the
              outstanding balance is strictly above the threshold.
            </p>
          </fieldset>
        )}
        {saved && (
          <div className="rule-note">
            <h3>Approver assignments (read-only)</h3>
            <p>Primary Finance: {approver(saved.primary_approver_id)}</p>
            <p>Backup Finance: {approver(saved.backup_approver_id)}</p>
            <p>Owner: {approver(saved.owner_approver_id)}</p>
            <p>
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
          <div className="drawer-actions">
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
