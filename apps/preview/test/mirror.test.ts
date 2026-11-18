import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProblemReporter, mirrorUrl } from '../src/mirror.ts';

test('mirror address is absolute from a page, a blob worker and a blob page', () => {
  assert.equal(mirrorUrl('http://localhost:5174/?x=1#y'), 'http://localhost:5174/__clanfire/preview-world');
  assert.equal(mirrorUrl('blob:http://localhost:5174/4b51dcfd-1b1f'), 'http://localhost:5174/__clanfire/preview-world');
  assert.equal(mirrorUrl('http://127.0.0.1:5212/a/b'), 'http://127.0.0.1:5212/__clanfire/preview-world');
});

test('mirror address is null when there is no usable location', () => {
  assert.equal(mirrorUrl(undefined), null);
  assert.equal(mirrorUrl(''), null);
  assert.equal(mirrorUrl('blob:null/abc'), null);
});

test('a problem is reported once per reason', () => {
  const out: string[] = [];
  const report = createProblemReporter((m) => out.push(m));
  report('the server answered 403');
  report('the server answered 403');
  report('the request failed (TypeError)');
  assert.equal(out.length, 2);
  assert.match(out[0]!, /403/);
});
