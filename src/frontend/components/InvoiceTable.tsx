import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import {
  outstanding,
  daysOverdue,
  priority,
  money,
  dateLabel,
  type Invoice,
  type GraceOverrides,
  getInvoiceCustomer,
  getGraceDays,
} from '../model';
import StatusBadge from './StatusBadge';

export default function InvoiceTable({
  invoices,
  totalCount,
  graceOverrides,
  onReview,
}: {
  invoices: Invoice[];
  totalCount: number;
  graceOverrides: GraceOverrides;
  onReview: (id: string) => void;
}) {
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Invoice number</th>
              <th>Customer</th>
              <th>Due date</th>
              <th className="numeric">Outstanding</th>
              <th>Overdue</th>
              <th className="numeric">
                Priority score{' '}
                <span title="Outstanding × overdue days after grace period">ⓘ</span>
              </th>
              <th>
                {invoices.some((i) => i.calculation)
                  ? 'Follow-up eligibility'
                  : 'Approval status'}
              </th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const c = getInvoiceCustomer(i);
              const overdueDays = daysOverdue(i);
              const priorityScore = priority(i, getGraceDays(i, graceOverrides));
              return (
                <tr key={i.id}>
                  <td>
                    <button className="invoice-link" onClick={() => onReview(i.id)}>
                      {i.id}
                    </button>
                    <small>
                      {i.calculation?.rank ? `Rank ${i.calculation.rank}` : 'Invoice'}
                    </small>
                  </td>
                  <td>
                    <div className="customer-cell">
                      <span className={`avatar ${c.color}`}>{c.initials}</span>
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {c.doNotContact ? 'Do not contact' : 'Business customer'}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td className="date-cell">{dateLabel(i.due)}</td>
                  <td className="numeric amount">{money(outstanding(i))}</td>
                  <td>
                    <span
                      className={overdueDays > 14 ? 'overdue-high' : 'overdue-normal'}
                    >
                      {overdueDays} days
                    </span>
                  </td>
                  <td className="numeric">
                    <span className="priority-value">
                      {priorityScore.toLocaleString('en-MY')}
                    </span>
                    <span
                      className={`priority-level ${(i.calculation ? i.calculation.trigger_type !== null : priorityScore > 100000) ? 'high' : 'medium'}`}
                    >
                      {i.calculation
                        ? i.calculation.trigger_type === 'both'
                          ? 'Both rules'
                          : i.calculation.trigger_type === 'threshold'
                            ? 'Threshold'
                            : i.calculation.trigger_type === 'safety_rule'
                              ? 'Safety rule'
                              : 'Below threshold'
                        : priorityScore > 100000
                          ? 'High'
                          : priorityScore > 0
                            ? 'Normal'
                            : 'Low'}
                    </span>
                  </td>
                  <td>
                    <StatusBadge
                      status={
                        i.calculation
                          ? i.calculation.eligible
                            ? 'Ready for follow-up'
                            : 'Not eligible'
                          : i.status
                      }
                    />
                    {i.calculation && !i.calculation.eligible && (
                      <small>{i.calculation.exclusion_reasons[0]}</small>
                    )}
                  </td>
                  <td>
                    <button className="review-button" onClick={() => onReview(i.id)}>
                      {c.doNotContact || i.status === 'Simulated sent'
                        ? 'View'
                        : 'Review'}
                      <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          Showing <strong>{invoices.length}</strong> of <strong>{totalCount}</strong>{' '}
          invoices
        </span>
        <span className="table-footer-note">
          <ShieldCheck size={13} />
          Every reminder starts with a human.
        </span>
        <div className="pagination">
          <button aria-label="Previous page" disabled>
            <ChevronLeft size={15} />
          </button>
          <span>1</span>
          <button aria-label="Next page" disabled>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}
