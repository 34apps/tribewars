import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';

type Mode = 'login' | 'register';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setError(null);
    try {
      const body = { username: username.trim(), password };
      await (register ? api.register(body) : api.login(body));
      onAuthed();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
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
            {busy ? 'Please wait…' : register ? 'Create account and start' : 'Sign in'}
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
