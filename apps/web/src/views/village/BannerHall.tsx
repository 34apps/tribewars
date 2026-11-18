// Banner Hall page body (docs/GAME_DESIGN.md 18.2): the ONE home for Chieftains (owner 2026-11-18). Left: Feast and "How taking a village
// works". Right: the Chieftain card (train with a 1 / 2 / 3 choice, queue, War Chest, strike chains, villages being held).
// The server re-checks everything.

import { useState } from "react";
import type { ReactNode } from "react";
import {
  BUILDINGS,
  CANCEL_REFUND_PERCENT,
  CHIEFTAIN_MAX_BATCH,
  CHIEFTAIN_MAX_QUEUED_BATCHES,
  FEAST_RENOWN,
  RESOURCE_IDS,
  UNITS,
  checkTrain,
  worldRules,
  trainTimeMs,
} from "@clanfire/engine";
import type { ResourceId, Resources } from "@clanfire/engine";
import { api, errorMessage } from "../../api.ts";
import { Icon } from "../../art/Icon.tsx";
import { Cost, ProgressBar } from "../../components/ui.tsx";
import { RESOURCE_ICON, RESOURCE_NAME } from "../../icons.ts";
import { useSites } from "../../hooks/useSites.ts";
import { WarChestPayIn } from "../../components/WarChest.tsx";
import { formatDuration, formatInt, formatLeft } from "../../format.ts";
import { useGame, useRules } from "../../game.ts";
import { useLock } from "../../hooks/useLock.ts";
import {
  clampFeastCount,
  feastDiscountPercent,
  feastMaxCount,
  feastPrice,
  feastTotal,
  nextFeastDiscountPercent,
} from "../../renown.ts";
import {
  maxTrainable,
  reasonText,
  requirementText,
  unmetRequirements,
} from "../../rules.ts";
import { chestBatchPrice } from "../../chest.ts";
import {
  CHIEFTAIN_COUNT_RULE,
  HEARTH_OUT_REASON,
  chieftainBatchPrice,
  chieftainRenownNote,
  takingSteps,
} from "../../villages.ts";
import { useCancelJob } from "../cancelJob.tsx";

function Tick({ ok }: { ok: boolean }) {
  return (
    <span
      className={`bh-tick ${ok ? "is-ok" : "is-no"}`}
      aria-label={ok ? "Done" : "Missing"}
    >
      {ok ? "✓" : "✗"}
    </span>
  );
}

export function BannerHallPanel() {
  const { live, village, settings, applyVillage, refresh, toast } = useGame();
  const { busy, begin, end } = useLock();
  const level = live.buildings.bannerhall;
  const [amount, setAmount] = useState("1");

  if (level < 1) {
    const unmet = unmetRequirements(
      live.buildings,
      BUILDINGS.bannerhall.requires,
    );
    const building = live.buildQueue.some((j) => j.building === "bannerhall");
    return (
      <div className="bh-cards">
        <section className="fv-pn bh-card" aria-label="Feast">
          <div className="fv-ph">
            <h2>Feast</h2>
          </div>
          <div className="bh-body">
            <p className="why bh-why">
              Throw a party: spend resources, earn Renown. Renown buys new
              villages.
            </p>
            <div className="bh-cost">
              <Cost cost={feastPrice(1)} />
              <span className="bh-gain">
                <Icon name="renown" size={18} className="inline-icon" /> +
                {FEAST_RENOWN} Renown
              </span>
            </div>
            <p className="why bh-why">
              {building
                ? "Being built"
                : unmet.length > 0
                  ? `Needs ${requirementText(unmet)}`
                  : "Build it above"}
            </p>
          </div>
        </section>
      </div>
    );
  }

  const unit = feastPrice(level);
  const max = feastMaxCount(live.resources, unit);
  const typed = Number.parseInt(amount, 10);
  const count = clampFeastCount(Number.isFinite(typed) ? typed : 1, max);
  const total = feastTotal(Math.max(1, count), unit);
  const reason = max < 1 ? "Need more resources" : null;
  const discount = feastDiscountPercent(level);
  const nextDiscount = nextFeastDiscountPercent(level);

  async function feast(count: number) {
    if (reason || count < 1 || !begin()) return;
    try {
      const res = await api.feast(village.id, count);
      applyVillage(res.village);
      setAmount("1");
      toast(`+${formatInt(res.gained)} Renown`);
    } catch (e) {
      toast(errorMessage(e), { kind: "error" });
    } finally {
      end();
      // Renown is part of the state, not of the village response: this one stays a full refresh.
      void refresh();
    }
  }

  return (
    <div className="bh-cards">
      <div className="bh-col">
        <section className="fv-pn bh-card" aria-label="Feast">
          <div className="fv-ph">
            <h2>Feast</h2>
          </div>
          <div className="bh-body">
            <p className="bh-left">
              {discount > 0 ? (
                <strong>Feast price -{discount}%</strong>
              ) : (
                <strong>Full Feast price</strong>
              )}
              {nextDiscount !== null
                ? ` (level ${level + 1}: -${nextDiscount}%)`
                : " (highest level)"}
            </p>
            <div className="bh-cost">
              <Cost cost={total} have={live.resources} />
              <span className="bh-gain">
                <Icon name="renown" size={18} className="inline-icon" /> +
                {formatInt(FEAST_RENOWN * Math.max(1, count))} Renown
              </span>
            </div>
            <div className="bh-btns">
              <label className="visually-hidden" htmlFor="bh-amount">
                Number of Feasts
              </label>
              <input
                id="bh-amount"
                className="bh-amount"
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.max(1, max)}
                step={1}
                value={amount}
                disabled={max < 1 || busy}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setAmount(String(Math.max(1, count)))}
              />
              <button
                type="button"
                className="btn bh-max-btn"
                disabled={max < 1 || busy}
                onClick={() => setAmount(String(Math.max(1, max)))}
              >
                Max{max > 0 ? ` ${formatInt(max)}` : ""}
              </button>
              <button
                type="button"
                className="btn btn-primary bh-go bh-feast"
                disabled={!!reason || busy}
                onClick={() => void feast(count)}
              >
                <Icon name="renown" size={22} /> Feast
                {count > 1 ? ` ×${formatInt(count)}` : ""}
              </button>
            </div>
            {reason && <p className="why bh-why">{reason}</p>}
          </div>
        </section>

        <section
          className="fv-pn bh-card"
          aria-label="How taking a village works"
        >
          <div className="fv-ph">
            <h2>How taking a village works</h2>
          </div>
          <ol className="bh-steps">
            {takingSteps(settings).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      </div>

      <ChieftainCard />
    </div>
  );
}

/** One need as a bar: label, "have / need", a filled bar (green when complete) and an optional hint or button. */
function NeedBar({
  label,
  have,
  need,
  hint,
  action,
}: {
  label: string;
  have: number;
  need: number;
  hint?: string;
  action?: ReactNode;
}) {
  const done = have >= need;
  return (
    <li className="bh-need">
      <div className="bh-need-top">
        <span className="bh-name">{label}</span>
        <span className="bh-num">
          {formatInt(have)} / {formatInt(need)}
        </span>
      </div>
      <div className="bh-need-bar">
        <ProgressBar
          value={need > 0 ? have / need : 1}
          label={label}
          tone={done ? "ok" : "brand"}
        />
        {action}
      </div>
      {hint && <span className="bh-hint">{hint}</span>}
    </li>
  );
}

/** The Chieftain card: everything about Chieftains in one place. Top to bottom: count, what you need (bars), one Train button, villages, batches. */
function ChieftainCard() {
  const {
    live,
    now,
    village,
    renown,
    chest,
    chains,
    holds,
    settings,
    applyVillage,
    refresh,
    toast,
    showOnMap,
  } = useGame();
  const { myRenownPerDay } = useSites(useRules().features.sites);
  const cancel = useCancelJob();
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = live.trainQueues.bannerhall;
  const def = UNITS.chieftain;
  const owned = renown.villages;
  const out = renown.chieftains ?? 0;

  // An open chain preselects what that village still needs; the player's own pick wins.
  const open = chains.find((c) => c.need > c.have);
  const wanted = open
    ? Math.min(CHIEFTAIN_MAX_BATCH, open.need - open.have)
    : 1;
  const count = picked ?? wanted;

  const batchRenown = chieftainBatchPrice(renown, count, settings);
  const batchChest = chest ? chestBatchPrice(owned, out, count, settings) : 0;
  const batchCost = Object.fromEntries(
    RESOURCE_IDS.map((r) => [r, def.cost[r] * count]),
  ) as Resources;
  const check = checkTrain(live, "chieftain", count, now, settings);
  const perUnit = trainTimeMs("chieftain", live, settings);
  const missingRenown = Math.max(0, batchRenown - renown.balance);
  const missingGold = chest ? Math.max(0, batchChest - chest.gold) : 0;

  let reason: string | null = null;
  if (village.hearth) reason = HEARTH_OUT_REASON;
  else if (queue.length >= CHIEFTAIN_MAX_QUEUED_BATCHES) reason = "Queue full";
  else if (missingRenown > 0)
    reason = `${formatInt(missingRenown)} more Renown needed`;
  else if (missingGold > 0)
    reason = `${formatInt(missingGold)} more War Chest gold needed`;
  else if (!check.ok) reason = reasonText(check);

  async function train() {
    if (busy || reason) return;
    setBusy(true);
    try {
      applyVillage(await api.train(village.id, "chieftain", count));
      toast(
        `${formatInt(count)} × ${def.name}: ${formatInt(batchRenown)} Renown reserved`,
      );
      setPicked(null);
    } catch (e) {
      toast(errorMessage(e), { kind: "error" });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const home = live.troops.chieftain ?? 0;
  const away = live.away.chieftain ?? 0;
  const inTraining = queue.reduce((n, j) => n + j.count - j.done, 0);
  const rules = worldRules(settings).conquest;
  const hourMs = 3_600_000 / Math.max(1e-6, settings.speed);
  const windowMs = rules.chainWindowHours * hourMs;
  const holdMs = Math.max(rules.holdHours, rules.holdHoursAbandoned) * hourMs;
  const have = (r: ResourceId) => Math.floor(live.resources[r] + 1e-9);

  return (
    <section className="fv-pn bh-card bh-chief" aria-label="Chieftain">
      {cancel.dialog}
      <div className="fv-ph">
        <h2>Chieftains</h2>
        <span className="bh-chips">
          <span className="bh-chip" title="Chieftains at home">
            <Icon name="chieftain" size={16} /> At home {formatInt(home)}
          </span>
          <span className="bh-chip">On the way {formatInt(away)}</span>
          <span className="bh-chip">Training {formatInt(inTraining)}</span>
        </span>
      </div>
      <div className="bh-body">
        <div className="bh-train">
          <div className="bh-count-row">
            <b id="bh-count-label">How many?</b>
            <div
              className="bh-count"
              role="group"
              aria-labelledby="bh-count-label"
            >
              {Array.from({ length: CHIEFTAIN_MAX_BATCH }, (_, i) => i + 1).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    className="btn bh-count-btn"
                    aria-pressed={count === n}
                    disabled={busy}
                    onClick={() => setPicked(n)}
                  >
                    {n}
                  </button>
                ),
              )}
            </div>
          </div>
          <p className="muted bh-fine">
            {open ? `${open.name} needs ${open.need - open.have} more. ` : ""}
            {CHIEFTAIN_COUNT_RULE}
          </p>
        </div>

        <ul className="bh-list">
          <NeedBar
            label="Renown"
            have={renown.balance}
            need={batchRenown}
            hint={`From Feasts and battles${myRenownPerDay > 0 ? ` · +${formatInt(myRenownPerDay)} a day from shrines your tribe holds` : ""}`}
          />
          {chest && (
            <NeedBar
              label="War Chest gold"
              have={chest.gold}
              need={batchChest}
              action={missingGold > 0 ? <WarChestPayIn compact /> : undefined}
            />
          )}
          <li className="bh-need">
            <div className="bh-need-top">
              <span className="bh-name">Resources</span>
            </div>
            <div className="bh-res">
              {RESOURCE_IDS.filter((r) => batchCost[r] > 0).map((r) => {
                const short = have(r) < batchCost[r];
                return (
                  <span
                    key={r}
                    className={`bh-res-item${short ? " is-short" : ""}`}
                    title={RESOURCE_NAME[r]}
                  >
                    <Icon
                      name={RESOURCE_ICON[r]}
                      size={18}
                      className="inline-icon"
                    />
                    <b>{formatInt(batchCost[r])}</b>
                    {short ? (
                      <span>{formatInt(batchCost[r] - have(r))} short</span>
                    ) : (
                      <Tick ok />
                    )}
                  </span>
                );
              })}
            </div>
          </li>
        </ul>

        <button
          type="button"
          className="btn btn-primary bh-go bh-train-btn"
          title={`Each extra Chieftain costs more. ${chieftainRenownNote()}`}
          disabled={!!reason || busy}
          onClick={() => void train()}
        >
          <Icon name="chieftain" size={22} />{" "}
          {reason ??
            `Train ${count} ${count === 1 ? "Chieftain" : "Chieftains"} · ${formatDuration(perUnit * count)}`}
        </button>

        {chains.length > 0 && (
          <>
            <div className="bh-sub">Taking a village</div>
            <ul className="bh-live" aria-label="Taking villages">
              {chains.map((c) => {
                const left = c.endsAt - now;
                return (
                  <li key={`c${c.villageId}`} className="bh-vrow">
                    <div className="bh-vtop">
                      <button
                        type="button"
                        className="bh-link"
                        onClick={() => showOnMap(c.x, c.y)}
                      >
                        {c.name}
                      </button>
                      <span
                        className="bh-dots"
                        aria-label={`${c.have} of ${c.need} Chieftains banked`}
                      >
                        {Array.from({ length: c.need }, (_, i) =>
                          i < c.have ? "●" : "○",
                        ).join("")}
                      </span>
                      {c.need > c.have && (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => showOnMap(c.x, c.y)}
                        >
                          Send {c.need - c.have} more
                        </button>
                      )}
                    </div>
                    <ProgressBar
                      value={left / windowMs}
                      label="Time left to bank the rest"
                    />
                    <span className="bh-hint">
                      {left > 0 ? `${formatLeft(left)} left` : "Window over"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {holds.length > 0 && (
          <>
            <div className="bh-sub">Holding</div>
            <ul className="bh-live" aria-label="Villages being held">
              {holds.map((h) => (
                <li key={`h${h.villageId}`} className="bh-vrow">
                  <div className="bh-vtop">
                    <button
                      type="button"
                      className="bh-link"
                      onClick={() => showOnMap(h.x, h.y)}
                    >
                      {h.name}
                    </button>
                  </div>
                  <ProgressBar
                    value={h.holdMsLeft / holdMs}
                    label="Hold time left"
                  />
                  <span className="bh-hint">
                    {h.running
                      ? `Hold ${formatLeft(h.holdMsLeft)} left`
                      : "Paused, needs more occupiers"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {queue.length > 0 && (
          <>
            <div className="bh-sub">In training</div>
            <ul className="bh-live">
              {queue.map((job, i) => {
                const left = job.count - job.done;
                const endAt = job.startAt + job.count * job.perUnitMs;
                const started = now >= job.startAt;
                return (
                  <li key={`${job.startAt}-${i}`} className="bh-vrow">
                    <div className="bh-vtop">
                      <span>
                        {formatInt(job.count)} × {def.name} ·{" "}
                        {started
                          ? `ready in ${formatDuration(endAt - now)}`
                          : `starts in ${formatDuration(job.startAt - now)}`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={cancel.busy}
                        title={`${CANCEL_REFUND_PERCENT}% back, Renown in full`}
                        onClick={() => {
                          const paid = Object.fromEntries(
                            RESOURCE_IDS.map((r) => [r, def.cost[r] * left]),
                          ) as Resources;
                          void cancel.cancelTrain(
                            `${formatInt(left)} × ${def.name}`,
                            paid,
                            "bannerhall",
                            i,
                          );
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <ProgressBar
                      value={
                        started
                          ? 1 -
                            (endAt - now) /
                              Math.max(1, job.count * job.perUnitMs)
                          : 0
                      }
                      label="Training progress"
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
