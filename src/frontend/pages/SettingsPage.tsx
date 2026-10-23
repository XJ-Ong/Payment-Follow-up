import { Settings2 } from 'lucide-react';
import { type Customer, type GraceOverrides } from '../model';

export default function SettingsPage({
  customers,
  graceOverrides,
  failRefresh,
  onGraceChange,
  onFailRefreshChange,
}: {
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
        Priority = outstanding amount × max(0, days overdue − grace days). Owner and
        Finance may approve submitted reminders. Owner and Finance may create and submit
        drafts.
      </div>
      {customers.map((c) => (
        <div className="rule-row" key={c.id}>
          <span>
            <strong>{c.name}</strong>
            <small>
              {c.doNotContact
                ? 'Do not contact · drafts and delivery blocked'
                : 'Reminders allowed'}
            </small>
          </span>
          <label>
            Grace days
            <input
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
        Rule edits are a local preview and reset on reload. In API mode, invoices and
        payments persist and overdue calculations use the Malaysia date.
      </p>
    </section>
  );
}
