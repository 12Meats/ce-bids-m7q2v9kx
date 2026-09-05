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

test('sizeKey: a name with no size anywhere in it has no key', () => {
  ['Contactor', 'LED high bay', 'Cat6', 'T8 LED tube', 'Motor starter NEMA 0', 'Photo eye']
    .forEach((n) => assert.equal(C.sizeKey(n), null, n));
});

// A CABLE CONFIGURATION IS A SIZE, JUST NOT AN INCH. '10/4 SO cord' is four
// conductors of #10, and the gauge in front of the slash is what he picks it
// by, so it runs the wire scale: 14 under 12 under 10, the same way #14 THHN
// runs under #12 THHN.
test('sizeKey: a cable configuration reads its gauge off the front, on the wire scale', () => {
  assert.equal(C.sizeKey('10/4 SO cord'), C.sizeKey('#10 THHN'));
  assert.equal(C.sizeKey('12/4 SO cord'), C.sizeKey('#12 THHN'));
  assert.equal(C.sizeKey('14/4 VFD cable'), 986);
  assert.equal(C.sizeKey('6/4 VFD cable'), 994);
  const cord = ['14/4 VFD cable', '12/4 VFD cable', '10/4 VFD cable', '8/4 VFD cable', '6/4 VFD cable'];
  const keys = cord.map(C.sizeKey);
  keys.forEach((k, i) => { if (i) assert.ok(k > keys[i - 1], cord[i] + ' is bigger than ' + cord[i - 1]); });
  // How many conductors is not how big it is: 12/2 and 12/3 are both #12, and
  // the name breaks the tie.
  assert.equal(C.sizeKey('12/2 MC cable'), C.sizeKey('12/3 MC cable'));
  // The conductor count comes out of the family with the gauge, so the MC, the
  // SOOW and the VFD stay three blocks and do not shuffle into each other.
  assert.equal(C.familyKey('12/2 MC cable'), 'mc cable');
  assert.equal(C.familyKey('10/3 SOOW cord'), 'soow cord');
  assert.equal(C.familyKey('8/4 VFD cable'), 'vfd cable');
  // And the pipe's own fractions are still inches, not gauges: nothing under
  // #6 is a cable, and 1/2" and 3/4" are the two the pipe uses.
  assert.equal(C.sizeKey('3/4" EMT'), 0.75);
  assert.equal(C.sizeKey('3/4 EMT'), null);
  assert.equal(C.sizeKey('1/2 EMT'), null);
});

// GEAR IS RATED, NOT MEASURED. Read as text the breakers came off the shelf
// 100, 15, 20, 200, 30, 60 — which is nobody's panel schedule.
test('sizeKey reads a rating wherever it sits in the name, and keeps the units apart', () => {
  const asc = (list) => {
    const keys = list.map(C.sizeKey);
    keys.forEach((k, i) => {
      assert.ok(typeof k === 'number' && isFinite(k), list[i] + ' has no key');
      if (i) assert.ok(k > keys[i - 1], list[i] + ' does not sort above ' + list[i - 1]);
    });
    return keys;
  };
  const amps = asc(['15 A 1-pole breaker', '20 A 1-pole breaker', '30 A 1-pole breaker',
    '60 A 3-pole breaker', '100 A 3-pole breaker', '200 A 3-pole breaker']);
  const hp = asc(['VFD 1 HP', 'VFD 3 HP', 'VFD 10 HP', 'VFD 50 HP']);
  const kva = asc(['Transformer 15 kVA', 'Transformer 45 kVA', 'Transformer 75 kVA']);
  const watts = asc(['LED high bay 100 W', 'LED high bay 240 W']);
  const boxes = asc(['NEMA 4X S.S. 6x6', 'NEMA 4X S.S. 8x8', 'NEMA 4X S.S. 10x10',
    'NEMA 4X S.S. 12x12']);
  // A band each, so one number can be compared without ever saying that 15
  // amps and 15 horsepower are the same size.
  const band = (k) => Math.floor(k / 1000);
  [amps, hp, kva, watts, boxes].forEach((keys) => {
    assert.strictEqual(new Set(keys.map(band)).size, 1);
  });
  assert.strictEqual(new Set([amps, hp, kva, watts, boxes].map((k) => band(k[0]))).size, 5);
  // The stainless in "NEMA 4X" is not a dimension, and a trade size still wins
  // over a rating when the name leads with one.
  assert.strictEqual(C.sizeKey('NEMA 4X S.S. 6x6'), C.sizeKey('J-box 6x6'));
  assert.strictEqual(C.sizeKey('1-1/4" EMT'), 1.25);
});

// familyKey is sizeKey asked backwards: what is left when the size is out.
test('familyKey is the name without its size, and a sizeless name is its own', () => {
  assert.strictEqual(C.familyKey('1-1/4" EMT'), 'emt');
  assert.strictEqual(C.familyKey('1/2" EMT'), 'emt');
  assert.strictEqual(C.familyKey('15 A 1-pole breaker'), '1-pole breaker');
  assert.strictEqual(C.familyKey('200 A 3-pole breaker'), '3-pole breaker');
  assert.strictEqual(C.familyKey('VFD 10 HP'), 'vfd');
  assert.strictEqual(C.familyKey('NEMA 4X S.S. 12x12'), 'nema 4x s.s.');
  assert.strictEqual(C.familyKey('Contactor'), 'contactor');
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

// ---------------------------------------------------------------------------
// THE WHOLE SEED LIST, THROUGH THE SORT
// ---------------------------------------------------------------------------
// The parts list is 198 names now, and its ONE hard rule is that every name is
// written the way sizeKey reads a size. A name that parses wrong does not
// crash anything: it quietly sorts into the wrong place on the rack, which is
// exactly the bug the sort was written to fix. So the whole list goes through
// it here, not a sample of it.
const Store = require('../storage.js');
const SEED = Store.emptyData().catalog;

test('every seeded part name goes through sizeKey without a crash or a NaN', () => {
  SEED.forEach((p) => {
    const k = C.sizeKey(p.name);
    assert.ok(k === null || (typeof k === 'number' && isFinite(k)),
      p.name + ' has an unreadable size: ' + k);
  });
});

test('every seeded part has a category, a unit and a straight-quoted name', () => {
  const seen = new Set();
  SEED.forEach((p) => {
    assert.ok(p.unit, p.name + ' has no unit');
    assert.strictEqual(p.name, C.straighten(p.name), p.name + ' is not stored straight-quoted');
    const key = C.normalizeName(p.name);
    assert.strictEqual(seen.has(key), false, 'two seeded parts named ' + p.name);
    seen.add(key);
  });
});

// Conduit is the family the sort exists for: every one of its names carries a
// trade size, so a null anywhere in it is a name written the wrong way round
// ("EMT 1-1/4" instead of '1-1/4" EMT').
test('every seeded conduit name carries a trade size', () => {
  SEED.filter((p) => p.category === 'conduit').forEach((p) => {
    assert.notStrictEqual(C.sizeKey(p.name), null, p.name + ' has no readable trade size');
  });
});

// The order he browses in, per category, off a catalog nobody has used yet:
// one family at a time, each family in size order, and the families with no
// size in them after all the families that have one. That last rule is the
// old "sizeless last", moved up from the part to the family it belongs to.
test('each category browses family by family, sizes ascending inside each', () => {
  ['conduit', 'wire', 'boxes', 'lighting', 'gear', 'rentals'].forEach((category) => {
    const list = C.matches(SEED, { category, includeRentals: true });
    assert.ok(list.length > 0, category + ' is empty');
    const seen = new Set();
    let family = null;
    let last = -Infinity;
    let sawSizeless = false;
    list.forEach((p) => {
      const f = C.familyKey(p.name);
      const k = C.sizeKey(p.name);
      if (f !== family) {
        assert.strictEqual(seen.has(f), false,
          category + ': ' + f + ' is split into two runs');
        seen.add(f);
        family = f;
        last = -Infinity;
      }
      if (k === null) { sawSizeless = true; return; }
      assert.strictEqual(sawSizeless, false,
        category + ': ' + p.name + ' is sized and comes after a family that is not');
      assert.ok(k >= last, category + ': ' + p.name + ' (' + k + ') sorts under ' + last);
      last = k;
    });
  });
});

// The two lists he actually reads down, spelled out. Conduit is the reason
// the family rule exists: sorted by size alone it was 1/2" EMT, 1/2" PVC,
// 1/2" rigid, 1/2" seal-tight, 3/4" EMT — six materials shuffled together.
test('conduit browses one material at a time, smallest first', () => {
  const list = C.matches(SEED, { category: 'conduit' }).map((p) => p.name);
  assert.deepStrictEqual(list.slice(0, 8), [
    '1/2" EMT', '3/4" EMT', '1" EMT', '1-1/4" EMT', '1-1/2" EMT', '2" EMT',
    '1/2" PVC', '3/4" PVC',
  ]);
});

// Wire is the list the cable rule was written for. Sorted as text it read
// 10/2 MC, 10/3 MC, 10/3 SOOW, 10/4 SOOW, 10/4 VFD, 12/2 MC — every family
// shuffled into every other, and the #10 cord above the #12 cord inside each.
test('wire browses family by family, and each cable family climbs by gauge', () => {
  const list = C.matches(SEED, { category: 'wire' }).map((p) => p.name);
  assert.deepStrictEqual(list.slice(0, 20), [
    '#6 bare copper ground', '#4 bare copper ground', '#2 bare copper ground',
    '12/2 MC cable', '12/3 MC cable', '10/2 MC cable', '10/3 MC cable',
    '12/3 SOOW cord', '12/4 SOOW cord', '10/3 SOOW cord', '10/4 SOOW cord',
    '8/3 SOOW cord', '8/4 SOOW cord',
    '#14 THHN', '#12 THHN', '#10 THHN', '#8 THHN', '#6 THHN', '#4 THHN', '#2 THHN',
  ]);
  assert.deepStrictEqual(list.filter((n) => n.indexOf('VFD') !== -1),
    ['14/4 VFD cable', '12/4 VFD cable', '10/4 VFD cable', '8/4 VFD cable', '6/4 VFD cable']);
});

test('gear browses by rating, not by the first digit of the name', () => {
  const list = C.matches(SEED, { category: 'gear' }).map((p) => p.name);
  assert.deepStrictEqual(list.slice(0, 8), [
    '15 A 1-pole breaker', '20 A 1-pole breaker', '30 A 1-pole breaker',
    '20 A 2-pole breaker', '30 A 2-pole breaker', '60 A 2-pole breaker',
    '30 A 3-pole breaker', '60 A 3-pole breaker',
  ]);
  const vfd = list.filter((n) => n.indexOf('VFD') === 0);
  assert.deepStrictEqual(vfd, ['VFD 1 HP', 'VFD 3 HP', 'VFD 5 HP', 'VFD 10 HP',
    'VFD 20 HP', 'VFD 30 HP', 'VFD 50 HP']);
});

// The two scales sizeKey runs, on the names the seed actually ships, because
// getting either one backwards puts 1-1/4" in front of 1/2" or #10 in front of
// #2 — the order a computer reads and nobody else does.
test('the seeded families size the way the rack does', () => {
  assert.deepStrictEqual(['1/2" EMT', '3/4" EMT', '1" EMT', '1-1/4" EMT', '1-1/2" EMT', '2" EMT'].map(C.sizeKey),
    [0.5, 0.75, 1, 1.25, 1.5, 2]);
  assert.deepStrictEqual(['#14 THHN', '#2 THHN', '#1 THHN', '1/0 THHN', '4/0 THHN'].map(C.sizeKey),
    [986, 998, 999, 1001, 1004]);
  // A cable configuration runs the wire scale, not the inches: '12/3 SOOW cord'
  // is three conductors of #12, and reading it as four inches would file it
  // with the pipe.
  assert.deepStrictEqual(['14/4 VFD cable', '12/3 SOOW cord', '10/4 VFD cable', '8/3 SOOW cord',
    '6/4 VFD cable'].map(C.sizeKey), [986, 988, 990, 992, 994]);
  assert.strictEqual(C.sizeKey('12/2 MC cable'), 988);
});

// Every fitting family covers every conduit size. The point of the bigger list
// was never the count: it was standing under a rack with 1-1/2" in his hand.
test('every fitting family covers every conduit size', () => {
  const sizes = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"'];
  ['EMT', 'rigid', 'S.S. conduit', 'PVC', 'seal-tight'].forEach((family) => {
    sizes.forEach((size) => {
      assert.ok(SEED.some((p) => p.name === size + ' ' + family), 'no ' + size + ' ' + family);
    });
  });
  // A fitting says what it fits: the setscrew connector and the liquidtight
  // one are not the same part, and neither are the EMT and rigid couplings.
  ['EMT connector (setscrew)', 'EMT coupling', 'liquidtight connector', 'rigid coupling',
    'LB', 'hub', 'one-hole strap'].forEach((family) => {
    sizes.forEach((size) => {
      assert.ok(SEED.some((p) => p.name === size + ' ' + family), 'no ' + size + ' ' + family);
    });
  });
});

// ---------------------------------------------------------------------------
// nearDuplicates — the same part, spelled his own way
// ---------------------------------------------------------------------------

test('nearDuplicates forgives the plural, the quotes and the word order, and nothing else', () => {
  const standard = Store.standardCatalogNames();
  const mine = [
    part('boxes', '3/4" hubs'),
    part('boxes', '1" hubs'),
    part('boxes', 'LB 3/4"'),
    part('boxes', '3/4" LB'),          // already the standard spelling
    part('conduit', '3/4" EMT'),
    part('gear', 'Contactor'),
  ];
  const hits = C.nearDuplicates(mine, standard);
  assert.deepStrictEqual(hits.map((h) => [h.name, h.standard]), [
    ['3/4" hubs', '3/4" hub'],
    ['1" hubs', '1" hub'],
    ['LB 3/4"', '3/4" LB'],
  ]);
  // It hands back the row itself, because hiding it is the caller's job.
  assert.strictEqual(hits[0].item, mine[0]);
});

// THE FITTING HE NEVER WROTE THE MATERIAL ON. His list says '3/4" connectors'
// because for twenty years there was one kind in the van; the standard list
// splits them by what they fit, so his name is now shorter than the one that
// replaced it and no amount of plural-forgiving finds the pair.
test('nearDuplicates offers a bare fitting noun against the standard that spells it out', () => {
  const standard = Store.standardCatalogNames();
  const mine = [
    part('boxes', '3/4" connectors'),
    part('boxes', '3/4" couplings'),
    part('boxes', '1" straps'),
    part('boxes', '3/4" EMT connectors'),   // his plural of the standard itself
  ];
  assert.deepStrictEqual(C.nearDuplicates(mine, standard).map((h) => h.name + ' -> ' + h.standard), [
    '3/4" connectors -> 3/4" EMT connector (setscrew)',
    '3/4" couplings -> 3/4" EMT coupling',
    '1" straps -> 1" one-hole strap',
    '3/4" EMT connectors -> 3/4" EMT connector (setscrew)',
  ]);
});

// The guard, which is the half of the rule that matters. A name that ends in a
// MATERIAL is the pipe itself, not a fitting spelled short, and folding '1" EMT'
// into '1" EMT coupling' would take the conduit off his own walk.
test('nearDuplicates never folds a bare family name into a longer one', () => {
  const standard = Store.standardCatalogNames();
  const mine = [
    part('conduit', '3/4" rigid'),     // vs '3/4" rigid coupling'
    part('conduit', '1" EMT'),         // vs '1" EMT coupling'
    part('conduit', '3/4" seal-tight'),
    part('boxes', 'hubs'),             // one word says nothing about the size
  ];
  assert.deepStrictEqual(C.nearDuplicates(mine, standard), []);
});

test('nearDuplicates skips what is already put away, and takes plain strings', () => {
  const standard = ['3/4" hub', 'Cable tugger'];
  assert.deepStrictEqual(
    C.nearDuplicates([part('boxes', '3/4" hubs', { hidden: true })], standard), []);
  assert.deepStrictEqual(C.nearDuplicates(['3/4" HUBS'], standard).map((h) => h.standard), ['3/4" hub']);
  // Not a list, not a name, nothing to say.
  assert.deepStrictEqual(C.nearDuplicates(null, standard), []);
  assert.deepStrictEqual(C.nearDuplicates([{ name: '' }, {}], standard), []);
  assert.deepStrictEqual(C.nearDuplicates(['Tugger'], standard), [],
    'a shorter name is not a spelling of a longer one');
});
