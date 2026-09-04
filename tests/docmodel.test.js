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
  assert.strictEqual(doc.sections.at(-1).title, 'Change order 1 — Disconnect at pump 4');
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
