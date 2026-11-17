// Notes helpers and components: keys and lookups, report-title coordinates, the filter, readable errors, and that user text is
// only ever rendered as text.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NOTES_PER_PLAYER_MAX, NOTE_TEXT_MAX } from '@clanfire/engine';
import type { NoteDto } from '@clanfire/engine';
import { NoteChips, NoteEditor, NoteLine } from '../src/components/Notes.tsx';
import {
  checkNoteForm,
  coordKey,
  filterNotes,
  indexNotes,
  knownTags,
  noteErrorMessage,
  noteKey,
  noteLength,
  noteRowsFit,
  removeNote,
  reportCoords,
  sortNotes,
  toggleTag,
  upsertNote,
} from '../src/notes.ts';

function note(id: number, over: Partial<NoteDto> = {}): NoteDto {
  return { id, kind: 'village', targetId: id * 10, targetName: `Hillfort ${id}`, x: id, y: -id, ownerName: 'Tolvek', text: `note ${id}`, tags: [], updatedAt: id * 1000, ...over };
}

test('keys and indexes', () => {
  assert.equal(noteKey('village', 12), 'village:12');
  assert.equal(noteKey('player', 7), 'player:7');
  assert.equal(coordKey(3, -4), '3|-4');
  const idx = indexNotes([note(1), note(2, { kind: 'player', targetId: 7, targetName: 'Tolvek', x: undefined, y: undefined, ownerName: undefined })]);
  assert.equal(idx.byKey.get('village:10')?.id, 1);
  assert.equal(idx.byKey.get('player:7')?.id, 2);
  assert.equal(idx.byCoords.get('1|-1')?.id, 1);
  assert.equal(idx.byCoords.get('2|-2'), undefined); // a player note has no tile
  assert.equal(idx.byPlayerName.get('tolvek')?.id, 2);
});

test('the coordinates of a report title: the last (x|y), or none', () => {
  assert.deepEqual(reportCoords('Raid on Hillfort (3|-4)'), { x: 3, y: -4 });
  assert.deepEqual(reportCoords('Attack from Tolvek (-2|4)'), { x: -2, y: 4 });
  assert.deepEqual(reportCoords('Your troops at Oak (5|5) were attacked'), { x: 5, y: 5 });
  assert.deepEqual(reportCoords('Relief attack at Oak (1|2) from Pine (8|9)'), { x: 8, y: 9 });
  assert.deepEqual(reportCoords('Support for Oak ( 5 | 6 ) turned back: left the pact'), { x: 5, y: 6 });
  assert.equal(reportCoords('Something else'), null);
  assert.equal(reportCoords('Odd (a|b)'), null);
});

test('the form check is the shared rule', () => {
  assert.equal(checkNoteForm('', []).ok, false);
  const ok = checkNoteForm('  worth a raid ', ['plan', 'prey']);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.text, 'worth a raid');
    assert.deepEqual(ok.tags, ['prey', 'plan']); // fixed tag order
  }
  assert.equal(checkNoteForm('x'.repeat(NOTE_TEXT_MAX + 1), []).ok, false);
  assert.equal(checkNoteForm('x'.repeat(NOTE_TEXT_MAX), []).ok, true);
  assert.equal(checkNoteForm('', ['watch']).ok, true); // a tag alone is a note
  assert.equal(noteLength('a😀b'), 3); // code points, like the server
});

test('tags: unknown ids are dropped from the screen, toggling keeps the fixed order', () => {
  assert.deepEqual(knownTags(['plan', 'bogus', 'prey']), ['prey', 'plan']);
  assert.deepEqual(toggleTag([], 'watch'), ['watch']);
  assert.deepEqual(toggleTag(['plan'], 'prey'), ['prey', 'plan']);
  assert.deepEqual(toggleTag(['prey', 'plan'], 'prey'), ['plan']);
});

test('the Notes page filter: tags (any), kind, both', () => {
  const list = [
    note(1, { tags: ['prey'] }),
    note(2, { kind: 'player', tags: ['prey', 'friend'] }),
    note(3, { tags: [] }),
    note(4, { kind: 'player', tags: ['menace'] }),
  ];
  const ids = (f: Parameters<typeof filterNotes>[1]) => filterNotes(list, f).map((n) => n.id);
  assert.deepEqual(ids({ tags: [], kind: 'all' }), [1, 2, 3, 4]);
  assert.deepEqual(ids({ tags: ['prey'], kind: 'all' }), [1, 2]);
  assert.deepEqual(ids({ tags: ['prey', 'menace'], kind: 'all' }), [1, 2, 4]);
  assert.deepEqual(ids({ tags: [], kind: 'player' }), [2, 4]);
  assert.deepEqual(ids({ tags: ['prey'], kind: 'village' }), [1]);
  assert.equal(noteRowsFit(560, 64), 8);
  assert.equal(noteRowsFit(100, 64), 3);
});

test('local list changes: upsert replaces by target and keeps newest first; remove drops one', () => {
  const a = note(1, { updatedAt: 1000 });
  const b = note(2, { updatedAt: 2000 });
  assert.deepEqual(sortNotes([a, b]).map((n) => n.id), [2, 1]);
  const replaced = upsertNote([a, b], { ...a, text: 'new', updatedAt: 5000 });
  assert.deepEqual(replaced.map((n) => n.id), [1, 2]);
  assert.equal(replaced[0]!.text, 'new');
  assert.equal(upsertNote([a], note(9)).length, 2);
  assert.deepEqual(removeNote([a, b], 1).map((n) => n.id), [2]);
});

test('errors read in plain words: limit, rate limit, others keep their message', () => {
  assert.match(noteErrorMessage({ code: 'note_limit', status: 409, message: 'x' }), new RegExp(String(NOTES_PER_PLAYER_MAX)));
  assert.match(noteErrorMessage({ status: 429, message: 'Too many' }), /too quickly/);
  assert.equal(noteErrorMessage(new Error('Not found.')), 'Not found.');
  assert.equal(noteErrorMessage(null), 'Something went wrong.');
});

test('note text is rendered as escaped text, never as HTML or a link', () => {
  const evil = '<img src=x onerror=alert(1)> https://example.com <b>bold</b>';
  const line = renderToStaticMarkup(createElement(NoteLine, { tags: ['prey'], text: evil }));
  assert.ok(!line.includes('<img'));
  assert.ok(!line.includes('<b>'));
  assert.ok(!line.includes('<a '));
  assert.ok(line.includes('&lt;img'));
  const editor = renderToStaticMarkup(createElement(NoteEditor, { initial: { text: evil, tags: ['plan'] }, textMax: NOTE_TEXT_MAX, onSave: () => Promise.resolve() }));
  assert.ok(!editor.includes('<img'));
  assert.ok(editor.includes('Only you can see this.'));
  assert.ok(editor.includes(`/ ${NOTE_TEXT_MAX}`));
});

test('chips show label and hint; compact chips keep the label for screen readers', () => {
  const full = renderToStaticMarkup(createElement(NoteChips, { tags: ['prey', 'menace'] }));
  assert.ok(full.includes('Prey'));
  assert.ok(full.includes('Menace'));
  const compact = renderToStaticMarkup(createElement(NoteChips, { tags: ['prey', 'menace', 'friend', 'watch'], compact: true, max: 3 }));
  assert.ok(compact.includes('visually-hidden'));
  assert.ok(compact.includes('+1'));
  assert.equal(renderToStaticMarkup(createElement(NoteChips, { tags: [] })), '');
});
