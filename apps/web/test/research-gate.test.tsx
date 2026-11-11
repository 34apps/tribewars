import { BUILDING_IDS, UNIT_IDS, UNITS } from '@clanfire/engine';
import type { BuildingLevels } from '@clanfire/engine';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchGate } from '../src/rules.ts';

const zeroLevels = () => Object.fromEntries(BUILDING_IDS.map((b) => [b, 0])) as BuildingLevels;
const unit = UNIT_IDS.find((u) => UNITS[u].research && UNITS[u].research!.drillyard >= 3)!;

test('is empty for units that need no research', () => {
    const free = UNIT_IDS.find((u) => !UNITS[u].research)!;
    assert.deepEqual(researchGate(zeroLevels(), free), []);
});
test('names the Drillyard requirements while it is not built, then the research level', () => {
    const lines = researchGate(zeroLevels(), unit);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^Drillyard needs .* · you have 0/);
    assert.equal(lines[1], `Research at Drillyard ${UNITS[unit].research!.drillyard} · you have 0`);
});
test('only asks for the Drillyard level once it is built', () => {
    const levels = { ...zeroLevels(), drillyard: 1 };
    assert.deepEqual(researchGate(levels, unit), [`Research at Drillyard ${UNITS[unit].research!.drillyard} · you have 1`]);
});
test('is empty when research is open', () => {
    const levels = { ...zeroLevels(), drillyard: UNITS[unit].research!.drillyard };
    assert.deepEqual(researchGate(levels, unit), []);
});

