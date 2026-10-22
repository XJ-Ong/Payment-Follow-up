import { useState, type ReactNode } from 'react';
import { CalendarDays, ShieldCheck } from 'lucide-react';
import { type Role, type InvoiceTotals, type CustomerBalance } from '../model';
import { type Page } from '../navigation';
import CustomerBalanceChart from './CustomerBalanceChart';
import Sidebar from './Sidebar';
import Header from './Header';
import PageHeader from './PageHeader';
import ContextBanner from './ContextBanner';
import PaymentSummary from './PaymentSummary';
import PermissionDenied from './PermissionDenied';

export default function AppLayout({
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
}: {
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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const heading = active === 'Dashboard' ? 'Payment Follow-up' : active;
  return (
    <div className={`app-layout ${collapsed ? 'is-collapsed' : ''}`}>
      {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
      <Sidebar
        active={active}
        role={role}
        collapsed={collapsed}
        mobile={mobile}
        reviewCount={totals.review}
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
          active={active}
          reviewCount={totals.review}
          onOpenNavigation={() => {
            setCollapsed(false);
            setMobile(true);
          }}
          onNotify={onNotify}
        />
        <main>
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
              Demo reference date: <strong>22 Oct 2026</strong>
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
              <ContextBanner reviewCount={totals.review} />
              <PaymentSummary totals={totals} />
              {children}
              <CustomerBalanceChart data={balances} total={totalOutstanding} />
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} />
                  Built for thoughtful follow-ups.
                </span>
                <span>
                  Orbyte-inspired prototype <span>·</span> Synthetic data <span>·</span>{' '}
                  Simulated delivery only
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
