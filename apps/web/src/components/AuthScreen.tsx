import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { DEFAULT_CHIEFTAIN } from '@clanfire/engine';
import type { AuthRequest, LobbyChangePasswordRequest } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';

const ChieftainPicker = lazy(() => import('./ChieftainPicker.tsx'));

export type Mode = 'login' | 'register';

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

/** A full-screen sheet on phones, a centred dialog from 640 px: used by the inline variant for the steps after the form. */
function OverlayDialog({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="auth-overlay"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      {children}
    </dialog>
  );
}

export interface AuthScreenProps {
  onAuthed: () => void;
  calls?: AuthCalls;
  initialMode?: Mode;
  /** Lobby homepage: a small link back to it. */
  onBack?: () => void;
  /** Homepage card: only the tabs and the form (no crest, tagline or blurb); the later steps open in an overlay. */
  inline?: boolean;
  /** Inline only: a new `n` switches to `mode` and focuses the username field (the top bar's "Sign in", a world's "Join"). */
  request?: { mode: Mode; n: number };
}

export function AuthScreen({ onAuthed, calls = WORLD_CALLS, initialMode = 'login', onBack, inline = false, request }: AuthScreenProps) {
  const usernameRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
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

  // The homepage asks for a tab (and the username field) from outside.
  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    setStep('account');
    setChanging(false);
    setError(null);
    usernameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

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

  const changeCard = (
    <div className="auth-card">
      <div className="auth-brand">
        <h1 id="auth-change-title">Choose a new password</h1>
        <p className="auth-tagline">Old password no longer meets the rules.</p>
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
            Min {passwordMin} characters. Not common, no username.
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
  );

  const chieftainCard = (
    <div className="auth-card auth-card-wide">
      <div className="auth-step-head">
        <button type="button" className="btn btn-icon" aria-label="Back to account details" disabled={busy} onClick={() => setStep('account')}>
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <p className="auth-step-count">Step 2 of 2</p>
          <h1 className="auth-step-title" id="auth-chief-title">Chieftain</h1>
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
      </div>
    </div>
  );

  if (!inline) {
    if (changing) return <div className="auth">{changeCard}</div>;
    if (register && step === 'chieftain') return <div className="auth">{chieftainCard}</div>;
  }

  const tabs = (
    <div className="auth-tabs" role="tablist" aria-label="Account">
      {(inline ? (['register', 'login'] as const) : (['login', 'register'] as const)).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            className={active ? 'is-active' : ''}
            onClick={() => {
              setMode(m);
              setStep('account');
              setError(null);
            }}
            type="button"
          >
            {m === 'login' ? 'Sign in' : inline ? 'New player' : 'Create account'}
          </button>
        );
      })}
    </div>
  );

  const form = (
    <form onSubmit={submit} className="auth-form" noValidate>
      <label className="field">
        <span className={inline ? 'visually-hidden' : undefined}>Username</span>
        <input
          ref={usernameRef}
          placeholder={inline ? 'Username' : undefined}
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
            3-20 letters, digits, _
          </small>
        )}
      </label>
      <label className="field">
        <span className={inline ? 'visually-hidden' : undefined}>Password</span>
        <input
          placeholder={inline ? 'Password' : undefined}
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
            {passwordMin > 8 ? `Min ${passwordMin} characters. Not common, no username.` : 'Min 8 characters.'}
          </small>
        )}
      </label>
      <div className="form-error" role="alert" aria-live="assertive">
        {error}
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : register ? (inline ? 'Play free' : 'Next') : 'Sign in'}
      </button>
    </form>
  );

  if (inline) {
    return (
      <div className="auth-inline">
        {tabs}
        {form}
        {changing && (
          <OverlayDialog labelledBy="auth-change-title" onClose={() => setChanging(false)}>
            {changeCard}
          </OverlayDialog>
        )}
        {!changing && register && step === 'chieftain' && (
          <OverlayDialog labelledBy="auth-chief-title" onClose={() => !busy && setStep('account')}>
            {chieftainCard}
          </OverlayDialog>
        )}
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

        {tabs}
        {form}

        {onBack && (
          <button type="button" className="auth-back" onClick={onBack}>
            <span aria-hidden="true">←</span> Back
          </button>
        )}

        <ul className="auth-blurb">
          <li><Icon name="food" size={26} /> Build</li>
          <li><Icon name="army" size={26} /> Raid</li>
          <li><Icon name="shield" size={26} /> Protected start</li>
        </ul>
      </div>
    </div>
  );
}
