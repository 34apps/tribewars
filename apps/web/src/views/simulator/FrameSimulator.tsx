// The desktop Battle simulator in the fixed 1440 x 900 frame (owner pick "A · three columns", design/proposals/ingame-pages/sim-a-1440.png):
// Your army | Defender | Result with a LUCK SLIDER (the engine's real range, -BATTLE_LUCK..+BATTLE_LUCK, any value runs the real battle).
// Same logic as the phone's SimulatorView (engine battle, ranks, morale, groups, prefill from reports and the send form); nothing is
// sent and no village changes. Phones keep SimulatorView.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILDINGS, RANK_BONUS, RANK_MAX, UNITS, UNIT_IDS, WALL_BONUS_PER_LEVEL, emptyUnits, siegeEnabled, worldRules } from '@clanfire/engine';
import type { BuildingId, UnitId, Units } from '@clanfire/engine';
import { Icon } from '../../art/Icon.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { SiegePicker } from '../../components/Siege.tsx';
import { TroopGroupBar } from '../../components/TroopGroups.tsx';
import { useUnitInfo } from '../../components/UnitInfo.tsx';
import { formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { useTroopGroups } from '../../hooks/useTroopGroups.ts';
import {
  LUCK_PCT_MAX,
  WALL_MAX,
  comeHome,
  hasTroops,
  luckFromPercent,
  luckText,
  mightText,
  parseLevel,
  setPendingSend,
  simulate,
  textFromUnits,
  unitsFromText,
} from '../../simulator.ts';
import type { SimOutcome, SimSetup } from '../../simulator.ts';
import { builtinGroups } from '../../troopGroups.ts';
import { MORALE_HELP, siegeHitText, unitColumns } from '../../villages.ts';
import { Chev } from '../village/FrameParts.tsx';
import '../../frame-simulator.css';

type Text = Partial<Record<UnitId, string>>;

/** The draft nonce already applied, so coming back to the page does not refill it. */
let consumedDraft = 0;

const round = (n: number): string => formatInt(Math.round(n));
const LUCK_TICKS = [-LUCK_PCT_MAX, -LUCK_PCT_MAX / 2, 0, LUCK_PCT_MAX / 2, LUCK_PCT_MAX];

function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="fsm-sw">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

function RankSelect({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <select className="fsm-sel" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: RANK_MAX + 1 }, (_, i) => (
        <option key={i} value={i}>
          {i === 0 ? 'None' : `Rank ${i} (+${Math.round(i * RANK_BONUS * 100)}%)`}
        </option>
      ))}
    </select>
  );
}

interface Row {
  unit: UnitId;
  a: number;
  lost: number;
  left: number;
  support?: boolean;
}

export function FrameSimulator() {
  const { live, simDraft, settings, navigate } = useGame();
  const info = useUnitInfo();
  const groups = useTroopGroups();
  const [mine, setMine] = useState<Text>({});
  const [theirs, setTheirs] = useState<Text>({});
  const [support, setSupport] = useState<Text>({});
  const [wallText, setWallText] = useState('');
  const [useRanks, setUseRanks] = useState(false);
  const [morale, setMorale] = useState(false);
  const [bulwark, setBulwark] = useState(0);
  const [supportBulwark, setSupportBulwark] = useState(0);
  const [siegePick, setSiegePick] = useState('');
  const [targetText, setTargetText] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [luckPct, setLuckPct] = useState(0);

  // A draft from the send form or a report fills the fields once (a draft already applied is not applied again on a remount).
  useEffect(() => {
    if (!simDraft || simDraft.nonce === consumedDraft) return;
    consumedDraft = simDraft.nonce;
    setMine(textFromUnits(simDraft.attacker ?? {}));
    setTheirs(textFromUnits(simDraft.defender ?? {}));
    setSupport(textFromUnits(simDraft.support ?? {}));
    setWallText(simDraft.wall !== undefined ? String(Math.max(0, Math.min(WALL_MAX, Math.floor(simDraft.wall)))) : '');
    setMorale(simDraft.morale === true);
    setSource(simDraft.source ?? null);
    setNote(null);
  }, [simDraft]);

  const attacker = useMemo(() => unitsFromText(mine), [mine]);
  const defender = useMemo(() => unitsFromText(theirs), [theirs]);
  const supportUnits = useMemo(() => unitsFromText(support), [support]);
  const siegeOn = siegeEnabled(settings);
  const moraleOn = worldRules(settings).features.morale;
  const hasSling = attacker.boulder > 0;
  const target = (BUILDINGS as Record<string, unknown>)[siegePick] ? (siegePick as BuildingId) : null;
  const wall = parseLevel(wallText, WALL_MAX);
  const units = UNIT_IDS.filter((u) => siegeOn || !UNITS[u].siege);

  const setup: SimSetup = {
    attacker,
    defender,
    support: supportUnits,
    wall,
    attackerRanks: useRanks ? live.ranks : undefined,
    morale: morale && moraleOn,
    defenderBulwark: bulwark,
    supportBulwark: supportBulwark,
    siegeTarget: hasSling ? target : null,
    targetLevel: parseLevel(targetText, target ? BUILDINGS[target].maxLevel : 0),
  };
  const ready = hasTroops(attacker);
  const luck = luckFromPercent(luckPct);
  const outcome: SimOutcome = useMemo(
    () => simulate(setup, luck, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attacker, defender, supportUnits, wall, useRanks, morale, moraleOn, live.ranks, bulwark, supportBulwark, hasSling, siegePick, targetText, luck, settings],
  );
  const even: SimOutcome = useMemo(
    () => simulate(setup, 0, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attacker, defender, supportUnits, wall, useRanks, morale, moraleOn, live.ranks, bulwark, supportBulwark, hasSling, siegePick, targetText, settings],
  );

  const builtins = builtinGroups({ visible: units, home: live.troops, mission: 'attack', relief: false, target: null });
  const totalSent = units.reduce((n, u) => n + attacker[u], 0);
  const might = useRanks ? mightText(live.ranks, attacker) : null;
  const setCount = (set: (fn: (t: Text) => Text) => void) => (u: UnitId, value: string) => set((t) => ({ ...t, [u]: value }));

  function fillHome() {
    const home: Text = {};
    for (const u of units) if (live.troops[u] > 0) home[u] = String(live.troops[u]);
    setMine(home);
    setNote(Object.keys(home).length === 0 ? 'No troops at home.' : null);
  }

  function sendThisArmy() {
    if (!ready) return;
    setPendingSend(attacker);
    navigate('army');
  }

  const unitLabel = (u: UnitId, size: number, name = true) => (
    <button type="button" className="fsm-ul" onClick={() => info.open(u)} aria-haspopup="dialog" aria-label={name ? undefined : `About the ${UNITS[u].name}`} {...info.bind(u)}>
      <UnitFigure unit={u} pose="icon" size={size} />
      {name && <span>{UNITS[u].name}</span>}
    </button>
  );

  // ---- Result numbers ----
  const r = outcome.result;
  const supportLost = r.supportLosses[0] ?? emptyUnits();
  const mineRows: Row[] = units.filter((u) => attacker[u] > 0).map((u) => ({ unit: u, a: attacker[u], lost: r.attackerLosses[u], left: outcome.attackerSurvivors[u] }));
  const defRows: Row[] = units.filter((u) => r.defenderUnits[u] > 0).map((u) => ({ unit: u, a: r.defenderUnits[u], lost: r.defenderLosses[u], left: outcome.defenderSurvivors[u] }));
  const supRows: Row[] = units.filter((u) => supportUnits[u] > 0).map((u) => ({ unit: u, a: supportUnits[u], lost: supportLost[u], left: outcome.supportSurvivors[u], support: true }));
  const siege = r.siege ?? [];
  // Too many rows for the table: one row per unit, the defender's village and support together (at most nine rows).
  const merged = mineRows.length + defRows.length + supRows.length > 12;
  const mergedRows = merged
    ? units
        .map((u) => {
          const m = mineRows.find((x) => x.unit === u);
          const d = [...defRows, ...supRows].filter((x) => x.unit === u);
          return { unit: u, m, d: d.length ? { a: d.reduce((n, x) => n + x.a, 0), lost: d.reduce((n, x) => n + x.lost, 0), left: d.reduce((n, x) => n + x.left, 0) } : undefined };
        })
        .filter((x) => x.m || x.d)
    : [];
  // The result table gets a fixed height budget (the panel never scrolls); every row shrinks to fit it, 33 px down to 16 px.
  const bodyRows = merged ? mergedRows.length : mineRows.length + defRows.length + supRows.length;
  const headRows = merged ? 2 : [mineRows, defRows, supRows].filter((l) => l.length > 0).length;
  const budget = (merged ? 260 : 272) - (siege.length > 0 ? 20 * siege.length + 10 : 0) - 24 * headRows;
  const rowH = bodyRows === 0 ? 33 : Math.max(16, Math.min(33, Math.floor(budget / bodyRows)));
  const iconSize = Math.max(16, Math.min(24, rowH - 3));
  const home = comeHome(attacker, outcome.attackerSurvivors);
  const home0 = comeHome(attacker, even.attackerSurvivors);
  const wallShown = outcome.wallBefore > 0 || outcome.wallAfter !== outcome.wallBefore;

  const table = (title: string, cols: [string, string, string], rows: Row[]) =>
    rows.length === 0 ? null : (
      <>
        <tr className="fsm-gh">
          <th scope="colgroup">{title}</th>
          <th scope="col">{cols[0]}</th>
          <th scope="col">{cols[1]}</th>
          <th scope="col">{cols[2]}</th>
        </tr>
        {rows.map((x) => (
          <tr key={`${x.support ? 's' : 'm'}-${x.unit}`} className={x.support ? 'is-sup' : undefined}>
            <th scope="row">{unitLabel(x.unit, iconSize)}</th>
            <td>{formatInt(x.a)}</td>
            <td className={x.lost > 0 ? 'is-loss' : 'is-zero'}>{x.lost > 0 ? `−${formatInt(x.lost)}` : '0'}</td>
            <td>
              <b>{formatInt(x.left)}</b>
            </td>
          </tr>
        ))}
      </>
    );

  return (
    <div className="fsm">
      {info.dialog}
      <header className="fsm-head">
        <span className="fsm-tk">
          <Icon name="army" size={26} />
        </span>
        <h1>Battle simulator</h1>
        <span className="fsm-sub">Try a fight before you send it. Same rule as the real battle.</span>
        <span className="fsm-sp" />
        <button type="button" className="fv-lk" onClick={() => navigate('reports')}>
          <Icon name="reports" size={18} />
          Fill from a report <Chev />
        </button>
        <button type="button" className="fv-btn" onClick={sendThisArmy} disabled={!ready} title={ready ? undefined : 'Add troops to your army first'}>
          <Icon name="army" size={18} />
          Send this army
        </button>
      </header>

      <div className="fsm-cols">
        {/* ---- Your army ---- */}
        <section className="fv-pn fsm-pn" aria-labelledby="fsm-mine">
          <div className="fv-ph">
            <h2 id="fsm-mine">Your army</h2>
            <span className="fv-cnt fsm-n">{formatInt(totalSent)} units</span>
            <span className="fv-sp" />
            <button type="button" className="fv-btn" onClick={fillHome}>
              From home
            </button>
            <button type="button" className="fv-btn" onClick={() => setMine({})} disabled={!ready}>
              Clear
            </button>
          </div>
          <div className="fsm-groups">
            <span className="fv-up">Group</span>
            <TroopGroupBar
              builtins={builtins}
              store={groups}
              chosen={Object.fromEntries(units.filter((u) => attacker[u] > 0).map((u) => [u, attacker[u]]))}
              total={totalSent}
              onApply={(g) => {
                setMine(textFromUnits(g));
                setNote(null);
              }}
            />
          </div>
          {note && (
            <p className="fv-mut fsm-note" role="status">
              {note}
            </p>
          )}
          <ul className="fsm-rows" aria-label="Your troops">
            {units.map((u) => (
              <li key={u} className={attacker[u] > 0 ? 'is-on' : undefined}>
                {unitLabel(u, 34, false)}
                <span className="fsm-un">
                  <button type="button" className="fsm-nm" onClick={() => info.open(u)} aria-haspopup="dialog" {...info.bind(u)}>
                    {UNITS[u].name}
                  </button>
                  <small>{live.troops[u] > 0 ? `${formatInt(live.troops[u])} at home` : 'none at home'}</small>
                </span>
                <input
                  className={`fsm-in${attacker[u] > 0 ? ' is-on' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  aria-label={`${UNITS[u].name} in your army`}
                  value={mine[u] ?? ''}
                  onChange={(e) => setCount(setMine)(u, e.target.value)}
                />
              </li>
            ))}
          </ul>
          {siegeOn && hasSling && (
            <div className="fsm-siege">
              <SiegePicker value={siegePick} onChange={setSiegePick} />
              {target && target !== 'wall' && (
                <input
                  className="fsm-in"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={BUILDINGS[target].maxLevel}
                  placeholder="0"
                  aria-label={`${BUILDINGS[target].name} level`}
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                />
              )}
            </div>
          )}
          <div className="fsm-opt">
            <Switch checked={useRanks} onChange={setUseRanks}>
              Use my ranks
            </Switch>
            {might && <span className="fv-tag fv-tag-tl">{might}</span>}
            {useRanks && !might && <span className="fv-mut">no Might ranks for these units</span>}
          </div>
          {moraleOn && (
            <div className="fsm-opt is-b">
              <Switch checked={morale} onChange={setMorale}>
                Morale 75%
              </Switch>
              <span className="fv-mut" title={MORALE_HELP}>
                target under a third of your points
              </span>
            </div>
          )}
        </section>

        {/* ---- Defender ---- */}
        <section className="fv-pn fsm-pn" aria-labelledby="fsm-def">
          <div className="fv-ph">
            <h2 id="fsm-def">Defender</h2>
            {source && <span className="fsm-from">{source}</span>}
            <span className="fv-sp" />
            <button
              type="button"
              className="fv-btn"
              onClick={() => {
                setTheirs({});
                setSupport({});
                setSource(null);
              }}
              disabled={!hasTroops(defender) && !hasTroops(supportUnits)}
            >
              Clear
            </button>
          </div>
          <div className="fsm-wall">
            <Icon name="shield" size={26} />
            <span className="fsm-wt">
              <b>Wall level</b>
              <small>
                +{Math.round(wall * WALL_BONUS_PER_LEVEL * 100)}% defence · 0 to {WALL_MAX}
              </small>
            </span>
            <span className="fsm-step">
              <button type="button" className="fv-btn" aria-label="Lower the Wall level" onClick={() => setWallText(String(Math.max(0, wall - 1)))} disabled={wall <= 0}>
                −
              </button>
              <input
                className="fsm-wi"
                type="number"
                inputMode="numeric"
                min={0}
                max={WALL_MAX}
                step={1}
                placeholder="0"
                aria-label="Wall level"
                value={wallText}
                onChange={(e) => setWallText(e.target.value)}
              />
              <button type="button" className="fv-btn" aria-label="Raise the Wall level" onClick={() => setWallText(String(Math.min(WALL_MAX, wall + 1)))} disabled={wall >= WALL_MAX}>
                +
              </button>
            </span>
          </div>
          <div className="fsm-dh" aria-hidden="true">
            <span>Unit</span>
            <span>In village</span>
            <span>Support</span>
          </div>
          <ul className="fsm-rows is-def" aria-label="Defending troops">
            {units.map((u) => (
              <li key={u}>
                {unitLabel(u, 30)}
                <input
                  className={`fsm-in${defender[u] > 0 ? ' is-on' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  aria-label={`${UNITS[u].name} in the village`}
                  value={theirs[u] ?? ''}
                  onChange={(e) => setCount(setTheirs)(u, e.target.value)}
                />
                <input
                  className={`fsm-in is-sup${supportUnits[u] > 0 ? ' is-on' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  aria-label={`${UNITS[u].name} support`}
                  value={support[u] ?? ''}
                  onChange={(e) => setCount(setSupport)(u, e.target.value)}
                />
              </li>
            ))}
          </ul>
          <div className="fsm-bw">
            <span className="fsm-wt">
              <b>Bulwark rank</b>
              <small>village · support</small>
            </span>
            <RankSelect label="Bulwark rank of the village's own troops" value={bulwark} onChange={setBulwark} />
            <RankSelect label="Bulwark rank of the support troops" value={supportBulwark} onChange={setSupportBulwark} />
          </div>
        </section>

        {/* ---- Result ---- */}
        <section className="fv-pn fsm-pn fsm-res" style={{ ['--fsm-row' as string]: `${rowH}px` }} aria-labelledby="fsm-result" aria-live="polite">
          <div className="fv-ph">
            <h2 id="fsm-result">Result</h2>
            <span className="fv-sp" />
            <span className="fv-mut">real battle rule · nothing is sent</span>
          </div>
          <div className="fsm-rb">
            <div className="fsm-luck">
              <div className="fsm-lh">
                <span className="fsm-wt">
                  <b>Luck</b>
                  <small>
                    Random in a real fight, from {luckText(-LUCK_PCT_MAX / 100)} to {luckText(LUCK_PCT_MAX / 100)}.
                  </small>
                </span>
                <output className="fsm-lv" htmlFor="fsm-luck">
                  {luckText(luck)}
                </output>
              </div>
              <input
                id="fsm-luck"
                className="fsm-range"
                type="range"
                min={-LUCK_PCT_MAX}
                max={LUCK_PCT_MAX}
                step={1}
                value={luckPct}
                aria-label="Luck"
                aria-valuetext={luckText(luck)}
                onChange={(e) => setLuckPct(Number(e.target.value))}
              />
              <div className="fsm-ticks" aria-hidden="true">
                {LUCK_TICKS.map((t) => (
                  <button type="button" key={t} tabIndex={-1} className={t === luckPct ? 'is-on' : undefined} onClick={() => setLuckPct(t)}>
                    {luckText(t / 100)}
                  </button>
                ))}
              </div>
            </div>

            {!ready ? (
              <div className="fsm-empty">
                <UnitFigure unit="raider" size={72} />
                <b>Add troops to your army</b>
                <span className="fv-mut">Type numbers on the left, or press From home. The result appears here.</span>
              </div>
            ) : (
              <>
                <div className={`fsm-vd ${r.attackerWon ? 'is-win' : 'is-lose'}`}>
                  <Icon name={r.attackerWon ? 'flame' : 'warning'} size={32} />
                  <span className="fsm-vt">
                    <b>{r.attackerWon ? 'Your army wins' : 'The defender holds'}</b>
                    <small>
                      {home.home === 0 ? `none of your ${formatInt(home.sent)} come home` : `${formatInt(home.home)} of ${formatInt(home.sent)} come home`} · luck {luckText(luck)}
                    </small>
                  </span>
                  <span className="fsm-vp">
                    <span>
                      <Icon name="army" size={18} />
                      Attack <b>{round(r.attackPower)}</b>
                    </span>
                    <span>
                      <Icon name="shield" size={18} />
                      Defence <b>{round(r.defensePower)}</b>
                    </span>
                  </span>
                </div>
                {merged ? (
                  <table className="fsm-lt is-merged">
                    <tbody>
                      <tr className="fsm-gh">
                        <th scope="col" />
                        <th scope="colgroup" colSpan={3} className="fsm-gc">
                          Your army
                        </th>
                        <th scope="colgroup" colSpan={3} className="fsm-gc">
                          Defender + support
                        </th>
                      </tr>
                      <tr className="fsm-gh">
                        <th scope="col">Unit</th>
                        {['Sent', 'Lost', 'Left', 'In', 'Lost', 'Left'].map((c, i) => (
                          <th key={i} scope="col">
                            {c}
                          </th>
                        ))}
                      </tr>
                      {mergedRows.map((x) => (
                        <tr key={x.unit}>
                          <th scope="row">{unitLabel(x.unit, iconSize)}</th>
                          {([x.m, x.d] as const).flatMap((c, side) => [
                            <td key={`${side}a`}>{c ? formatInt(c.a ?? 0) : ''}</td>,
                            <td key={`${side}l`} className={c && c.lost > 0 ? 'is-loss' : 'is-zero'}>
                              {c ? (c.lost > 0 ? `−${formatInt(c.lost)}` : '0') : ''}
                            </td>,
                            <td key={`${side}r`}>{c ? <b>{formatInt(c.left)}</b> : ''}</td>,
                          ])}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="fsm-lt">
                    <tbody>
                      {table('Your army', ['Sent', 'Lost', 'Left'], mineRows)}
                      {table('Defender', ['In', 'Lost', 'Left'], defRows)}
                      {table('Support', ['In', 'Lost', 'Left'], supRows)}
                    </tbody>
                  </table>
                )}
                {siege.length > 0 && (
                  <ul className="fsm-siegeres" aria-label="Siege">
                    {siege.map((h, i) => (
                      <li key={`${h.unit}-${h.building}-${i}`} className={h.from === h.to ? 'is-zero' : undefined}>
                        {siegeHitText(h)}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="fsm-fx">
                  <div>
                    <span className="fv-up">Wall after</span>
                    <b>{wallShown ? `${outcome.wallBefore} → ${outcome.wallAfter}` : '–'}</b>
                    <small>{outcome.wallAfter !== outcome.wallBefore ? 'knocked down by rams' : wallShown ? 'no change' : 'no Wall'}</small>
                  </div>
                  <div>
                    <span className="fv-up">Survivors carry</span>
                    <b>{formatInt(outcome.carry)}</b>
                    <small>at most, as loot</small>
                  </div>
                  <div>
                    <span className="fv-up">At {luckText(0)} luck</span>
                    <b>{formatInt(home0.home)} home</b>
                    <small>carry {formatInt(even.carry)}</small>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
