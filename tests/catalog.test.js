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

// ---------------------------------------------------------------------------
// straighten / normalizeName — the iOS quote bug
// ---------------------------------------------------------------------------

test('normalizeName: curly quotes are the same characters as straight ones', () => {
  assert.equal(C.normalizeName('1” S.S. conduit'), '1" s.s. conduit');
  assert.equal(C.normalizeName('1″ EMT'), '1" emt');       // ″ double prime
  assert.equal(C.normalizeName('Andy’s spool'), "andy's spool");
  // Whitespace is collapsed and trimmed, so a stray double space never hides a
  // part from its own name.
  assert.equal(C.normalizeName('  3/4"   EMT '), '3/4" emt');
});

test('straighten: keeps his capitals, fixes only the quotes and the spacing', () => {
  assert.equal(C.straighten('1” S.S. conduit'), '1" S.S. conduit');
  assert.equal(C.straighten('  LB  3/4”  '), 'LB 3/4"');
  assert.equal(C.straighten(null), '');
  assert.equal(C.straighten(42), '42');
});

test('matches: a curly-quote query finds the straight-quote part', () => {
  const cat = [part('conduit', '1" S.S. conduit'), part('conduit', '3/4" EMT')];
  assert.deepEqual(names(C.matches(cat, { query: '1”' })), ['1" S.S. conduit']);
  // And the other way round: a part saved with a curly quote is still found by
  // the straight one an old bid was written with.
  const curly = [part('conduit', '1” S.S. conduit')];
  assert.deepEqual(names(C.matches(curly, { query: '1"' })), ['1” S.S. conduit']);
});

test('matches: "1 in" is 1", and "10 ft" is 10\'', () => {
  const cat = [part('conduit', '1" S.S. conduit'), part('conduit', '3/4" EMT'), part('gear', "10' whip")];
  ['1 in', '1in', '1-in', '1 IN'].forEach((q) => {
    assert.deepEqual(names(C.matches(cat, { query: q })), ['1" S.S. conduit'], q);
  });
  assert.deepEqual(names(C.matches(cat, { query: '3/4in emt' })), ['3/4" EMT']);
  assert.deepEqual(names(C.matches(cat, { query: '10 ft' })), ["10' whip"]);
  // A word that merely starts with "in" is not an inch mark.
  assert.deepEqual(names(C.matches([part('gear', 'Inline fuse')], { query: 'inline' })), ['Inline fuse']);
});

// ---------------------------------------------------------------------------
// sizeKey — the order the parts sit on the rack
// ---------------------------------------------------------------------------

test('sizeKey: reads a trade size off the front of a name', () => {
  assert.equal(C.sizeKey('1/2" EMT'), 0.5);
  assert.equal(C.sizeKey('3/4" EMT'), 0.75);
  assert.equal(C.sizeKey('1" EMT'), 1);
  assert.equal(C.sizeKey('1-1/4" EMT'), 1.25);
  assert.equal(C.sizeKey('1 1/4" EMT'), 1.25);
  assert.equal(C.sizeKey('2" rigid'), 2);
  assert.equal(C.sizeKey('1” S.S. conduit'), 1);   // the curly one too
  assert.equal(C.sizeKey('1 in EMT'), 1);
});

test('sizeKey: wire gauges climb from #14 to 4/0', () => {
  const wire = ['#14 THHN', '#12 THHN', '#10 THHN', '#8 THHN', '#6 THHN', '#4 THHN', '#2 THHN',
    '#1 THHN', '1/0 THHN', '2/0 THHN', '4/0 THHN'];
  const keys = wire.map(C.sizeKey);
  keys.forEach((k, i) => { if (i) assert.ok(k > keys[i - 1], wire[i] + ' is bigger than ' + wire[i - 1]); });
  assert.equal(C.sizeKey('#12 THHN'), 988);
  assert.equal(C.sizeKey('4/0 THHN'), 1004);
});

test('sizeKey: a name with no size in front of it has no key', () => {
  ['J-box 4x4', 'Contactor', 'LED high bay', '20 A breaker', 'Cat6', 'T8 LED tube']
    .forEach((n) => assert.equal(C.sizeKey(n), null, n));
  // A cable configuration is not a fraction of an inch: the inch mark is what
  // makes a fraction a trade size.
  assert.equal(C.sizeKey('10/4 SO cord'), null);
  assert.equal(C.sizeKey('12/4 SO cord'), null);
});

test('matches: a category browses in trade-size order, history still first', () => {
  const conduit = [
    part('conduit', '1-1/4" EMT'),
    part('conduit', '1/2" EMT'),
    part('conduit', '2" rigid'),
    part('conduit', '3/4" EMT'),
    part('conduit', '1" EMT'),
    part('conduit', 'Strut'),
  ];
  assert.deepEqual(names(C.matches(conduit, { category: 'conduit' })),
    ['1/2" EMT', '3/4" EMT', '1" EMT', '1-1/4" EMT', '2" rigid', 'Strut']);

  // His history still outranks the rack: the one he uses is on top.
  const used = conduit.slice();
  used[2] = part('conduit', '2" rigid', { uses: 11 });
  assert.deepEqual(names(C.matches(used, { category: 'conduit' })),
    ['2" rigid', '1/2" EMT', '3/4" EMT', '1" EMT', '1-1/4" EMT', 'Strut']);
});

test('matches: wire browses by gauge, smallest to biggest', () => {
  const wire = ['4/0 THHN', '#10 THHN', '1/0 THHN', '#2 THHN', '#14 THHN', 'Cat6', '#12 THHN']
    .map((n) => part('wire', n));
  assert.deepEqual(names(C.matches(wire, { category: 'wire' })),
    ['#14 THHN', '#12 THHN', '#10 THHN', '#2 THHN', '1/0 THHN', '4/0 THHN', 'Cat6']);
});
