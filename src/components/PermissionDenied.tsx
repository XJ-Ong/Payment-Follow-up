import { ShieldCheck } from 'lucide-react';

export default function PermissionDenied() {
  return (
    <section className="card permission">
      <ShieldCheck size={38} />
      <h2>Access restricted</h2>
      <p>Your demo role does not have access to Payment Follow-up.</p>
      <p>Use the demo role switcher to explore as Owner, Finance or Preparer.</p>
      <small>
        Frontend permissions are for demonstration. Backend enforcement is not connected.
      </small>
    </section>
  );
}
