'use strict';

// tests/invoices.test.js — the words on the Invoices screens.
//
// The arithmetic behind them is invmath.js's and is tested there. What is
// pinned here is the SENTENCES: the pile row that tells him a job has been
// sitting unbilled for two weeks, and the status line under an invoice that
// says whether the money came in. Those are the whole reason the tab exists,
// and they are the easiest thing in the app to change by accident, because
// changing them breaks nothing that throws.
//
// screens/invoices.js is browser code loaded as plain globals, so it runs in a
// VM with the handful of globals it touches, the same trick price.test.js
// uses. document is undefined: a function that needs it is a function this
// file is not testing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../dates.js');
const I = require('../invmath.js');

const state = { data: null, screen: 'invoices' };

const sandbox = {
  console,
  document: undefined,
  state,
  Store: S,
  BidMath: B,
  Dates: D,
  InvMath: I,
  Catalog: require('../catalog.js'),
  DocModel: require('../docmodel.js'),
  registerScreen: () => {},
  render: () => {},
  show: () => {},
  persistOr: () => true,
  showBanner: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js first: moneyText, numText and fmtDate are the vocabulary these
// sentences are written in, and a stub of them would only test the stub.
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'invoices.js'), 'utf8'), sandbox,
  { filename: 'invoices.js' });

const { pileRowText, invoiceListText } = sandbox;

const TODAY = '2026-09-08';

// One customer, one project, and the entries the mockup's pile is drawn from.
function world() {
  const d = S.emptyData();
  state.data = d;
  const uda = S.findOrCreateCustomer(d, 'UDA');
  uda.rateCents = 8500;
  const uf = S.newProject(d, uda.id, 'UF Project', '2026-08-20');
  const [c1, c2] = d.settings.crew.map((c) => c.id);
  const entry = (dateISO, crew, items) => {
    const e = S.newLogEntry(d, { customerId: uda.id, projectId: uf.id, dateISO, createdAt: 1 });
    e.crew = crew;
    e.items = items || [];
    return e;
  };
  entry('2026-08-24', [{ crewId: c1, hours: 8 }, { crewId: c2, hours: 5 }]);
  entry('2026-08-28', [{ crewId: c1, hours: 8 }],
    [{ catalogId: null, name: '#12 wire', unit: 'ft', qty: 500, costCents: 38, priceCents: null, lotCents: 21600 }]);
  return { d, uda, uf, c1, c2 };
}

function groups(w) { return I.group(w.d.logs, w.d, S.mondayOf); }

test('a pile row says what it covers, how old it is, and what is in it', () => {
  const w = world();
  // 500 ft at 38 cents is $190.00 of wire at COST. The lot price is what the
  // customer pays and belongs on the invoice, not on the row that is telling
  // him what is sitting there.
  assert.strictEqual(pileRowText(groups(w)[0], TODAY),
    'Aug 24 to Aug 28 · 15 days · 2 entries · 21 hrs · $190.00 parts');
});

test('one day, one entry, no parts: the row says none of those things', () => {
  const w = world();
  const one = S.newProject(w.d, w.uda.id, 'R2 condensate pump', '2026-09-01');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: one.id, dateISO: '2026-09-02', createdAt: 2 });
  e.crew = [{ crewId: w.c1, hours: 4 }];
  const g = I.group(w.d.logs, w.d, S.mondayOf).find((x) => x.title === 'R2 condensate pump');
  // No "to", no "1 entries", no "$0.00 parts", and the year is not on a row
  // about last fortnight.
  assert.strictEqual(pileRowText(g, TODAY), 'Sep 2 · 6 days · 4 hrs');
});

test('half hours read as half hours, not as 4.5000001', () => {
  const w = world();
  const p = S.newProject(w.d, w.uda.id, 'Boiler room', '2026-09-01');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: p.id, dateISO: '2026-09-08', createdAt: 3 });
  e.crew = [{ crewId: w.c1, hours: 2.5 }, { crewId: w.c2, hours: 1.25 }];
  const g = I.group(w.d.logs, w.d, S.mondayOf).find((x) => x.title === 'Boiler room');
  assert.strictEqual(pileRowText(g, TODAY), 'Sep 8 · 0 days · 3.75 hrs');
});

// ---------------------------------------------------------------------------
// THE INVOICE LIST
// ---------------------------------------------------------------------------

function draft(w) {
  const inv = I.draftInvoice(groups(w)[0], w.d, 1);
  inv.id = 'inv1';
  return inv;
}

test('a draft has no number and no date on it', () => {
  const w = world();
  const t = invoiceListText(draft(w), TODAY);
  assert.strictEqual(t.name, 'Draft');
  assert.strictEqual(t.sub, 'Draft');
  assert.strictEqual(t.stale, false);
  // 21 hours at $85 plus the $216 lot.
  assert.strictEqual(t.value, '$2,001.00');
});

test('numbered but not shared is still a draft, and sent says how long ago', () => {
  const w = world();
  const inv = draft(w);
  inv.number = 166818;
  inv.dateISO = '2026-09-05';
  assert.deepStrictEqual(invoiceListText(inv, TODAY).sub, 'Draft');

  inv.sentAt = '2026-09-05';
  const sent = invoiceListText(inv, TODAY);
  assert.strictEqual(sent.name, '#166818');
  assert.strictEqual(sent.sub, 'Sent · 9/5/26 · 3 days');
  assert.strictEqual(sent.stale, false, 'three days is not old');
});

test('part paid says what came in and what is on it; a sent invoice goes amber at 14 days', () => {
  const w = world();
  const inv = draft(w);
  inv.number = 166818;
  inv.dateISO = '2026-08-24';
  inv.sentAt = '2026-08-24';
  inv.payments.push({ dateISO: '2026-09-01', cents: 50000 });
  const t = invoiceListText(inv, TODAY);
  assert.strictEqual(t.sub, 'Paid $500.00 of $2,001.00 · 8/24/26 · 15 days');
  assert.strictEqual(t.stale, true, 'fifteen days out is amber');
});

test('paid says paid, and dates it by the payment that finished it', () => {
  const w = world();
  const inv = draft(w);
  inv.number = 166818;
  inv.dateISO = '2026-08-24';
  inv.sentAt = '2026-08-24';
  inv.payments.push({ dateISO: '2026-09-01', cents: 50000 });
  inv.payments.push({ dateISO: '2026-09-04', cents: 150100 });
  const t = invoiceListText(inv, TODAY);
  assert.strictEqual(t.sub, 'Paid · 9/4/26');
  // Paid is not late, however long it took.
  assert.strictEqual(t.stale, false);
});

test('a sent invoice for nothing reads paid without a payment to date it by', () => {
  const w = world();
  const inv = draft(w);
  inv.number = 166818;
  inv.labor = [];
  inv.items = [];
  inv.dateISO = '2026-08-24';
  inv.sentAt = '2026-08-24';
  // statusOf calls a $0 sent invoice paid: nothing is owed on it. The row must
  // not go looking for the payment that settled it, because there is none.
  assert.strictEqual(I.statusOf(inv), 'paid');
  const t = invoiceListText(inv, TODAY);
  assert.strictEqual(t.value, '$0.00');
  assert.strictEqual(t.sub, 'Paid');
});
