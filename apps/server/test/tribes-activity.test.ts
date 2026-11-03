// Members' online status and last-online time are visible only with the view_activity right (GAME_DESIGN.md section 11).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ONLINE_WINDOW_MS } from '@clanfire/engine';
import { HOUR, makeApp } from './helpers.ts';
import { addMember, myTribe, newLeader, ok } from './tribe-helpers.ts';

describe('member activity', () => {
  it('leader and officers see online/offline and last seen; plain members do not unless granted', async () => {
    const { app, clock } = await makeApp();
    const lead = await newLeader(app, 'lena', 'Watch Folk', 'WATCH');
    const officer = await addMember(app, lead, 'olga');
    ok(await lead.c.post(`/api/tribe/members/${officer.id}/role`, { role: 'officer' }));
    const mem = await addMember(app, lead, 'mika');

    clock.advance(3 * HOUR); // mika goes quiet, the others keep playing
    await lead.c.state(); // authenticated request: stamps activity
    await officer.c.state();

    const seen = (await myTribe(lead)).tribe?.memberList ?? [];
    const mika = seen.find((m) => m.playerId === mem.id);
    const olga = seen.find((m) => m.playerId === officer.id);
    assert.equal(mika?.online, false);
    assert.ok(mika?.lastActive !== undefined && clock.now() - mika.lastActive > ONLINE_WINDOW_MS);
    assert.equal(olga?.online, true);
    assert.ok((await myTribe(officer)).tribe?.memberList.every((m) => m.lastActive !== undefined));

    for (const m of (await myTribe(mem)).tribe?.memberList ?? []) {
      assert.equal(m.lastActive, undefined);
      assert.equal(m.online, undefined);
    }

    ok(await lead.c.put(`/api/tribe/members/${mem.id}/permissions`, { grants: ['view_activity'] }));
    assert.ok((await myTribe(mem)).tribe?.memberList.every((m) => m.lastActive !== undefined));
  });
});
