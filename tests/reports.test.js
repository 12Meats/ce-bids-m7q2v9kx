// tests/reports.test.js — the sentences under the numbers.
//
// Every figure on the Reports screen is checked in stats.test.js. This file
// checks the OTHER half, which is the half that gets believed: the plain
// English underneath each one. A wrong number on that screen looks wrong. A
// wrong sentence looks like advice, and "the cushion covered them" printed
// over a job whose hours ran over is advice to keep bidding the way he has
// been.
//
// So the builders in screens/reports.js are pure functions of plain data and
// nothing else, and the assertions here are the exact strings, character for
// character. reports.js is browser code loaded as globals, so it is evaluated
// in a VM with the handful of globals it touches — the same trick ui.test.js
// and docgen.test.js use.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../dates.js');

const sandbox = {
  console,
  document: undefined,
  BidMath: B,
  // ui.js's fmtDateTime is a one-line wrapper around this one; the last-page
  // row is written in it, so the real thing is loaded rather than a stub.
  Dates: D,
  // ui.js reads MISC_LABEL back off Store at load time: the string lives in
  // storage.js, which loads first and cannot read ui.js.
  Store: S,
  // reports.js registers itself on load; nothing else in it runs at load time.
  registerScreen: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js first: pctText, numText, moneyText, lostReasonLabel and marginOnTrack
// are the vocabulary the sentences are written in, and testing reports.js
// against a stub of them would test the stub.
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'reports.js'), 'utf8'), sandbox, { filename: 'reports.js' });

const {
  reportsOffText, reportsHoursSays, reportsGutSays, reportsSurprisesSays,
  reportsWinSays, reportsMarginSays, reportsMarginMeanSays, reportsGateSays,
  reportsTypeSays, reportsLastPageSays,
} = sandbox;

// ---------------------------------------------------------------------------
// The fixtures the sentences are read off
// ---------------------------------------------------------------------------
//
// Real bids through real BidMath, not hand-written stat objects: a sentence
// that reads perfectly off a shape estimatingStats never produces is a
// sentence nobody will ever see.

// The rate is pinned here rather than taken from the defaults: every sentence
// below quotes dollars, and a change to the shipped default rate must not
// rewrite what these sentences are asserting.
const REPORTS_TEST_RATE = 6500;

function job(d, o) {
  const b = S.newBid(d, { customerName: o.customer, title: o.title, jobType: o.jobType, dateISO: '2026-01-05' });
  b.pricing.rateCents = REPORTS_TEST_RATE;
  b.areas.push({ id: 'a-' + b.number, name: 'Room', items: [
    { catalogId: null, name: 'Wire', unit: 'ft', qty: 100, costCents: 200, priceCents: null } ], photoIds: [] });
  b.labor.days = o.days;
  b.status = 'complete';
  b.job = S.newJob();
  (o.weeks || []).forEach((h, i) => b.job.weeks.push({ weekISO: '2026-02-0' + (i + 2), hours: h }));
  (o.surprises || []).forEach((c) => b.job.surprises.push({ cents: c, note: 'Wall', at: '2026-02-10' }));
  b.job.completedAt = '2026-03-01';
  d.bids.push(b);
  return b;
}

function lost(d, reason, n) {
  const b = S.newBid(d, { customerName: 'Lost ' + n, title: 'Gone', jobType: 'service', dateISO: '2026-01-05' });
  b.pricing.rateCents = REPORTS_TEST_RATE;
  b.status = 'lost';
  b.lostReason = reason;
  d.bids.push(b);
  return b;
}

// Three one-day service jobs: 16 real hrs each, +10% cushion -> 18 bid, and
// $65.00 an hour. worked and surprise are per job.
function threeAlike(worked, surprise) {
  const d = S.emptyData();
  [1, 2, 3].forEach((n) => job(d, { customer: 'C' + n, title: 'J' + n, jobType: 'service',
    days: 1, weeks: [worked], surprises: surprise ? [surprise] : [] }));
  return B.estimatingStats(d.bids, d.settings);
}

// ---------------------------------------------------------------------------
// Over and under
// ---------------------------------------------------------------------------

test('reportsOffText turns a signed percentage into over, under, or dead on', () => {
  assert.strictEqual(reportsOffText(5.4), '5.4% over');
  assert.strictEqual(reportsOffText(-3.3), '3.3% under');
  assert.strictEqual(reportsOffText(0), 'right on the number');
  assert.strictEqual(reportsOffText(null), null);
});

// ---------------------------------------------------------------------------
// Hours: the bid, and the gut behind it
// ---------------------------------------------------------------------------

test('hours over the bid, with a gut that was light', () => {
  // 54 bid, 48 figured, 60 worked. Over the bid AND over the figure.
  const st = threeAlike(20, 0);
  assert.strictEqual(st.hours.bidHours, 54);
  assert.strictEqual(st.hours.realHours, 48);
  assert.strictEqual(st.hours.actualHours, 60);

  assert.strictEqual(reportsHoursSays(st.hours),
    'Over 3 jobs you bid 54 hrs and worked 60. That is 11.1% over.');
  assert.strictEqual(reportsGutSays(st.hours),
    'Before the cushion you figured 48 hrs and worked 60, so your own number was 25% light; '
    + 'the cushion did not cover it.');
});

test('hours under the bid but over the gut: the cushion is what saved it', () => {
  // 54 bid, 48 figured, 51 worked. THE CASE THE OLD SENTENCE HID: he came in
  // under the number the customer saw and still figured the job 6.3% light.
  const st = threeAlike(17, 0);
  assert.strictEqual(reportsHoursSays(st.hours),
    'Over 3 jobs you bid 54 hrs and worked 51. That is 5.6% under.');
  assert.strictEqual(reportsGutSays(st.hours),
    'Before the cushion you figured 48 hrs and worked 51, so your own number was 6.3% light; '
    + 'the cushion covered it.');
});

test('hours under both: a gut that was generous', () => {
  const st = threeAlike(12, 0);   // 54 bid, 48 figured, 36 worked
  assert.strictEqual(reportsHoursSays(st.hours),
    'Over 3 jobs you bid 54 hrs and worked 36. That is 33.3% under.');
  assert.strictEqual(reportsGutSays(st.hours),
    'Before the cushion you figured 48 hrs and worked 36, so your own number was 25% generous; '
    + 'the cushion covered it.');
});

test('worked exactly what he figured', () => {
  const st = threeAlike(16, 0);   // 54 bid, 48 figured, 48 worked
  assert.strictEqual(reportsGutSays(st.hours),
    'Before the cushion you figured 48 hrs and worked 48, so your own number was right; '
    + 'the cushion covered it.');
});

test('no hours bid anywhere is said out loud rather than divided by', () => {
  const d = S.emptyData();
  [1, 2, 3].forEach((n) => job(d, { customer: 'C' + n, title: 'J' + n, jobType: 'service', days: 0, weeks: [] }));
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(reportsHoursSays(st.hours),
    'Over 3 jobs you bid 0 hrs and worked 0. No hours were bid, so there is nothing to compare.');
  assert.strictEqual(reportsGutSays(st.hours), null);
});

test('the per-type line shows all three numbers', () => {
  const st = threeAlike(20, 0);
  assert.strictEqual(reportsTypeSays(st.byType.service), '3 jobs  ·  figured 48, bid 54, worked 60');
  const one = { count: 1, realHours: 36, bidHours: 40, actualHours: 44 };
  assert.strictEqual(reportsTypeSays(one), '1 job  ·  figured 36, bid 40, worked 44');
});

// ---------------------------------------------------------------------------
// Surprises: which cushion, the budgeted one or the real one
// ---------------------------------------------------------------------------

test('covered by the cushion: hours came in under and the leftover paid for them', () => {
  // 18 bid, 15 worked -> 3 unused hrs x $65.00 = $195.00 a job. $50.00 of
  // surprises against $585.00 that really was left over.
  const st = threeAlike(15, 5000);
  assert.strictEqual(st.surprises.coveredBy, 'cushion');
  assert.strictEqual(reportsSurprisesSays(st.surprises),
    'Set aside $390.00, spent $150.00. The unused hours covered them.');
});

test('covered by nothing: the hours ran over, so the cushion money was already spent', () => {
  // THE BUG THIS FILE EXISTS FOR. $390.00 set aside, $150.00 of surprises —
  // 38% of the budget, which the old sentence read as "the cushion covered
  // them". Not one of those dollars survived: every job ran 2 hrs past its
  // bid, so the cushion was paid to the crew.
  const st = threeAlike(20, 5000);
  assert.strictEqual(st.surprises.setAsideCents, 39000);
  assert.strictEqual(st.surprises.unspentCents, 0);
  assert.strictEqual(st.surprises.coveredBy, 'hours');
  assert.strictEqual(reportsSurprisesSays(st.surprises),
    'Set aside $390.00, spent $150.00, but the hours ran over, so that money was already gone.');
});

test('neither: something was left, and it was not enough', () => {
  // 3 unused hrs a job = $585.00 left, against $900.00 of surprises.
  const st = threeAlike(15, 30000);
  assert.strictEqual(st.surprises.coveredBy, 'neither');
  assert.strictEqual(reportsSurprisesSays(st.surprises),
    'Set aside $390.00, spent $900.00. The hours left $585.00 unused, not enough to cover them.');
});

test('nothing came up: no coveredBy branch may speak', () => {
  // THE SECOND BUG. Money was set aside and not one surprise was logged, and
  // every coveredBy verdict is false on that shape: with the hours under, this
  // printed 'the unused hours covered them' over nothing to cover, and with
  // the hours over it would have blamed a cushion nobody spent.
  const under = threeAlike(15, 0);   // 3 unused hrs a job -> 85.00 left over
  assert.strictEqual(under.surprises.surpriseCents, 0);
  assert.strictEqual(under.surprises.coveredBy, 'cushion');
  assert.ok(under.surprises.unspentCents > 0);
  assert.strictEqual(reportsSurprisesSays(under.surprises),
    'Set aside $390.00, and nothing unexpected came up.');

  const over = threeAlike(20, 0);    // 2 hrs past the bid a job -> nothing left
  assert.strictEqual(over.surprises.surpriseCents, 0);
  assert.strictEqual(over.surprises.unspentCents, 0);
  assert.strictEqual(reportsSurprisesSays(over.surprises),
    'Set aside $390.00, and nothing unexpected came up.');
});

test('nothing set aside at all is its own two sentences', () => {
  assert.strictEqual(reportsSurprisesSays({ setAsideCents: 0, surpriseCents: 12000, unspentCents: 0, coveredBy: 'hours' }),
    'Nothing was set aside on these jobs, and surprises came to $120.00.');
  assert.strictEqual(reportsSurprisesSays({ setAsideCents: 0, surpriseCents: 0, unspentCents: 0, coveredBy: 'cushion' }),
    'Nothing set aside, nothing unexpected.');
});

// ---------------------------------------------------------------------------
// Win rate
// ---------------------------------------------------------------------------

test('a clear top reason is named, with its count', () => {
  const d = S.emptyData();
  [1, 2, 3].forEach((n) => job(d, { customer: 'C' + n, title: 'J' + n, jobType: 'service', days: 1, weeks: [16] }));
  lost(d, 'price', 1);
  lost(d, 'price', 2);
  lost(d, 'timing', 3);
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(reportsWinSays(st.win), 'Won 3 of 6 you heard back on. Lost 2 on price.');
});

test('a tie names nothing: the clause is gone, not guessed at', () => {
  const d = S.emptyData();
  [1, 2, 3].forEach((n) => job(d, { customer: 'C' + n, title: 'J' + n, jobType: 'service', days: 1, weeks: [16] }));
  lost(d, 'price', 1);
  lost(d, 'timing', 2);
  const st = B.estimatingStats(d.bids, d.settings);
  assert.strictEqual(reportsWinSays(st.win),
    'Won 3 of 5 you heard back on. No one reason stands out on the ones you lost.');
});

test('nothing lost, and nothing heard', () => {
  const st = threeAlike(16, 0);
  assert.strictEqual(reportsWinSays(st.win), 'Won 3 of 3 you heard back on.');
  assert.strictEqual(reportsWinSays(B.estimatingStats([], S.emptyData().settings).win), 'Nothing won or lost yet.');
});

// ---------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------

test('the margin sentence quotes the dollar-weighted pair and the caption quotes the mean', () => {
  const d = S.emptyData();
  const big = job(d, { customer: 'Big', title: 'Plant line', jobType: 'project', days: 40, weeks: [640, 120] });
  const s1 = job(d, { customer: 'S1', title: 'Call one', jobType: 'service', days: 1, weeks: [12] });
  const s2 = job(d, { customer: 'S2', title: 'Call two', jobType: 'service', days: 1, weeks: [12] });
  [s1, s2].forEach((x) => { x.pricing.rateCents = 20000; });
  const st = B.estimatingStats(d.bids, d.settings);

  // The two readings really do disagree here, which is the whole point of
  // printing both: the money says one thing, the typical job says another.
  assert.ok(st.margin.weightedNowPct < st.margin.meanNowPct - 20);

  const p = (v) => (Math.round(v * 10) / 10) + '%';
  assert.strictEqual(reportsMarginSays(st.margin),
    'Bid at ' + p(st.margin.weightedStartPct) + ', made ' + p(st.margin.weightedNowPct) + '.'
    + ' Surprises and extra hours took the rest.');
  assert.strictEqual(reportsMarginMeanSays(st.margin),
    'Job by job the average was ' + p(st.margin.meanStartPct) + ' → ' + p(st.margin.meanNowPct) + '.');
  // Spelled out, because the gap between these two lines is the finding: the
  // shop made 31.2% on the money and 57.2% on the typical job, and only one of
  // those two numbers is in the bank.
  assert.strictEqual(reportsMarginSays(st.margin),
    'Bid at 39.5%, made 31.2%. Surprises and extra hours took the rest.');
  assert.strictEqual(reportsMarginMeanSays(st.margin), 'Job by job the average was 60.4% → 57.2%.');

  void big;
});

test('a job that came in the way it was sold gets the other half of the sentence', () => {
  const st = threeAlike(12, 0);   // under on hours, nothing unexpected
  assert.ok(st.margin.weightedNowPct >= st.margin.weightedStartPct - 2);
  assert.ok(reportsMarginSays(st.margin).endsWith(' The jobs came in the way you sold them.'),
    reportsMarginSays(st.margin));
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('the gate counts down instead of just refusing', () => {
  assert.strictEqual(reportsGateSays({ needed: 3, completedCount: 2 }),
    'Finish 3 jobs to see estimating stats. 2 done, 1 to go.');
  assert.strictEqual(reportsGateSays({ needed: 3, completedCount: 0 }),
    'Finish 3 jobs to see estimating stats. 0 done, 3 to go.');
});

// ---------------------------------------------------------------------------
// The last page's stamp
// ---------------------------------------------------------------------------

test('the last page says when it was made, and says so when it cannot', () => {
  // Built in local time and read in local time, so the string is the same in
  // Phoenix and in London.
  const at = new Date(2026, 8, 4, 7, 12).getTime();
  assert.strictEqual(reportsLastPageSays(at), 'Made Sep 4, 2026, 7:12 am');
  assert.strictEqual(reportsLastPageSays(new Date(2026, 8, 4, 13, 5).getTime()),
    'Made Sep 4, 2026, 1:05 pm');
  // A page stored before the store's stamp was read back has no time to show.
  assert.strictEqual(reportsLastPageSays(null), 'Last page, no date kept');
  assert.strictEqual(reportsLastPageSays(undefined), 'Last page, no date kept');
  assert.strictEqual(reportsLastPageSays(NaN), 'Last page, no date kept');
});
