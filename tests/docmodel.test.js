const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../docmodel.js');

function fixture() {
  const d = S.emptyData(); d.settings.nextNumber = 3052;
  const b = S.newBid(d, { customerName: 'UDA', title: 'Warehouse emergency lights', jobType: 'service', dateISO: '2026-09-10' });
  b.areas.push({ id: 'a1', name: 'Warehouse', items: [
    { catalogId: null, name: '3/4" rigid', unit: 'ft', qty: 180, costCents: 241, priceCents: null },
    { catalogId: null, name: 'Emergency light fixtures', unit: 'ea', qty: 4, costCents: 31800, priceCents: null } ], photoIds: [] });
  b.misc.cents = 4000; b.labor.days = 2;
  b.rentals.push({ name: 'Lift rental', days: 1, cents: 44500, markup: false });
  b.pricing.rateCents = 6500; b.pricing.cushionPct = 10;
  b.notes = ['Disconnect to be supplied by UDA.'];
  d.bids.push(b); return { d, b };
}

test('full level: sections Materials / Equipment & rentals / Labor with a labor row of bidHours × rate', () => {
  const { d, b } = fixture();
  const doc = D.build(b, d, 'full');
  assert.strictEqual(doc.level, 'full');
  assert.deepStrictEqual(doc.sections.map((s) => s.title), ['Materials', 'Equipment & rentals', 'Labor']);
  const labor = doc.sections[2].rows[0];
  assert.strictEqual(labor.qtyText, '36 hrs');
  assert.strictEqual(labor.unitCents, 6500);
  assert.strictEqual(labor.cents, 36 * 6500);
  assert.strictEqual(doc.sections[0].rows.at(-1).desc, 'Supports, anchors, and hardware');
  assert.strictEqual(doc.header.roc, 'AZ ROC #276507');
  assert.strictEqual(doc.meta.number, 3052);
  assert.strictEqual(doc.meta.validThrough, '2026-10-10');
});
// The rental's cents field is the TOTAL for the hire, so the row prints the
// day count in the quantity column and the whole total in the money column,
// with NOTHING in the unit-price column: a per-day number there would read as
// a rate and turn an $285 lift into $2,280 on the customer's page.
test('a rental row prints name, day count and the whole total, and no unit price', () => {
  const { d, b } = fixture();
  b.rentals = [{ name: 'Scissor lift', days: 8, cents: 28500, markup: false }];
  b.equipment = [];
  const doc = D.build(b, d, 'full');
  const section = doc.sections.find((s) => s.title === 'Equipment & rentals');
  assert.deepStrictEqual(section.rows, [
    { desc: 'Scissor lift', qtyText: '8 days', unitCents: null, cents: 28500 },
  ]);
  // One day is one day, not "1 days".
  b.rentals = [{ name: 'Trencher', days: 1, cents: 19900, markup: false }];
  const one = D.build(b, d, 'full').sections.find((s) => s.title === 'Equipment & rentals');
  assert.strictEqual(one.rows[0].qtyText, '1 day');
  assert.strictEqual(one.rows[0].cents, 19900);
});

test('all three levels report the identical total', () => {
  const { d, b } = fixture();
  const totals = ['full', 'summary', 'scope'].map((l) => D.build(b, d, l).totalCents);
  assert.strictEqual(totals[0], totals[1]); assert.strictEqual(totals[1], totals[2]);
  const stack = B.costStack(b, d.settings);
  assert.strictEqual(totals[0], B.solve(stack, 'rate', 6500).priceCents);
});
test('summary level: three category totals that sum to the total', () => {
  const { d, b } = fixture();
  const doc = D.build(b, d, 'summary');
  assert.deepStrictEqual(doc.summary.map((r) => r.label), ['Materials', 'Equipment & rentals', 'Labor (36 hrs)']);
  assert.strictEqual(doc.summary.reduce((s, r) => s + r.cents, 0), doc.totalCents);
});
test('scope level: no rows, scope auto-drafted from areas when bid.scope is null, terms include validity + notes + selected clauses', () => {
  const { d, b } = fixture();
  b.clauseIds = [d.settings.clauses[0].id];
  const doc = D.build(b, d, 'scope');
  assert.strictEqual(doc.sections, null);
  assert.deepStrictEqual(doc.scope, ['Warehouse: run 180 ft of 3/4" rigid; furnish and install 4 emergency light fixtures']);
  b.scope = ['Custom line'];
  assert.deepStrictEqual(D.build(b, d, 'scope').scope, ['Custom line']);
  assert.deepStrictEqual(D.draftScope(b), ['Warehouse: run 180 ft of 3/4" rigid; furnish and install 4 emergency light fixtures']);
  assert.ok(doc.terms.includes('Pricing held 30 days from the date above.'));
  assert.ok(doc.terms.includes('Disconnect to be supplied by UDA.'));
  assert.strictEqual(doc.clauses.length, 1);
});
test('change orders append a section and add to the total', () => {
  const { d, b } = fixture();
  const co = { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 2, tasks: null } };
  b.status = 'won'; b.job = { weeks: [], surprises: [], changeOrders: [co], completedAt: null };
  const doc = D.build(b, d, 'full');
  // Deliberate change (code review item 9): colon separator, no em-dash.
  assert.strictEqual(doc.sections.at(-1).title, 'Change order 1: Disconnect at pump 4');
  assert.strictEqual(doc.sections.at(-1).rows[0].desc, 'Disconnect at pump 4');
  const price = B.changeOrderPrice(co, b, d.settings);
  assert.ok(price > 0, 'the fixture change order should cost something');
  const base = D.build({ ...b, job: null }, d, 'full').totalCents;
  assert.strictEqual(doc.totalCents, base + price);
});

// The bug that killed the cached co.priceCents: the price was written only by
// the job screen's render, so editing a change order's labor and leaving by
// any other route printed the old number on the customer's proposal.
test('editing a change order labor moves the document total with no other write', () => {
  const { d, b } = fixture();
  const co = { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 1, tasks: null } };
  b.status = 'won'; b.job = { weeks: [], surprises: [], changeOrders: [co], completedAt: null };
  const before = D.build(b, d, 'full').totalCents;
  co.labor.days = 2;                       // the labor screen's whole edit
  const after = D.build(b, d, 'full').totalCents;
  assert.ok(after > before, 'a second day must reach the paper');
  assert.strictEqual(after - before, B.changeOrderPrice(co, b, d.settings)
    - B.changeOrderPrice({ ...co, labor: { ...co.labor, days: 1 } }, b, d.settings));
  // Every level agrees, and none of them read a stored price.
  assert.strictEqual('priceCents' in co, false);
  ['full', 'summary', 'scope'].forEach((l) => assert.strictEqual(D.build(b, d, l).totalCents, after, l));
});
test('fileName', () => {
  const { d, b } = fixture();
  assert.strictEqual(D.fileName(b, d), 'CE Bid 3052 - UDA - Warehouse emergency lights.pdf');
});

// -------------------------------------------------------------------------
// Refinement 1: rows must reproduce the stack to the cent
// -------------------------------------------------------------------------

function assertRowsMatchStack(b, d) {
  const doc = D.build(b, d, 'full');
  const stack = B.costStack(b, d.settings);
  const materials = doc.sections.find((s) => s.title === 'Materials');
  const equip = doc.sections.find((s) => s.title === 'Equipment & rentals');
  const materialSum = materials.rows.reduce((s, r) => s + r.cents, 0);
  const equipSum = (equip ? equip.rows : []).reduce((s, r) => s + r.cents, 0);
  assert.strictEqual(materialSum, stack.materialPrice + stack.misc);
  assert.strictEqual(equipSum, stack.rentalsPrice + stack.equipmentPrice);
}

test('rows reproduce the stack to the cent on the base fixture', () => {
  const { d, b } = fixture();
  assertRowsMatchStack(b, d);
});
test('rows reproduce the stack to the cent with markup override, marked-up rental, price override, and equipment', () => {
  const { d, b } = fixture();
  b.pricing.markupPct = 30;
  b.areas[0].items[0].priceCents = 500; // override
  b.rentals.push({ name: 'Trailer', days: 2, cents: 10000, markup: true });
  b.equipment.push({ equipmentId: null, name: 'Concrete saw', days: 0.5, dayCents: 7500 });
  assertRowsMatchStack(b, d);
});

// Full is the one level with no drafted scope: the line items describe the
// work. A scope he typed himself is different, and it prints.
test('full level: prints an explicit scope, drafts none, and the total is untouched either way', () => {
  const { d, b } = fixture();
  const bare = D.build(b, d, 'full');
  assert.strictEqual(bare.scope, null);

  b.scope = ['Replace the four bay fixtures on the north wall.'];
  const doc = D.build(b, d, 'full');
  assert.deepStrictEqual(doc.scope, ['Replace the four bay fixtures on the north wall.']);
  assert.strictEqual(doc.totalCents, bare.totalCents);
  assert.deepStrictEqual(doc.sections.map((s) => s.title), bare.sections.map((s) => s.title));

  // An empty list is not a scope: it goes back to printing nothing rather
  // than a heading with no bullets under it.
  b.scope = [];
  assert.strictEqual(D.build(b, d, 'full').scope, null);
});

// -------------------------------------------------------------------------
// Refinement 2: hidden clauses excluded
// -------------------------------------------------------------------------

test('a hidden clause is excluded from the document even when referenced by id', () => {
  const { d, b } = fixture();
  const hidden = d.settings.clauses.find((c) => c.id === 'k02');
  hidden.hidden = true;
  b.clauseIds = ['k01', 'k02'];
  const doc = D.build(b, d, 'scope');
  assert.deepStrictEqual(doc.clauses.map((c) => c.id), ['k01']);
});

// A bid he has never opened the proposal screen on carries null, not []. The
// document is the same either way: no clauses on the paper.
test('clauseIds null reads as no clauses at every level', () => {
  const { d, b } = fixture();
  assert.strictEqual(b.clauseIds, null);
  ['full', 'summary', 'scope'].forEach((level) => {
    assert.deepStrictEqual(D.build(b, d, level).clauses, []);
  });
  b.clauseIds = [];
  assert.deepStrictEqual(D.build(b, d, 'scope').clauses, []);
});

// -------------------------------------------------------------------------
// Refinement 3: addDays
// -------------------------------------------------------------------------

test('addDays composes from local date parts and rejects malformed input', () => {
  assert.strictEqual(D.addDays('2026-09-10', 30), '2026-10-10');
  assert.strictEqual(D.addDays('nope', 30), null);
});

// -------------------------------------------------------------------------
// Refinement 5: Equipment & rentals section omitted when empty
// -------------------------------------------------------------------------

test('full level omits Equipment & rentals section when there are no rentals or equipment', () => {
  const { d, b } = fixture();
  b.rentals = []; b.equipment = [];
  const doc = D.build(b, d, 'full');
  assert.deepStrictEqual(doc.sections.map((s) => s.title), ['Materials', 'Labor']);
});

// -------------------------------------------------------------------------
// Code review fixes
// -------------------------------------------------------------------------

// 1. Tax-mode terms line
test('terms include the tax-mode line right after the validity line: included vs added', () => {
  const { d, b } = fixture();
  const docIncluded = D.build(b, d, 'full');
  const validityIdx = docIncluded.terms.indexOf('Pricing held 30 days from the date above.');
  assert.strictEqual(docIncluded.terms[validityIdx + 1], 'Estimated material taxes are included in the prices above.');
  d.settings.taxMode = 'added';
  const docAdded = D.build(b, d, 'full');
  assert.strictEqual(docAdded.terms[validityIdx + 1], 'Sales tax on materials will be added to the invoice.');
});

// 2. Summary omits $0.00 Equipment & rentals row, mirroring Full
test('summary level omits the Equipment & rentals row when there is no equipment or rentals', () => {
  const { d, b } = fixture();
  b.rentals = []; b.equipment = [];
  const doc = D.build(b, d, 'summary');
  assert.deepStrictEqual(doc.summary.map((r) => r.label), ['Materials', 'Labor (36 hrs)']);
});

// 3. Change orders make totalCents diverge from solve() by design
test('totalCents with change orders equals solve() base price plus the change-order total', () => {
  const { d, b } = fixture();
  const co1 = { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 2, tasks: null } };
  const co2 = { id: 'co2', name: 'Add receptacle', areas: [], labor: { crewIds: ['c1'], days: 0.5, tasks: null } };
  b.job = { weeks: [], surprises: [], changeOrders: [co1, co2], completedAt: null };
  const doc = D.build(b, d, 'full');
  const stack = B.costStack(b, d.settings);
  const solved = B.solve(stack, 'rate', b.pricing.rateCents);
  assert.strictEqual(doc.totalCents, solved.priceCents
    + B.changeOrderPrice(co1, b, d.settings) + B.changeOrderPrice(co2, b, d.settings));
});

// 5. fileName: dropped empty segment, truncation, trailing punctuation stripped
test('fileName: untitled bid drops the empty title segment (no dangling separator)', () => {
  const { d, b } = fixture();
  b.title = '';
  assert.strictEqual(D.fileName(b, d), 'CE Bid 3052 - UDA.pdf');
});
test('fileName: title truncated to 80 chars, trailing dots/spaces stripped, overall length capped', () => {
  const { d, b } = fixture();
  // First 80 characters land exactly on "...Rewire"; everything after (dots and
  // more text) must be cut before the extension is appended.
  b.title = 'A'.repeat(74) + 'Rewire' + '.......... plus far more text well past the eighty character cutoff point here';
  const fn = D.fileName(b, d);
  assert.ok(fn.endsWith('Rewire.pdf'), fn);
  const longTitleBid = { ...b, title: 'B'.repeat(300) };
  assert.ok(D.fileName(longTitleBid, d).length <= 120);
});

// 7. Unknown customer falls back to "Customer" everywhere
test('meta.customer, signatures.left, and fileName all fall back to "Customer" for a ghost customerId', () => {
  const { d, b } = fixture();
  b.customerId = 'ghost-id';
  const doc = D.build(b, d, 'full');
  assert.strictEqual(doc.meta.customer, 'Customer');
  assert.strictEqual(doc.signatures.left, 'Accepted by (Customer)');
  assert.strictEqual(D.fileName(b, d), 'CE Bid 3052 - Customer - Warehouse emergency lights.pdf');
});

test('a customer record with a blank or whitespace-only name falls back to "Customer"', () => {
  ['', '   '].forEach((blank) => {
    const { d, b } = fixture();
    d.customers.find((c) => c.id === b.customerId).name = blank;
    const doc = D.build(b, d, 'full');
    assert.strictEqual(doc.meta.customer, 'Customer');
    assert.strictEqual(doc.signatures.left, 'Accepted by (Customer)');
    assert.strictEqual(D.fileName(b, d), 'CE Bid 3052 - Customer - Warehouse emergency lights.pdf');
  });
});

// 8. Dead doc.notes field removed (terms already carries the notes)
test('doc.notes is not a field on the built document', () => {
  const { d, b } = fixture();
  const doc = D.build(b, d, 'full');
  assert.strictEqual(doc.notes, undefined);
});

// 9. Change orders at summary level
test('change orders append a summary row and add to the summary total', () => {
  const { d, b } = fixture();
  const co = { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 2, tasks: null } };
  b.job = { weeks: [], surprises: [], changeOrders: [co], completedAt: null };
  const doc = D.build(b, d, 'summary');
  assert.strictEqual(doc.summary.at(-1).label, 'Change order 1: Disconnect at pump 4');
  assert.strictEqual(doc.summary.at(-1).cents, B.changeOrderPrice(co, b, d.settings));
  assert.strictEqual(doc.summary.reduce((s, r) => s + r.cents, 0), doc.totalCents);
});

// 10. taxLine per level, signatures contents, addDays across month/year end
test('taxLine: 0 on full, null on summary and scope', () => {
  const { d, b } = fixture();
  assert.strictEqual(D.build(b, d, 'full').taxLine, 0);
  assert.strictEqual(D.build(b, d, 'summary').taxLine, null);
  assert.strictEqual(D.build(b, d, 'scope').taxLine, null);
});
// The Subtotal line his past bids print. Tax is always folded into material
// pricing, so the subtotal is the total: what makes this worth asserting is
// that the two stay equal, and that the levels with no tax line have no
// subtotal to sit above it.
test('subtotalCents: on full it equals totalCents with taxLine 0, and it is absent on summary and scope', () => {
  const { d, b } = fixture();
  const full = D.build(b, d, 'full');
  assert.strictEqual(full.taxLine, 0);
  assert.ok(full.subtotalCents > 0, 'the full-level subtotal is not a real number');
  assert.strictEqual(full.subtotalCents, full.totalCents);
  assert.strictEqual(D.build(b, d, 'summary').subtotalCents, null);
  assert.strictEqual(D.build(b, d, 'scope').subtotalCents, null);
});
test('subtotalCents follows the total when a change order is added, and the total is unchanged across levels', () => {
  const { d, b } = fixture();
  const before = D.build(b, d, 'full');
  const co = { id: 'co1', name: 'Add a receptacle', areas: [], labor: { crewIds: ['c1'], days: 1, tasks: null } };
  b.status = 'won'; b.job = { weeks: [], surprises: [], changeOrders: [co], completedAt: null };
  const after = D.build(b, d, 'full');
  assert.ok(after.totalCents > before.totalCents, 'the change order did not move the total');
  assert.strictEqual(after.subtotalCents, after.totalCents);
  ['full', 'summary', 'scope'].forEach((l) => assert.strictEqual(D.build(b, d, l).totalCents, after.totalCents, l));
});
test('signatures: left names the customer, right and signName come from settings.company', () => {
  const { d, b } = fixture();
  const doc = D.build(b, d, 'full');
  assert.strictEqual(doc.signatures.left, 'Accepted by (UDA)');
  assert.strictEqual(doc.signatures.right, 'Cantu Electric LLC');
  assert.strictEqual(doc.signatures.signName, 'Andy Cantu');
});
test('addDays crosses a month end and a year end correctly', () => {
  assert.strictEqual(D.addDays('2026-01-31', 30), '2026-03-02');
  assert.strictEqual(D.addDays('2026-12-15', 30), '2027-01-14');
});

// -------------------------------------------------------------------------
// Spec review: Materials section omitted when empty, like Equipment & rentals
// -------------------------------------------------------------------------

test('full level omits the Materials section on a labor-only bid, and the total is unchanged across levels', () => {
  const { d, b } = fixture();
  b.areas = []; b.misc.cents = 0; b.rentals = []; b.equipment = [];
  const doc = D.build(b, d, 'full');
  assert.deepStrictEqual(doc.sections.map((s) => s.title), ['Labor']);
  const stack = B.costStack(b, d.settings);
  assert.strictEqual(doc.totalCents, stack.bidHours * b.pricing.rateCents);
  assert.strictEqual(doc.totalCents, B.solve(stack, 'rate', b.pricing.rateCents).priceCents);
  const totals = ['full', 'summary', 'scope'].map((l) => D.build(b, d, l).totalCents);
  assert.strictEqual(totals[0], totals[1]); assert.strictEqual(totals[1], totals[2]);
});
test('summary level keeps the Materials row at $0.00 on a labor-only bid', () => {
  const { d, b } = fixture();
  b.areas = []; b.misc.cents = 0; b.rentals = []; b.equipment = [];
  const doc = D.build(b, d, 'summary');
  assert.deepStrictEqual(doc.summary.map((r) => r.label), ['Materials', 'Labor (36 hrs)']);
  assert.strictEqual(doc.summary[0].cents, 0);
  assert.strictEqual(doc.summary.reduce((s, r) => s + r.cents, 0), doc.totalCents);
});

// --- draftScope phrasing ----------------------------------------------------
// The scope is the one part of the document written in sentences rather than
// in rows, and it goes in front of a customer. These pin the verb each unit
// takes and the two places the phrasing is deliberately conservative.

test('draftScope: verbs come off the unit — ft runs, ea is furnished and installed, other units read "N units of"', () => {
  const { d, b } = fixture();
  b.areas = [{ id: 'a1', name: 'MCC room', items: [
    { catalogId: null, name: '3/4" rigid', unit: 'ft', qty: 180, costCents: 241, priceCents: null },
    { catalogId: null, name: 'Emergency light fixture', unit: 'ea', qty: 4, costCents: 31800, priceCents: null },
    { catalogId: null, name: '#12 THHN', unit: 'roll', qty: 2, costCents: 8000, priceCents: null },
    { catalogId: null, name: 'Straps & supports', unit: 'lot', qty: 1, costCents: 5000, priceCents: null },
  ], photoIds: [] }];
  assert.deepStrictEqual(D.draftScope(b), ['MCC room: run 180 ft of 3/4" rigid; '
    + 'furnish and install 4 emergency light fixtures; '
    + 'furnish and install 2 rolls of #12 THHN; '
    + 'furnish and install 1 lot of straps & supports']);
});

test('draftScope: a count of one takes an article, and plurals never touch a name that ends in a quote or a digit', () => {
  const { d, b } = fixture();
  b.areas = [{ id: 'a1', name: 'Yard', items: [
    { catalogId: null, name: '60 A disconnect', unit: 'ea', qty: 1, costCents: 100, priceCents: null },
    { catalogId: null, name: 'Exit sign', unit: 'ea', qty: 1, costCents: 100, priceCents: null },
    { catalogId: null, name: 'LB 3/4"', unit: 'ea', qty: 3, costCents: 100, priceCents: null },
    { catalogId: null, name: 'J-box 4x4', unit: 'ea', qty: 2, costCents: 100, priceCents: null },
    { catalogId: null, name: '3/4" hubs', unit: 'ea', qty: 6, costCents: 100, priceCents: null },
    { catalogId: null, name: 'VFD', unit: 'ea', qty: 2, costCents: 100, priceCents: null },
    { catalogId: null, name: 'Photo eye', unit: 'ea', qty: 2, costCents: 100, priceCents: null },
  ], photoIds: [] }];
  assert.deepStrictEqual(D.draftScope(b), ['Yard: furnish and install a 60 A disconnect; '
    + 'furnish and install an exit sign; '
    + 'furnish and install 3 LB 3/4"; '
    + 'furnish and install 2 J-box 4x4; '
    + 'furnish and install 6 3/4" hubs; '
    + 'furnish and install 2 VFDs; '
    + 'furnish and install 2 photo eyes']);
});

test('draftScope: misc, rentals and equipment are never scope lines, and an empty area is skipped', () => {
  const { d, b } = fixture();
  b.areas.push({ id: 'a2', name: 'Dock', items: [], photoIds: [] });
  b.equipment = [{ name: 'Threader', days: 1, dayCents: 5000 }];
  const lines = D.draftScope(b);
  assert.strictEqual(lines.length, 1);
  assert.ok(!lines.join(' ').toLowerCase().includes('lift'));
  assert.ok(!lines.join(' ').toLowerCase().includes('threader'));
  assert.ok(!lines.join(' ').toLowerCase().includes('supports, anchors'));
  assert.strictEqual(D.draftScope({ areas: [] }).length, 0);
});

test('draftScope is pure: it does not touch the bid it reads', () => {
  const { d, b } = fixture();
  const before = JSON.stringify(b);
  D.draftScope(b);
  assert.strictEqual(JSON.stringify(b), before);
});
