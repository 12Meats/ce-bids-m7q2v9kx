const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../docmodel.js');

// The same shape the job screen works on: a won bid with a job on it. Built
// through Store so the settings, the crew ids and the pricing block are the
// real ones and every fixture here would survive validateImport.
function fixture() {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Warehouse lights', jobType: 'service', dateISO: '2026-09-10' });
  b.areas.push({ id: 'a1', name: 'Warehouse', items: [
    { catalogId: null, name: '3/4" rigid', unit: 'ft', qty: 180, costCents: 241, priceCents: null },
    { catalogId: null, name: 'Emergency light fixtures', unit: 'ea', qty: 4, costCents: 31800, priceCents: null } ], photoIds: [] });
  b.misc.cents = 4000;
  b.labor.days = 2;                    // 2 men × 2 days × 8 = 32 real hours
  b.rentals.push({ name: 'Lift rental', days: 1, cents: 44500, markup: false });
  b.pricing.rateCents = 6500;
  b.pricing.cushionPct = 10;           // 32 → 36 bid hours, a 4-hour cushion
  b.status = 'won';
  b.job = S.newJob();
  d.bids.push(b);
  return { d, b, s: d.settings };
}

function co(d, name, areas, days) {
  const c = S.newChangeOrder(d, name);
  c.areas = areas;
  c.labor.days = days;
  return c;
}

const oneArea = () => [{ id: 'co-a1', name: 'Pump room', items: [
  { catalogId: null, name: 'Disconnect', unit: 'ea', qty: 1, costCents: 18000, priceCents: null } ], photoIds: [] }];

// ---------------------------------------------------------------------------
// Store shapes
// ---------------------------------------------------------------------------

test('newJob is the empty job, and a bid carrying one still validates', () => {
  const { d, b } = fixture();
  assert.deepStrictEqual(b.job, { weeks: [], surprises: [], changeOrders: [], completedAt: null });
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('a filled job — weeks, surprises, a change order, a completion date — validates', () => {
  const { d, b } = fixture();
  b.job.weeks.push({ weekISO: '2026-09-14', hours: 30 });
  b.job.surprises.push({ cents: 31000, note: '10-inch wall, new bit', at: '2026-09-16' });
  b.job.changeOrders.push(co(d, 'Disconnect at pump 4', oneArea(), 1));
  b.job.completedAt = '2026-09-25';
  b.status = 'complete';
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('newChangeOrder seeds the visible crew and no days, and hides crew that left', () => {
  const d = S.emptyData();
  d.settings.crew[0].hidden = true;
  const c = S.newChangeOrder(d, 'Extra');
  assert.deepStrictEqual(c.labor, { crewIds: ['c2'], days: 0, tasks: null });
  assert.deepStrictEqual(c.areas, []);
  assert.strictEqual(c.priceCents, 0);
});

// ---------------------------------------------------------------------------
// changeOrderPrice
// ---------------------------------------------------------------------------

test('changeOrderPrice: priced off the PARENT bid rate, cushion and markup', () => {
  const { d, b, s } = fixture();
  const c = co(d, 'Disconnect at pump 4', oneArea(), 1);   // 2 men × 1 day = 16 real hrs → 18 bid hrs
  const price = B.changeOrderPrice(c, b, s);
  const stack = B.costStack(B.changeOrderScratch(c, b), s);
  assert.strictEqual(stack.realHours, 16);
  assert.strictEqual(stack.bidHours, 18);                  // the bid's own 10% cushion
  assert.strictEqual(price, stack.fixedPrice + 18 * 6500);
  // Material takes the bid's markup, not a second opinion about it.
  assert.strictEqual(stack.materialPrice, B.unitPrice(18000, b.pricing.markupPct));
});

test('changeOrderPrice carries none of the parent bid own money', () => {
  const { d, b, s } = fixture();
  const c = co(d, 'Nothing but labor', [], 1);
  const stack = B.costStack(B.changeOrderScratch(c, b), s);
  assert.strictEqual(stack.misc, 0);          // the bid's $40 misc is already charged
  assert.strictEqual(stack.rentalsPrice, 0);  // and so is its lift
  assert.strictEqual(stack.equipmentPrice, 0);
  assert.strictEqual(B.changeOrderPrice(c, b, s), 18 * 6500);
});

test('changeOrderPrice of an empty change order is 0', () => {
  const { d, b, s } = fixture();
  assert.strictEqual(B.changeOrderPrice(S.newChangeOrder(d, 'Not started'), b, s), 0);
});

// ---------------------------------------------------------------------------
// jobActuals
// ---------------------------------------------------------------------------

test('jobActuals with no weeks: nothing logged, margin unmoved, set-aside is the cushion in money', () => {
  const { b, s } = fixture();
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.actualHours, 0);
  assert.strictEqual(a.hoursPct, 0);
  assert.strictEqual(a.realHours, 32);
  assert.strictEqual(a.bidHours, 36);
  assert.strictEqual(a.setAsideCents, 4 * 6500);       // (36 − 32) hours at the sold rate
  assert.strictEqual(a.surpriseCents, 0);
  assert.strictEqual(a.overrunCents, 0);
  assert.strictEqual(a.actualCostCents, a.trueCostCents);
  assert.strictEqual(a.marginNowPct, a.marginStartPct);
});

test('jobActuals: weeks add up, and the burn is hours against BID hours', () => {
  const { b, s } = fixture();
  b.job.weeks.push({ weekISO: '2026-09-14', hours: 30 }, { weekISO: '2026-09-21', hours: 28 });
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.actualHours, 58);
  assert.strictEqual(a.hoursPct, 58 / 36 * 100);
});

test('jobActuals over the real hours costs the overrun at the crew loaded wage', () => {
  const { b, s } = fixture();
  const base = B.jobActuals(b, s);
  const stack = B.costStack(b, s);
  // Loaded means wages plus burden, taken off costStack and not re-derived.
  assert.strictEqual(base.loadedWageCents, Math.round(stack.laborCost / 32));
  b.job.weeks.push({ weekISO: '2026-09-14', hours: 40 });   // 8 hours past the 32 planned
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.overrunCents, 8 * base.loadedWageCents);
  assert.strictEqual(a.actualCostCents, a.trueCostCents + a.overrunCents);
  assert.ok(a.marginNowPct < a.marginStartPct);
});

test('hours UNDER the planned real hours never credit the job', () => {
  const { b, s } = fixture();
  b.job.weeks.push({ weekISO: '2026-09-14', hours: 10 });
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.overrunCents, 0);
  assert.strictEqual(a.actualCostCents, a.trueCostCents);
});

test('surprises above the set-aside eat the margin, and are still only counted once', () => {
  const { b, s } = fixture();
  const a0 = B.jobActuals(b, s);
  b.job.surprises.push({ cents: 31000, note: '10-inch wall, new bit', at: '2026-09-16' },
    { cents: 9000, note: 'Second trip for fittings', at: '2026-09-17' });
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.surpriseCents, 40000);
  assert.ok(a.surpriseCents > a.setAsideCents, 'fixture should overrun the set-aside');
  assert.strictEqual(a.actualCostCents, a0.trueCostCents + 40000);
  assert.strictEqual(a.priceCents, a0.priceCents);        // a surprise is cost, never price
  assert.ok(a.marginNowPct < a.marginStartPct);
});

test('change orders are in the price, and in the price only', () => {
  const { d, b, s } = fixture();
  const a0 = B.jobActuals(b, s);
  const c = co(d, 'Disconnect at pump 4', oneArea(), 1);
  c.priceCents = B.changeOrderPrice(c, b, s);
  b.job.changeOrders.push(c);
  const a = B.jobActuals(b, s);
  assert.strictEqual(a.changeOrderCents, c.priceCents);
  assert.strictEqual(a.priceCents, a0.priceCents + c.priceCents);
  assert.strictEqual(a.actualCostCents, a0.actualCostCents);   // the extra work is not a cost overrun
  assert.ok(a.marginNowPct > a.marginStartPct, 'billed extra work should lift the margin');
});

test('jobActuals.priceCents is the DOCUMENT total, change orders included', () => {
  const { d, b, s } = fixture();
  const c = co(d, 'Disconnect at pump 4', oneArea(), 1);
  c.priceCents = B.changeOrderPrice(c, b, s);
  b.job.changeOrders.push(c);
  const a = B.jobActuals(b, s);
  ['full', 'summary', 'scope'].forEach((level) => {
    assert.strictEqual(a.priceCents, D.build(b, d, level).totalCents, level);
  });
});

test('marginStartPct is the LIVE margin off the stored rate, not the pricing.marginPct snapshot', () => {
  const { b, s } = fixture();
  b.pricing.marginPct = 99;   // a stale snapshot from the last handle move
  const a = B.jobActuals(b, s);
  const stack = B.costStack(b, s);
  assert.strictEqual(a.marginStartPct, B.solve(stack, 'rate', b.pricing.rateCents).marginPct);
  assert.notStrictEqual(a.marginStartPct, 99);
});

test('a bid with no price and no hours reports zeros rather than dividing by them', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'Nobody', title: '', jobType: 'service', dateISO: '2026-09-10' });
  b.labor = { crewIds: [], days: 0, tasks: null };
  b.pricing.rateCents = 0;
  b.job = S.newJob();
  d.bids.push(b);
  const a = B.jobActuals(b, d.settings);
  assert.strictEqual(a.bidHours, 0);
  assert.strictEqual(a.priceCents, 0);
  assert.strictEqual(a.hoursPct, 0);
  assert.strictEqual(a.loadedWageCents, 0);
  assert.strictEqual(a.setAsideCents, 0);
  assert.strictEqual(a.marginStartPct, 0);
  assert.strictEqual(a.marginNowPct, 0);
  // And a week logged against a job that was never priced still reads as work
  // done, not as a division by zero.
  b.job.weeks.push({ weekISO: '2026-09-14', hours: 8 });
  const a2 = B.jobActuals(b, d.settings);
  assert.strictEqual(a2.actualHours, 8);
  assert.strictEqual(a2.hoursPct, 0);
  assert.strictEqual(a2.overrunCents, 0);
});

test('jobActuals reads a bid with no job at all as a job with nothing logged', () => {
  const { b, s } = fixture();
  const withJob = B.jobActuals(b, s);
  b.job = null;
  assert.deepStrictEqual(B.jobActuals(b, s), withJob);
});

// ---------------------------------------------------------------------------
// Weeks are named by their Monday
// ---------------------------------------------------------------------------

test('mondayOf pins a week: every day of one week files under the same Monday', () => {
  ['2026-09-14', '2026-09-16', '2026-09-20'].forEach((iso) => {
    assert.strictEqual(S.mondayOf(iso), '2026-09-14');
  });
  assert.strictEqual(S.mondayOf('2026-09-21'), '2026-09-21');
  assert.strictEqual(S.mondayOf('not a date'), null);
});

test('addDays steps a week backwards and forwards without drifting a day', () => {
  assert.strictEqual(D.addDays('2026-09-14', -7), '2026-09-07');
  assert.strictEqual(D.addDays('2026-11-02', -7), '2026-10-26');   // across the DST change
  assert.strictEqual(D.addDays('2026-12-28', 7), '2027-01-04');
});
