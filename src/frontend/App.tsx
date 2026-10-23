import { useEffect, useState } from 'react';
import { demoMode, loadWorkspace, createInvoice, recordPayment } from './api';
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
  const [active, setActive] = useState<Page>('Dashboard');
  const [role, setRole] = useState<Role>('Owner');
  const [filters, setFilters] = useState<Filters>(cleanFilters);
  const [applied, setApplied] = useState<Filters>(cleanFilters);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [failRefresh, setFailRefresh] = useState(false);
  const [toast, setToast] = useState('');
  const [logs, setLogs] = useState(['Demo workspace opened. All delivery is simulated.']);
  const [graceOverrides, setGraceOverrides] = useState<GraceOverrides>({});
  const [refreshLabel, setRefreshLabel] = useState('All changes up to date');

  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timeout);
    }
  }, [toast]);

  const totals = getInvoiceTotals(invoices);
  const balances = getCustomerBalances(invoices, customers);
  const visible = getVisibleInvoices(
    invoices,
    applied,
    graceOverrides,
    getInvoiceScope(active),
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
    setRole(nextRole);
    setSelected(null);
    setAdding(false);
  }

  function record(message: string) {
    setLogs((previous) => [message, ...previous]);
    setToast(message);
  }

  async function addInvoice(invoice: Invoice, issueDate: string) {
    if (demoMode) setInvoices((previous) => [...previous, invoice]);
    else {
      await createInvoice(invoice, role, issueDate);
      await refresh();
    }
    setAdding(false);
    record(`${invoice.id}: invoice added.`);
  }

  async function payInvoice(amount: string, receivedDate: string) {
    if (!current || demoMode) return;
    await recordPayment(current, role, amount, receivedDate);
    await refresh();
    record(`${current.id}: payment recorded.`);
  }

  function updateStatus(invoice: Invoice, status: Status, reminder: string) {
    if (!canTransition(invoice, getInvoiceCustomer(invoice), role, status)) return;

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

  async function refresh() {
    setLoading(true);
    setError(false);
    try {
      if (demoMode) await new Promise((resolve) => setTimeout(resolve, 700));
      if (failRefresh) throw new Error('Simulated connection failure');
      if (!demoMode) {
        const data = await loadWorkspace(role);
        setCustomers(data.customers);
        setInvoices(data.invoices);
      }
      setRefreshLabel('Refreshed just now');
    } catch (err) {
      setError(true);
      setToast(err instanceof Error ? err.message : 'Unable to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    setInvoices([]);
    setCustomers([]);
    if (role === 'Other Staff') return;
    setLoading(true);
    setError(false);
    loadWorkspace(role)
      .then((data) => {
        if (!cancelled) {
          setInvoices(data.invoices);
          setCustomers(data.customers);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(true);
          setToast(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  function retryConnection() {
    setFailRefresh(false);
    if (failRefresh) {
      setError(false);
      return;
    }
    void refresh();
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
      active={active}
      role={role}
      totals={totals}
      balances={balances}
      totalOutstanding={getTotalOutstanding(invoices)}
      loading={loading}
      refreshLabel={refreshLabel}
      onNavigate={navigate}
      onRoleChange={changeRole}
      onNotify={setToast}
      onRefresh={refresh}
      onAdd={() => setAdding(true)}
      overlays={
        <>
          {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
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
      {renderPage()}
    </AppLayout>
  );
}
