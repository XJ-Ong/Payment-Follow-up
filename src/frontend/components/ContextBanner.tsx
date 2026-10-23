import { FileCheck2, ShieldCheck } from 'lucide-react';

export default function ContextBanner({ reviewCount }: { reviewCount: number }) {
  return (
    <section className="context-banner">
      <span className="banner-icon">
        <FileCheck2 size={24} />
      </span>
      <div>
        <span className="banner-label">FOLLOW-UP OVERVIEW</span>
        <h2>{reviewCount} invoices need your review today</h2>
        <p>Review the suggested reminders before approving simulated delivery.</p>
      </div>
      <span className="approval-pill">
        <ShieldCheck size={14} />
        Human approval required
      </span>
    </section>
  );
}
