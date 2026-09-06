// tests/fixtures.test.js — THE RELEASE RULE.
//
// Every shipped version leaves a real backup file behind in tests/fixtures/,
// and this test loads every one of them with the CURRENT code. It is the only
// test in the suite whose job is to fail: when a later change to the data
// model quietly stops reading a shape that is sitting on his phone right now,
// this is what says so, before the version that cannot read it ships.
//
// So the rules for anyone editing the schema:
//
//   * DO NOT edit a fixture to make this pass. A fixture is a photograph of a
//     file that already exists in the world; changing it changes nothing about
//     the phone. Add a MIGRATIONS step instead.
//   * Every release adds its own fixture (backup-bids-v2.json, and so on) —
//     a real export from that build, not one hand-written to suit the test.
//   * New bid fields are OPTIONAL with a fallback, which is what lets an old
//     fixture keep loading with no version bump at all.
//
// backup-bids-v2.2.json is this release's own: Schreiber's cooler room, won,
// with a surprise and a change order on it, and a sent bid at a ten-hour day
// that quotes fewer hours than it takes. Both snapshots disagree with the
// Settings sitting beside them.
//
// backup-bids-v2.1.json is the release before it: two bids whose snapshots
// disagree with the Settings sitting beside them, a multi-line area note, a
// checklist with answers on it, and a supply-house link he typed himself.
//
// backup-bids-v1.json is the file the shipped v1 wrote: $65 rate and floor,
// three bids (a draft mid-walk, a sent bid with clauses and a scope, a
// complete one with a job, a surprise and a change order), and — deliberately
// — no forgetAnswers key anywhere, because v1 had no such field.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../storage.js');
const D = require('../docmodel.js');
const BidMath = require('../bidmath.js');

const dir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(dir).filter((f) => /^backup-.*\.json$/.test(f)).sort();

test('there is at least one shipped-version fixture to load', () => {
  assert.ok(files.length > 0, 'tests/fixtures holds no backup-*.json');
});

for (const file of files) {
  test(file + ': loads with the current code and survives a round trip', () => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const d = S.validateImport(text);
    assert.ok(d, file + ' no longer loads — add a MIGRATIONS step, do not edit the fixture');
    assert.strictEqual(S.check(d), true, file + ' loads but would not save again');
    assert.ok(Array.isArray(d.bids) && d.bids.length > 0, file + ' has no bids to price');
  });

  test(file + ': every bid still prices, at every detail level', () => {
    const d = S.validateImport(fs.readFileSync(path.join(dir, file), 'utf8'));
    d.bids.forEach((b) => {
      ['full', 'summary', 'scope'].forEach((level) => {
        const doc = D.build(b, d, level);
        assert.ok(Number.isFinite(doc.totalCents),
          file + ': bid ' + b.number + ' at ' + level + ' priced ' + doc.totalCents);
        assert.ok(Number.isInteger(doc.totalCents),
          file + ': bid ' + b.number + ' at ' + level + ' priced in fractional cents');
      });
    });
  });
}

// The one thing about v1's shape this suite asserts by name, because it is the
// thing v2 added: a bid with no forgetAnswers key is a valid bid, and the walk
// screen has to read it as "nothing answered yet" rather than fall over.
test('backup-bids-v1.json really is a pre-forgetAnswers file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v1.json'), 'utf8'));
  assert.ok(d, 'the v1 fixture does not load');
  assert.strictEqual(d.bids.some((b) => 'forgetAnswers' in b), false,
    'the v1 fixture has grown a v2 field — regenerate it from the shipped v1 shape');
  assert.strictEqual(d.settings.rateCents, 6500, 'the v1 fixture must carry v1 defaults');
  assert.strictEqual(d.settings.floorCents, 6500, 'the v1 fixture must carry v1 defaults');
});

// And the same by name for v2, so the file that is supposed to be the
// photograph of THIS release cannot quietly be regenerated without the fields
// this release added. If one of these ever fails, the fixture is wrong, not
// the assertion.
test('backup-bids-v2.json really is a v2 file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v2.json'), 'utf8'));
  assert.ok(d, 'the v2 fixture does not load');
  assert.strictEqual(d.settings.rateCents, 8500, 'v2 shipped an $85 rate');
  assert.strictEqual(d.settings.floorCents, 8500, 'v2 shipped an $85 floor');
  assert.ok(d.bids.every((b) => b.forgetAnswers && typeof b.forgetAnswers === 'object'),
    'every v2 bid carries the answered checklist');
  assert.ok(d.bids.some((b) => (b.rentals || []).some((r) => typeof r.areaId === 'string')),
    'a rental named on the walk carries the room he was standing in');
  assert.ok(d.bids.some((b) => b.pricing.touched === true),
    'a bid he priced carries pricing.touched, which is what ticks the step strip');
  assert.ok(d.bids.some((b) => b.pricing.cushionPct < 0),
    'bid hours below real hours is a negative cushion, and it has to survive a backup');
  const job = d.bids.map((b) => b.job).find(Boolean);
  assert.ok(job && job.changeOrders.some((co) => (co.areas || []).length === 0 && co.labor.days > 0),
    'a labor-only change order is a v2 shape and belongs in the v2 photograph');
});

// THE NUMBERS THEMSELVES, HARD-CODED.
//
// "It still loads and still prices" is not enough once the pricing math starts
// reading fields the fixtures do not have. These totals were captured from the
// shipped code BEFORE bid-level snapshots existed (v2.1 Task F), so they are
// the photograph of what these two files were worth on his phone. If a change
// to BidMath moves one of them, the fallback that lets an old bid read
// Settings has broken, and every bid already on the phone has silently
// re-priced.
//
// Full / Summary / Scope are the same total by construction: the detail level
// changes what the paper SAYS, never what the job costs.
const FIXTURE_TOTALS = {
  'backup-bids-v1.json': { 3053: 433112, 3054: 370000, 3055: 837460 },
  'backup-bids-v2.json': { 3053: 516992, 3054: 371000, 3055: 1220960 },
  // v2.1's own photograph, priced by the build that wrote it. #1 is a won job
  // with a surprise and a change order on it; #2 is a sent bid at a ten-hour
  // day. Both carry snapshots that DISAGREE with the Settings in the same
  // file, which is the whole point of the file: if the snapshot ever stops
  // being read, these two numbers move.
  'backup-bids-v2.1.json': { 1: 4402070, 2: 547600 },
  // v2.2's own. #1 is Schreiber's cooler room: three men, two rooms, a scissor
  // lift, a threader, and a 12% cushion on a job that was won and then grew a
  // surprise and a change order. #2 is a sent bid worked at a ten-hour day
  // with a NEGATIVE cushion — he is quoting fewer hours than the job takes to
  // get the work, which is allowed and has to survive a backup.
  'backup-bids-v2.2.json': { 1: 2607636, 2: 591060 },
};

for (const file of Object.keys(FIXTURE_TOTALS)) {
  test(file + ': every bid still prices to the cent it always did', () => {
    const d = S.validateImport(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(d, file + ' no longer loads');
    const want = FIXTURE_TOTALS[file];
    assert.strictEqual(d.bids.length, Object.keys(want).length, file + ' has grown or lost a bid');
    d.bids.forEach((b) => {
      ['full', 'summary', 'scope'].forEach((level) => {
        assert.strictEqual(D.build(b, d, level).totalCents, want[b.number],
          file + ': bid ' + b.number + ' at ' + level + ' has re-priced');
      });
    });
  });
}

// The photograph of THIS release, by name. Every field v2.1 added is OPTIONAL,
// which is exactly why one file has to be on record carrying all of them: an
// optional field that quietly stops being read breaks nothing a test can see
// until a phone that has one loads wrong.
test('backup-bids-v2.1.json really is a v2.1 file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v2.1.json'), 'utf8'));
  assert.ok(d, 'the v2.1 fixture does not load');

  // Settings never change an existing bid: both bids were written when burden
  // was 30% and the file's Settings say 25% now, and one of them works a
  // ten-hour day while Settings says eight.
  assert.strictEqual(d.settings.burdenPct, 25);
  assert.strictEqual(d.settings.hoursPerDay, 8);
  assert.ok(d.bids.every((b) => b.pricing.burdenPct === 30),
    'both bids keep the burden they were figured at');
  assert.deepStrictEqual(d.bids.map((b) => b.pricing.hoursPerDay).sort((a, b) => a - b), [8, 10],
    'a bid at ten hours a day sits next to one at eight');
  BidMath.SNAPSHOT_KEYS.forEach((k) => {
    assert.ok(d.bids.every((b) => b.pricing[k] !== undefined),
      'every bid carries the ' + k + ' it was figured at');
  });

  // A wage is stamped on the bid the first time a man lands on it.
  assert.ok(d.bids.every((b) => b.labor.wageCents && Object.keys(b.labor.wageCents).length > 0),
    'every bid carries the wages it was figured at');
  // Three men on one bid, so a crew that grew mid-file is in the photograph.
  assert.ok(d.bids.some((b) => Object.keys(b.labor.wageCents).length === 3));

  // The walk's own writing, which never prints.
  assert.ok(d.bids.some((b) => (b.areas || []).some((a) => typeof a.notes === 'string' && a.notes.indexOf('\n') !== -1)),
    'a multi-line area note is in the photograph');
  d.bids.forEach((b) => {
    ['full', 'summary', 'scope'].forEach((level) => {
      const doc = D.build(b, d, level);
      assert.strictEqual(JSON.stringify(doc).indexOf('Ceiling is 28 ft'), -1,
        'an area note reached the paper at ' + level);
    });
  });

  // The checklist: rows that know what they are, and answers on the bid.
  assert.ok(d.settings.forgetList.every((r) => r && typeof r === 'object' && typeof r.name === 'string'
    && (r.kind === 'item' || r.kind === 'rental')), 'every checklist row carries its kind');
  assert.ok(d.bids.every((b) => b.forgetAnswers && typeof b.forgetAnswers === 'object'));
  assert.ok(d.bids.some((b) => Object.values(b.forgetAnswers).indexOf('added') !== -1));

  // Where "Check price" goes, once he has typed his own supply house in.
  assert.match(d.settings.company.priceSearchUrl, /^https:\/\/.*\{q\}/);

  // The v2.1 seeds, whole.
  assert.strictEqual(d.catalog.length, 210);
  assert.strictEqual(d.settings.equipment.length, 30);
  assert.strictEqual(d.settings.forgetList.length, 19);
  assert.strictEqual(d.settings.notePhrases.length, 14);
  assert.strictEqual(d.settings.clauses.length, 27);
});

// The photograph of THIS release. v2.2 added no field to the file — it is a
// keypad rule, a shorter Settings index and an order over the wire families —
// so what this asserts is that a real export from the v2.2 build still carries
// everything v2.1 put in one, and that the new order is visible in it.
test('backup-bids-v2.2.json really is a v2.2 file', () => {
  const C = require('../catalog.js');
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v2.2.json'), 'utf8'));
  assert.ok(d, 'the v2.2 fixture does not load');

  // Settings never change an existing bid, still: both bids were figured at a
  // 30% burden and the file's Settings say 25% now, and one of them works a
  // ten-hour day while Settings says eight.
  assert.strictEqual(d.settings.burdenPct, 25);
  assert.strictEqual(d.settings.hoursPerDay, 8);
  assert.ok(d.bids.every((b) => b.pricing.burdenPct === 30),
    'both bids keep the burden they were figured at');
  assert.deepStrictEqual(d.bids.map((b) => b.pricing.hoursPerDay).sort((a, b) => a - b), [8, 10]);
  BidMath.SNAPSHOT_KEYS.forEach((k) => {
    assert.ok(d.bids.every((b) => b.pricing[k] !== undefined),
      'every bid carries the ' + k + ' it was figured at');
  });

  // Three men on one bid, wages stamped where they landed.
  assert.ok(d.bids.every((b) => b.labor.wageCents && Object.keys(b.labor.wageCents).length > 0));
  assert.ok(d.bids.some((b) => Object.keys(b.labor.wageCents).length === 3));

  // Bid hours under real hours is a negative cushion, and it is on this file.
  assert.ok(d.bids.some((b) => b.pricing.cushionPct < 0));
  assert.ok(d.bids.every((b) => b.pricing.touched === true));

  // The walk's own writing, which never prints.
  assert.ok(d.bids.some((b) => (b.areas || []).some((a) => typeof a.notes === 'string'
    && a.notes.indexOf('\n') !== -1)), 'a multi-line area note is in the photograph');
  d.bids.forEach((b) => {
    ['full', 'summary', 'scope'].forEach((level) => {
      assert.strictEqual(JSON.stringify(D.build(b, d, level)).indexOf('Washdown daily'), -1,
        'an area note reached the paper at ' + level);
    });
  });

  // A rental named on the walk carries the room he was standing in, the
  // checklist carries answers, and a won job carries what happened to it.
  assert.ok(d.bids.some((b) => (b.rentals || []).some((r) => typeof r.areaId === 'string')));
  assert.ok(d.bids.some((b) => Object.values(b.forgetAnswers).indexOf('added') !== -1));
  assert.ok(d.bids.some((b) => Object.values(b.forgetAnswers).indexOf('no') !== -1));
  const job = d.bids.map((b) => b.job).find(Boolean);
  assert.ok(job && job.surprises.length === 1 && job.changeOrders.length === 1,
    'the won job carries a surprise and a change order');

  // Where "Check price" goes, once he has typed his own supply house in.
  assert.match(d.settings.company.priceSearchUrl, /^https:\/\/.*\{q\}/);

  // The seeds, whole and unchanged by this release.
  assert.strictEqual(d.catalog.length, 210);
  assert.strictEqual(d.settings.equipment.length, 30);
  assert.strictEqual(d.settings.forgetList.length, 19);
  assert.strictEqual(d.settings.notePhrases.length, 14);
  assert.strictEqual(d.settings.clauses.length, 27);

  // AND THE THING v2.2 IS: the wire tile on this real file opens on THHN.
  const wire = C.matches(d.catalog, { category: 'wire' });
  assert.ok(/THHN$/.test(wire[0].name), 'the wire tile opens on ' + wire[0].name + ', not a THHN');

  // Under the four rows he has actually pulled off this phone — which float
  // to the top on uses, MC cable included, and are supposed to — the rest of
  // the tile is in the standing order this release gave it.
  const families = [];
  wire.filter((p) => !p.uses).forEach((p) => {
    const f = C.familyKey(p.name);
    if (families.indexOf(f) === -1) families.push(f);
  });
  assert.deepStrictEqual(families, ['thhn', 'xhhw', 'mc cable', 'soow cord', 'vfd cable',
    'bare copper ground', 'cat6', 'wire nuts, tape, crimps']);
});

// ---------------------------------------------------------------------------
// THE TWO LIBRARY MOVES, RUN AGAINST A REAL PHONE
// ---------------------------------------------------------------------------
// Both of these are one tap in Settings on a phone with sent paper on it, and
// both used to be able to change what an old bid prints. Neither may.

test('backup-bids-v1.json: resetting the terms library changes no bid on the phone', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v1.json'), 'utf8'));
  const before = d.bids.map((b) => D.build(b, d, 'full').clauses.map((c) => c.title));
  // #3054 is the sent bid, and it carries all nineteen of the old clauses.
  assert.strictEqual(Math.max(...before.map((x) => x.length)), 19);

  const out = S.resetClauseLibrary(d);
  assert.strictEqual(out.added, 27, 'the standard library goes in whole');
  assert.strictEqual(out.hidden, 19, 'the nineteen a bid still names are kept, hidden');

  d.bids.forEach((b, i) => {
    assert.deepStrictEqual(D.build(b, d, 'full').clauses.map((c) => c.title), before[i],
      'bid ' + b.number + ' lost a term it had already promised');
  });
  // And nothing hidden is offered on the next bid he writes.
  assert.strictEqual(d.settings.clauses.filter((c) => !c.hidden).length, out.added);
  assert.ok(S.validateImport(JSON.stringify(d)));

  // The clause that used to name its own thirty days now points at the line
  // the document prints off bid.validityDays, so the paper says one number.
  const k02 = d.settings.clauses.find((c) => !c.hidden && c.title === 'Price and material');
  assert.strictEqual(k02.text.indexOf('30 days'), -1);
  assert.ok(D.build(d.bids[1], d, 'full').terms.some((t) => /^Pricing held \d+ days/.test(t)));
});

test('backup-bids-v1.json: adding the standard parts leaves seven of his own spellings to ask about', () => {
  const C = require('../catalog.js');
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v1.json'), 'utf8'));
  assert.ok(S.addStandardCatalog(d) > 0);
  const dups = C.nearDuplicates(d.catalog, S.standardCatalogNames());
  assert.deepStrictEqual(dups.map((x) => x.name + ' -> ' + x.standard), [
    '3/4" hubs -> 3/4" hub',
    '1" hubs -> 1" hub',
    '3/4" S.S. hubs -> 3/4" S.S. hub',
    'LB 3/4" -> 3/4" LB',
    'LB 1" -> 1" LB',
    // The two he never wrote the material on. The standard list splits the
    // connector by what it fits, so his one row is shorter than both of them.
    '3/4" couplings -> 3/4" EMT coupling',
    '3/4" connectors -> 3/4" EMT connector (setscrew)',
  ]);
  // Hiding them is the answer, never deleting: two of these are on his bids.
  dups.forEach((x) => { x.item.hidden = true; });
  assert.ok(S.validateImport(JSON.stringify(d)));
  assert.deepStrictEqual(C.nearDuplicates(d.catalog, S.standardCatalogNames()), [],
    'once hidden they are not asked about again');
});
