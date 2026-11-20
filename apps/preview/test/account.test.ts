// The preview is a world with its own accounts: the Settings "Your data" card (download, delete) works through the fake router.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_DELETE_CONFIRM, type WorldExportDto } from '@clanfire/engine';
import { createBackend } from '../src/backend.ts';

const PASSWORD = 'correct horse battery';

test('preview: export returns a WorldExportDto, delete needs password + DELETE and the player cannot sign in again', async () => {
  const b = await createBackend(null, null);
  const post = (url: string, body: unknown) => b.request('POST', url, JSON.stringify(body));
  const info = await b.request('GET', '/api/world/info', undefined);
  assert.equal((JSON.parse(info.body!) as { lobby: boolean }).lobby, false);
  const reg = await post('/api/auth/register', { username: 'dora', password: PASSWORD });
  assert.equal(reg.status, 201);

  const exp = await b.request('GET', '/api/account/export', undefined);
  assert.equal(exp.status, 200);
  assert.match(exp.headers['content-disposition'] ?? '', /attachment; filename="clanflame-w1-dora\.json"/);
  const dto = JSON.parse(exp.body!) as WorldExportDto;
  assert.equal(dto.format, 'clanflame-world-export-v1');
  assert.equal(dto.player?.username, 'dora');

  assert.equal((await post('/api/account/delete', { password: 'nope nope nope', confirm: ACCOUNT_DELETE_CONFIRM })).status, 401);
  assert.equal((await post('/api/account/delete', { password: PASSWORD, confirm: 'delete' })).status, 400);
  const del = await post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM });
  assert.equal(del.status, 204);
  assert.equal(b.getToken(), null, 'the session cookie was cleared');
  assert.equal((await post('/api/auth/login', { username: 'dora', password: PASSWORD })).status, 401);
  // the lobby command routes are not usable here
  assert.equal((await post('/api/lobby/account/delete', { command: 'x' })).status, 404);
});
