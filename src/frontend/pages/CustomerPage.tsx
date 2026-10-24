import {
  type Customer,
  money,
  type CustomerBalance,
  type GraceOverrides,
} from '../model';
import StatusBadge from '../components/StatusBadge';

export default function CustomerPage({
  customers,
  balances,
  graceOverrides,
  onEdit,
}: {
  customers: Customer[];
  balances: CustomerBalance[];
  graceOverrides: GraceOverrides;
  onEdit?: (id: string) => void;
}) {
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <h2>Customer profiles</h2>
          <p>Balances include customers marked do not contact.</p>
        </div>
        <span className="count-pill">{customers.length} customers</span>
      </div>
      <div className="customer-grid">
        {customers.map((c) => (
          <div className="customer-profile" key={c.id}>
            <span className={`avatar ${c.color}`}>{c.initials}</span>
            <h3>{c.name}</h3>
            <p>{c.contact}</p>
            <strong>
              {money(balances.find((b) => b.name === c.name)?.balance ?? 0)}
            </strong>
            <p>{graceOverrides[c.id] ?? c.graceDays} grace days</p>
            {c.profile && (
              <p>
                {c.profile.relationship_tier} / {c.profile.preferred_channel} /{' '}
                {c.profile.language} / {c.profile.tone}
              </p>
            )}
            {onEdit && (
              <button className="button" onClick={() => onEdit(c.id)}>
                Edit preferences
              </button>
            )}
            {c.doNotContact && <StatusBadge status="Do not contact" />}
          </div>
        ))}
      </div>
    </section>
  );
}
