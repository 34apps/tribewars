// Unit info card: a dialog with the big figure and every number of one unit, all from engine data.
//
// Use anywhere:  const info = useUnitInfo();  ...  <button onClick={() => info.open('raider')}>...</button>  {info.dialog}
// or:            <UnitInfoButton unit="raider" className="link">Raider</UnitInfoButton>   (renders its own dialog)

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILDINGS, POP_PER_UNIT, UNITS, emptyUnits, flatTravelTimeMs, researchTimeMs, trainTimeMs } from '@clanfire/engine';
import type { UnitId, VillageState, WorldSettings } from '@clanfire/engine';
import { Cost } from './ui.tsx';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { UNIT_ROLE } from '../unitRole.ts';
import '../army.css';

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

export function UnitInfoDialog({ unit, onClose }: { unit: UnitId; onClose: () => void }) {
  const { settings, live } = useGame();
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

/** Hook: `open(unit)` shows the card; render `dialog` once in the component. */
export function useUnitInfo(): { open: (unit: UnitId) => void; dialog: ReactNode } {
  const [unit, setUnit] = useState<UnitId | null>(null);
  return {
    open: setUnit,
    dialog: unit ? <UnitInfoDialog unit={unit} onClose={() => setUnit(null)} /> : null,
  };
}

/** A button (styled by `className`) that opens the card for `unit`; children default to the unit's name. */
export function UnitInfoButton({ unit, className, children }: { unit: UnitId; className?: string; children?: ReactNode }) {
  const info = useUnitInfo();
  return (
    <>
      <button type="button" className={className ?? 'link link-touch'} onClick={() => info.open(unit)} aria-haspopup="dialog" title={`About the ${UNITS[unit].name}`}>
        {children ?? UNITS[unit].name}
      </button>
      {info.dialog}
    </>
  );
}
