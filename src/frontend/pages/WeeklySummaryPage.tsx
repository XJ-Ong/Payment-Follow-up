import { CalendarDays, CheckCheck, FileCheck2, Wallet } from 'lucide-react';
import { money, type InvoiceTotals } from '../model';

export default function WeeklySummaryPage({ totals }: { totals: InvoiceTotals }) {
  return (
    <section className="card weekly">
      <div className="section-title">
        <div>
          <h2>This week at a glance</h2>
          <p>Snapshot of current records · 19–25 Oct 2026</p>
        </div>
        <CalendarDays size={20} />
      </div>
      <div className="weekly-body">
        <div>
          <span className="summary-icon green">
            <CheckCheck size={24} />
          </span>
          <h3>
            {totals.sent} simulated reminder{totals.sent !== 1 ? 's' : ''}
          </h3>
          <p>Recorded today in the simulated outbox.</p>
        </div>
        <div>
          <span className="summary-icon orange">
            <FileCheck2 size={24} />
          </span>
          <h3>{totals.review} pending approvals</h3>
          <p>Ready for Owner or Finance to review.</p>
        </div>
        <div>
          <span className="summary-icon blue">
            <Wallet size={24} />
          </span>
          <h3>{money(totals.overdue)}</h3>
          <p>Outstanding on overdue invoices.</p>
        </div>
      </div>
    </section>
  );
}
