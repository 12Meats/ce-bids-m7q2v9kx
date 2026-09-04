const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../dates.js');

// A fixed "today" for every case that doesn't name its own. September 3, 2026
// is a Thursday in a common year, which makes Feb 29 a real rejection.
const TODAY = '2026-09-03';

// ---------------------------------------------------------------------------
// parseTypedDate — what the thumb produces on the number keypad
// ---------------------------------------------------------------------------

test('parseTypedDate: MMDD takes the current year', () => {
  // The keypad drops a leading zero, so 0915 arrives as 915.
  assert.equal(D.parseTypedDate(915, TODAY), '2026-09-15');
  assert.equal(D.parseTypedDate(1220, TODAY), '2026-12-20');
  assert.equal(D.parseTypedDate(1231, TODAY), '2026-12-31');
  // Jan 1 is 245 days behind Sep 3, so it rolls — but it is still Jan 1.
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
  assert.equal(D.parseTypedDate(229, TODAY), null);      // 0229: 2026 is not a leap year
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

test('parseTypedDate: a bare MMDD far behind us rolls forward a year', () => {
  // In December, "115" means the January that is coming, not the one eleven
  // months gone.
  assert.equal(D.parseTypedDate(115, '2026-12-20'), '2027-01-15');
  // The same digits in January mean this January: nothing to roll.
  assert.equal(D.parseTypedDate(115, '2026-01-05'), '2026-01-15');
  // A date just ahead of today is left alone.
  assert.equal(D.parseTypedDate(915, TODAY), '2026-09-15');
  assert.equal(D.parseTypedDate(1225, '2026-12-20'), '2026-12-25');
  // It never rolls backward: six digits are the way to write down last year.
  assert.equal(D.parseTypedDate(1220, '2026-01-05'), '2026-12-20');
});

test('parseTypedDate: the rollover boundary is exactly 180 days behind', () => {
  // 2026-03-07 is 180 days behind 2026-09-03 — not more than, so it stays.
  assert.equal(D.daysSince('2026-03-07', TODAY), 180);
  assert.equal(D.parseTypedDate(307, TODAY), '2026-03-07');
  // One day further back and it belongs to next year.
  assert.equal(D.daysSince('2026-03-06', TODAY), 181);
  assert.equal(D.parseTypedDate(306, TODAY), '2027-03-06');
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
