// tests/pricefile.test.js — the price file the script writes and the app reads.
//
// Everything about it lives in pricefile.js: what a valid file is, how a
// supplier's "per hundred" becomes cents per foot, which of his parts a row
// belongs to, and what an import writes. The screen only shows the summary
// and asks.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../pricefile.js');
const S = require('../storage.js');

function file(rows, extra) {
  return JSON.stringify(Object.assign({ source: 'qedelectric.com', checkedISO: '2026-09-08', rows }, extra || {}));
}

test('parse: a good file comes back with its rows; anything else says why', () => {
  const ok = P.parse(file([{ sku: '3302434', name: 'GFCI', listCents: 3908, per: 'ea' }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.checkedISO, '2026-09-08');
  assert.deepStrictEqual(ok.rows, [{ sku: '3302434', name: 'GFCI', listCents: 3908, per: 'ea' }]);

  assert.match(P.parse('not json').error, /not a price file/i);
  assert.match(P.parse(JSON.stringify({ version: 1, bids: [] })).error, /not a price file/i, 'a backup is not a price file');
  assert.match(P.parse(file([{ sku: 1, name: 'x', listCents: 1, per: 'ea' }])).error, /row 1/i, 'a numeric sku names the row');
  assert.match(P.parse(file([{ sku: '1', name: 'x', listCents: 12.5, per: 'ea' }])).error, /row 1/i, 'fractional cents');
  assert.match(P.parse(file([{ sku: '1', name: 'x', listCents: 100 }])).error, /row 1/i, 'no per');
  assert.match(P.parse(file([], { checkedISO: 'yesterday' })).error, /date/i);
  assert.strictEqual(P.parse(file([])).error, null, 'an empty file is a valid file with nothing in it');
});

// The supplier sells by the each, the foot, the hundred or the thousand; his
// catalog counts by ea, ft, roll, box, case, lot, day. Only the pairs that mean
// the same thing convert; the rest come back null and the row is flagged
// rather than guessed.
test('convertCents: per ea / ft / c / m against his units', () => {
  assert.strictEqual(P.convertCents({ listCents: 3908, per: 'ea' }, 'ea'), 3908);
  assert.strictEqual(P.convertCents({ listCents: 21600, per: 'ea' }, 'roll'), 21600, 'a roll is sold each');
  assert.strictEqual(P.convertCents({ listCents: 5000, per: 'ea' }, 'box'), 5000);
  assert.strictEqual(P.convertCents({ listCents: 96, per: 'ft' }, 'ft'), 96);
  assert.strictEqual(P.convertCents({ listCents: 4320, per: 'c' }, 'ft'), 43, 'per hundred feet: 43.2 rounds to 43');
  assert.strictEqual(P.convertCents({ listCents: 43200, per: 'm' }, 'ft'), 43, 'per thousand feet');
  assert.strictEqual(P.convertCents({ listCents: 1250, per: 'c' }, 'ea'), 13, 'per hundred pieces: 12.5 rounds to 13');
  assert.strictEqual(P.convertCents({ listCents: 96, per: 'ft' }, 'ea'), null, 'a foot price on a counted part');
  assert.strictEqual(P.convertCents({ listCents: 96, per: 'ea' }, 'ft'), null, 'an each price on a length');
  assert.strictEqual(P.convertCents({ listCents: 96, per: 'rl' }, 'ft'), null, 'a roll price on a length: the roll length is unknown');
  assert.strictEqual(P.convertCents({ listCents: 96, per: 'pallet' }, 'ea'), null);
});

function catalogWith(parts) {
  const d = S.emptyData();
  d.catalog = parts.map((p, i) => Object.assign({ id: 'p' + i, category: 'gear', unit: 'ea', lastCostCents: null,
    lastListCents: null, uses: 0, hidden: false, sku: null, supplierName: null, priceCheckedISO: null }, p));
  return d;
}

// A row finds its part by QED part number first, then by QED's name when a
// part remembers one from an earlier import. His own short names are never
// compared to QED's long ones: "3/4 EMT" and "Republic 3/4 in. EMT Conduit 10
// ft" are the same part and no rule would say so reliably.
test('match: by sku, then by remembered supplier name; the rest are unmatched or mismatched', () => {
  const d = catalogWith([
    { name: 'GFCI', sku: '3302434', lastListCents: 3500 },
    { name: '#8 THHN', unit: 'ft', supplierName: 'Southwire #8 THHN Stranded Black', lastListCents: 90 },
    { name: '20 A breaker', sku: '999', unit: 'ea', lastListCents: null },
    { name: 'Wire nuts', sku: '555', unit: 'ea' },
    { name: 'Old thing', sku: '777', hidden: true },
  ]);
  const rows = [
    { sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' },
    { sku: '1111', name: 'Southwire #8 THHN Stranded Black', listCents: 96, per: 'ft' },
    { sku: '999', name: 'Square D 20A', listCents: 1800, per: 'ea' },
    { sku: '555', name: 'Ideal wire nuts', listCents: 1250, per: 'c' },
    { sku: '777', name: 'Old thing', listCents: 1, per: 'ea' },
    { sku: '424242', name: 'Something he never listed', listCents: 100, per: 'ea' },
    { sku: '3302434', name: 'GFCI again', listCents: 1, per: 'ea' },
  ];
  const m = P.match(rows, d.catalog);

  assert.deepStrictEqual(m.matched.map((x) => [x.part.name, x.newListCents, x.oldListCents]), [
    ['GFCI', 3908, 3500],
    ['#8 THHN', 96, 90],
    ['20 A breaker', 1800, null],
    ['Wire nuts', 13, null],
    ['Old thing', 1, null],
  ]);
  // Change, as a fraction of the old price; null when there was no old price.
  assert.strictEqual(Math.round(m.matched[0].changePct * 10) / 10, 11.7);
  assert.strictEqual(m.matched[2].changePct, null);
  // A hidden part is still his part: it matches, and the price is remembered
  // for the day he un-hides it.
  assert.strictEqual(m.matched.length, 5, 'hidden parts are not silently skipped');
  assert.ok(m.matched.some((x) => x.part.name === 'Old thing'), 'hidden parts are not silently skipped');
  assert.deepStrictEqual(m.unmatched.map((r) => r.sku), ['424242'], 'a row for a part he never listed');
  assert.deepStrictEqual(m.duplicates.map((r) => r.sku), ['3302434'], 'the second row for the same sku is reported, not applied');
  assert.deepStrictEqual(m.mismatched, [], 'nothing here has a unit that cannot convert');
});

test('match: a unit that cannot convert is mismatched, with the reason', () => {
  const d = catalogWith([{ name: '#8 THHN', unit: 'ft', sku: '1111' }]);
  const m = P.match([{ sku: '1111', name: 'Southwire #8 THHN', listCents: 9600, per: 'rl' }], d.catalog);
  assert.strictEqual(m.matched.length, 0);
  assert.strictEqual(m.mismatched.length, 1);
  assert.strictEqual(m.mismatched[0].part.name, '#8 THHN');
  assert.match(m.mismatched[0].reason, /per rl.*counted by the ft/i);
});

// What an import writes, and what it leaves alone. Cost is his; a bid is
// history. Only the part's bill-at price, QED's name, the part number it
// lacked, and the date move.
test('apply: writes lastListCents, supplierName, a missing sku and the date; never cost, never a bid', () => {
  const d = catalogWith([
    { name: 'GFCI', sku: '3302434', lastCostCents: 3000, lastListCents: 3500 },
    { name: '#8 THHN', unit: 'ft', supplierName: 'Southwire #8 THHN Stranded Black', lastCostCents: 80, lastListCents: 90 },
  ]);
  const b = S.newBid(d, { customerName: 'UDA', title: 'x', jobType: 'service' });
  b.areas.push({ id: 'a1', name: 'Room', items: [
    { catalogId: 'p0', name: 'GFCI', unit: 'ea', qty: 1, costCents: 3000, priceCents: null, listCents: 3500 } ], photoIds: [] });
  d.bids.push(b);
  const m = P.match([
    { sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' },
    { sku: '1111', name: 'Southwire #8 THHN Stranded Black', listCents: 96, per: 'ft' },
  ], d.catalog);
  const out = P.apply(m.matched, '2026-09-08');
  assert.deepStrictEqual(out, { changed: 2, unchanged: 0 });

  const gfci = d.catalog[0], wire = d.catalog[1];
  assert.strictEqual(gfci.lastListCents, 3908);
  assert.strictEqual(gfci.supplierName, 'Pass & Seymour GFCI');
  assert.strictEqual(gfci.sku, '3302434');
  assert.strictEqual(gfci.priceCheckedISO, '2026-09-08');
  assert.strictEqual(gfci.lastCostCents, 3000, 'cost is his');
  assert.strictEqual(wire.sku, '1111', 'a part matched by name learns its part number');
  assert.strictEqual(wire.lastListCents, 96);
  assert.strictEqual(b.areas[0].items[0].listCents, 3500, 'a line already on a bid does not move');
  assert.ok(S.validateImport(JSON.stringify(d)), 'what apply wrote still validates');

  // A second import with the same numbers changes nothing but the date.
  const again = P.apply(P.match([{ sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' }], d.catalog).matched, '2026-10-01');
  assert.deepStrictEqual(again, { changed: 0, unchanged: 1 });
  assert.strictEqual(gfci.priceCheckedISO, '2026-10-01');
});

// The sentence the confirm shows. Counts, the big movers, and the leftovers,
// in the order he cares about.
test('summaryText reads like a sentence and names what moved a lot', () => {
  const m = {
    matched: [
      { part: { name: 'GFCI' }, newListCents: 3908, oldListCents: 3500, changePct: 11.66 },
      { part: { name: '#8 THHN' }, newListCents: 96, oldListCents: 90, changePct: 6.67 },
      { part: { name: 'Breaker' }, newListCents: 1800, oldListCents: null, changePct: null },
    ],
    unmatched: [{ sku: '424242' }], mismatched: [{ part: { name: 'Cord' }, reason: 'x' }], duplicates: [],
  };
  const t = P.summaryText(m);
  assert.match(t, /^3 of your parts matched\./);
  assert.match(t, /1 moved more than 10%: GFCI \(\$35\.00 to \$39\.08\)\./);
  assert.match(t, /1 row is not in your catalog and is skipped\./);
  assert.match(t, /1 part is counted differently than QED sells it and is skipped: Cord\./);
  assert.strictEqual(P.summaryText({ matched: [], unmatched: [], mismatched: [], duplicates: [] }),
    'None of the rows in that file match a part with a QED part number. Put the part numbers on your parts first.');
});
