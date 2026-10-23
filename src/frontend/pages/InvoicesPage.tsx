import { CircleAlert, Loader2, SlidersHorizontal } from 'lucide-react';
import { type Invoice, type Filters, type GraceOverrides } from '../model';
import { type Page } from '../navigation';
import EmptyState from '../components/EmptyState';
import InvoiceFilters from '../components/InvoiceFilters';
import InvoiceTable from '../components/InvoiceTable';

// These navigation views share one workspace so local filter validation survives switching between them.
export default function InvoicesPage({
  view,
  visible,
  totalCount,
  graceOverrides,
  filters,
  setFilters,
  onApply,
  onReset,
  onAdd,
  onReview,
  onRetry,
  error,
  loading,
}: {
  view: Page;
  visible: Invoice[];
  totalCount: number;
  graceOverrides: GraceOverrides;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onApply: () => void;
  onReset: () => void;
  onAdd: () => void;
  onReview: (id: string) => void;
  onRetry: () => void;
  error: boolean;
  loading: boolean;
}) {
  return (
    <>
      <InvoiceFilters
        filters={filters}
        setFilters={setFilters}
        onApply={onApply}
        onReset={onReset}
      />
      <section className="card results">
        <div className="section-title">
          <div className="title-with-count">
            <h2>
              {view === 'Simulated Outbox'
                ? 'Simulated Outbox'
                : 'Invoices Needing Follow-up'}
            </h2>
            <span className="count-pill">{visible.length} invoices</span>
          </div>
          <span className="sort-label">
            <SlidersHorizontal size={14} />
            Sorted by priority
          </span>
        </div>
        {error ? (
          <div className="empty">
            <CircleAlert size={30} className="error-icon" />
            <h3>We couldn’t refresh your invoices</h3>
            <p>This is a simulated connection error. Your demo records are safe.</p>
            <button className="button" onClick={onRetry}>
              Retry demo connection
            </button>
          </div>
        ) : loading ? (
          <div className="empty" role="status">
            <Loader2 className="spin" size={26} />
            <h3>Refreshing your workspace…</h3>
            <p>Updating the demo invoice overview.</p>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState onAdd={onAdd} />
        ) : (
          <InvoiceTable
            invoices={visible}
            totalCount={totalCount}
            graceOverrides={graceOverrides}
            onReview={onReview}
          />
        )}
      </section>
    </>
  );
}
