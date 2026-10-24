import type { WorkspacePayload } from './api';
export type CsvRow = {
  row_number: number;
  values: Record<string, string>;
  customer_name: string | null;
  project_name: string | null;
  outstanding_amount: string | null;
  errors: { column: string; message: string }[];
};
export type CsvPreview = {
  rows: CsvRow[];
  file_errors: string[];
  valid_count: number;
  invalid_count: number;
  can_import: boolean;
  total_amount: string;
  deposit_paid: string;
  outstanding_amount: string;
};
export type CsvResult = { imported_count: number; workspace: WorkspacePayload };

export type CsvReference = {
  client_id: string;
  name: string;
  projects: { project_id: string; name: string }[];
};
