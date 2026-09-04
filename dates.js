// dates.js — every date decision this app makes, as pure functions. UMD so
// node:test and the browser both load it. No DOM, no storage, no clock: today
// is always passed in, so a test can put the app in December without touching
// the system clock and two runs of the same input always agree.
//
// Dates are stored as ISO 'YYYY-MM-DD' everywhere and never shown that way.
// Parsing works on the string rather than through Date wherever it can, so a
// stored value can't drift a day across a timezone.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // How far behind today a bare MMDD may land before it is read as next year.
  const ROLLOVER_DAYS = 180;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function isISO(s) { return typeof s === 'string' && ISO_RE.test(s); }

  // Both ends read at noon so a DST shift can't round a day count off by one.
  function noon(iso) {
    const dt = new Date(iso + 'T12:00:00');
    return isNaN(dt.getTime()) ? null : dt;
  }

  // fmtDate('2026-09-10') -> 'Sep 10, 2026'. Anything that isn't a valid
  // YYYY-MM-DD comes back as '' rather than "Invalid Date".
  function fmtDate(iso) {
    if (!isISO(iso)) return '';
    const m = Number(iso.slice(5, 7));
    if (m < 1 || m > 12) return '';
    return MONTH_ABBR[m - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4);
  }

  // daysSince(iso, todayISO) -> whole days from that date to today: positive
  // when iso is behind today, negative when it's ahead. null for a missing or
  // invalid date on either side, so a caller can say "never" instead of
  // printing a number it made up.
  function daysSince(iso, todayISO) {
    if (!isISO(iso) || !isISO(todayISO)) return null;
    const then = noon(iso);
    const now = noon(todayISO);
    if (!then || !now) return null;
    return Math.round((now.getTime() - then.getTime()) / 86400000);
  }

  // Builds an ISO date, or null if that day doesn't exist. Feb 30 passes a
  // range check and fails here, which is the point.
  function composeDate(yyyy, mm, dd) {
    const iso = yyyy + '-' + pad2(mm) + '-' + pad2(dd);
    const dt = noon(iso);
    if (!dt || dt.getMonth() + 1 !== mm || dt.getDate() !== dd) return null;
    return iso;
  }

  // parseTypedDate(digits, todayISO) -> ISO or null.
  //
  // The owner types digits on the same keypad as everything else: 915 is
  // September 15, 91526 is September 15, 2026. The keypad drops a leading zero
  // (0915 arrives as the number 915), so the digits are padded back out to 4
  // or 6 before they are read.
  //
  // A bare MMDD takes the current year, and rolls FORWARD a year when that
  // would land more than half a year behind us: in December, "115" means next
  // January, not the one eleven months gone. It never rolls backward, so a
  // typed MMDD is always today or ahead of it — which is what a bid date
  // almost always is. Six typed digits are never second-guessed: he named the
  // year, and that is how you write down a date in the past.
  function parseTypedDate(digits, todayISO) {
    if (typeof digits !== 'number' || !isFinite(digits) || digits < 0) return null;
    if (Math.round(digits) !== digits) return null;
    if (!isISO(todayISO)) return null;

    let text = String(digits);
    if (text.length === 3 || text.length === 4) text = text.padStart(4, '0');
    else if (text.length === 5 || text.length === 6) text = text.padStart(6, '0');
    else return null;

    const mm = Number(text.slice(0, 2));
    const dd = Number(text.slice(2, 4));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    if (text.length === 6) return composeDate(2000 + Number(text.slice(4, 6)), mm, dd);

    const thisYear = Number(todayISO.slice(0, 4));
    const iso = composeDate(thisYear, mm, dd);
    // A day that doesn't exist this year (Feb 29 in a common year) is a typo,
    // not an instruction to go hunting through other years for one where it
    // does.
    if (!iso) return null;

    const behind = daysSince(iso, todayISO);
    if (behind !== null && behind > ROLLOVER_DAYS) return composeDate(thisYear + 1, mm, dd);
    return iso;
  }

  // The bids that went out and never came back: sent, still sitting at 'sent',
  // and older than the nudge window. This is the whole reason the app exists —
  // a proposal nobody followed up on is money left on a table in a dairy plant.
  // Strictly older than `days`: at exactly fourteen it is not yet late.
  function sentNoAnswer(bids, todayISO, days) {
    const limit = typeof days === 'number' ? days : ROLLOVER_DAYS;
    return (bids || []).filter((b) => {
      if (!b || b.status !== 'sent' || !b.sentAt) return false;
      const age = daysSince(b.sentAt, todayISO);
      return age !== null && age > limit;
    });
  }

  // Newest first: by date, then by number so two bids walked the same day still
  // have a stable order with the most recent one on top.
  function bidsSortCompare(a, b) {
    if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? 1 : -1;
    return b.number - a.number;
  }

  return { ROLLOVER_DAYS, fmtDate, daysSince, composeDate, parseTypedDate, sentNoAnswer, bidsSortCompare };
});
