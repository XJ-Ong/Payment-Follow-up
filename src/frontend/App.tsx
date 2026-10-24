import RulesEditor from './pages/RulesEditor';
import ProfileEditor from './components/ProfileEditor';
import type { ProfileInput, RulesInput } from './settingsTypes';
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  demoMode,
  loadWorkspace,
  createInvoice,
  recordPayment,
  changeDraft,
  saveRules,
  saveProfile,
  type SettingsResult,
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
import { addTestData } from './testData';
import AddInvoiceDialog from './components/AddInvoiceDialog';
import AppLayout from './components/AppLayout';
import ReviewDrawer from './components/ReviewDrawer';
import Toast from './components/Toast';
import WorkflowPage from './pages/WorkflowPage';
import { invoiceStage, type FollowupStage } from './followupStages';
import type {
  DemoUser,
  OutboxRecord,
  ActivityRecord,
  DraftAction,
  DraftPayload,
} from './workflowTypes';
import ActivityPage from './pages/ActivityPage';
import CustomerPage from './pages/CustomerPage';
import InvoicesPage from './pages/InvoicesPage';
import SettingsPage from './pages/SettingsPage';
import WeeklySummaryPage from './pages/WeeklySummaryPage';

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>(demoMode ? initialInvoices : []);
  const [customers, setCustomers] = useState<Customer[]>(demoMode ? demoCustomers : []);
  const [userId, setUserId] = useState<string | undefined>();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<FollowupAlert[]>([]);
  const [rules, setRules] = useState<SavedRules | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>();
  const requestGeneration = useRef(0);
  const identityGeneration = useRef(0);
  const [active, setActive] = useState<Page>('Dashboard');
  const [followupStage, setFollowupStage] = useState<FollowupStage>('Ready');
  const [role, setRole] = useState<Role>('Owner');
  const [filters, setFilters] = useState<Filters>(cleanFilters);
  const [applied, setApplied] = useState<Filters>(cleanFilters);
  const [adding, setAdding] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seedRunning = useRef(false);
  const [error, setError] = useState(false);
  const [failRefresh, setFailRefresh] = useState(false);
  const [logs, setLogs] = useState(['Demo workspace opened. All delivery is simulated.']);
  const [graceOverrides, setGraceOverrides] = useState<GraceOverrides>({});
  const [refreshLabel, setRefreshLabel] = useState('All changes up to date');

  function applyWorkspace(data: Awaited<ReturnType<typeof loadWorkspace>>) {
    setUsers(data.users);
    setOutbox(data.outbox);
    setActivity(data.activity);
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
        review: invoices.filter((i) => i.workflow?.current?.status.startsWith('pending'))
          .length,
        drafts: invoices.filter((i) => i.workflow?.current?.status === 'draft').length,
        sent: outbox.filter(
          (r) =>
            new Date(r.sent_at).toLocaleDateString('en-CA', {
              timeZone: 'Asia/Kuala_Lumpur',
            }) === asOf,
        ).length,
        snoozed: invoices.filter(
          (i) =>
            i.workflow?.suppressed_until && i.workflow.suppressed_until > (asOf ?? ''),
        ).length,
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
    if (
      !demoMode &&
      ['Today’s Queue', 'Reminder Workflow', 'Simulated Outbox'].includes(page)
    ) {
      setFollowupStage(
        page === 'Simulated Outbox'
          ? 'Sent'
          : page === 'Reminder Workflow'
            ? 'Drafts'
            : 'Ready',
      );
      setActive('Follow-ups');
    } else setActive(page);
    resetFilters();
  }

  function resetFilters() {
    setFilters(cleanFilters);
    setApplied(cleanFilters);
  }

  function changeRole(nextRole: Role) {
    identityGeneration.current += 1;
    requestGeneration.current += 1;
    setUserId(undefined);
    setRole(nextRole);
    setSelected(null);
    setEditingCustomer(null);
    setAdding(false);
    toast.info(`Demo role changed to ${nextRole}.`, { id: 'role-change' });
  }

  function record(message: string, notify = true) {
    setLogs((previous) => [message, ...previous]);
    if (notify) toast.success(message);
  }

  async function addInvoice(invoice: Invoice, issueDate: string) {
    const identity = identityGeneration.current;
    if (demoMode) setInvoices((previous) => [...previous, invoice]);
    else {
      const saving = createInvoice(invoice, role, issueDate, userId);
      toast.promise(saving, {
        loading: 'Saving invoice…',
        success: 'Invoice saved.',
        error: (err) => (err instanceof Error ? err.message : 'Unable to save invoice'),
      });
      await saving;
      if (identity !== identityGeneration.current) return;
      await refresh();
    }
    setAdding(false);
    record(`${invoice.id}: invoice added.`, demoMode);
  }

  async function payInvoice(amount: string, receivedDate: string) {
    const identity = identityGeneration.current;
    if (!current || demoMode) return;
    const saving = recordPayment(current, role, amount, receivedDate, userId);
    toast.promise(saving, {
      loading: 'Recording payment…',
      success: 'Payment saved.',
      error: (err) => (err instanceof Error ? err.message : 'Unable to record payment'),
    });
    await saving;
    if (identity !== identityGeneration.current) return;
    await refresh();
    record(`${current.id}: payment recorded.`, false);
  }

  async function workflowAction(action: DraftAction, payload: DraftPayload) {
    if (!current) return;
    const identity = identityGeneration.current;
    try {
      await changeDraft(current, action, payload, role, userId);
      if (identity !== identityGeneration.current) return;
      await refresh();
      toast.success('Reminder workflow saved.');
    } catch (err) {
      if (identity === identityGeneration.current) await refresh();
      throw err;
    }
  }

  async function seedTestInvoices() {
    if (
      seedRunning.current ||
      loading ||
      !rules ||
      !asOf ||
      demoMode ||
      role === 'Other Staff'
    )
      return;
    seedRunning.current = true;
    setSeeding(true);
    const identity = identityGeneration.current;
    const notification = toast.loading('Adding test invoices…');
    try {
      const count = await addTestData(customers, rules, asOf, role, userId);
      if (identity !== identityGeneration.current) {
        toast.dismiss(notification);
        return;
      }
      await refresh();
      setFollowupStage('Ready');
      navigate('Follow-ups');
      toast.success(
        `${count} TEST invoices added. Paid, future and blocked examples are in Invoices & Payments.`,
        { id: notification, duration: 8000 },
      );
    } catch (err) {
      if (identity === identityGeneration.current) await refresh();
      toast.error(err instanceof Error ? err.message : 'Unable to add test data', {
        id: notification,
        duration: 8000,
      });
    } finally {
      seedRunning.current = false;
      setSeeding(false);
    }
  }

  async function applySettingsSave(saving: Promise<SettingsResult>, identity: number) {
    const result = await saving;
    if (identity !== identityGeneration.current) return result;
    const generation = ++requestGeneration.current;
    const workspace = await loadWorkspace(role, false, userId, result.workspace);
    if (
      identity === identityGeneration.current &&
      generation === requestGeneration.current
    ) {
      applyWorkspace(workspace);
      setLoading(false);
      setError(false);
      toast.success(
        `Saved and recalculated. ${result.invalidated_journeys} reminder journeys invalidated.`,
      );
    }
    return result;
  }

  async function updateRules(input: RulesInput) {
    const result = await applySettingsSave(
      saveRules(input, role, userId),
      identityGeneration.current,
    );
    return result.workspace.rules!;
  }

  async function updateProfile(id: string, input: ProfileInput) {
    await applySettingsSave(
      saveProfile(id, input, role, userId),
      identityGeneration.current,
    );
  }

  function changeUser(nextId: string) {
    identityGeneration.current += 1;
    requestGeneration.current += 1;
    setUserId(nextId);
    setSelected(null);
    setEditingCustomer(null);
    setAdding(false);
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
        const data = await loadWorkspace(role, true, userId);
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
    setOutbox([]);
    setActivity([]);
    setDashboard(null);
    setAlerts([]);
    setRules(null);
    if (role === 'Other Staff') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    loadWorkspace(role, true, userId)
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
  }, [role, userId]);

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
    if (!demoMode && active === 'Follow-ups')
      return (
        <WorkflowPage
          invoices={invoices}
          outbox={outbox}
          stage={followupStage}
          asOf={asOf ?? ''}
          loading={loading}
          error={error}
          onRetry={retryConnection}
          onStage={setFollowupStage}
          onReview={setSelected}
        />
      );
    switch (active) {
      case 'Rules & Settings':
        if (!demoMode)
          return (
            <RulesEditor
              key={`${role}-${userId}`}
              role={role}
              userId={userId}
              users={users}
              onSave={updateRules}
            />
          );
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
            onEdit={!demoMode ? setEditingCustomer : undefined}
            customers={customers}
            balances={balances}
            graceOverrides={graceOverrides}
          />
        );
      case 'Activity Log':
        return <ActivityPage logs={logs} records={demoMode ? undefined : activity} />;
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
      onSeedTestData={
        import.meta.env.DEV && !demoMode && rules && asOf
          ? () => void seedTestInvoices()
          : undefined
      }
      seeding={seeding}
      users={demoMode ? [] : users}
      userId={userId}
      onUserChange={changeUser}
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
          {editingCustomer && role !== 'Other Staff' && (
            <ProfileEditor
              key={`${editingCustomer}-${role}-${userId}`}
              id={editingCustomer}
              role={role}
              userId={userId}
              rules={rules}
              onSave={updateProfile}
              onClose={() => setEditingCustomer(null)}
            />
          )}
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
              userId={userId}
              activity={activity}
              onWorkflow={workflowAction}
              onPayment={payInvoice}
              invoice={current}
              graceDays={getGraceDays(current, graceOverrides)}
              role={role}
              onClose={() => {
                if (!demoMode && active === 'Follow-ups') {
                  const destination = invoiceStage(current, asOf ?? '');
                  if (destination) setFollowupStage(destination);
                }
                setSelected(null);
              }}
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
      {!demoMode && active === 'Dashboard' && (
        <section
          className="card dashboard-followup-links"
          aria-label="Continue follow-ups"
        >
          <h2>Continue follow-ups</h2>
          {(
            [
              'Ready',
              'Drafts',
              'Awaiting approval',
              'Ready to send',
              'Sent',
              'Deferred',
            ] as FollowupStage[]
          ).map((stage) => (
            <button
              className="button"
              key={stage}
              onClick={() => {
                setFollowupStage(stage);
                navigate('Follow-ups');
              }}
            >
              {stage}
            </button>
          ))}
        </section>
      )}
      {renderPage()}
    </AppLayout>
  );
}
