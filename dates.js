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

  // How long a proposal may sit unanswered before the home screen says so.
  const DEFAULT_NUDGE_DAYS = 14;

  // The years a bare MMDD could mean, relative to the year it is typed in.
  const MMDD_YEAR_OFFSETS = [-1, 0, 1];

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
  // A bare MMDD means the nearest one: the same month and day is built in last
  // year, this year and next, and whichever lands closest to today wins. In
  // December, "115" is next January, not the one eleven months gone; in
  // January, "1230" is the December just past, not the one still eleven months
  // out. Both readings are a few days away and the other is most of a year
  // away, so "nearest" says what a person means without a rule about which
  // direction time runs.
  //
  // Only calendar-real candidates are considered, which is what makes Feb 29
  // work: type it in March 2027 and 2026 and 2027 have no such day, so the
  // 2028 one is the only thing it can mean.
  //
  // Ties — possible only across a leap day, where the two gaps sum to 366 —
  // go to the earlier date, on the grounds that a bid he already walked is
  // more real than one he is guessing at. Six typed digits are never
  // second-guessed: he named the year.
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
    let best = null;
    let bestGap = null;
    // Oldest year first, and a strict < below, so an exact tie keeps the
    // earlier date without needing a second comparison to say so.
    MMDD_YEAR_OFFSETS.forEach((offset) => {
      const iso = composeDate(thisYear + offset, mm, dd);
      if (!iso) return;
      const gap = daysSince(iso, todayISO);
      if (gap === null) return;
      const distance = Math.abs(gap);
      if (bestGap === null || distance < bestGap) { best = iso; bestGap = distance; }
    });
    return best;
  }

  // The bids that went out and never came back: sent, still sitting at 'sent',
  // and older than the nudge window. This is the whole reason the app exists —
  // a proposal nobody followed up on is money left on a table in a dairy plant.
  // Strictly older than `days`: at exactly fourteen it is not yet late.
  function sentNoAnswer(bids, todayISO, days) {
    const limit = typeof days === 'number' ? days : DEFAULT_NUDGE_DAYS;
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

  return { DEFAULT_NUDGE_DAYS, fmtDate, daysSince, composeDate, parseTypedDate, sentNoAnswer, bidsSortCompare };
});
