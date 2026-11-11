import { RESOURCE_IDS } from '@clanfire/engine';
import type { Resources } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { formatInt } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { normalizeKind, toastRole } from './toastKind.ts';
import type { ToastKind, ToastKindInput } from './toastKind.ts';
import './toasts.css';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKindInput;
  action?: { label: string; onClick: () => void } | undefined;
  resources?: Resources | undefined;
}

/** "+150 wood +80 food" as big icon chips. */
function Gains({ resources }: { resources: Resources }) {
  const ids = RESOURCE_IDS.filter((r) => resources[r] > 0);
  if (ids.length === 0) return null;
  return (
    <span className="toast-gains">
      {ids.map((r) => (
        <span key={r} className="toast-gain" title={RESOURCE_NAME[r]}>
          <Icon name={RESOURCE_ICON[r]} size={24} />
          <b>+{formatInt(Math.round(resources[r]))}</b>
          <span className="visually-hidden"> {RESOURCE_NAME[r]}</span>
        </span>
      ))}
    </span>
  );
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
            <span className="toast-msg">
              {t.message}
              {t.resources && <Gains resources={t.resources} />}
            </span>
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
