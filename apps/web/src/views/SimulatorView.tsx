// Battle simulator page (account menu, #simulator): try a fight before sending. Client only: it runs the real engine battle at bad,
// even and good luck on the numbers typed here. No server call, no village changes. See apps/web/src/simulator.ts.

import { useEffect, useMemo, useState } from 'react';
import { BATTLE_LUCK, BUILDINGS, RANK_MAX, UNITS, UNIT_IDS, siegeEnabled } from '@clanfire/engine';
import type { BuildingId, UnitId, Units } from '@clanfire/engine';
import { UnitFigure } from '../art/UnitFigure.tsx';
import { SiegePicker } from '../components/Siege.tsx';
import { TroopGroupBar } from '../components/TroopGroups.tsx';
import { useTroopGroups } from '../hooks/useTroopGroups.ts';
import { formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { SIM_LUCKS, WALL_MAX, hasTroops, luckText, parseLevel, simulateAll, textFromUnits, unitsFromText } from '../simulator.ts';
import type { SimOutcome, SimSetup } from '../simulator.ts';
import { builtinGroups } from '../troopGroups.ts';
import { siegeHitText, unitColumns } from '../villages.ts';
import './simulator.css';

type Text = Partial<Record<UnitId, string>>;

/** The draft nonce already applied, so coming back to the page does not refill it. */
let consumedDraft = 0;

const round = (n: number): string => formatInt(Math.round(n));

function CountList({ idPrefix, label, text, onChange, home }: { idPrefix: string; label: string; text: Text; onChange: (u: UnitId, value: string) => void; home?: Units }) {
  return (
    <div className="sim-units" role="group" aria-label={label}>
      {unitColumns(UNIT_IDS).map((col) =>
        col.units.map((u) => (
          <div key={u} className="sim-unit">
            <label htmlFor={`${idPrefix}-${u}`}>
              <UnitFigure unit={u} pose="icon" size={32} className="inline-icon" />
              <span className="sim-unit-name">
                {UNITS[u].name}
                {home && <span className="muted small">{formatInt(home[u])} at home</span>}
              </span>
            </label>
            <input
              id={`${idPrefix}-${u}`}
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="0"
              value={text[u] ?? ''}
              onChange={(e) => onChange(u, e.target.value)}
            />
          </div>
        )),
      )}
    </div>
  );
}

function RankSelect({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="sim-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: RANK_MAX + 1 }, (_, i) => (
          <option key={i} value={i}>
            {i === 0 ? 'None' : `Rank ${i} (+${i * 5}%)`}
          </option>
        ))}
      </select>
    </div>
  );
}

function SideRows({ title, sent, lost, left }: { title: string; sent: Units; lost: Units; left: Units }) {
  const rows = UNIT_IDS.filter((u) => sent[u] > 0);
  if (rows.length === 0) return null;
  return (
    <section className="sim-side" aria-label={title}>
      <h4 className="sim-side-title">{title}</h4>
      <table className="table sim-table">
        <thead>
          <tr>
            <th scope="col">Unit</th>
            <th scope="col" className="num">Lost</th>
            <th scope="col" className="num">Left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u}>
              <th scope="row">
                <UnitFigure unit={u} pose="icon" size={22} className="inline-icon" /> {UNITS[u].name}
              </th>
              <td className="num">{lost[u] > 0 ? `−${formatInt(lost[u])}` : '0'}</td>
              <td className="num">{formatInt(left[u])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OutcomeColumn({ label, o, setup }: { label: string; o: SimOutcome; setup: SimSetup }) {
  const r = o.result;
  const supportSent = setup.support;
  const siege = r.siege ?? [];
  const wallShown = o.wallBefore > 0 || o.wallAfter !== o.wallBefore;
  return (
    <section className={`sim-col ${r.attackerWon ? 'is-win' : 'is-loss'}`} aria-label={`${label} ${luckText(o.luck)}`}>
      <h3 className="sim-col-title">
        {label} <span className="sim-luck">{luckText(o.luck)}</span>
      </h3>
      <p className="sim-winner">{r.attackerWon ? 'Your army wins' : 'The defender holds'}</p>
      <dl className="facts sim-facts">
        <div>
          <dt>Attack power</dt>
          <dd>{round(r.attackPower)}</dd>
        </div>
        <div>
          <dt>Defence power</dt>
          <dd>{round(r.defensePower)}</dd>
        </div>
        {wallShown && (
          <div>
            <dt>Wall</dt>
            <dd>
              {o.wallBefore} → {o.wallAfter}
              {o.wallAfter !== o.wallBefore && <span className="muted small"> (rams)</span>}
            </dd>
          </div>
        )}
        <div>
          <dt>Survivors carry</dt>
          <dd>{formatInt(o.carry)}</dd>
        </div>
      </dl>
      <SideRows title="Your army" sent={setup.attacker} lost={r.attackerLosses} left={o.attackerSurvivors} />
      <SideRows title="Defender" sent={r.defenderUnits} lost={r.defenderLosses} left={o.defenderSurvivors} />
      <SideRows title="Support in the village" sent={supportSent} lost={r.supportLosses[0] ?? r.defenderLosses} left={o.supportSurvivors} />
      {siege.length > 0 && (
        <section className="sim-side" aria-label="Siege">
          <h4 className="sim-side-title">Siege</h4>
          <ul className="sim-siege">
            {siege.map((h, i) => (
              <li key={`${h.unit}-${h.building}-${i}`} className={h.from === h.to ? 'muted' : undefined}>
                {siegeHitText(h)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

export function SimulatorView() {
  const { live, village, simDraft, settings } = useGame();
  const [mine, setMine] = useState<Text>({});
  const [theirs, setTheirs] = useState<Text>({});
  const [support, setSupport] = useState<Text>({});
  const [supportOpen, setSupportOpen] = useState(false);
  const [wallText, setWallText] = useState('');
  const [useRanks, setUseRanks] = useState(false);
  const [bulwarkOpen, setBulwarkOpen] = useState(false);
  const [bulwark, setBulwark] = useState(0);
  const [supportBulwark, setSupportBulwark] = useState(0);
  const [siegePick, setSiegePick] = useState('');
  const [targetText, setTargetText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const groups = useTroopGroups();

  // A draft from the send form or a report fills the fields once (a draft already applied is not applied again on a remount).
  useEffect(() => {
    if (!simDraft || simDraft.nonce === consumedDraft) return;
    consumedDraft = simDraft.nonce;
    setMine(textFromUnits(simDraft.attacker ?? {}));
    setTheirs(textFromUnits(simDraft.defender ?? {}));
    setSupport(textFromUnits(simDraft.support ?? {}));
    setSupportOpen(hasTroops(simDraft.support ?? {}));
    setWallText(simDraft.wall !== undefined ? String(Math.max(0, Math.min(WALL_MAX, Math.floor(simDraft.wall)))) : '');
    setNote(null);
  }, [simDraft]);

  const attacker = useMemo(() => unitsFromText(mine), [mine]);
  const defender = useMemo(() => unitsFromText(theirs), [theirs]);
  const supportUnits = useMemo(() => unitsFromText(support), [support]);
  const siegeOn = siegeEnabled(settings);
  const hasSling = attacker.boulder > 0;
  const target = (BUILDINGS as Record<string, unknown>)[siegePick] ? (siegePick as BuildingId) : null;

  const setup: SimSetup = {
    attacker,
    defender,
    support: supportOpen ? supportUnits : unitsFromText({}),
    wall: parseLevel(wallText, WALL_MAX),
    attackerRanks: useRanks ? live.ranks : undefined,
    defenderBulwark: bulwarkOpen ? bulwark : 0,
    supportBulwark: bulwarkOpen ? supportBulwark : 0,
    siegeTarget: hasSling ? target : null,
    targetLevel: parseLevel(targetText, target ? BUILDINGS[target].maxLevel : 0),
  };
  const outcomes = useMemo(
    () => simulateAll(setup, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attacker, defender, supportUnits, supportOpen, wallText, useRanks, live.ranks, bulwarkOpen, bulwark, supportBulwark, hasSling, siegePick, targetText, settings],
  );

  const ready = hasTroops(attacker);
  const even = outcomes[1] as SimOutcome;
  const lead = UNIT_IDS.filter((u) => attacker[u] > 0).sort((a, b) => attacker[b] * UNITS[b].attack - attacker[a] * UNITS[a].attack)[0];
  const builtins = builtinGroups({ visible: UNIT_IDS, home: live.troops, mission: 'attack', relief: false, target: null });

  const setCount = (set: (fn: (t: Text) => Text) => void) => (u: UnitId, value: string) => set((t) => ({ ...t, [u]: value }));

  function fillHome() {
    const home: Text = {};
    for (const u of UNIT_IDS) if (live.troops[u] > 0) home[u] = String(live.troops[u]);
    setMine(home);
    setNote(Object.keys(home).length === 0 ? 'No troops at home.' : null);
  }

  return (
    <div className="page sim-page">
      <header className="sim-head">
        <div>
          <div className="title-row">
            <h1 className="page-title">Battle simulator</h1>
            <details className="help-pop">
              <summary aria-label="How the simulator works">?</summary>
              <p className="small">Same battle rule as the real thing. Nothing is sent.</p>
            </details>
          </div>
        </div>
        {ready && lead && <UnitFigure unit={lead} pose={even.result.attackerWon ? 'victory' : 'defeated'} size={72} className="sim-hero" />}
      </header>

      <div className="sim-grid">
        <section className="card sim-card" aria-labelledby="sim-mine-title">
          <h2 id="sim-mine-title" className="card-title">Your army</h2>
          <div className="sim-tools">
            <button type="button" className="btn btn-small" onClick={fillHome}>
              From home
            </button>
            <button type="button" className="btn btn-small" onClick={() => setMine({})} disabled={!ready}>
              Clear
            </button>
            <label className="sim-switch">
              <input type="checkbox" role="switch" checked={useRanks} onChange={(e) => setUseRanks(e.target.checked)} />
              <span>Use my ranks (Might)</span>
            </label>
          </div>
          <TroopGroupBar
            builtins={builtins}
            store={groups}
            chosen={Object.fromEntries(UNIT_IDS.filter((u) => attacker[u] > 0).map((u) => [u, attacker[u]]))}
            total={UNIT_IDS.reduce((n, u) => n + attacker[u], 0)}
            onApply={(units) => {
              setMine(textFromUnits(units));
              setNote(null);
            }}
          />
          {note && <p className="muted" role="status">{note}</p>}
          <CountList idPrefix="sim-a" label="Your troops" text={mine} onChange={setCount(setMine)} home={live.troops} />
          {siegeOn && hasSling && (
            <div className="sim-siege-pick">
              <SiegePicker value={siegePick} onChange={setSiegePick} />
              {target && target !== 'wall' && (
                <div className="sim-field">
                  <label htmlFor="sim-target-level">{BUILDINGS[target].name} level</label>
                  <input
                    id="sim-target-level"
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={BUILDINGS[target].maxLevel}
                    placeholder="0"
                    value={targetText}
                    onChange={(e) => setTargetText(e.target.value)}
                  />
                </div>
              )}
              {!target && <p className="muted small">Pick a building and level.</p>}
            </div>
          )}
        </section>

        <section className="card sim-card" aria-labelledby="sim-def-title">
          <h2 id="sim-def-title" className="card-title">Defender</h2>
          <div className="sim-tools">
            <div className="sim-field sim-wall">
              <label htmlFor="sim-wall">Wall level (0–{WALL_MAX})</label>
              <input
                id="sim-wall"
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={WALL_MAX}
                step={1}
                placeholder="0"
                value={wallText}
                onChange={(e) => setWallText(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-small" onClick={() => setTheirs({})} disabled={!hasTroops(defender)}>
              Clear
            </button>
          </div>
          <CountList idPrefix="sim-d" label="Defending troops" text={theirs} onChange={setCount(setTheirs)} />
          <details className="sim-more" open={bulwarkOpen} onToggle={(e) => setBulwarkOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Bulwark ranks of the defender (off)</summary>
            <RankSelect id="sim-bulwark" label="Village's own troops" value={bulwark} onChange={setBulwark} />
            {supportOpen && <RankSelect id="sim-sbulwark" label="Support troops" value={supportBulwark} onChange={setSupportBulwark} />}
          </details>
          <details className="sim-more" open={supportOpen} onToggle={(e) => setSupportOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Support in the village</summary>
            <CountList idPrefix="sim-s" label="Support troops" text={support} onChange={setCount(setSupport)} />
          </details>
        </section>
      </div>

      <section className="card sim-result" aria-labelledby="sim-result-title" aria-live="polite">
        <div className="title-row">
          <h2 id="sim-result-title" className="card-title">Result</h2>
          <details className="help-pop">
            <summary aria-label="About luck">?</summary>
            <p className="small">
              Luck is random in the real fight, from −{Math.round(BATTLE_LUCK * 100)}% to +{Math.round(BATTLE_LUCK * 100)}%. The defender may differ.
            </p>
          </details>
        </div>
        {!ready ? (
          <p className="muted">Add troops to your army.</p>
        ) : (
          <div className="sim-cols">
            {SIM_LUCKS.map((l, i) => (
              <OutcomeColumn key={l.id} label={l.label} o={outcomes[i] as SimOutcome} setup={setup} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
