import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHIPMENT_BASE_CAPACITY,
  SHIPMENT_CAPACITY_PER_MARKET_LEVEL,
  SHIPMENT_SPEED,
  applyShipmentArrival,
  applyShipmentSend,
  checkShipment,
  shipmentCapacity,
  shipmentTravelMs,
  storageCap,
} from '../src/index.ts';
import { HOUR, S1, S10, village } from './helpers.ts';

describe('shipments', () => {
  it('capacity grows with the Market', () => {
    assert.equal(shipmentCapacity(0), SHIPMENT_BASE_CAPACITY);
    assert.equal(shipmentCapacity(5), SHIPMENT_BASE_CAPACITY + 5 * SHIPMENT_CAPACITY_PER_MARKET_LEVEL);
  });

  it('needs a Market in the sending village', () => {
    const none = village({ buildings: { market: 0 }, resources: { wood: 100 } });
    const r = checkShipment(none, { wood: 10 });
    assert.ok(!r.ok && r.reason === 'requirements_not_met');
    assert.ok(checkShipment(village({ buildings: { market: 1 }, resources: { wood: 100 } }), { wood: 10 }).ok);
  });

  it('travel time uses the distance and scales with world speed', () => {
    const t1 = shipmentTravelMs({ x: 0, y: 0 }, { x: SHIPMENT_SPEED, y: 0 }, S1);
    assert.equal(t1, HOUR);
    assert.equal(shipmentTravelMs({ x: 0, y: 0 }, { x: SHIPMENT_SPEED, y: 0 }, S10), HOUR / 10);
  });

  it('validates cargo', () => {
    const v = village({ buildings: { market: 1 }, resources: { wood: 300, food: 100, iron: 0, gold: 5 } });
    const good = checkShipment(v, { wood: 100, gold: 5 });
    assert.ok(good.ok);
    if (good.ok) assert.deepEqual([good.total, good.resources.wood, good.resources.iron], [105, 100, 0]);
    const bad = (input: unknown) => {
      const r = checkShipment(v, input);
      assert.ok(!r.ok);
      return r.ok ? '' : r.reason;
    };
    assert.equal(bad({}), 'invalid_input');
    assert.equal(bad(null), 'invalid_input');
    assert.equal(bad([]), 'invalid_input');
    assert.equal(bad({ wood: -1 }), 'invalid_input');
    assert.equal(bad({ wood: 1.5 }), 'invalid_input');
    assert.equal(bad({ wood: '5' }), 'invalid_input');
    assert.equal(bad({ stone: 5 }), 'invalid_input');
    assert.equal(bad({ iron: 1 }), 'not_enough_resources');
    assert.equal(bad({ wood: 301 }), 'not_enough_resources');
    const rich = village({ buildings: { market: 1 }, resources: { wood: 5000 } });
    const over = checkShipment(rich, { wood: shipmentCapacity(1) + 1 });
    assert.ok(!over.ok && over.reason === 'invalid_input');
    assert.ok(checkShipment(rich, { wood: shipmentCapacity(1) }).ok);
  });

  it('send takes the cargo out; arrival adds it up to the storehouse cap and drops the rest', () => {
    const v = village({ resources: { wood: 400, food: 0, iron: 0, gold: 0 } });
    const cargo = { wood: 300, food: 0, iron: 0, gold: 0 };
    const sent = applyShipmentSend(v, cargo, 0, S1);
    assert.equal(sent.resources.wood, 100);
    assert.equal(v.resources.wood, 400, 'input untouched');
    const cap = storageCap(v);
    const target = village({ resources: { wood: cap - 100, food: 0, iron: 0, gold: 0 } });
    const got = applyShipmentArrival(target, cargo, 0, S1);
    assert.equal(got.resources.wood, cap);
    const roomy = applyShipmentArrival(village({ resources: { wood: 0, food: 0, iron: 0, gold: 0 } }), cargo, 0, S1);
    assert.equal(roomy.resources.wood, 300);
  });
});
