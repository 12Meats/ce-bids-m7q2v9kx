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
  assert.deepStrictEqual(doc.scope, ['Warehouse: 180 ft 3/4" rigid; 4 emergency light fixtures']);
  b.scope = ['Custom line'];
  assert.deepStrictEqual(D.build(b, d, 'scope').scope, ['Custom line']);
  assert.deepStrictEqual(D.draftScope(b), ['Warehouse: 180 ft 3/4" rigid; 4 emergency light fixtures']);
  assert.ok(doc.terms.includes('Pricing held 30 days from the date above.'));
  assert.ok(doc.terms.includes('Disconnect to be supplied by UDA.'));
  assert.strictEqual(doc.clauses.length, 1);
});
test('change orders append a section and add to the total', () => {
  const { d, b } = fixture();
  b.status = 'won'; b.job = { weeks: [], surprises: [], changeOrders: [
    { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 0, tasks: null }, priceCents: 145000 } ], completedAt: null };
  const doc = D.build(b, d, 'full');
  // Deliberate change (code review item 9): colon separator, no em-dash.
  assert.strictEqual(doc.sections.at(-1).title, 'Change order 1: Disconnect at pump 4');
  assert.strictEqual(doc.sections.at(-1).rows[0].desc, 'Disconnect at pump 4');
  const base = D.build({ ...b, job: null }, d, 'full').totalCents;
  assert.strictEqual(doc.totalCents, base + 145000);
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
  b.job = { weeks: [], surprises: [], changeOrders: [
    { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 0, tasks: null }, priceCents: 145000 },
    { id: 'co2', name: 'Add receptacle', areas: [], labor: { crewIds: ['c1'], days: 0, tasks: null }, priceCents: 32000 } ], completedAt: null };
  const doc = D.build(b, d, 'full');
  const stack = B.costStack(b, d.settings);
  const solved = B.solve(stack, 'rate', b.pricing.rateCents);
  assert.strictEqual(doc.totalCents, solved.priceCents + 145000 + 32000);
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

test('a customer record with a blank name also falls back to "Customer"', () => {
  const { d, b } = fixture();
  d.customers.find((c) => c.id === b.customerId).name = '';
  const doc = D.build(b, d, 'full');
  assert.strictEqual(doc.meta.customer, 'Customer');
  assert.strictEqual(doc.signatures.left, 'Accepted by (Customer)');
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
  b.job = { weeks: [], surprises: [], changeOrders: [
    { id: 'co1', name: 'Disconnect at pump 4', areas: [], labor: { crewIds: ['c1'], days: 0, tasks: null }, priceCents: 145000 } ], completedAt: null };
  const doc = D.build(b, d, 'summary');
  assert.strictEqual(doc.summary.at(-1).label, 'Change order 1: Disconnect at pump 4');
  assert.strictEqual(doc.summary.at(-1).cents, 145000);
  assert.strictEqual(doc.summary.reduce((s, r) => s + r.cents, 0), doc.totalCents);
});

// 10. taxLine per level, signatures contents, addDays across month/year end
test('taxLine: 0 on full, null on summary and scope', () => {
  const { d, b } = fixture();
  assert.strictEqual(D.build(b, d, 'full').taxLine, 0);
  assert.strictEqual(D.build(b, d, 'summary').taxLine, null);
  assert.strictEqual(D.build(b, d, 'scope').taxLine, null);
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
