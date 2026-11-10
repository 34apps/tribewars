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

/** "1,200 Renown" or "1,200 Renown + 2,000 War Chest gold" (chest absent on an older server). */
export function chieftainPriceText(renownPrice: number, chest: Pick<ChestInfo, 'chieftainPrice'> | undefined): string {
  const renown = `${renownPrice.toLocaleString('en-US')} Renown`;
  return chest ? `${renown} + ${chest.chieftainPrice.toLocaleString('en-US')} War Chest gold` : renown;
}
