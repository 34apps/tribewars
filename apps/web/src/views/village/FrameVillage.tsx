// The desktop Village page inside the fixed 1440x900 frame (owner-approved mockup mix-village-1440): a left column (build queue,
// movements, per hour), the framed village picture with troops, First steps and Renown (or Standing) in the middle, and the list of
// all buildings with a quick "Up" on the right. Everything is real client data; actions call the same endpoints as the panels.
// Clicking a building opens its own page (`#village/b/<id>`): the left column stays, the main area shows the building panel.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILDING_IDS, UNITS, UNIT_IDS, villagePoints } from '@clanfire/engine';
import { api } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Mags } from '../../art/Mags.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { Cost } from '../../components/ui.tsx';
import { FIRST_STEP_LABEL, claimableSteps, doneCount, firstStepsVisible, nextOpenStep } from '../../firstSteps.ts';
import { formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { BuildingPage } from './FrameBuilding.tsx';
import { BuildingRow, Chev, LeftColumn } from './FrameParts.tsx';
import { useFirstSteps } from './FirstSteps.tsx';
import { VillageScene } from './VillageScene.tsx';
import { useBuild } from './useBuild.ts';
import type { BuildingId } from '@clanfire/engine';

// ---- Centre ----------------------------------------------------------------------------------------------------------

function TroopsPanel() {
  const { live, navigate } = useGame();
  const chiefs = live.troops.chieftain ?? 0;
  return (
    <section className="fv-pn fv-troops" aria-label="Troops at home">
      <div className="fv-ph">
        <h2>Troops at home</h2>
        <span className="fv-sp" />
        {chiefs > 0 && (
          <span className="fv-chf">
            <UnitFigure unit="chieftain" pose="icon" size={26} />
            <span>
              <b>
                {chiefs} {chiefs === 1 ? 'Chieftain' : 'Chieftains'}
              </b>{' '}
              ready
            </span>
          </span>
        )}
        <button type="button" className="fv-lk" onClick={() => navigate('army')}>
          Army <Chev />
        </button>
      </div>
      <ul className="fv-trow">
        {UNIT_IDS.map((u) => {
          const n = live.troops[u] ?? 0;
          return (
            <li key={u} className={`fv-tq${n === 0 ? ' is-off' : ''}`} aria-label={`${n} ${UNITS[u].name}`} title={UNITS[u].name}>
              <UnitFigure unit={u} pose="icon" size={38} />
              <b>{n > 0 ? formatInt(n) : '–'}</b>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FirstStepsPanel({ onShowBuilding }: { onShowBuilding: (id: BuildingId) => void }) {
  const { firstSteps, busy, claim, show } = useFirstSteps(onShowBuilding);
  if (!firstStepsVisible(firstSteps)) return null;
  const total = firstSteps.steps.length;
  const done = doneCount(firstSteps);
  const waiting = claimableSteps(firstSteps)[0] ?? null;
  const next = nextOpenStep(firstSteps);
  const step = waiting ?? next;
  return (
    <section className="fv-pn fv-fs" aria-label="First steps">
      <div className="fv-ph">
        <h2>First steps</h2>
        <span className="fv-sp" />
        <span className="fv-cnt" aria-label={`${done} of ${total} done`}>
          {done} / {total}
        </span>
      </div>
      <div className="fv-qc">
        <Mags size={58} className="fv-mags" />
        <div className="fv-qc-body">
          <div className="fv-qline">{step ? (waiting ? `${FIRST_STEP_LABEL[step.id]}: done` : FIRST_STEP_LABEL[step.id]) : 'Everything done'}</div>
          <div className="fv-qmeta">
            <span className="fv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="First steps done">
              <i style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span>
              {done} of {total}
            </span>
          </div>
          {step && (
            <div className="fv-qmeta fv-qreward">
              <span className="fv-rw">
                Reward: <Cost cost={step.reward} />
              </span>
              <span className="fv-sp" />
              {waiting ? (
                <button type="button" className="fv-btn fv-btn-g sm" disabled={busy !== null} onClick={() => claim(waiting)}>
                  {busy === waiting.id ? '...' : 'Claim'}
                </button>
              ) : (
                <button type="button" className="fv-btn sm" onClick={() => show(step)}>
                  Go
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** My rank by Renown from the existing ranking endpoint (my own row, also outside the top 100). Refreshes while the page is open. */
function useRenownRank(active: boolean): number | null {
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    const load = () =>
      api
        .renownRanking()
        .then((r) => {
          if (!dead) setRank(r.me?.rank ?? null);
        })
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [active]);
  return rank;
}

function useStanding(active: boolean) {
  const { renown, villages, player } = useGame();
  const rank = useRenownRank(active);
  const points = villages.reduce((sum, v) => sum + villagePoints(v.state), 0);
  return { renown, rank: rank === null ? '–' : `#${formatInt(rank)}`, points: formatInt(points), tag: player.tribe ? player.tribe.tag : '–', villages: renown.villages };
}

function RenownPanel({ active }: { active: boolean }) {
  const s = useStanding(active);
  return (
    <section className="fv-pn fv-rn" aria-label="Renown">
      <div className="fv-ph">
        <h2>Renown</h2>
      </div>
      <div className="fv-rn2">
        <Icon name="renown" size={40} />
        <span>
          <b>{formatInt(s.renown.balance)}</b>
          <small>Next village {formatInt(s.renown.nextVillageCost)}</small>
        </span>
      </div>
      <div className="fv-rn3">
        <span className="fv-up">Rank</span>
        <b>{s.rank}</b>
        <span className="fv-up fv-gap">Points</span>
        <b>{s.points}</b>
      </div>
    </section>
  );
}

/** Replaces First steps and Renown once the steps are finished (or hidden). */
function StandingPanel({ active }: { active: boolean }) {
  const s = useStanding(active);
  const toGo = Math.max(0, s.renown.nextVillageCost - s.renown.balance);
  return (
    <section className="fv-pn fv-standing" aria-label="Standing">
      <div className="fv-ph">
        <h2>Standing</h2>
      </div>
      <div className="fv-stb">
        <div className="fv-stren">
          <Icon name="renown" size={44} />
          <span>
            <b>{formatInt(s.renown.balance)}</b>
            <small>{toGo > 0 ? `${formatInt(toGo)} to go` : 'Village affordable'}</small>
          </span>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Rank</span>
          <b>{s.rank}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Points</span>
          <b>{s.points}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Tribe</span>
          <b>{s.tag}</b>
        </div>
        <div className="fv-stf">
          <span className="fv-up">Villages</span>
          <b>{formatInt(s.villages)}</b>
        </div>
      </div>
    </section>
  );
}

// ---- Right column: all buildings ---------------------------------------------------------------------------------

function BuildingsList({ busy, build, onPick }: { busy: boolean; build: (id: BuildingId) => void; onPick: (id: BuildingId) => void }) {
  return (
    <section className="fv-pn fv-blist" aria-label="Buildings">
      <div className="fv-ph">
        <h2>Buildings</h2>
        <span className="fv-cnt">{BUILDING_IDS.length}</span>
        <span className="fv-sp" />
        <span className="fv-mut">next level</span>
      </div>
      <ul className="fv-bt">
        {BUILDING_IDS.map((b) => (
          <BuildingRow key={b} id={b} busy={busy} build={build} onPick={onPick} />
        ))}
      </ul>
    </section>
  );
}

// ---- The page ---------------------------------------------------------------------------------------------------------

export function FrameVillage({
  active,
  notices,
  levelOverride,
}: {
  active: boolean;
  /** Abandoned / hearth notices and the design preview bar: shown in a slim line above the picture. */
  notices: ReactNode;
  levelOverride: Parameters<typeof VillageScene>[0]['levelOverride'];
}) {
  const { village, firstSteps, building, openBuilding } = useGame();
  const { busy, build } = useBuild();
  // Escape on a building's page goes back to the Village page.
  useEffect(() => {
    if (!active || !building) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) openBuilding(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, building, openBuilding]);
  const steps = firstStepsVisible(firstSteps);
  return (
    <div className="fv" hidden={!active}>
      {building ? (
        <BuildingPage id={building} busy={busy} build={build} />
      ) : (
        <LeftColumn onPick={openBuilding} />
      )}
      <div className="fv-main" hidden={!!building}>
        <div className="fv-centre">
          <div className="fv-notes">{notices}</div>
          <section className="fv-pic" aria-label={`${village.name}, village`}>
            <h1 className="visually-hidden">{village.name}</h1>
            <VillageScene mode="fit" selected={null} onSelect={openBuilding} levelOverride={levelOverride} />
            <span className="fv-pcap">
              <Icon name="village" size={16} />
              Click a building to open its page
            </span>
          </section>
          <TroopsPanel />
          <div className="fv-bottom">
            {steps ? (
              <>
                <FirstStepsPanel onShowBuilding={openBuilding} />
                <RenownPanel active={active} />
              </>
            ) : (
              <StandingPanel active={active} />
            )}
          </div>
        </div>
        <BuildingsList busy={busy} build={build} onPick={openBuilding} />
      </div>
    </div>
  );
}
