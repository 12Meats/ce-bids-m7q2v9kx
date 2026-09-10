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

// Zero is not a price (a supplier's out-of-stock placeholder is not a free
// part), and a nameless row has nothing for the confirm to say moved. Both
// are refused the same way a bad sku is: by row number. A name that is too
// long is not refused, only trimmed, the same ceiling supplierName wears
// everywhere else it is stored.
test('parse: a row priced at nothing is refused, and a name is required and capped', () => {
  assert.match(P.parse(file([{ sku: '1', name: 'x', listCents: 0, per: 'ea' }])).error, /row 1/i, 'zero is not a price');
  assert.match(P.parse(file([{ sku: '1', name: '   ', listCents: 100, per: 'ea' }])).error, /row 1/i, 'a nameless row');
  const long = 'x'.repeat(200);
  const ok = P.parse(file([{ sku: '1', name: long, listCents: 100, per: 'ea' }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.rows[0].name.length, 120);
});

// A row that is not an object at all (null, a number, a string) has to be
// named by its row number like any other bad row, not thrown past parse's
// own error handling.
test('parse: a null row is named by its row number, not thrown', () => {
  assert.match(P.parse(file([null])).error, /row 1/i);
});

// A scanned or copy-pasted sku can carry a stray space in the middle, not
// just at the ends. Stripped the same way Settings strips a typed part
// number, so the two paths land on the same string and match each other.
test('parse: a sku strips all whitespace, not just the ends', () => {
  const ok = P.parse(file([{ sku: '330 2434', name: 'GFCI', listCents: 3908, per: 'ea' }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.rows[0].sku, '3302434');
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
  assert.strictEqual(P.convertCents({ listCents: 40, per: 'm' }, 'ft'), 1, 'a fraction of a cent is still a cent, not free');
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

// A stored sku can carry a stray space in the middle (typed off a receipt,
// same as a row's), and the catalog lane strips it the same way the row lane
// does, so the two still land on each other.
test('match: a stored sku with an inner space still matches', () => {
  const d = catalogWith([{ name: 'Conduit', sku: '330 2434' }]);
  const m = P.match([{ sku: '3302434', name: 'Conduit', listCents: 100, per: 'ea' }], d.catalog);
  assert.strictEqual(m.matched.length, 1);
  assert.strictEqual(m.matched[0].part.name, 'Conduit');
});

// A part's own QED number is not just a hint, it is the ONLY thing that finds
// it once it has one: a row for a different number must never land on this
// part just because the two once shared a supplier name.
test('match: a part with its own QED number is never matched by name', () => {
  const d = catalogWith([{ name: 'Something', sku: 'XXX', supplierName: 'Same Name' }]);
  const m = P.match([{ sku: 'YYY', name: 'Same Name', listCents: 100, per: 'ea' }], d.catalog);
  assert.strictEqual(m.matched.length, 0);
  assert.deepStrictEqual(m.unmatched.map((r) => r.sku), ['YYY']);
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

// snapshot/restore live beside apply so the screen can undo a refused save
// without hand-listing which fields apply touches a second time.
test('snapshot/restore: apply then restore leaves the parts exactly as they were', () => {
  const d = catalogWith([{ name: 'GFCI', sku: '3302434', lastListCents: 3500 }]);
  const before = JSON.parse(JSON.stringify(d.catalog));
  const m = P.match([{ sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' }], d.catalog);
  const snap = P.snapshot(m.matched);
  P.apply(m.matched, '2026-09-08');
  assert.notDeepStrictEqual(d.catalog, before, 'apply actually changed something');
  P.restore(snap);
  assert.deepStrictEqual(d.catalog, before);
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

// A file whose only row matched a part but was skipped for a unit mismatch
// is not the same as a file with no part numbers on it: the sentence has to
// say something got skipped for a reason, not blame him for missing numbers
// he already put on.
test('summaryText: matched is empty but something else was found', () => {
  const m = { matched: [], unmatched: [], mismatched: [{ part: { name: 'Cord' }, reason: 'x' }], duplicates: [] };
  assert.match(P.summaryText(m),
    /^None of your parts got a new price\. 1 part is counted differently than QED sells it and is skipped: Cord\.$/);
});

// A long price file can move dozens of parts more than 10%; the confirm names
// a handful and counts the rest, rather than becoming a sentence he cannot
// read before tapping Update.
test('summaryText: the confirm names at most five movers', () => {
  const mover = (name) => ({ part: { name }, newListCents: 200, oldListCents: 100, changePct: 100 });
  const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(mover);
  const t7 = P.summaryText({ matched: seven, unmatched: [], mismatched: [], duplicates: [] });
  assert.match(t7, /A \(\$1\.00 to \$2\.00\), B \(\$1\.00 to \$2\.00\), C \(\$1\.00 to \$2\.00\), D \(\$1\.00 to \$2\.00\), E \(\$1\.00 to \$2\.00\), and 2 more\./);

  const two = ['A', 'B'].map(mover);
  const t2 = P.summaryText({ matched: two, unmatched: [], mismatched: [], duplicates: [] });
  assert.doesNotMatch(t2, /, and \d+ more/);
});

// ---------------------------------------------------------------------------
// v3.1: the three optional fields a row may carry
// ---------------------------------------------------------------------------
// The QED price file Adrian builds names, per row, the generic part the row is
// a variant OF (forPart), the manufacturer's catalog number (catalogNo) and
// the brand. All three are optional: a file written before v3.1 has none of
// them and parses exactly as it always did. A field that is not a string is
// absent, never an error, because a price file is still a price file when a
// scraper leaves a hole in it.
test('parse: forPart, catalogNo and brand are kept when they are strings', () => {
  const ok = P.parse(file([{ sku: '1', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
    forPart: '  60 A 3-pole breaker  ', catalogNo: ' B360 ', brand: ' Siemens ' }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.rows[0].forPart, '60 A 3-pole breaker');
  assert.strictEqual(ok.rows[0].catalogNo, 'B360');
  assert.strictEqual(ok.rows[0].brand, 'Siemens');
});

test('parse: a field that is not a string is absent, not an error', () => {
  const ok = P.parse(file([{ sku: '1', name: 'x', listCents: 100, per: 'ea', forPart: 42, catalogNo: null, brand: '   ' }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual('forPart' in ok.rows[0], false);
  assert.strictEqual('catalogNo' in ok.rows[0], false);
  assert.strictEqual('brand' in ok.rows[0], false);
});

test('parse: each of the three is capped at 120, the same ceiling as the name', () => {
  const long = 'y'.repeat(200);
  const ok = P.parse(file([{ sku: '1', name: 'x', listCents: 100, per: 'ea', forPart: long, catalogNo: long, brand: long }]));
  assert.strictEqual(ok.error, null);
  assert.strictEqual(ok.rows[0].forPart.length, 120);
  assert.strictEqual(ok.rows[0].catalogNo.length, 120);
  assert.strictEqual(ok.rows[0].brand.length, 120);
});

// ---------------------------------------------------------------------------
// v3.2: which rows become NEW parts
// ---------------------------------------------------------------------------
// guessCategory reads the drawer off the supplier's own title, for the row
// that has no generic part of his to inherit one from. It is a keyword table
// and nothing cleverer: first hit wins, and everything it has no opinion
// about is gear, which is the drawer this app keeps for exactly that.
test('guessCategory reads the drawer off the words in the title', () => {
  assert.strictEqual(P.guessCategory('THHN #8 Stranded BLACK Wire'), 'wire');
  assert.strictEqual(P.guessCategory('12/2 MC cable'), 'wire');
  assert.strictEqual(P.guessCategory('3/4" EMT Set Screw Connector'), 'boxes');
  assert.strictEqual(P.guessCategory('1" x 10\' Steel EMT Conduit'), 'conduit');
  assert.strictEqual(P.guessCategory('Lithonia LED Wall Pack'), 'lighting');
  assert.strictEqual(P.guessCategory('Siemens B360 3-Pole 60 Amp Circuit Breaker'), 'gear');
  assert.strictEqual(P.guessCategory('Something nobody has a word for'), 'gear');
  assert.strictEqual(P.guessCategory(''), 'gear', 'a nameless row still lands in a real drawer');
});

// A fitting is not the pipe. The conduit lane wants a LENGTH of pipe, which is
// what the ten-foot stick in the title says; a coupling with the word PVC in
// it belongs in the fittings drawer with the rest of the fittings.
test('guessCategory: a PVC fitting is a fitting, a stick of PVC is conduit', () => {
  assert.strictEqual(P.guessCategory('1/2" PVC Schedule 40 Conduit Coupling'), 'boxes');
  assert.strictEqual(P.guessCategory('1/2" x 10ft PVC Schedule 40 Conduit'), 'conduit');
});

// plan() is match() plus the one question v3.2 asks: of the rows that found no
// part of his, which ones should BECOME parts, and what would each be called?
// Nothing is written here and nothing in the catalog is touched — the screen
// shows the count and asks first.
test('plan: an unmatched row with forPart becomes a variant of that part', () => {
  const d = catalogWith([
    { name: '60 A 3-pole breaker', category: 'gear', unit: 'ea' },
  ]);
  const rows = [{ sku: '22590', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
    forPart: '60 A 3-pole breaker', catalogNo: 'B360' }];
  const m = P.plan(rows, d.catalog);
  assert.strictEqual(m.creatable.length, 1);
  const c = m.creatable[0];
  assert.strictEqual(c.row, rows[0]);
  assert.strictEqual(c.name, '60 A 3-pole breaker · B360');
  assert.strictEqual(c.unit, 'ea');
  assert.strictEqual(c.category, 'gear');
  assert.strictEqual(c.seedPart, d.catalog[0]);
});

test('plan: returns everything match returns, plus creatable', () => {
  const d = catalogWith([{ name: 'GFCI', sku: '3302434', lastListCents: 3500 }]);
  const rows = [{ sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' }];
  const m = P.plan(rows, d.catalog);
  assert.deepStrictEqual(Object.keys(m).sort(),
    ['creatable', 'duplicates', 'matched', 'mismatched', 'unmatched']);
  assert.strictEqual(m.matched.length, 1);
  assert.deepStrictEqual(m.creatable, []);
});

// QED sells conduit by the hundred feet and wire by the thousand; he counts
// both by the foot. The unit a new part is created with comes off the row, not
// off the part it hangs under, because the row is the thing being priced.
test('plan: per c and per m give a part counted by the foot', () => {
  const d = catalogWith([]);
  const rows = [
    { sku: '1', name: '1" x 10\' Steel EMT Conduit', listCents: 7679, per: 'c', forPart: '1" EMT', catalogNo: '101543' },
    { sku: '2', name: 'THHN #8 Stranded Black', listCents: 40000, per: 'm', forPart: '#8 THHN', catalogNo: 'X8' },
    { sku: '3', name: 'Southwire 12/2 MC cable', listCents: 9000, per: 'ft', forPart: '12/2 MC', catalogNo: 'M122' },
  ];
  const m = P.plan(rows, d.catalog);
  assert.deepStrictEqual(m.creatable.map((c) => c.unit), ['ft', 'ft', 'ft']);
});

// No forPart is a row with no generic of his behind it: it is its own part,
// named the way QED named it, filed by what the words in the title say.
test('plan: a row with no forPart uses its own name and the guessed drawer', () => {
  const d = catalogWith([]);
  const rows = [{ sku: '9', name: 'Lithonia LED Wall Pack', listCents: 12900, per: 'ea' }];
  const m = P.plan(rows, d.catalog);
  assert.strictEqual(m.creatable.length, 1);
  assert.strictEqual(m.creatable[0].name, 'Lithonia LED Wall Pack');
  assert.strictEqual(m.creatable[0].category, 'lighting');
  assert.strictEqual(m.creatable[0].seedPart, null);
});

// THE SECOND IMPORT. The first one created '60 A 3-pole breaker · B360'; the
// second file carries the same row again. The name it would create is already
// a part, so the row lands on that part and updates its price instead of
// making a second one beside it. This is what makes a reimport add nothing.
test('plan: a row whose name is already a part matches that part and creates nothing', () => {
  const d = catalogWith([
    { name: '60 A 3-pole breaker', category: 'gear', unit: 'ea' },
    { name: '60 A 3-pole breaker · B360', category: 'gear', unit: 'ea', lastListCents: 9000 },
  ]);
  const rows = [{ sku: '22590', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
    forPart: '60 A 3-pole breaker', catalogNo: 'B360' }];
  const m = P.plan(rows, d.catalog);
  assert.deepStrictEqual(m.creatable, []);
  assert.strictEqual(m.matched.length, 1);
  assert.strictEqual(m.matched[0].part, d.catalog[1]);
  assert.strictEqual(m.matched[0].newListCents, 9900);
  assert.strictEqual(m.matched[0].oldListCents, 9000);
  assert.deepStrictEqual(m.unmatched, [], 'a row that found a part is not also a row he was told was skipped');
});

test('plan: a sku already on a part still matches by number, as it always did', () => {
  const d = catalogWith([{ name: 'GFCI', sku: '22590', unit: 'ea', lastListCents: 3500 }]);
  const rows = [{ sku: '22590', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
    forPart: '60 A 3-pole breaker', catalogNo: 'B360' }];
  const m = P.plan(rows, d.catalog);
  assert.deepStrictEqual(m.creatable, []);
  assert.strictEqual(m.matched.length, 1);
  assert.strictEqual(m.matched[0].part.name, 'GFCI');
});

// Two rows that would be called the same thing are one part, not two: the
// first one creates it and the second repeats it, which is the same answer
// match() gives two rows that land on one part number.
test('plan: two rows with one name give one creatable and one duplicate', () => {
  const d = catalogWith([]);
  const rows = [
    { sku: '1', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
      forPart: '60 A 3-pole breaker', catalogNo: 'B360' },
    { sku: '2', name: 'Siemens B360 60 Amp Breaker, again', listCents: 8800, per: 'ea',
      forPart: '60 A 3-pole breaker', catalogNo: 'B360' },
  ];
  const m = P.plan(rows, d.catalog);
  assert.strictEqual(m.creatable.length, 1);
  assert.strictEqual(m.creatable[0].row, rows[0]);
  assert.deepStrictEqual(m.duplicates, [rows[1]]);
});

// A forPart naming a part he does not have is still a part worth making: the
// name is the one Adrian's file asked for, and it simply stands on its own
// until he attaches it to something in Settings.
test('plan: a forPart naming nothing still creates, standing on its own', () => {
  const d = catalogWith([]);
  const rows = [{ sku: '1', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
    forPart: '60 A 3-pole breaker', catalogNo: 'B360' }];
  const m = P.plan(rows, d.catalog);
  assert.strictEqual(m.creatable.length, 1);
  assert.strictEqual(m.creatable[0].name, '60 A 3-pole breaker · B360');
  assert.strictEqual(m.creatable[0].seedPart, null);
  assert.strictEqual(m.creatable[0].category, 'gear');
});

// Nothing is written until he says so, and plan() is what he is shown. A part
// changed here would be a price on his phone he never agreed to.
test('plan: the catalog comes back exactly as it went in', () => {
  const d = catalogWith([
    { name: '60 A 3-pole breaker', category: 'gear', unit: 'ea' },
    { name: 'GFCI', sku: '3302434', lastListCents: 3500 },
  ]);
  const before = JSON.stringify(d.catalog);
  P.plan([
    { sku: '3302434', name: 'Pass & Seymour GFCI', listCents: 3908, per: 'ea' },
    { sku: '22590', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
      forPart: '60 A 3-pole breaker', catalogNo: 'B360' },
  ], d.catalog);
  assert.strictEqual(JSON.stringify(d.catalog), before);
});

// A variant is counted the way the part it hangs under is counted, whatever
// QED quotes it by. QED sells fittings "per hundred" — a bag of a hundred —
// and reading that as a length put a connector on the walk asking him how many
// FEET he wanted. The generic decides, exactly the way it decides the drawer.
test('plan: an option is counted the way its generic is counted', () => {
  const d = catalogWith([
    { name: '1/2" EMT connector (setscrew)', category: 'boxes', unit: 'ea' },
    { name: '#12 THHN', category: 'wire', unit: 'roll' },
  ]);
  const rows = [
    { sku: '1', name: '1/2" EMT Set Screw Connector', listCents: 6900, per: 'c',
      forPart: '1/2" EMT connector (setscrew)', catalogNo: '230' },
    { sku: '2', name: 'THHN #12 Stranded BLACK Wire (500ft Spool)', listCents: 18000, per: 'm',
      forPart: '#12 THHN', catalogNo: 'B07827' },
  ];
  const m = P.plan(rows, d.catalog);
  assert.deepStrictEqual(m.creatable.map((c) => c.unit), ['ea', 'roll']);
});

// ---------------------------------------------------------------------------
// v3.2: the parts an import makes
// ---------------------------------------------------------------------------
// newParts turns what plan() said it WOULD create into catalog parts, shaped
// exactly like the ones Store.emptyData seeds and the ones + New part builds,
// with two optional fields on top: which generic this is an option of, and the
// stamp that says the import put it here rather than his own thumb.
function creatableFor(overrides) {
  return Object.assign({
    row: { sku: '22590', name: 'Siemens B360 3-Pole 60 Amp Circuit Breaker', listCents: 9900, per: 'ea',
      forPart: '60 A 3-pole breaker', catalogNo: 'B360' },
    name: '60 A 3-pole breaker · B360',
    unit: 'ea',
    category: 'gear',
    seedPart: null,
  }, overrides || {});
}

function counter() {
  let i = 0;
  return () => 'new' + (i += 1);
}

test('newParts builds a catalog part, stamped and linked', () => {
  const generic = { id: 'g1', name: '60 A 3-pole breaker', category: 'gear', unit: 'ea' };
  const made = P.newParts([creatableFor({ seedPart: generic })], '2026-09-09', counter());
  assert.strictEqual(made.length, 1);
  const p = made[0];
  assert.deepStrictEqual(p, {
    id: 'new1',
    category: 'gear',
    name: '60 A 3-pole breaker · B360',
    unit: 'ea',
    lastCostCents: null,
    lastListCents: 9900,
    uses: 0,
    hidden: false,
    sku: '22590',
    supplierName: 'Siemens B360 3-Pole 60 Amp Circuit Breaker',
    priceCheckedISO: '2026-09-09',
    variantOf: 'g1',
    source: { kind: 'qed', checkedISO: '2026-09-09' },
  });
});

// The same keys the seed catalog carries, so a part the import made and a part
// he typed are the same kind of thing everywhere downstream: the walk, the
// paper, the validator on the next save.
test('newParts: the shape is the seed catalog shape, plus the two optional fields', () => {
  const made = P.newParts([creatableFor()], '2026-09-09', counter());
  const seeded = Object.keys(S.emptyData().catalog[0]).sort();
  assert.deepStrictEqual(Object.keys(made[0]).sort(), seeded.concat(['source']).sort());
});

// A part with nothing to hang under carries no variantOf at all rather than a
// null one: absent is what "stands on its own" is spelled as everywhere else
// in this file, and it is what the walk's rules read.
test('newParts: no generic means no variantOf key', () => {
  const made = P.newParts([creatableFor()], '2026-09-09', counter());
  assert.strictEqual('variantOf' in made[0], false);
  assert.deepStrictEqual(made[0].source, { kind: 'qed', checkedISO: '2026-09-09' });
});

// The price is converted into the unit the part is actually counted in, the
// same arithmetic an update goes through. A per QED sells by that cannot cross
// into his unit leaves the part with no bill-at price rather than a guess.
test('newParts: the price crosses into the part unit, or does not come at all', () => {
  const perC = creatableFor({ unit: 'ft', name: '1" EMT · 101543',
    row: { sku: '3362', name: "1\" x 10' Steel EMT Conduit", listCents: 7679, per: 'c' } });
  const perRoll = creatableFor({ unit: 'roll', name: '#12 THHN · B07827',
    row: { sku: 'x', name: 'THHN #12 (500ft Spool)', listCents: 18000, per: 'm' } });
  const made = P.newParts([perC, perRoll], '2026-09-09', counter());
  assert.strictEqual(made[0].lastListCents, 77);
  assert.strictEqual(made[1].lastListCents, null);
});

// The supplier's own title is what prints on the paper, and it wears the same
// 120-character ceiling here that it wears everywhere else it is stored.
test('newParts: the supplier name is capped at 120', () => {
  const long = creatableFor({ row: { sku: '1', name: 'z'.repeat(200), listCents: 100, per: 'ea' } });
  const made = P.newParts([long], '2026-09-09', counter());
  assert.strictEqual(made[0].supplierName.length, 120);
});

test('newParts: nothing to create is an empty list, not a null', () => {
  assert.deepStrictEqual(P.newParts([], '2026-09-09', counter()), []);
});

// The confirm is the one moment he can still say no, so it says how many parts
// are about to appear on his walk and names a handful of them.
test('summaryText names the new parts, at most five of them', () => {
  const mk = (name) => ({ name });
  const three = P.summaryText({ matched: [], unmatched: [], mismatched: [], duplicates: [],
    creatable: ['A', 'B', 'C'].map(mk) });
  assert.match(three, /3 new parts/);
  assert.match(three, /A, B, C\./);

  const seven = P.summaryText({ matched: [], unmatched: [], mismatched: [], duplicates: [],
    creatable: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(mk) });
  assert.match(seven, /A, B, C, D, E, and 2 more\./);

  const one = P.summaryText({ matched: [], unmatched: [], mismatched: [], duplicates: [], creatable: [mk('A')] });
  assert.match(one, /1 new part\b/);
});

// A summary with nothing to create says nothing about new parts, and the
// sentence a file with no creatable rows always gave is unchanged.
test('summaryText: no creatable rows, no new-parts sentence', () => {
  const m = { matched: [{ part: { name: 'GFCI' }, newListCents: 200, oldListCents: 200, changePct: 0 }],
    unmatched: [], mismatched: [], duplicates: [], creatable: [] };
  assert.strictEqual(P.summaryText(m), '1 of your parts matched.');
  assert.doesNotMatch(P.summaryText(m), /new part/);
});

// A file that matched nothing and creates everything must not tell him to go
// put part numbers on his parts: it is about to put them there itself.
test('summaryText: creating parts is not an empty-handed file', () => {
  const t = P.summaryText({ matched: [], unmatched: [], mismatched: [], duplicates: [],
    creatable: [{ name: 'A' }, { name: 'B' }] });
  assert.doesNotMatch(t, /Put the part numbers/);
  assert.doesNotMatch(t, /None of your parts got a new price/);
  assert.match(t, /^2 new parts/);
});

// Every sentence on the confirm ends with a period, and there is no em dash
// anywhere in it: this is copy he reads on a phone in a plant.
test('summaryText: full stops, and no em dash', () => {
  const t = P.summaryText({
    matched: [{ part: { name: 'GFCI' }, newListCents: 400, oldListCents: 200, changePct: 100 }],
    unmatched: [{ sku: 'x' }],
    mismatched: [{ part: { name: 'Cord' }, reason: 'x' }],
    duplicates: [{ sku: 'y' }],
    creatable: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  });
  assert.match(t, /3 new parts/);
  assert.strictEqual(t.indexOf('—'), -1, 'no em dash in the confirm');
  t.split('. ').forEach((s) => assert.ok(s.trim() !== '', 'no empty sentence'));
  assert.ok(t.endsWith('.'), 'the last sentence ends with a period');
});

// TWO PARTS WITH ONE QED NUMBER IS A TYPO, and match() has always said so
// about the catalog. The real 9/09 file carries five products twice under two
// different generic names, and creating both would put two parts on his phone
// that the very next import cannot tell apart: the second one would never be
// found again, because a part is looked up by its number and the first one
// wins. The first row makes the part and the second repeats it.
test('plan: two rows with one QED number make one part, not two', () => {
  const d = catalogWith([]);
  const rows = [
    { sku: '165', name: 'THHN #8 Stranded BLACK Wire', listCents: 40000, per: 'm',
      forPart: '#8 THHN', catalogNo: 'B03673' },
    { sku: '165', name: 'THHN #8 Stranded BLACK Wire', listCents: 40000, per: 'm',
      forPart: 'WIC. THHN 8 STR BLK', catalogNo: 'B03673' },
  ];
  const m = P.plan(rows, d.catalog);
  assert.strictEqual(m.creatable.length, 1);
  assert.strictEqual(m.creatable[0].name, '#8 THHN · B03673');
  assert.deepStrictEqual(m.duplicates, [rows[1]]);
});
