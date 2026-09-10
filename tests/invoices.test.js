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
  // The picker's cost keypad offers "Check price" only when there is signal to
  // check it with, so the line strip reads navigator on its way past.
  navigator: { onLine: true },
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
  invoiceRecordPayment, invoiceStatusPill, invoiceShare, invoiceDelete,
  invoiceNoteOpts, noteAdd, billThisJobText, billThisJobConfirm, bidHasInvoices,
  invoiceLineOpts, lineAskCost, moneyText,
  enterLog, logTarget, logScreenTitle, logSetFrom, logSetTo, logSetReady,
  logMarkDone, logMarkDoneText, logProjectsOffered, entryStatusPill } = sandbox;
// Two of the log screen's sentences are top-level consts, which are lexical
// rather than properties of the context's global object. Read the way
// pileSelection is, just below.
const LOG_NUMBER_CAPTION = vm.runInContext('LOG_NUMBER_CAPTION', sandbox);
const LOG_SWAP_TEXT = vm.runInContext('LOG_SWAP_TEXT', sandbox);
// pileSelection is a const inside picker.js, and a const declared at the top of
// a script is not a property of the context's global object the way a function
// declaration is. ui.test.js reads MISC_LABEL out of its sandbox the same way.
const pileSelection = vm.runInContext('pileSelection', sandbox);
// The send queue is a module-level let inside invoice.js, which is not a
// property of the context's global object either. Read the same way.
const invoiceQueue = () => vm.runInContext('invoiceQueue', sandbox);

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

test('one day old reads singular: "1 day", not "1 days"', () => {
  const w = world();
  const p = S.newProject(w.d, w.uda.id, 'Chiller yard', '2026-09-01');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: p.id, dateISO: '2026-09-07', createdAt: 4 });
  e.crew = [{ crewId: w.c1, hours: 4 }];
  const g = I.group(w.d.logs, w.d, S.mondayOf).find((x) => x.title === 'Chiller yard');
  assert.strictEqual(pileRowText(g, TODAY), 'Sep 7 · 1 day · 4 hrs');
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

test('sent one day ago reads "1 day", not "1 days"', () => {
  const w = world();
  const inv = draft(w);
  inv.number = 166819;
  inv.dateISO = '2026-09-07';
  inv.sentAt = '2026-09-07';
  const sent = invoiceListText(inv, TODAY);
  assert.strictEqual(sent.sub, 'Sent · 9/7/26 · 1 day');
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

// Two invoices numbered off the review, the way Friday leaves them. The stubs
// the numbering needs go through stub(t) like every other test in this file:
// set by hand they outlived a failing assertion, and every test after it then
// failed for the wrong reason.
function invoiceWorld(t) {
  const { w } = sendWorld();
  stub(t, { persistOr: () => true, showBanner: () => {}, show: () => {}, render: () => {} });
  w.d.settings.nextInvoiceNumber = 166818;
  billreviewSend();
  return w;
}

test('invoiceCanDelete: a numbered draft can go, a sent one and a review draft cannot', (t) => {
  const w = invoiceWorld(t);
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

test('the pill says draft, sent, part paid and paid, in his words', (t) => {
  const w = invoiceWorld(t);
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
  const w = invoiceWorld(t);
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
  const w = invoiceWorld(t);
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
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  inv.status = 'sent';
  enterInvoice(inv.id);
  payWith(t, inv, 915, 200100, false);
  assert.strictEqual(inv.payments.length, 0, 'nothing came in after all');
  assert.strictEqual(inv.status, 'sent', 'and it is not paid');
});

test('Clear on the date keypad is never mind, and records nothing', (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  inv.sentAt = '2026-09-05';
  enterInvoice(inv.id);
  const banners = payWith(t, inv, null, 50000, true);
  assert.strictEqual(inv.payments.length, 0, 'Clear is the way out, not a payment dated today');
  assert.deepStrictEqual(banners, []);
});

// ---------------------------------------------------------------------------
// THE SEND QUEUE
// ---------------------------------------------------------------------------
// Friday numbers four invoices and they go out one at a time, because the
// share sheet wants a tap each. The queue is what says Friday is not finished,
// and it lives on the screen rather than in the navigation argument for one
// reason: a look at the home list must not lose the three still to send.

test('coming back to one of the batch from the list keeps the ones behind it', () => {
  world();
  enterInvoice({ id: 'a', queue: ['b', 'c'] });
  assert.deepEqual(invoiceQueue(), ['b', 'c']);
  // He went out to the list and tapped the second one from there. It is still
  // the batch: the one behind it is still waiting to go out.
  enterInvoice('b');
  assert.deepEqual(invoiceQueue(), ['c']);
  assert.strictEqual(invoiceQueueText(invoiceQueue().length), '1 more to send');
  // The last of them leaves nothing behind, and the head says nothing.
  enterInvoice('c');
  assert.deepEqual(invoiceQueue(), []);
  assert.strictEqual(invoiceQueueText(invoiceQueue().length), null);
});

test('an invoice from outside the batch is a different errand, and the queue goes', () => {
  world();
  enterInvoice({ id: 'a', queue: ['b', 'c'] });
  enterInvoice('an-old-one');
  assert.deepEqual(invoiceQueue(), []);
});

// ---------------------------------------------------------------------------
// A NOTE, AND THE LIBRARY IT MAY JOIN
// ---------------------------------------------------------------------------
// The note goes on the invoice; "keep this on every future invoice" is an
// answer about his SETTINGS. On a draft under review the invoice is not on the
// file and its own save writes nothing, so a library that shared that save
// lost the chip the moment he backed out of the review.

test('a phrase kept for every future invoice lands on disk from a review draft', async (t) => {
  const w = world();
  reviewDrafts.set([I.draftInvoice(groups(w)[0], w.d, 1)]);
  enterInvoice({ draft: 0 });
  const draft = invoiceTarget();
  assert.strictEqual(draft.id, null, 'a draft under review is not on the file');

  const saves = [];
  let answered = null;
  stub(t, {
    persistOr: (revert) => { saves.push(revert); return true; },
    promptText: (cur, o) => { answered = o.done('Ladder left on site'); },
    confirmPanel: () => Promise.resolve(true),
    showBanner: () => {},
    render: () => {},
  });

  noteAdd(draft.notes, invoiceNoteOpts(draft));
  await answered;

  assert.deepEqual(draft.notes, ['Ladder left on site'], 'the note is on the draft');
  assert.deepEqual(w.d.settings.notePhrases.slice(-1), ['Ladder left on site'], 'and in the library');
  assert.strictEqual(saves.length, 1,
    'one save: the library. The draft itself is not on the file and wrote nothing');
  // And that one save is the library's: its restore takes the chip back off
  // and leaves the note where he wrote it.
  saves[0]();
  assert.strictEqual(w.d.settings.notePhrases.indexOf('Ladder left on site'), -1);
  assert.deepEqual(draft.notes, ['Ladder left on site']);
});

// ---------------------------------------------------------------------------
// SENDING ONE
// ---------------------------------------------------------------------------
// The PDF, the share sheet, and the two questions only he can answer. What is
// pinned here is what reaches the FILE: nothing at all when he backs out of the
// sheet, both flags in one save when he does not, and nothing left standing
// when the save is refused.

function shareWith(t, over) {
  const saves = [];
  const asked = [];
  stub(t, Object.assign({
    persistOr: (revert) => { saves.push(revert); return true; },
    confirmPanel: (text) => { asked.push(text); return Promise.resolve(true); },
    showBanner: () => {},
    render: () => {},
    DocGen: { blobInvoice: () => Promise.resolve({ bytes: 1 }), share: () => Promise.resolve('shared') },
  }, over || {}));
  return { saves, asked };
}

test('backing out of the share sheet writes nothing and asks nothing', async (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  const { saves, asked } = shareWith(t, {
    DocGen: { blobInvoice: () => Promise.resolve({ bytes: 1 }), share: () => Promise.resolve('cancelled') },
  });
  await invoiceShare(inv);
  assert.deepStrictEqual(asked, [], 'a sheet he closed is not a document that went out');
  assert.deepStrictEqual(saves, []);
  assert.strictEqual(inv.sentAt, null);
  assert.strictEqual(inv.savedToFilesAt, null);
});

test('both answers yes: one save, both dates, and the status follows', async (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  const { saves, asked } = shareWith(t);
  await invoiceShare(inv);
  assert.deepStrictEqual(asked, ['Sent to the customer?', 'Did you save a copy on the phone?']);
  assert.strictEqual(saves.length, 1, 'sent and filed go to disk together or not at all');
  assert.strictEqual(inv.sentAt, S.todayISO());
  assert.strictEqual(inv.savedToFilesAt, S.todayISO());
  assert.strictEqual(inv.status, 'sent', 'derived on the write, never set by hand');
});

test('a refused save leaves it unsent, unfiled and a draft', async (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  shareWith(t, { persistOr: (revert) => { revert(); return false; } });
  await invoiceShare(inv);
  assert.strictEqual(inv.sentAt, null);
  assert.strictEqual(inv.savedToFilesAt, null);
  assert.strictEqual(inv.status, 'draft');
});

// ---------------------------------------------------------------------------
// DELETING ONE
// ---------------------------------------------------------------------------
// A numbered invoice nobody has seen can go, and its hours come back to the
// pile. The PDFs go with it, but only once the file itself has been written:
// a refused save with the blobs already gone is the one outcome there is no
// way back from.

test('a delete unlocks the hours, takes the invoice off, then clears the PDFs', async (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  const order = [];
  const deleted = [];
  stub(t, {
    confirmPanel: () => Promise.resolve(true),
    persistOr: () => { order.push('save'); return true; },
    showBanner: () => {},
    show: () => {},
    render: () => {},
    Photos: {
      list: () => Promise.resolve(['pdf-inv-' + inv.id + '-5', 'pdf-1-9']),
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(true),
      delMany: (ids) => { order.push('delMany'); deleted.push(...ids); return Promise.resolve(true); },
    },
  });

  await invoiceDelete(inv);
  await new Promise((done) => setTimeout(done, 0));

  assert.strictEqual(w.d.invoices.indexOf(inv), -1, 'off the file');
  inv.logIds.forEach((id) => {
    assert.strictEqual(w.d.logs.find((e) => e.id === id).invoiceId, null, 'back in the pile');
  });
  assert.deepStrictEqual(order, ['save', 'delMany'], 'the bytes go only after the save');
  assert.deepStrictEqual(deleted, ['pdf-inv-' + inv.id + '-5'], 'and only the ones that are its own');
});

test('a refused delete keeps the invoice, the locks and every PDF', async (t) => {
  const w = invoiceWorld(t);
  const inv = w.d.invoices[0];
  const locked = inv.logIds.slice();
  stub(t, {
    confirmPanel: () => Promise.resolve(true),
    persistOr: (revert) => { revert(); return false; },
    showBanner: () => {},
    show: () => { throw new Error('a refused save must not navigate'); },
    render: () => {},
    Photos: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(true),
      delMany: () => { throw new Error('nothing may be deleted'); },
    },
  });

  await invoiceDelete(inv);
  await new Promise((done) => setTimeout(done, 0));

  assert.ok(w.d.invoices.indexOf(inv) !== -1, 'still on the file');
  locked.forEach((id) => {
    assert.strictEqual(w.d.logs.find((e) => e.id === id).invoiceId, inv.id, 'still locked to it');
  });
});

// ---------------------------------------------------------------------------
// BILL THIS JOB
// ---------------------------------------------------------------------------
// A won bid is money owed, and the row on the bid screen is two sentences: how
// much of the job is still to bill, and the question asked before a number is
// spent. A project invoice bills the PROPOSAL and its change orders, so the
// amount and the sentence have to agree with the paper the customer signed.

function jobWorld() {
  const w = world();
  const b = S.newBid(w.d, { customerName: 'UDA', title: 'Cheese plant lighting', jobType: 'project', dateISO: '2026-08-01' });
  b.areas.push({ id: 'a1', name: 'Plant', items: [{ catalogId: null, name: 'Fixture', unit: 'ea', qty: 10, costCents: 10000, priceCents: null }], photoIds: [] });
  b.labor.days = 2;
  b.status = 'won';
  b.job = S.newJob();
  w.d.bids.push(b);
  return { d: w.d, uda: w.uda, b };
}

function withItem(co, cents) {
  co.areas.push({ id: co.id + '-a', name: '', items: [{ catalogId: null, name: 'Extra', unit: 'ea', qty: 1, costCents: cents, priceCents: null }], photoIds: [] });
  return co;
}

test('the row says what is left, and the confirm says what that amount is made of', () => {
  const w = jobWorld();
  const whole = I.projectRemainingCents(w.b, w.d, []);
  assert.ok(whole > 0);
  assert.strictEqual(billThisJobText(w.b, w.d), moneyText(whole) + ' left');
  assert.strictEqual(billThisJobConfirm(w.b, w.d),
    'Invoice UDA ' + moneyText(whole) + ' for Cheese plant lighting? That is the proposal.');
});

test('the confirm counts the change orders that print, and only those', () => {
  const w = jobWorld();
  const plain = billThisJobConfirm(w.b, w.d);

  // One he opened the moment the customer said the word, with nothing in it
  // yet. It prices at $0 and never prints, so it is not part of the sentence.
  w.b.job.changeOrders.push(S.newChangeOrder(w.d, 'Nothing yet', w.b));
  assert.strictEqual(billThisJobConfirm(w.b, w.d), plain, 'an empty change order is not part of it');

  w.b.job.changeOrders.push(withItem(S.newChangeOrder(w.d, 'Extra pole light', w.b), 50000));
  const one = billThisJobConfirm(w.b, w.d);
  assert.ok(one.endsWith('? That is the proposal plus 1 change order.'), one);

  w.b.job.changeOrders.push(withItem(S.newChangeOrder(w.d, 'Second feeder', w.b), 20000));
  const two = billThisJobConfirm(w.b, w.d);
  assert.ok(two.endsWith('? That is the proposal plus 2 change orders.'), two);

  // And the money in the sentence grew with them: the change orders are what
  // is being billed, not a footnote about them.
  assert.notStrictEqual(one, plain);
  assert.notStrictEqual(two, one);
  assert.ok(I.projectRemainingCents(w.b, w.d, []) > 0);
});

test('a part now leaves the rest, and the last dollar leaves nothing to tap', () => {
  const w = jobWorld();
  const whole = I.projectRemainingCents(w.b, w.d, []);

  const first = I.draftProjectInvoice(w.b, w.d, 10000, 1);
  first.id = 'proj-1'; first.number = 166820; first.dateISO = '2026-09-01';
  w.d.invoices.push(first);
  assert.strictEqual(billThisJobText(w.b, w.d), moneyText(whole - 10000) + ' left');
  assert.strictEqual(billThisJobConfirm(w.b, w.d),
    'Invoice UDA ' + moneyText(whole - 10000) + ' for Cheese plant lighting? That is the proposal.');

  // null is "the whole of what is left", so the second one takes the rest.
  const rest = I.draftProjectInvoice(w.b, w.d, null, 2);
  rest.id = 'proj-2'; rest.number = 166821; rest.dateISO = '2026-09-02';
  w.d.invoices.push(rest);
  assert.strictEqual(billThisJobText(w.b, w.d), 'Invoiced in full');
});

test('a job with no title still reads as a sentence', () => {
  const w = jobWorld();
  w.b.title = '';
  assert.ok(billThisJobConfirm(w.b, w.d).indexOf(' for this job? ') !== -1);
});

test('bidHasInvoices is what holds a billed bid where it is', () => {
  const w = jobWorld();
  assert.strictEqual(bidHasInvoices(w.d, w.b), false, 'nothing billed against it yet');
  assert.strictEqual(bidHasInvoices(w.d, null), false, 'no bid, no invoices');

  // A pre-v3 file has no invoices array at all and must not throw.
  const bare = { ...w.d };
  delete bare.invoices;
  assert.strictEqual(bidHasInvoices(bare, w.b), false);

  const inv = I.draftProjectInvoice(w.b, w.d, 10000, 1);
  inv.id = 'proj-1'; inv.number = 166820; inv.dateISO = '2026-09-01';
  w.d.invoices.push(inv);
  assert.strictEqual(bidHasInvoices(w.d, w.b), true);

  // Only THIS bid's, and only invoices that name a bid at all: a weekly one
  // off the pile carries bidId null and belongs to no bid on the file.
  const other = S.newBid(w.d, { customerName: 'UDA', title: 'Boiler room', jobType: 'project', dateISO: '2026-08-02' });
  w.d.bids.push(other);
  assert.strictEqual(bidHasInvoices(w.d, other), false, "another bid's invoice is another bid's business");

  const weekly = I.draftInvoice(I.group(w.d.logs, w.d, S.mondayOf)[0], w.d, 2);
  weekly.id = 'tm-1';
  weekly.number = 166821;
  w.d.invoices.push(weekly);
  assert.strictEqual(weekly.bidId, null, 'a weekly invoice names no bid');
  assert.strictEqual(bidHasInvoices(w.d, other), false);
  assert.strictEqual(bidHasInvoices(w.d, w.b), true, 'and the billed one is still held');
});

// ---------------------------------------------------------------------------
// A PRICE LEARNED ON A DRAFT
// ---------------------------------------------------------------------------
// Friday night: he opens one of the drafts the review built and fixes a cost he
// fat-fingered at the truck on Tuesday. The draft is not on the file, so the
// invoice's own write does nothing — but what the part COSTS is a fact about
// his catalog and is true whether or not this draft ever becomes paper. One
// save, and it is the shell's.
test('a cost fixed on a review draft teaches the catalog, and writes the draft nowhere', (t) => {
  const w = world();
  const part = S.addCatalogItem(w.d, { category: 'wire', name: '#12 THHN', unit: 'ft' });
  part.lastCostCents = 38;

  reviewDrafts.set([I.draftInvoice(groups(w)[0], w.d, 1)]);
  enterInvoice({ draft: 0 });
  const draft = invoiceTarget();
  assert.strictEqual(draft.id, null, 'a draft under review is not on the file');

  const it = { catalogId: part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: 38, priceCents: null };
  draft.items.push(it);

  const saves = [];
  stub(t, {
    persistOr: (revert) => { saves.push(revert); return true; },
    promptMoney: (cur, o) => { o.done(4200); },
    showBanner: () => {},
    render: () => {},
  });

  lineAskCost(it, invoiceLineOpts(draft));

  assert.strictEqual(it.costCents, 4200, 'the line took the new cost');
  assert.strictEqual(part.lastCostCents, 4200, 'and so did the catalog');
  assert.strictEqual(saves.length, 1,
    'one save: the catalog. The draft is not on the file and wrote nothing');

  // And that one save is the CATALOG's: its restore puts the part's memory
  // back and leaves the line where he typed it.
  saves[0]();
  assert.strictEqual(part.lastCostCents, 38);
  assert.strictEqual(it.costCents, 4200);
});

// ---------------------------------------------------------------------------
// AN INVOICE IN PROGRESS
// ---------------------------------------------------------------------------
// The log screen stopped being a page about one day. It is the invoice before
// it has a number: a From, a To he moves as the job runs on, and a switch that
// says he is finished with it. What is pinned here is the three sentences and
// the one rule that can put a date the wrong way round.

test('the screen says what it is looking at, and what it will become', () => {
  const w = world();
  enterLog(null);
  assert.strictEqual(logScreenTitle(), 'Invoice in progress', 'a new one is already the invoice');
  enterLog(w.d.logs[0].id);
  assert.strictEqual(logScreenTitle(), 'Invoice in progress');
  // Once it is on an invoice the invoice is the record, and the entry is what
  // it was on the day.
  w.d.logs[0].invoiceId = 'inv1';
  assert.strictEqual(logScreenTitle(), 'Billed visit');
  w.d.logs[0].invoiceId = null;
  assert.strictEqual(LOG_NUMBER_CAPTION, 'It gets its number when you bill it.');
});

test('a new entry starts today at both ends, and an old one reads From = To', () => {
  const w = world();
  enterLog(null);
  const draft = logTarget();
  assert.strictEqual(draft.dateISO, S.todayISO());
  assert.strictEqual(I.entryTo(draft), draft.dateISO, 'To follows From until he moves it');
  // Every entry written before this release: one day, and it still reads as
  // one day rather than as a range with a blank on the end.
  const old = w.d.logs[0];
  assert.strictEqual(old.toISO, undefined);
  assert.strictEqual(I.entryFrom(old), '2026-08-24');
  assert.strictEqual(I.entryTo(old), '2026-08-24');
});

test('moving the To keeps the From, and moving it before the From swaps them', (t) => {
  const w = world();
  const e = w.d.logs[0];                     // Aug 24
  enterLog(e.id);
  const banners = [];
  stub(t, { persistOr: () => true, showBanner: (text) => banners.push(text), render: () => {} });

  logSetTo(e, '2026-08-28');
  assert.strictEqual(e.dateISO, '2026-08-24');
  assert.strictEqual(e.toISO, '2026-08-28');
  assert.deepStrictEqual(banners, [], 'a To after the From is simply the answer');

  // He meant the 20th, and tapped it on the To row. Two dates the wrong way
  // round is not an error to go back and undo: they swap, and it says so.
  logSetTo(e, '2026-08-20');
  assert.strictEqual(e.dateISO, '2026-08-20');
  assert.strictEqual(e.toISO, '2026-08-24');
  assert.deepStrictEqual(banners, [LOG_SWAP_TEXT]);
});

test('moving the From past the To swaps them the same way', (t) => {
  const w = world();
  const e = w.d.logs[0];
  e.toISO = '2026-08-28';
  enterLog(e.id);
  const banners = [];
  stub(t, { persistOr: () => true, showBanner: (text) => banners.push(text), render: () => {} });

  logSetFrom(e, '2026-08-31');
  assert.strictEqual(e.dateISO, '2026-08-28');
  assert.strictEqual(e.toISO, '2026-08-31');
  assert.deepStrictEqual(banners, [LOG_SWAP_TEXT]);

  // An entry with no To of its own has nothing to be the wrong way round:
  // the To follows the From wherever he puts it.
  delete e.toISO;
  banners.length = 0;
  logSetFrom(e, '2026-07-01');
  assert.strictEqual(e.dateISO, '2026-07-01');
  assert.strictEqual(e.toISO, undefined);
  assert.strictEqual(I.entryTo(e), '2026-07-01');
  assert.deepStrictEqual(banners, []);
});

test('a refused save puts both dates back, including the one that was never there', (t) => {
  const w = world();
  const e = w.d.logs[0];
  enterLog(e.id);
  stub(t, { persistOr: (revert) => { revert(); return false; }, showBanner: () => {}, render: () => {} });

  logSetTo(e, '2026-08-28');
  assert.strictEqual(e.dateISO, '2026-08-24');
  assert.strictEqual(e.toISO, undefined, 'a key that was absent is absent again, not null');

  logSetFrom(e, '2026-08-25');
  assert.strictEqual(e.dateISO, '2026-08-24');
});

test('Ready is his to set, on the entry itself', (t) => {
  const w = world();
  const e = w.d.logs[0];
  enterLog(e.id);
  stub(t, { persistOr: () => true, showBanner: () => {}, render: () => {} });
  assert.strictEqual(I.isReady(e), false, 'nothing is ready until he says so');
  logSetReady(e, true);
  assert.strictEqual(e.ready, true);
  logSetReady(e, false);
  assert.strictEqual(e.ready, false);
});

test('a refused save takes Ready back off, and leaves no key where there was none', (t) => {
  const w = world();
  const e = w.d.logs[0];
  enterLog(e.id);
  stub(t, { persistOr: (revert) => { revert(); return false; }, showBanner: () => {}, render: () => {} });
  logSetReady(e, true);
  assert.strictEqual(I.isReady(e), false, 'the disk said no, so he never said it');
  assert.strictEqual(e.ready, undefined, 'and the key it never had is still not there');
});

// ---------------------------------------------------------------------------
// MARKING THE JOB DONE
// ---------------------------------------------------------------------------
// The title stays on the chips until he says the job is finished, and until
// this release the only place to say it was Settings. The sentence says both
// halves of what happens, because "done" on a job with two unbilled visits on
// it reads like it takes them with it.

test('the confirm says what leaves and what stays', () => {
  assert.strictEqual(logMarkDoneText('UF Project'),
    'Mark UF Project done? It leaves the chips. Its unbilled invoices stay in the list.');
});

test('marking it done writes the flag and says so once', async (t) => {
  const w = world();
  const banners = [];
  stub(t, {
    confirmPanel: () => Promise.resolve(true),
    persistOr: () => true,
    showBanner: (text, kind) => banners.push([text, kind]),
    render: () => {},
  });
  await logMarkDone(w.uf);
  assert.strictEqual(w.uf.done, true);
  assert.deepStrictEqual(banners, [['UF Project is done.', 'ok']]);
});

test('a refused save leaves the job open', async (t) => {
  const w = world();
  stub(t, {
    confirmPanel: () => Promise.resolve(true),
    persistOr: (revert) => { revert(); return false; },
    showBanner: () => {},
    render: () => {},
  });
  await logMarkDone(w.uf);
  assert.strictEqual(w.uf.done, false, 'the disk said no, so the job is still open');
});

test('Cancel on the confirm changes nothing', async (t) => {
  const w = world();
  stub(t, {
    confirmPanel: () => Promise.resolve(false),
    persistOr: () => { throw new Error('nothing may be written'); },
    showBanner: () => {},
    render: () => {},
  });
  await logMarkDone(w.uf);
  assert.strictEqual(w.uf.done, false);
});

test('the job he is standing on is still offered after it is marked done', () => {
  const w = world();
  const e = w.d.logs[0];
  w.uf.done = true;
  // Store.openProjects has dropped it, which is the whole point of done. The
  // entry that names it still has to show it, or the visit he is looking at
  // reads as a visit with no job on it. The crew rows have said this for two
  // releases: the men Settings still shows, plus anyone already on this one.
  assert.deepStrictEqual(S.openProjects(w.d, w.uda.id).map((p) => p.title), []);
  assert.deepStrictEqual(logProjectsOffered(e).map((p) => p.title), ['UF Project']);
  w.uf.done = false;
  assert.deepStrictEqual(logProjectsOffered(e).map((p) => p.title), ['UF Project'], 'and only once');
});
