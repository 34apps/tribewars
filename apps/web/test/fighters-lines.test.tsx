// Battle report lines of the fighter rankings: destroyed value, why no Renown, and the close-loss line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOST_SEEN_LINE, destroyedLine, renownNoteLine, strikeLine } from '../src/fighters.ts';

test('destroyed line shows only when something was destroyed', () => {
  assert.equal(destroyedLine({ destroyedValue: 1234 }), 'You destroyed troops worth 1,234');
  assert.equal(destroyedLine({ destroyedValue: 0 }), null);
  assert.equal(destroyedLine({}), null);
});

test('Renown reason shows only when no Renown was earned', () => {
  assert.equal(renownNoteLine({ renownNote: 'daily_cap' }), 'No Renown: you already earned the daily most from this opponent');
  assert.equal(renownNoteLine({ renownNote: 'too_small' }), 'No Renown: the battle was too small');
  assert.equal(renownNoteLine({ renownGained: 5, renownNote: 'tiny' }), null);
  assert.equal(renownNoteLine({}), null);
});

test('close-loss line wording', () => {
  assert.equal(LOST_SEEN_LINE, 'Your army fell, but saw what held the village.');
});

test('strike line: what the Chieftain did, in plain words', () => {
  const now = 1_000_000;
  assert.equal(
    strikeLine({ result: 'banked', need: 3, have: 1, endsAt: now + (60 + 58) * 60_000 }, now),
    "Your Chieftain arrived: 1 of 3 needed. Send 2 more within 1h 58m to put this village's hearth out.",
  );
  assert.match(strikeLine({ result: 'banked', need: 2, have: 1, endsAt: now - 1 }, now) ?? '', /time to send the rest has run out/);
  assert.equal(strikeLine({ result: 'struck', need: 1, holdMs: 8 * 3600_000 }, now), 'Hearth put out: hold the village for 8 h.');
  assert.equal(strikeLine({ result: 'fell', need: 1 }, now), 'The Chieftain fell; nothing banked.');
  assert.equal(strikeLine({ result: 'refused', need: 1, reason: 'locked' }, now), 'Not allowed: the village was taken a short while ago and is locked.');
  assert.equal(strikeLine(undefined, now), null);
});
