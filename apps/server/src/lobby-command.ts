// Commands from the lobby to this world (account deletion and export). Signed like entry passes but under a different domain string
// (LOBBY_COMMAND_DOMAIN), so a pass can never stand in for a command nor a command for a pass. Contract: end of packages/engine/src/api.ts.
// Nothing in a command is trusted before the signature checked out. Failures say as little as possible (never which check failed).

import { verify } from 'node:crypto';
import {
  ENTRY_PASS_CLOCK_SKEW_MS,
  GameError,
  LOBBY_COMMAND_DOMAIN,
  LOBBY_COMMAND_TTL_MS,
  WORLD_ID_PATTERN,
  type LobbyCommandClaims,
  type LobbyCommandType,
} from '@clanfire/engine';
import { ENTRY_PASS_MAX_CHARS, type EntryKey } from './entry-pass.ts';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
/** An Ed25519 signature is 64 bytes = 86 base64url characters without padding. */
const SIG_CHARS = 86;
const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

const invalid = (): GameError => new GameError('unauthorized', 'This command is not valid.');

/**
 * Verify a lobby command for world `worldId` and route type `typ` at time `now`. Order: size, shape, key by kid, signature, then strict claims.
 * Single use (nonce) is the caller's job and must happen in the same transaction as the action.
 */
export function verifyLobbyCommand(command: string, keys: readonly EntryKey[], now: number, worldId: string, typ: LobbyCommandType): LobbyCommandClaims {
  if (typeof command !== 'string' || command.length > ENTRY_PASS_MAX_CHARS) throw invalid();
  const parts = command.split('.');
  if (parts.length !== 2) throw invalid();
  const [payloadPart, sigPart] = parts as [string, string];
  if (payloadPart.length === 0 || !B64URL_RE.test(payloadPart) || sigPart.length !== SIG_CHARS || !B64URL_RE.test(sigPart)) throw invalid();
  const sigBytes = Buffer.from(sigPart, 'base64url');
  if (sigBytes.length !== 64 || sigBytes.toString('base64url') !== sigPart) throw invalid();

  let unverified: unknown;
  try {
    unverified = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof unverified !== 'object' || unverified === null || Array.isArray(unverified)) throw invalid();
  const c = unverified as Record<string, unknown>;
  if (typeof c.kid !== 'string') throw invalid();
  const entry = keys.find((k) => k.kid === c.kid);
  if (!entry) throw invalid();

  let ok = false;
  try {
    ok = verify(null, Buffer.from(`${LOBBY_COMMAND_DOMAIN}\n${payloadPart}`, 'utf8'), entry.key, sigBytes);
  } catch {
    ok = false;
  }
  if (!ok) throw invalid();

  // ---- signature good: every claim strictly ----
  const { v, kid, typ: claimedTyp, aid, wid, iat, exp, nonce } = c;
  if (v !== 1 || kid !== entry.kid) throw invalid();
  if (claimedTyp !== 'account_delete' && claimedTyp !== 'account_export') throw invalid();
  if (claimedTyp !== typ) throw invalid();
  if (!isSafeInt(aid) || aid <= 0) throw invalid();
  if (typeof wid !== 'string' || !WORLD_ID_PATTERN.test(wid) || wid !== worldId) throw invalid();
  if (!isSafeInt(iat) || !isSafeInt(exp)) throw invalid();
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw invalid();
  if (exp <= iat || exp - iat > LOBBY_COMMAND_TTL_MS) throw invalid();
  if (iat > now + ENTRY_PASS_CLOCK_SKEW_MS) throw invalid();
  if (now >= exp) throw new GameError('unauthorized', 'This command has expired.');
  return { v: 1, kid: entry.kid, typ: claimedTyp, aid, wid, iat, exp, nonce };
}
