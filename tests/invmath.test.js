// tests/invmath.test.js — the rules behind the Invoices tab. Pure: grouping,
// totals, age, who owes, project invoices. The screens print what comes back.
const { test } = require('node:test');
const assert = require('node:assert');
const I = require('../invmath.js');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../docmodel.js');

const monday = S.mondayOf;

function world() {
  const d = S.emptyData();
  d.settings.markupPct = 15;
  const uda = S.findOrCreateCustomer(d, 'UDA'); uda.rateCents = 8500; uda.po = '2526-4213';
  const sch = S.findOrCreateCustomer(d, 'Schreiber');            // no rate: falls back to settings.rateCents (8500)
  const uf = S.newProject(d, uda.id, 'UF Project', '2026-08-20');
  const pump = S.newProject(d, uda.id, 'R2 condensate pump', '2026-09-01');
  const lights = S.newProject(d, sch.id, 'Freezer lights', '2026-09-01');
  const [c1, c2] = d.settings.crew.map((c) => c.id);           // Shawn 3200, George 3000
  const e = (customerId, projectId, dateISO, crew, items) => {
    const x = S.newLogEntry(d, { customerId, projectId, dateISO, createdAt: 1 });
    x.crew = crew; x.items = items || [];
    return x;
  };
  const entries = [
    e(uda.id, uf.id, '2026-08-24', [{ crewId: c1, hours: 8 }, { crewId: c2, hours: 5 }]),
    e(uda.id, uf.id, '2026-08-28', [{ crewId: c1, hours: 8 }]),
    e(uda.id, uf.id, '2026-08-31', [{ crewId: c1, hours: 8 }]),
    e(uda.id, uf.id, '2026-09-01', [{ crewId: c1, hours: 8 }, { crewId: c2, hours: 4 }],
      [{ catalogId: null, name: '#12 wire', unit: 'ft', qty: 500, costCents: 38, priceCents: null, lotCents: 21600 }]),
    e(uda.id, uf.id, '2026-09-04', [{ crewId: c1, hours: 4 }]),
    e(uda.id, pump.id, '2026-09-02', [{ crewId: c1, hours: 4 }]),
    e(sch.id, lights.id, '2026-09-03', [{ crewId: c1, hours: 8 }],
      [{ catalogId: null, name: 'LED fixture', unit: 'ea', qty: 2, costCents: 4800, priceCents: null }]),
  ];
  return { d, uda, sch, uf, pump, lights, c1, c2, entries };
}

test('group: customer + project + Monday week, oldest first, with the span of each group', () => {
  const w = world();
  const groups = I.group(w.entries, w.d, monday);
  assert.deepStrictEqual(groups.map((g) => [g.customerId === w.uda.id ? 'UDA' : 'Sch', g.title, g.from, g.to, g.entries.length]), [
    ['UDA', 'UF Project', '2026-08-24', '2026-08-28', 2],
    ['UDA', 'UF Project', '2026-08-31', '2026-09-04', 3],
    ['UDA', 'R2 condensate pump', '2026-09-02', '2026-09-02', 1],
    ['Sch', 'Freezer lights', '2026-09-03', '2026-09-03', 1],
  ]);
  // A Sunday belongs to the week that started the Monday before it.
  const sun = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: w.uf.id, dateISO: '2026-08-30', createdAt: 1 });
  sun.crew = [{ crewId: w.c1, hours: 2 }];
  const g2 = I.group(w.entries.concat([sun]), w.d, monday);
  assert.strictEqual(g2[0].entries.length, 3, 'Sunday Aug 30 joined the week of Aug 24');
  assert.strictEqual(g2[0].to, '2026-08-30');
});

test('group: billed entries are left out; unchecked ids are left out', () => {
  const w = world();
  w.entries[5].invoiceId = 'already';
  const groups = I.group(w.entries, w.d, monday, { exclude: new Set([w.entries[6].id]) });
  assert.deepStrictEqual(groups.map((g) => g.title), ['UF Project', 'UF Project']);
});

test('combine joins two neighbouring groups of the same project; split makes one per entry', () => {
  const w = world();
  const groups = I.group(w.entries, w.d, monday);
  const joined = I.combine(groups, 0);
  assert.strictEqual(joined.length, 3);
  assert.deepStrictEqual([joined[0].from, joined[0].to, joined[0].entries.length], ['2026-08-24', '2026-09-04', 5]);
  assert.strictEqual(I.combine(groups, 1), groups, 'different projects do not combine (returns the same array)');
  const parts = I.split(groups, 1);
  assert.strictEqual(parts.length, 6);
  assert.deepStrictEqual(parts.slice(1, 4).map((g) => g.from), ['2026-08-31', '2026-09-01', '2026-09-04']);
  assert.ok(I.canCombine(groups, 0) && !I.canCombine(groups, 1) && !I.canCombine(groups, 3));
});

test('draftInvoice: labor per man summed, materials carried, snapshots taken from the customer and settings', () => {
  const w = world();
  const g = I.group(w.entries, w.d, monday)[1];
  const inv = I.draftInvoice(g, w.d, 1234);
  assert.strictEqual(inv.number, null);
  assert.strictEqual(inv.kind, 'tm');
  assert.strictEqual(inv.status, 'draft');
  assert.strictEqual(inv.dateISO, null);
  assert.deepStrictEqual([inv.serviceFrom, inv.serviceTo], ['2026-08-31', '2026-09-04']);
  assert.deepStrictEqual(inv.labor, [
    { crewId: w.c1, name: 'Shawn', loggedHours: 20, billedHours: 20 },
    { crewId: w.c2, name: 'George', loggedHours: 4, billedHours: 4 },
  ]);
  assert.strictEqual(inv.items.length, 1);
  assert.notStrictEqual(inv.items[0], w.entries[3].items[0], 'a deep copy, never the entry\'s own object');
  assert.deepStrictEqual([inv.rateCents, inv.markupPct, inv.po, inv.terms], [8500, 15, '2526-4213', 'Upon receipt']);
  assert.deepStrictEqual(inv.logIds, g.entries.map((e) => e.id));
  assert.strictEqual(inv.createdAt, 1234);
  // A customer with no rate bills at the settings rate; no PO prints nothing.
  const sch = I.draftInvoice(I.group(w.entries, w.d, monday)[3], w.d, 1);
  assert.strictEqual(sch.rateCents, w.d.settings.rateCents);
  assert.strictEqual(sch.po, '');
});

test('totals: hours × rate per man, materials by itemPrice, rentals and equipment by bidmath, tax 0', () => {
  const w = world();
  const inv = I.draftInvoice(I.group(w.entries, w.d, monday)[1], w.d, 1);
  inv.rentals.push({ name: 'Boom lift', days: 1, cents: 28500, markup: true });
  inv.equipment.push({ equipmentId: null, name: 'Scissor lift', days: 2, dayCents: 15000 });
  const t = I.totals(inv);
  assert.strictEqual(t.labor, 20 * 8500 + 4 * 8500);              // 204,000
  assert.strictEqual(t.materials, 21600);                          // the lot
  assert.strictEqual(t.rentals, B.rentalPrice(inv.rentals[0], 15)); // 32,775
  assert.strictEqual(t.equipment, 30000);
  assert.strictEqual(t.tax, 0);
  assert.strictEqual(t.subtotal, t.labor + t.materials + t.rentals + t.equipment);
  assert.strictEqual(t.total, t.subtotal);
  // Billed hours are his call: 20 logged, bill 16.
  inv.labor[0].billedHours = 16;
  assert.strictEqual(I.totals(inv).labor, 16 * 8500 + 4 * 8500);
  // Half hours round per man, not on the sum.
  inv.labor[0].billedHours = 0.5; inv.rateCents = 8501;
  assert.strictEqual(I.totals(inv).labor, Math.round(0.5 * 8501) + Math.round(4 * 8501));
});

test('statusOf and balance: draft, sent, partly paid, paid', () => {
  const w = world();
  const inv = I.draftInvoice(I.group(w.entries, w.d, monday)[2], w.d, 1);   // 4 hrs = $340
  assert.strictEqual(I.statusOf(inv), 'draft');
  inv.number = 166818; inv.dateISO = '2026-09-05';
  assert.strictEqual(I.statusOf(inv), 'draft', 'numbered but not shared is still a draft');
  inv.sentAt = '2026-09-05';
  assert.strictEqual(I.statusOf(inv), 'sent');
  inv.payments.push({ dateISO: '2026-09-20', cents: 10000 });
  assert.strictEqual(I.statusOf(inv), 'sent');
  assert.strictEqual(I.balanceCents(inv), 24000);
  inv.payments.push({ dateISO: '2026-09-25', cents: 24000 });
  assert.strictEqual(I.statusOf(inv), 'paid');
  assert.strictEqual(I.balanceCents(inv), 0);
  inv.payments.push({ dateISO: '2026-09-26', cents: 100 });
  assert.strictEqual(I.balanceCents(inv), 0, 'an overpayment is not a negative balance');
});

test('whoOwes: open balances over sent invoices, the oldest by sent date', () => {
  const w = world();
  const groups = I.group(w.entries, w.d, monday);
  const a = I.draftInvoice(groups[2], w.d, 1); a.number = 1; a.dateISO = '2026-08-01'; a.sentAt = '2026-08-01';   // 340.00
  const b = I.draftInvoice(groups[3], w.d, 2); b.number = 2; b.dateISO = '2026-09-03'; b.sentAt = '2026-09-03';   // 680 + 2×5520
  const c = I.draftInvoice(groups[1], w.d, 3);                                                                     // draft, ignored
  const paid = I.draftInvoice(groups[0], w.d, 4); paid.number = 3; paid.sentAt = '2026-08-28'; paid.payments.push({ dateISO: '2026-09-01', cents: I.totals(paid).total });
  const out = I.whoOwes([a, b, c, paid], '2026-09-08');
  assert.strictEqual(out.totalCents, I.totals(a).total + I.totals(b).total);
  assert.strictEqual(out.openCount, 2);
  assert.strictEqual(out.oldestDays, 38);
  assert.strictEqual(out.oldestCustomerId, w.uda.id);
  assert.deepStrictEqual(I.whoOwes([], '2026-09-08'), { totalCents: 0, openCount: 0, oldestDays: null, oldestCustomerId: null });
});

test('ageDays and the amber line', () => {
  assert.strictEqual(I.ageDays('2026-08-24', '2026-09-08'), 15);
  assert.strictEqual(I.ageDays('2026-09-08', '2026-09-08'), 0);
  assert.strictEqual(I.AMBER_AFTER_DAYS, 14);
  assert.strictEqual(I.isStale('2026-08-24', '2026-09-08'), true);
  assert.strictEqual(I.isStale('2026-08-26', '2026-09-08'), false);
});

test('projectInvoice: the bid\'s document total plus change orders, less what was already invoiced', () => {
  const w = world();
  const b = S.newBid(w.d, { customerName: 'UDA', title: 'Cheese plant lighting', jobType: 'project', dateISO: '2026-08-01' });
  b.areas.push({ id: 'a1', name: 'Plant', items: [{ catalogId: null, name: 'Fixture', unit: 'ea', qty: 10, costCents: 10000, priceCents: null }], photoIds: [] });
  b.labor.days = 2; b.status = 'won'; b.job = S.newJob();
  w.d.bids.push(b);
  const whole = D.build(b, w.d, 'full').totalCents;
  assert.strictEqual(I.projectRemainingCents(b, w.d, []), whole);
  const first = I.draftProjectInvoice(b, w.d, 100000, 1);
  assert.deepStrictEqual([first.kind, first.bidId, first.partCents, first.projectTitle, first.customerId], ['project', b.id, 100000, 'Cheese plant lighting', b.customerId]);
  assert.strictEqual(I.totals(first).total, 100000, 'a part is the amount typed');
  assert.deepStrictEqual([first.serviceFrom, first.serviceTo], [b.dateISO, b.dateISO]);
  assert.strictEqual(I.projectRemainingCents(b, w.d, [first]), whole - 100000);
  const rest = I.draftProjectInvoice(b, w.d, null, 2, [first]);
  assert.strictEqual(I.totals(rest).total, whole - 100000, 'null part = the whole remaining amount');
  assert.strictEqual(I.projectRemainingCents(b, w.d, [first, rest]), 0);
});

test('invoiceRows: what the paper prints, in order, from one primitive', () => {
  const w = world();
  const inv = I.draftInvoice(I.group(w.entries, w.d, monday)[1], w.d, 1);
  inv.labor[0].billedHours = 16;
  const rows = I.invoiceRows(inv);
  assert.deepStrictEqual(rows.materials, [{ qtyText: '500 ft', desc: '#12 wire', unitCents: null, cents: 21600 }]);
  assert.deepStrictEqual(rows.labor, [{ qtyText: '20 hrs', desc: 'Labor hours, Aug 31 to Sep 4, 2026', unitCents: 8500, cents: 20 * 8500 }]);
  const one = I.draftInvoice(I.group(w.entries, w.d, monday)[2], w.d, 1);
  assert.deepStrictEqual(I.invoiceRows(one).labor, [{ qtyText: '4 hrs', desc: 'Labor hours', unitCents: 8500, cents: 34000 }]);
});
