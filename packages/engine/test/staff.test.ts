import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderTemplate, staffRank } from '../src/index.ts';

describe('renderTemplate', () => {
  it('fills the known placeholders, every occurrence', () => {
    assert.equal(
      renderTemplate('Dear {player}, {staff} here. {player}! Ticket {ticket} ({category})', { player: 'Ann', staff: 'Bo', ticket: '#7', category: 'bug' }),
      'Dear Ann, Bo here. Ann! Ticket #7 (bug)',
    );
  });
  it('leaves unknown placeholders and missing values as written', () => {
    assert.equal(renderTemplate('{x} {player} {staff} {PLAYER} {}', { player: 'Ann' }), '{x} Ann {staff} {PLAYER} {}');
  });
  it('does not recurse or interpret replacement patterns', () => {
    assert.equal(renderTemplate('Hi {player} / {staff}', { player: '{staff}', staff: '$& $1' }), 'Hi {staff} / $& $1');
  });
  it('does not read inherited properties', () => {
    assert.equal(renderTemplate('{player}', Object.create({ player: 'x' }) as Record<string, string>), '{player}');
  });
});

describe('staffRank', () => {
  it('orders the roles', () => {
    assert.ok(staffRank('admin') > staffRank('moderator') && staffRank('moderator') > staffRank('support') && staffRank('support') > staffRank(null));
  });
});
