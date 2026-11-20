// Fill-up resource pills (phone chips and the desktop strip): each of wood/food/iron/gold is one pill whose background fills
// from the left like a jar (amount / Storehouse cap). Moss below 90%, gold from 90%, a pink pill with a brick border when full.
// Tapping a pill opens a small card with the exact numbers and the time until it is full.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RESOURCE_IDS, productionPerHour, storageCap } from '@clanfire/engine';
import type { ResourceId } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { useGame } from '../game.ts';
import { formatCompact, formatCompactShort, formatInt, formatLeft, formatRate } from '../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';

export type FillState = 'ok' | 'near' | 'full';

/** Below 90% of the Storehouse cap: ok; from 90%: near; from 99.9%: full. */
export function fillState(ratio: number): FillState {
  return ratio >= 0.999 ? 'full' : ratio >= 0.9 ? 'near' : 'ok';
}

/** "Full in 27h" text: hours up to two days, then days and hours; null when it is full or does not grow. */
export function fullInText(amount: number, cap: number, perHour: number): string | null {
  if (amount >= cap || perHour <= 0) return null;
  const hours = (cap - amount) / perHour;
  return hours < 1 || hours >= 48 ? formatLeft(hours * 3_600_000) : `${Math.ceil(hours)}h`;
}

/** Screen-reader label of a pill: amount, cap, rate and the fill state. */
export function pillLabel(name: string, amount: number, cap: number, perHour: number, state: FillState): string {
  const r = Math.round(perHour);
  return `${name}: ${formatInt(amount)} of ${formatInt(cap)}, ${r < 0 ? 'minus ' : 'plus '}${formatInt(Math.abs(r))} per hour${state === 'full' ? ', full' : state === 'near' ? ', almost full' : ''}`;
}

/** The tap card: exact numbers, the state tag and either the time until full or the "storage is full" warning. */
export function ResourceCard({ id, amount, cap, perHour, style, cardId }: { id: ResourceId; amount: number; cap: number; perHour: number; style?: CSSProperties; cardId?: string }) {
  const name = RESOURCE_NAME[id];
  const state = fillState(cap > 0 ? amount / cap : 0);
  const full = fullInText(amount, cap, perHour);
  const r = Math.round(perHour);
  return (
    <div className="rp-card" id={cardId} role="group" aria-label={`${name} details`} style={style}>
      <h4>
        {name}
        {state === 'full' && <span className="rp-tag is-full">FULL</span>}
        {state === 'near' && <span className="rp-tag is-near">Almost full</span>}
      </h4>
      <dl>
        <dt>In store</dt>
        <dd>{formatInt(amount)}</dd>
        <dt>Storehouse holds</dt>
        <dd>{formatInt(cap)}</dd>
        <dt>Per hour</dt>
        <dd>
          {r < 0 ? '-' : '+'}
          {formatInt(Math.abs(r))}
        </dd>
        {full && (
          <>
            <dt>Full in</dt>
            <dd>{full}</dd>
          </>
        )}
      </dl>
      {state === 'full' && <p>Storage is full: new {name.toLowerCase()} is lost until you spend some or upgrade the Storehouse.</p>}
    </div>
  );
}

/**
 * The four resource pills inside a `<ul>`. `compact` = phone (number only); otherwise the number and the rate.
 * `before`/`after` are extra `<li>` pills (Storehouse, population) on the desktop strip. `initialOpen` is for tests.
 */
export function ResourcePills({ compact, before, after, className, initialOpen }: { compact?: boolean; before?: ReactNode; after?: ReactNode; className?: string; initialOpen?: ResourceId }) {
  const { live, settings } = useGame();
  const cap = storageCap(live);
  const net = productionPerHour(live, settings);
  const [open, setOpen] = useState<ResourceId | null>(initialOpen ?? null);
  const wrap = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined);

  // Close on outside press and Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || wrap.current?.contains(e.target)) return;
      setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // Place the card under the open pill (fixed to the window; phone: full width with the arrow on the pill).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = wrap.current?.querySelector<HTMLElement>(`[data-res="${open}"]`);
      if (!btn) return;
      const b = btn.getBoundingClientRect();
      const mid = b.left + b.width / 2;
      if (compact) setPos({ top: b.bottom + 12, left: 12, right: 12, '--arrow': `${mid - 12 - 7}px` } as CSSProperties);
      else {
        const w = 300;
        const left = Math.max(12, Math.min(window.innerWidth - w - 12, mid - w / 2));
        setPos({ top: b.bottom + 12, left, width: w, '--arrow': `${mid - left - 7}px` } as CSSProperties);
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, compact]);

  return (
    <ul ref={wrap} className={`rp-list${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} aria-label="Resources">
      {before}
      {RESOURCE_IDS.map((r) => {
        const amount = Math.floor(live.resources[r] + 1e-9);
        const ratio = cap > 0 ? live.resources[r] / cap : 0;
        const state = fillState(ratio);
        const rate = net[r];
        const q = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        const name = RESOURCE_NAME[r];
        return (
          <li key={r} className="rp-item">
            <button
              type="button"
              className={`rp is-${state}${open === r ? ' is-open' : ''}`}
              data-res={r}
              style={{ '--rp-q': q } as CSSProperties}
              aria-expanded={open === r}
              aria-controls={`rp-card-${r}`}
              aria-label={pillLabel(name, amount, cap, rate, state)}
              title={`${name}: ${formatInt(amount)} of ${formatInt(cap)}${state === 'full' ? ' (full)' : ''}`}
              onClick={() => setOpen(open === r ? null : r)}
            >
              <span className="token" aria-hidden="true">
                <Icon name={RESOURCE_ICON[r]} size={compact ? 14 : 24} />
              </span>
              <span className="rp-amount" aria-hidden="true">
                {compact ? formatCompactShort(amount) : formatCompact(amount)}
              </span>
              {!compact && (
                <span className={`rp-rate${Math.round(rate) < 0 ? ' is-neg' : ''}`} aria-hidden="true">
                  {formatRate(rate)}
                </span>
              )}
            </button>
          </li>
        );
      })}
      {after}
      {open && (
        <li className="rp-cardli">
          <ResourceCard id={open} amount={Math.floor(live.resources[open] + 1e-9)} cap={cap} perHour={net[open]} style={pos} cardId={`rp-card-${open}`} />
        </li>
      )}
    </ul>
  );
}
