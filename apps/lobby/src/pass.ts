// Entry passes: short-lived Ed25519-signed tokens that let a lobby account enter one world (contract: packages/engine/src/api.ts).
//   pass = base64url(JSON(claims)) + "." + base64url(signature over utf8(ENTRY_PASS_DOMAIN + "\n" + payloadPart))
// The private key never leaves this process; it is never logged and never part of an error message.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import {
  ENTRY_PASS_CLOCK_SKEW_MS,
  ENTRY_PASS_DOMAIN,
  ENTRY_PASS_MAX_LIFETIME_MS,
  ENTRY_PASS_TTL_MS,
  isStaffRole,
  type BadgeSummaryDto,
  type EntryPassClaims,
  type StaffRole,
} from '@clanfire/engine';

const BAD_KEY = 'LOBBY_SIGNING_KEY is not a valid Ed25519 private key (expected base64 of a PKCS#8 DER key, or a PEM string).';

/**
 * Read the signing key from its environment form: base64 PKCS#8 DER, or a PEM string (a literal "\n" in the value is
 * accepted for env files). Throws a fixed message that never contains any part of the input.
 */
export function parseSigningKey(raw: string): KeyObject {
  const text = raw.trim();
  let key: KeyObject;
  try {
    if (text.includes('-----BEGIN')) {
      key = createPrivateKey({ key: text.replace(/\\n/g, '\n'), format: 'pem' });
    } else {
      if (!/^[A-Za-z0-9+/_-]{40,}={0,2}$/.test(text)) throw new Error('not base64');
      key = createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' });
    }
  } catch {
    throw new Error(BAD_KEY);
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error(BAD_KEY);
  return key;
}

/** Public key (SPKI DER) of a private key, base64: what worlds get as LOBBY_PUBLIC_KEY. */
export function publicKeyBase64(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
}

/** Key id: first 16 hex chars of SHA-256 over the public key's SPKI DER bytes. */
export function keyIdOfSpki(spkiDer: Buffer): string {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

export function keyIdOf(privateKey: KeyObject): string {
  return keyIdOfSpki(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }));
}

export interface GeneratedKeyPair {
  /** Base64 PKCS#8 DER: the value of LOBBY_SIGNING_KEY. Secret. */
  privateKeyBase64: string;
  /** Base64 SPKI DER: the value of LOBBY_PUBLIC_KEY. */
  publicKeyBase64: string;
  privateKey: KeyObject;
}

export function generateKeyPair(): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    privateKeyBase64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export interface PassSubject {
  /** Lobby account id. */
  aid: number;
  name: string;
  /** World id the pass is for. */
  wid: string;
  chn: string;
  role: StaffRole | null;
  /** Per-kind badge summary (summarizeBadges output only). */
  bdg?: BadgeSummaryDto[];
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

/** Build and sign a pass valid for ENTRY_PASS_TTL_MS from `now`. */
export function signPass(subject: PassSubject, privateKey: KeyObject, now: number): { pass: string; claims: EntryPassClaims } {
  const claims: EntryPassClaims = {
    v: 1,
    kid: keyIdOf(privateKey),
    aid: subject.aid,
    name: subject.name,
    wid: subject.wid,
    chn: subject.chn,
    role: subject.role,
    iat: now,
    exp: now + ENTRY_PASS_TTL_MS,
    nonce: randomBytes(16).toString('base64url'),
    ...(subject.bdg ? { bdg: subject.bdg } : {}),
  };
  const payload = b64u(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${payload}`, 'utf8'), privateKey);
  return { pass: `${payload}.${b64u(signature)}`, claims };
}

/**
 * Check a pass against base64 SPKI public keys. FOR THIS PACKAGE'S TESTS ONLY: the world has its own verifier.
 * Returns the claims, or throws Error with the reason.
 */
export function verifyPass(pass: string, publicKeys: readonly string[], now: number): EntryPassClaims {
  const parts = pass.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('malformed pass');
  const [payload, sig] = parts as [string, string];
  let claims: EntryPassClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as EntryPassClaims;
  } catch {
    throw new Error('malformed pass');
  }
  if (!claims || typeof claims !== 'object' || claims.v !== 1) throw new Error('unsupported pass version');
  const keys = publicKeys.map((b) => ({ der: Buffer.from(b, 'base64') })).map((k) => ({ ...k, kid: keyIdOfSpki(k.der) }));
  const found = keys.find((k) => k.kid === claims.kid);
  if (!found) throw new Error('unknown key id');
  const publicKey = createPublicKey({ key: found.der, format: 'der', type: 'spki' });
  const ok = verify(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${payload}`, 'utf8'), publicKey, Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('bad signature');
  const intOk = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
  if (!intOk(claims.aid) || !intOk(claims.iat) || !intOk(claims.exp)) throw new Error('bad claims');
  if (typeof claims.name !== 'string' || typeof claims.wid !== 'string' || typeof claims.chn !== 'string' || typeof claims.nonce !== 'string' || claims.nonce.length < 22) throw new Error('bad claims');
  if (claims.role !== null && !isStaffRole(claims.role)) throw new Error('bad claims');
  if (claims.exp - claims.iat > ENTRY_PASS_MAX_LIFETIME_MS) throw new Error('lifetime too long');
  if (claims.iat > now + ENTRY_PASS_CLOCK_SKEW_MS) throw new Error('issued in the future');
  if (claims.exp <= now) throw new Error('expired');
  return claims;
}
