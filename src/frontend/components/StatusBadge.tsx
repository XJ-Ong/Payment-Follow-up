export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
