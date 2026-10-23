import { useEffect, useRef, useState } from 'react';
import {
  Building2,
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
          onClick={() => onNotify('You’re in the Acme Collective demo workspace.')}
          title="Acme Collective"
        >
          <span className="org-icon">
            <Building2 size={20} />
          </span>
          {!collapsed && (
            <>
              <span>
                <strong>Acme Collective</strong>
                <small>Demo workspace</small>
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
            .filter((n) => n.label.toLowerCase().includes(menuSearch.toLowerCase()))
            .map(({ label, icon: Icon, group }) => (
              <button
                key={label}
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
                    {label === 'Today’s Queue' && (
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
        {!collapsed && (
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
        <div className="user">
          <span className="avatar user-avatar">AM</span>
          {!collapsed && (
            <>
              <span>
                <strong>Alex Morgan</strong>
                <small>{role}</small>
              </span>
              <MoreHorizontal size={19} />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
