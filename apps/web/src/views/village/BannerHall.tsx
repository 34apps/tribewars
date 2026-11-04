// Banner Hall panel: the Feast turns resources into Renown (docs/GAME_DESIGN.md section 18.2); Chieftains are trained in the Army
// tab (components/ChieftainPanel.tsx), this panel summarises the price. The engine numbers decide what the controls allow; the
// server re-checks everything.

import { BUILDINGS, FEAST_COST, FEAST_DAILY_PER_LEVEL, FEAST_RENOWN } from '@clanfire/engine';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Icon } from '../../art/Icon.tsx';
import { Cost } from '../../components/ui.tsx';
import { formatDuration, formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { clampFeastCount, currentFeastAllowance, feastMaxCount, feastTotal } from '../../renown.ts';
import { requirementText, unmetRequirements } from '../../rules.ts';
import { chieftainRenownNote, nextChieftainPrice } from '../../villages.ts';

export function BannerHallPanel() {
  const { live, now, village, renown, applyVillage, refresh, toast, navigate } = useGame();
  const [want, setWant] = useState(1);
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<number | null>(null);
  const level = live.buildings.bannerhall;

  if (level < 1) {
    const unmet = unmetRequirements(live.buildings, BUILDINGS.bannerhall.requires);
    const building = live.buildQueue.some((j) => j.building === 'bannerhall');
    return (
      <div className="bh">
        <h3 className="eyebrow">Feast</h3>
        <p className="bh-text">Hold a Feast to turn resources into Renown, which you need to own more villages.</p>
        <div className="bh-line">
          <span>One Feast</span>
          <Cost cost={FEAST_COST} />
          <span className="bh-gain">
            <Icon name="renown" size={18} className="inline-icon" /> +{FEAST_RENOWN} Renown
          </span>
        </div>
        <p className="why bh-why">
          {building
            ? 'The Banner Hall is being built. Feasts open when it is done.'
            : unmet.length > 0
              ? `To build the Banner Hall you need ${requirementText(unmet)} first.`
              : 'You can build the Banner Hall now (see above).'}
        </p>
      </div>
    );
  }

  const allowance = currentFeastAllowance(village.feastAllowance ?? { max: 0, used: 0, left: 0, windowEnd: null }, level, now);
  const max = feastMaxCount(live.resources, allowance.left);
  const count = clampFeastCount(want, max);
  const total = feastTotal(Math.max(1, count));
  let reason: string | null = null;
  if (allowance.left < 1) reason = 'No Feasts left in this window';
  else if (max < 1) reason = 'Not enough resources for a Feast';

  async function feast() {
    if (busy || reason || count < 1) return;
    setBusy(true);
    try {
      const res = await api.feast(village.id, count);
      applyVillage(res.village);
      setGained(res.gained);
      setWant(1);
      toast(`+${formatInt(res.gained)} Renown`);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="bh">
      <h3 className="eyebrow">Feast</h3>
      <p className="bh-text">Turn spare resources into Renown. Each level of the hall allows {FEAST_DAILY_PER_LEVEL} Feasts a day.</p>
      <div className="bh-line">
        <span>One Feast</span>
        <Cost cost={FEAST_COST} have={live.resources} />
        <span className="bh-gain">
          <Icon name="renown" size={18} className="inline-icon" /> +{FEAST_RENOWN} Renown
        </span>
      </div>
      <div className="bh-allow" role="status">
        <span>
          Left today: <strong>{allowance.left}</strong> of {allowance.max}
        </span>
        <span className="bh-reset">
          {allowance.windowEnd !== null
            ? `Resets in ${formatDuration(allowance.windowEnd - now)}`
            : 'The first Feast starts a 24 hour window'}
        </span>
      </div>

      <div className="bh-stepper">
        <button
          type="button"
          className="btn bh-step"
          onClick={() => setWant(clampFeastCount(count - 1, max))}
          disabled={busy || count <= 1}
          aria-label="One Feast fewer"
        >
          −
        </button>
        <output className="bh-count" aria-live="polite" aria-label={`${count} Feasts`}>
          {count}
        </output>
        <button
          type="button"
          className="btn bh-step"
          onClick={() => setWant(clampFeastCount(count + 1, max))}
          disabled={busy || count >= max}
          aria-label="One Feast more"
        >
          +
        </button>
        <button type="button" className="btn bh-max" onClick={() => setWant(max)} disabled={busy || max < 1 || count >= max} title={`You can hold ${max}`}>
          Max{max > 0 ? ` ${max}` : ''}
        </button>
      </div>
      {count >= 1 && (
        <div className="bh-preview muted">
          {count} × <Cost cost={total} have={live.resources} /> → <strong>+{formatInt(FEAST_RENOWN * count)} Renown</strong>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-cta bh-go" disabled={!!reason || busy || count < 1} onClick={() => void feast()}>
        {!reason && <Icon name="renown" size={22} />}
        {count > 1 ? `Hold ${count} Feasts` : 'Hold a Feast'}
      </button>
      {reason && <div className="why bh-why">{reason}</div>}
      {gained !== null && !reason && (
        <div className="bh-result" role="status">
          +{formatInt(gained)} Renown earned
        </div>
      )}

      <h3 className="eyebrow bh-chief-title">Chieftain</h3>
      <p className="bh-text">
        The Chieftain founds a new village on free land or, with an escort, puts out the hearth of an abandoned one. Renown is reserved when training
        starts: {formatInt(nextChieftainPrice(renown))} for the next one ({formatInt(renown.balance)} to spend
        {renown.reserved ? `, ${formatInt(renown.reserved)} reserved` : ''}).
      </p>
      <p className="bh-text muted">{chieftainRenownNote()}</p>
      <button type="button" className="btn btn-primary bh-go" onClick={() => navigate('army')}>
        <Icon name="chieftain" size={22} /> Train Chieftains
      </button>
    </div>
  );
}
