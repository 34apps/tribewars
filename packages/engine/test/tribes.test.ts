import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIPLOMACY_KINDS,
  PACT_NOTICE_HOURS,
  RECRUITMENT_MODES,
  TRIBE_DESCRIPTION_MAX,
  TRIBE_NAME_MAX,
  TRIBE_NAME_MIN,
  TRIBE_PERMISSIONS,
  TRIBE_ROLES,
  canKick,
  canTribe,
  effectiveRights,
  parseGrants,
  seesLeadershipBoards,
  checkTribeDescription,
  checkTribeIdentity,
  isAttackForbidden,
  isDiplomacyKind,
  isRecruitment,
  isTribeRole,
  normalizeTribeName,
  normalizeTribeTag,
  pactNoticeMs,
  type PlayerRelation,
  type TribeAction,
  type TribeRole,
} from '../src/index.ts';
import { HOUR, S1, S10 } from './helpers.ts';

const ACTIONS: TribeAction[] = [
  'edit_settings',
  'invite',
  'handle_applications',
  'kick',
  'set_roles',
  'transfer_leadership',
  'diplomacy',
  'disband',
  'chat',
  'forum_manage',
  'forum_moderate',
];

describe('explicit grants', () => {
  it('a grant adds a right to a member; leader-only rights cannot be granted', () => {
    assert.equal(canTribe('member', 'invite'), false);
    assert.equal(canTribe('member', 'invite', ['invite']), true);
    assert.equal(canTribe('member', 'forum_moderate', ['forum_moderate']), true);
    assert.equal(canTribe('member', 'disband', ['disband' as TribeAction]), false);
    assert.equal(canTribe('member', 'set_roles', ['set_roles' as TribeAction]), false);
    assert.equal(canKick('member', 'member', ['kick']), true);
    assert.equal(canKick('member', 'officer', ['kick']), false);
    assert.equal(canKick('member', 'leader', ['kick']), false);
  });

  it('parseGrants validates against the allow-list', () => {
    assert.deepEqual(parseGrants(['kick', 'invite']), ['invite', 'kick']);
    assert.deepEqual(parseGrants([]), []);
    for (const bad of [['disband'], ['set_roles'], ['transfer_leadership'], ['chat'], ['kick', 'kick'], ['nope'], 'kick', null, [1]]) {
      assert.equal(parseGrants(bad), null, JSON.stringify(bad));
    }
  });

  it('lists the effective rights and who sees leadership boards', () => {
    assert.deepEqual(effectiveRights('member'), ['chat']);
    assert.ok(effectiveRights('member', ['kick']).includes('kick'));
    assert.equal(seesLeadershipBoards('member'), false);
    assert.equal(seesLeadershipBoards('member', ['forum_moderate']), true);
    assert.equal(seesLeadershipBoards('member', ['kick']), false);
    assert.equal(seesLeadershipBoards('officer'), true);
  });
});

describe('canTribe: who may do what', () => {
  // [action, leader, officer, member] -- GAME_DESIGN section 11.
  const matrix: Array<[TribeAction, boolean, boolean, boolean]> = [
    ['edit_settings', true, true, false],
    ['invite', true, true, false],
    ['handle_applications', true, true, false],
    ['kick', true, true, false],
    ['diplomacy', true, true, false],
    ['set_roles', true, false, false],
    ['transfer_leadership', true, false, false],
    ['disband', true, false, false],
    ['chat', true, true, true],
    ['forum_manage', true, true, false],
    ['forum_moderate', true, true, false],
  ];

  it('matches the rules table for every action and role', () => {
    assert.equal(matrix.length, ACTIONS.length, 'every action is covered');
    for (const [action, leader, officer, member] of matrix) {
      assert.equal(canTribe('leader', action), leader, `leader ${action}`);
      assert.equal(canTribe('officer', action), officer, `officer ${action}`);
      assert.equal(canTribe('member', action), member, `member ${action}`);
    }
  });

  it('the leader can always do everything; the permission table has no unknown roles or actions', () => {
    for (const action of ACTIONS) assert.ok(canTribe('leader', action), action);
    assert.deepEqual(Object.keys(TRIBE_PERMISSIONS).sort(), [...ACTIONS].sort());
    for (const roles of Object.values(TRIBE_PERMISSIONS)) {
      for (const r of roles) assert.ok(TRIBE_ROLES.includes(r));
    }
  });
});

describe('canKick', () => {
  const expected: Record<TribeRole, Record<TribeRole, boolean>> = {
    leader: { leader: false, officer: true, member: true },
    officer: { leader: false, officer: false, member: true },
    member: { leader: false, officer: false, member: false },
  };

  it('officers remove members, only the leader removes officers, nobody removes the leader', () => {
    for (const actor of TRIBE_ROLES) {
      for (const target of TRIBE_ROLES) {
        assert.equal(canKick(actor, target), expected[actor][target], `${actor} kicks ${target}`);
      }
    }
  });
});

describe('guards', () => {
  it('accept exactly the known values', () => {
    for (const r of TRIBE_ROLES) assert.ok(isTribeRole(r));
    for (const m of RECRUITMENT_MODES) assert.ok(isRecruitment(m));
    for (const k of DIPLOMACY_KINDS) assert.ok(isDiplomacyKind(k));
    for (const bad of ['Leader', '', 'admin', null, undefined, 3, {}, ['leader']]) {
      assert.equal(isTribeRole(bad), false);
      assert.equal(isRecruitment(bad), false);
      assert.equal(isDiplomacyKind(bad), false);
    }
    assert.equal(isRecruitment('closed'), false);
    assert.equal(isDiplomacyKind('war'), false);
    // Inherited object keys are not values.
    assert.equal(isTribeRole('constructor'), false);
  });
});

describe('name and tag normalization', () => {
  it('names: trimmed, inner whitespace runs become one space', () => {
    assert.equal(normalizeTribeName('  Iron   Wolves \t'), 'Iron Wolves');
    assert.equal(normalizeTribeName('a\n\n b'), 'a b');
    assert.equal(normalizeTribeName('Solo'), 'Solo');
    assert.equal(normalizeTribeName('   '), '');
  });

  it('tags: trimmed and upper-cased', () => {
    assert.equal(normalizeTribeTag(' wolf '), 'WOLF');
    assert.equal(normalizeTribeTag('aB3'), 'AB3');
  });
});

describe('checkTribeIdentity', () => {
  const okName = (name: string, tag = 'WOLF'): void => {
    const r = checkTribeIdentity(name, tag);
    assert.equal(r.ok, true, `${JSON.stringify(name)} should be valid`);
    if (r.ok) assert.deepEqual([r.name, r.tag], [name, tag]);
  };
  const badName = (name: string, tag = 'WOLF'): void => {
    const r = checkTribeIdentity(name, tag);
    assert.equal(r.ok, false, `${JSON.stringify(name)} should be rejected`);
    if (!r.ok) assert.equal(r.reason, 'invalid_input');
  };

  it('accepts letters of any language, digits, spaces and - \' . inside', () => {
    okName('Iron Wolves');
    okName('Wölfe');
    okName('Ünïcode Tribe');
    okName('Рыцари севера');
    okName('日本語の部族');
    okName('Les Chevaliers du Nord-Est');
    okName("O'Brien's Clan");
    okName('Tribe 42');
    okName('7th Legion');
    okName('St. Elmo');
    okName('The Wolves.');
  });

  it('rejects HTML, markup characters, symbols, emoji and control characters', () => {
    badName('<b>Wolves</b>');
    badName('Wolves<script>');
    badName('Wolf & Co');
    badName('Wolf "Pack"');
    badName('Wolf_Pack');
    badName('Wolf/Pack');
    badName('Wolf@Pack');
    badName('Wolves \u{1F43A}');
    badName('Wolf\nPack');
    badName('Wolf\tPack');
    badName('Wolf\u0000Pack');
    badName(`Wolf${String.fromCharCode(0x200b)}Pack`); // zero-width space
  });

  it('rejects bad spacing and punctuation at the edges', () => {
    badName(' Wolves');
    badName('Wolves ');
    badName('Iron  Wolves');
    badName("'Wolves");
    badName('-Wolves');
    badName(".Wolves");
    badName("Wolves'");
    badName('Wolves-');
  });

  it('enforces the length limits in characters, not UTF-16 units', () => {
    okName('a'.repeat(TRIBE_NAME_MIN));
    badName('a'.repeat(TRIBE_NAME_MIN - 1));
    okName('a'.repeat(TRIBE_NAME_MAX));
    badName('a'.repeat(TRIBE_NAME_MAX + 1));
    // Mathematical script capital A is a letter outside the BMP (2 UTF-16 units each).
    okName('\u{1D49C}'.repeat(TRIBE_NAME_MAX));
    badName('\u{1D49C}'.repeat(TRIBE_NAME_MAX + 1));
    okName('\u{1D49C}'.repeat(TRIBE_NAME_MIN));
    badName('\u{1D49C}'.repeat(TRIBE_NAME_MIN - 1));
  });

  it('tags: 2-6 upper-case A-Z or digits, validated after normalization', () => {
    for (const tag of ['AB', 'WOLF', 'ABCDEF', 'A1', '42', 'X9Y8Z7']) assert.equal(checkTribeIdentity('Wolves', tag).ok, true, tag);
    for (const tag of ['A', 'ABCDEFG', '', 'a b', 'AB-C', 'A_B', 'ÄÖ', 'WÖLF', '<B>', 'ab\n', 'wolf']) {
      const r = checkTribeIdentity('Wolves', tag);
      assert.equal(r.ok, false, JSON.stringify(tag));
      if (!r.ok) assert.equal(r.reason, 'invalid_input');
    }
    // The documented flow: normalize first, then check.
    const r = checkTribeIdentity(normalizeTribeName('  Iron   Wolves '), normalizeTribeTag(' wolf '));
    assert.deepEqual(r, { ok: true, name: 'Iron Wolves', tag: 'WOLF' });
  });

  it('failures carry a readable message', () => {
    const r = checkTribeIdentity('x', 'WOLF');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /Tribe name/);
    const t = checkTribeIdentity('Wolves', 'W');
    assert.equal(t.ok, false);
    if (!t.ok) assert.match(t.message, /tag/i);
  });
});

describe('checkTribeDescription', () => {
  it('trims and keeps the text; empty is fine', () => {
    assert.deepEqual(checkTribeDescription('  We raid at dawn.  '), { ok: true, text: 'We raid at dawn.' });
    assert.deepEqual(checkTribeDescription(''), { ok: true, text: '' });
    assert.deepEqual(checkTribeDescription('   '), { ok: true, text: '' });
  });

  it('allows exactly TRIBE_DESCRIPTION_MAX characters (counted as characters, after trimming)', () => {
    assert.equal(checkTribeDescription('x'.repeat(TRIBE_DESCRIPTION_MAX)).ok, true);
    assert.equal(checkTribeDescription(` ${'x'.repeat(TRIBE_DESCRIPTION_MAX)} `).ok, true);
    const over = checkTribeDescription('x'.repeat(TRIBE_DESCRIPTION_MAX + 1));
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.reason, 'invalid_input');
    assert.equal(checkTribeDescription('\u{1F43A}'.repeat(TRIBE_DESCRIPTION_MAX)).ok, true);
    assert.equal(checkTribeDescription('\u{1F43A}'.repeat(TRIBE_DESCRIPTION_MAX + 1)).ok, false);
  });

  it('plain text only means nothing is stripped or escaped here (the client renders it as text)', () => {
    assert.deepEqual(checkTribeDescription('<b>hi</b> & bye'), { ok: true, text: '<b>hi</b> & bye' });
  });
});

describe('pactNoticeMs', () => {
  it('is PACT_NOTICE_HOURS divided by world speed', () => {
    assert.equal(PACT_NOTICE_HOURS, 24);
    assert.equal(pactNoticeMs(S1), 24 * HOUR);
    assert.equal(pactNoticeMs(S10), 2.4 * HOUR);
    assert.equal(pactNoticeMs({ ...S1, speed: 2 }), 12 * HOUR);
    assert.equal(pactNoticeMs({ ...S1, speed: 24 }), HOUR);
  });

  it('rounds to whole milliseconds and shrinks as the world gets faster', () => {
    const odd = pactNoticeMs({ ...S1, speed: 7 });
    assert.equal(odd, Math.round((24 * HOUR) / 7));
    assert.ok(Number.isInteger(odd));
    assert.ok(pactNoticeMs({ ...S1, speed: 0.5 }) > pactNoticeMs(S1));
    assert.ok(pactNoticeMs(S10) < pactNoticeMs(S1));
  });
});

describe('isAttackForbidden', () => {
  it('forbids self, tribe, ally and NAP; allows enemy and neutral', () => {
    const expected: Record<PlayerRelation, boolean> = {
      self: true,
      tribe: true,
      ally: true,
      nap: true,
      enemy: false,
      neutral: false,
    };
    for (const [relation, forbidden] of Object.entries(expected) as Array<[PlayerRelation, boolean]>) {
      assert.equal(isAttackForbidden(relation), forbidden, relation);
    }
  });
});
