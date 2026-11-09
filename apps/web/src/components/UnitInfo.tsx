// Unit info cards, all numbers from engine data (UNITS, POP_PER_UNIT, trainTimeMs ...).
//   Desktop: resting the pointer on (or focusing) a unit picture or name shows the SMALL card; click / tap / Enter opens the BIG card
//   (figure on a stage, bars against the strongest unit, flip through all units with the arrows, Esc closes).
//   Phone: a tap opens the dialog the phone always had (UnitInfoBody).
//
// Use anywhere:  const info = useUnitInfo();  ...  <button onClick={() => info.open('raider')} {...info.bind('raider')}>...</button>  {info.dialog}
// or:            <UnitInfoButton unit="raider" className="link">Raider</UnitInfoButton>   (renders its own dialog)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUILDINGS, POP_PER_UNIT, UNITS, UNIT_IDS, emptyUnits, flatTravelTimeMs, researchTimeMs, trainTimeMs } from '@clanfire/engine';
import type { UnitId, VillageState, WorldSettings } from '@clanfire/engine';
import { Icon } from '../art/Icon.tsx';
import { Cost } from './ui.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { formatDuration, formatInt } from '../format.ts';
import { useGame, useRules } from '../game.ts';
import { useIsDesktop } from '../hooks/useLayout.ts';
import { unmetRequirements } from '../rules.ts';
import { UNIT_GOOD_FOR, UNIT_ROLE } from '../unitRole.ts';
import { flipUnit, inTraining, perFieldText, statBars } from './unitCardLogic.ts';
import '../army.css';
import '../unit-card.css';

/** Time to walk one tile on flat ground at this world's speed: the same rule as the send preview (flatTravelTimeMs). */
export function timePerTileMs(unit: UnitId, settings: WorldSettings): number {
  return flatTravelTimeMs({ x: 0, y: 0 }, { x: 1, y: 0 }, { ...emptyUnits(), [unit]: 1 }, settings);
}

/** "Barracks 3, Town Hall 4" from `UnitDef.requires`. */
export function requiresText(unit: UnitId): string {
  const req = UNITS[unit].requires;
  return (Object.keys(req) as (keyof typeof req)[]).map((b) => `${BUILDINGS[b].name} ${req[b]}`).join(', ');
}

export function UnitInfoBody({ unit, settings, buildings }: { unit: UnitId; settings: WorldSettings; buildings: VillageState['buildings'] }) {
  const def = UNITS[unit];
  const role = UNIT_ROLE[unit];
  const trainBuilding = BUILDINGS[def.building];
  const level = buildings[def.building];
  // trainTimeMs only reads the building level of the state it is given.
  const perUnit = trainTimeMs(unit, { buildings } as VillageState, settings);
  const research = def.research;
  const row = (label: string, value: ReactNode) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <>
      <div className="uinfo-stage">
        <UnitFigure unit={unit} size={176} />
      </div>
      <div className="uinfo-name">
        <h2 id="unit-info-title" className="card-title">{def.name}</h2>
        <span className={`urole urole-${role.tone}`}>{role.label}</span>
        <details className="help-pop">
          <summary aria-label={`About the ${def.name}`}>?</summary>
          <p className="small">{def.description}</p>
        </details>
      </div>
      <dl className="stats uinfo-stats">
        {row('Attack', def.attack)}
        {row('Defence vs infantry', def.defenseInfantry)}
        {row('Defence vs cavalry', def.defenseCavalry)}
        {row('Speed', `${formatDuration(timePerTileMs(unit, settings))} per tile`)}
        {row('Carry', def.carry)}
        {row('Population', POP_PER_UNIT[unit])}
        {row(`Train time (${trainBuilding.name} ${Math.max(1, level)})`, `${formatDuration(perUnit)} each`)}
        {row('Unlocked by', requiresText(unit))}
      </dl>
      <div className="uinfo-cost">
        <Cost cost={def.cost} />
      </div>
      {research && (
        <p className="uinfo-note">
          Research: Drillyard {research.drillyard}, <Cost cost={research.cost} />, {formatDuration(researchTimeMs(unit, settings))}
        </p>
      )}
    </>
  );
}

/** Numbers shared by the small and the big card. */
function useCardData(unit: UnitId) {
  const { settings, live } = useGame();
  const rules = useRules();
  const def = UNITS[unit];
  const building = BUILDINGS[def.building];
  const level = live.buildings[def.building];
  const perUnitMs = trainTimeMs(unit, { buildings: live.buildings } as VillageState, settings);
  const training = inTraining(live.trainQueues)[unit];
  const unmet = unmetRequirements(live.buildings, def.requires);
  const units = UNIT_IDS.filter((u) => rules.features.siege || !UNITS[u].siege);
  return {
    def,
    building,
    level: Math.max(1, level),
    perUnitMs,
    perFieldMs: timePerTileMs(unit, settings),
    home: live.troops[unit] ?? 0,
    away: live.away[unit] ?? 0,
    training,
    locked: unmet.length > 0,
    units,
    settings,
  };
}

function Stat({ icon, label, children }: { icon: 'army' | 'time' | 'shield' | 'wood' | 'pop'; label: string; children: ReactNode }) {
  return (
    <div>
      <Icon name={icon} size={20} />
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

// ---- Small card (hover / focus) ------------------------------------------------------------------------------------

export function UnitTipCard({ unit, rect, onOpen, onHold, onRelease }: { unit: UnitId; rect: DOMRect; onOpen: () => void; onHold: () => void; onRelease: () => void }) {
  const d = useCardData(unit);
  const role = UNIT_ROLE[unit];
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - 96));
    const below = rect.bottom + h + 14 < window.innerHeight || rect.top - h - 14 < 0;
    const top = below ? rect.bottom + 10 : rect.top - h - 10;
    setPos({ left, top: Math.max(8, top), arrow: Math.max(18, Math.min(w - 36, rect.left + rect.width / 2 - left - 9)), below });
  }, [rect, unit]);
  return createPortal(
    <div
      ref={ref}
      className={`uc-tip${pos?.below === false ? ' is-above' : ''}`}
      role="tooltip"
      id="unit-tip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', ['--uc-arrow' as string]: `${pos?.arrow ?? 40}px` }}
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
    >
      <div className="uc-tip-h">
        <UnitFigure unit={unit} pose="icon" size={56} />
        <span className="uc-tip-t">
          <span className="uc-tip-n">
            <b>{d.def.name}</b>
            <span className={`uc-role uc-role-${role.tone}`}>{role.label}</span>
          </span>
          <small>
            {d.def.unitClass === 'cavalry' ? 'Riders' : 'Foot'} · trains at the {d.building.name}
          </small>
        </span>
      </div>
      <div className="uc-tip-g">
        <Stat icon="army" label="Attack">{d.def.attack}</Stat>
        <Stat icon="time" label="Speed">
          {perFieldText(d.perFieldMs)}
          <small> /field</small>
        </Stat>
        <Stat icon="shield" label="Def. vs foot">{d.def.defenseInfantry}</Stat>
        <Stat icon="wood" label="Carries">{d.def.carry}</Stat>
        <Stat icon="shield" label="Def. vs riders">{d.def.defenseCavalry}</Stat>
        <Stat icon="pop" label="People">{POP_PER_UNIT[unit]}</Stat>
      </div>
      <div className="uc-tip-c">
        <Cost cost={d.def.cost} />
        <span className="uc-tip-ti">
          <Icon name="time" size={18} />
          <b>{formatDuration(d.perUnitMs)}</b> each
        </span>
      </div>
      <p className="uc-tip-w">
        <b>Good for:</b> {UNIT_GOOD_FOR[unit]}
      </p>
      <div className="uc-tip-f">
        <span>
          {d.building.name} {d.level}
          {d.locked ? ` · needs ${requiresText(unit)}` : ''}
        </span>
        <button type="button" className="uc-link" onClick={onOpen} tabIndex={-1}>
          Full card <ChevR />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function ChevR({ flip = false }: { flip?: boolean }) {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

// ---- Big card (click / tap / Enter) ----------------------------------------------------------------------------------

function UnitBigCard({ start, onClose }: { start: UnitId; onClose: () => void }) {
  const { openBuilding } = useGame();
  const [unit, setUnit] = useState<UnitId>(start);
  const d = useCardData(unit);
  const role = UNIT_ROLE[unit];
  const bars = statBars(unit, UNIT_IDS);
  const ref = useRef<HTMLDialogElement>(null);
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
  const research = d.def.research;
  const flip = (dir: 1 | -1) => setUnit((u) => flipUnit(d.units, u, dir));
  return (
    <dialog
      ref={ref}
      className="uc-big"
      aria-labelledby="unit-info-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') flip(-1);
        else if (e.key === 'ArrowRight') flip(1);
      }}
    >
      <div className="uc-big-s">
        <div className="uc-stage">
          <UnitFigure unit={unit} size={230} />
        </div>
        <div className="uc-nav">
          <button type="button" className="fv-btn uc-ic" onClick={() => flip(-1)} aria-label="Previous unit">
            <ChevR flip />
          </button>
          <span className="fv-mut" aria-live="polite">
            {d.units.indexOf(unit) + 1} of {d.units.length}
          </span>
          <button type="button" className="fv-btn uc-ic" onClick={() => flip(1)} aria-label="Next unit">
            <ChevR />
          </button>
        </div>
      </div>
      <div className="uc-big-r">
        <div className="uc-big-h">
          <h2 id="unit-info-title">{d.def.name}</h2>
          <span className={`uc-role uc-role-${role.tone}`}>{role.label}</span>
          <span className="fv-tag">{d.def.unitClass === 'cavalry' ? 'Riders' : 'Foot'}</span>
          <span className="fv-sp" />
          <button type="button" className="fv-btn uc-x" onClick={onClose} aria-label="Close">
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <p className="uc-big-w">
          <b>Good for:</b> {UNIT_GOOD_FOR[unit]}
        </p>
        <div className="uc-bars">
          <div className="fv-up">
            Fighting <span className="uc-bars-n">· bar = against the strongest unit</span>
          </div>
          {bars.map((b) => (
            <div key={b.key} className="uc-bar">
              <span className="uc-bar-l">
                <Icon name={b.key === 'attack' ? 'army' : 'shield'} size={20} />
                {b.label}
              </span>
              <span className="uc-bar-t">
                <i style={{ width: `${b.pct}%` }} />
              </span>
              <b>{b.value}</b>
              <small>
                best: {UNITS[b.best].name} {b.max}
              </small>
            </div>
          ))}
        </div>
        <div className="uc-facts">
          <div>
            <span className="fv-up">Speed</span>
            <b>{perFieldText(d.perFieldMs)}</b>
            <small>min:sec per field</small>
          </div>
          <div>
            <span className="fv-up">Carries</span>
            <b>{d.def.carry}</b>
            <small>loot per unit</small>
          </div>
          <div>
            <span className="fv-up">People</span>
            <b>{POP_PER_UNIT[unit]}</b>
            <small>per unit</small>
          </div>
          <div>
            <span className="fv-up">Training</span>
            <b>{formatDuration(d.perUnitMs)}</b>
            <small>
              each at {d.building.name} {d.level}
            </small>
          </div>
        </div>
        <div className="uc-cost">
          <span className="fv-up">Cost</span>
          <Cost cost={d.def.cost} />
          <span className="fv-sp" />
          <span className={`uc-cost-n${d.locked ? ' is-lock' : ''}`}>
            needs {requiresText(unit)}
            {research ? (
              <>
                {' '}
                · research: Drillyard {research.drillyard}, <Cost cost={research.cost} />, {formatDuration(researchTimeMs(unit, d.settings))}
              </>
            ) : (
              ' · no research'
            )}
          </span>
        </div>
        <div className="uc-all" role="group" aria-label="All units">
          <span className="fv-up">All units</span>
          {d.units.map((u) => (
            <button key={u} type="button" className={`uc-all-u${u === unit ? ' is-on' : ''}`} onClick={() => setUnit(u)} aria-label={UNITS[u].name} aria-pressed={u === unit} title={UNITS[u].name}>
              <UnitFigure unit={u} pose="icon" size={36} />
            </button>
          ))}
        </div>
        <div className="uc-foot">
          <span className="uc-stock">
            <b>{d.home}</b> at home{d.away > 0 ? ` · ${d.away} away` : ''}{d.training > 0 ? ` · ${d.training} training` : ''}
          </span>
          <span className="fv-sp" />
          <button type="button" className="fv-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="fv-btn fv-btn-g"
            onClick={() => {
              onClose();
              openBuilding(d.def.building);
            }}
          >
            Train at the {d.building.name}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ---- Phone dialog (as before) ------------------------------------------------------------------------------------------

export function UnitInfoDialog({ unit, onClose }: { unit: UnitId; onClose: () => void }) {
  const { settings, live } = useGame();
  const desktop = useIsDesktop();
  const ref = useRef<HTMLDialogElement>(null);
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
  if (desktop) return <UnitBigCard start={unit} onClose={onClose} />;
  return (
    <dialog
      ref={ref}
      className="confirm uinfo-dialog"
      aria-labelledby="unit-info-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <UnitInfoBody unit={unit} settings={settings} buildings={live.buildings} />
      <div className="confirm-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 180;

export interface UnitBind {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: () => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
  'aria-describedby'?: string;
}

/**
 * Hook: `open(unit)` shows the big card; `bind(unit)` gives the props that show the small card while the pointer rests on / keyboard
 * focus is on an element (desktop only; spread them on the button or picture); render `dialog` once in the component.
 */
export function useUnitInfo(): { open: (unit: UnitId) => void; bind: (unit: UnitId) => UnitBind; dialog: ReactNode } {
  const desktop = useIsDesktop();
  const [unit, setUnit] = useState<UnitId | null>(null);
  const [tip, setTip] = useState<{ unit: UnitId; rect: DOMRect } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const hide = useCallback((delay: number) => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTip(null), delay);
  }, []);
  // Closing the big card puts focus back on its button: that must not pop the small card straight up again.
  const quiet = useRef(0);
  const show = (u: UnitId, el: HTMLElement, delay: number) => {
    clear();
    if (Date.now() < quiet.current) return;
    timer.current = window.setTimeout(() => setTip({ unit: u, rect: el.getBoundingClientRect() }), delay);
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!tip) return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null);
    };
    const away = () => setTip(null);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', away, true);
    };
  }, [tip]);
  const open = (u: UnitId) => {
    clear();
    setTip(null);
    setUnit(u);
  };
  const bind = (u: UnitId): UnitBind =>
    !desktop
      ? {}
      : {
          onPointerEnter: (e) => {
            if (e.pointerType === 'touch') return;
            show(u, e.currentTarget, SHOW_DELAY_MS);
          },
          onPointerLeave: () => hide(HIDE_DELAY_MS),
          onFocus: (e) => {
            if (e.currentTarget.matches(':focus-visible')) show(u, e.currentTarget, 0);
          },
          onBlur: () => hide(0),
          ...(tip?.unit === u ? { 'aria-describedby': 'unit-tip' } : {}),
        };
  return {
    open,
    bind,
    dialog: (
      <>
        {unit && (
          <UnitInfoDialog
            unit={unit}
            onClose={() => {
              quiet.current = Date.now() + 600;
              setUnit(null);
            }}
          />
        )}
        {tip && !unit && <UnitTipCard unit={tip.unit} rect={tip.rect} onOpen={() => open(tip.unit)} onHold={clear} onRelease={() => hide(HIDE_DELAY_MS)} />}
      </>
    ),
  };
}

/** A button (styled by `className`) that opens the card for `unit`; children default to the unit's name. */
export function UnitInfoButton({ unit, className, children }: { unit: UnitId; className?: string; children?: ReactNode }) {
  const info = useUnitInfo();
  const desktop = useIsDesktop();
  return (
    <>
      <button type="button" className={className ?? 'link link-touch'} onClick={() => info.open(unit)} aria-haspopup="dialog" title={desktop ? undefined : `About the ${UNITS[unit].name}`} {...info.bind(unit)}>
        {children ?? UNITS[unit].name}
      </button>
      {info.dialog}
    </>
  );
}
