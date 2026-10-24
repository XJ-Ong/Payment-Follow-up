import { Bell, ChevronRight, Menu } from 'lucide-react';
import { type Page } from '../navigation';

export default function Header({
  followupMode = false,
  active,
  reviewCount,
  onOpenNavigation,
  onNotify,
}: {
  followupMode?: boolean;
  active: Page;
  reviewCount: number;
  onOpenNavigation: () => void;
  onNotify: (message: string) => void;
}) {
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
          Prototype workspace
        </span>
        <span className="topbar-separator" />
        <button
          className="icon-button notification"
          aria-label="Show review notifications"
          onClick={() =>
            onNotify(
              followupMode
                ? `${reviewCount} active follow-up alerts.`
                : `${reviewCount} invoices are awaiting human review.`,
            )
          }
        >
          <Bell size={18} />
          <i />
        </button>
        <span className="avatar top-avatar">AM</span>
      </div>
    </header>
  );
}
