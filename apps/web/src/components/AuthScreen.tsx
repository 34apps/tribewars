import { Suspense, lazy, useState } from 'react';
import type { FormEvent } from 'react';
import { CHIEFTAINS, DEFAULT_CHIEFTAIN } from '@clanfire/engine';
import type { AuthRequest, LobbyChangePasswordRequest } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';

const ChieftainPicker = lazy(() => import('./ChieftainPicker.tsx'));

type Mode = 'login' | 'register';

/** The two account calls the form makes: the world's own (default) or the lobby's. */
export interface AuthCalls {
  login: (body: AuthRequest) => Promise<unknown>;
  register: (body: AuthRequest) => Promise<unknown>;
  /** The lobby only: replace the password when sign-in answers `password_change_required`. */
  changePassword?: (body: LobbyChangePasswordRequest) => Promise<unknown>;
  /** Shortest new password (the server decides; this only gives a quicker message). Default 8. */
  passwordMin?: number;
}

const WORLD_CALLS: AuthCalls = { login: api.login, register: api.register };

/** The first problem with a new password that can be seen without the server (the common-password list stays on the server). */
export function newPasswordProblem(password: string, username: string, min: number): string | null {
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (username !== '' && password.toLowerCase().includes(username.toLowerCase())) return 'Your password must not contain your username.';
  return null;
}

export function AuthScreen({ onAuthed, calls = WORLD_CALLS }: { onAuthed: () => void; calls?: AuthCalls }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Create account is two steps: username and password, then the chieftain. */
  const [step, setStep] = useState<'account' | 'chieftain'>('account');
  const [chieftain, setChieftain] = useState<string>(DEFAULT_CHIEFTAIN);

  /** Set when sign-in said the password must be replaced: the form then asks for a new one. */
  const [changing, setChanging] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const register = mode === 'register';
  const passwordMin = calls.passwordMin ?? 8;

  function validate(): string | null {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return 'Username: 3-20 letters, digits or underscores.';
    return newPasswordProblem(password, username, passwordMin);
  }

  async function submitChange(e: FormEvent) {
    e.preventDefault();
    if (busy || !calls.changePassword) return;
    const problem = newPasswordProblem(newPassword, username.trim(), passwordMin);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await calls.changePassword({ username: username.trim(), password, newPassword });
      onAuthed();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = register ? validate() : username.trim() === '' || password === '' ? 'Enter your username and password.' : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (register) {
      setStep('chieftain');
      return;
    }
    setBusy(true);
    try {
      await calls.login({ username: username.trim(), password });
      onAuthed();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'password_change_required' && calls.changePassword) {
        setChanging(true);
        setNewPassword('');
      }
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function leadClan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await calls.register({ username: username.trim(), password, chieftain });
      onAuthed();
    } catch (err) {
      // Most failures (name taken, rate limit) are about the account fields: go back to them with the message.
      setError(errorMessage(err));
      setStep('account');
      setBusy(false);
    }
  }

  if (changing) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-brand">
            <h1>Choose a new password</h1>
            <p className="auth-tagline">Your account is fine. Your old password just no longer meets our rules.</p>
          </div>
          <form onSubmit={submitChange} className="auth-form" noValidate>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-describedby="new-password-hint"
                autoFocus
                required
              />
              <small id="new-password-hint" className="hint">
                At least {passwordMin} characters. Not a common password, and not containing your username.
              </small>
            </label>
            <div className="form-error" role="alert" aria-live="assertive">
              {error}
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : 'Save and sign in'}
            </button>
            <button
              className="btn btn-block"
              type="button"
              disabled={busy}
              onClick={() => {
                setChanging(false);
                setPassword('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (register && step === 'chieftain') {
    const chosen = CHIEFTAINS.find((c) => c.id === chieftain) ?? CHIEFTAINS[0];
    return (
      <div className="auth">
        <div className="auth-card auth-card-wide">
          <div className="auth-step-head">
            <button type="button" className="btn btn-icon" aria-label="Back to account details" disabled={busy} onClick={() => setStep('account')}>
              <span aria-hidden="true">←</span>
            </button>
            <div>
              <p className="auth-step-count">Step 2 of 2</p>
              <h1 className="auth-step-title">Choose your chieftain</h1>
            </div>
          </div>
          <Suspense fallback={<p className="muted auth-step-loading" role="status">Loading chieftains…</p>}>
            <ChieftainPicker value={chieftain} onChange={setChieftain} welcome disabled={busy} />
          </Suspense>
          <div className="auth-step-foot">
            <div className="form-error" role="alert" aria-live="assertive">
              {error}
            </div>
            <button type="button" className="btn btn-primary btn-block btn-lead" disabled={busy} onClick={() => void leadClan()}>
              {busy ? 'Please wait…' : 'Lead your clan'}
            </button>
            <p className="auth-step-note">{chosen.name} will lead your clan.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-crest" aria-hidden="true">
            <Icon name="flame" size={52} />
          </span>
          <h1>Clanfire</h1>
          <p className="auth-tagline">Build a village. Train an army. Raid the world.</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button
            role="tab"
            aria-selected={!register}
            className={!register ? 'is-active' : ''}
            onClick={() => {
              setMode('login');
              setStep('account');
              setError(null);
            }}
            type="button"
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={register}
            className={register ? 'is-active' : ''}
            onClick={() => {
              setMode('register');
              setStep('account');
              setError(null);
            }}
            type="button"
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="auth-form" noValidate>
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby={register ? 'username-hint' : undefined}
              required
            />
            {register && (
              <small id="username-hint" className="hint">
                3-20 letters, digits or underscores.
              </small>
            )}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={register ? 'password-hint' : undefined}
              required
            />
            {register && (
              <small id="password-hint" className="hint">
                {passwordMin > 8 ? `At least ${passwordMin} characters. Not a common password, and not containing your username.` : 'At least 8 characters.'}
              </small>
            )}
          </label>
          <div className="form-error" role="alert" aria-live="assertive">
            {error}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Next: choose your chieftain' : 'Sign in'}
          </button>
        </form>

        <ul className="auth-blurb">
          <li><Icon name="food" size={26} /> Grow wood, food, iron and gold in your own village.</li>
          <li><Icon name="send" size={26} /> Train raiders and cavalry, then plunder abandoned villages.</li>
          <li><Icon name="shield" size={26} /> New villages are protected for the first days. Take your time.</li>
        </ul>
      </div>
    </div>
  );
}
