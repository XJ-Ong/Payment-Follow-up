import { activityLabel } from '../workflowTypes';
import type { ActivityRecord } from '../workflowTypes';
import { Activity, Check } from 'lucide-react';

export default function ActivityPage({
  logs,
  records,
}: {
  logs: string[];
  records?: ActivityRecord[];
}) {
  if (records)
    return (
      <section className="card">
        <div className="section-title">
          <h2>Workspace activity</h2>
          <span>{records.length} saved events</span>
        </div>
        <div className="activity-list">
          {records.map((row) => (
            <div key={row.id}>
              <span>
                <strong>{activityLabel(row.action)}</strong>
                <small>
                  {row.actor_name} -{' '}
                  {new Date(row.created_at).toLocaleString('en-GB', {
                    timeZone: 'Asia/Kuala_Lumpur',
                  })}
                </small>
                {row.details?.reason ? <p>{String(row.details.reason)}</p> : null}
              </span>
            </div>
          ))}
          {!records.length && <p>No saved activity yet.</p>}
        </div>
      </section>
    );
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <h2>Workspace activity</h2>
          <p>Actions from this demo session.</p>
        </div>
        <Activity size={20} />
      </div>
      <div className="activity-list">
        {logs.map((l, n) => (
          <div key={n}>
            <span className="activity-icon">
              <Check size={16} />
            </span>
            <span>
              <strong>{l}</strong>
              <small>22 Oct 2026 · Demo session</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
