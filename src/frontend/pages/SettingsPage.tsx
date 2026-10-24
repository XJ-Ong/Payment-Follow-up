import type { SavedRules } from '../api';
import { Settings2 } from 'lucide-react';
import { type Customer, type GraceOverrides } from '../model';

export default function SettingsPage({
  readOnly = false,
  savedRules,
  customers,
  graceOverrides,
  failRefresh,
  onGraceChange,
  onFailRefreshChange,
}: {
  readOnly?: boolean;
  savedRules?: SavedRules | null;
  customers: Customer[];
  graceOverrides: GraceOverrides;
  failRefresh: boolean;
  onGraceChange: (customerId: string, days: number) => void;
  onFailRefreshChange: (enabled: boolean) => void;
}) {
  return (
    <section className="card settings">
      <div className="section-title">
        <div>
          <h2>Follow-up rules</h2>
          <p>Mock policy applied to all priority calculations.</p>
        </div>
        <Settings2 size={20} />
      </div>
      <div className="rule-note">
        Priority = outstanding amount Ã— max(0, days overdue âˆ’ grace days). Owner and
        Finance may approve submitted reminders. Owner and Finance may create and submit
        drafts.
      </div>
      {readOnly && (
        <div className="rule-note">
          <p>Saved rules are read-only in this milestone.</p>
          <p>
            Reminders require Finance approval. Outstanding balances above MYR{' '}
            {savedRules?.second_approval_amount ?? 'not loaded'} also require a distinct
            Owner approval. Backup Finance covers Finance leave; high-value reminders wait
            while Owner is on leave.
          </p>
          <p>
            Alert threshold: {savedRules?.alert_threshold ?? 'Not loaded'} RM-days; Safety
            rule: {savedRules?.safety_flag_days ?? 'Not loaded'} days; Reminder spacing:{' '}
            {savedRules?.min_spacing_days ?? 'Not loaded'} days per invoice; Exclude
            public holidays: {savedRules?.skip_holidays ? 'On' : 'Off'} (weekends count).
          </p>
        </div>
      )}
      {customers.map((c) => (
        <div className="rule-row" key={c.id}>
          <span>
            <strong>{c.name}</strong>
            <small>
              {c.doNotContact
                ? 'Do not contact Â· drafts and delivery blocked'
                : 'Reminders allowed'}
            </small>
          </span>
          <label>
            Grace days
            <input
              readOnly={readOnly}
              type="number"
              min="0"
              max="365"
              value={graceOverrides[c.id] ?? c.graceDays}
              onChange={(e) => onGraceChange(c.id, Number(e.target.value))}
            />
          </label>
        </div>
      ))}
      <label className="check-label">
        <input
          type="checkbox"
          checked={failRefresh}
          onChange={(e) => onFailRefreshChange(e.target.checked)}
        />
        Simulate an error on the next refresh
      </label>
      <p className="muted">
        {readOnly
          ? 'API mode uses saved rules and backend calculations in Malaysia time. Reminder approvals are a later milestone.'
          : 'Rule edits are a local demo preview and reset on reload.'}
      </p>
    </section>
  );
}
