import { useState } from 'react';
import { Search } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const matchingCustomers = customers.filter((customer) =>
    [customer.name, customer.contact, customer.id].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <h2>Customer profiles</h2>
          <p>Balances include customers marked do not contact.</p>
        </div>
        <span className="count-pill" role="status">
          {matchingCustomers.length} of {customers.length} customers
        </span>
      </div>
      <div className="customer-search-toolbar">
        <label className="customer-search">
          Search customers
          <div className="input-icon">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search by name, contact or customer ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        {search && (
          <button className="button" onClick={() => setSearch('')}>
            Clear search
          </button>
        )}
      </div>
      {matchingCustomers.length === 0 ? (
        <div className="empty">
          <Search size={28} aria-hidden="true" />
          <h3>{query ? 'No customers found' : 'No customer profiles yet'}</h3>
          <p>
            {query
              ? 'Try a different name, contact or customer ID.'
              : 'Customer profiles will appear here when available.'}
          </p>
        </div>
      ) : (
        <div className="customer-grid">
          {matchingCustomers.map((c) => (
            <div className="customer-profile" key={c.id}>
              <div className="customer-card-top">
                <span className={`avatar ${c.color}`}>{c.initials}</span>
                {c.doNotContact && <StatusBadge status="Do not contact" />}
              </div>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
