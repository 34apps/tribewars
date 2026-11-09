import { normalizeKind, toastRole } from './toastKind.ts';
import type { ToastKind, ToastKindInput } from './toastKind.ts';
import './toasts.css';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKindInput;
  action?: { label: string; onClick: () => void } | undefined;
}

/** The round badge: a filled circle with a glyph per kind (colour is never the only cue). */
function Badge({ kind }: { kind: ToastKind }) {
  return (
    <svg className="toast-badge" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <circle cx="14" cy="14" r="13" className="tb-fill" />
      {kind === 'error' && <path d="M9.5 9.5l9 9M18.5 9.5l-9 9" className="tb-glyph" />}
      {kind === 'warning' && (
        <>
          <path d="M14 7.5v8" className="tb-glyph" />
          <circle cx="14" cy="20" r="1.6" className="tb-dot" />
        </>
      )}
      {kind === 'success' && <path d="M8.5 14.5l4 4 7-8.5" className="tb-glyph" />}
      {kind === 'info' && (
        <>
          <path d="M14 13v8" className="tb-glyph" />
          <circle cx="14" cy="8.6" r="1.6" className="tb-dot" />
        </>
      )}
    </svg>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const kind = normalizeKind(t.kind);
        return (
          <div key={t.id} className={`toast toast-${kind}`} role={toastRole(kind)}>
            <Badge kind={kind} />
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-act"
                onClick={() => {
                  t.action?.onClick();
                  onDismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
