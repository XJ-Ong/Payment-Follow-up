import CsvImportDialog from './components/CsvImportDialog';
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
  voidInvoice,
  changeDraft,
  importCsv,
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
import InvoiceActionCard from './components/InvoiceActionCard';
import Toast from './components/Toast';
import type { AttentionItem } from './components/Header';
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
import AuditPage from './pages/AuditPage';
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
  const [alerts, setAlerts] = useState<FollowupAlert[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
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
  const [importing, setImporting] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seedRunning = useRef(false);
  const [error, setError] = useState(false);
  const [failRefresh, setFailRefresh] = useState(false);
  const [logs, setLogs] = useState(['Workspace opened. Delivery is simulated.']);
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
  const cardInvoice = invoices.find((invoice) => invoice.id === cardId);

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
    setCardId(null);
    setEditingCustomer(null);
    setAdding(false);
    setImporting(false);
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
    setImporting(false);
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

  async function cardPayment(
    invoice: Invoice,
    amount: string,
    receivedDate: string,
    reference: string,
  ) {
    const identity = identityGeneration.current;
    if (demoMode) {
      setInvoices((previous) =>
        previous.map((existing) =>
          existing.id === invoice.id
            ? { ...existing, payments: existing.payments + Number(amount) }
            : existing,
        ),
      );
      record(`${invoice.id}: payment of MYR ${Number(amount).toFixed(2)} recorded.`);
      return;
    }
    await recordPayment(invoice, role, amount, receivedDate, userId, reference);
    if (identity !== identityGeneration.current) return;
    await refresh();
    record(`${invoice.id}: payment recorded.`);
  }

  async function cardVoid(invoice: Invoice, reason: string) {
    const identity = identityGeneration.current;
    if (demoMode) {
      setInvoices((previous) =>
        previous.map((existing) =>
          existing.id === invoice.id
            ? { ...existing, financialStatus: 'void' }
            : existing,
        ),
      );
      record(`${invoice.id}: invoice voided (${reason}).`);
      return;
    }
    await voidInvoice(invoice, role, reason, userId);
    if (identity !== identityGeneration.current) return;
    await refresh();
    record(`${invoice.id}: invoice voided.`);
  }

  async function workflowAction(action: DraftAction, payload: DraftPayload) {
    if (!current) return;
    const identity = identityGeneration.current;
    try {
      const result = await changeDraft(current, action, payload, role, userId);
      if (identity !== identityGeneration.current) return;
      await refresh();
      if (action === 'send' && result.delivery?.status === 'failed')
        toast.error('Telegram delivery failed. Review the saved result.');
      else if (action === 'send' && result.delivery?.status === 'unknown')
        toast.warning('Telegram outcome is unknown. Do not resend.');
      else
        toast.success(
          action === 'send' && result.delivery?.status === 'sent'
            ? 'Telegram accepted the reminder.'
            : 'Reminder workflow saved.',
        );
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

  async function importInvoices(text: string) {
    const identity = identityGeneration.current;
    const result = await importCsv(text, role, userId);
    if (identity !== identityGeneration.current) return result.imported_count;
    const generation = ++requestGeneration.current;
    setLoading(false);
    try {
      const data = await loadWorkspace(role, false, userId, result.workspace);
      if (
        identity === identityGeneration.current &&
        generation === requestGeneration.current
      ) {
        applyWorkspace(data);
        setError(false);
        navigate('Invoices & Payments');
      }
    } catch (err) {
      if (
        identity === identityGeneration.current &&
        generation === requestGeneration.current
      ) {
        setError(true);
        toast.warning(
          `Invoices were imported, but the workspace could not reload${
            err instanceof Error ? `: ${err.message}` : '.'
          } Your records are safe; retry refresh to display them.`,
          {
            action: { label: 'Retry refresh', onClick: retryConnection },
            duration: 10000,
          },
        );
      }
    }
    return result.imported_count;
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
    setCardId(null);
    setEditingCustomer(null);
    setAdding(false);
    setImporting(false);
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
      case 'Audit Log':
        return demoMode ? (
          <ActivityPage logs={logs} />
        ) : (
          <AuditPage key={`${role}-${userId}`} role={role} userId={userId} />
        );
      case 'Weekly Summary':
        return (
          <WeeklySummaryPage
            key={`${role}-${userId}`}
            role={role}
            userId={userId}
            invoices={invoices}
            onReview={setCardId}
          />
        );
      default:
        return (
          <InvoicesPage
            onImport={
              !demoMode && active === 'Invoices & Payments'
                ? () => setImporting(true)
                : undefined
            }
            view={active}
            visible={visible}
            totalCount={invoices.length}
            graceOverrides={graceOverrides}
            filters={filters}
            setFilters={setFilters}
            onApply={() => setApplied({ ...filters })}
            onReset={resetFilters}
            onAdd={() => setAdding(true)}
            onReview={
              active === 'Dashboard' || active === 'Invoices & Payments'
                ? setCardId
                : setSelected
            }
            onRetry={retryConnection}
            error={error}
            loading={loading}
          />
        );
    }
  }

  const attentionItems: AttentionItem[] = [];
  const currentUser =
    userId ??
    users.find(
      (user) => user.is_default && user.role === (role === 'Owner' ? 'owner' : 'finance'),
    )?.id;
  if (role !== 'Other Staff') {
    for (const invoice of invoices) {
      const draft = invoice.workflow?.current;
      const allowed = draft?.allowed_actions ?? [];
      const action = demoMode
        ? invoice.status === 'Needs review'
          ? 'Review reminder'
          : invoice.status === 'Draft prepared'
            ? 'Complete draft'
            : null
        : allowed.includes('approve')
          ? 'Approval required'
          : draft?.status === 'approved' && allowed.includes('send')
            ? 'Ready to send'
            : draft?.status === 'draft' && allowed.includes('submit')
              ? 'Complete draft'
              : !draft && invoice.calculation?.eligible
                ? 'Ready for follow-up'
                : null;
      if (action && !getInvoiceCustomer(invoice).doNotContact) {
        attentionItems.push({
          id: `invoice-${invoice.id}`,
          title: `${action} ? ${invoice.id}`,
          detail:
            customers.find((customer) => customer.id === invoice.customerId)?.name ??
            invoice.customer?.name ??
            invoice.customerId,
          onOpen: () => setSelected(invoice.id),
        });
      }
    }
    for (const alert of alerts.filter(
      (alert) =>
        alert.recipient_id === currentUser && ['new', 'seen'].includes(alert.status),
    )) {
      const invoice = invoices.find((invoice) => invoice.databaseId === alert.invoice_id);
      if (invoice)
        attentionItems.push({
          id: `alert-${alert.id}`,
          title: `Follow-up alert ? ${invoice.id}`,
          detail: alert.reason,
          onOpen: () => setSelected(invoice.id),
        });
    }
  }

  return (
    <AppLayout
      attentionItems={attentionItems}
      notificationError={error}
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
          {importing && !demoMode && role !== 'Other Staff' && (
            <CsvImportDialog
              key={`${role}-${userId}`}
              role={role}
              userId={userId}
              onImport={importInvoices}
              onClose={() => setImporting(false)}
            />
          )}
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
              onImport={
                !demoMode
                  ? () => {
                      setAdding(false);
                      setImporting(true);
                    }
                  : undefined
              }
              customers={customers}
              invoices={invoices}
              onClose={() => setAdding(false)}
              onAdd={addInvoice}
            />
          )}
          {cardInvoice && role !== 'Other Staff' && (
            <InvoiceActionCard
              key={cardInvoice.id}
              invoice={cardInvoice}
              graceDays={getGraceDays(cardInvoice, graceOverrides)}
              role={role}
              onClose={() => setCardId(null)}
              onPayment={(amount, date, reference) =>
                cardPayment(cardInvoice, amount, date, reference)
              }
              onVoid={(reason) => cardVoid(cardInvoice, reason)}
              onReview={() => {
                setCardId(null);
                setSelected(cardInvoice.id);
              }}
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
      {renderPage()}
    </AppLayout>
  );
}
