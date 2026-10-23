import { Activity, Check } from 'lucide-react';

export default function ActivityPage({ logs }: { logs: string[] }) {
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
