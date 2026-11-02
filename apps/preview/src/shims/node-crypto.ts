// Browser stand-in for the parts of node:crypto the server uses (auth.ts). The preview is a single-device,
// local game, so password hashing is a fast fake instead of scrypt; everything else is real.

import { sha256 } from '../sha256.ts';

const HEX = '0123456789abcdef';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Just enough of Node's Buffer for auth.ts: from(hex|bytes|utf8), length, toString(hex|base64url|utf8). */
// @ts-expect-error The static from() deliberately follows Node's Buffer.from signature, not Uint8Array.from.
export class Buffer extends Uint8Array {
  static override from(value: string | ArrayLike<number> | ArrayBufferLike, encoding?: string): Buffer {
    if (typeof value === 'string') {
      if (encoding === 'hex') {
        const n = Math.floor(value.length / 2);
        const out = new Buffer(n);
        for (let i = 0; i < n; i++) {
          const byte = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
          if (Number.isNaN(byte)) return out.subarray(0, i) as Buffer;
          out[i] = byte;
        }
        return out;
      }
      const bytes = new TextEncoder().encode(value);
      const out = new Buffer(bytes.length);
      out.set(bytes);
      return out;
    }
    const src = value instanceof ArrayBuffer ? new Uint8Array(value) : (value as ArrayLike<number>);
    const out = new Buffer(src.length);
    out.set(src);
    return out;
  }

  override toString(encoding?: string): string {
    if (encoding === 'hex') {
      let s = '';
      for (const b of this) s += HEX[b >> 4]! + HEX[b & 15]!;
      return s;
    }
    if (encoding === 'base64url') {
      let s = '';
      for (let i = 0; i < this.length; i += 3) {
        const n = (this[i]! << 16) | ((this[i + 1] ?? 0) << 8) | (this[i + 2] ?? 0);
        s += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
        if (i + 1 < this.length) s += B64URL[(n >> 6) & 63]!;
        if (i + 2 < this.length) s += B64URL[n & 63]!;
      }
      return s;
    }
    return new TextDecoder().decode(this);
  }
}

export function randomBytes(n: number): Buffer {
  const out = new Buffer(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Uniform integer in [min, max). */
export function randomInt(min: number, max: number): number {
  const span = max - min;
  const limit = Math.floor(0x100000000 / span) * span;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if ((buf[0] as number) < limit) return min + ((buf[0] as number) % span);
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

type Digest = { update(data: string | Uint8Array): Digest; digest(encoding?: string): string | Buffer };

export function createHash(algorithm: string): Digest {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  const api: Digest = {
    update(data) {
      chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      return api;
    },
    digest(encoding) {
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let off = 0;
      for (const c of chunks) {
        all.set(c, off);
        off += c.length;
      }
      const out = Buffer.from(sha256(all));
      return encoding ? out.toString(encoding) : out;
    },
  };
  return api;
}

/** Fake key derivation: SHA-256 chained over salt + password, stretched to keylen. NOT scrypt; fine for a local preview. */
export function scrypt(
  password: string,
  salt: Uint8Array,
  keylen: number,
  cb: (err: Error | null, key?: Buffer) => void,
): void {
  try {
    const pw = new TextEncoder().encode(password);
    const out = new Buffer(keylen);
    let block: Uint8Array = new Uint8Array(0);
    for (let off = 0; off < keylen; off += 32) {
      const input = new Uint8Array(block.length + salt.length + pw.length);
      input.set(block);
      input.set(salt, block.length);
      input.set(pw, block.length + salt.length);
      block = sha256(input);
      out.set(block.subarray(0, Math.min(32, keylen - off)), off);
    }
    cb(null, out);
  } catch (err) {
    cb(err instanceof Error ? err : new Error(String(err)));
  }
}

// auth.ts uses the global Buffer.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
