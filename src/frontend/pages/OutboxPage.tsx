import type { OutboxRecord } from '../workflowTypes';
export default function OutboxPage({ rows }: { rows: OutboxRecord[] }) {
  return (
    <section className="card">
      <div className="section-title">
        <h2>Simulated Outbox</h2>
        <span>{rows.length} simulated records</span>
      </div>
      <p>No real messages were sent.</p>
      {!rows.length && <p>No simulated dispatches yet.</p>}
      {rows.map((row) => (
        <article className="detail-section" key={row.id}>
          <h3>
            {row.invoice_no} - version {row.version}
            {row.historical ? ' (historical)' : ''}
          </h3>
          <p>
            {row.channel} to {row.recipient_contact} -{' '}
            {new Date(row.sent_at).toLocaleString('en-GB', {
              timeZone: 'Asia/Kuala_Lumpur',
            })}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{row.approved_body}</pre>
          <small>Simulated</small>
        </article>
      ))}
    </section>
  );
}
