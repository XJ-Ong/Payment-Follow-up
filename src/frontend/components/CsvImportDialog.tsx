import { useRef, useState } from 'react';
import { ApiError, csvTemplate, previewCsv } from '../api';
import type { CsvPreview } from '../csvTypes';
import type { Customer, Role } from '../model';
import Modal from './Modal';

export default function CsvImportDialog({
  customers,
  role,
  userId,
  onImport,
  onClose,
}: {
  customers: Customer[];
  role: Role;
  userId?: string;
  onImport: (text: string) => Promise<number>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const pending = useRef(false);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to process CSV. Try again.');
      if (
        e instanceof ApiError &&
        e.data &&
        typeof e.data === 'object' &&
        'preview' in e.data
      )
        setPreview(e.data.preview as CsvPreview);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Import invoices from CSV"
      subtitle="Fixed template · Preview first · All rows must pass before saving"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <div className="dialog-body csv-import">
        {count !== null ? (
          <div role="status">
            <h3>{count} invoices imported</h3>
            <p>
              Invoices, initial payments and follow-up results are saved. Existing
              invoices were not replaced.
            </p>
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <ol className="csv-steps" aria-label="CSV import steps">
              <li>1. Download template</li>
              <li>2. Fill and upload</li>
              <li>3. Preview and fix errors</li>
              <li>4. Import all invoices</li>
            </ol>
            <p>
              Use the exact six columns. Dates: YYYY-MM-DD. Amounts: plain MYR numbers
              with at most two decimal places. Blank initial payment means zero and is
              recorded on the issue date. UTF-8 CSV only; maximum 1 MiB and 500 rows.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const contents = await csvTemplate(role, userId);
                  const url = URL.createObjectURL(
                    new Blob([contents], { type: 'text/csv;charset=utf-8' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'invoice-template.csv';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Download CSV template
            </button>
            <details>
              <summary>Customer reference list</summary>
              <p>
                Copy customer_id from this list. Names are for reference; do not add a
                customer-name column to the CSV.
              </p>
              {customers.map((c) => (
                <div className="csv-customer" key={c.id}>
                  <strong>{c.name}</strong>
                  <code>{c.id}</code>
                </div>
              ))}
            </details>
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setText('');
                  setPreview(null);
                  setError('');
                  setFilename(file?.name ?? '');
                  if (!file) return;
                  void run(async () => {
                    if (!file.name.toLowerCase().endsWith('.csv'))
                      throw new Error(
                        'Choose a .csv file saved with the system template.',
                      );
                    if (file.size > 1024 * 1024)
                      throw new Error('CSV must be at most 1 MiB.');
                    try {
                      setText(
                        new TextDecoder('utf-8', { fatal: true }).decode(
                          await file.arrayBuffer(),
                        ),
                      );
                    } catch {
                      throw new Error(
                        'Unable to read UTF-8 CSV. Save the file as CSV UTF-8 and upload it again.',
                      );
                    }
                  });
                }}
              />
            </label>
            {filename && <p>Selected file: {filename}</p>}
            <button
              className="button"
              disabled={busy || !text}
              onClick={() =>
                void run(async () => setPreview(await previewCsv(text, role, userId)))
              }
            >
              Preview CSV
            </button>
            {preview && (
              <section aria-label="CSV preview">
                <h3>
                  Preview: {preview.valid_count} valid, {preview.invalid_count} invalid
                </h3>
                {preview.file_errors.map((message, index) => (
                  <p key={index} role="alert">
                    {message}
                  </p>
                ))}
                {!preview.can_import && (
                  <p role="status">
                    Nothing has been saved. Fix all errors in the file and upload it
                    again.
                  </p>
                )}
                <p>
                  Valid-row totals: MYR {preview.total_amount} invoiced · MYR{' '}
                  {preview.initial_payment} paid · MYR {preview.outstanding_amount}{' '}
                  outstanding.
                </p>
                <div
                  className="csv-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Invoice row preview"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>CSV line</th>
                        <th>Invoice / customer</th>
                        <th>Dates</th>
                        <th>Total / payment / outstanding (MYR)</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.row_number}>
                          <td>{row.row_number}</td>
                          <td>
                            <strong>{row.values.invoice_no || '(missing)'}</strong>
                            <p>{row.customer_name ?? row.values.customer_id}</p>
                          </td>
                          <td>
                            Issued {row.values.issue_date}
                            <br />
                            Due {row.values.due_date}
                          </td>
                          <td>
                            {row.values.total_amount}
                            <br />
                            {row.values.initial_payment}
                            <br />
                            {row.outstanding_amount ?? '—'}
                          </td>
                          <td>
                            {row.errors.length ? (
                              <ul>
                                {row.errors.map((e, index) => (
                                  <li key={index}>
                                    <strong>{e.column}:</strong> {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              'Valid'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <div className="dialog-footer">
              <button className="button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !preview?.can_import}
                onClick={() => void run(async () => setCount(await onImport(text)))}
              >
                {busy ? 'Processing…' : `Import ${preview?.valid_count ?? 0} invoices`}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
