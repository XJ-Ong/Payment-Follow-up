import { type LucideIcon } from 'lucide-react';

export default function SummaryCard({
  label,
  value,
  caption,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  color: string;
}) {
  return (
    <article className={`summary-card ${color}`}>
      <div className="summary-top">
        <span>{label}</span>
        <span className={`summary-icon ${color}`}>
          <Icon size={18} />
        </span>
      </div>
      <strong className="summary-value">{value}</strong>
      <p>{caption}</p>
    </article>
  );
}
