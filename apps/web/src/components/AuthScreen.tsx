import { Suspense, lazy, useState } from 'react';
import type { FormEvent } from 'react';
import { CHIEFTAINS, DEFAULT_CHIEFTAIN } from '@clanfire/engine';
import type { AuthRequest } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';

const ChieftainPicker = lazy(() => import('./ChieftainPicker.tsx'));

type Mode = 'login' | 'register';

/** The two account calls the form makes: the world's own (default) or the lobby's. */
export interface AuthCalls {
  login: (body: AuthRequest) => Promise<unknown>;
  register: (body: AuthRequest) => Promise<unknown>;
}

const WORLD_CALLS: AuthCalls = { login: api.login, register: api.register };

export function AuthScreen({ onAuthed, calls = WORLD_CALLS }: { onAuthed: () => void; calls?: AuthCalls }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Create account is two steps: username and password, then the chieftain. */
  const [step, setStep] = useState<'account' | 'chieftain'>('account');
  const [chieftain, setChieftain] = useState<string>(DEFAULT_CHIEFTAIN);

  const register = mode === 'register';

  function validate(): string | null {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return 'Username: 3-20 letters, digits or underscores.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    return null;
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
                At least 8 characters.
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
