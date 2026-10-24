import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Languages,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  CalendarDays,
  Info,
} from 'lucide-react';
import {
  generateWeeklyNarrative,
  type GeneratedSummary,
  type SummaryLanguage,
} from '../api';
import { dateLabel, type Role } from '../model';

export default function WeeklyNarrative({
  weekStart,
  periodEnd,
  role,
  userId,
}: {
  weekStart: string;
  periodEnd: string;
  role: Role;
  userId?: string;
}) {
  const [language, setLanguage] = useState<SummaryLanguage>('English');
  const [summary, setSummary] = useState<GeneratedSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  async function generate() {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setSummary(undefined);
    try {
      const result = await generateWeeklyNarrative(
        weekStart,
        periodEnd,
        language,
        role,
        userId,
      );
      if (generation.current === request) setSummary(result);
    } catch (err) {
      if (generation.current === request)
        setError(err instanceof Error ? err.message : 'Unable to generate summary.');
    } finally {
      if (generation.current === request) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="card weekly-narrative" aria-label="Weekly narrative">
      <header className="narrative-header">
        <div className="narrative-heading">
          <span className="narrative-icon">
            <FileText size={21} aria-hidden="true" />
          </span>
          <div>
            <span className="narrative-eyebrow">THE WEEK AT A GLANCE</span>
            <h2>Weekly narrative</h2>
          </div>
        </div>
        <span className="narrative-period">
          <CalendarDays size={14} aria-hidden="true" />
          {dateLabel(weekStart)} to {dateLabel(periodEnd)}
        </span>
      </header>
      <p className="narrative-description">
        A clear overview of overdue balances, collections, and reminder activity.
      </p>
      <div className="narrative-controls">
        <label className="narrative-language">
          <span>
            <Languages size={14} aria-hidden="true" />
            Summary language
          </span>
          <select
            value={language}
            onChange={(event) => {
              generation.current += 1;
              pending.current = false;
              setBusy(false);
              setSummary(undefined);
              setError('');
              setLanguage(event.target.value as SummaryLanguage);
            }}
          >
            <option>English</option>
            <option>Bahasa Malaysia</option>
          </select>
        </label>
        <button
          className="button primary narrative-generate"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <FileText size={16} aria-hidden="true" />
          )}
          {busy ? 'Generating summary...' : error ? 'Retry summary' : 'Generate summary'}
          {!busy && <ArrowUpRight size={15} aria-hidden="true" />}
        </button>
      </div>
      {!busy && !summary && !error && (
        <div className="narrative-empty">
          <span className="narrative-empty-icon">
            <FileText size={23} aria-hidden="true" />
          </span>
          <div>
            <h3>Your week, in a few words</h3>
            <p>Generate a summary of the selected period using your saved records.</p>
          </div>
        </div>
      )}
      <div className="narrative-result" role="status" aria-live="polite" aria-busy={busy}>
        {busy && (
          <div className="narrative-loading">
            <Loader2 size={20} className="spin" aria-hidden="true" />
            <p>Generating weekly narrative...</p>
          </div>
        )}
        {summary && (
          <article className="narrative-document">
            <div className="narrative-document-top">
              <span className="narrative-success">
                <CheckCircle2 size={14} aria-hidden="true" />
                Summary generated.
              </span>
              <span className="narrative-source">
                {summary.written_by === 'ai'
                  ? 'AI-generated'
                  : summary.written_by === 'template'
                    ? 'Template-generated'
                    : 'Source unavailable'}
              </span>
            </div>
            <p className="narrative-document-period">
              {dateLabel(summary.week_start)} to {dateLabel(summary.week_end)} |{' '}
              {language}
            </p>
            <p className="narrative-prose">{summary.narrative}</p>
            <p className="narrative-timestamp">
              Generated{' '}
              {new Date(summary.generated_at).toLocaleString('en-GB', {
                timeZone: 'Asia/Kuala_Lumpur',
              })}{' '}
              (Malaysia time)
            </p>
          </article>
        )}
      </div>
      {error && (
        <div className="narrative-error" role="alert">
          <Info size={17} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      <footer className="narrative-note">
        <Info size={14} aria-hidden="true" />
        <p>
          Generation currently uses templates. Regenerating this week replaces its saved
          summary, including its language.
        </p>
      </footer>
    </section>
  );
}
