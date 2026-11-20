// War Chest helpers (docs/GAME_DESIGN.md 18.2): pay-in validation, error texts and the shortfall numbers. No React.
// The server decides everything; these only keep the controls honest.

import type { ChestInfo } from '@clanfire/engine';
import { HEARTH_OUT_REASON } from './villages.ts';

export const CHEST_WARNING = "Gold paid in can't be taken back out. Only Chieftains use it. Raids can't touch it.";

/** The typed pay-in amount: a whole number from 1 to `max`, or null (empty, fraction, negative, too much). */
export function parseChestGold(text: string, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 && n <= Math.floor(max) ? n : null;
}

/** Why the pay-in button is off (null = can pay `text`). */
export function chestPayInReason(text: string, villageGold: number, hearthOut: boolean): string | null {
  if (hearthOut) return HEARTH_OUT_REASON;
  if (Math.floor(villageGold) < 1) return 'No gold in this village';
  if (text.trim() === '') return 'Enter an amount';
  if (parseChestGold(text, villageGold) === null) {
    return /^\d+$/.test(text.trim()) ? 'Not enough gold in this village' : 'Whole numbers only';
  }
  return null;
}

/** Chest gold the next Chieftain costs in all (the whole price of one village, paid when he is trained). */
export function chestWholePrice(chest: Pick<ChestInfo, 'chieftainPrice'>): number {
  return Math.max(1, chest.chieftainPrice);
}

/** What "Fill to next Chieftain" pays: the next Chieftain's price minus the chest gold, capped by this village's gold (0 = nothing to fill). */
export function chestFillAmount(chest: Pick<ChestInfo, 'gold' | 'chieftainPrice'>, villageGold: number): number {
  return chestPayInAmount(chestWholePrice(chest) - chest.gold, villageGold);
}

/** What the one-tap pay-in sends: the missing gold, capped by the gold this village holds (0 = nothing to pay). */
export function chestPayInAmount(missing: number, villageGold: number): number {
  return Math.max(0, Math.min(Math.floor(missing), Math.floor(villageGold)));
}

/** Chest gold still missing for the next Chieftain (0 when the chest has enough). */
export function chestMissing(chest: Pick<ChestInfo, 'gold' | 'chieftainPrice'>): number {
  return Math.max(0, chest.chieftainPrice - chest.gold);
}

/** True when the chest cannot pay for the next Chieftain. */
export function chestShort(chest: Pick<ChestInfo, 'gold' | 'chieftainPrice'> | undefined): boolean {
  return chest !== undefined && chest.gold < chest.chieftainPrice;
}

/** Plain-words text for a refused pay-in (400/409 from the server). */
export function chestErrorText(code: string, fallback: string): string {
  if (code === 'not_enough_resources') return 'Not enough gold in this village';
  if (code === 'requirements_not_met') return HEARTH_OUT_REASON;
  if (code === 'invalid_input') return 'Enter a whole number of gold, 1 or more';
  return fallback;
}

/** Why the Chieftain Train button is off (null = ready): Renown first, then the chest. */
export function chieftainTrainReason(
  renownBalance: number,
  renownPrice: number,
  chest: Pick<ChestInfo, 'gold' | 'chieftainPrice'> | undefined,
): string | null {
  if (renownBalance < renownPrice) return `Need ${renownPrice.toLocaleString('en-US')} Renown`;
  return chestShort(chest) ? 'Needs War Chest gold' : null;
}

/** The War Chest gold prices of the next Chieftains, one each: the server's list, or the next price repeated (an older server). */
export function chestPrices(chest: Pick<ChestInfo, 'chieftainPrice' | 'chieftainPrices'>, n = 3): number[] {
  if (chest.chieftainPrices && chest.chieftainPrices.length > 0) return chest.chieftainPrices;
  return Array.from({ length: n }, () => chest.chieftainPrice);
}

/** War Chest gold a batch of `count` Chieftains costs when it is trained: the first `count` gold prices added up. */
export function chestBatchPrice(chest: Pick<ChestInfo, 'chieftainPrice' | 'chieftainPrices'>, count: number): number {
  return chestPrices(chest).slice(0, Math.max(0, Math.floor(count))).reduce((sum, v) => sum + v, 0);
}

/** War Chest gold a batch of `count` Chieftains really pays now: the full gold prices minus what is banked, never below 0. */
export function chestBatchDue(chest: Pick<ChestInfo, 'chieftainPrice' | 'chieftainPrices' | 'banked'>, count: number): number {
  return Math.max(0, chestBatchPrice(chest, count) - Math.max(0, chest.banked ?? 0));
}
