// Army page, Support box: own troops abroad get ONE "Bring home" menu button; guests keep "Send back".

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SupportRowActions, bringHomeItems } from '../src/components/BringHome.tsx';

const render = (mine: boolean) => renderToStaticMarkup(createElement(SupportRowActions, { mine, busy: false, onRecall: () => {}, onRecallSome: () => {}, onSendBack: () => {} }));

test('an own-abroad row has one "Bring home" menu button and no separate recall buttons', () => {
  const html = render(true);
  assert.equal((html.match(/Bring home/g) ?? []).length, 1);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Recall/);
  assert.doesNotMatch(html, /role="menu"/, 'the menu is closed until clicked');
});

test('guest rows keep their single "Send back" button', () => {
  const html = render(false);
  assert.match(html, /Send back/);
  assert.doesNotMatch(html, /Bring home/);
});

test('the menu items call recall-all and the recall-some picker', () => {
  const calls: string[] = [];
  const items = bringHomeItems(
    () => calls.push('all'),
    () => calls.push('some'),
  );
  assert.deepEqual(items.map((i) => i.label), ['All troops', 'Choose how many']);
  items[0]?.run();
  items[1]?.run();
  assert.deepEqual(calls, ['all', 'some']);
});
