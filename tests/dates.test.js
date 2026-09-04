const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../dates.js');

// A fixed "today" for every case that doesn't name its own. September 3, 2026
// is a Thursday in a common year, which makes Feb 29 a real rejection.
const TODAY = '2026-09-03';

// ---------------------------------------------------------------------------
// parseTypedDate — what the thumb produces on the number keypad
// ---------------------------------------------------------------------------

test('parseTypedDate: MMDD means the nearest such day', () => {
  // The keypad drops a leading zero, so 0915 arrives as 915.
  assert.equal(D.parseTypedDate(915, TODAY), '2026-09-15');
  assert.equal(D.parseTypedDate(1220, TODAY), '2026-12-20');
  assert.equal(D.parseTypedDate(1231, TODAY), '2026-12-31');
  // Jan 1 is 245 days behind Sep 3 but only 120 ahead, so it reads as the
  // coming one — and either way it is still Jan 1.
  assert.equal(D.parseTypedDate(101, TODAY), '2027-01-01');
  assert.equal(D.parseTypedDate(101, TODAY).slice(5), '01-01');
});

test('parseTypedDate: MMDDYY is taken at its word', () => {
  assert.equal(D.parseTypedDate(91526, TODAY), '2026-09-15');
  assert.equal(D.parseTypedDate(120126, TODAY), '2026-12-01');
  // A six-digit date is never second-guessed: this is how you write down a
  // date in the past, and 2024 was a leap year.
  assert.equal(D.parseTypedDate(22924, TODAY), '2024-02-29');
  assert.equal(D.parseTypedDate(10125, TODAY), '2025-01-01');
});

test('parseTypedDate: rejects anything that is not a real day', () => {
  assert.equal(D.parseTypedDate(0, TODAY), null);        // one digit
  assert.equal(D.parseTypedDate(12, TODAY), null);       // two digits
  assert.equal(D.parseTypedDate(1301, TODAY), null);     // month 13
  assert.equal(D.parseTypedDate(1131, TODAY), null);     // November has 30
  assert.equal(D.parseTypedDate(231, TODAY), null);      // 0231: February has no 31st
  assert.equal(D.parseTypedDate(229, TODAY), null);      // 0229: no leap year in reach
  assert.equal(D.parseTypedDate(1234567, TODAY), null);  // seven digits
  assert.equal(D.parseTypedDate(1000, TODAY), null);     // month 10, day 0
});

test('parseTypedDate: refuses non-integers, negatives and a bad today', () => {
  assert.equal(D.parseTypedDate(915.5, TODAY), null);
  assert.equal(D.parseTypedDate(-915, TODAY), null);
  assert.equal(D.parseTypedDate(NaN, TODAY), null);
  assert.equal(D.parseTypedDate('915', TODAY), null);
  assert.equal(D.parseTypedDate(915, 'not a date'), null);
});

test('parseTypedDate: the nearest year wins, forwards or backwards', () => {
  // In December, "115" means the January that is coming, not the one eleven
  // months gone.
  assert.equal(D.parseTypedDate(115, '2026-12-20'), '2027-01-15');
  // And in January, "1230" means the December just past — the reading the old
  // forward-only rule got wrong, sending a back-dated bid eleven months out.
  assert.equal(D.parseTypedDate(1230, '2026-01-10'), '2025-12-30');
  assert.equal(D.parseTypedDate(1220, '2026-01-05'), '2025-12-20');
  // Dates near today are left where they are, either side of it.
  assert.equal(D.parseTypedDate(115, '2026-01-05'), '2026-01-15');
  assert.equal(D.parseTypedDate(915, TODAY), '2026-09-15');
  assert.equal(D.parseTypedDate(1225, '2026-12-20'), '2026-12-25');
});

test('parseTypedDate: Feb 29 finds the only year that has one', () => {
  // Typed in March 2027: neither 2026 nor 2027 has a Feb 29, so the 2028 one
  // is the only day those digits can mean.
  assert.equal(D.parseTypedDate(229, '2027-03-01'), '2028-02-29');
  // Typed in 2026, none of 2025/2026/2027 has one, so it stays a typo.
  assert.equal(D.parseTypedDate(229, TODAY), null);
  // Six digits are still taken at their word, leap year or not.
  assert.equal(D.parseTypedDate(22924, TODAY), '2024-02-29');
  assert.equal(D.parseTypedDate(22926, TODAY), null);
});

test('parseTypedDate: the boundary sits where the two gaps cross', () => {
  // 2026-03-05 is 182 days behind Sep 3; its 2027 copy is 183 ahead. Behind
  // is nearer, so behind wins.
  assert.equal(D.daysSince('2026-03-05', TODAY), 182);
  assert.equal(D.daysSince('2027-03-05', TODAY), -183);
  assert.equal(D.parseTypedDate(305, TODAY), '2026-03-05');
  // One day earlier and the gaps swap: 183 behind, only 182 ahead.
  assert.equal(D.daysSince('2026-03-04', TODAY), 183);
  assert.equal(D.daysSince('2027-03-04', TODAY), -182);
  assert.equal(D.parseTypedDate(304, TODAY), '2027-03-04');
});

test('parseTypedDate: an exact tie goes to the earlier date', () => {
  // A tie needs the two gaps to sum to 366, so it only happens across a leap
  // day: on 2027-08-31, "301" is 183 days from March 2027 and 183 from March
  // 2028. The bid he already walked beats the one he is guessing at.
  assert.equal(D.daysSince('2027-03-01', '2027-08-31'), 183);
  assert.equal(D.daysSince('2028-03-01', '2027-08-31'), -183);
  assert.equal(D.parseTypedDate(301, '2027-08-31'), '2027-03-01');
});

// ---------------------------------------------------------------------------
// fmtDate
// ---------------------------------------------------------------------------

test('fmtDate prints the way the owner reads a date', () => {
  assert.equal(D.fmtDate('2026-09-10'), 'Sep 10, 2026');
  assert.equal(D.fmtDate('2026-01-01'), 'Jan 1, 2026');
  assert.equal(D.fmtDate('2026-12-31'), 'Dec 31, 2026');
  // Never "Invalid Date" in front of a customer.
  assert.equal(D.fmtDate('2026-13-01'), '');
  assert.equal(D.fmtDate('nonsense'), '');
  assert.equal(D.fmtDate(null), '');
});

// ---------------------------------------------------------------------------
// daysSince
// ---------------------------------------------------------------------------

test('daysSince counts whole days, and says null when it cannot', () => {
  assert.equal(D.daysSince(TODAY, TODAY), 0);
  assert.equal(D.daysSince('2026-08-20', TODAY), 14);
  assert.equal(D.daysSince('2026-08-19', TODAY), 15);
  // Ahead of today reads negative rather than clamping to zero.
  assert.equal(D.daysSince('2026-09-13', TODAY), -10);
  assert.equal(D.daysSince(null, TODAY), null);
  assert.equal(D.daysSince('2026-08-19', null), null);
});

// ---------------------------------------------------------------------------
// sentNoAnswer
// ---------------------------------------------------------------------------

function bid(over) {
  return Object.assign({ id: 'b', number: 1, dateISO: TODAY, status: 'sent', sentAt: null }, over);
}

test('sentNoAnswer: strictly older than the window', () => {
  const atFourteen = bid({ id: 'a', sentAt: '2026-08-20' });   // exactly 14 days
  const atFifteen = bid({ id: 'b', sentAt: '2026-08-19' });    // 15 days
  const found = D.sentNoAnswer([atFourteen, atFifteen], TODAY, 14);
  assert.deepEqual(found.map((b) => b.id), ['b']);
});

test('sentNoAnswer: only bids still sitting at sent, with a date on them', () => {
  const old = '2026-07-01';
  const bids = [
    bid({ id: 'sent', sentAt: old }),
    bid({ id: 'won', status: 'won', sentAt: old }),
    bid({ id: 'lost', status: 'lost', sentAt: old }),
    bid({ id: 'draft', status: 'draft', sentAt: null }),
    bid({ id: 'nodate', sentAt: null }),
  ];
  assert.deepEqual(D.sentNoAnswer(bids, TODAY, 14).map((b) => b.id), ['sent']);
  assert.deepEqual(D.sentNoAnswer([], TODAY, 14), []);
  assert.deepEqual(D.sentNoAnswer(null, TODAY, 14), []);
});

// ---------------------------------------------------------------------------
// bidsSortCompare
// ---------------------------------------------------------------------------

test('bidsSortCompare puts the newest first, breaking ties by number', () => {
  const rows = [
    { number: 3, dateISO: '2026-08-01' },
    { number: 9, dateISO: '2026-09-01' },
    { number: 4, dateISO: '2026-09-01' },
    { number: 11, dateISO: '2026-07-15' },
  ];
  const sorted = rows.slice().sort(D.bidsSortCompare);
  assert.deepEqual(sorted.map((r) => r.number), [9, 4, 3, 11]);
  // Equal dates: higher number first, and comparing a row with itself is 0.
  assert.ok(D.bidsSortCompare({ number: 4, dateISO: 'x' }, { number: 9, dateISO: 'x' }) > 0);
  assert.equal(D.bidsSortCompare({ number: 4, dateISO: 'x' }, { number: 4, dateISO: 'x' }), 0);
});
