// The desktop Army page inside the fixed 1440x900 frame (owner-approved mockup mix-army2-1440): the village column on the left (picture,
// build queue, training, per hour), "At home" with every unit figure on top, then "Send troops" (same rules and calls as the Command
// post and the map's send form, Attack and Support only), the Movements panel and the Support panel. Nothing scrolls: a panel shows
// its first rows and a "+N more" link that opens the whole list in a dialog. Phones keep ArmyView.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  UNITS,
  UNIT_IDS,
  checkMission,
  checkSend,
  distance,
  emptyUnits,
  populationCap,
  populationUsage,
  totalUnits,
  travelPreview,
} from '@clanfire/engine';
import type { Coords, MapVillageDto, MovementDto, StationedDto, UnitId, Units } from '@clanfire/engine';
import { worldPrefixOf } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import type { IconName } from '../../art/Icon.tsx';
import { UnitFigure } from '../../art/UnitFigure.tsx';
import { ChieftainPanel } from '../../components/ChieftainPanel.tsx';
import { useUnitInfo } from '../../components/UnitInfo.tsx';
import { formatAgo, formatCoords, formatDuration, formatInt } from '../../format.ts';
import { useGame, useRules } from '../../game.ts';
import { useTribeWaymarks } from '../../hooks/useWaymarks.ts';
import { MISSION_ICON, MISSION_NAME } from '../../icons.ts';
import { ALLEGIANCE_STYLE, allegianceOf } from '../../map/allegiance.ts';
import { requirementText, unmetRequirements } from '../../rules.ts';
import { useConfirm } from '../../tribe/Confirm.tsx';
import {
  SEND_MODE_SENT,
  isReliefTarget,
  missionsFor,
  moraleLabel,
  moraleNow,
  ownTotalPoints,
  sendMode,
  strikeWarning,
} from '../../villages.ts';
import { RecallSome } from '../ArmyView.tsx';
import { Chev, LeftColumn, clockShort, pluralUnit } from '../village/FrameParts.tsx';
import { MiniVillage } from '../village/FrameBuilding.tsx';
import { lookupWindow, parseCoords, villageAt } from './command-post-logic.ts';
import { addRecent, filterMovements, loadRecent, moveCounts, saveRecent, sortMovements, splitSupportRows, takeRows } from './frame-army-logic.ts';
import type { MoveFilter, RecentKind, RecentTarget } from './frame-army-logic.ts';
import '../../frame-army.css';

/** Rows a panel shows before "+N more" (what fits the 900 px frame). */
const MOVES_SHOWN = 3;
const SUPPORT_SHOWN = 3;
const DEBOUNCE_MS = 300;

// ---- Small shared bits -----------------------------------------------------------------------------------------------

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
      className="confirm fa-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="fa-dh">
        <h2>{title}</h2>
        <button type="button" className="fv-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="fa-db">{children}</div>
    </dialog>
  );
}

/** "8 Pikemen, 4 Raiders" (plural by the unit's own rule). */
function unitsText(units: Partial<Units> | null): string {
  if (!units) return '';
  return UNIT_IDS.filter((u) => (units[u] ?? 0) > 0)
    .map((u) => `${formatInt(units[u] ?? 0)} ${units[u] === 1 ? UNITS[u].name : pluralUnit(u)}`)
    .join(', ');
}

function firstUnit(units: Partial<Units> | null): UnitId | null {
  return units ? (UNIT_IDS.find((u) => (units[u] ?? 0) > 0) ?? null) : null;
}

const where = (v: { name: string; x: number; y: number }) => `${v.name} (${formatCoords(v.x, v.y)})`;

// ---- At home ---------------------------------------------------------------------------------------------------------

function MusterPanel() {
  const { live } = useGame();
  const rules = useRules();
  const info = useUnitInfo();
  const [chief, setChief] = useState(false);
  const training = emptyUnits();
  for (const q of [live.trainQueues.barracks, live.trainQueues.stables, live.trainQueues.bannerhall]) for (const j of q) training[j.unit] += j.count - j.done;
  const inTraining = UNIT_IDS.reduce((n, u) => n + training[u], 0);
  const anyTraining = inTraining > 0;
  const pop = populationUsage(live).total;
  const popCap = populationCap(live);
  const chiefs = live.troops.chieftain ?? 0;
  const units = UNIT_IDS.filter((u) => rules.features.siege || !UNITS[u].siege);
  return (
    <section className="fv-pn fa-muster" aria-label="Troops at home">
      {info.dialog}
      {chief && (
        <Dialog title="Chieftains" onClose={() => setChief(false)}>
          <ChieftainPanel heading={false} />
        </Dialog>
      )}
      <div className="fv-ph">
        <h2>At home</h2>
        <span className="fa-pchip" aria-label={`Population ${formatInt(pop)} of ${formatInt(popCap)}`}>
          <Icon name="pop" size={20} />
          <b>{formatInt(pop)}</b> / {formatInt(popCap)} people
        </span>
        {anyTraining && (
          <>
            <span className="fv-tag fa-tag-warn">+{formatInt(inTraining)}</span>
            <span className="fv-mut">= in training</span>
          </>
        )}
        <span className="fv-sp" />
        <button type="button" className="fa-chs" onClick={() => setChief(true)} aria-haspopup="dialog">
          <UnitFigure unit="chieftain" pose="icon" size={26} />
          {chiefs > 0 ? (
            <span>
              <b>
                {chiefs} {chiefs === 1 ? 'Chieftain' : 'Chieftains'} ready
              </b>{' '}
              · can take an abandoned village
            </span>
          ) : (
            <span>
              <b>Chieftains</b> · train and manage
            </span>
          )}
          <Chev />
        </button>
        <SimulatorLink />
      </div>
      <ul className="fa-mus" style={{ gridTemplateColumns: `repeat(${units.length}, minmax(0, 1fr))` }}>
        {units.map((u) => {
          const home = live.troops[u] ?? 0;
          const away = live.away[u] ?? 0;
          const none = home + away + training[u] === 0;
          const locked = none && unmetRequirements(live.buildings, UNITS[u].requires).length > 0;
          return (
            <li key={u}>
              <button
                type="button"
                className={`fa-mu${none ? ' is-off' : ''}`}
                onClick={() => info.open(u)}
                aria-haspopup="dialog"
                title={locked ? `${UNITS[u].name}: needs ${requirementText(unmetRequirements(live.buildings, UNITS[u].requires))}` : `About the ${UNITS[u].name}`}
              >
                <UnitFigure unit={u} size={76} className="fa-fg" />
                <span className="fa-ct">{locked ? '–' : formatInt(home)}</span>
                <b>{UNITS[u].name}</b>
                <span className="fa-mtg">
                  {u === 'chieftain' && home > 0 && <span className="fv-tag fa-tag-teal">ready</span>}
                  {away > 0 && <span className="fv-tag fa-tag-mut">{formatInt(away)} away</span>}
                  {training[u] > 0 && <span className="fv-tag fa-tag-warn">+{formatInt(training[u])}</span>}
                  {locked && <span className="fv-tag fa-tag-mut">locked</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SimulatorLink() {
  const { openSimulator } = useGame();
  return (
    <button type="button" className="fv-lk fa-sim" onClick={() => openSimulator()}>
      <Icon name="army" size={18} />
      Battle simulator <Chev />
    </button>
  );
}

// ---- Send troops -----------------------------------------------------------------------------------------------------

function recentOf(t: MapVillageDto | null, tile: Coords): RecentTarget {
  const kind: RecentKind = !t ? 'free' : t.kind === 'own' ? 'own' : t.kind === 'abandoned' ? 'abandoned' : 'player';
  return { x: tile.x, y: tile.y, kind, who: kind === 'player' ? (t?.ownerName ?? '') : '' };
}

type Go = 'attack' | 'support';

function SendPanel() {
  const { village, villages, player, live, now, settings, applySend, refresh, toast, viewMovement, navigate, showOnMap, worldEnd, openSimulator } = useGame();
  const rules = useRules();
  const waymarks = useTribeWaymarks();
  const recentKey = `clanfire.recentTargets${worldPrefixOf(window.location.pathname)}`;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<MapVillageDto | null | undefined>(undefined); // undefined = nothing looked up yet; null = free land
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Partial<Record<UnitId, string>>>({});
  const [busy, setBusy] = useState<Go | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTarget[]>(() => loadRecent(recentKey));
  const seq = useRef(0);

  const parsed = parseCoords(text);
  const tile: Coords | null = parsed.ok ? parsed.coords : null;
  const hint = !parsed.ok ? parsed.message : '';

  // Debounced lookup of the tile (the same map query as the Command post). Every change drops the answer of the one before.
  useEffect(() => {
    seq.current += 1;
    const id = seq.current;
    setError(null);
    if (!tile) {
      setPicked(undefined);
      setLookError(null);
      setLooking(false);
      return undefined;
    }
    const at = tile;
    const timer = window.setTimeout(async () => {
      setLooking(true);
      setLookError(null);
      try {
        const w = lookupWindow(at);
        const res = await api.map(w.x, w.y, w.w, w.h);
        if (id !== seq.current) return;
        setPicked(villageAt(res.villages, at));
      } catch (e) {
        if (id !== seq.current) return;
        setPicked(undefined);
        setLookError(errorMessage(e));
      } finally {
        if (id === seq.current) setLooking(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // Only the coordinates matter here.
  }, [tile?.x, tile?.y]);

  const known = picked !== undefined && tile !== null;
  const target = picked ?? null;
  const ctx = { playerId: player.id, currentVillageId: village.id };
  const allowed = known && target ? missionsFor(target, ctx) : [];
  const relief = known && isReliefTarget(target, ctx);
  const isCurrent = target?.kind === 'own' && target.id === village.id;

  const shown = UNIT_IDS.filter((u) => rules.features.siege || !UNITS[u].siege);
  const chosen: Units = emptyUnits();
  for (const u of shown) {
    const n = Number(counts[u] ?? '');
    chosen[u] = Number.isInteger(n) ? Math.max(0, Math.min(live.troops[u] ?? 0, n)) : 0;
  }
  const total = totalUnits(chosen);
  const hasTroops = UNIT_IDS.some((u) => (live.troops[u] ?? 0) > 0);
  const partial: Partial<Units> = {};
  for (const u of UNIT_IDS) if (chosen[u] > 0) partial[u] = chosen[u];

  const preview = tile && total > 0 ? travelPreview(village, tile, chosen, settings, waymarks) : null;
  const travel = preview ? preview.ms : 0;
  const carry = UNIT_IDS.reduce((sum, u) => sum + chosen[u] * UNITS[u].carry, 0);
  const morale = moraleNow({ mission: 'attack', relief, target, chosen: partial, ownPoints: ownTotalPoints(villages), enabled: rules.features.morale });

  /** Why this button cannot be used (null = it can). Same checks as the map's send form. */
  function blocked(mission: Go): string | null {
    if (worldEnd) return 'World ended';
    if (!tile) return 'Enter the target (x|y)';
    if (!known) return looking ? 'Looking…' : 'Looking up the target…';
    if (isCurrent) return 'Your troops leave from here';
    if (!allowed.includes(mission)) {
      if (target && allowed.includes('occupy')) return 'Open it on the map to occupy it';
      if (mission === 'attack') return target ? 'You cannot attack this village' : 'Free land: nothing to attack';
      return target ? 'You cannot support this village' : 'Free land: nothing to support';
    }
    if (mission === 'attack' && !relief && target?.kind === 'player' && target.protected) return 'Protected player';
    if (total < 1) return hasTroops ? 'Pick troops' : 'No troops at home';
    const sendCheck = checkSend(live, partial);
    if (!sendCheck.ok) return sendCheck.message;
    const m = checkMission(mission, chosen);
    if (!m.ok) return m.message;
    if (relief && mission === 'attack' && (chosen.chieftain > 0 || UNIT_IDS.some((u) => UNITS[u].siege && chosen[u] > 0))) return 'A relief attack takes no Chieftains or siege units';
    return null;
  }
  const attackWhy = blocked('attack');
  const supportWhy = blocked('support');

  const mode = sendMode('attack', partial, target?.kind ?? null, relief);
  const breaksProtection = !relief && target?.kind === 'player' && player.protectedUntil > now && total > 0;
  const warning = total > 0 && allowed.includes('attack') ? (mode === 'strike' ? strikeWarning(chosen, target?.kind !== 'player', target?.points ?? 0) : breaksProtection ? 'Attacking ends your protection' : null) : null;
  // One line above the buttons: a server error, else the reason the main button is off, else a warning.
  const why = error ?? (hint || lookError) ?? (attackWhy && supportWhy ? attackWhy : null) ?? warning;
  const whyTone = error || lookError ? 'bad' : warning && !(attackWhy && supportWhy) ? 'warn' : 'mut';

  function setCount(u: UnitId, value: string) {
    setError(null);
    setCounts((c) => ({ ...c, [u]: value }));
  }

  async function go(mission: Go) {
    if (busy || !tile || (mission === 'attack' ? attackWhy : supportWhy)) return;
    setBusy(mission);
    setError(null);
    try {
      const res = await api.send(village.id, { x: tile.x, y: tile.y, units: partial, mission });
      applySend(res);
      setCounts({});
      const list = addRecent(recent, recentOf(target, tile));
      setRecent(list);
      saveRecent(recentKey, list);
      const sendMode_ = mission === 'attack' ? sendMode('attack', partial, target?.kind ?? null, relief) : 'support';
      toast(`${SEND_MODE_SENT[sendMode_]} ${target?.name ?? formatCoords(tile.x, tile.y)}. Arrives in ${formatDuration(res.movement.arriveAt - now)}.`, {
        action: { label: 'View', onClick: () => viewMovement(res.movement.id) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  // Chips: the player's last targets, then my other villages (support between my own villages is the common case) up to five.
  const others = villages.filter((v) => v.id !== village.id);
  const chips: RecentTarget[] = [...recent];
  for (const v of others) if (chips.length < 5 && !chips.some((c) => c.x === v.x && c.y === v.y)) chips.push({ x: v.x, y: v.y, kind: 'own', who: v.name });

  const style = target ? ALLEGIANCE_STYLE[allegianceOf(target)] : null;
  let infoText: string;
  let infoTone = '';
  if (!tile) infoText = hint || 'Type the coordinates of a village, or pick one on the map.';
  else if (lookError) infoText = lookError;
  else if (!known) infoText = 'Looking…';
  else if (!target) infoText = `Free land (${formatCoords(tile.x, tile.y)}). Nothing to send here.`;
  else {
    const dist = isCurrent ? null : distance(village, tile);
    infoText = [
      `${target.kind === 'abandoned' ? 'Abandoned village' : target.name} (${formatCoords(tile.x, tile.y)})`,
      target.kind !== 'abandoned' && target.kind !== 'own' ? `${target.ownerName ?? ''}${target.tribeTag ? ` [${target.tribeTag}]` : ''}` : target.kind === 'own' ? 'Your village' : '',
      `${formatInt(target.kind === 'player' ? (target.ownerPoints ?? target.points) : target.points)} points`,
      style && target.kind === 'player' ? style.words : '',
      dist === null ? 'you are here' : `${dist.toFixed(1)} fields away`,
      target.protected && target.kind === 'player' ? 'beginner protection' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    infoTone = target.kind === 'player' && target.protected ? ' is-warn' : '';
  }

  const lands = preview ? clockShort(now + travel, now) : '–';
  return (
    <section className="fv-pn fa-send" aria-label="Send troops">
      <div className="fv-ph">
        <h2>Send troops</h2>
        <span className="fv-sp" />
        {mode === 'strike' && total > 0 && (
          <button type="button" className="fv-lk" onClick={() => openSimulator()}>
            Simulator <Chev />
          </button>
        )}
        <button
          type="button"
          className="fv-lk"
          onClick={() => {
            setCounts({});
            setError(null);
          }}
          disabled={total === 0}
        >
          Clear
        </button>
      </div>
      <form
        className="fa-sf"
        onSubmit={(e) => {
          e.preventDefault();
          void go(attackWhy ? 'support' : 'attack');
        }}
      >
        <div className="fa-tgt">
          <label className="fv-up" htmlFor="fa-target">
            Target
          </label>
          <input
            id="fa-target"
            className="fa-inp fa-inp-t"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="12|-40"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={24}
            aria-invalid={hint !== ''}
          />
          <button type="button" className="fv-btn sm" onClick={() => (tile ? showOnMap(tile.x, tile.y) : navigate('map'))}>
            Pick on map
          </button>
        </div>
        <div className={`fa-tgi${infoTone}`} title={infoText} aria-live="polite">
          <Icon name={target?.kind === 'player' ? 'army' : 'village'} size={22} />
          <span>{infoText}</span>
        </div>
        <ul className="fa-su" aria-label="Troops to send">
          {shown.map((u) => {
            const home = live.troops[u] ?? 0;
            return (
              <li key={u} className={`fa-sx${home === 0 ? ' is-off' : ''}`}>
                <span className="fv-mt">
                  <label htmlFor={`fa-n-${u}`}>
                    <b>{UNITS[u].name}</b>
                  </label>
                  {home === 0 ? (
                    <small>none at home</small>
                  ) : (
                    <button type="button" className="fa-all" onClick={() => setCount(u, String(home))} aria-label={`Fill all ${formatInt(home)} ${UNITS[u].name}`}>
                      all {formatInt(home)}
                    </button>
                  )}
                </span>
                {home > 0 && (
                  <input
                    id={`fa-n-${u}`}
                    className={`fa-inp${chosen[u] > 0 ? ' is-on' : ''}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={home}
                    step={1}
                    placeholder="0"
                    value={counts[u] ?? ''}
                    onChange={(e) => setCount(u, e.target.value)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <div className="fa-trv" aria-live="polite">
          <span>
            <Icon name="time" size={22} />
            Travel <b>{preview ? formatDuration(travel) : '–'}</b>
          </span>
          <span>
            Lands <b>{lands}</b>
          </span>
          {allowed.includes('attack') || !known ? (
            <>
              <span>
                Home <b>{preview ? clockShort(now + travel * 2, now) : '–'}</b>
              </span>
              <span>
                Carries <b>{total > 0 ? formatInt(carry) : '–'}</b>
              </span>
            </>
          ) : null}
          {moraleLabel(morale) && total > 0 && <span className="fa-mor">{moraleLabel(morale)}</span>}
        </div>
        <div className="fa-rct">
          <span className="fv-up">Recent targets</span>
          <div className="fa-rcl">
            {chips.length === 0 && <span className="fv-mut">Villages you send to will show here.</span>}
            {chips.map((c) => {
              const icon: IconName = c.kind === 'player' ? 'army' : 'village';
              const on = tile?.x === c.x && tile?.y === c.y;
              return (
                <button key={`${c.x}|${c.y}`} type="button" className={`fa-rc${on ? ' is-on' : ''}`} onClick={() => setText(`${c.x}|${c.y}`)} aria-pressed={on}>
                  <Icon name={icon} size={18} />
                  {formatCoords(c.x, c.y)}
                  {c.who && <small>{c.who}</small>}
                </button>
              );
            })}
          </div>
        </div>
        <p className={`fa-why is-${whyTone}`} role={error || lookError ? 'alert' : undefined}>
          {why ?? ' '}
        </p>
        <div className="fa-go">
          <button type="button" className="fv-btn fa-red" disabled={!!attackWhy || busy !== null || !hasTroops} onClick={() => void go('attack')} title={attackWhy ?? undefined}>
            <Icon name="army" size={20} />
            {busy === 'attack' ? 'Sending…' : relief ? 'Win it back' : mode === 'strike' ? 'Strike' : 'Attack'}
          </button>
          <button type="button" className="fv-btn" disabled={!!supportWhy || busy !== null || !hasTroops} onClick={() => void go('support')} title={supportWhy ?? undefined}>
            <Icon name="shield" size={20} />
            {busy === 'support' ? 'Sending…' : 'Support'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- Movements -------------------------------------------------------------------------------------------------------

function moveIcon(m: MovementDto): { icon: IconName; tone: string } {
  if (m.direction === 'incoming' && m.kind === 'attack') return { icon: 'warning', tone: 'm' };
  if (m.kind === 'shipment') return { icon: 'chest', tone: 'm' };
  if (m.kind === 'return') return { icon: 'return', tone: 'r' };
  if (m.kind === 'support') return { icon: 'support', tone: 'd' };
  if (m.kind === 'scout') return { icon: 'scout', tone: 'c' };
  return { icon: MISSION_ICON[m.kind], tone: 'x' };
}

/** Title, one detail line and the small word under the countdown for a movement row. */
function movementText(m: MovementDto, villages: readonly { id: number }[], currentId: number): { title: string; sub: string; word: string } {
  const incoming = m.direction === 'incoming';
  const originMine = villages.some((v) => v.id === m.origin.villageId);
  const targetMine = villages.some((v) => v.id === m.target.villageId);
  const other = originMine && !targetMine ? m.target : targetMine && !originMine ? m.origin : m.origin.villageId === currentId ? m.target : m.origin;
  const who = (v: MovementDto['origin']) => v.ownerName || v.name;
  const units = unitsText(m.units);
  const cargo = m.kind === 'shipment' ? m.resources : m.loot;
  const cargoSum = cargo ? Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const loot = cargoSum > 0 ? `${formatInt(Math.round(cargoSum))} ${m.kind === 'shipment' ? 'resources' : 'loot'}` : '';
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  if (incoming && m.kind === 'attack') return { title: `Attack from ${who(m.origin)}`, sub: join(`from ${where(m.origin)}`, 'size unknown'), word: 'incoming' };
  if (incoming && m.kind === 'support') return { title: `Support from ${who(m.origin)}`, sub: join(units, where(m.origin)), word: 'incoming' };
  if (m.kind === 'shipment') {
    if (incoming) return { title: `Resources from ${who(m.origin)}`, sub: join(loot, where(m.origin)), word: 'incoming' };
    return { title: m.toTribeStore ? 'To Tribe Store' : `Shipment to ${who(m.target)}`, sub: join(loot, where(m.target)), word: 'on the way' };
  }
  if (m.kind === 'return') return { title: loot ? 'Raid coming home' : 'Coming home', sub: join(`${units} from ${where(other)}`, loot), word: 'returning' };
  if (m.kind === 'support') return { title: `Support to ${who(m.target)}`, sub: `${units} to ${where(m.target)}`, word: 'on the way' };
  if (m.kind === 'scout') return { title: `Scouting ${who(m.target)}`, sub: `${units} to ${where(m.target)}`, word: 'on the way' };
  if (m.kind === 'attack') return { title: `${m.target.ownerName ? 'Attack on' : 'Raid on'} ${who(m.target)}`, sub: `${units} to ${where(m.target)}`, word: 'on the way' };
  return { title: `${MISSION_NAME[m.kind]} ${m.target.name}`, sub: `${units} to ${where(m.target)}`, word: 'on the way' };
}

function MovementRow({ m }: { m: MovementDto }) {
  const { now, village, villages, highlightMovementId, refresh, toast } = useGame();
  const [cancelling, setCancelling] = useState(false);
  const cancelLeft = m.cancellableUntil === null ? 0 : m.cancellableUntil - now;
  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await api.cancelMovement(m.id);
      toast(`Called back, home in ${formatDuration(res.movement.arriveAt - res.movement.departAt)}`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setCancelling(false);
      await refresh();
    }
  }
  const atk = m.direction === 'incoming' && m.kind === 'attack';
  const { icon, tone } = moveIcon(m);
  const { title, sub, word } = movementText(m, villages, village.id);
  const left = m.arriveAt - now;
  return (
    <li className={`fa-mv${atk ? ' is-atk' : ''}${highlightMovementId === m.id ? ' is-hl' : ''}`}>
      <span className={`fv-tk ${tone}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="fv-mt">
        <b title={title}>{title}</b>
        <small title={sub}>{sub}</small>
      </span>
      <span className="fv-mc">
        <span className="fv-cd">{left > 0 ? formatDuration(left) : 'arriving…'}</span>
        <span className="fv-at">at {clockShort(m.arriveAt, now)}</span>
      </span>
      <span className="fa-mact">
        {cancelLeft > 0 ? (
          <span className="fa-cnc">
            <button type="button" className="fv-btn sm" disabled={cancelling} onClick={() => void cancel()} title="Troops come back in the time already travelled">
              Cancel
            </button>
            <small>{formatDuration(cancelLeft)} left</small>
          </span>
        ) : (
          <span className="fa-na">{word}</span>
        )}
      </span>
    </li>
  );
}

function MovementsPanel() {
  const { movements } = useGame();
  const [filter, setFilter] = useState<MoveFilter>('all');
  const [all, setAll] = useState(false);
  const counts = moveCounts(movements);
  const list = sortMovements(filterMovements(movements, filter));
  const { shown, more } = takeRows(list, MOVES_SHOWN);
  const tabs: Array<{ id: MoveFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'in', label: 'In' },
    { id: 'out', label: 'Out' },
  ];
  return (
    <section className="fv-pn fa-moves" aria-label="Movements">
      {all && (
        <Dialog title={`Movements · ${list.length}`} onClose={() => setAll(false)}>
          <ul className="fa-mvs">
            {list.map((m) => (
              <MovementRow key={m.id} m={m} />
            ))}
          </ul>
        </Dialog>
      )}
      <div className="fv-ph">
        <h2>Movements</h2>
        {counts.all > 0 && <span className="fv-cnt">{counts.all}</span>}
        {more > 0 && (
          <button type="button" className="fv-lk" onClick={() => setAll(true)} aria-haspopup="dialog">
            +{more} more <Chev />
          </button>
        )}
        <span className="fv-sp" />
        <span className="fa-seg" role="group" aria-label="Show">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`fa-sg${filter === t.id ? ' is-on' : ''}`} aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.label} {counts[t.id]}
            </button>
          ))}
        </span>
      </div>
      <ul className="fa-mvs">
        {shown.length === 0 && <li className="fv-empty">{movements.length === 0 ? 'Nothing on the road.' : 'Nothing here.'}</li>}
        {shown.map((m) => (
          <MovementRow key={m.id} m={m} />
        ))}
      </ul>
    </section>
  );
}

// ---- Support ---------------------------------------------------------------------------------------------------------

function SupportRows({ here, away, busy, actions }: { here: StationedDto[]; away: StationedDto[]; busy: boolean; actions: ReturnType<typeof useSupportActions> }) {
  const { now, village } = useGame();
  const [some, setSome] = useState<StationedDto | null>(null);
  const row = (s: StationedDto, mine: boolean) => {
    const unit = firstUnit(s.units);
    const units = unitsText(s.units);
    const title = mine ? `${units} at ${s.host.ownerName ? `${s.host.ownerName}'s` : s.host.name}` : `${units} from ${s.home.ownerName || s.home.name}`;
    const sub = `${where(mine ? s.host : s.home)} · since ${formatAgo(s.arrivedAt, now)}`;
    return (
      <li key={s.id} className="fa-sr">
        <span className="fv-tk d">{unit ? <UnitFigure unit={unit} pose="icon" size={24} /> : <Icon name="support" size={20} />}</span>
        <span className="fv-mt">
          <b title={title}>{title}</b>
          <small title={sub}>{sub}</small>
        </span>
        <span className="fa-sact">
          {mine ? (
            <span className="fa-cnc">
              <button type="button" className="fv-btn sm" disabled={busy} onClick={() => void actions.recall(s)}>
                Recall
              </button>
              <button type="button" className="fv-lk fa-some" disabled={busy} aria-haspopup="dialog" onClick={() => setSome(s)}>
                some…
              </button>
            </span>
          ) : (
            <button type="button" className="fv-btn sm" disabled={busy} onClick={() => void actions.sendBack(s)}>
              Send back
            </button>
          )}
        </span>
      </li>
    );
  };
  return (
    <>
      {some && (
        <Dialog title={`Recall some of ${unitsText(some.units)}`} onClose={() => setSome(null)}>
          <RecallSome
            s={some}
            busy={busy}
            onRecall={(units) => {
              void actions.recall(some, units).then((ok) => {
                if (ok) setSome(null);
              });
            }}
          />
        </Dialog>
      )}
      {here.length > 0 && (
        <div className="fa-sg2">
          <span className="fv-up">
            Here in {village.name} · {here.length}
          </span>
          <ul>{here.map((s) => row(s, false))}</ul>
        </div>
      )}
      {away.length > 0 && (
        <div className="fa-sg2">
          <span className="fv-up">Your troops away · {away.length}</span>
          <ul>{away.map((s) => row(s, true))}</ul>
        </div>
      )}
    </>
  );
}

/** Send back / recall, the same calls and the same warning as the phone's Support panel. */
function useSupportActions() {
  const { now, refresh, toast } = useGame();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<{ movement: MovementDto }>, okText: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    let ok = false;
    try {
      const res = await fn();
      toast(`${okText}, home in ${formatDuration(res.movement.arriveAt - now)}`);
      ok = true;
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      await refresh();
    }
    return ok;
  }

  return {
    busy,
    dialog,
    async sendBack(s: StationedDto) {
      const who = s.home.ownerName ? `${s.home.ownerName}'s` : 'These';
      const ok = await confirm({
        title: `Send ${who} troops back?`,
        body: (
          <p>
            {unitsText(s.units)} leave {s.host.name} and your village loses their defence.
          </p>
        ),
        confirmLabel: 'Send back',
        danger: true,
      });
      if (ok) await act(() => api.sendBack(s.id), 'Troops sent back');
    },
    recall(s: StationedDto, units?: Partial<Units>): Promise<boolean> {
      return act(() => api.recall(s.id, units), 'Recalled');
    },
  };
}

function SupportPanel() {
  const { stationed } = useGame();
  const actions = useSupportActions();
  const [all, setAll] = useState(false);
  // Two groups need two label lines: one row fewer fits in the panel.
  const groups = (stationed.here.length > 0 ? 1 : 0) + (stationed.abroad.length > 0 ? 1 : 0);
  const budget = splitSupportRows(stationed.here.length, stationed.abroad.length, groups === 2 ? SUPPORT_SHOWN - 1 : SUPPORT_SHOWN);
  const more = stationed.here.length + stationed.abroad.length - budget.here - budget.away;
  const none = stationed.here.length + stationed.abroad.length === 0;
  return (
    <section className="fv-pn fa-support" aria-label="Support">
      {actions.dialog}
      {all && (
        <Dialog title="Support" onClose={() => setAll(false)}>
          <SupportRows here={stationed.here} away={stationed.abroad} busy={actions.busy} actions={actions} />
        </Dialog>
      )}
      <div className="fv-ph">
        <h2>Support</h2>
        <span className="fv-sp" />
        {more > 0 ? (
          <button type="button" className="fv-lk" onClick={() => setAll(true)} aria-haspopup="dialog">
            +{more} more <Chev />
          </button>
        ) : (
          <span className="fv-mut">troops of friends and your own abroad</span>
        )}
      </div>
      {none ? (
        <p className="fv-empty fa-pad">No support troops here or abroad.</p>
      ) : (
        <SupportRows here={stationed.here.slice(0, budget.here)} away={stationed.abroad.slice(0, budget.away)} busy={actions.busy} actions={actions} />
      )}
    </section>
  );
}

// ---- The page --------------------------------------------------------------------------------------------------------

export function FrameArmy() {
  const { openBuilding } = useGame();
  return (
    <div className="fa">
      <LeftColumn onPick={openBuilding} top={<MiniVillage />} middle="training" />
      <div className="fa-main">
        <MusterPanel />
        <div className="fa-bottom">
          <SendPanel />
          <div className="fa-side">
            <MovementsPanel />
            <SupportPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
