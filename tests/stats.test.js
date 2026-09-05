// tests/stats.test.js — the ten-jobs reading behind the Reports screen.
//
// estimatingStats is what tells him whether he underbids, so the numbers here
// are worked out by hand from the fixture rather than read back out of the
// function under test. Hours and set-asides are integers off the labor lines;
// the margins are the mean of what jobActuals says about each job, which is
// the definition the screen prints.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');
const B = require('../bidmath.js');

// Seed settings: two men at $32.00 and $30.00, 8-hour days, cushion 10% on
// service and 15% on project.
function doc() { return S.emptyData(); }

// The rate every fixture bid below is sold at. Pinned here rather than taken
// from the shipped default, because every dollar figure in this file is worked
// out by hand against it: moving the default rate must not silently rewrite
// what these tests are asserting.
const STATS_TEST_RATE = 6500;

// A bid with a job on it, priced at STATS_TEST_RATE. days is the labor line's
// days, so real hours are 2 men x days x 8.
function job(d, { customer, title, jobType, days, dateISO, weeks, surprises, completedAt, status }) {
  const b = S.newBid(d, { customerName: customer, title, jobType, dateISO: dateISO || '2026-01-05' });
  b.pricing.rateCents = STATS_TEST_RATE;
  b.areas.push({ id: 'a-' + b.number, name: 'Room', items: [
    { catalogId: null, name: 'Wire', unit: 'ft', qty: 100, costCents: 200, priceCents: null } ], photoIds: [] });
  b.labor.days = days;
  b.status = status || 'complete';
  b.job = S.newJob();
  (weeks || []).forEach((h, i) => b.job.weeks.push({ weekISO: '2026-02-0' + (i + 2), hours: h }));
  (surprises || []).forEach((c) => b.job.surprises.push({ cents: c, note: 'Wall', at: '2026-02-10' }));
  b.job.completedAt = completedAt || '2026-03-01';
  d.bids.push(b);
  return b;
}

function lost(d, reason, n) {
  const b = S.newBid(d, { customerName: 'Lost ' + n, title: 'Gone', jobType: 'service', dateISO: '2026-01-05' });
  b.pricing.rateCents = STATS_TEST_RATE;
  b.status = 'lost';
  b.lostReason = reason;
  d.bids.push(b);
  return b;
}

// Three finished jobs, mixed types, hand-checkable hours:
//
//   A  service  2 days -> 32 real hrs, +10% cushion -> ceil(35.2) = 36 bid
//                worked 40, $300.00 of surprises, set aside (36-32) x $65 = $260.00
//   B  project  5 days -> 80 real hrs, +15% cushion -> ceil(92)   = 92 bid
//                worked 100, no surprises,      set aside (92-80) x $65 = $780.00
//   C  project  1 day  -> 16 real hrs, +15% cushion -> ceil(18.4) = 19 bid
//                worked 15,  $50.00 of surprises,  set aside (19-16) x $65 = $195.00
function three() {
  const d = doc();
  const a = job(d, { customer: 'UDA', title: 'Panel swap', jobType: 'service', days: 2,
    weeks: [40], surprises: [30000], completedAt: '2026-03-01' });
  const b = job(d, { customer: 'Shamrock', title: 'New line', jobType: 'project', days: 5,
    weeks: [60, 40], surprises: [], completedAt: '2026-03-05' });
  const c = job(d, { customer: 'Fairlife', title: 'Pump feed', jobType: 'project', days: 1,
    weeks: [15], surprises: [5000], completedAt: '2026-02-20' });
  return { d, a, b, c };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('under three completed jobs it is not ready, and says how many there are', () => {
  const d = doc();
  job(d, { customer: 'UDA', title: 'One', jobType: 'service', days: 2, weeks: [30] });
  job(d, { customer: 'UDA', title: 'Two', jobType: 'service', days: 2, weeks: [30] });
  // A won job that is still running is not a finished job.
  job(d, { customer: 'UDA', title: 'Running', jobType: 'service', days: 2, weeks: [10], status: 'won' });

  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.ready, false);
  assert.strictEqual(st.completedCount, 2);
  assert.strictEqual(st.needed, 3);
  assert.strictEqual(st.jobs.length, 2);
});

test('no bids at all is not ready and divides by nothing', () => {
  const st = B.estimatingStats([], doc().settings);
  assert.strictEqual(st.ready, false);
  assert.strictEqual(st.completedCount, 0);
  assert.strictEqual(st.hours.pct, null);
  assert.strictEqual(st.hours.offBidPct, null);
  assert.strictEqual(st.hours.offRealPct, null);
  assert.strictEqual(st.surprises.pct, null);
  assert.strictEqual(st.surprises.unspentCents, 0);
  assert.strictEqual(st.win.pct, null);
  assert.strictEqual(st.margin.meanStartPct, null);
  assert.strictEqual(st.margin.meanNowPct, null);
  assert.strictEqual(st.margin.weightedStartPct, null);
  assert.strictEqual(st.margin.weightedNowPct, null);
});

test('exactly three completed jobs is ready', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.ready, true);
  assert.strictEqual(st.completedCount, 3);
});

// ---------------------------------------------------------------------------
// Hours, overall and by job type
// ---------------------------------------------------------------------------

test('hours are the sums of the jobs, overall and per job type', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);

  assert.strictEqual(st.hours.count, 3);
  assert.strictEqual(st.hours.bidHours, 36 + 92 + 19);        // 147
  assert.strictEqual(st.hours.realHours, 32 + 80 + 16);       // 128, before any cushion
  assert.strictEqual(st.hours.actualHours, 40 + 100 + 15);    // 155
  assert.strictEqual(st.hours.pct, 155 / 147 * 100);

  assert.deepStrictEqual(st.byType.service,
    { count: 1, bidHours: 36, realHours: 32, actualHours: 40, pct: 40 / 36 * 100, offBidPct: 11.1, offRealPct: 25 });
  assert.deepStrictEqual(st.byType.project,
    { count: 2, bidHours: 92 + 19, realHours: 80 + 16, actualHours: 100 + 15,
      pct: 115 / 111 * 100, offBidPct: 3.6, offRealPct: 19.8 });
});

// The two readings the sentence has to tell apart. 155 against the 147 he
// QUOTED is 5.4% over; 155 against the 128 he FIGURED is 21.1% over. A shop
// told only the first number never learns that its estimates are a fifth
// light and its cushion has been quietly carrying them.
test('hours are off the bid and off the pre-cushion figure, signed, one decimal', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);

  // 155 / 147 = 1.05442…  ->  +5.4
  assert.strictEqual(st.hours.offBidPct, 5.4);
  // 155 / 128 = 1.21093…  ->  +21.1
  assert.strictEqual(st.hours.offRealPct, 21.1);
});

test('under the bid is a negative, and dead on is exactly zero', () => {
  const d = doc();
  // 1 day, 2 men -> 16 real hrs, +10% -> ceil(17.6) = 18 bid.
  job(d, { customer: 'A', title: 'One', jobType: 'service', days: 1, weeks: [10] });
  job(d, { customer: 'B', title: 'Two', jobType: 'service', days: 1, weeks: [10] });
  job(d, { customer: 'C', title: 'Three', jobType: 'service', days: 1, weeks: [10] });
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.hours.bidHours, 54);
  assert.strictEqual(st.hours.realHours, 48);
  assert.strictEqual(st.hours.actualHours, 30);
  assert.strictEqual(st.hours.offBidPct, -44.4);      // 30 / 54 = 0.5555…
  assert.strictEqual(st.hours.offRealPct, -37.5);     // 30 / 48 = 0.625

  // Worked exactly the hours he figured: 0, not -0 and not a rounding crumb.
  const e = doc();
  [1, 2, 3].forEach((n) => job(e, { customer: 'X', title: 'J' + n, jobType: 'service', days: 1, weeks: [16] }));
  const est = B.estimatingStats(e.bids, e.settings);
  assert.strictEqual(est.hours.offRealPct, 0);
  assert.strictEqual(est.hours.offBidPct, -11.1);     // 48 / 54
});

test('a job with no hours on it drags nothing into a divide by zero', () => {
  const d = doc();
  job(d, { customer: 'UDA', title: 'Materials only', jobType: 'project', days: 0, weeks: [] });
  job(d, { customer: 'UDA', title: 'Two', jobType: 'service', days: 2, weeks: [30] });
  job(d, { customer: 'UDA', title: 'Three', jobType: 'service', days: 2, weeks: [36] });

  const st = B.estimatingStats(d.bids, d.settings);
  // The empty one adds nothing to either total: 0 bid, 0 worked.
  assert.strictEqual(st.hours.bidHours, 36 + 36);
  assert.strictEqual(st.hours.actualHours, 30 + 36);
  assert.strictEqual(st.hours.pct, 66 / 72 * 100);
  // Its whole job type has no hours in it, so that type has no percentage —
  // null, not 0 and not Infinity.
  assert.strictEqual(st.byType.project.count, 1);
  assert.strictEqual(st.byType.project.bidHours, 0);
  assert.strictEqual(st.byType.project.pct, null);
  assert.strictEqual(st.byType.project.offBidPct, null);
  assert.strictEqual(st.byType.project.offRealPct, null);
  assert.ok(Number.isFinite(st.margin.meanNowPct));
});

// ---------------------------------------------------------------------------
// Surprises against the set-aside
// ---------------------------------------------------------------------------

test('surprises are measured against the cushion they were meant to come out of', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  const setAside = 26000 + 78000 + 19500;      // (4 + 12 + 3) hrs x $65.00
  assert.strictEqual(st.surprises.setAsideCents, setAside);
  assert.strictEqual(st.surprises.surpriseCents, 30000 + 5000);
  assert.strictEqual(st.surprises.pct, 35000 / setAside * 100);
});

// ---------------------------------------------------------------------------
// The cushion that exists versus the cushion that was budgeted
// ---------------------------------------------------------------------------
//
// setAside is a PLAN. The only money a surprise can actually come out of is
// hours that were quoted and never worked, at the rate that job was sold at —
// so a job that ran over its bid hours contributes nothing to it, however
// generous its cushion looked on paper.

test('unspent hours are counted per job, at that job own rate, and never go negative', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  // A worked 40 against 36 bid and B 100 against 92: both over, nothing left.
  // Only C came in under, by 19 - 15 = 4 hrs at $65.00.
  assert.strictEqual(st.surprises.unspentCents, 4 * 6500);      // $260.00
  assert.strictEqual(st.surprises.setAsideCents, 123500);        // the budget said $1,235.00
});

test('a mixed-rate shop values each job unused hours at its own rate', () => {
  const d = doc();
  // Three jobs, 1 day each -> 16 real, 18 bid, 12 worked: 6 unused hours each.
  const a = job(d, { customer: 'A', title: 'One', jobType: 'service', days: 1, weeks: [12] });
  const b = job(d, { customer: 'B', title: 'Two', jobType: 'service', days: 1, weeks: [12] });
  job(d, { customer: 'C', title: 'Three', jobType: 'service', days: 1, weeks: [12] });
  a.pricing.rateCents = 10000;   // $100.00
  b.pricing.rateCents = 8000;    // $80.00
  const st = B.estimatingStats(d.bids, d.settings);
  // 6 x $100 + 6 x $80 + 6 x $65 (the fixture rate), not 18 hours at any one of them.
  assert.strictEqual(st.surprises.unspentCents, 6 * 10000 + 6 * 8000 + 6 * 6500);
});

test('coveredBy: the unused hours were worth more than the surprises', () => {
  const d = doc();
  // 18 bid, 15 worked -> 3 unused hrs x $65.00 = $195.00 a job, $585.00 in all.
  [1, 2, 3].forEach((n) => {
    const b = job(d, { customer: 'C' + n, title: 'J' + n, jobType: 'service', days: 1, weeks: [15] });
    b.job.surprises.push({ cents: 5000, note: 'Bit', at: '2026-02-10' });
  });
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.surprises.unspentCents, 3 * 19500);
  assert.strictEqual(st.surprises.surpriseCents, 15000);
  assert.strictEqual(st.surprises.coveredBy, 'cushion');
});

test('coveredBy: the hours ran over, so the cushion money was already spent', () => {
  const d = doc();
  // 18 bid, 20 worked on every job: nothing was left unused anywhere, so the
  // $390.00 the budget set aside was paid to the crew, not held for surprises.
  [1, 2, 3].forEach((n) => {
    const b = job(d, { customer: 'H' + n, title: 'J' + n, jobType: 'service', days: 1, weeks: [20] });
    b.job.surprises.push({ cents: 5000, note: 'Bit', at: '2026-02-10' });
  });
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.surprises.setAsideCents, 3 * 13000);   // the plan said $390.00
  assert.strictEqual(st.surprises.unspentCents, 0);            // and none of it survived
  assert.strictEqual(st.surprises.surpriseCents, 15000);
  assert.strictEqual(st.surprises.coveredBy, 'hours');
});

test('coveredBy: something was left, but not enough', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.surprises.unspentCents, 26000);
  assert.strictEqual(st.surprises.surpriseCents, 35000);
  assert.strictEqual(st.surprises.coveredBy, 'neither');
});

test('nothing set aside is no percentage rather than an infinite one', () => {
  const d = doc();
  // cushionPct 0 on whole-hour labor: bid hours are the real hours exactly.
  [1, 2, 3].forEach((n) => {
    const b = job(d, { customer: 'UDA', title: 'Job ' + n, jobType: 'service', days: 1, weeks: [16] });
    b.pricing.cushionPct = 0;
    b.job.surprises.push({ cents: 12000, note: 'Bit', at: '2026-02-10' });
  });
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.surprises.setAsideCents, 0);
  assert.strictEqual(st.surprises.surpriseCents, 36000);
  assert.strictEqual(st.surprises.pct, null);
});

// ---------------------------------------------------------------------------
// Win rate
// ---------------------------------------------------------------------------

test('won counts finished and running jobs; lost bids are counted by reason', () => {
  const { d } = three();
  job(d, { customer: 'Hickman', title: 'Running', jobType: 'service', days: 1, weeks: [8], status: 'won' });
  lost(d, 'price', 1);
  lost(d, 'price', 2);
  lost(d, 'timing', 3);
  lost(d, 'other', 4);
  lost(d, 'silence', 5);
  // Drafts and sent bids are not answers yet and must not move the rate.
  d.bids.push(S.newBid(d, { customerName: 'Nobody', title: 'Draft', jobType: 'service', dateISO: '2026-01-05' }));
  const sent = S.newBid(d, { customerName: 'Nobody', title: 'Out', jobType: 'service', dateISO: '2026-01-05' });
  sent.status = 'sent';
  d.bids.push(sent);

  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.win.won, 4);            // 3 complete + 1 won
  assert.strictEqual(st.win.lost, 5);
  assert.strictEqual(st.win.heard, 9);
  assert.strictEqual(st.win.pct, 4 / 9 * 100);
  assert.deepStrictEqual(st.win.reasons, { none: 0, price: 2, timing: 1, other: 1, silence: 1 });
  assert.strictEqual(st.win.topReason, 'price');
});

test('a lost bid with no reason on it is counted, not dropped', () => {
  const { d } = three();
  lost(d, null, 1);
  lost(d, 'timing', 2);
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.win.lost, 2);
  assert.strictEqual(st.win.reasons.none, 1);
  assert.strictEqual(st.win.reasons.timing, 1);
  assert.strictEqual(st.win.topReason, 'timing');
});

// A tie is not an answer. "You lose on price" drawn off one price loss against
// one timing loss is a sentence that sends him to cut his rate over nothing,
// so the reason is null and the screen's clause disappears.
test('a tie for the top lost reason is no top reason at all', () => {
  const { d } = three();
  lost(d, 'price', 1);
  lost(d, 'timing', 2);
  lost(d, 'other', 3);
  lost(d, 'silence', 4);
  const st = B.estimatingStats(d.bids, d.settings);
  assert.deepStrictEqual(st.win.reasons, { none: 0, price: 1, timing: 1, other: 1, silence: 1 });
  assert.strictEqual(st.win.topReason, null);

  // One more on price breaks the tie and the reason comes back.
  lost(d, 'price', 5);
  assert.strictEqual(B.estimatingStats(d.bids, d.settings).win.topReason, 'price');
});

test('a two-way tie above the others is still a tie', () => {
  const { d } = three();
  lost(d, 'price', 1);
  lost(d, 'price', 2);
  lost(d, 'timing', 3);
  lost(d, 'timing', 4);
  lost(d, 'other', 5);
  assert.strictEqual(B.estimatingStats(d.bids, d.settings).win.topReason, null);
});

test('never having lost a bid is a 100% win rate and no top reason', () => {
  const { d } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.win.lost, 0);
  assert.strictEqual(st.win.pct, 100);
  assert.strictEqual(st.win.topReason, null);
});

// ---------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------

test('the mean margin is the simple mean of each finished job, start and now', () => {
  const { d, a, b, c } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  const each = [a, b, c].map((x) => B.jobActuals(x, d.settings));

  assert.strictEqual(st.margin.meanStartPct,
    (each[0].marginStartPct + each[1].marginStartPct + each[2].marginStartPct) / 3);
  assert.strictEqual(st.margin.meanNowPct,
    (each[0].marginNowPct + each[1].marginNowPct + each[2].marginNowPct) / 3);
  // The overruns and the surprises are real, so the mean has to have moved.
  assert.ok(st.margin.meanNowPct < st.margin.meanStartPct);
});

test('the margin mean is unweighted: a big job does not count for more', () => {
  const d = doc();
  const small = job(d, { customer: 'A', title: 'Small', jobType: 'service', days: 1, weeks: [16] });
  const big = job(d, { customer: 'B', title: 'Big', jobType: 'project', days: 20, weeks: [320] });
  const third = job(d, { customer: 'C', title: 'Third', jobType: 'service', days: 1, weeks: [16] });
  const st = B.estimatingStats(d.bids, d.settings);
  const mean = [small, big, third]
    .map((x) => B.jobActuals(x, d.settings).marginNowPct)
    .reduce((s, v) => s + v, 0) / 3;
  assert.strictEqual(st.margin.meanNowPct, mean);
});

// The weighted pair is all the money in against all the money out, which is
// the only margin the bank ever sees. It is the one the screen headlines,
// because the mean of the percentages is a number about the typical JOB and a
// shop whose big jobs are thin does not get to spend the typical job.
test('the weighted margin is total price against total cost, not an average of percentages', () => {
  const { d, a, b, c } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  const each = [a, b, c].map((x) => B.jobActuals(x, d.settings));
  const price = each.reduce((s, x) => s + x.priceCents, 0);
  const trueCost = each.reduce((s, x) => s + x.trueCostCents, 0);
  const actualCost = each.reduce((s, x) => s + x.actualCostCents, 0);

  assert.strictEqual(st.margin.weightedStartPct, (price - trueCost) / price * 100);
  assert.strictEqual(st.margin.weightedNowPct, (price - actualCost) / price * 100);
});

test('a big thin job pulls the weighted margin away from the mean', () => {
  const d = doc();
  // One $90k-shaped project sold at the seed rate and run over, against two
  // one-day service calls sold at $200.00 an hour and finished under.
  const big = job(d, { customer: 'Big', title: 'Plant line', jobType: 'project', days: 40, weeks: [640, 120] });
  const s1 = job(d, { customer: 'S1', title: 'Call one', jobType: 'service', days: 1, weeks: [12] });
  const s2 = job(d, { customer: 'S2', title: 'Call two', jobType: 'service', days: 1, weeks: [12] });
  [s1, s2].forEach((x) => { x.pricing.rateCents = 20000; });

  const st = B.estimatingStats(d.bids, d.settings);
  const each = [big, s1, s2].map((x) => B.jobActuals(x, d.settings));
  const price = each.reduce((s, x) => s + x.priceCents, 0);
  const actualCost = each.reduce((s, x) => s + x.actualCostCents, 0);

  assert.strictEqual(st.margin.weightedNowPct, (price - actualCost) / price * 100);
  // The big job is most of the money, so the weighted figure sits near ITS
  // margin while the mean is dragged up by two small fat ones.
  assert.ok(st.margin.weightedNowPct < st.margin.meanNowPct - 5,
    'weighted ' + st.margin.weightedNowPct + ' should be well under the mean ' + st.margin.meanNowPct);
  assert.ok(Math.abs(st.margin.weightedNowPct - each[0].marginNowPct)
    < Math.abs(st.margin.weightedNowPct - each[1].marginNowPct),
  'weighted ' + st.margin.weightedNowPct + ' should sit nearer the big job ' + each[0].marginNowPct
    + ' than the small one ' + each[1].marginNowPct);
});

// ---------------------------------------------------------------------------
// The list behind the averages
// ---------------------------------------------------------------------------

test('the completed jobs come back newest first, each with its own actuals', () => {
  const { d, a, b, c } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  assert.deepStrictEqual(st.jobs.map((j) => j.bid.id), [b.id, a.id, c.id]);   // 03-05, 03-01, 02-20
  assert.deepStrictEqual(st.jobs[1].actuals, B.jobActuals(a, d.settings));
});

test('a completed bid with no completion date still sorts, on its own date', () => {
  const { d, a } = three();
  a.job.completedAt = null;
  a.dateISO = '2026-06-30';
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(st.jobs[0].bid.id, a.id);
  assert.strictEqual(st.completedCount, 3);
});
