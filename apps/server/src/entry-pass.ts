// Entry passes from the lobby (docs/MULTI_WORLD.md, contract at the end of packages/engine/src/api.ts).
// A pass is `<payloadB64url>.<sigB64url>`, an Ed25519 signature by the lobby over ENTRY_PASS_DOMAIN + "\n" + payloadPart.
// Nothing in a pass is trusted before the signature checked out. Failures say as little as possible (never which check failed).

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  ENTRY_PASS_CLOCK_SKEW_MS,
  ENTRY_PASS_DOMAIN,
  ENTRY_PASS_MAX_LIFETIME_MS,
  GameError,
  WORLD_ID_PATTERN,
  isStaffRole,
  type EntryPassClaims,
} from '@clanfire/engine';

/** Longest pass accepted; checked before anything is decoded or parsed. */
export const ENTRY_PASS_MAX_CHARS = 2048;
/** Passes carry the name pattern of lobby/world accounts. */
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** An Ed25519 signature is 64 bytes = 86 base64url characters without padding. */
const SIG_CHARS = 86;

export interface EntryKey {
  /** First 16 hex chars of SHA-256(SPKI DER). */
  kid: string;
  key: KeyObject;
}

function invalid(): GameError {
  return new GameError('unauthorized', 'This entry pass is not valid.');
}

/** Key id of a public key: first 16 hex chars of the SHA-256 of its SPKI DER. */
export function keyIdOf(key: KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/**
 * Parse LOBBY_PUBLIC_KEY: a comma-separated list of Ed25519 public keys, each base64 of SPKI DER or PEM text
 * (a literal "\n" in an env file counts as a line break). Empty = no keys. Throws an error that names the variable
 * and the entry number, never the key material. Duplicates (same kid) are dropped.
 */
export function parsePublicKeys(raw: string, what = 'LOBBY_PUBLIC_KEY'): EntryKey[] {
  const out: EntryKey[] = [];
  const entries = raw.replace(/\\n/g, '\n').split(',');
  entries.forEach((entry, i) => {
    const text = entry.trim();
    if (text === '') return;
    const bad = (): Error => new Error(`Invalid ${what}: entry ${i + 1} is not an Ed25519 public key (expected base64 of the SPKI DER, or PEM).`);
    let key: KeyObject;
    try {
      if (text.includes('-----BEGIN')) {
        // createPublicKey would also derive the public half from a private key; a world must never be given one.
        if (!text.startsWith('-----BEGIN PUBLIC KEY-----')) throw bad();
        key = createPublicKey({ key: text, format: 'pem' });
      } else {
        if (!B64_RE.test(text)) throw bad();
        key = createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
      }
    } catch {
      throw bad();
    }
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw bad();
    const kid = keyIdOf(key);
    if (!out.some((k) => k.kid === kid)) out.push({ kid, key });
  });
  return out;
}

const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * Verify a pass for world `worldId` at time `now` and return its claims. Order: size, shape, key choice by kid (unknown
 * kid = invalid), signature, then strict claim validation and the time and world checks. Single-use (nonce) is the
 * caller's job: it has to happen in the same transaction as the player lookup.
 */
export function verifyEntryPass(pass: string, keys: readonly EntryKey[], now: number, worldId: string): EntryPassClaims {
  if (typeof pass !== 'string' || pass.length > ENTRY_PASS_MAX_CHARS) throw invalid();
  const parts = pass.split('.');
  if (parts.length !== 2) throw invalid();
  const [payloadPart, sigPart] = parts as [string, string];
  if (payloadPart.length === 0 || !B64URL_RE.test(payloadPart) || sigPart.length !== SIG_CHARS || !B64URL_RE.test(sigPart)) throw invalid();

  // Only the canonical encoding of the signature (no stray bits in the last character).
  const sigBytes = Buffer.from(sigPart, 'base64url');
  if (sigBytes.length !== 64 || sigBytes.toString('base64url') !== sigPart) throw invalid();

  // The payload is parsed before the signature check only to learn which key to try; nothing else in it is used until verified.
  let unverified: unknown;
  try {
    unverified = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof unverified !== 'object' || unverified === null || Array.isArray(unverified)) throw invalid();
  const kidHint = (unverified as Record<string, unknown>).kid;
  if (typeof kidHint !== 'string') throw invalid();
  const entry = keys.find((k) => k.kid === kidHint);
  if (!entry) throw invalid();

  let signatureOk = false;
  try {
    signatureOk = verify(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${payloadPart}`, 'utf8'), entry.key, sigBytes);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw invalid();

  // ---- signature good: now check every claim strictly ----
  const c = unverified as Record<string, unknown>;
  const { v, kid, aid, name, wid, chn, role, iat, exp, nonce } = c;
  if (v !== 1 || kid !== entry.kid) throw invalid();
  const keyId = entry.kid;
  if (!isSafeInt(aid) || aid <= 0) throw invalid();
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw invalid();
  if (typeof wid !== 'string' || !WORLD_ID_PATTERN.test(wid)) throw invalid();
  if (typeof chn !== 'string' || chn.length > 64) throw invalid();
  const staffRole = role === null ? null : isStaffRole(role) ? role : undefined;
  if (staffRole === undefined) throw invalid();
  if (!isSafeInt(iat) || !isSafeInt(exp)) throw invalid();
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw invalid();
  if (wid !== worldId) throw invalid();
  if (exp <= iat || exp - iat > ENTRY_PASS_MAX_LIFETIME_MS) throw invalid();
  if (iat > now + ENTRY_PASS_CLOCK_SKEW_MS) throw invalid();
  if (now >= exp) throw new GameError('unauthorized', 'This entry pass has expired.');

  return { v: 1, kid: keyId, aid, name, wid, chn, role: staffRole, iat, exp, nonce };
}
