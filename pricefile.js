// pricefile.js — the price file a script writes off the supplier's site and
// the app reads in Settings. UMD so node:test and the browser both load it.
// Pure: no DOM, no persistence. The screen shows summaryText and asks; this
// file decides everything else.
//
// THE APP NEVER TALKS TO THE SUPPLIER. tools/qed-prices.py, run by hand on a
// PC, reads one public product page per part that has a part number and
// writes the file below; if the supplier ever objects, that script stops and
// nothing in here changes, because this only ever read a file.
//
//   { source, checkedISO: 'YYYY-MM-DD',
//     rows: [{ sku, name, listCents, per }] }     per: 'ea' | 'ft' | 'c' | 'm' | anything else the page said
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.PriceFile = factory(root.Catalog);
})(typeof self !== 'undefined' ? self : this, function (Catalog) {
  'use strict';

  const r = Math.round;
  const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isCents = (v) => Number.isInteger(v) && v >= 0;

  // parse(text) -> { error: null, checkedISO, rows } or { error: 'why', rows: [] }
  // The error names the first bad row by its 1-based number, which is the
  // number Adrian sees in the file.
  function parse(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { error: 'That is not a price file.', rows: [] }; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.rows)) return { error: 'That is not a price file.', rows: [] };
    if (!isISO(obj.checkedISO)) return { error: 'The price file has no date on it (checkedISO).', rows: [] };
    const rows = [];
    for (let i = 0; i < obj.rows.length; i++) {
      const x = obj.rows[i];
      const bad = !x || typeof x !== 'object' || typeof x.sku !== 'string' || x.sku.trim() === ''
        || typeof x.name !== 'string' || !isCents(x.listCents) || typeof x.per !== 'string' || x.per === '';
      if (bad) return { error: 'Row ' + (i + 1) + ' of the price file is not a price row.', rows: [] };
      rows.push({ sku: x.sku.trim(), name: Catalog.straighten(x.name), listCents: x.listCents, per: x.per.trim().toLowerCase() });
    }
    return { error: null, checkedISO: obj.checkedISO, rows };
  }

  // Cents per HIS unit, or null when the supplier's unit and his cannot be
  // the same thing. The supplier sells by the each, the foot, the hundred (C)
  // or the thousand (M). A roll, a box, a case, a lot and a day are all sold
  // each. A foot price on a counted part, an each price on a length, or a
  // roll price on a length (how long is the roll?) is a guess, and a guess is
  // what the walk's cost keypad is for, not an import.
  const COUNTED = ['ea', 'roll', 'box', 'case', 'lot', 'day'];
  function convertCents(row, unit) {
    const per = row.per;
    if (per === 'ea') return COUNTED.indexOf(unit) !== -1 ? row.listCents : null;
    if (per === 'ft') return unit === 'ft' ? row.listCents : null;
    if (per === 'c') return (unit === 'ft' || unit === 'ea') ? r(row.listCents / 100) : null;
    if (per === 'm') return (unit === 'ft' || unit === 'ea') ? r(row.listCents / 1000) : null;
    return null;
  }

  // match(rows, catalog) -> { matched, unmatched, mismatched, duplicates }
  //   matched:    [{ part, row, newListCents, oldListCents, changePct }]
  //   unmatched:  rows for parts he never listed (skipped, said out loud)
  //   mismatched: [{ part, row, reason }] units that cannot convert
  //   duplicates: rows whose sku already matched an earlier row
  // By part number first; then by the supplier's name a part remembers from
  // an earlier import. His own names are never compared to the supplier's:
  // "3/4 EMT" and "Republic 3/4 in. EMT Conduit 10 ft" are the same part and
  // no rule says so reliably. Hidden parts still match: a price remembered on
  // a part he has put away is there the day he brings it back.
  function match(rows, catalog) {
    const parts = Array.isArray(catalog) ? catalog : [];
    const bySku = new Map();
    const byName = new Map();
    parts.forEach((p) => {
      if (typeof p.sku === 'string' && p.sku.trim() !== '' && !bySku.has(p.sku.trim())) bySku.set(p.sku.trim(), p);
      if (typeof p.supplierName === 'string' && p.supplierName.trim() !== '') {
        const k = Catalog.normalizeName(p.supplierName);
        if (!byName.has(k)) byName.set(k, p);
      }
    });
    const seen = new Set();
    const out = { matched: [], unmatched: [], mismatched: [], duplicates: [] };
    rows.forEach((row) => {
      const part = bySku.get(row.sku) || byName.get(Catalog.normalizeName(row.name)) || null;
      if (!part) { out.unmatched.push(row); return; }
      if (seen.has(part.id)) { out.duplicates.push(row); return; }
      seen.add(part.id);
      const cents = convertCents(row, part.unit);
      if (cents === null) {
        out.mismatched.push({ part, row, reason: 'QED sells it per ' + row.per + ' and it is counted by the ' + part.unit });
        return;
      }
      const old = Number.isInteger(part.lastListCents) ? part.lastListCents : null;
      out.matched.push({
        part, row, newListCents: cents, oldListCents: old,
        changePct: old > 0 ? (cents - old) / old * 100 : null,
      });
    });
    return out;
  }

  // apply(matched, checkedISO) -> { changed, unchanged }
  // Mutates the parts in place; the caller wraps it in persistOr. Writes the
  // bill-at price, the supplier's name, the part number a part lacked, and
  // the date. NEVER the cost (his), NEVER a line on a bid (history).
  function apply(matched, checkedISO) {
    let changed = 0, unchanged = 0;
    matched.forEach((m) => {
      const p = m.part;
      if (p.lastListCents === m.newListCents) unchanged += 1; else changed += 1;
      p.lastListCents = m.newListCents;
      p.supplierName = m.row.name;
      if (!(typeof p.sku === 'string' && p.sku.trim() !== '')) p.sku = m.row.sku;
      p.priceCheckedISO = checkedISO;
    });
    return { changed, unchanged };
  }

  function money(c) {
    const v = Math.abs(Math.round(c));
    return '$' + Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (v % 100).toString().padStart(2, '0');
  }
  function n(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

  // The sentence the confirm shows before anything is written.
  function summaryText(m) {
    if (!m.matched.length) {
      return 'None of the rows in that file match a part with a QED part number. Put the part numbers on your parts first.';
    }
    const big = m.matched.filter((x) => x.changePct !== null && Math.abs(x.changePct) > 10);
    const parts = [n(m.matched.length, 'of your parts matched', 'of your parts matched') + '.'];
    if (big.length) {
      parts.push(big.length + ' moved more than 10%: '
        + big.map((x) => x.part.name + ' (' + money(x.oldListCents) + ' to ' + money(x.newListCents) + ')').join(', ') + '.');
    }
    if (m.unmatched.length) parts.push(n(m.unmatched.length, 'row is', 'rows are') + ' not in your catalog and ' + (m.unmatched.length === 1 ? 'is' : 'are') + ' skipped.');
    if (m.mismatched.length) {
      parts.push(n(m.mismatched.length, 'part is', 'parts are') + ' counted differently than QED sells '
        + (m.mismatched.length === 1 ? 'it' : 'them') + ' and ' + (m.mismatched.length === 1 ? 'is' : 'are') + ' skipped: '
        + m.mismatched.map((x) => x.part.name).join(', ') + '.');
    }
    if (m.duplicates.length) parts.push(n(m.duplicates.length, 'row repeats', 'rows repeat') + ' a part number and ' + (m.duplicates.length === 1 ? 'is' : 'are') + ' skipped.');
    return parts.join(' ');
  }

  return { parse, convertCents, match, apply, summaryText, COUNTED };
});
