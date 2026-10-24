import WeeklyNarrative from '../components/WeeklyNarrative';
import { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Loader2,
  Users,
  Wallet,
} from 'lucide-react';
import { demoMode, loadWeeklySummary } from '../api';
import { dateLabel, money, type Invoice, type Role } from '../model';
import type { WeeklySummary } from '../weeklySummaryTypes';
import SummaryCard from '../components/SummaryCard';

const shiftWeek = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export default function WeeklySummaryPage({
  role,
  userId,
  invoices,
  onReview,
}: {
  role: Role;
  userId?: string;
  invoices: Invoice[];
  onReview: (invoiceNo: string) => void;
}) {
  const [weekStart, setWeekStart] = useState<string>();
  const [data, setData] = useState<WeeklySummary>();
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (demoMode) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(undefined);
    loadWeeklySummary(role, userId, weekStart)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error ? err.message : 'Unable to load the weekly summary.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [role, userId, weekStart, reload, invoices]);

  if (demoMode)
    return (
      <section className="card weekly-report-message">
        <CalendarDays size={28} aria-hidden="true" />
        <h2>Weekly collections</h2>
        <p>
          Dated payment history is unavailable in this demo. Connect the database-backed
          workspace to view weekly collections.
        </p>
      </section>
    );
  const maximum = Math.max(0, ...(data?.daily.map((day) => Number(day.amount)) ?? []));
  return (
    <div className="weekly-report">
      <section className="card weekly-report-toolbar" aria-label="Select reporting week">
        <div>
          <h2>Weekly collections</h2>
          <p>
            {data
              ? `${dateLabel(data.week_start)} to ${dateLabel(data.week_end)}`
              : 'Monday to Sunday | Malaysia time'}
            {data?.is_current_week && <span className="count-pill">Week to date</span>}
          </p>
          {data?.is_current_week && (
            <small>Payments through {dateLabel(data.period_end)} | Malaysia time</small>
          )}
        </div>
        <div className="weekly-week-controls">
          <button
            className="button"
            aria-label="Previous week"
            disabled={loading || !data || data.week_start <= '0001-01-07'}
            onClick={() => data && setWeekStart(shiftWeek(data.week_start, -7))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
            Previous
          </button>
          <button
            className="button"
            disabled={loading || !data || data.is_current_week}
            onClick={() => setWeekStart(undefined)}
          >
            This week
          </button>
          <button
            className="button"
            aria-label="Next week"
            disabled={loading || !data || data.week_start >= data.current_week_start}
            onClick={() => data && setWeekStart(shiftWeek(data.week_start, 7))}
          >
            Next
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
      {!loading && !error && data && (role === 'Owner' || role === 'Finance') && (
        <WeeklyNarrative
          key={`${role}-${userId}-${data.week_start}-${data.period_end}`}
          weekStart={data.week_start}
          periodEnd={data.period_end}
          role={role}
          userId={userId}
        />
      )}
      {loading ? (
        <section className="card weekly-report-message" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>Loading weekly collections...</p>
        </section>
      ) : error ? (
        <section className="card weekly-report-message" role="alert">
          <h2>Could not load weekly collections</h2>
          <p>{error}</p>
          <button className="button" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </section>
      ) : (
        data && (
          <>
            <div className="weekly-report-metrics">
              <SummaryCard
                label="Payments received"
                value={money(Number(data.totals.payments_received))}
                caption="By received date, including initial payments"
                icon={Wallet}
                color="blue"
              />
              <SummaryCard
                label="Invoices fully paid"
                value={String(data.totals.invoices_fully_paid)}
                caption="Settled during the selected week"
                icon={FileCheck2}
                color="green"
              />
              <SummaryCard
                label="Customers who paid"
                value={String(data.totals.customers_paid)}
                caption="Customers with payments received this week"
                icon={Users}
                color="violet"
              />
            </div>
            <section className="card" aria-labelledby="daily-collections-title">
              <div className="section-title">
                <div>
                  <h2 id="daily-collections-title">Daily collections</h2>
                  <p>Payments received (MYR) | all seven days</p>
                </div>
              </div>
              <ol className="weekly-daily-chart" aria-label="Daily payments received">
                {data.daily.map((day) => (
                  <li key={day.date}>
                    <span className="weekly-day-amount">{money(Number(day.amount))}</span>
                    <div className="weekly-day-track" aria-hidden="true">
                      <div
                        style={{
                          height: `${maximum > 0 ? (Number(day.amount) / maximum) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                        weekday: 'short',
                        timeZone: 'UTC',
                      })}
                    </strong>
                    <span>
                      {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'UTC',
                      })}
                    </span>
                  </li>
                ))}
              </ol>
              {!data.payments.length && (
                <p className="weekly-empty">No payments received during this week.</p>
              )}
            </section>
            <section className="card" aria-labelledby="weekly-customers-title">
              <div className="section-title">
                <div>
                  <h2 id="weekly-customers-title">Collections by customer</h2>
                  <p>Highest amount received first</p>
                </div>
              </div>
              {data.customers.length ? (
                <div className="table-scroll">
                  <table className="weekly-report-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Amount received</th>
                        <th>Invoices receiving payments</th>
                        <th>Invoices fully paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.customers.map((customer) => (
                        <tr key={customer.customer_id}>
                          <td>{customer.name}</td>
                          <td>{money(Number(customer.amount_received))}</td>
                          <td>{customer.invoices_receiving_payments}</td>
                          <td>{customer.invoices_fully_paid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="weekly-empty">No customer collections for this week.</p>
              )}
            </section>
            <section className="card" aria-labelledby="weekly-payments-title">
              <div className="section-title">
                <div>
                  <h2 id="weekly-payments-title">Payment details</h2>
                  <p>
                    {data.payments.length} payment records | most recent received date
                    first
                  </p>
                </div>
              </div>
              {data.payments.length ? (
                <div className="table-scroll">
                  <table className="weekly-report-table">
                    <thead>
                      <tr>
                        <th>Received date</th>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Payment reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{dateLabel(payment.received_date)}</td>
                          <td>
                            <button
                              className="invoice-link"
                              onClick={() => onReview(payment.invoice_no)}
                            >
                              {payment.invoice_no}
                            </button>
                          </td>
                          <td>{payment.customer_name}</td>
                          <td>{money(Number(payment.amount))}</td>
                          <td>{payment.reference || 'Not provided'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="weekly-empty">
                  Payment records will appear here when payments are received.
                </p>
              )}
            </section>
            <section
              className="card weekly-outstanding"
              aria-labelledby="weekly-outstanding-title"
            >
              <div>
                <h2 id="weekly-outstanding-title">Outstanding now</h2>
                <p>
                  Current snapshot as of {dateLabel(data.outstanding_now.as_of_date)}.
                  These balances are independent of the selected week.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Total outstanding</dt>
                  <dd>{money(Number(data.outstanding_now.total_outstanding))}</dd>
                </div>
                <div>
                  <dt>Overdue outstanding</dt>
                  <dd>{money(Number(data.outstanding_now.total_overdue))}</dd>
                </div>
              </dl>
            </section>
            <p className="weekly-report-note">
              Void invoices are excluded. Do-not-contact customers are included. Reports
              reflect currently saved records, including backdated payments.
            </p>
          </>
        )
      )}
    </div>
  );
}
