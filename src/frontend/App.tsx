import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  demoMode,
  loadWorkspace,
  createInvoice,
  recordPayment,
  type Dashboard,
  type FollowupAlert,
  type SavedRules,
} from './api';
import {
  REFERENCE_DATE,
  customers as demoCustomers,
  type Customer,
  canTransition,
  cleanFilters,
  getCustomerBalances,
  getGraceDays,
  getInvoiceCustomer,
  getInvoiceTotals,
  getTotalOutstanding,
  getVisibleInvoices,
  initialInvoices,
  normalizeGraceDays,
  type Filters,
  type GraceOverrides,
  type Invoice,
  type Role,
  type Status,
} from './model';
import { getInvoiceScope, type Page } from './navigation';
import AddInvoiceDialog from './components/AddInvoiceDialog';
import AppLayout from './components/AppLayout';
import ReviewDrawer from './components/ReviewDrawer';
import Toast from './components/Toast';
import ActivityPage from './pages/ActivityPage';
import CustomerPage from './pages/CustomerPage';
import InvoicesPage from './pages/InvoicesPage';
import SettingsPage from './pages/SettingsPage';
import WeeklySummaryPage from './pages/WeeklySummaryPage';

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>(demoMode ? initialInvoices : []);
  const [customers, setCustomers] = useState<Customer[]>(demoMode ? demoCustomers : []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<FollowupAlert[]>([]);
  const [rules, setRules] = useState<SavedRules | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>();
  const requestGeneration = useRef(0);
  const [active, setActive] = useState<Page>('Dashboard');
  const [role, setRole] = useState<Role>('Owner');
  const [filters, setFilters] = useState<Filters>(cleanFilters);
  const [applied, setApplied] = useState<Filters>(cleanFilters);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [failRefresh, setFailRefresh] = useState(false);
  const [logs, setLogs] = useState(['Demo workspace opened. All delivery is simulated.']);
  const [graceOverrides, setGraceOverrides] = useState<GraceOverrides>({});
  const [refreshLabel, setRefreshLabel] = useState('All changes up to date');

  function applyWorkspace(data: Awaited<ReturnType<typeof loadWorkspace>>) {
    setCustomers(data.customers);
    setInvoices(data.invoices);
    setDashboard(data.dashboard);
    setAlerts(data.alerts);
    setRules(data.rules);
    setAsOf(data.asOf);
    setRefreshLabel(
      data.computedAt
        ? `Calculated ${new Date(data.computedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}`
        : 'Refresh to calculate priorities',
    );
  }
  const totals = !demoMode
    ? {
        overdue: Number(dashboard?.total_overdue ?? '0'),
        ready: dashboard?.queue_count ?? 0,
        alerts: dashboard?.alert_count ?? 0,
        review: 0,
        drafts: 0,
        sent: 0,
        snoozed: 0,
      }
    : getInvoiceTotals(invoices);
  const balances =
    !demoMode && dashboard
      ? dashboard.customer_balances.map((c) => ({
          name: c.name,
          balance: Number(c.balance),
        }))
      : getCustomerBalances(invoices, customers);
  const visible = getVisibleInvoices(
    invoices,
    applied,
    graceOverrides,
    getInvoiceScope(active, !demoMode),
  );
  const current = invoices.find((invoice) => invoice.id === selected);

  function navigate(page: Page) {
    setActive(page);
    resetFilters();
  }

  function resetFilters() {
    setFilters(cleanFilters);
    setApplied(cleanFilters);
  }

  function changeRole(nextRole: Role) {
    requestGeneration.current += 1;
    setRole(nextRole);
    setSelected(null);
    setAdding(false);
    toast.info(`Demo role changed to ${nextRole}.`, { id: 'role-change' });
  }

  function record(message: string, notify = true) {
    setLogs((previous) => [message, ...previous]);
    if (notify) toast.success(message);
  }

  async function addInvoice(invoice: Invoice, issueDate: string) {
    if (demoMode) setInvoices((previous) => [...previous, invoice]);
    else {
      const saving = createInvoice(invoice, role, issueDate);
      toast.promise(saving, {
        loading: 'Saving invoice…',
        success: 'Invoice saved.',
        error: (err) => (err instanceof Error ? err.message : 'Unable to save invoice'),
      });
      await saving;
      await refresh();
    }
    setAdding(false);
    record(`${invoice.id}: invoice added.`, demoMode);
  }

  async function payInvoice(amount: string, receivedDate: string) {
    if (!current || demoMode) return;
    const saving = recordPayment(current, role, amount, receivedDate);
    toast.promise(saving, {
      loading: 'Recording payment…',
      success: 'Payment saved.',
      error: (err) => (err instanceof Error ? err.message : 'Unable to record payment'),
    });
    await saving;
    await refresh();
    record(`${current.id}: payment recorded.`, false);
  }

  function updateStatus(invoice: Invoice, status: Status, reminder: string) {
    if (!canTransition(invoice, getInvoiceCustomer(invoice), role, status)) {
      toast.warning('This follow-up action is unavailable.', {
        description: 'Check the invoice status and your role permissions.',
      });
      return;
    }

    setInvoices((previous) =>
      previous.map((existing) =>
        existing.id === invoice.id
          ? {
              ...existing,
              status,
              reminder,
              preparedBy: existing.preparedBy ?? 'Alex Morgan',
              ...(status === 'Simulated sent' ? { sentOn: REFERENCE_DATE } : {}),
            }
          : existing,
      ),
    );
    record(
      `${invoice.id}: ${status === 'Simulated sent' ? 'approved and added to simulated outbox' : status.toLowerCase()}.`,
    );
  }

  async function refresh(skipSimulatedFailure = false) {
    const notification = toast.loading('Refreshing invoices…', {
      id: 'workspace-refresh',
    });
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(false);
    try {
      if (demoMode) await new Promise((resolve) => setTimeout(resolve, 700));
      if (failRefresh && !skipSimulatedFailure)
        throw new Error('Simulated connection failure');
      if (!demoMode) {
        const data = await loadWorkspace(role);
        if (generation !== requestGeneration.current) return;
        applyWorkspace(data);
      }
      if (demoMode) setRefreshLabel('Refreshed just now');
      toast.success('Invoices refreshed.', { id: notification });
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      setError(true);
      toast.error(err instanceof Error ? err.message : 'Unable to load invoices', {
        id: notification,
        duration: 8000,
        action: { label: 'Retry', onClick: retryConnection },
      });
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    const generation = ++requestGeneration.current;
    setInvoices([]);
    setCustomers([]);
    setDashboard(null);
    setAlerts([]);
    setRules(null);
    if (role === 'Other Staff') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    loadWorkspace(role)
      .then((data) => {
        if (!cancelled && generation === requestGeneration.current) {
          applyWorkspace(data);
        }
      })
      .catch((err) => {
        if (!cancelled && generation === requestGeneration.current) {
          setError(true);
          toast.error(err instanceof Error ? err.message : 'Unable to load invoices', {
            duration: 8000,
            action: { label: 'Retry', onClick: retryConnection },
          });
        }
      })
      .finally(() => {
        if (!cancelled && generation === requestGeneration.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  function retryConnection() {
    setFailRefresh(false);
    void refresh(true);
  }

  function changeGraceDays(customerId: string, days: number) {
    setGraceOverrides((previous) => ({
      ...previous,
      [customerId]: normalizeGraceDays(days),
    }));
  }

  function renderPage() {
    switch (active) {
      case 'Rules & Settings':
        return (
          <SettingsPage
            customers={customers}
            savedRules={rules}
            readOnly={!demoMode}
            graceOverrides={graceOverrides}
            failRefresh={failRefresh}
            onGraceChange={changeGraceDays}
            onFailRefreshChange={setFailRefresh}
          />
        );
      case 'Customer Profiles':
        return (
          <CustomerPage
            customers={customers}
            balances={balances}
            graceOverrides={graceOverrides}
          />
        );
      case 'Activity Log':
        return <ActivityPage logs={logs} />;
      case 'Weekly Summary':
        return <WeeklySummaryPage totals={totals} />;
      default:
        return (
          <InvoicesPage
            view={active}
            visible={visible}
            totalCount={invoices.length}
            graceOverrides={graceOverrides}
            filters={filters}
            setFilters={setFilters}
            onApply={() => setApplied({ ...filters })}
            onReset={resetFilters}
            onAdd={() => setAdding(true)}
            onReview={setSelected}
            onRetry={retryConnection}
            error={error}
            loading={loading}
          />
        );
    }
  }

  return (
    <AppLayout
      asOf={asOf}
      active={active}
      role={role}
      totals={totals}
      balances={balances}
      totalOutstanding={
        !demoMode && dashboard
          ? Number(dashboard.total_outstanding)
          : getTotalOutstanding(invoices)
      }
      loading={loading}
      refreshLabel={refreshLabel}
      onNavigate={navigate}
      onRoleChange={changeRole}
      onNotify={(message) => toast.info(message)}
      onRefresh={() => void refresh()}
      onAdd={() => setAdding(true)}
      overlays={
        <>
          <Toast />
          {adding && role !== 'Other Staff' && (
            <AddInvoiceDialog
              customers={customers}
              invoices={invoices}
              onClose={() => setAdding(false)}
              onAdd={addInvoice}
            />
          )}
          {current && role !== 'Other Staff' && (
            <ReviewDrawer
              key={current.id}
              databaseMode={!demoMode}
              onPayment={payInvoice}
              invoice={current}
              graceDays={getGraceDays(current, graceOverrides)}
              role={role}
              onClose={() => setSelected(null)}
              onStatus={(status, text) => updateStatus(current, status, text)}
            />
          )}
        </>
      }
    >
      {!demoMode && active === 'Dashboard' && !loading && !error && (
        <section className="card" aria-label="Follow-up alerts">
          <div className="section-title">
            <h2>Follow-up alerts</h2>
            <span>{dashboard?.alert_count ?? 0} active alerts</span>
          </div>
          {alerts
            .filter((a) => a.status === 'new' || a.status === 'seen')
            .map((alert) => {
              const invoice = invoices.find((i) => i.databaseId === alert.invoice_id);
              return (
                <div className="rule-row" key={alert.id}>
                  <div>
                    <strong>{invoice?.id}</strong>
                    <p>{alert.reason}</p>
                  </div>
                  <button
                    className="button"
                    onClick={() => invoice && setSelected(invoice.id)}
                  >
                    View calculation
                  </button>
                </div>
              );
            })}
          {!dashboard?.alert_count && <p>No active follow-up alerts.</p>}
        </section>
      )}
      {renderPage()}
    </AppLayout>
  );
}
