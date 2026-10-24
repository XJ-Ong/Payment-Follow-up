import { useState } from 'react';
import { demoMode } from '../api';
import { CircleAlert, Loader2, SlidersHorizontal } from 'lucide-react';
import {
  type Invoice,
  type Filters,
  type GraceOverrides,
  getInvoiceCustomer,
  outstanding,
  daysOverdue,
} from '../model';
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
  onImport,
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
  onImport?: () => void;
  onReview: (id: string) => void;
  onRetry: () => void;
  error: boolean;
  loading: boolean;
}) {
  const [sortBy, setSortBy] = useState('priority');
  const canSort = view === 'Invoices & Payments';
  const sortedInvoices =
    canSort && sortBy !== 'priority'
      ? [...visible].sort((a, b) => {
          let difference = 0;
          switch (sortBy) {
            case 'invoice-asc':
              difference = a.id.localeCompare(b.id, undefined, { numeric: true });
              break;
            case 'invoice-desc':
              difference = b.id.localeCompare(a.id, undefined, { numeric: true });
              break;
            case 'customer':
              difference = getInvoiceCustomer(a).name.localeCompare(
                getInvoiceCustomer(b).name,
              );
              break;
            case 'due-asc':
              difference = a.due.localeCompare(b.due);
              break;
            case 'due-desc':
              difference = b.due.localeCompare(a.due);
              break;
            case 'balance-desc':
              difference = outstanding(b) - outstanding(a);
              break;
            case 'balance-asc':
              difference = outstanding(a) - outstanding(b);
              break;
            case 'overdue':
              difference = daysOverdue(b) - daysOverdue(a);
              break;
          }
          return difference || a.id.localeCompare(b.id, undefined, { numeric: true });
        })
      : visible;
  return (
    <>
      {onImport && (
        <section className="card invoice-import-toolbar">
          <div>
            <strong>Bulk invoice entry</strong>
            <p>
              Upload the fixed CSV template, review every row, then import all invoices
              together.
            </p>
          </div>
          <button className="button" disabled={loading} onClick={onImport}>
            Import CSV
          </button>
        </section>
      )}
      <InvoiceFilters
        filters={filters}
        setFilters={setFilters}
        onApply={onApply}
        onReset={() => {
          setSortBy('priority');
          onReset();
        }}
      />
      <section className="card results">
        <div className="section-title invoice-results-heading">
          <div className="title-with-count">
            <h2>
              {view === 'Simulated Outbox'
                ? 'Simulated Outbox'
                : !demoMode && view === 'Dashboard'
                  ? 'Overdue Invoice Rankings'
                  : !demoMode && view.includes('Queue')
                    ? 'Ready for Follow-up'
                    : !demoMode
                      ? 'Invoices & Payments'
                      : 'Invoices Needing Follow-up'}
            </h2>
            <span className="count-pill">{visible.length} invoices</span>
          </div>
          {canSort ? (
            <label className="invoice-sort">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Sort by
              <select
                aria-label="Sort by"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
              >
                <option value="priority">Priority (highest first)</option>
                <option value="invoice-asc">Invoice number (A to Z)</option>
                <option value="invoice-desc">Invoice number (Z to A)</option>
                <option value="customer">Customer name (A to Z)</option>
                <option value="due-asc">Due date (earliest first)</option>
                <option value="due-desc">Due date (latest first)</option>
                <option value="balance-desc">Outstanding (highest first)</option>
                <option value="balance-asc">Outstanding (lowest first)</option>
                <option value="overdue">Most overdue</option>
              </select>
            </label>
          ) : (
            <span className="sort-label">
              <SlidersHorizontal size={14} />
              Sorted by priority
            </span>
          )}
        </div>
        {error ? (
          <div className="empty">
            <CircleAlert size={30} className="error-icon" />
            <h3>We couldn’t refresh your invoices</h3>
            <p>
              {demoMode
                ? 'This is a simulated connection error. Your demo records are safe.'
                : 'Could not load current follow-up results. Your last successful saved results are retained. Check that the API is running, then retry.'}
            </p>
            <button className="button" onClick={onRetry}>
              {demoMode ? 'Retry demo connection' : 'Retry connection'}
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
            invoices={sortedInvoices}
            totalCount={totalCount}
            graceOverrides={graceOverrides}
            onReview={onReview}
          />
        )}
      </section>
    </>
  );
}
