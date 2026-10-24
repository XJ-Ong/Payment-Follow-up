import type { DemoUser } from '../workflowTypes';
import { demoMode, sessionAuth, type SessionUser } from '../api';
import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  LogOut,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { type Role, roles, isRole } from '../model';
import { navigation, type Page } from '../navigation';

export default function Sidebar({
  sessionUser,
  onLogout,
  users,
  userId,
  onUserChange,
  active,
  role,
  collapsed,
  mobile,
  reviewCount,
  setCollapsed,
  setMobile,
  onNavigate,
  onRoleChange,
  onNotify,
}: {
  sessionUser?: SessionUser;
  onLogout?: () => Promise<void>;
  users: DemoUser[];
  userId?: string;
  onUserChange: (id: string) => void;
  active: Page;
  role: Role;
  collapsed: boolean;
  mobile: boolean;
  reviewCount: number;
  setCollapsed: (collapsed: boolean) => void;
  setMobile: (mobile: boolean) => void;
  onNavigate: (page: Page) => void;
  onRoleChange: (role: Role) => void;
  onNotify: (message: string) => void;
}) {
  const [menuSearch, setMenuSearch] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const items = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('button, input, select') ?? [],
      );
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobile(false);
      if (e.key === 'Tab') {
        const all = items();
        const first = all[0];
        const last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [mobile]);
  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${mobile ? 'mobile-open' : ''}`}
      role={mobile ? 'dialog' : undefined}
      aria-modal={mobile || undefined}
      aria-label="Main navigation"
    >
      <div className="brand">
        <div className="brand-symbol">
          <span />
          <span />
          <span />
          <span />
        </div>
        {!collapsed && (
          <span>
            orbyte<span className="brand-period">.</span>
          </span>
        )}
        <button
          className="icon-button collapse-button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => {
            if (mobile) setMobile(false);
            else setCollapsed(!collapsed);
          }}
        >
          {collapsed ? <ChevronRight size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <div className="sidebar-content">
        <button
          className="organisation"
          onClick={() =>
            onNotify(
              sessionAuth
                ? 'Acme Collective team workspace.'
                : 'Acme Collective demo workspace.',
            )
          }
          title="Acme Collective"
        >
          <span className="org-icon">
            <Building2 size={20} />
          </span>
          {!collapsed && (
            <>
              <span>
                <strong>Acme Collective</strong>
                <small>{sessionAuth ? 'Team workspace' : 'Demo'}</small>
              </span>
              <ChevronDown size={15} />
            </>
          )}
        </button>
        {!collapsed && (
          <div className="menu-search">
            <Search size={16} />
            <input
              aria-label="Search menu"
              placeholder="Search menu…"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
            />
            <span>⌘ K</span>
          </div>
        )}
        {!collapsed && <div className="nav-caption">WORKSPACE</div>}
        <nav>
          {navigation
            .filter(
              (n) =>
                (demoMode
                  ? !['Follow-ups', 'Reminder Workflow'].includes(n.label)
                  : !['Today’s Queue', 'Reminder Workflow', 'Simulated Outbox'].includes(
                      n.label,
                    )) && n.label.toLowerCase().includes(menuSearch.toLowerCase()),
            )
            .map(({ label, icon: Icon, group }) => (
              <button
                key={label}
                aria-label={label}
                title={label}
                aria-current={active === label ? 'page' : undefined}
                className={`nav-item ${active === label ? 'active' : ''} ${group ? 'nav-divider' : ''}`}
                onClick={() => {
                  onNavigate(label);
                }}
              >
                <Icon size={19} />
                {!collapsed && (
                  <>
                    <span>{label}</span>
                    {(label === 'Today’s Queue' || label === 'Follow-ups') && (
                      <span className="nav-count">{reviewCount}</span>
                    )}
                    {label === 'Simulated Outbox' && (
                      <span className="demo-tag">DEMO</span>
                    )}
                  </>
                )}
              </button>
            ))}
        </nav>
        {!collapsed && (
          <div className="sidebar-note">
            <span className="live-dot" />A little follow-up. A lot of clarity.
            <p>Your receivables, under control.</p>
          </div>
        )}
      </div>
      <div className="sidebar-bottom">
        {!sessionAuth && !collapsed && (demoMode || role === 'Other Staff') && (
          <label className="role-switch">
            <span>
              <ShieldCheck size={14} />
              DEMO ROLE
            </span>
            <select
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
        )}
        {!sessionAuth &&
          !collapsed &&
          demoMode &&
          role === 'Finance' &&
          users.length > 0 && (
            <label className="role-switch">
              DEMO USER
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
        <div className="user">
          <span className="avatar user-avatar">
            {sessionUser
              ? sessionUser.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')
              : 'AM'}
          </span>
          {!collapsed && (
            <>
              <span>
                <strong>
                  {sessionUser?.name ??
                    (role === 'Other Staff' && !demoMode
                      ? 'Other Staff'
                      : (users.find((u) =>
                          userId
                            ? u.id === userId
                            : u.is_default &&
                              u.role === (role === 'Owner' ? 'owner' : 'finance'),
                        )?.name ?? 'Alex Morgan'))}
                </strong>
                <small>{role}</small>
              </span>
              <MoreHorizontal size={19} />
            </>
          )}
        </div>
        {sessionAuth && onLogout && (
          <button
            className="logout-button"
            onClick={() => void onLogout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={17} aria-hidden="true" />
            {!collapsed && 'Sign out'}
          </button>
        )}
      </div>
    </aside>
  );
}
