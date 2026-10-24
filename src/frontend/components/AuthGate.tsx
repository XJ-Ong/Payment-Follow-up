import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ArrowRight, LockKeyhole, ShieldCheck, Loader2 } from 'lucide-react';
import App from '../App';
import {
  ApiError,
  login,
  logout,
  readSession,
  readDemoAccounts,
  type DemoAccount,
  sessionAuth,
  setSessionToken,
  type AuthSession,
} from '../api';

export default function AuthGate() {
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [session, setSession] = useState<AuthSession>();
  const [checking, setChecking] = useState(sessionAuth);
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!sessionAuth) return;
    const request = ++generation.current;
    setChecking(true);
    setConnectionError('');
    if (import.meta.env.DEV) {
      readDemoAccounts()
        .then((result) => {
          if (generation.current === request) setDemoAccounts(result.accounts ?? []);
        })
        .catch(() => {
          if (generation.current === request) setDemoAccounts([]);
        });
    }
    readSession()
      .then((result) => {
        if (generation.current !== request) return;
        setSessionToken(result.csrf_token);
        setSession(result);
      })
      .catch((err) => {
        if (generation.current !== request) return;
        if (!(err instanceof ApiError && err.status === 401))
          setConnectionError(err.message);
      })
      .finally(() => {
        if (generation.current === request) setChecking(false);
      });
    const expire = () => {
      generation.current += 1;
      setSessionToken();
      setSession(undefined);
      setPassword('');
      setNotice('Your session has ended. Sign in again to continue.');
      setChecking(false);
    };
    window.addEventListener('session-expired', expire);
    return () => {
      generation.current += 1;
      window.removeEventListener('session-expired', expire);
    };
  }, [retry]);

  if (!sessionAuth) return <App />;
  if (session)
    return (
      <App
        key={session.user.id}
        sessionUser={session.user}
        onLogout={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await logout();
            generation.current += 1;
            setSessionToken();
            setSession(undefined);
            setNotice('You have signed out.');
            setError('');
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
              setSessionToken();
              setSession(undefined);
            } else
              window.alert(
                err instanceof Error
                  ? err.message
                  : 'Unable to sign out. Please try again.',
              );
          } finally {
            setBusy(false);
          }
        }}
      />
    );

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Payment Follow-up">
        <div className="login-brand">
          orbyte<span>.</span>
        </div>
        <div className="login-story-copy">
          <span className="login-eyebrow">PAYMENT FOLLOW-UP</span>
          <h1>
            A little follow-up.
            <br />A lot of clarity.
          </h1>
          <p>
            Keep your receivables moving. Review priorities, prepare thoughtful reminders,
            and give your team a clearer view of every payment.
          </p>
          <div className="login-story-note">
            <ShieldCheck size={19} aria-hidden="true" />
            <span>
              Your team. Your workspace.
              <br />
              <small>Private access for Owner and Finance staff.</small>
            </span>
          </div>
        </div>
        <small className="login-story-footer">
          Clarity for every outstanding payment.
        </small>
      </section>
      <section className="login-panel" aria-label="Team sign in">
        <div className="login-form-wrap">
          <span className="login-lock">
            <LockKeyhole size={24} aria-hidden="true" />
          </span>
          <h2>Welcome back</h2>
          <p className="login-subtitle">Sign in to your payment follow-up workspace.</p>
          {checking ? (
            <p role="status" className="login-status">
              <Loader2 size={18} className="spin" />
              Checking your session...
            </p>
          ) : connectionError ? (
            <div role="alert" className="login-error">
              <p>{connectionError}</p>
              <button className="button" onClick={() => setRetry((n) => n + 1)}>
                Retry connection
              </button>
            </div>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setError('');
                const request = ++generation.current;
                try {
                  const result = await login(email.trim(), password);
                  if (generation.current !== request) return;
                  setSessionToken(result.csrf_token);
                  setSession(result);
                  setPassword('');
                  setNotice('');
                } catch (err) {
                  if (generation.current === request)
                    setError(err instanceof Error ? err.message : 'Unable to sign in.');
                } finally {
                  if (generation.current === request) setBusy(false);
                }
              }}
            >
              {notice && (
                <p role="status" className="login-notice">
                  {notice}
                </p>
              )}
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  placeholder="you@company.com"
                />
              </label>
              <label htmlFor="login-password">Password</label>
              <div className="login-password">
                <input
                  id="login-password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {error && (
                <p role="alert" className="login-error">
                  {error}
                </p>
              )}
              <button className="button primary login-submit" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={17} className="spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
              <p className="login-help">
                Need access or a password reset?
                <br />
                Contact your workspace administrator.
              </p>
            </form>
          )}
          {import.meta.env.DEV && demoAccounts.length > 0 && (
            <section className="login-demo-accounts" aria-label="Demo accounts">
              <div className="login-demo-heading">
                <span>TRY THE WORKSPACE</span>
                <h3>Demo accounts</h3>
              </div>
              <p>Choose an account to fill the form, then sign in.</p>
              <div className="login-demo-list">
                {demoAccounts.map((account) => (
                  <button
                    type="button"
                    key={account.email}
                    disabled={busy || checking}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password ?? '');
                      if (!account.password)
                        document.getElementById('login-password')?.focus();
                      setError('');
                    }}
                    aria-label={`Use ${account.label} demo account`}
                  >
                    <span className="login-demo-role">
                      {account.label}
                      <ArrowRight size={13} aria-hidden="true" />
                    </span>
                    <span>{account.email}</span>
                    {account.password ? (
                      <code>{account.password}</code>
                    ) : (
                      <span className="login-demo-existing">
                        Use your existing Owner password
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <small>
                Local demonstration only. Demo passwords cannot be used in production;
                existing passwords stay private.
              </small>
            </section>
          )}
          <div className="login-private">
            <ShieldCheck size={14} aria-hidden="true" />
            Private team workspace
          </div>
        </div>
      </section>
    </main>
  );
}
