import type { ReactNode } from 'react';
import { Flame } from './Flame.tsx';

function Logo({ loading = false }: { loading?: boolean }) {
  return (
    <div className="splash-logo" aria-hidden="true">
      {loading && (
        <span className="splash-smoke">
          <i />
          <i />
          <i />
          <b />
          <b />
        </span>
      )}
      <Flame size={44} loading={loading} />
    </div>
  );
}

/** Full-screen "please wait" splash (role=status). */
export function LoadingSplash({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="splash" role="status">
      <Logo loading />
      <p>{text}</p>
      {children}
    </div>
  );
}

/** Full-screen error splash with a retry button (role=alert). */
export function ErrorSplash({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="splash" role="alert">
      <Logo />
      <p>{message}</p>
      <button className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
