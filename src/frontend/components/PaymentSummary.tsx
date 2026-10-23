import { Clock3, FileCheck2, FileText, Send, Wallet } from 'lucide-react';
import { money, type InvoiceTotals } from '../model';
import SummaryCard from './SummaryCard';

export default function PaymentSummary({ totals }: { totals: InvoiceTotals }) {
  return (
    <section className="summary-grid" aria-label="Payment summary">
      <SummaryCard
        label="Total Overdue"
        value={money(totals.overdue)}
        caption="Across all overdue invoices"
        icon={Wallet}
        color="blue"
      />
      <SummaryCard
        label="Needs Review"
        value={String(totals.review).padStart(2, '0')}
        caption="Awaiting your approval"
        icon={FileCheck2}
        color="orange"
      />
      <SummaryCard
        label="Prepared Drafts"
        value={String(totals.drafts).padStart(2, '0')}
        caption="Ready for a closer look"
        icon={FileText}
        color="violet"
      />
      <SummaryCard
        label="Simulated Sends Today"
        value={String(totals.sent).padStart(2, '0')}
        caption="No real messages sent"
        icon={Send}
        color="green"
      />
      <SummaryCard
        label="Snoozed"
        value={String(totals.snoozed).padStart(2, '0')}
        caption="Follow up another time"
        icon={Clock3}
        color="slate"
      />
    </section>
  );
}
