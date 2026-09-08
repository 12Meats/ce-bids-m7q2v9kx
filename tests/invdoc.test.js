// tests/invdoc.test.js — the document the invoice renderer draws: header,
// meta, Bill To, the strip, the sections, the tail, the file name.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');
const I = require('../invmath.js');
const V = require('../invdoc.js');

function world() {
  const d = S.emptyData();
  const uda = S.findOrCreateCustomer(d, 'UDA');
  uda.name = 'United Dairymen of Arizona'; uda.attn = 'Kellen'; uda.address = '2008 S Hardy Drive\nTempe, AZ 85282'; uda.rateCents = 8500; uda.po = '2526-4710';
  const p = S.newProject(d, uda.id, 'Temp boiler rewire', '2026-07-01');
  const e = S.newLogEntry(d, { customerId: uda.id, projectId: p.id, dateISO: '2026-07-02' });
  e.crew = [{ crewId: d.settings.crew[0].id, hours: 5 }];
  e.items = [{ catalogId: null, name: 'Cambric tape, roll', unit: 'ea', qty: 1, costCents: 4800, priceCents: null, listCents: 4870 }];
  const inv = I.draftInvoice(I.group(d.logs, d, S.mondayOf)[0], d, 1);
  inv.number = 166816; inv.dateISO = '2026-07-06';
  d.invoices.push(inv);
  return { d, inv, uda };
}

test('build: header from the company, meta from the invoice, Bill To from the customer', () => {
  const { d, inv } = world();
  const doc = V.build(inv, d);
  assert.strictEqual(doc.kind, 'invoice');
  assert.strictEqual(doc.header.name, 'Cantu Electric LLC');
  assert.deepStrictEqual(doc.meta, {
    number: 166816, dateISO: '2026-07-06', customer: 'United Dairymen of Arizona', attn: 'Kellen',
    addressLines: ['2008 S Hardy Drive', 'Tempe, AZ 85282'], po: '2526-4710', terms: 'Upon receipt',
    rep: 'Andy Cantu', project: 'Temp boiler rewire', serviceText: 'Service date: Jul 2, 2026',
  });
  assert.deepStrictEqual(doc.sections.map((s) => s.title), ['Materials', 'Labor']);
  assert.deepStrictEqual(doc.sections[0].rows, [{ qtyText: '1', desc: 'Cambric tape, roll', unitCents: 5601, cents: 5601 }]);
  assert.deepStrictEqual(doc.sections[1].rows, [{ qtyText: '5 hrs', desc: 'Labor hours', unitCents: 8500, cents: 42500 }]);
  assert.deepStrictEqual([doc.subtotalCents, doc.taxCents, doc.totalCents], [48101, 0, 48101]);
  assert.strictEqual(doc.footer, 'Thank you for choosing Cantu Electric LLC. We appreciate your business');
  assert.strictEqual(doc.fileName, 'CE Invoice 166816 - United Dairymen of Arizona - Temp boiler rewire.pdf');
});

test('build: a draft has no number and a range prints as dates; empty sections are left out', () => {
  const { d, inv } = world();
  inv.number = null; inv.dateISO = null; inv.serviceTo = '2026-07-09'; inv.items = [];
  const doc = V.build(inv, d);
  assert.strictEqual(doc.meta.number, null);
  assert.strictEqual(doc.meta.serviceText, 'Service dates: Jul 2 to Jul 9, 2026');
  assert.deepStrictEqual(doc.sections.map((s) => s.title), ['Labor']);
  assert.strictEqual(doc.sections[0].rows[0].desc, 'Labor hours, Jul 2 to Jul 9, 2026');
  assert.match(doc.fileName, /^CE Invoice draft - /);
});

test('build: no PO means no PO cell; a project invoice is one line as proposed', () => {
  const { d, inv, uda } = world();
  uda.po = '';
  const doc = V.build(I.draftInvoice(I.group(d.logs, d, S.mondayOf)[0] || { customerId: uda.id, projectId: d.projects[0].id, title: 'x', entries: [d.logs[0]], from: '2026-07-02', to: '2026-07-02' }, d, 1), d);
  assert.strictEqual(doc.meta.po, '');
  const b = S.newBid(d, { customerName: 'United Dairymen of Arizona', title: 'Cheese plant lighting', jobType: 'project', dateISO: '2026-06-01' });
  b.areas.push({ id: 'a', name: 'Plant', items: [{ catalogId: null, name: 'Fixture', unit: 'ea', qty: 1, costCents: 100000, priceCents: null }], photoIds: [] });
  b.number = 1057; b.status = 'won'; b.job = S.newJob(); d.bids.push(b);
  const pi = I.draftProjectInvoice(b, d, null, 1, []);
  const pdoc = V.build(pi, d);
  assert.deepStrictEqual(pdoc.sections.map((s) => s.title), ['Project']);
  assert.strictEqual(pdoc.sections[0].rows[0].desc, 'Cheese plant lighting, as proposed #1057');
  assert.strictEqual(pdoc.sections[0].rows[0].cents, pdoc.totalCents);
  assert.strictEqual(pdoc.meta.serviceText, '', 'a project invoice has no service date line');
});
