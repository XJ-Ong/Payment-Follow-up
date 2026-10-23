import { Check, X } from 'lucide-react';

export default function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="toast" role="status">
      <Check size={17} />
      {message}
      <button
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
