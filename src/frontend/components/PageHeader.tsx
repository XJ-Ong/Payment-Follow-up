import { Plus, RefreshCw } from 'lucide-react';
import { type Role } from '../model';

export default function PageHeader({
  heading,
  loading,
  role,
  onRefresh,
  onAdd,
}: {
  heading: string;
  loading: boolean;
  role: Role;
  onRefresh: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">ACCOUNTS RECEIVABLE</div>
        <h1>{heading}</h1>
        <p>Prioritise follow-ups and approve reminders.</p>
      </div>
      <div className="header-actions">
        <button className="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Refresh now
        </button>
        <button
          className="button primary"
          onClick={onAdd}
          disabled={role === 'Other Staff'}
        >
          <Plus size={17} />
          Add Invoice
        </button>
      </div>
    </div>
  );
}
