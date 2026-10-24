import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileWarning } from 'lucide-react';
import { ApiError, csvTemplate, csvReferences, previewCsv } from '../api';
import type { CsvPreview, CsvReference } from '../csvTypes';
import type { Role } from '../model';
import Modal from './Modal';

export default function CsvImportDialog({
  role,
  userId,
  onImport,
  onClose,
}: {
  role: Role;
  userId?: string;
  onImport: (text: string) => Promise<number>;
  onClose: () => void;
}) {
  const [references, setReferences] = useState<CsvReference[]>([]);
  const [referenceError, setReferenceError] = useState('');
  useEffect(() => {
    let cancelled = false;
    csvReferences(role, userId)
      .then((rows) => {
        if (!cancelled) setReferences(rows);
      })
      .catch((e) => {
        if (!cancelled) setReferenceError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [role, userId]);
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
              Use the exact seven columns: invoice_no, client_id, project_id, issue_date,
              due_date, total_amount, deposit_paid. Dates: YYYY-MM-DD. Amounts: plain MYR
              numbers with at most two decimal places. Blank deposit_paid means zero and
              is recorded on the issue date. Leave project_id blank when no project
              applies. UTF-8 CSV only; maximum 1 MiB and 500 rows.
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
              <summary>Client and project reference list</summary>
              <p>
                Use client codes such as CLI-02 and project codes such as PRJ-02. Each
                project must belong to the selected client. Names are for reference only.
              </p>
              {referenceError && (
                <p role="alert">
                  Could not load references: {referenceError}. Refresh the page to try
                  again.
                </p>
              )}
              {references.map((c) => (
                <div className="csv-customer" key={c.client_id}>
                  <strong>{c.name}</strong>
                  <code>{c.client_id}</code>
                  {c.projects.map((p) => (
                    <small key={p.project_id}>
                      {p.project_id}: {p.name}
                    </small>
                  ))}
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
            {text && !preview && (
              <p className="csv-preview-needed" role="status">
                This CSV has not been validated yet. Click <strong>Preview CSV</strong>{' '}
                to check the file and see any errors before importing.
              </p>
            )}
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
                <div
                  className={`csv-validation-summary ${preview.can_import ? 'is-valid' : 'has-errors'}`}
                  role={preview.can_import ? 'status' : 'alert'}
                  aria-live="polite"
                >
                  {preview.can_import ? (
                    <CheckCircle2 size={20} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={20} aria-hidden="true" />
                  )}
                  <div>
                    <strong>
                      {preview.can_import
                        ? `Ready to import ${preview.valid_count} invoice${preview.valid_count === 1 ? '' : 's'}.`
                        : 'This CSV cannot be imported yet.'}
                    </strong>
                    <p>
                      {preview.invalid_count > 0
                        ? `${preview.invalid_count} row${preview.invalid_count === 1 ? '' : 's'} need${preview.invalid_count === 1 ? 's' : ''} attention. Nothing has been saved.`
                        : 'All rows passed validation.'}
                    </p>
                  </div>
                </div>
                {preview.file_errors.length > 0 && (
                  <div className="csv-file-errors" role="alert">
                    <div className="csv-error-heading">
                      <FileWarning size={17} aria-hidden="true" />
                      <strong>File-level errors</strong>
                    </div>
                    <ul>
                      {preview.file_errors.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                    <p>Download the template or correct the column headers, then preview the file again.</p>
                  </div>
                )}
                {!preview.can_import && (
                  <p className="csv-fix-instruction" role="status">
                    Fix the highlighted rows below, choose the corrected CSV, and preview it again.
                  </p>
                )}
                <p>
                  Valid-row totals: MYR {preview.total_amount} invoiced · MYR{' '}
                  {preview.deposit_paid} paid · MYR {preview.outstanding_amount}{' '}
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
                        <th>Invoice / client / project</th>
                        <th>Dates</th>
                        <th>Total / deposit / outstanding (MYR)</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr
                          key={row.row_number}
                          className={row.errors.length ? 'csv-invalid-row' : undefined}
                        >
                          <td>{row.row_number}</td>
                          <td>
                            <strong>{row.values.invoice_no || '(missing)'}</strong>
                            <p>{row.customer_name ?? row.values.client_id}</p>
                            <small>
                              {(row.project_name ?? row.values.project_id) ||
                                'No project'}
                            </small>
                          </td>
                          <td>
                            Issued {row.values.issue_date}
                            <br />
                            Due {row.values.due_date}
                          </td>
                          <td>
                            {row.values.total_amount}
                            <br />
                            {row.values.deposit_paid}
                            <br />
                            {row.outstanding_amount ?? '—'}
                          </td>
                          <td>
                            {row.errors.length ? (
                              <ul className="csv-row-errors">
                                {row.errors.map((e, index) => (
                                  <li key={index}>
                                    <strong>{e.column}:</strong> {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="csv-valid-row">
                                <CheckCircle2 size={14} aria-hidden="true" /> Valid
                              </span>
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
