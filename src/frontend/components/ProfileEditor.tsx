import { useEffect, useState } from 'react';
import { ApiError, getProfile, getRules, profileInput, type SavedRules } from '../api';
import type { Role } from '../model';
import type { Profile, ProfileInput } from '../settingsTypes';
import Modal from './Modal';

export default function ProfileEditor({
  id,
  role,
  userId,
  rules,
  onSave,
  onClose,
}: {
  id: string;
  role: Role;
  userId?: string;
  rules: SavedRules | null;
  onSave: (id: string, input: ProfileInput) => Promise<void>;
  onClose: (saved?: boolean) => void;
}) {
  const [companyRules, setCompanyRules] = useState(rules);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(id, role, userId), getRules(role, userId)])
      .then(([p, r]) => {
        if (!cancelled) {
          setCompanyRules(r);
          setSaved(p);
          setForm(profileInput(p));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, role, userId]);
  async function reload() {
    setLoading(true);
    setError('');
    try {
      const [p, r] = await Promise.all([
        getProfile(id, role, userId),
        getRules(role, userId),
      ]);
      setCompanyRules(r);
      setSaved(p);
      setForm(profileInput(p));
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load preferences');
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      title="Edit customer preferences"
      subtitle={saved?.name ?? 'Loading customer'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-body config-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form || busy) return;
          setBusy(true);
          setError('');
          try {
            await onSave(id, form);
            onClose(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to save preferences');
            setConflict(e instanceof ApiError && e.status === 409);
          } finally {
            setBusy(false);
          }
        }}
      >
        {loading && <p role="status">Loading saved preferences…</p>}
        {saved && (
          <div className="rule-note">
            <p>Email: {saved.email || 'Not provided'}</p>
            <p>Phone: {saved.phone || 'Not provided'}</p>
            <small>Name and contact details are managed by Orbyte.</small>
          </div>
        )}
        {form && (
          <fieldset disabled={busy || loading}>
            <label>
              Relationship tier
              <select
                aria-label="Relationship tier"
                value={form.relationship_tier}
                onChange={(e) =>
                  setForm({
                    ...form,
                    relationship_tier: e.target
                      .value as ProfileInput['relationship_tier'],
                  })
                }
              >
                {['New', 'Regular', 'Key'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <p>
              Grace days from saved company rules:{' '}
              {companyRules?.grace_days_by_tier[form.relationship_tier] ??
                saved?.grace_days}
            </p>
            <label>
              Preferred channel
              <select
                aria-label="Preferred channel"
                value={form.preferred_channel}
                onChange={(e) =>
                  setForm({
                    ...form,
                    preferred_channel: e.target
                      .value as ProfileInput['preferred_channel'],
                  })
                }
              >
                <option>Email</option>
                <option>Telegram</option>
                <option value="WhatsApp">WhatsApp (demo only)</option>
              </select>
            </label>
            {form.preferred_channel === 'WhatsApp' && (
              <p role="status">
                WhatsApp is demo only. Approval and simulated sending are saved, but no
                real WhatsApp message is delivered.
              </p>
            )}
            {form.preferred_channel === 'Telegram' && (
              <>
                <label>
                  Telegram chat ID
                  <input
                    required
                    inputMode="text"
                    pattern="-?[1-9][0-9]*"
                    maxLength={64}
                    value={form.telegram_chat_id ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        telegram_chat_id: e.target.value.trim() || null,
                      })
                    }
                  />
                </label>
                <p>
                  The customer must start a conversation with your bot first. Enter their
                  verified numeric chat ID, not a phone number or username. Telegram sends
                  real messages after approval.
                </p>
              </>
            )}
            <label>
              Language
              <select
                aria-label="Language"
                value={form.language}
                onChange={(e) =>
                  setForm({
                    ...form,
                    language: e.target.value as ProfileInput['language'],
                  })
                }
              >
                <option>English</option>
                <option>Bahasa Malaysia</option>
              </select>
            </label>
            <label>
              Tone
              <select
                aria-label="Tone"
                value={form.tone}
                onChange={(e) =>
                  setForm({ ...form, tone: e.target.value as ProfileInput['tone'] })
                }
              >
                {['Friendly', 'Neutral', 'Firm'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.do_not_contact}
                onChange={(e) => setForm({ ...form, do_not_contact: e.target.checked })}
              />
              Do not contact
            </label>
          </fieldset>
        )}
        <p className="rule-note">
          Changes apply to future reminders for this customer. Changing message
          preferences or contact eligibility may invalidate existing drafts and approvals.
          Their history will be retained.
        </p>
        {error && <p role="alert">{error}</p>}
        {(conflict || (!form && !loading)) && (
          <button
            type="button"
            className="button"
            disabled={busy || loading}
            onClick={() => void reload()}
          >
            Reload saved values
          </button>
        )}
        {conflict && (
          <p>Reload replaces the values in this form with the latest saved values.</p>
        )}
        <div className="drawer-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onClose()}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              conflict ||
              !form ||
              JSON.stringify(form) === JSON.stringify(saved && profileInput(saved))
            }
          >
            {busy ? 'Saving…' : 'Save and recalculate'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
