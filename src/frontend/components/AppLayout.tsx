import type { DemoUser } from '../workflowTypes';
import { useState, type ReactNode } from 'react';
import { CalendarDays, ShieldCheck } from 'lucide-react';
import {
  roles,
  isRole,
  type Role,
  type InvoiceTotals,
  type CustomerBalance,
} from '../model';
import { type Page } from '../navigation';
import CustomerBalanceChart from './CustomerBalanceChart';
import Sidebar from './Sidebar';
import Header, { type AttentionItem } from './Header';
import PageHeader from './PageHeader';
import ContextBanner from './ContextBanner';
import PaymentSummary from './PaymentSummary';
import PermissionDenied from './PermissionDenied';

export default function AppLayout({
  attentionItems,
  notificationError,
  users,
  userId,
  onUserChange,
  asOf,
  active,
  role,
  totals,
  balances,
  totalOutstanding,
  loading,
  refreshLabel,
  onNavigate,
  onRoleChange,
  onNotify,
  onRefresh,
  onAdd,
  children,
  overlays,
  onSeedTestData,
  seeding = false,
}: {
  attentionItems: AttentionItem[];
  notificationError: boolean;
  users: DemoUser[];
  userId?: string;
  onUserChange: (id: string) => void;
  asOf?: string;
  active: Page;
  role: Role;
  totals: InvoiceTotals;
  balances: CustomerBalance[];
  totalOutstanding: number;
  loading: boolean;
  refreshLabel: string;
  onNavigate: (page: Page) => void;
  onRoleChange: (role: Role) => void;
  onNotify: (message: string) => void;
  onRefresh: () => void;
  onAdd: () => void;
  children: ReactNode;
  overlays: ReactNode;
  onSeedTestData?: () => void;
  seeding?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const heading = active === 'Dashboard' ? 'Payment Follow-up' : active;
  return (
    <div className={`app-layout ${collapsed ? 'is-collapsed' : ''}`}>
      {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
      <Sidebar
        users={users}
        userId={userId}
        onUserChange={onUserChange}
        active={active}
        role={role}
        collapsed={collapsed}
        mobile={mobile}
        reviewCount={totals.ready ?? totals.review}
        setCollapsed={setCollapsed}
        setMobile={setMobile}
        onNavigate={(page) => {
          onNavigate(page);
          setMobile(false);
        }}
        onRoleChange={onRoleChange}
        onNotify={onNotify}
      />
      <div className="main-shell">
        <Header
          items={attentionItems}
          loading={loading}
          error={notificationError}
          identity={`${role}-${userId}`}
          active={active}
          onOpenNavigation={() => {
            setCollapsed(false);
            setMobile(true);
          }}
        />
        <main className={active === 'Dashboard' ? 'dashboard-main' : undefined}>
          <PageHeader
            heading={heading}
            loading={loading}
            role={role}
            onRefresh={onRefresh}
            onAdd={onAdd}
          />
          <div className="date-line">
            <span>
              <CalendarDays size={14} />
              Reference date:{' '}
              <strong>
                {import.meta.env.VITE_DATA_MODE === 'demo'
                  ? '22 Oct 2026'
                  : (asOf ??
                    new Date().toLocaleDateString('en-GB', {
                      timeZone: 'Asia/Kuala_Lumpur',
                    }))}
              </strong>
            </span>
            <span>
              <span className="live-dot" />
              {refreshLabel}
            </span>
          </div>
          {role === 'Other Staff' ? (
            <PermissionDenied />
          ) : (
            <>
              {totals.ready !== undefined && (
                <section className="demo-identity" aria-label="Demo identity">
                  <div>
                    <strong>Demo identity</strong>
                    <p>
                      Acting as{' '}
                      {users.find((u) =>
                        userId
                          ? u.id === userId
                          : u.is_default &&
                            u.role === (role === 'Owner' ? 'owner' : 'finance'),
                      )?.name ?? role}{' '}
                      - {role}
                    </p>
                  </div>
                  <label>
                    Act as
                    <select
                      aria-label="DEMO ROLE"
                      value={role}
                      onChange={(e) => {
                        if (isRole(e.target.value)) onRoleChange(e.target.value);
                      }}
                    >
                      {roles.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  {role === 'Finance' && (
                    <label>
                      Finance user
                      <select
                        aria-label="DEMO USER"
                        value={
                          userId ??
                          users.find((u) => u.role === 'finance' && u.is_default)?.id ??
                          ''
                        }
                        onChange={(e) => onUserChange(e.target.value)}
                      >
                        {users
                          .filter((u) => u.role === 'finance')
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {onSeedTestData && (
                    <div className="test-data-control">
                      <button
                        className="button"
                        onClick={onSeedTestData}
                        disabled={seeding || loading}
                      >
                        {seeding ? 'Adding test data…' : 'Add test data'}
                      </button>
                      <small>
                        Temporary · adds TEST invoices; existing records are kept.
                      </small>
                    </div>
                  )}
                </section>
              )}
              {((totals.ready === undefined && active !== 'Weekly Summary') ||
                active === 'Dashboard') && (
                <>
                  {active !== 'Dashboard' && (
                    <ContextBanner reviewCount={totals.alerts ?? totals.review} />
                  )}
                  <PaymentSummary totals={totals} />
                  {active === 'Dashboard' && (
                    <CustomerBalanceChart data={balances} total={totalOutstanding} />
                  )}
                </>
              )}
              {children}
              {totals.ready === undefined &&
                active !== 'Dashboard' &&
                active !== 'Weekly Summary' && (
                  <CustomerBalanceChart data={balances} total={totalOutstanding} />
                )}
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} />
                  Built for thoughtful follow-ups.
                </span>
                <span>
                  Prototype <span>·</span> Synthetic data <span>·</span>{' '}
                  {totals.ready !== undefined
                    ? 'Telegram live / WhatsApp & Email simulated'
                    : 'Simulated delivery'}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {overlays}
    </div>
  );
}
