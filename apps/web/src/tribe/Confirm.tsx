import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

function ConfirmDialog({ title, body, confirmLabel, danger, resolve }: Pending) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        resolve(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) resolve(false);
      }}
    >
      <h2 id="confirm-title" className="card-title">{title}</h2>
      <div className="confirm-body">{body}</div>
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={() => resolve(false)}>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => resolve(true)}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** `confirm(options)` resolves true/false; render `dialog` once somewhere in the tree. */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({
          ...options,
          resolve: (ok) => {
            setPending(null);
            resolve(ok);
          },
        });
      }),
    [],
  );
  return { confirm, dialog: pending ? <ConfirmDialog {...pending} /> : null };
}
