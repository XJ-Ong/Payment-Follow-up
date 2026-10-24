import { Database, Plus } from 'lucide-react';

export default function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Database size={28} />
      </div>
      <h3>No invoices found</h3>
      <p>Try changing your filters or add an invoice to get started.</p>
      <button className="button primary" onClick={onAdd}>
        <Plus size={16} />
        Add Invoice
      </button>
    </div>
  );
}
