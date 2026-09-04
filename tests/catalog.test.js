const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../catalog.js');

// A stand-in catalog with one of every case that matters: two categories that
// both answer "3/4", a hidden part, a rentals part, and a use-count tie.
function part(category, name, extra) {
  return Object.assign({ id: name, category, name, unit: 'ea', lastCostCents: null, uses: 0, hidden: false }, extra || {});
}

const CATALOG = [
  part('conduit', '3/4" EMT', { uses: 9 }),
  part('conduit', '1" EMT'),
  part('conduit', '3/4" rigid', { uses: 2 }),
  part('conduit', '3/4" retired', { hidden: true, uses: 99 }),
  part('boxes', '3/4" hubs', { uses: 4 }),
  part('boxes', 'J-box 4x4'),
  part('rentals', 'Boom lift', { uses: 7 }),
  part('rentals', 'Scissor lift'),
];

const names = (list) => list.map((p) => p.name);

// ---------------------------------------------------------------------------
// matches — which parts to offer, and in what order
// ---------------------------------------------------------------------------

test('matches: hidden parts are never offered, however often they were used', () => {
  // The hidden one has the highest use count in the file, so if hidden were
  // checked after sorting it would be sitting at the top of the list.
  assert.deepEqual(names(C.matches(CATALOG, { category: 'conduit' })), ['3/4" EMT', '3/4" rigid', '1" EMT']);
  assert.ok(!names(C.matches(CATALOG, { query: '3/4' })).includes('3/4" retired'));
});

test('matches: an empty query is the one category', () => {
  assert.deepEqual(names(C.matches(CATALOG, { category: 'boxes' })), ['3/4" hubs', 'J-box 4x4']);
  // Whitespace is not a search.
  assert.deepEqual(names(C.matches(CATALOG, { category: 'boxes', query: '   ' })), ['3/4" hubs', 'J-box 4x4']);
  // A category nothing is in is empty, not everything.
  assert.deepEqual(C.matches(CATALOG, { category: 'lighting' }), []);
});

test('matches: a query crosses categories, so "3/4" finds the hubs too', () => {
  // The whole point of the search field: he is standing at a rack of fittings
  // and does not want to remember which drawer the app filed them under.
  assert.deepEqual(
    names(C.matches(CATALOG, { category: 'lighting', query: '3/4' })),
    ['3/4" EMT', '3/4" hubs', '3/4" rigid']
  );
  // Case doesn't matter, and neither does the category he came in through.
  assert.deepEqual(names(C.matches(CATALOG, { query: 'emt' })), ['3/4" EMT', '1" EMT']);
});

test('matches: rentals stay out of the material lists unless asked for', () => {
  // A lift priced as a material line would take material markup and land in
  // the material total. It has to be unreachable by accident.
  assert.deepEqual(names(C.matches(CATALOG, { query: 'lift' })), []);
  assert.deepEqual(names(C.matches(CATALOG, { category: 'rentals' })), []);
  assert.deepEqual(
    names(C.matches(CATALOG, { query: 'lift', includeRentals: true })),
    ['Boom lift', 'Scissor lift']
  );
  assert.deepEqual(
    names(C.matches(CATALOG, { category: 'rentals', includeRentals: true })),
    ['Boom lift', 'Scissor lift']
  );
});

test('matches: most-used first, ties broken by name', () => {
  const tied = [
    part('gear', 'Contactor', { uses: 3 }),
    part('gear', 'Breaker', { uses: 3 }),
    part('gear', 'VFD', { uses: 5 }),
    part('gear', 'Ammeter'),
  ];
  assert.deepEqual(names(C.matches(tied, { category: 'gear' })), ['VFD', 'Breaker', 'Contactor', 'Ammeter']);
});

test('matches: a missing or junk catalog is an empty list, not a throw', () => {
  assert.deepEqual(C.matches(undefined, { category: 'conduit' }), []);
  assert.deepEqual(C.matches(null, {}), []);
  assert.deepEqual(C.matches([null, { name: 'no hidden flag' }], { query: 'no' }), []);
  assert.deepEqual(names(C.matches(CATALOG)), []); // no options: no category, no query
});

// ---------------------------------------------------------------------------
// fitWithin — how big a photo is after it is shrunk
// ---------------------------------------------------------------------------

test('fitWithin: a phone photo comes down to the long edge, keeping its shape', () => {
  assert.deepEqual(C.fitWithin(4000, 3000, 1600), { w: 1600, h: 1200, scale: 0.4 });
  assert.deepEqual(C.fitWithin(3000, 4000, 1600), { w: 1200, h: 1600, scale: 0.4 });
});

test('fitWithin: a photo already inside the box is left exactly as it is', () => {
  // Never upscale: a bigger file with no more detail in it is pure cost.
  assert.deepEqual(C.fitWithin(800, 600, 1600), { w: 800, h: 600, scale: 1 });
  assert.deepEqual(C.fitWithin(1600, 1600, 1600), { w: 1600, h: 1600, scale: 1 });
});

test('fitWithin: whole pixels, and never zero', () => {
  const r = C.fitWithin(1001, 333, 100);
  assert.ok(Number.isInteger(r.w) && Number.isInteger(r.h));
  assert.deepEqual([r.w, r.h], [100, 33]);
  // A sliver of an image still has to be at least one pixel tall to draw.
  assert.deepEqual(C.fitWithin(4000, 1, 100).h, 1);
});

test('fitWithin: anything that is not a size answers zero', () => {
  // The caller reads {0,0} as "that file is not an image" and says so.
  for (const bad of [[0, 100], [100, 0], [-4, 4], [NaN, 10], [Infinity, 10], ['4000', 3000]]) {
    assert.deepEqual(C.fitWithin(bad[0], bad[1], 1600), { w: 0, h: 0, scale: 0 });
  }
  assert.deepEqual(C.fitWithin(4000, 3000, 0), { w: 0, h: 0, scale: 0 });
});
