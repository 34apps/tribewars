// "While you were away" dialog: the two states (left with nothing = Start again; still owns villages = OK) and the village rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AbandonedNoticeDto } from '@clanfire/engine';
import { ReturnSummaryView, awayText } from '../src/components/ReturnSummary.tsx';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const base: AbandonedNoticeDto = {
  villages: 2,
  idleDays: 30,
  since: NOW - 3 * DAY,
  list: [
    { id: 1, name: 'Ashford', x: 12, y: -4, abandonedAt: NOW - 3 * DAY, status: 'taken', takenBy: 'Brenna' },
    { id: 2, name: 'Cinderhold', x: 13, y: -2, abandonedAt: NOW - 3 * DAY, status: 'abandoned' },
  ],
};
const html = (n: AbandonedNoticeDto) => renderToStaticMarkup(createElement(ReturnSummaryView, { notice: n, username: 'me', now: NOW, busy: false, onDismiss: () => {} }));

test('left with nothing: lists each village with its status and offers Start again', () => {
  const h = html({ ...base, newVillageId: 77 });
  assert.match(h, /While you were away/);
  assert.match(h, /Ashford/);
  assert.match(h, /Taken by Brenna/);
  assert.match(h, /Cinderhold/);
  assert.match(h, /Still abandoned/);
  assert.match(h, /Start again/);
  assert.match(h, /beginner protection/);
  assert.doesNotMatch(h, />OK</);
});

test('still owns villages: only OK, no start-again text', () => {
  const h = html(base);
  assert.match(h, />OK</);
  assert.doesNotMatch(h, /Start again/);
  assert.doesNotMatch(h, /beginner protection/);
});

test('an old notice without a list still renders with the count', () => {
  const h = html({ villages: 1, idleDays: 1 });
  assert.match(h, /1 day\. 1 village of yours/);
  assert.equal(awayText({ villages: 3, idleDays: 30 }), 'You were away for 30 days. 3 villages of yours turned abandoned.');
  assert.doesNotMatch(h, /rs-list/);
});
