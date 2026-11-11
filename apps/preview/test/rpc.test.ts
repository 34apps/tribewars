import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClockSnapshot } from '../src/clock.ts';
import { createRpcClient, transferableSave, type PageToWorker } from '../src/rpc.ts';

const snap = (virtual: number): ClockSnapshot => ({ virtual, rate: 1, realAt: 0 });

test('rpc: replies resolve their own call, in any order, after the clock is synced', async () => {
  const sent: PageToWorker[] = [];
  const synced: number[] = [];
  const rpc = createRpcClient((m) => sent.push(m), (s) => synced.push(s.virtual));
  const a = rpc.call('skip', { ms: 1 });
  const b = rpc.call('api', { method: 'GET', path: '/api/state', body: undefined });
  assert.equal(sent.length, 2);
  const [ma, mb] = sent as Extract<PageToWorker, { kind: 'call' }>[];
  assert.equal(ma?.op, 'skip');
  assert.notEqual(ma?.id, mb?.id);
  let bSawClock = -1;
  const bDone = b.then((v) => {
    bSawClock = synced.at(-1) ?? -1;
    return v;
  });
  assert.equal(rpc.handle({ kind: 'reply', id: mb!.id, ok: true, value: { status: 200, body: '{}', headers: {} }, clock: snap(42) }), true);
  assert.deepEqual(await bDone, { status: 200, body: '{}', headers: {} });
  assert.equal(bSawClock, 42);
  rpc.handle({ kind: 'reply', id: ma!.id, ok: false, error: 'busy', clock: snap(43) });
  await assert.rejects(a, /busy/);
  assert.equal(rpc.pending(), 0);
  assert.equal(rpc.handle({ kind: 'storage', ok: true }), false);
});

test('rpc: failAll rejects open calls; a throwing post rejects that call', async () => {
  const rpc = createRpcClient(() => {}, () => {});
  const p = rpc.call('flush', {});
  rpc.failAll('worker gone');
  await assert.rejects(p, /worker gone/);
  const bad = createRpcClient(() => {
    throw new Error('DataCloneError');
  }, () => {});
  await assert.rejects(bad.call('flush', {}), /DataCloneError/);
  assert.equal(bad.pending(), 0);
});

test('transferableSave hands over whole buffers and copies views', () => {
  const whole = new Uint8Array([1, 2, 3]);
  const t1 = transferableSave({ db: whole, token: null });
  assert.equal(t1.save.db, whole);
  assert.equal(t1.transfer[0], whole.buffer);
  const view = new Uint8Array(new ArrayBuffer(8), 2, 3);
  view.set([7, 8, 9]);
  const t2 = transferableSave({ db: view, token: 't' });
  assert.notEqual(t2.save.db, view);
  assert.deepEqual([...(t2.save.db ?? [])], [7, 8, 9]);
  assert.equal(t2.transfer[0]?.byteLength, 3);
  assert.deepEqual(transferableSave({ db: null, token: null }).transfer, []);
});
