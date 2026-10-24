import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, Menu, X, CheckCheck } from 'lucide-react';
import { type Page } from '../navigation';

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  onOpen: () => void;
};

export default function Header({
  items,
  loading,
  error,
  identity,
  active,
  onOpenNavigation,
}: {
  items: AttentionItem[];
  loading: boolean;
  error: boolean;
  identity: string;
  active: Page;
  onOpenNavigation: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [identity, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <button
          className="icon-button mobile-toggle"
          aria-label="Open navigation"
          onClick={onOpenNavigation}
        >
          <Menu size={21} />
        </button>
        <span>Workspace</span>
        <ChevronRight size={13} />
        <strong>{active}</strong>
      </div>
      <div className="topbar-right">
        <span className="prototype-pill">
          <span />
          Prototype
        </span>
        <span className="topbar-separator" />
        <div className="notification-anchor" ref={container}>
          <button
            ref={trigger}
            className="icon-button notification"
            aria-label="Show review notifications"
            aria-expanded={open}
            aria-controls="attention-panel"
            onClick={() => setOpen(!open)}
          >
            <Bell size={18} />
            {!loading && !error && items.length > 0 && (
              <span className="notification-count">
                {items.length > 99 ? '99+' : items.length}
              </span>
            )}
          </button>
          {open && (
            <section
              id="attention-panel"
              className="attention-panel"
              aria-label="Notifications"
            >
              <div className="attention-heading">
                <div>
                  <h2>Needs your attention</h2>
                  <p>
                    {loading
                      ? 'Checking your workspace'
                      : `${items.length} items to review`}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close notifications"
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              {loading ? (
                <p className="attention-empty" role="status">
                  Loading notifications…
                </p>
              ) : error ? (
                <p className="attention-empty" role="status">
                  Unable to update notifications. Refresh the workspace to try again.
                </p>
              ) : items.length === 0 ? (
                <div className="attention-empty">
                  <CheckCheck size={24} />
                  <p>You’re all caught up.</p>
                  <small>No items need your attention right now.</small>
                </div>
              ) : (
                <ul className="attention-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => {
                          setOpen(false);
                          trigger.current?.focus();
                          item.onOpen();
                        }}
                      >
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <span className="avatar top-avatar">AM</span>
      </div>
    </header>
  );
}
