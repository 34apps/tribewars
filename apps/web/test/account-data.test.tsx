// Account data UI: device id only created on sign-in/register/enter, delete button gating, download file names, delete texts.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deviceHeaderFor, filenameFromDisposition, lobbyApiBase } from '../src/api.ts';
import { resetDeviceCache } from '../src/device.ts';
import { DeleteConfirmStep, DeleteWhatHappens, canConfirmDelete } from '../src/components/DeleteAccountFlow.tsx';

const g = globalThis as { localStorage?: unknown };
const real = g.localStorage;
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  resetDeviceCache();
});
afterEach(() => {
  g.localStorage = real;
  resetDeviceCache();
});

test('a normal world call creates no device id and sends no header', () => {
  assert.deepEqual(deviceHeaderFor('/api/game/state'), {});
  assert.equal(store.size, 0);
});

test('world login, register and enter create the id; later calls reuse it', () => {
  const h = deviceHeaderFor('/w/w1/api/auth/login');
  const id = h['X-Clanfire-Device'];
  assert.match(id ?? '', /^[0-9a-f]{32}$/);
  assert.equal(store.get('clanfire_device'), id);
  assert.deepEqual(deviceHeaderFor('/api/game/state'), { 'X-Clanfire-Device': id });
});

test('the lobby never gets the device id', () => {
  assert.deepEqual(deviceHeaderFor(`${lobbyApiBase}/auth/login`), {});
  assert.equal(store.size, 0);
});

test('the delete button needs a password and the exact word DELETE', () => {
  assert.equal(canConfirmDelete('', 'DELETE'), false);
  assert.equal(canConfirmDelete('pw', ''), false);
  assert.equal(canConfirmDelete('pw', 'delete'), false);
  assert.equal(canConfirmDelete('pw', 'DELETE'), true);
  const step = (password: string, confirm: string) =>
    renderToStaticMarkup(createElement(DeleteConfirmStep, { password, confirm, busy: false, error: null, onPassword() {}, onConfirm() {}, onCancel() {}, onSubmit() {} }));
  assert.match(step('', ''), /<button type="submit" class="btn btn-danger" disabled=""/);
  assert.doesNotMatch(step('pw', 'DELETE'), /btn-danger" disabled/);
});

test('Content-Disposition file names', () => {
  assert.equal(filenameFromDisposition('attachment; filename="clanflame-data-anna.json"', 'x.json'), 'clanflame-data-anna.json');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''clan%20data.json", 'x.json'), 'clan data.json');
  assert.equal(filenameFromDisposition(null, 'x.json'), 'x.json');
  assert.equal(filenameFromDisposition('attachment; filename="../../evil.json"', 'x.json'), '_.._evil.json');
});

test('delete step 1 shows Flames lines only when the shop exists', () => {
  const html = (flames: number | null) =>
    renderToStaticMarkup(createElement(DeleteWhatHappens, { info: { worlds: [{ id: 'w1', name: 'Ember' }], flames } }));
  assert.match(html(null), /Ember/);
  assert.doesNotMatch(html(null), /Flames/);
  assert.doesNotMatch(html(0), /Flames/);
  const h = html(120);
  assert.match(h, /Your unspent Flames \(120\) will be lost and cannot be refunded\./);
  assert.doesNotMatch(h, /refund your|#shop/i);
  assert.match(h, /cannot be undone/);
});
