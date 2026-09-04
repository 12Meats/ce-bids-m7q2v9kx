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
// mergeTasks does NOT round: a merge is another way of looking at the same
// job, so the person-hours that come out are the person-hours that went in.
// mergedHours() below asserts exactly that on every case that merges at all —
// the day count alone is not evidence, which is how a crewless task's days
// once turned 32 hours into 80 with the arithmetic "looking" right.
function laborHours(labor) { return B.laborReal({ labor }, settings).hours; }

// Merges, asserts the hours did not move, and hands back the result.
function mergedHours(labor) {
  const m = B.mergeTasks(labor);
  assert.strictEqual(m.ok, true, 'expected this merge to be allowed');
  assert.strictEqual(
    laborHours({ crewIds: m.crewIds, days: m.days, tasks: null }),
    laborHours(labor),
    'merge moved the person-hours'
  );
  return m;
}

test('mergeTasks keeps the total hours: 2 guys 2 days + 1 guy 1 day = 2.5 days for 2 guys', () => {
  const labor = { crewIds: [], days: 0, tasks: [
    { name: 'Main work', crewIds: ['c1', 'c2'], days: 2 },
    { name: 'Trim out', crewIds: ['c1'], days: 1 } ] };
  const m = mergedHours(labor);
  assert.deepStrictEqual(m.crewIds, ['c1', 'c2']);
  assert.strictEqual(m.days, 2.5);
  assert.strictEqual(laborHours(labor), 40);
});
test('mergeTasks does not round to half days: 20 hours over 2 guys is 1.25 days, exactly', () => {
  const labor = { crewIds: [], days: 0, tasks: [
    { name: 'a', crewIds: ['c1', 'c2'], days: 1 },
    { name: 'b', crewIds: ['c1'], days: 0.5 } ] };
  const m = mergedHours(labor);
  assert.strictEqual(m.days, 1.25);
  // The old rule rounded this to 1.5 and quietly added 4 hours to the bid.
  assert.strictEqual(laborHours(labor), 20);
});
test('mergeTasks REFUSES while a task has days on it and nobody on it', () => {
  // Adding those days to the merged line multiplies them by the union crew:
  // 32 real hours came out as 80. Neither reading is right, so it names the
  // task and lets the owner decide.
  const m = B.mergeTasks({ tasks: [
    { name: 'crewed', crewIds: ['c1', 'c2'], days: 2 },
    { name: 'nobody yet', crewIds: [], days: 3 } ] });
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.reason, 'crewless');
  assert.strictEqual(m.taskName, 'nobody yet');
});
test('mergeTasks refuses when NO task has a crew but the days are real', () => {
  const m = B.mergeTasks({ tasks: [
    { name: 'a', crewIds: [], days: 2 },
    { name: 'b', crewIds: [], days: 1 } ] });
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.taskName, 'a');   // the first one that is wrong
});
test('mergeTasks ignores a crewless task with 0 days — an empty line changes nothing', () => {
  const labor = { crewIds: [], days: 0, tasks: [
    { name: 'crewed', crewIds: ['c1', 'c2'], days: 2 },
    { name: 'not filled in', crewIds: [], days: 0 } ] };
  const m = mergedHours(labor);
  assert.deepStrictEqual(m.crewIds, ['c1', 'c2']);
  assert.strictEqual(m.days, 2);
  assert.strictEqual(laborHours(labor), 32);
});
test('mergeTasks over disjoint crews: 1 guy 1 day + a different guy 1 day = 2 guys, 1 day', () => {
  const labor = { crewIds: [], days: 0, tasks: [
    { name: 'a', crewIds: ['c1'], days: 1 },
    { name: 'b', crewIds: ['c2'], days: 1 } ] };
  const m = mergedHours(labor);
  assert.deepStrictEqual(m.crewIds, ['c1', 'c2']);
  assert.strictEqual(m.days, 1);
  assert.strictEqual(laborHours(labor), 16);
  // Hours survive; the TRUCK does not, and that is the merge's real cost. The
  // truck bills per day: two one-day tasks are two truck days, the merged line
  // is one. The Labor screen shows this as a true-cost delta before it asks.
  const before = B.costStack({ ...bid, labor }, settings);
  const after = B.costStack({ ...bid, labor: { crewIds: m.crewIds, days: m.days, tasks: null } }, settings);
  assert.strictEqual(before.truck, 2 * 9500);
  assert.strictEqual(after.truck, 1 * 9500);
  assert.strictEqual(before.realHours, after.realHours);
});
test('mergeTasks: a task with 0 days still puts its crew in the union', () => {
  const labor = { crewIds: [], days: 0, tasks: [
    { name: 'real', crewIds: ['c1'], days: 2 },
    { name: 'not started', crewIds: ['c2'], days: 0 } ] };
  const m = mergedHours(labor);
  assert.deepStrictEqual(m.crewIds, ['c1', 'c2']);
  assert.strictEqual(m.days, 1);
  assert.strictEqual(laborHours(labor), 16);
});
test('mergeTasks on an empty task list is an empty line, not a divide by zero', () => {
  assert.deepStrictEqual(B.mergeTasks({ tasks: [] }), { ok: true, crewIds: [], days: 0 });
  assert.deepStrictEqual(B.mergeTasks({ tasks: null }), { ok: true, crewIds: [], days: 0 });
  assert.deepStrictEqual(B.mergeTasks(null), { ok: true, crewIds: [], days: 0 });
});
test('mergeTasks: float noise stays noise-sized (0.1 + 0.2 days is 0.3, near enough)', () => {
  const m = mergedHours({ crewIds: [], days: 0, tasks: [
    { name: 'a', crewIds: ['c1'], days: 0.1 },
    { name: 'b', crewIds: ['c1'], days: 0.2 } ] });
  assert.ok(Math.abs(m.days - 0.3) < 1e-9, 'expected ~0.3, got ' + m.days);
});
test('lineHours: days x hours-per-day x how many men, and zero when nobody is on it', () => {
  assert.strictEqual(B.lineHours({ days: 2, crewIds: ['c1', 'c2'] }, 8), 32);
  assert.strictEqual(B.lineHours({ days: 0.5, crewIds: ['c1'] }, 10), 5);
  assert.strictEqual(B.lineHours({ days: 4, crewIds: [] }, 8), 0);
  assert.strictEqual(B.lineHours({ days: 0, crewIds: ['c1'] }, 8), 0);
  // the readout is built from this, so a task caption using it cannot disagree
  assert.strictEqual(B.laborReal(bid, settings).hours, B.lineHours(bid.labor, 8));
});
// The truck bills per day, and "a day" changes shape when the job is split:
// summed across the tasks, not the union day count. The Price screen prints
// this figure beside the truck charge, so it is the same function the stack
// bills off rather than a second reading of the same bid.
test('truckDays: the single line before a split, the sum of the tasks after', () => {
  assert.strictEqual(B.truckDays(bid), 2);
  const split = { ...bid, labor: { crewIds: ['c1'], days: 2, tasks: [
    { crewIds: ['c1', 'c2'], days: 1 }, { crewIds: ['c1'], days: 1.5 } ] } };
  assert.strictEqual(B.truckDays(split), 2.5);
  assert.strictEqual(B.costStack(split, settings).truck, Math.round(2.5 * 9500));
  // No labor block at all is 0 days, not a throw.
  assert.strictEqual(B.truckDays({}), 0);
  // tasks: [] is "not split" — the same reading laborReal takes.
  assert.strictEqual(B.truckDays({ labor: { crewIds: [], days: 3, tasks: [] } }), 3);
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

test('resolveMarkup: bid-level markupPct wins over settings, null falls back to settings', () => {
  assert.strictEqual(B.resolveMarkup({ pricing: { markupPct: 30 } }, settings), 30);
  assert.strictEqual(B.resolveMarkup({ pricing: { markupPct: null } }, settings), settings.markupPct);
});
test('itemPrice: unit price override respected, otherwise unitPrice(costCents, markupPct); qty × unit rounded', () => {
  assert.deepStrictEqual(B.itemPrice({ qty: 180, costCents: 241, priceCents: null }, 18), { unit: 284, cents: 180 * 284 });
  assert.deepStrictEqual(B.itemPrice({ qty: 1, costCents: 674, priceCents: 700 }, 18), { unit: 700, cents: 700 });
});
test('rentalPrice: marked-up rental applies unitPrice, unmarked passes cents through', () => {
  assert.strictEqual(B.rentalPrice({ cents: 10000, markup: true }, 30), B.unitPrice(10000, 30));
  assert.strictEqual(B.rentalPrice({ cents: 44500, markup: false }, 18), 44500);
});
test('equipmentLine: days × dayCents, rounded to whole cents', () => {
  assert.strictEqual(B.equipmentLine({ days: 0.5, dayCents: 7500 }), 3750);
  assert.strictEqual(B.equipmentLine({ days: 1, dayCents: 5000 }), 5000);
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
