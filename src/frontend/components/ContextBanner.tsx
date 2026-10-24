import { FileCheck2, ShieldCheck } from 'lucide-react';

export default function ContextBanner({
  reviewCount,
  readyCount,
}: {
  reviewCount: number;
  readyCount?: number;
}) {
  return (
    <section className="context-banner">
      <span className="banner-icon">
        <FileCheck2 size={24} />
      </span>
      <div>
        <span className="banner-label">OVERVIEW</span>
        <h2>
          {readyCount !== undefined
            ? `${readyCount} invoices ready for follow-up`
            : `${reviewCount} invoices need your review today`}
        </h2>
        <p>
          {readyCount !== undefined
            ? 'Ranked by saved calculations, with contact and spacing checks applied.'
            : 'Review the suggested reminders before approving simulated delivery.'}
        </p>
      </div>
      <span className="approval-pill">
        <ShieldCheck size={14} />
        Human approval required
      </span>
    </section>
  );
}
