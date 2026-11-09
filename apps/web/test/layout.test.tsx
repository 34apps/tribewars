// Phone or desktop is decided by the device screen, never by the window width (the desktop game is a fixed 1440x900 frame).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFor } from '../src/hooks/useLayout.ts';

test('phones are phones whatever the window size, laptops and monitors are desktop', () => {
  assert.equal(layoutFor(360, true), 'phone');
  assert.equal(layoutFor(430, true), 'phone');
  assert.equal(layoutFor(390, false), 'phone');
  assert.equal(layoutFor(720, false), 'desktop'); // a 1280x720 laptop
  assert.equal(layoutFor(1080, false), 'desktop');
});

test('a small touch screen is phone-style, a big touch screen (laptop, large tablet) is desktop', () => {
  assert.equal(layoutFor(744, true), 'phone');
  assert.equal(layoutFor(820, true), 'desktop');
});
