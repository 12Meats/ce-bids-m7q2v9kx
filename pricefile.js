// pricefile.js — the price file a script writes off the supplier's site and
// the app reads in Settings. UMD so node:test and the browser both load it.
// Pure: no DOM, no persistence. The screen shows summaryText and asks; this
// file decides everything else. A row with no name, or a price of nothing,
// is refused, the same as a row missing its sku or its per. bidmath.js must
// load before this file (summaryText formats money through BidMath.fmt).
//
// THE APP NEVER TALKS TO THE SUPPLIER. tools/qed-prices.py, run by hand on a
// PC, reads one public product page per part that has a part number and
// writes the file below; if the supplier ever objects, that script stops and
// nothing in here changes, because this only ever read a file.
//
//   { source, checkedISO: 'YYYY-MM-DD',
//     rows: [{ sku, name, listCents, per,
//             forPart?, catalogNo?, brand? }] }  per: 'ea' | 'ft' | 'c' | 'm' | anything else the page said
//
// forPart, catalogNo and brand are optional and were added in v3.1: forPart
// names the generic part in HIS catalog this row is a variant of, catalogNo is
// the number printed on the shelf, brand is who made it. They are what lets an
// import CREATE the part it cannot find, named the way he would name it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./bidmath.js'));
  else root.PriceFile = factory(root.Catalog, root.BidMath);
})(typeof self !== 'undefined' ? self : this, function (Catalog, BidMath) {
  'use strict';

  const r = Math.round;
  const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  // A price of nothing is not a price: a $0 row is refused the same as a
  // fractional-cent one, so a supplier's out-of-stock placeholder never
  // becomes a free part.
  const isCents = (v) => Number.isInteger(v) && v > 0;

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
      if (!x || typeof x !== 'object') return { error: 'Row ' + (i + 1) + ' of the price file is not a price row.', rows: [] };
      const nameBad = typeof x.name !== 'string' || x.name.trim() === '';
      const bad = typeof x.sku !== 'string' || x.sku.trim() === ''
        || nameBad || !isCents(x.listCents) || typeof x.per !== 'string' || x.per === '';
      if (bad) return { error: 'Row ' + (i + 1) + ' of the price file is not a price row.', rows: [] };
      // Capped at 120: the same ceiling supplierName wears everywhere else it
      // is stored, so a row cannot put a longer string on a part than typing
      // it in Settings ever could. sku strips ALL whitespace, not just the
      // ends, the same as the typed path in Settings, so "330 2434" off a
      // scanned receipt matches the part he typed "3302434" onto.
      const row = { sku: x.sku.replace(/\s+/g, ''), name: Catalog.straighten(x.name).slice(0, 120), listCents: x.listCents, per: x.per.trim().toLowerCase() };
      // OPTIONAL, and only ever additive: the generic part this row is a
      // variant of, the manufacturer's catalog number, and the brand. A file
      // written before v3.1 carries none of them and parses exactly as it
      // always did. Anything that is not a non-empty string is left OFF the
      // row rather than refused: a hole a scraper left is not a bad price.
      // Straightened and capped at 120, the same as the name, so a generated
      // file cannot put a longer string on a part than typing it ever could.
      ['forPart', 'catalogNo', 'brand'].forEach((k) => {
        if (typeof x[k] !== 'string') return;
        const v = Catalog.straighten(x[k]).slice(0, 120);
        if (v !== '') row[k] = v;
      });
      rows.push(row);
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
    // A per-hundred or per-thousand price still clamps to at least a cent: a
    // fraction of a cent is a real cost, not a free part.
    if (per === 'c') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 100)) : null;
    if (per === 'm') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 1000)) : null;
    return null;
  }

  // match(rows, catalog) -> { matched, unmatched, mismatched, duplicates }
  //   matched:    [{ part, row, newListCents, oldListCents, changePct }]
  //   unmatched:  rows for parts he never listed (skipped, said out loud)
  //   mismatched: [{ part, row, reason }] units that cannot convert
  //   duplicates: rows that land on a part an earlier row already took
  // By part number first; then by the supplier's name a part remembers from
  // an earlier import. His own names are never compared to the supplier's:
  // "3/4 EMT" and "Republic 3/4 in. EMT Conduit 10 ft" are the same part and
  // no rule says so reliably. Hidden parts still match: a price remembered on
  // a part he has put away is there the day he brings it back. Two parts with
  // the same part number is a typo; the first one in the catalog wins and the
  // second is left alone. Settings refuses the duplicate when he types it.
  function match(rows, catalog) {
    const parts = Array.isArray(catalog) ? catalog : [];
    const bySku = new Map();
    const byName = new Map();
    parts.forEach((p) => {
      const hasSku = typeof p.sku === 'string' && p.sku.trim() !== '';
      // Stripped of ALL whitespace, not just trimmed: a stored sku with an
      // inner space (typed off a receipt) still matches a row whose sku was
      // stripped the same way in parse().
      if (hasSku) {
        const k = p.sku.replace(/\s+/g, '');
        if (!bySku.has(k)) bySku.set(k, p);
      }
      // A part with its own QED number is only ever found by that number: the
      // name lane exists for a part still waiting on one, and letting it also
      // catch a part that already has a different number would let a row for
      // the wrong part overwrite this one because they once shared a name.
      if (!hasSku && typeof p.supplierName === 'string' && p.supplierName.trim() !== '') {
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
      // Only the price counts here: a part can gain a sku or a supplier name
      // on this same call and still be reported as "already right".
      if (p.lastListCents === m.newListCents) unchanged += 1; else changed += 1;
      p.lastListCents = m.newListCents;
      p.supplierName = m.row.name;
      if (!(typeof p.sku === 'string' && p.sku.trim() !== '')) p.sku = m.row.sku;
      p.priceCheckedISO = checkedISO;
    });
    return { changed, unchanged };
  }

  // What apply is about to touch, remembered first, so a refused save can put
  // every part back exactly as it was. Kept HERE, beside apply, so the list
  // of fields cannot drift from the list apply writes.
  function snapshot(matched) {
    return matched.map((m) => ({ p: m.part, lastListCents: m.part.lastListCents, supplierName: m.part.supplierName,
      sku: m.part.sku, priceCheckedISO: m.part.priceCheckedISO }));
  }
  function restore(snap) {
    snap.forEach((b) => { b.p.lastListCents = b.lastListCents; b.p.supplierName = b.supplierName; b.p.sku = b.sku; b.p.priceCheckedISO = b.priceCheckedISO; });
  }

  function n(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

  // Names a list of movers or mismatches, at most SHOWN of them, with the
  // rest folded into a trailing count rather than a wall of names.
  const SHOWN = 5;
  function namesList(items, nameFn) {
    const shown = items.slice(0, SHOWN).map(nameFn).join(', ');
    const rest = items.length - SHOWN;
    return shown + (rest > 0 ? ', and ' + rest + ' more' : '');
  }

  // The sentence the confirm shows before anything is written.
  function summaryText(m) {
    // The "put the part numbers on your parts first" sentence only belongs
    // to a file that matched nothing at all: no matches, no mismatches, no
    // duplicates. A file whose only row matched a part but was skipped for a
    // unit mismatch (or landed on a repeat) is not that file, and telling him
    // to add part numbers he already added is wrong. That case still opens
    // with an empty-handed sentence, then falls through to the unmatched /
    // mismatched / duplicates sentences below like any other summary.
    if (!m.matched.length && !m.mismatched.length && !m.duplicates.length) {
      return 'None of the rows in that file match a part with a QED part number. Put the part numbers on your parts first.';
    }
    if (!m.matched.length) {
      const parts = ['None of your parts got a new price.'];
      if (m.unmatched.length) parts.push(n(m.unmatched.length, 'row is', 'rows are') + ' not in your catalog and ' + (m.unmatched.length === 1 ? 'is' : 'are') + ' skipped.');
      if (m.mismatched.length) {
        parts.push(n(m.mismatched.length, 'part is', 'parts are') + ' counted differently than QED sells '
          + (m.mismatched.length === 1 ? 'it' : 'them') + ' and ' + (m.mismatched.length === 1 ? 'is' : 'are') + ' skipped: '
          + namesList(m.mismatched, (x) => x.part.name) + '.');
      }
      if (m.duplicates.length) parts.push(n(m.duplicates.length, 'row repeats', 'rows repeat') + ' a part number and ' + (m.duplicates.length === 1 ? 'is' : 'are') + ' skipped.');
      return parts.join(' ');
    }
    const big = m.matched.filter((x) => x.changePct !== null && Math.abs(x.changePct) > 10);
    const parts = [m.matched.length + ' of your parts matched.'];
    if (big.length) {
      parts.push(big.length + ' moved more than 10%: '
        + namesList(big, (x) => x.part.name + ' (' + BidMath.fmt(x.oldListCents) + ' to ' + BidMath.fmt(x.newListCents) + ')') + '.');
    }
    if (m.unmatched.length) parts.push(n(m.unmatched.length, 'row is', 'rows are') + ' not in your catalog and ' + (m.unmatched.length === 1 ? 'is' : 'are') + ' skipped.');
    if (m.mismatched.length) {
      parts.push(n(m.mismatched.length, 'part is', 'parts are') + ' counted differently than QED sells '
        + (m.mismatched.length === 1 ? 'it' : 'them') + ' and ' + (m.mismatched.length === 1 ? 'is' : 'are') + ' skipped: '
        + namesList(m.mismatched, (x) => x.part.name) + '.');
    }
    if (m.duplicates.length) parts.push(n(m.duplicates.length, 'row repeats', 'rows repeat') + ' a part number and ' + (m.duplicates.length === 1 ? 'is' : 'are') + ' skipped.');
    return parts.join(' ');
  }

  return { parse, convertCents, match, apply, snapshot, restore, summaryText };
});
