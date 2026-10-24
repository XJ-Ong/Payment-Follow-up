export type AuditEvent = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  actor_type: string;
  entity_type: string;
  entity_id: string;
  invoice_number: string | null;
  customer_name: string | null;
  created_at: string;
  summary: string;
};
export type AuditDetail = AuditEvent & {
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};
export type AuditPage = {
  items: AuditEvent[];
  total: number;
  page: number;
  page_size: number;
  actors: { id: string | null; name: string }[];
  actions: string[];
};
