const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../bidmath.js');

const settings = { hoursPerDay: 8, burdenPct: 25, markupPct: 18, consumablesPct: 3, truckDayCents: 9500,
  overheadPct: 10, floorCents: 6500, equipmentPct: 4,
  crew: [{ id: 'c1', name: 'Shawn', wageCents: 3200 }, { id: 'c2', name: 'George', wageCents: 3000 }] };

const bid = {
  areas: [{ items: [
    { qty: 180, costCents: 241, priceCents: null },      // 43,380 cost
    { qty: 4, costCents: 31800, priceCents: null },      // 127,200
    { qty: 1, costCents: 674, priceCents: 700 } ] }],    // override price 700
  misc: { cents: 4000 },
  labor: { crewIds: ['c1', 'c2'], days: 2, tasks: null },   // 2 × 2 × 8 = 32 real hours
  rentals: [{ days: 1, cents: 44500, markup: false }],
  equipment: [{ days: 1, dayCents: 5000 }],
  pricing: { marginPct: 25, rateCents: 6500, cushionPct: 10, markupPct: 18 },
};

test('unitPrice: 241 at 18% = 284 (rounded cents)', () => {
  assert.strictEqual(B.unitPrice(241, 18), 284);
});
test('equipmentDayRate: $1,000 × 4% = $40 → 4000; $900 × 4% = 36 → rounds to $35', () => {
  assert.strictEqual(B.equipmentDayRate(100000, 4), 4000);
  assert.strictEqual(B.equipmentDayRate(90000, 4), 3500);
  assert.strictEqual(B.equipmentDayRate(null, 4), null);
});
test('materialCost and materialPrice (override respected, qty × rounded unit price)', () => {
  assert.strictEqual(B.materialCost(bid), 43380 + 127200 + 674);
  // 180×284 + 4×37524 + 1×700
  assert.strictEqual(B.materialPrice(bid, 18), 180 * 284 + 4 * 37524 + 700);
});
test('laborReal: 32 hours, wage cost split evenly across crew', () => {
  const l = B.laborReal(bid, settings);
  assert.strictEqual(l.hours, 32);
  assert.strictEqual(l.wageCents, 16 * 3200 + 16 * 3000);   // 99,200
});
test('laborReal with tasks sums tasks', () => {
  const b2 = { ...bid, labor: { crewIds: ['c1','c2'], days: 0, tasks: [
    { crewIds: ['c1','c2'], days: 1 }, { crewIds: ['c1'], days: 1 } ] } };
  assert.strictEqual(B.laborReal(b2, settings).hours, 24);
});
test('bidHours rounds UP after cushion: 32 × 1.10 = 35.2 → 36', () => {
  assert.strictEqual(B.bidHours(32, 10), 36);
  assert.strictEqual(B.bidHours(32, 0), 32);
});
test('costStack: true cost carries burden, truck, consumables, overhead', () => {
  const s = B.costStack(bid, settings);
  assert.strictEqual(s.materialCost, 171254);
  assert.strictEqual(s.laborCost, Math.round(99200 * 1.25));       // 124,000
  assert.strictEqual(s.truck, 2 * 9500);
  assert.strictEqual(s.consumables, Math.round(171254 * 0.03));    // 5,138
  assert.strictEqual(s.rentalsCost, 44500);
  assert.strictEqual(s.equipmentCost, 5000);
  const base = 171254 + 44500 + 5000 + 4000 + 124000 + 19000 + 5138;
  assert.strictEqual(s.trueCost, Math.round(base * 1.10));
  assert.strictEqual(s.bidHours, 36);
  assert.strictEqual(s.fixedPrice, s.materialPrice + s.rentalsPrice + s.equipmentPrice + s.misc);
});
test('solve by rate → price and margin; solve by price/margin round-trip to the same rate', () => {
  const s = B.costStack(bid, settings);
  const byRate = B.solve(s, 'rate', 6500);
  assert.strictEqual(byRate.priceCents, s.fixedPrice + 36 * 6500);
  const byPrice = B.solve(s, 'price', byRate.priceCents);
  assert.strictEqual(byPrice.rateCents, 6500);
  const byMargin = B.solve(s, 'margin', byRate.marginPct);
  assert.ok(Math.abs(byMargin.rateCents - 6500) <= 1);
});
test('solve by margin: price = cost / (1 − m), rate = (price − fixed) / bidHours', () => {
  const s = B.costStack(bid, settings);
  const r = B.solve(s, 'margin', 25);
  const expectedPrice = Math.round(s.trueCost / 0.75);
  const expectedRate = Math.round((expectedPrice - s.fixedPrice) / s.bidHours);
  assert.strictEqual(r.rateCents, expectedRate);
  assert.strictEqual(r.priceCents, s.fixedPrice + expectedRate * s.bidHours); // price re-derived from rounded rate
});
test('solve guards bidHours === 0 (no labor on the job): rateCents 0, price = fixedPrice', () => {
  const b3 = { ...bid, labor: { crewIds: ['c1', 'c2'], days: 0, tasks: null } };
  const s3 = B.costStack(b3, settings);
  assert.strictEqual(s3.bidHours, 0);
  const byPrice = B.solve(s3, 'price', 999999);
  assert.strictEqual(byPrice.rateCents, 0);
  assert.strictEqual(byPrice.priceCents, s3.fixedPrice);
  const byMargin = B.solve(s3, 'margin', 25);
  assert.strictEqual(byMargin.rateCents, 0);
  assert.strictEqual(byMargin.priceCents, s3.fixedPrice);
});
test('belowFloor', () => {
  assert.strictEqual(B.belowFloor(6400, 6500), true);
  assert.strictEqual(B.belowFloor(6500, 6500), false);
});
test('atYourRate: labor at the Settings rate vs the bid labor line', () => {
  const s = B.costStack(bid, settings);
  const a = B.atYourRate(s, 6500, 7000);
  assert.deepStrictEqual(a, { atRateCents: 36 * 6500, bidLaborCents: 36 * 7000 });
});
test('fmt: cents → $ string', () => {
  assert.strictEqual(B.fmt(460995), '$4,609.95');
  assert.strictEqual(B.fmt(0), '$0.00');
});

test('fractional day inputs round to whole cents on every line (equipment, truck, price)', () => {
  const settings2 = { ...settings, truckDayCents: 9501 };
  const bid2 = {
    ...bid,
    labor: { crewIds: ['c1', 'c2'], days: 0.5, tasks: null },
    equipment: [{ days: 0.5, dayCents: 5001 }],
  };
  const stack = B.costStack(bid2, settings2);
  assert.ok(Number.isInteger(stack.fixedPrice));
  assert.ok(Number.isInteger(stack.truck));
  assert.ok(Number.isInteger(B.solve(stack, 'rate', 6500).priceCents));
});

test('solve margin clamps at/above 100% instead of returning Infinity/NaN', () => {
  const s = B.costStack(bid, settings);
  const at100 = B.solve(s, 'margin', 100);
  const at150 = B.solve(s, 'margin', 150);
  for (const res of [at100, at150]) {
    assert.ok(Number.isFinite(res.rateCents) && Number.isInteger(res.rateCents));
    assert.ok(Number.isFinite(res.priceCents) && Number.isInteger(res.priceCents));
    assert.strictEqual(res.priceCents, s.fixedPrice + res.rateCents * s.bidHours);
  }
});

test('rentals honor the bid-level markup override, same as materials', () => {
  const bid3 = {
    ...bid,
    pricing: { ...bid.pricing, markupPct: 30 },
    rentals: [{ days: 1, cents: 10000, markup: true }],
  };
  const s = B.costStack(bid3, settings);
  assert.strictEqual(s.rentalsPrice, 13000);
});

test('laborReal flags unknown crewIds but still bills their hours at $0', () => {
  const b4 = { ...bid, labor: { crewIds: ['c1', 'ghost'], days: 2, tasks: null } };
  const l = B.laborReal(b4, settings);
  assert.deepStrictEqual(l.unknownCrewIds, ['ghost']);
  assert.strictEqual(l.hours, 32);
  const s = B.costStack(b4, settings);
  assert.deepStrictEqual(s.unknownCrewIds, ['ghost']);
});

test('fmt handles negative cents, non-finite input, and fractional cents', () => {
  assert.strictEqual(B.fmt(-460995), '-$4,609.95');
  assert.strictEqual(B.fmt(NaN), '—');
  assert.strictEqual(B.fmt(1234.5), '$12.35');
});

test('solve clamps a -0 rate (typed price 1 cent under fixedPrice) to +0', () => {
  const s = B.costStack(bid, settings);
  const res = B.solve(s, 'price', s.fixedPrice - 1);
  assert.ok(Object.is(res.rateCents, 0));
});

test('costStack and laborReal tolerate a missing labor block', () => {
  const b5 = { ...bid, labor: undefined };
  const l = B.laborReal(b5, settings);
  assert.strictEqual(l.hours, 0);
  assert.strictEqual(l.wageCents, 0);
  assert.deepStrictEqual(l.unknownCrewIds, []);
  const s = B.costStack(b5, settings);
  assert.strictEqual(s.truck, 0);
  assert.strictEqual(s.laborCost, 0);
});
