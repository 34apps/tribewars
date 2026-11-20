// Stripe webhook signatures, implemented here (no SDK). Header: `Stripe-Signature: t=<unix s>,v1=<hex>,v1=<hex>,...`
// v1 = HMAC-SHA256 over `${t}.${rawBody}` with the endpoint's signing secret. Several v1 values appear while a secret is rolled.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_SEC = 300;

/** Build a header value (used by the tests, and handy for manual checks). */
export function signWebhook(rawBody: string, secret: string, timestampSec: number): string {
  const v1 = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `t=${timestampSec},v1=${v1}`;
}

/** True when the header carries a fresh timestamp and a valid signature of exactly this body. */
export function verifyWebhook(rawBody: string, header: string | undefined, secret: string, nowMs: number, toleranceSec = WEBHOOK_TOLERANCE_SEC): boolean {
  if (!header || header.length > 1000 || secret === '') return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) sigs.push(value);
  }
  if (t === null || sigs.length === 0) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  let ok = false;
  for (const s of sigs) {
    // Compare every candidate (no early exit on the first match changes nothing about secrecy, but keep the work uniform).
    if (timingSafeEqual(expected, Buffer.from(s, 'hex'))) ok = true;
  }
  return ok;
}
