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
// service and 15% on project, and a $65.00 rate on every new bid.
function doc() { return S.emptyData(); }

// A bid with a job on it, priced at the seed rate. days is the labor line's
// days, so real hours are 2 men x days x 8.
function job(d, { customer, title, jobType, days, dateISO, weeks, surprises, completedAt, status }) {
  const b = S.newBid(d, { customerName: customer, title, jobType, dateISO: dateISO || '2026-01-05' });
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
  assert.strictEqual(st.surprises.pct, null);
  assert.strictEqual(st.win.pct, null);
  assert.strictEqual(st.margin.startPct, null);
  assert.strictEqual(st.margin.nowPct, null);
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
  assert.strictEqual(st.hours.actualHours, 40 + 100 + 15);    // 155
  assert.strictEqual(st.hours.pct, 155 / 147 * 100);

  assert.deepStrictEqual(st.byType.service,
    { count: 1, bidHours: 36, actualHours: 40, pct: 40 / 36 * 100 });
  assert.deepStrictEqual(st.byType.project,
    { count: 2, bidHours: 92 + 19, actualHours: 100 + 15, pct: 115 / 111 * 100 });
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
  assert.ok(Number.isFinite(st.margin.nowPct));
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

test('margin is the simple mean of each finished job, start and now', () => {
  const { d, a, b, c } = three();
  const st = B.estimatingStats(d.bids, d.settings);
  const each = [a, b, c].map((x) => B.jobActuals(x, d.settings));

  assert.strictEqual(st.margin.startPct,
    (each[0].marginStartPct + each[1].marginStartPct + each[2].marginStartPct) / 3);
  assert.strictEqual(st.margin.nowPct,
    (each[0].marginNowPct + each[1].marginNowPct + each[2].marginNowPct) / 3);
  // The overruns and the surprises are real, so the mean has to have moved.
  assert.ok(st.margin.nowPct < st.margin.startPct);
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
  assert.strictEqual(st.margin.nowPct, mean);
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
