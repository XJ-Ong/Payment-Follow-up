import { useState } from 'react';
import { CalendarDays, Search } from 'lucide-react';
import { type Filters, statuses, validateDateRange } from '../model';

export default function InvoiceFilters({
  filters,
  setFilters,
  onApply,
  onReset,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const [rangeError, setRangeError] = useState('');
  return (
    <form
      className="card filters"
      onSubmit={(e) => {
        e.preventDefault();
        const validationError = validateDateRange(filters);
        if (validationError) {
          setRangeError(validationError);
          return;
        }
        setRangeError('');
        onApply();
      }}
    >
      <label className="search-filter">
        Search
        <div className="input-icon">
          <Search size={16} />
          <input
            placeholder="Search invoice or customer…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
      </label>
      <label className="status-filter">
        Status
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option>All statuses</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <fieldset className="date-range">
        <legend>Due-date range</legend>
        <div>
          <CalendarDays size={15} />
          <input
            aria-label="Due date from"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
          <span>—</span>
          <input
            aria-label="Due date to"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </div>
      </fieldset>
      <div className="filter-actions">
        <button type="submit" className="button primary">
          Apply Filter
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setRangeError('');
            onReset();
          }}
        >
          Reset
        </button>
      </div>
      {rangeError && (
        <p role="alert" className="error-message filter-error">
          {rangeError}
        </p>
      )}
    </form>
  );
}
