// Banner Hall page body: two plain cards. Feast turns resources into Renown (docs/GAME_DESIGN.md 18.2); Chieftain is a checklist
// (Renown, War Chest gold, resources) ending in a Train button that opens the Army tab. The server re-checks everything.

import { BUILDINGS, FEAST_COST, FEAST_RENOWN, RESOURCE_IDS, UNITS } from '@clanfire/engine';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Cost } from '../../components/ui.tsx';
import { WarChestPayIn } from '../../components/WarChest.tsx';
import { formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { currentFeastAllowance, feastMaxCount } from '../../renown.ts';
import { requirementText, unmetRequirements } from '../../rules.ts';
import { chestMissing } from '../../chest.ts';
import { nextChieftainPrice } from '../../villages.ts';

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={`bh-tick ${ok ? 'is-ok' : 'is-no'}`} aria-label={ok ? 'Done' : 'Missing'}>
      {ok ? '✓' : '✗'}
    </span>
  );
}

export function BannerHallPanel() {
  const { live, now, village, renown, chest, settings, applyVillage, refresh, toast, navigate } = useGame();
  const [busy, setBusy] = useState(false);
  const level = live.buildings.bannerhall;

  if (level < 1) {
    const unmet = unmetRequirements(live.buildings, BUILDINGS.bannerhall.requires);
    const building = live.buildQueue.some((j) => j.building === 'bannerhall');
    return (
      <div className="bh-cards">
        <section className="fv-pn bh-card" aria-label="Feast">
          <div className="fv-ph">
            <h2>Feast</h2>
          </div>
          <div className="bh-body">
            <p className="why bh-why">Throw a party: spend resources, earn Renown. Renown buys new villages.</p>
            <div className="bh-cost">
              <Cost cost={FEAST_COST} />
              <span className="bh-gain">
                <Icon name="renown" size={18} className="inline-icon" /> +{FEAST_RENOWN} Renown
              </span>
            </div>
            <p className="why bh-why">
              {building ? 'Being built' : unmet.length > 0 ? `Needs ${requirementText(unmet)}` : 'Build it above'}
            </p>
          </div>
        </section>
      </div>
    );
  }

  const allowance = currentFeastAllowance(village.feastAllowance ?? { max: 0, used: 0, left: 0, windowEnd: null }, level, now);
  const max = feastMaxCount(live.resources, allowance.left);
  const reason = allowance.left < 1 ? 'No Feasts left today' : max < 1 ? 'Need more resources' : null;

  async function feast(count: number) {
    if (busy || reason || count < 1) return;
    setBusy(true);
    try {
      const res = await api.feast(village.id, count);
      applyVillage(res.village);
      toast(`+${formatInt(res.gained)} Renown`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const price = nextChieftainPrice(renown, settings);
  const renownOk = renown.balance >= price;
  const chestMiss = chest ? chestMissing(chest) : 0;
  const chestPct = chest ? Math.min(100, Math.round((chest.gold / Math.max(1, chest.chieftainPrice)) * 100)) : 0;
  const cost = UNITS.chieftain.cost;
  const lacking = RESOURCE_IDS.filter((r) => cost[r] > 0 && Math.floor(live.resources[r] + 1e-9) < cost[r]);
  const trainOff = !renownOk || chestMiss > 0;

  return (
    <div className="bh-cards">
      <section className="fv-pn bh-card" aria-label="Feast">
        <div className="fv-ph">
          <h2>Feast</h2>
        </div>
        <div className="bh-body">
          <div className="bh-cost">
            <Cost cost={FEAST_COST} have={live.resources} />
            <span className="bh-gain">
              <Icon name="renown" size={18} className="inline-icon" /> +{FEAST_RENOWN} Renown
            </span>
          </div>
          <p className="bh-left" role="status">
            {allowance.left < 1 ? 'No Feasts left today' : (
              <>
                <strong>{allowance.left}</strong> {allowance.left === 1 ? 'Feast' : 'Feasts'} left today
              </>
            )}
          </p>
          <p className="why bh-why">Your Banner Hall allows {allowance.max} Feasts a day; upgrade it for more.</p>
          <div className="bh-btns">
            <button type="button" className="btn btn-primary bh-go" disabled={!!reason || busy} onClick={() => void feast(1)}>
              <Icon name="renown" size={22} /> Feast
            </button>
            {max > 1 && (
              <button type="button" className="btn bh-go" disabled={busy} onClick={() => void feast(max)}>
                Feast all {max}
              </button>
            )}
          </div>
          {reason && <p className="why bh-why">{reason}</p>}
        </div>
      </section>

      <section className="fv-pn bh-card" aria-label="Chieftain">
        <div className="fv-ph">
          <h2>Chieftain</h2>
        </div>
        <div className="bh-body">
          <p className="why bh-why">Your Chieftain takes or founds a new village. He needs:</p>
          <ul className="bh-list">
            <li className="bh-row">
              <Tick ok={renownOk} />
              <span className="bh-name">Renown (from Feasts and battles)</span>
              <span className="bh-num">
                {formatInt(renown.balance)} / {formatInt(price)}
              </span>
            </li>
            {chest && (
              <li className="bh-row">
                <Tick ok={chestMiss === 0} />
                <span className="bh-name">War Chest gold (paid in from your villages)</span>
                <span className="bh-num">
                  {formatInt(chest.gold)} / {formatInt(chest.chieftainPrice)} gold
                </span>
                <span
                  className="bh-bar"
                  role="progressbar"
                  aria-label="War Chest gold"
                  aria-valuemin={0}
                  aria-valuemax={chest.chieftainPrice}
                  aria-valuenow={Math.min(chest.gold, chest.chieftainPrice)}
                >
                  <span className="bh-fill" style={{ width: `${chestPct}%` }} />
                </span>
              </li>
            )}
            {lacking.length > 0 && (
              <li className="bh-row">
                <Tick ok={false} />
                <span className="bh-name">Resources</span>
                <span className="bh-num">{lacking.map((r) => `${formatInt(cost[r])} ${r}`).join(' · ')}</span>
              </li>
            )}
          </ul>
          <WarChestPayIn />
          <button type="button" className="btn btn-primary bh-go bh-train" disabled={trainOff} onClick={() => navigate('army')}>
            <Icon name="chieftain" size={22} /> Train Chieftain
          </button>
        </div>
      </section>
    </div>
  );
}
