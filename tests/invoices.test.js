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
  navPush: () => {},
  confirmPanel: () => Promise.resolve(false),
  // The invoice screen's three panels and the two things it hands a PDF to.
  // Every one of them is replaced per test by the test that drives it; here
  // they only have to exist, because the screen reaches for them at load time
  // in nothing but a closure.
  promptNumber: () => {},
  promptMoney: () => {},
  promptText: () => {},
  InvDoc: require('../invdoc.js'),
  DocGen: { blobInvoice: () => Promise.resolve(null), share: () => Promise.resolve('shared') },
  Photos: {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(true),
    delMany: () => Promise.resolve(true),
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js first: moneyText, numText and fmtDate are the vocabulary these
// sentences are written in, and a stub of them would only test the stub. Then
// picker.js, which holds pileSelection and the row builders, and which the log
// screen calls at load time (its picker state object).
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'picker.js'), 'utf8'), sandbox, { filename: 'picker.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'invoices.js'), 'utf8'), sandbox,
  { filename: 'invoices.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'log.js'), 'utf8'), sandbox,
  { filename: 'log.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'billreview.js'), 'utf8'), sandbox,
  { filename: 'billreview.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'invoice.js'), 'utf8'), sandbox,
  { filename: 'invoice.js' });

const { pileRowText, pileEmptyText, invoiceListText, logMissing, logCrewValue, invGroupOn,
  reviewCardSub, reviewEntryText, reviewCanSend, billreviewSend, enterBillreview,
  reviewCombine, enterInvoice, invoiceTarget, invoiceCanDelete, invoiceQueueText,
  invoiceRecordPayment, invoiceStatusPill } = sandbox;
// pileSelection is a const inside picker.js, and a const declared at the top of
// a script is not a property of the context's global object the way a function
// declaration is. ui.test.js reads MISC_LABEL out of its sandbox the same way.
const pileSelection = vm.runInContext('pileSelection', sandbox);

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
// WHAT HE TURNED OFF
// ---------------------------------------------------------------------------
// The store remembers the OFF ones, never the on ones, and the difference only
// shows up on the entry that did not exist yet when he last touched the list.

test('unchecking a group leaves a brand-new entry checked', () => {
  const w = world();
  pileSelection.clear();
  const g = groups(w)[0];
  // He unchecks the UF week: both of its entries go off.
  g.entries.forEach((e) => pileSelection.setOn(e.id, false));
  assert.strictEqual(invGroupOn(g), false, 'the row he unchecked reads unchecked');
  // Then Thursday happens and he logs another visit. It is on, because he has
  // never said otherwise about an id that did not exist when he last looked.
  const later = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: w.uf.id, dateISO: '2026-09-10', createdAt: 9 });
  assert.strictEqual(pileSelection.isOn(later.id), true, 'an entry logged after his last tap is on');
  pileSelection.clear();
});

test('a group he never touched is checked, and clear puts everything back on', () => {
  const w = world();
  pileSelection.clear();
  const g = groups(w)[0];
  assert.strictEqual(invGroupOn(g), true, 'nothing said means everything billed');
  // ANY entry on reads as checked, because the review bills every entry that
  // is on: a row drawn unchecked while one of its two visits was still going
  // to be billed is the one lie these two screens may never tell.
  pileSelection.setOn(g.entries[0].id, false);
  assert.strictEqual(invGroupOn(g), true, 'one entry left on keeps the group checked');
  pileSelection.setOn(g.entries[1].id, false);
  assert.strictEqual(invGroupOn(g), false, 'every entry off is the row he unchecked');
  pileSelection.clear();
  assert.strictEqual(invGroupOn(g), true, 'the send clears the pile');
});

// The other half of the same rule: the tap sets EVERY entry, so the two
// readings only ever come apart on a row he has not touched.
test('the empty pile says whether there is nothing yet or nothing left', () => {
  const d = S.emptyData();
  assert.strictEqual(pileEmptyText(d), 'Nothing logged yet. Tap + Log hours after a visit.');
  const w = world();
  // Five visits logged and every one of them billed. "Nothing logged yet" here
  // is the app telling him his week is not there.
  w.d.logs.forEach((e) => { e.invoiceId = 'inv1'; });
  assert.strictEqual(pileEmptyText(w.d), 'Nothing waiting to bill.');
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

// ---------------------------------------------------------------------------
// THE LOG SCREEN'S TWO ANSWERS
// ---------------------------------------------------------------------------
// Save is refused for exactly three reasons and it names ONE of them, the
// first one he can do something about. A sentence that says three things are
// missing is a sentence he reads none of.

function draftEntry(over) {
  return Object.assign({
    customerId: null, projectId: null, dateISO: '2026-09-08',
    crew: [], items: [], rentals: [], equipment: [], notes: '',
  }, over || {});
}

test('logMissing names the first thing Save is waiting for', () => {
  assert.strictEqual(logMissing(draftEntry()), 'customer');
  assert.strictEqual(logMissing(draftEntry({ customerId: 'c1' })), 'project');
  assert.strictEqual(logMissing(draftEntry({ customerId: 'c1', projectId: 'p1' })), 'hours or a line');
  // A screen with nothing on it at all is still asked for a customer first,
  // rather than throwing on the way to finding that out.
  assert.strictEqual(logMissing(null), 'customer');
});

test('logMissing: hours OR a line is enough, and zero hours is not hours', () => {
  const base = { customerId: 'c1', projectId: 'p1' };
  assert.strictEqual(logMissing(draftEntry({ ...base, crew: [{ crewId: 'x', hours: 4 }] })), null);
  // A visit that dropped off a lift and left is a real visit.
  assert.strictEqual(logMissing(draftEntry({ ...base, rentals: [{ name: 'Boom lift', days: 1, cents: 28500, markup: false }] })), null);
  assert.strictEqual(logMissing(draftEntry({ ...base, equipment: [{ equipmentId: null, name: 'Bender', days: 1, dayCents: 5000 }] })), null);
  assert.strictEqual(logMissing(draftEntry({ ...base, items: [{ catalogId: null, name: 'Wire', unit: 'ft', qty: 1, costCents: 10, priceCents: null }] })), null);
  // A man put on the visit and then cleared back to nothing is not hours.
  assert.strictEqual(logMissing(draftEntry({ ...base, crew: [{ crewId: 'x', hours: 0 }] })), 'hours or a line');
});

test('logCrewValue says the hours, or says he was not on this one', () => {
  const draft = draftEntry({ crew: [{ crewId: 'c1', hours: 8 }, { crewId: 'c2', hours: 4.5 }] });
  assert.strictEqual(logCrewValue(draft, 'c1'), '8 hrs');
  assert.strictEqual(logCrewValue(draft, 'c2'), '4.5 hrs');
  // Not blank: an empty right-hand side reads as a number the app failed to
  // show, and this is an answer, not a gap.
  assert.strictEqual(logCrewValue(draft, 'c3'), 'not on this one');
  assert.strictEqual(logCrewValue(null, 'c1'), 'not on this one');
});

// ---------------------------------------------------------------------------
// THE BILL THESE REVIEW
// ---------------------------------------------------------------------------
// The last screen before an invoice number is spent. What is pinned here is
// the sentence on each card, the one rule that stops the send, and the send
// itself: one save, numbers in date order, entries locked, and every bit of it
// put back if the disk says no.

const reviewDrafts = vm.runInContext('reviewDrafts', sandbox);

function reviewWorld() {
  const w = world();
  reviewDrafts.set(groups(w).map((g) => I.draftInvoice(g, w.d, 1)));
  return w;
}

test('a review card says what it covers, the hours and rate, and what the parts bill', () => {
  const w = reviewWorld();
  // 21 hours at $85, and the wire at its LOT price of $216 — what the customer
  // pays, not the $190 it cost him. The pile row on the home says the cost;
  // this is the invoice.
  assert.strictEqual(reviewCardSub(reviewDrafts.get()[0]),
    'Aug 24 to Aug 28 · 21 hrs at $85 · $216.00 parts');
});

test('one day, no parts: the card says neither', () => {
  const w = world();
  const p = S.newProject(w.d, w.uda.id, 'R2 condensate pump', '2026-09-01');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: p.id, dateISO: '2026-09-02', createdAt: 2 });
  e.crew = [{ crewId: w.c1, hours: 4 }];
  const g = I.group(w.d.logs, w.d, S.mondayOf).find((x) => x.title === 'R2 condensate pump');
  assert.strictEqual(reviewCardSub(I.draftInvoice(g, w.d, 1)), 'Sep 2 · 4 hrs at $85');
});

test('a rate with cents on it keeps them', () => {
  const w = world();
  w.uda.rateCents = 8550;
  const g = groups(w)[0];
  assert.match(reviewCardSub(I.draftInvoice(g, w.d, 1)), /21 hrs at \$85\.50/);
});

test('an entry line names the day, the men and what was on it', () => {
  const w = world();
  const [first, second] = w.d.logs;
  // Aug 24, 2026 was a Monday.
  assert.strictEqual(reviewEntryText(first, w.d), 'Mon Aug 24 · Shawn 8, George 5');
  // One line is named; the day it was fitted on is a Friday.
  assert.strictEqual(reviewEntryText(second, w.d), 'Fri Aug 28 · Shawn 8 · #12 wire');
  // More than one, and the card counts rather than lists.
  second.items.push({ catalogId: null, name: 'Strut', unit: 'ft', qty: 10, costCents: 400, priceCents: null });
  assert.strictEqual(reviewEntryText(second, w.d), 'Fri Aug 28 · Shawn 8 · 2 lines');
});

test('reviewCanSend refuses a draft that bills nothing, and an empty review', () => {
  const w = reviewWorld();
  assert.strictEqual(reviewCanSend(reviewDrafts.get()), true);
  // He took the hours off one of them and left nothing behind.
  const empty = reviewDrafts.get()[0];
  empty.labor = [];
  empty.items = [];
  empty.rentals = [];
  empty.equipment = [];
  assert.strictEqual(I.totals(empty).total, 0);
  assert.strictEqual(reviewCanSend(reviewDrafts.get()), false, 'a $0 draft stops the whole batch');
  assert.strictEqual(reviewCanSend([]), false, 'nothing to number is not something to send');
  assert.strictEqual(reviewCanSend(null), false);
});

// ---------------------------------------------------------------------------
// THE SEND
// ---------------------------------------------------------------------------

function sendWorld() {
  const w = world();
  // A second job for the same customer, a week later, so there are two invoices
  // to number and the order they get their numbers in is visible.
  const pump = S.newProject(w.d, w.uda.id, 'R2 condensate pump', '2026-09-01');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: pump.id, dateISO: '2026-09-02', createdAt: 5 });
  e.crew = [{ crewId: w.c1, hours: 4 }];
  const gs = I.group(w.d.logs, w.d, S.mondayOf);
  reviewDrafts.set(gs.map((g) => I.draftInvoice(g, w.d, 1)));
  return { w, gs };
}

// Stubs are restored with t.after rather than by hand at the bottom of the
// test: an assertion that fires early used to leave persistOr throwing or show
// navigating for every test after it, and the failure that got reported was
// the wrong one.
function stub(t, over) {
  const before = {};
  Object.keys(over).forEach((k) => { before[k] = sandbox[k]; sandbox[k] = over[k]; });
  t.after(() => { Object.keys(before).forEach((k) => { sandbox[k] = before[k]; }); });
}

test('the send numbers in date order, locks the entries, and clears the pile', (t) => {
  const { w, gs } = sendWorld();
  pileSelection.setOn(w.d.logs[0].id, false);   // something for clear() to undo
  const saves = [];
  const banners = [];
  const shown = [];
  const order = [];
  stub(t, {
    persistOr: (revert) => { saves.push(revert); return true; },
    showBanner: (text, kind) => { banners.push([text, kind]); order.push('banner'); },
    show: (screen, arg, opts) => { shown.push([screen, arg, opts]); order.push('show'); },
    render: () => {},
  });
  w.d.settings.nextInvoiceNumber = 166818;

  billreviewSend();

  assert.strictEqual(saves.length, 1, 'every invoice and every lock in ONE save');
  const made = w.d.invoices;
  assert.strictEqual(made.length, 2);
  // The groups are oldest first, so the numbers run with the work.
  assert.deepStrictEqual(made.map((x) => x.number), [166818, 166819]);
  assert.deepStrictEqual(made.map((x) => x.projectTitle), [gs[0].title, gs[1].title]);
  assert.strictEqual(w.d.settings.nextInvoiceNumber, 166820);
  made.forEach((inv) => {
    assert.ok(inv.id, 'a numbered invoice has an id');
    assert.strictEqual(inv.dateISO, S.todayISO());
    assert.strictEqual(inv.status, 'draft', 'numbered is not sent');
  });
  // Every entry on an invoice is locked to it, which is what makes it
  // read-only at the truck and keeps it out of the pile.
  w.d.logs.forEach((e) => {
    const owner = made.find((inv) => inv.logIds.indexOf(e.id) !== -1);
    assert.strictEqual(e.invoiceId, owner.id, 'the entry is locked to its invoice');
  });
  // The pile is empty and everything he had turned off is forgotten with it.
  assert.strictEqual(pileSelection.isOn(w.d.logs[0].id), true);
  // deepEqual, not deepStrictEqual: the argument object was built inside the VM
  // and carries that realm's Object prototype, which strict equality compares.
  assert.deepEqual(shown, [['invoice',
    { id: made[0].id, queue: [made[1].id] }, { replace: true }]]);
  // The banner is raised AFTER the navigation. show() clears the banner of the
  // screen it is leaving, so a banner raised first is a banner he never sees.
  assert.deepStrictEqual(banners, [['2 invoices numbered.', 'ok']]);
  assert.ok(order.indexOf('show') < order.indexOf('banner'), 'the banner comes after the navigation');
  // The review is put away with the pile. These drafts are invoices on the
  // file now; left standing they would be a second, editable copy of a
  // numbered invoice, and the next Bill these would open holding this batch.
  // The length, not deepStrictEqual: the array was built inside the VM and
  // carries that realm's Array prototype, which strict equality compares.
  assert.strictEqual(reviewDrafts.get().length, 0);
});

// A backup written before this release has no invoices array at all: every new
// key is optional on disk, and nothing else in the app creates this one.
test('the send creates the invoices array on a restored pre-v3 file', (t) => {
  const { w } = sendWorld();
  delete w.d.invoices;
  stub(t, { persistOr: () => true, showBanner: () => {}, show: () => {}, render: () => {} });

  billreviewSend();

  assert.strictEqual(w.d.invoices.length, 2, 'the invoices landed on the document itself');
  w.d.logs.forEach((e) => assert.ok(e.invoiceId, 'and the entries are locked to them'));
});

test('a refused save puts the numbers, the invoices and the locks back', (t) => {
  const { w } = sendWorld();
  const before = w.d.settings.nextInvoiceNumber;
  // Something he turned off on the home, which a refused send may not forget:
  // the entry he decided not to bill is still not billed.
  pileSelection.setOn(w.d.logs[0].id, false);
  t.after(() => pileSelection.clear());
  stub(t, {
    persistOr: (revert) => { revert(); return false; },
    showBanner: () => {},
    show: () => { throw new Error('a refused save must not navigate'); },
    render: () => {},
  });

  billreviewSend();

  assert.strictEqual(pileSelection.isOn(w.d.logs[0].id), false, 'the entry he set off stays off');

  assert.deepStrictEqual(w.d.invoices, [], 'nothing was left on the file');
  assert.strictEqual(w.d.settings.nextInvoiceNumber, before, 'the number was not spent');
  w.d.logs.forEach((e) => assert.strictEqual(e.invoiceId, null, 'the entry is back in the pile'));
  // And the drafts are drafts again: a second tap on Send must not push
  // invoices that already carry a number the disk never took.
  reviewDrafts.get().forEach((inv) => {
    assert.strictEqual(inv.id, null);
    assert.strictEqual(inv.number, null);
    assert.strictEqual(inv.dateISO, null);
  });
});

test('the send refuses a batch with a $0 invoice in it and writes nothing', (t) => {
  const { w } = sendWorld();
  reviewDrafts.get()[1].labor = [];
  const banners = [];
  stub(t, {
    persistOr: () => { throw new Error('nothing may be written'); },
    showBanner: (text) => banners.push(text),
    render: () => {},
  });

  billreviewSend();

  assert.deepStrictEqual(w.d.invoices, []);
  assert.deepStrictEqual(banners, ['One of these bills nothing. Put hours or a line on it, or uncheck it.']);
});

// ---------------------------------------------------------------------------
// WHAT THE DRAFTS WERE BUILT FROM
// ---------------------------------------------------------------------------
// The review keeps its drafts across a trip into an invoice and back, so a
// Combine and every billed hour he changed survive it. They may only be kept
// while they are still TRUE: he can open a visit from the pile, correct the
// hours or move it to the Friday, and a draft carried across would then bill
// the old hours under a real invoice number.

function enterWorld() {
  const w = world();
  pileSelection.clear();
  // A second week of the same job: the catch-up case, and the one place
  // Combine has somewhere to reach.
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: w.uf.id, dateISO: '2026-09-02', createdAt: 5 });
  e.crew = [{ crewId: w.c1, hours: 4 }];
  reviewDrafts.set([]);
  vm.runInContext('reviewGroups = null; reviewBuiltKey = null;', sandbox);
  return w;
}

test('the same pile twice keeps the drafts, so a Combine survives a re-enter', () => {
  const w = enterWorld();
  enterBillreview();
  assert.strictEqual(reviewDrafts.get().length, 2, 'two weeks of the one job');
  reviewCombine(0);
  assert.strictEqual(reviewDrafts.get().length, 1, 'his old one-invoice habit');
  const kept = reviewDrafts.get()[0];
  kept.labor[0].billedHours = 3;
  enterBillreview();
  assert.strictEqual(reviewDrafts.get().length, 1, 'the Combine is still there');
  assert.strictEqual(reviewDrafts.get()[0], kept, 'and so is the hour he changed');
});

test('an hour corrected on a visit rebuilds the drafts', () => {
  const w = enterWorld();
  enterBillreview();
  const first = reviewDrafts.get()[0];
  assert.strictEqual(I.billedHours(first), 21);
  // He opened Monday from the pile and corrected eight hours to four.
  w.d.logs[0].crew[0].hours = 4;
  enterBillreview();
  assert.notStrictEqual(reviewDrafts.get()[0], first, 'a different pile, different drafts');
  assert.strictEqual(I.billedHours(reviewDrafts.get()[0]), 17, 'and it bills what the visit says now');
});

test('a visit moved to another day rebuilds the drafts', () => {
  const w = enterWorld();
  enterBillreview();
  assert.strictEqual(reviewDrafts.get().length, 2);
  // Friday's visit was really the Friday after: a different week, a different
  // invoice, and the same entry ids all the way through.
  w.d.logs[1].dateISO = '2026-09-04';
  enterBillreview();
  assert.strictEqual(reviewDrafts.get().length, 2);
  assert.deepStrictEqual(reviewDrafts.get().map((inv) => inv.logIds.length), [1, 2],
    'Monday alone, and the two visits that share the new week');
});

// ---------------------------------------------------------------------------
// THE INVOICE SCREEN
// ---------------------------------------------------------------------------
// The three answers on it that are decisions rather than drawings: whether an
// invoice can still be deleted, what the head says while a batch is going out,
// and what recording a check does to the file.

function invoiceWorld() {
  const { w } = sendWorld();
  const saves = [];
  sandbox.persistOr = (revert) => { saves.push(revert); return true; };
  sandbox.showBanner = () => {};
  sandbox.show = () => {};
  sandbox.render = () => {};
  w.d.settings.nextInvoiceNumber = 166818;
  billreviewSend();
  sandbox.persistOr = () => true;
  return w;
}

test('invoiceCanDelete: a numbered draft can go, a sent one and a review draft cannot', () => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  assert.strictEqual(invoiceCanDelete(inv), true, 'numbered, never shared, nobody has seen it');
  inv.sentAt = '2026-09-08';
  assert.strictEqual(invoiceCanDelete(inv), false, 'the customer is holding it');
  inv.sentAt = null;
  // A draft under review has no id: it is not on the file, and it is unchecked
  // on the home rather than deleted here.
  assert.strictEqual(invoiceCanDelete({ id: null, number: null, sentAt: null }), false);
  assert.strictEqual(invoiceCanDelete(null), false);
});

test('the head says how many are still behind this one, and nothing when none are', () => {
  assert.strictEqual(invoiceQueueText(3), '3 more to send');
  assert.strictEqual(invoiceQueueText(1), '1 more to send');
  assert.strictEqual(invoiceQueueText(0), null);
});

test('the pill says draft, sent, part paid and paid, in his words', () => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  assert.strictEqual(invoiceStatusPill(inv), 'Draft', 'numbered is not sent');
  inv.sentAt = '2026-09-08';
  assert.strictEqual(invoiceStatusPill(inv), 'Sent');
  inv.payments.push({ dateISO: '2026-09-15', cents: 50000 });
  assert.strictEqual(invoiceStatusPill(inv), 'Paid $500.00 of $2,001.00');
  inv.payments.push({ dateISO: '2026-09-20', cents: 150100 });
  assert.strictEqual(invoiceStatusPill(inv), 'Paid');
});

// The two panels a payment comes through, driven by hand: a date on the number
// keypad and then the money.
function payWith(t, inv, dateTyped, cents, saved) {
  const banners = [];
  stub(t, {
    // 'today' is one tap on Done with what the keypad already holds.
    promptNumber: (cur, opts) => opts.done(dateTyped === 'today' ? cur : dateTyped),
    promptMoney: (cur, opts) => opts.done(cents),
    persistOr: (revert) => { if (saved === false) { revert(); return false; } return true; },
    showBanner: (text) => banners.push(text),
    render: () => {},
  });
  invoiceRecordPayment(inv);
  return banners;
}

test('a payment lands on the date he typed, and the status follows the money', (t) => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  inv.status = I.statusOf(inv);
  enterInvoice(inv.id);
  assert.strictEqual(invoiceTarget(), inv, 'the screen is looking at the invoice on the file');

  const banners = payWith(t, inv, 915, 50000, true);
  assert.strictEqual(inv.payments.length, 1);
  assert.deepStrictEqual({ ...inv.payments[0] }, { dateISO: '2026-09-15', cents: 50000 });
  assert.strictEqual(inv.status, 'sent', 'half of it is not paid');
  assert.deepStrictEqual(banners, ['$1,501.00 left on this one.']);
});

test('a payment that covers the total marks it paid', (t) => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  enterInvoice(inv.id);
  const banners = payWith(t, inv, 'today', 200100, true);
  assert.strictEqual(inv.status, 'paid');
  assert.strictEqual(I.balanceCents(inv), 0);
  // One tap on Done takes the day already on the keypad: the day he records a
  // check is almost always the day it came.
  assert.strictEqual(inv.payments[0].dateISO, S.todayISO());
  assert.deepStrictEqual(banners, ['Paid in full.']);
});

test('a refused save takes the payment back off and puts the status back', (t) => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  inv.status = 'sent';
  enterInvoice(inv.id);
  payWith(t, inv, 915, 200100, false);
  assert.strictEqual(inv.payments.length, 0, 'nothing came in after all');
  assert.strictEqual(inv.status, 'sent', 'and it is not paid');
});

test('Clear on the date keypad is never mind, and records nothing', (t) => {
  const w = invoiceWorld();
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  enterInvoice(inv.id);
  const banners = payWith(t, inv, null, 50000, true);
  assert.strictEqual(inv.payments.length, 0, 'Clear is the way out, not a payment dated today');
  assert.deepStrictEqual(banners, []);
});
