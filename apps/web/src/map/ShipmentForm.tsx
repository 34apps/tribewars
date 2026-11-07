import { useState } from 'react';
import { PROJECT_DAILY_CAP_PER_MEMBER, RESOURCE_IDS, checkShipment, flatShipmentTravelMs, shipmentCapacity, shipmentTravelMs, terrainAmountOf, travelRoute } from '@clanfire/engine';
import type { Coords, MapVillageDto, ResourceId, Resources } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import { formatClock, formatDuration, formatInt } from '../format.ts';
import { useGame } from '../game.ts';
import { RESOURCE_ICON, RESOURCE_NAME } from '../icons.ts';
import { WAYMARK_NOTE, slowdownText, slowGroundText } from './travel.ts';
import { useTribeWaymarks } from '../hooks/useWaymarks.ts';
import { useRoadsLevel, withRoads } from '../hooks/useRoadsLevel.ts';

/** "Send resources" for a tribe-mate's or ally's village. The server re-checks everything. */
export function ShipmentForm({ tile, target }: { tile: Coords; target: MapVillageDto }) {
  const { player, live, now, settings, village, applySend, refresh, toast, viewMovement } = useGame();
  const [amounts, setAmounts] = useState<Partial<Record<ResourceId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capacity = shipmentCapacity(live.buildings.market);
  const cargo: Partial<Resources> = {};
  let total = 0;
  for (const r of RESOURCE_IDS) {
    const n = Number(amounts[r] ?? '');
    const have = Math.floor(live.resources[r]);
    const v = Number.isInteger(n) ? Math.max(0, Math.min(have, n)) : 0;
    if (v > 0) cargo[r] = v;
    total += v;
  }
  const check = checkShipment(live, cargo);
  const waymarks = useTribeWaymarks();
  // Tribe mates: the tribe's Roads shorten the trip. The Tribe Store is the store village of my own tribe.
  const mate = player.tribe !== null && player.tribe !== undefined && target.tribeId === player.tribe.id;
  const storeVillage = mate && target.tribeStore === true;
  // At the store village the cargo goes into the Tribe Store by default; untick to help the village owner instead.
  const [intoStore, setIntoStore] = useState(true);
  const toStore = storeVillage && intoStore;
  const roads = useRoadsLevel(mate);
  const travel = withRoads(shipmentTravelMs(village, tile, settings, waymarks), roads);
  const waymarkHelps = waymarks.length > 0 && travel < withRoads(shipmentTravelMs(village, tile, settings), roads);
  const flat = flatShipmentTravelMs(village, tile, settings);
  const slowdown = slowdownText(flat, travel);
  const slowGround = slowdown ? slowGroundText(travelRoute(village, tile, settings.seed, terrainAmountOf(settings), waymarks)) : '';
  const reason = total < 1 ? 'Pick resources' : !check.ok ? check.message : null;

  function set(r: ResourceId, value: string) {
    setError(null);
    setAmounts((a) => ({ ...a, [r]: value }));
  }
  /** Fill one resource with as much as the stock and the free room on the carriers allow. */
  function fillMax(r: ResourceId) {
    const others = total - (cargo[r] ?? 0);
    set(r, String(Math.max(0, Math.min(Math.floor(live.resources[r]), capacity - others))));
  }

  async function send() {
    if (busy || reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.ship(village.id, { x: tile.x, y: tile.y, resources: cargo, ...(toStore ? { toTribeStore: true } : {}) });
      applySend(res);
      setAmounts({});
      toast(`Sent to ${toStore ? 'Tribe Store' : target.name} · ${formatDuration(res.movement.arriveAt - now)}`, {
        action: { label: 'View', onClick: () => viewMovement(res.movement.id) },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  if (live.buildings.market < 1) {
    return <p className="wm-why">Needs a Market</p>;
  }

  return (
    <form
      className="wm-send"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="title-row">
        <h3 className="wm-send-title">{toStore ? 'To Tribe Store' : 'Send resources'}</h3>
        <details className="help-pop on-light">
          <summary aria-label="How sending resources works">?</summary>
          <p className="small">{toStore ? 'Goes to the tribe store, not the village.' : 'Over the storehouse limit on arrival is lost.'}</p>
        </details>
      </div>
      {storeVillage && (
        <label className="wm-muted">
          <input type="checkbox" checked={intoStore} onChange={(e) => setIntoStore(e.target.checked)} /> To Tribe Store
        </label>
      )}
      <p className="wm-muted">
        Carry {formatInt(capacity)}
        {toStore ? ` · ${formatInt(PROJECT_DAILY_CAP_PER_MEMBER)}/day max` : ''}
        {roads > 0 ? ' · Roads: faster' : ''}
      </p>
      <ul className="wm-units">
        {RESOURCE_IDS.map((r) => (
          <li key={r}>
            <label htmlFor={`ship-${r}`}>
              <Icon name={RESOURCE_ICON[r]} size={16} className="inline-icon" /> {RESOURCE_NAME[r]}
              <span className="wm-muted"> / {formatInt(Math.floor(live.resources[r]))}</span>
            </label>
            <input
              id={`ship-${r}`}
              className="wm-input"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="0"
              value={amounts[r] ?? ''}
              onChange={(e) => set(r, e.target.value)}
            />
            <button type="button" className="wm-btn wm-btn-small" onClick={() => fillMax(r)}>
              Max
            </button>
          </li>
        ))}
      </ul>
      <dl className="wm-facts wm-facts-send">
        <div>
          <dt>Total</dt>
          <dd>
            {formatInt(total)} / {formatInt(capacity)}
          </dd>
        </div>
        <div>
          <dt>Travel</dt>
          <dd>
            {formatDuration(travel)}
            {waymarkHelps && <small className="wm-muted"> {WAYMARK_NOTE}</small>}
          </dd>
        </div>
        {slowdown && (
          <div className="wm-terrain-time">
            <dt>Flat</dt>
            <dd>
              {formatDuration(flat)} <span className="wm-slow">{slowdown}</span>
              <small className="wm-muted"> {slowGround}</small>
            </dd>
          </div>
        )}
        <div>
          <dt>Arrives</dt>
          <dd>{formatClock(now + travel, now)}</dd>
        </div>
      </dl>
      {error && (
        <p className="wm-error" role="alert">
          {error}
        </p>
      )}
      <button className="wm-btn wm-btn-sun wm-btn-big" type="submit" disabled={!!reason || busy}>
        {busy ? 'Sending…' : toStore ? 'Send to store' : 'Send'}
      </button>
      {reason && <div className="wm-why">{reason}</div>}
    </form>
  );
}
