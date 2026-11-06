// Restart safety: a backend update must never lose or reset world state, and everything that came due while the
// server was down is resolved in time order on startup. Plus the schema-version guard and pre-migration backup.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { emptyUnits, villagePoints, type OwnVillageDto } from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_FINGERPRINT, SCHEMA_VERSION, schemaFingerprintInput } from '../src/db.ts';
import { Clock, HOUR, MINUTE, TEST_WORLD, ok, trainRaiders, weakestAbandoned, TEST_WORLD_CONFIG } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';
import { giveTroops, reports, sendOk, unprotect, units, village } from './warfare-helpers.ts';

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-restart-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const open = (dbPath: string, clock: Clock): Promise<App> => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });

/** Log an existing player in again on a restarted app. */
async function relogin(app: App, p: P): Promise<P> {
  const { Client } = await import('./helpers.ts');
  const c = new Client(app);
  ok(await c.post('/api/auth/login', { username: p.name, password: 'correct horse battery' }));
  return { ...p, c };
}

const movementCount = (app: App): number => (app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n;
const reportCount = (app: App): number => (app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM reports').get() as { n: number }).n;

test('restart: queued recruits, a raid in flight and its return all complete after downtime, nothing duplicated', async () => {
  await withDir(async (dir) => {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    let app = await open(dbPath, clock);
    const a = await newPlayer(app, 'alice');
    unprotect(app, a);
    const vid = await trainRaiders(a.c, clock, 5);
    const target = await weakestAbandoned(a.c, TEST_WORLD.radius as number);
    // No garrison: the raid must always win (battle luck is random per database), so the return trip always exists.
    const tv = app.ctx.store.getVillage(target.id)!;
    tv.state.troops = emptyUnits();
    app.ctx.store.saveVillage(tv.id, tv.state, villagePoints(tv.state));
    // Queue more recruits (not finished) and send 5 raiders out.
    const trained = await a.c.post(`/api/villages/${vid}/train`, { unit: 'raider', count: 3 });
    ok(trained);
    const job = trained.json<OwnVillageDto>().state.trainQueues.barracks[0]!;
    const finishAt = job.startAt + job.count * job.perUnitMs;
    const sent = await sendOk(a, { x: target.x, y: target.y }, 'attack', units({ raider: 5 }));
    const arriveAt = sent.movement.arriveAt;
    assert.ok(finishAt > clock.t && arriveAt > clock.t);
    const before = movementCount(app);
    assert.equal(before, 1);
    await app.close();

    // Server down for a long while: past training, arrival and the way home.
    clock.advance(24 * HOUR);
    app = await open(dbPath, clock);
    const resolved = app.ctx.game.processDue(clock.now()); // exactly what index.ts does at startup
    assert.equal(resolved, 2, 'attack plus the return it spawned');
    assert.equal(movementCount(app), 0);
    assert.equal(app.ctx.game.processDue(clock.now()), 0, 'running the catch-up twice changes nothing');

    const a2 = await relogin(app, a);
    const home = await village(a2);
    const list = await reports(a2);
    assert.equal(list.length, 1, 'one battle report, not duplicated');
    assert.equal(reportCount(app), 1);
    assert.equal(list[0]!.createdAt, arriveAt, 'report is stamped with the arrival time, not the restart time');
    // Recruits finished while down: all 3 are home on top of the survivors.
    const rep = await a2.c.get(`/api/reports/${list[0]!.id}`);
    ok(rep);
    const lost = (rep.json<{ battle: { attackerLosses: Record<string, number> } }>().battle.attackerLosses.raider ?? 0) as number;
    assert.equal(home.state.troops.raider, 5 - lost + 3, 'survivors and the recruits that finished during downtime are home');
    assert.equal(home.state.trainQueues.barracks.length, 0);
    await app.close();
  });
});

async function setupDefender(dir: string) {
  const dbPath = join(dir, 'game.sqlite');
  const clock = new Clock();
  const app = await open(dbPath, clock);
  const a = await newPlayer(app, 'alice');
  const b = await newPlayer(app, 'bob');
  unprotect(app, a, b);
  const vid = await trainRaiders(a.c, clock, 1);
  const trained = await a.c.post(`/api/villages/${vid}/train`, { unit: 'raider', count: 4 });
  ok(trained);
  const job = trained.json<OwnVillageDto>().state.trainQueues.barracks[0]!;
  const finishAt = job.startAt + job.count * job.perUnitMs;
  giveTroops(app, b, { raider: 40 });
  return { dbPath, clock, app, a, b, finishAt };
}

async function defendersSeen(app: App, a: P): Promise<number> {
  const list = await reports(a);
  assert.equal(list.length, 1);
  const rep = await a.c.get(`/api/reports/${list[0]!.id}`);
  ok(rep);
  const body = rep.json<{ battle: { defenderUnits: Record<string, number> } }>().battle;
  return body.defenderUnits.raider ?? 0;
}

test('restart ordering: recruits finished before an attack lands during downtime defend; later ones do not', async () => {
  for (const recruitsFirst of [true, false]) {
    await withDir(async (dir) => {
      const { dbPath, clock, app, a, b, finishAt } = await setupDefender(dir);
      const sent = await sendOk(b, a, 'attack', units({ raider: 40 }));
      let arriveAt = sent.movement.arriveAt;
      if (recruitsFirst) assert.ok(finishAt < arriveAt, 'recruits finish before the attack lands');
      else {
        // Re-time the attack to land before the recruits finish.
        arriveAt = finishAt - 1000;
        app.ctx.store.db.prepare('UPDATE movements SET arrive_at = ? WHERE kind = ?').run(arriveAt, 'attack');
        assert.ok(arriveAt > clock.t);
      }
      await app.close();
      clock.advance(48 * HOUR);
      const app2 = await open(dbPath, clock);
      app2.ctx.game.processDue(clock.now());
      const a2 = await relogin(app2, a);
      assert.equal(await defendersSeen(app2, a2), recruitsFirst ? 5 : 4); // units finish one by one: the last one is still in training
      await app2.close();
    });
  }
});

test('restart with nothing due changes nothing', async () => {
  await withDir(async (dir) => {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    let app = await open(dbPath, clock);
    const a = await newPlayer(app, 'alice');
    const vid = (await village(a)).id;
    ok(await a.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
    clock.advance(MINUTE);
    const snap = (x: App): string => JSON.stringify(x.ctx.store.db.prepare('SELECT id, state_json FROM villages ORDER BY id').all());
    const before = snap(app);
    await app.close();
    app = await open(dbPath, clock);
    assert.equal(app.ctx.game.processDue(clock.now()), 0);
    assert.equal(snap(app), before);
    await app.close();
  });
});

test('runCaretaker resolves due movements before settling villages to now', async () => {
  await withDir(async (dir) => {
    const { clock, app, a, b } = await setupDefender(dir);
    const sent = await sendOk(b, a, 'attack', units({ raider: 40 }));
    const arriveAt = sent.movement.arriveAt;
    const store = app.ctx.store;
    const aid = (await village(a)).id;
    // Make alice idle so the caretaker settles her village.
    store.db.prepare('UPDATE villages SET bot_next_at = 0 WHERE id = ?').run(aid);
    store.db.prepare('UPDATE players SET last_active = 0 WHERE id = ?').run(a.id);
    clock.set(arriveAt + 100 * HOUR); // no API request in between: the movement is due but unprocessed
    assert.equal(movementCount(app) >= 1, true);
    app.ctx.game.runCaretaker(clock.now());
    const list = await reports(await relogin(app, a));
    const battle = list.find((r) => r.createdAt === arriveAt);
    assert.ok(battle, 'the battle was fought at its arrival time');
    // Recruits finished before the arrival (setupDefender trains them long before): they defended.
    assert.equal(await defendersSeen(app, await relogin(app, a)), 5);
    await app.close();
  });
});

test('pre-migration backup: old database is copied once, data intact, version stamped', async () => {
  await withDir(async (dir) => {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    let app = await open(dbPath, clock);
    const a = await newPlayer(app, 'alice');
    void a;
    const counts = (db: DatabaseSync): number[] =>
      ['players', 'villages', 'movements'].map((t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    const expected = counts(app.ctx.store.db);
    app.ctx.store.db.exec('PRAGMA user_version = 0'); // as a database from before versioning
    await app.close();
    assert.equal(existsSync(join(dir, 'backups')), false, 'a fresh database makes no backup');

    app = await open(dbPath, clock);
    const files = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(`pre-migrate-v0-v${SCHEMA_VERSION}-`));
    assert.equal(files.length, 1);
    const copy = new DatabaseSync(join(dir, 'backups', files[0]!), { readOnly: true });
    assert.deepEqual(counts(copy), expected);
    copy.close();
    assert.deepEqual(counts(app.ctx.store.db), expected);
    const v = app.ctx.store.db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(v.user_version, SCHEMA_VERSION);
    await app.close();

    app = await open(dbPath, clock);
    assert.equal(readdirSync(join(dir, 'backups')).length, 1, 'second start makes no new backup');
    await app.close();
  });
});

test('schema guard: changing the schema requires bumping SCHEMA_VERSION', () => {
  const hash = createHash('sha256').update(schemaFingerprintInput()).digest('hex').slice(0, 16);
  assert.equal(hash, SCHEMA_FINGERPRINT, `Schema changed: bump SCHEMA_VERSION and update SCHEMA_FINGERPRINT (new value: '${hash}')`);
});
