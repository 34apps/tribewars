// The two little helpers on the village picture: a speech-bubble "Upgrade the Lumber Camp" pointing at the building the player
// should look at next (guide.ts picks it), and the hover tooltip (name, level, "Up to N" + cost, or why it is locked).
// HTML laid over the scene like the labels, so they stay crisp and readable at any zoom. Parchment tokens only.

import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { BUILDINGS, RESOURCE_IDS } from '@clanfire/engine';
import { Icon } from '../../art/Icon.tsx';
import { Mags } from '../../art/Mags.tsx';
import { BuildState } from '../../components/BuildState.tsx';
import { formatDuration, formatLeft } from '../../format.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../../icons.ts';
import { requirementText } from '../../rules.ts';
import { costShort } from './FrameParts.tsx';
import type { BuildingInfo } from './buildingInfo.ts';
import type { Guide } from './guide.ts';

/** Icons + amounts of the next level's cost; the ones the stock cannot pay are red. */
export function CostChips({ info }: { info: BuildingInfo }) {
  const cost = info.cost;
  if (!cost) return null;
  return (
    <span className="fv-bcost">
      {RESOURCE_IDS.filter((r) => cost[r] > 0).map((r) => {
        const short = info.short(r);
        return (
          <span key={r} className={short ? 'is-short' : ''}>
            <Icon name={RESOURCE_ICON[r]} size={16} />
            <b>{costShort(cost[r])}</b>
            {short && <span className="visually-hidden"> (not enough {RESOURCE_NAME[r]})</span>}
          </span>
        );
      })}
    </span>
  );
}

/** Where the bubble sits: above the building's label, or below it when the building is near the top of the picture. */
export interface Spot {
  left: string;
  top: string;
  below: boolean;
}

/** Slide a bubble sideways (and keep its tail on the building) when it would stick out of the picture's frame. */
function useKeepInside(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const frame = el?.closest('.vv-view');
    if (!el || !frame) return;
    el.style.setProperty('--shift', '0px');
    const b = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const pad = 8;
    const shift = b.left < f.left + pad ? f.left + pad - b.left : b.right > f.right - pad ? f.right - pad - b.right : 0;
    if (shift !== 0) el.style.setProperty('--shift', `${Math.round(shift)}px`);
  });
}

const spotStyle = (s: Spot): CSSProperties => ({ left: s.left, top: s.top });

export function GuideCallout({
  guide,
  info,
  spot,
  busy,
  onBuild,
  onOpen,
}: {
  guide: Guide;
  info: BuildingInfo;
  spot: Spot;
  busy: boolean;
  onBuild: () => void;
  onOpen: () => void;
}) {
  const upgrade = guide.kind === 'upgrade';
  const ref = useRef<HTMLDivElement>(null);
  useKeepInside(ref);
  return (
    <div ref={ref} className={`vv-guide${spot.below ? ' is-below' : ''}`} style={spotStyle(spot)} role="group" aria-label={`Tip: ${guide.title}`}>
      <button type="button" className="vv-guide-main" onClick={onOpen}>
        <Mags size={34} className="vv-guide-mags" />
        <span className="vv-guide-text">
          <b>{guide.title}</b>
          <small>{upgrade ? <>To level {info.target} <CostChips info={info} /></> : 'Open the Barracks'}</small>
        </span>
      </button>
      {upgrade && <BuildState info={info} busy={busy} onBuild={onBuild} />}
    </div>
  );
}

/** The one line under the name in the hover tooltip. */
function tipLine(info: BuildingInfo) {
  const { kind } = info.pick;
  if (kind === 'upgrading') return <>Upgrading to {info.active?.targetLevel ?? info.target} · {formatDuration(info.upgradingLeftMs ?? 0)}</>;
  if (kind === 'queued') return <>Queued: level {info.jobs[info.jobs.length - 1]?.targetLevel ?? info.target}</>;
  if (kind === 'max') return <>Max level</>;
  if (kind === 'locked') return <>Needs {requirementText(info.unmet)}</>;
  const up = (
    <>
      {info.level === 0 ? 'Build' : 'Up'} to {info.target} <CostChips info={info} />
    </>
  );
  if (info.pick.actionable) return up;
  if (kind === 'afford') return <>{up} · ready in {info.affordInMs === null ? (info.goldHint ? 'never (needs gold)' : 'a long while') : formatLeft(info.affordInMs)}</>;
  if (kind === 'queuefull') return <>{up} · queue full</>;
  return <>{info.reason ?? up}</>;
}

export function HoverTip({ info, spot }: { info: BuildingInfo; spot: Spot }) {
  const name = BUILDINGS[info.id].name;
  const ref = useRef<HTMLDivElement>(null);
  useKeepInside(ref);
  return (
    <div ref={ref} className={`vv-tip${spot.below ? ' is-below' : ''}`} style={spotStyle(spot)} role="tooltip">
      <b>
        {name} <span className="vv-tip-lv">{info.level === 0 ? 'not built' : `level ${info.level}`}</span>
      </b>
      <span className="vv-tip-line">{tipLine(info)}</span>
    </div>
  );
}
