// Device id for multi-account detection: a random 128-bit id the web client makes once per browser (localStorage) and sends in the
// X-Clanfire-Device header; the server also keeps it in a first-party cookie, so clearing one of the two does not make the browser a stranger.
// Only a SHA-256 hash is ever stored (player_devices). Nothing else about the browser is read: no canvas, font or hardware fingerprinting.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sha256Hex } from './auth.ts';

export const DEVICE_HEADER = 'x-clanfire-device';
export const DEVICE_COOKIE = 'cf_device';
const DEVICE_ID = /^[0-9a-f]{32}$/;
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

export const hashDevice = (id: string): string => sha256Hex(`clanfire-device:${id}`);

/** Hashes of the valid ids on this request (header and cookie; up to two). Sets the cookie when the browser has none yet. */
export function readDeviceHashes(req: FastifyRequest, reply: FastifyReply, secure: boolean): string[] {
  const raw = req.headers[DEVICE_HEADER];
  const fromHeader = typeof raw === 'string' && DEVICE_ID.test(raw) ? raw : null;
  const c = req.cookies[DEVICE_COOKIE];
  const fromCookie = typeof c === 'string' && DEVICE_ID.test(c) ? c : null;
  if (fromHeader && !fromCookie) {
    void reply.setCookie(DEVICE_COOKIE, fromHeader, { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: DEVICE_COOKIE_MAX_AGE_S });
  }
  return [...new Set([fromHeader, fromCookie].filter((x): x is string => x !== null))].map(hashDevice);
}
