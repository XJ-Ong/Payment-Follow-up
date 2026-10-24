import { useEffect, useState } from 'react';
import { request } from '../api';
import type { Role } from '../model';
import type { AuditDetail, AuditPage as AuditResults } from '../auditTypes';
import { activityLabel } from '../workflowTypes';
import Modal from '../components/Modal';

const time = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const label = (key: string) =>
  key.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase());
function valueText(value: unknown): string {
  if (value === undefined) return 'Not recorded';
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
function Facts({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="audit-facts">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>{valueText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
function Changes({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return keys.length ? (
    <div className="audit-changes">
      {keys.map((key) => (
        <section key={key}>
          <h4>{label(key)}</h4>
          <div>
            <p>
              <strong>Before</strong>
              <span>{valueText(before[key])}</span>
            </p>
            <p>
              <strong>After</strong>
              <span>{valueText(after[key])}</span>
            </p>
          </div>
        </section>
      ))}
    </div>
  ) : (
    <p>No value changes were recorded.</p>
  );
}

export default function AuditPage({ role, userId }: { role: Role; userId?: string }) {
  const [filters, setFilters] = useState({
    search: '',
    date_from: '',
    date_to: '',
    actor: '',
    actor_type: '',
    action: '',
  });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<AuditResults>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<AuditDetail>();
  const [detailError, setDetailError] = useState('');
  const [detailReload, setDetailReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      request<AuditResults>(`/audit?${params}`, role, undefined, userId)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active)
            setError(e instanceof Error ? e.message : 'Unable to load audit events.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, page, reload, role, userId]);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setDetailError('');
    if (selected)
      request<AuditDetail>(`/audit/${selected}`, role, undefined, userId)
        .then((result) => {
          if (active) setDetail(result);
        })
        .catch((e) => {
          if (active)
            setDetailError(e instanceof Error ? e.message : 'Unable to load event.');
        });
    return () => {
      active = false;
    };
  }, [selected, detailReload, role, userId]);
  const update = (key: keyof typeof filters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);
  return (
    <section className="card audit-page">
      <div className="section-title">
        <div>
          <h2>Audit Log</h2>
          <p>Trace saved actions and changes. All times are Malaysia time (MYT).</p>
        </div>
        <button
          className="btn"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh log
        </button>
      </div>
      <div className="audit-filters">
        <label className="audit-search">
          Search audit log
          <input
            type="search"
            placeholder="Invoice, customer or actor name"
            value={filters.search}
            onChange={(e) => update('search', e.target.value)}
          />
        </label>
        <label>
          From date
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => update('date_from', e.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => update('date_to', e.target.value)}
          />
        </label>
        <label>
          Actor
          <select
            aria-label="Actor"
            value={filters.actor}
            onChange={(e) => update('actor', e.target.value)}
          >
            <option value="">All actors</option>
            {data?.actors.map((actor) => (
              <option key={actor.id ?? 'unattributed'} value={actor.id ?? 'unattributed'}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select
            aria-label="Action"
            value={filters.action}
            onChange={(e) => update('action', e.target.value)}
          >
            <option value="">All actions</option>
            {data?.actions.map((action) => (
              <option key={action} value={action}>
                {activityLabel(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor type
          <select
            aria-label="Actor type"
            value={filters.actor_type}
            onChange={(e) => update('actor_type', e.target.value)}
          >
            <option value="">All actor types</option>
            <option value="user">User</option>
            <option value="system">System</option>
            <option value="ai">AI</option>
          </select>
        </label>
        <button
          className="btn"
          disabled={!filtered}
          onClick={() => {
            setFilters({
              search: '',
              date_from: '',
              date_to: '',
              actor: '',
              actor_type: '',
              action: '',
            });
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </div>
      {loading ? (
        <p role="status">Loading audit events…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <p role="status">
            {data?.total ?? 0} saved events{filtered ? ' matching your filters' : ''}
          </p>
          {!data?.items.length ? (
            <p>
              {filtered
                ? 'No events match these filters. Try clearing or changing them.'
                : 'No saved audit events yet.'}
            </p>
          ) : (
            <ul className="audit-events">
              {data.items.map((event) => (
                <li key={event.id}>
                  <button onClick={() => setSelected(event.id)} className="audit-event">
                    <span>
                      <strong>{activityLabel(event.action)}</strong>
                      <span className="audit-context">
                        {event.invoice_number ??
                          (event.entity_type === 'company'
                            ? 'Company settings / imports'
                            : label(event.entity_type))}
                        {event.customer_name ? ` · ${event.customer_name}` : ''}
                      </span>
                      <span>{event.summary}</span>
                    </span>
                    <span>
                      <strong>{event.actor_name}</strong>
                      <span className="audit-context">
                        {event.actor_type === 'ai' ? 'AI' : label(event.actor_type)}
                      </span>
                      <time dateTime={event.created_at}>{time(event.created_at)}</time>
                      <span className="audit-detail-link">View details →</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <nav className="audit-pagination" aria-label="Audit pagination">
            <button
              className="btn"
              disabled={page <= 1}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 25))}
            </span>
            <button
              className="btn"
              disabled={page * 25 >= (data?.total ?? 0)}
              onClick={() => setPage((n) => n + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}
      {selected && (
        <Modal
          drawer
          title="Audit event details"
          subtitle="Saved history · Malaysia time (MYT)"
          onClose={() => setSelected(undefined)}
        >
          {detailError ? (
            <div role="alert">
              <p>{detailError}</p>
              <button className="btn" onClick={() => setDetailReload((n) => n + 1)}>
                Retry event
              </button>
            </div>
          ) : !detail ? (
            <p role="status">Loading event…</p>
          ) : (
            <div className="audit-detail">
              <h3>{activityLabel(detail.action)}</h3>
              <p>{detail.summary}</p>
              <Facts
                values={{
                  actor: detail.actor_name,
                  actor_type: detail.actor_type,
                  actor_id: detail.actor_id,
                  time: time(detail.created_at),
                  invoice: detail.invoice_number,
                  customer: detail.customer_name,
                  related_record_type: detail.entity_type,
                  related_record_id: detail.entity_id,
                  event_id: detail.id,
                  action: detail.action,
                }}
              />
              <h3>
                {detail.before_state && detail.after_state
                  ? 'Recorded changes'
                  : 'Recorded facts'}
              </h3>
              {detail.before_state && detail.after_state ? (
                <Changes before={detail.before_state} after={detail.after_state} />
              ) : (
                <>
                  <p>
                    {detail.before_state ? 'The later value' : 'The earlier value'} was
                    not recorded for this event. Only available saved facts are shown.
                  </p>
                  {detail.after_state || detail.before_state ? (
                    <Facts values={(detail.after_state ?? detail.before_state)!} />
                  ) : (
                    <p>No additional facts were recorded.</p>
                  )}
                </>
              )}
              {detail.metadata && (
                <>
                  <h3>Event metadata</h3>
                  <Facts values={detail.metadata} />
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
