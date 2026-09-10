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
  // Spelled out, for the one place with room for it: the heading over a month
  // of the calendar.
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

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

  // fmtDateShort('2026-09-04') -> '9/4/26'. The home list only, and it exists
  // for one reason: that row carries a price, a status, a date and a number on
  // one line, and on a 375px phone 'Sep 4, 2026' is the 78 pixels that makes
  // the row wrap in two. Of the four it is the one that can be said shorter
  // without losing anything — he is placing a bid in time, not reading a
  // contract date, and 9/4/26 is how he writes it on a job ticket anyway.
  // Everywhere a date is read on its own, fmtDate stays.
  function fmtDateShort(iso) {
    if (!isISO(iso)) return '';
    const m = Number(iso.slice(5, 7));
    if (m < 1 || m > 12) return '';
    return m + '/' + Number(iso.slice(8, 10)) + '/' + iso.slice(2, 4);
  }

  // fmtDateTime(ms) -> 'Sep 4, 2026, 1:59 am' — a stamp he can match against
  // his sent folder. The input is epoch milliseconds, which is what the app
  // stores on a saved PDF, and it is read in LOCAL time because that is the
  // clock he was standing next to when the document went out. Midnight reads
  // '12:00 am' and noon '12:00 pm'; anything that isn't a real number of
  // milliseconds comes back as '' rather than 'Invalid Date'.
  function fmtDateTime(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const iso = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    const ampm = d.getHours() < 12 ? 'am' : 'pm';
    const h = d.getHours() % 12 || 12;
    return fmtDate(iso) + ', ' + h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
  }

  // addDays('2026-09-14', -7) -> '2026-09-07'. Composed from local
  // getFullYear/getMonth/getDate (not toISOString, which is UTC) and read at
  // noon, so a week step across a DST change lands on the right Monday
  // instead of the Sunday before it. Anything that isn't a valid YYYY-MM-DD
  // comes back null, so a caller can refuse to move rather than navigate to
  // "Invalid Date".
  //
  // DocModel keeps its own copy for the document's valid-through date; that
  // one is part of the document model's own arithmetic and is left alone.
  function addDays(iso, n) {
    if (!isISO(iso) || typeof n !== 'number' || !isFinite(n) || Math.round(n) !== n) return null;
    const dt = noon(iso);
    if (!dt) return null;
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
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

  // -------------------------------------------------------------------------
  // THE CALENDAR
  // -------------------------------------------------------------------------
  // Four digits on the keypad is how a man who knows the date writes it down,
  // and it was the whole vocabulary until the Invoices tab asked him for two
  // dates on one screen. "The Friday" is not four digits, it is a thing he
  // finds by looking, so the first thing he sees now is a month.
  //
  // The arithmetic is here, pure, and the panel only draws what comes back:
  // a month is seven columns wide however small the phone is, and which day
  // sits in which column is not a decision a screen should be making.

  // monthGrid(2026, 9) -> the weeks of September 2026, Sunday first, as ISO
  // strings with null in every cell that belongs to no day of this month. A
  // month that is not a month comes back as [] rather than as a grid of
  // "Invalid Date", so a panel handed a bad argument draws nothing instead of
  // drawing nonsense.
  function monthGrid(year, month) {
    if (!Number.isInteger(year) || !Number.isInteger(month)) return [];
    if (month < 1 || month > 12) return [];
    const first = composeDate(year, month, 1);
    if (!first) return [];
    const lead = noon(first).getDay();          // Sunday is 0, which is column 0
    const weeks = [];
    let row = new Array(lead).fill(null);
    for (let day = 1; ; day += 1) {
      const iso = composeDate(year, month, day);
      if (!iso) break;                          // the 31st of a 30-day month
      row.push(iso);
      if (row.length === 7) { weeks.push(row); row = []; }
    }
    if (row.length) {
      while (row.length < 7) row.push(null);
      weeks.push(row);
    }
    return weeks;
  }

  // addMonths('2026-01-31', 1) -> '2026-02-28'. The arrows on the calendar,
  // and the one rule they need: a day the next month does not have takes the
  // last day it does. Rolling forward to March 3 instead would put the arrow a
  // month and three days away from where he was standing, and he would not see
  // it happen because the grid he is looking at is the next month either way.
  function addMonths(iso, n) {
    if (!isISO(iso) || typeof n !== 'number' || !isFinite(n) || Math.round(n) !== n) return null;
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    const d = Number(iso.slice(8, 10));
    if (m < 1 || m > 12) return null;
    const total = (y * 12) + (m - 1) + n;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    // Walk the day down rather than doing month-length arithmetic: composeDate
    // already owns what a real day is, and this way leap years need no rule.
    for (let day = d; day >= 28; day -= 1) {
      const hit = composeDate(year, month, day);
      if (hit) return hit;
    }
    return composeDate(year, month, d);
  }

  // monthTitle('2026-09-09') -> 'September 2026'. The heading over the grid.
  // Spelled out, not abbreviated: it is the only place in the app with room
  // for the whole word, and it is what a calendar says.
  function monthTitle(iso) {
    if (!isISO(iso)) return '';
    const m = Number(iso.slice(5, 7));
    if (m < 1 || m > 12) return '';
    return MONTH_FULL[m - 1] + ' ' + iso.slice(0, 4);
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

  return { DEFAULT_NUDGE_DAYS, fmtDate, fmtDateShort, fmtDateTime, addDays, daysSince, composeDate, parseTypedDate,
    monthGrid, addMonths, monthTitle, sentNoAnswer, bidsSortCompare };
});
