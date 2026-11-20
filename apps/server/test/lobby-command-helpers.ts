// A tiny lobby stand-in for tests: its own Ed25519 key pair, signing entry passes (ENTRY_PASS_DOMAIN) and lobby commands (LOBBY_COMMAND_DOMAIN)
// exactly as the contract at the end of packages/engine/src/api.ts says. It does not import the lobby app.

import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { ENTRY_PASS_DOMAIN, ENTRY_PASS_TTL_MS, LOBBY_COMMAND_DOMAIN, LOBBY_COMMAND_TTL_MS, type LobbyCommandType } from '@clanfire/engine';
import { HOST, type Clock } from './helpers.ts';

export class LobbySigner {
  readonly privateKey: KeyObject;
  readonly spkiB64: string;
  readonly kid: string;
  constructor() {
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    const der = pair.publicKey.export({ type: 'spki', format: 'der' });
    this.spkiB64 = der.toString('base64');
    this.kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  }

  private sealed(claims: Record<string, unknown>, domain: string): string {
    const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(`${domain}\n${part}`, 'utf8'), this.privateKey).toString('base64url')}`;
  }

  /** A signed lobby command. */
  command(claims: Record<string, unknown>): string {
    return this.sealed(claims, LOBBY_COMMAND_DOMAIN);
  }

  /** A signed entry pass. */
  pass(claims: Record<string, unknown>): string {
    return this.sealed(claims, ENTRY_PASS_DOMAIN);
  }
}

export const freshNonce = (): string => randomBytes(18).toString('base64url');

/** Valid command claims for world w1 at the test clock; `over` replaces fields. */
export function commandClaims(s: LobbySigner, clock: Clock, typ: LobbyCommandType, aid: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, kid: s.kid, typ, aid, wid: 'w1', iat: clock.t, exp: clock.t + LOBBY_COMMAND_TTL_MS, nonce: freshNonce(), ...over };
}

/** Valid entry-pass claims for world w1 at the test clock. */
export function passClaims(s: LobbySigner, clock: Clock, aid: number, name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, kid: s.kid, aid, name, wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: freshNonce(), ...over };
}

/** POST as the lobby server would: JSON body, NO Origin header, NO cookie (`headers` can add an Origin to test the browser guard). */
export function postLobby(app: FastifyInstance, url: string, command: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url, headers: { host: HOST, 'content-type': 'application/json', ...headers }, payload: JSON.stringify({ command }), remoteAddress: '10.99.0.1' });
}
