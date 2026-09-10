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
// backup-bids-v3.json is this release's own, and it is the first one that is
// not only bids: the v2.4 file after the Invoices tab arrived. Two customers
// carry a rate, an Attn, an address and a PO; one is hidden; there are two
// projects, five visits logged at the truck, and three invoices off them. Every
// bid total is still the v2.4 number, because nothing invoices did may move a
// bid, and the two invoices that went out are pinned in INVOICE_TOTALS below.
//
// backup-bids-v2.4.json is the release before it: the v2.3 file after a price
// import put a QED part number, QED's name and a new bill-at price on two
// parts. Every bid total is the v2.3 number, which is the whole point.
//
// backup-bids-v2.3.json is the release before it: the v2.2 file with Settings
// moved to a 15% markup, plus one UDA bid whose wire is priced as a lot, whose
// breakers bill at a list price, and whose boxes bill off cost like every line
// before v2.3. The two older bids still price at 18, off their snapshots.
//
// backup-bids-v2.2.json is the release before it: Schreiber's cooler room,
// won, with a surprise and a change order on it, and a sent bid at a ten-hour
// day that quotes fewer hours than it takes. Both snapshots disagree with the
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
  // v2.3's own. Bids 1 and 2 are the v2.2 photograph unchanged, and they pin
  // the rule twice over: Settings moved to a 15% markup after they were
  // written and their snapshots still say 18. Bid 3 is the new shape: a run
  // of wire priced as a lot, two breakers billed at list, one plain line.
  'backup-bids-v2.3.json': { 1: 2607636, 2: 591060, 3: 181040 },
  // v2.4's own: the v2.3 file after a price import. The catalog's bill-at
  // prices moved (the wire to 96, the breaker to 1850) and NOT ONE BID DID:
  // an import is memory for the next bid, never a rewrite of an old one.
  'backup-bids-v2.4.json': { 1: 2607636, 2: 591060, 3: 181040 },
  // v3's own, and the three numbers are the v2.4 numbers to the cent. That is
  // the assertion worth having on this release: projects, visits and invoices
  // are three new arrays on the same document, and not one of them may reach
  // into what a bid is worth. Bid #3 was won and billed between the two files,
  // and being won did not move it either.
  'backup-bids-v3.json': { 1: 2607636, 2: 591060, 3: 181040 },
};

// THE INVOICE NUMBERS, HARD-CODED, the same way and for the same reason.
//
// Only the two that WENT OUT. An invoice a customer is holding is the one
// piece of paper in this app that can never be re-figured: if a change to
// invmath moves one of these, an invoice already paid against says a different
// number than the copy in his customer's hand.
//
// Both are worked by hand in the v3 test below, off the rows, rather than
// copied out of the build that wrote them.
const INVOICE_TOTALS = {
  'backup-bids-v3.json': { 166818: 200100, 166819: 181040 },
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

// The photograph of THIS release. v2.3 added three optional fields, and this
// is the one file on record that carries all of them, so a field that quietly
// stops being read fails here before it fails on his phone.
test('backup-bids-v2.3.json really is a v2.3 file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v2.3.json'), 'utf8'));
  assert.ok(d, 'the v2.3 fixture does not load');

  // Settings moved to 15; the two older bids keep the 18 they were figured at.
  assert.strictEqual(d.settings.markupPct, 15);
  assert.deepStrictEqual(d.bids.map((b) => b.pricing.markupPct).sort((a, b) => a - b), [15, 18, 18]);

  const b = d.bids.find((x) => x.pricing.markupPct === 15);
  const items = b.areas[0].items;
  const lot = items.find((it) => it.lotCents != null);
  const listed = items.find((it) => it.listCents != null && it.lotCents == null);
  const plain = items.find((it) => it.listCents == null && it.lotCents == null);
  assert.ok(lot && listed && plain, 'a lot line, a list line and a plain line are all in the photograph');
  assert.strictEqual(lot.lotCents, 21600);
  assert.strictEqual(lot.listCents, 40, 'the lot line also carries a list, and the lot wins');
  assert.strictEqual(listed.listCents, 1800);

  // The catalog remembers both prices for the parts he put them on.
  const wire = d.catalog.find((p) => p.id === lot.catalogId);
  const breaker = d.catalog.find((p) => p.id === listed.catalogId);
  assert.strictEqual(wire.lastCostCents, 38); assert.strictEqual(wire.lastListCents, 40);
  assert.strictEqual(breaker.lastCostCents, 1500); assert.strictEqual(breaker.lastListCents, 1800);
  // Absent is "not set", the same as null: the 210 parts inherited from the
  // v2.2 file never grow the key (nothing normalizes on restore, by design),
  // so the check is loose. Only the two parts he priced carry a number.
  assert.ok(d.catalog.every((p) => p.lastListCents == null || Number.isInteger(p.lastListCents)));

  // What the paper prints, by hand: quantity, blank, amount for the lot;
  // round(1800 × 1.15) = 2070 a breaker; round(1000 × 1.15) = 1150 a box.
  const rows = D.build(b, d, 'full').sections.find((s) => s.title === 'Materials').rows;
  assert.deepStrictEqual(rows.map((r) => [r.qtyText, r.unitCents, r.cents]), [
    ['500 ft', null, 21600],
    ['2 ea', 2070, 4140],
    ['2 ea', 1150, 2300],
  ]);
  // Cost is cost: 500 × 38 + 2 × 1500 + 2 × 1000.
  assert.strictEqual(BidMath.costStack(b, d.settings).materialCost, 24000);

  // Everything v2.2 put in a file is still in this one.
  assert.ok(d.bids.some((bb) => bb.pricing.cushionPct < 0));
  assert.ok(d.bids.some((bb) => (bb.rentals || []).some((r) => typeof r.areaId === 'string')));
  const job = d.bids.map((bb) => bb.job).find(Boolean);
  assert.ok(job && job.surprises.length === 1 && job.changeOrders.length === 1);
  assert.strictEqual(d.catalog.length, 210);
  assert.strictEqual(d.settings.clauses.length, 27);
});

test('backup-bids-v2.4.json really is a v2.4 file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v2.4.json'), 'utf8'));
  assert.ok(d, 'the v2.4 fixture does not load');
  const withSku = d.catalog.filter((p) => typeof p.sku === 'string');
  assert.strictEqual(withSku.length, 2, 'two parts carry a QED part number');
  assert.ok(withSku.every((p) => typeof p.supplierName === 'string' && p.priceCheckedISO === '2026-09-08'));
  const wire = withSku.find((p) => p.unit === 'ft');
  const breaker = withSku.find((p) => p.unit === 'ea');
  assert.strictEqual(wire.lastListCents, 96);
  assert.strictEqual(breaker.lastListCents, 1850);
  // The bid that used the wire at 40 list and 21600 the lot still says so.
  const b = d.bids.find((x) => x.pricing.markupPct === 15);
  const line = b.areas[0].items.find((it) => it.catalogId === wire.id);
  assert.strictEqual(line.listCents, 40);
  assert.strictEqual(line.lotCents, 21600);
  // Every other part is untouched: absent or null, never a stray string.
  assert.ok(d.catalog.every((p) => p.sku == null || typeof p.sku === 'string'));
});

// The photograph of THIS release. v3 put three whole arrays on the document
// (projects, logs, invoices) and six optional keys on a customer, and every one
// of them is optional, which is exactly why one file has to be on record
// carrying all of them: an optional key that quietly stops being read breaks
// nothing a test can see until a phone that has one loads wrong.
//
// The money here is worked BY HAND off the rows, not copied out of the build
// that wrote the file. An invoice already in a customer's hands is the one
// thing in this app that can never be re-figured.
test('backup-bids-v3.json really is a v3 file', () => {
  const I = require('../invmath.js');
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v3.json'), 'utf8'));
  assert.ok(d, 'the v3 fixture does not load');

  // The two Settings keys v3 added, and a counter set to his real book.
  assert.strictEqual(d.settings.invoiceTerms, 'Upon receipt');
  assert.strictEqual(d.settings.nextInvoiceNumber, 166821);
  assert.strictEqual(S.effectiveNextInvoiceNumber(d), 166821,
    'the seed is ahead of every number on the file, so it stands as it is');
  assert.strictEqual(d.settings.nextNumber, 4, 'the bid counter did not move');

  // The customer card: a rate, who it is addressed to, two lines of address,
  // a PO, and one customer whose terms beat the Settings default.
  const uda = d.customers.find((c) => c.name === 'UDA');
  const sch = d.customers.find((c) => c.name === 'Schreiber Foods');
  assert.strictEqual(uda.rateCents, 8500);
  assert.strictEqual(uda.attn, 'Kellen');
  assert.strictEqual(uda.address.split('\n').length, 2, 'two lines of address in the photograph');
  assert.strictEqual(uda.po, '2526-4213');
  assert.strictEqual(sch.rateCents, 6500, 'a second customer on a rate of their own');
  assert.strictEqual(sch.terms, 'Net 30', 'and terms of their own, which beat the default');

  // A HIDDEN customer. He is on bid #2, so hiding is the only answer the app
  // offers: a customer anything names is hidden, never deleted.
  const hidden = d.customers.filter((c) => c.hidden === true);
  assert.strictEqual(hidden.length, 1, 'exactly one hidden customer in the photograph');
  assert.ok(S.customerInUse(d, hidden[0].id) > 0, 'and something still names it');

  // Two projects, both still open, so the log screen offers them.
  assert.strictEqual(d.projects.length, 2);
  assert.ok(d.projects.every((p) => p.done === false), 'a project done: false is in the photograph');
  assert.deepStrictEqual(S.openProjects(d, uda.id).map((p) => p.title), ['UF Project']);

  // Five visits: four on one job over two weeks, and one for another customer.
  assert.strictEqual(d.logs.length, 5);
  const uf = d.projects.find((p) => p.title === 'UF Project');
  assert.strictEqual(d.logs.filter((e) => e.projectId === uf.id).length, 4);
  const weeks = new Set(d.logs.filter((e) => e.projectId === uf.id).map((e) => S.mondayOf(e.dateISO)));
  assert.strictEqual(weeks.size, 2, 'two weeks of the same job');
  assert.strictEqual(d.logs.filter((e) => !e.invoiceId).length, 1, 'one visit still in the pile');

  // v3.1 gave an entry a To and a Ready flag. Neither is on this photograph,
  // and neither may become required: every visit here reads as one day, still
  // in progress, which is exactly what it was on the phone that wrote it.
  d.logs.forEach((e) => {
    assert.strictEqual(e.toISO, undefined, 'a v3 entry has no To');
    assert.strictEqual(e.ready, undefined, 'and no Ready');
    assert.strictEqual(I.entryFrom(e), e.dateISO);
    assert.strictEqual(I.entryTo(e), e.dateISO, 'so From and To are the one day');
    assert.strictEqual(I.isReady(e), false, 'and it is in progress');
  });

  // THE LINKS, BOTH WAYS. A log entry names the invoice that billed it and
  // that invoice names the entry back. One-sided in either direction is a
  // visit that can be billed twice, or hours locked to nothing.
  d.logs.forEach((e) => {
    if (!e.invoiceId) return;
    const inv = d.invoices.find((x) => x.id === e.invoiceId);
    assert.ok(inv, 'a locked visit points at an invoice that is here');
    assert.ok(inv.logIds.indexOf(e.id) !== -1, 'and that invoice names it back');
  });
  d.invoices.forEach((inv) => {
    inv.logIds.forEach((id) => {
      const e = d.logs.find((x) => x.id === id);
      assert.ok(e, 'an invoice names a visit that is here');
      assert.strictEqual(e.invoiceId, inv.id, 'and that visit is locked to it');
    });
  });

  // Three invoices: one sent and part paid, one project invoice off a bid, and
  // one numbered on Friday that has not gone out.
  assert.strictEqual(d.invoices.length, 3);
  const byNumber = (n) => d.invoices.find((x) => x.number === n);
  const first = byNumber(166818);
  const proj = byNumber(166819);
  const held = byNumber(166820);

  // #166818, BY HAND. Shawn 8 + 8 = 16 hours and George 5, at UDA's own $85:
  // 21 x 8500 = 178,500. Plus one roll of #12 priced as a lot, $216.00, which
  // is the amount as typed and takes no markup. 178500 + 21600 = 200,100.
  assert.deepStrictEqual(first.labor.map((l) => [l.name, l.loggedHours, l.billedHours]),
    [['Shawn', 16, 16], ['George', 5, 5]]);
  assert.strictEqual(first.rateCents, 8500, 'the customer own rate, snapshotted');
  assert.strictEqual(first.po, '2526-4213', 'and their PO number with it');
  assert.strictEqual(21 * 8500, 178500);
  assert.strictEqual(first.items.length, 1);
  assert.strictEqual(first.items[0].lotCents, 21600, 'the roll of wire is priced as a lot');
  assert.strictEqual(I.totals(first).total, 178500 + 21600);
  assert.strictEqual(I.statusOf(first), 'sent');
  assert.strictEqual(I.paidCents(first), 100000);
  assert.strictEqual(I.balanceCents(first), 100100, 'part paid, and the rest is still owed');

  // #166819, BY HAND: a project invoice bills the PROPOSAL, so its amount is
  // bid #3 own document total and nothing else. One line, no labor, no parts.
  const bid3 = d.bids.find((b) => b.number === 3);
  assert.strictEqual(proj.kind, 'project');
  assert.strictEqual(proj.bidId, bid3.id, 'the project invoice names the bid it bills');
  assert.strictEqual(proj.logIds.length, 0, 'and no visits: it bills paper, not hours');
  assert.strictEqual(proj.partCents, D.build(bid3, d, 'full').totalCents);
  assert.strictEqual(I.totals(proj).total, 181040);
  assert.strictEqual(I.statusOf(proj), 'sent');

  // #166820: numbered, and not sent. That is a draft with a number on it, and
  // it is the shape the Friday batch leaves behind when he stops half way.
  assert.strictEqual(held.sentAt, null);
  assert.strictEqual(I.statusOf(held), 'draft');
  // Shawn 8 + 8 and George 4, at $85: 20 x 8500 = 170,000.
  assert.strictEqual(I.totals(held).total, 20 * 8500);

  // Every fixture v1 to v2.4 is still loading and pricing beside this one, which
  // the loops above assert; what is pinned here is that v3 own arrays did not
  // have to change a thing about the bids to exist.
  assert.strictEqual(d.catalog.length, 210);
  assert.strictEqual(d.settings.clauses.length, 27);
  assert.strictEqual(d.version, 1, 'the document version did not move');
});

// The two invoices that went out, to the cent, off the pinned map.
for (const file of Object.keys(INVOICE_TOTALS)) {
  test(file + ': every invoice that went out still comes to the cent it did', () => {
    const I = require('../invmath.js');
    const d = S.validateImport(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(d, file + ' no longer loads');
    const want = INVOICE_TOTALS[file];
    const sent = (d.invoices || []).filter((inv) => inv.sentAt);
    assert.strictEqual(sent.length, Object.keys(want).length, file + ' has grown or lost a sent invoice');
    sent.forEach((inv) => {
      assert.strictEqual(I.totals(inv).total, want[inv.number],
        file + ': invoice #' + inv.number + ' has re-figured');
    });
  });
}

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

// v3.2 added variantOf and source to a catalog part. Every fixture predates
// them, so none of their parts may carry either: a fixture that suddenly had
// one would mean somebody edited a photograph of a file that already exists
// on his phone, which is the one thing this file exists to stop.
test('no fixture part is an option of another, or came from a price file', () => {
  for (const file of files) {
    const d = S.validateImport(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(d, file + ' no longer loads');
    d.catalog.forEach((p) => {
      assert.strictEqual('variantOf' in p, false, file + ': ' + p.name + ' carries a variantOf');
      assert.strictEqual('source' in p, false, file + ': ' + p.name + ' carries a source');
    });
  }
});
