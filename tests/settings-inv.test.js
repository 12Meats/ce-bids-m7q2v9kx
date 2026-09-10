'use strict';

// tests/settings-inv.test.js — the two rules behind Settings > Invoices and
// Settings > Customers.
//
// Everything else on those two screens is rows and panels, which this file has
// no opinion about. What is pinned here is the pair of sentences that are
// DECISIONS: whether a number he types can be used at all, and what the
// caption under Hide says is pointing at a customer. Both are the sort of
// thing that breaks quietly — an invoice number reused is a customer paying
// one number twice, and a caption that counts wrong is the reason he deletes
// something he still needs.
//
// screens/settings.js is browser code loaded as plain globals, so it runs in a
// VM with the handful of globals it touches at load, the same trick
// price.test.js and invoices.test.js use. document is undefined: a function
// that needs it is a function this file is not testing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const S = require('../storage.js');
const B = require('../bidmath.js');

const state = { data: null, screen: 'settings' };

const sandbox = {
  console,
  document: undefined,
  state,
  Store: S,
  BidMath: B,
  Dates: require('../dates.js'),
  Catalog: require('../catalog.js'),
  InvMath: require('../invmath.js'),
  DocModel: require('../docmodel.js'),
  InvDoc: require('../invdoc.js'),
  registerScreen: () => {},
  render: () => {},
  show: () => {},
  persistOr: () => true,
  showBanner: () => {},
  navPush: () => {},
  shake: () => {},
  confirmPanel: () => Promise.resolve(false),
  promptNumber: () => {},
  promptMoney: () => {},
  promptText: () => {},
  startPinChange: () => {},
  Photos: { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
  DocGen: {},
  APP_VERSION: 'billing-v3',
  APP_BUILT: '2026-09-08',
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js and picker.js first: moneyText is the vocabulary a rate is written in,
// and a stub of it would only test the stub.
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'picker.js'), 'utf8'), sandbox, { filename: 'picker.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'settings.js'), 'utf8'), sandbox,
  { filename: 'settings.js' });

const { settingsInvoiceNumberRefusal, settingsCustomerUseCaption,
  settingsCustomerValue, settingsAddressValue, settingsBackupPdfName,
  settingsPriceSearchIsDefault, settingsPriceSearchValue,
  settingsWageLabel, settingsRateLabel,
  settingsCatalogSourceFilter, settingsCatalogSub, settingsBelongsWithOptions,
  settingsBelongsWithNow, settingsHasOptions,
  settingsImportButton, settingsImportQuestion, settingsImportBanner,
  settingsImportChanging, settingsImportRightText } = sandbox;

// ---------------------------------------------------------------------------
// THE NEXT INVOICE NUMBER
// ---------------------------------------------------------------------------

function world() {
  const d = S.emptyData();
  state.data = d;
  const uda = S.findOrCreateCustomer(d, 'UDA');
  return { d, uda };
}

function invoiceOn(d, customerId, number) {
  const inv = {
    id: 'inv-' + number, number, kind: 'tm', customerId, projectTitle: 'UF Project',
    dateISO: '2026-08-28', serviceFrom: '2026-08-24', serviceTo: '2026-08-24',
    po: '', terms: 'Upon receipt', rateCents: 8500, markupPct: 15,
    labor: [], items: [], rentals: [], equipment: [], logIds: [],
    bidId: null, partCents: null, notes: [], status: 'sent', sentAt: '2026-08-28',
    savedToFilesAt: null, payments: [], createdAt: 1,
  };
  d.invoices.push(inv);
  return inv;
}

test('a number nothing is using is allowed, and a number already on an invoice is not', () => {
  const w = world();
  assert.strictEqual(settingsInvoiceNumberRefusal(w.d, 166818), null, 'a fresh phone takes any number');
  invoiceOn(w.d, w.uda.id, 166818);
  assert.strictEqual(settingsInvoiceNumberRefusal(w.d, 166818),
    'Invoice #166818 is already on an invoice. Numbers are never reused.');
  // Only that one. The next number up is his to take.
  assert.strictEqual(settingsInvoiceNumberRefusal(w.d, 166819), null);
});

test('a draft has no number, so it is nobody\'s collision', () => {
  const w = world();
  const draft = invoiceOn(w.d, w.uda.id, 166818);
  draft.number = null;
  draft.status = 'draft';
  draft.sentAt = null;
  draft.dateISO = null;
  assert.strictEqual(settingsInvoiceNumberRefusal(w.d, 166818), null);
  // And a phone with no invoices array at all — a file restored from before
  // this release — refuses nothing.
  delete w.d.invoices;
  assert.strictEqual(settingsInvoiceNumberRefusal(w.d, 1), null);
});

// ---------------------------------------------------------------------------
// WHAT IS POINTING AT A CUSTOMER
// ---------------------------------------------------------------------------
// The caption under Hide. It names the counts because "in use" on its own left
// him hunting for what: three of his four record kinds are on other screens.

test('the caption names every kind that points at the customer, singular and plural', () => {
  assert.strictEqual(settingsCustomerUseCaption({ bids: 2, projects: 1, logs: 0, invoices: 3 }),
    'On 2 bids, 1 project, 3 invoices, so it can be hidden but not deleted.');
  assert.strictEqual(settingsCustomerUseCaption({ bids: 1, projects: 0, logs: 1, invoices: 0 }),
    'On 1 bid, 1 visit, so it can be hidden but not deleted.');
  assert.strictEqual(settingsCustomerUseCaption({ bids: 0, projects: 0, logs: 4, invoices: 0 }),
    'On 4 visits, so it can be hidden but not deleted.');
});

test('nothing pointing at it is not a sentence: that is where Delete turns up', () => {
  assert.strictEqual(settingsCustomerUseCaption({ bids: 0, projects: 0, logs: 0, invoices: 0 }), null);
});

test('the counts it is handed are the ones storage keeps', () => {
  const w = world();
  const proj = S.newProject(w.d, w.uda.id, 'UF Project', '2026-08-20');
  const e = S.newLogEntry(w.d, { customerId: w.uda.id, projectId: proj.id, dateISO: '2026-08-24', createdAt: 1 });
  assert.ok(e);
  invoiceOn(w.d, w.uda.id, 166818);
  assert.strictEqual(settingsCustomerUseCaption(S.customerUseCounts(w.d, w.uda.id)),
    'On 1 project, 1 visit, 1 invoice, so it can be hidden but not deleted.');
});

// ---------------------------------------------------------------------------
// THE TWO THINGS THE ROWS SAY
// ---------------------------------------------------------------------------

test('a customer with no rate of their own is on the shop rate, and says so', () => {
  // The same three words as the caption under the row it opens, "Blank bills
  // at your Settings rate", so the value and its explanation are one name.
  assert.strictEqual(settingsCustomerValue({ rateCents: null }), 'Settings rate');
  assert.strictEqual(settingsCustomerValue({}), 'Settings rate');
  assert.strictEqual(settingsCustomerValue({ rateCents: 8500 }), '$85.00/hr');
});

test('an address is two lines on paper and one line on the row', () => {
  assert.strictEqual(settingsAddressValue({}), 'None');
  assert.strictEqual(settingsAddressValue({ address: '   ' }), 'None');
  assert.strictEqual(settingsAddressValue({ address: '2008 S Hardy Drive' }), '2008 S Hardy Drive');
  assert.strictEqual(settingsAddressValue({ address: '2008 S Hardy Drive\nTempe, AZ 85282' }),
    '2008 S Hardy Drive +1');
});

// ---------------------------------------------------------------------------
// WHAT A PDF IS CALLED WHEN IT LEAVES THE PHONE
// ---------------------------------------------------------------------------
// The pile carries proposals and invoices together, and the share sheet shows
// the NAME. An id is what the phone stores it under; the name is what he will
// be looking for in a folder six months from now, so the pile asks each
// document to name itself and hangs the archive stamp on the end so three
// revisions of one paper arrive as three files.

test('an invoice in the backup pile is named the way the invoice names itself', () => {
  const w = world();
  const inv = invoiceOn(w.d, w.uda.id, 166818);
  assert.strictEqual(settingsBackupPdfName({ id: 'x', invoiceId: inv.id, at: 1757000000000 }),
    'CE Invoice 166818 - UDA - UF Project-1757000000000.pdf');

  // An invoice that is no longer on the file still gets a file name: the bytes
  // are in hand and a share sheet with a blank name on it is worse.
  assert.strictEqual(settingsBackupPdfName({ id: 'x', invoiceId: 'gone', at: 42 }), 'invoice-42.pdf');
});

test('a proposal in the same pile is still named by the bid', () => {
  const w = world();
  const b = S.newBid(w.d, { customerName: 'UDA', title: 'Cheese plant lighting', jobType: 'project', dateISO: '2026-08-01' });
  w.d.bids.push(b);
  const name = settingsBackupPdfName({ id: 'x', bidId: b.id, at: 7 });
  assert.ok(name.indexOf('UDA') !== -1, name);
  assert.ok(name.endsWith('-7.pdf'), name);
  assert.strictEqual(settingsBackupPdfName({ id: 'x', bidId: 'gone', at: 7 }), 'proposal-7.pdf');
});

// ---------------------------------------------------------------------------
// WHERE CHECK PRICE GOES
// ---------------------------------------------------------------------------
// QED is his supply house, and its own search is the one page that knows what
// he pays. Google Shopping was the answer for a phone that had not been told
// anything better, and it is on every phone in the field right now, so it
// reads as "nothing set" rather than as a link he chose. The row would
// otherwise say "Your own link" about a string he never typed, and the way
// back to the default would never appear.

test('QED is the default, the old Google string counts as one, and his own link does not', () => {
  const QED = 'https://www.qedelectric.com/product/productSearch?searchString={q}';
  const GOOGLE = 'https://www.google.com/search?tbm=shop&q={q}';
  assert.strictEqual(settingsPriceSearchIsDefault({ priceSearchUrl: QED }), true);
  assert.strictEqual(settingsPriceSearchIsDefault({ priceSearchUrl: GOOGLE }), true, 'never chosen, so not his');
  assert.strictEqual(settingsPriceSearchIsDefault({ priceSearchUrl: '  ' + GOOGLE + ' ' }), true);
  assert.strictEqual(settingsPriceSearchIsDefault({ priceSearchUrl: '' }), true, 'cleared is unset');
  assert.strictEqual(settingsPriceSearchIsDefault({}), true, 'a backup from before the field existed');
  assert.strictEqual(settingsPriceSearchIsDefault(undefined), true);
  assert.strictEqual(settingsPriceSearchIsDefault({ priceSearchUrl: 'https://x.example/?q={q}' }), false);
});

test('the row names the supply house rather than the URL', () => {
  const QED = 'https://www.qedelectric.com/product/productSearch?searchString={q}';
  assert.strictEqual(settingsPriceSearchValue({ priceSearchUrl: QED }), 'QED');
  assert.strictEqual(settingsPriceSearchValue({}), 'QED');
  assert.strictEqual(settingsPriceSearchValue({ priceSearchUrl: 'https://x.example/?q={q}' }), 'Your own link');
});

// ---------------------------------------------------------------------------
// THE PRICE FILE PICKED TWICE
// ---------------------------------------------------------------------------
// The one place on this screen that needs a DOM, so it gets one: a stub small
// enough to read, installed for the length of the test and taken back off, so
// every function above still runs against no document at all.
//
// A native file input fires change only when its value CHANGES. Adrian re-runs
// qed-prices.py, sends the same file name again, and the second pick of it is
// silent unless the handler puts the value back to empty. Nothing throws, no
// banner appears, and the button simply looks broken.

function fakeSettingsElement(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    className: '', id: '', type: '', hidden: false, value: '', files: null,
    children: [], handlers: {}, dataset: {}, attrs: {},
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    fire(name) { (this.handlers[name] || []).forEach((fn) => fn()); },
    click() { this.fire('click'); },
  };
}

function withDocument(t) {
  const before = sandbox.document;
  sandbox.document = { createElement: fakeSettingsElement };
  t.after(() => { sandbox.document = before; });
}

test('the price file input is emptied on every read, so the same file picked twice is heard twice', (t) => {
  withDocument(t);
  const box = fakeSettingsElement('section');
  sandbox.buildSetImportPrices(box);

  const picker = box.children.find((c) => c.id === 'priceFile');
  assert.ok(picker, 'the hidden input is on the card');
  assert.strictEqual(picker.type, 'file');
  assert.strictEqual(picker.hidden, true, 'hidden behind a button that looks like the others');

  // A file with no text() of its own: the read rejects, the banner is a stub,
  // and what this test is looking at happened before any of that.
  const file = { name: 'qed-prices.json' };
  picker.files = [file];
  picker.value = 'C:\fakepath\qed-prices.json';
  picker.fire('change');
  assert.strictEqual(picker.value, '', 'the value is put back, so the next change is a change');

  // And the same file again reaches the reader rather than being swallowed.
  picker.files = [file];
  picker.fire('change');
  assert.strictEqual(picker.value, '');
});

// ---------------------------------------------------------------------------
// WHAT THE KEYPAD IS ASKING FOR
// ---------------------------------------------------------------------------
// The one line above the digits, and the only feedback there is while the
// panel is open: it sits over the banner area, so nothing else can speak. A
// name and a comma reads as a note about the man with a number added after
// it; what the digits are is his pay, so the name owns the number.

test("a wage keypad asks for the man's own pay, and says how far a new one carries", () => {
  assert.strictEqual(settingsWageLabel('Ruben', false, false), "Ruben's pay an hour");
  assert.strictEqual(settingsWageLabel('Ruben', true, false), "Ruben's pay an hour on new bids");
  // A man with no name on him yet still has a wage to name.
  assert.strictEqual(settingsWageLabel('', false, false), "Worker's pay an hour");
});

// $0 is not a wage, and the reason the panel came back rides on the same line
// because a banner raised behind it is a banner nobody sees.
test('the second ask keeps the label and adds the reason', () => {
  assert.strictEqual(settingsWageLabel('Ruben', false, true),
    "Ruben's pay an hour. Enter more than $0");
  assert.strictEqual(settingsWageLabel('Ruben', true, true),
    "Ruben's pay an hour on new bids. Enter more than $0");
});

test('a customer keypad asks for their own rate the same way', () => {
  assert.strictEqual(settingsRateLabel('UDA'), "UDA's rate an hour");
  assert.strictEqual(settingsRateLabel(''), "This customer's rate an hour");
});

// ---------------------------------------------------------------------------
// PARTS CATALOG: TYPED, OR IMPORTED, AND WHAT BELONGS WITH WHAT
// ---------------------------------------------------------------------------
// v3.2 puts three hundred parts on his phone in one tap, which is three
// hundred rows he did not type sitting in among the ones he did. The filter is
// how he tells them apart, and how he weeds the imported ones he never reaches
// for without ever going near the ones that are his.
function catPart(name, extra) {
  return Object.assign({ id: name, category: 'gear', name, unit: 'ea', lastCostCents: null,
    lastListCents: null, uses: 0, hidden: false, sku: null, supplierName: null, priceCheckedISO: null },
  extra || {});
}

const QED = { kind: 'qed', checkedISO: '2026-09-09' };

test('settingsCatalogSourceFilter: all, the ones he typed, the ones QED sent', () => {
  const list = [
    catPart('60 A 3-pole breaker'),
    catPart('60 A 3-pole breaker · B360', { source: QED }),
    catPart('60 A 3-pole breaker · QO360', { source: QED }),
  ];
  assert.deepStrictEqual(settingsCatalogSourceFilter(list, 'all').map((p) => p.name), list.map((p) => p.name));
  assert.deepStrictEqual(settingsCatalogSourceFilter(list, 'typed').map((p) => p.name), ['60 A 3-pole breaker']);
  assert.deepStrictEqual(settingsCatalogSourceFilter(list, 'qed').map((p) => p.name),
    ['60 A 3-pole breaker · B360', '60 A 3-pole breaker · QO360']);
  // A mode nobody asked for shows him everything rather than an empty screen.
  assert.deepStrictEqual(settingsCatalogSourceFilter(list, 'nonsense').length, 3);
  assert.deepStrictEqual(settingsCatalogSourceFilter(null, 'qed').length, 0);
});

// The muted line under a part's name, in the order he reads it: which drawer,
// then the supplier's handle on it, then where the row itself came from, then
// how many options are behind it.
test('settingsCatalogSub says where a part came from and how many options it has', () => {
  const typed = catPart('60 A 3-pole breaker');
  assert.strictEqual(settingsCatalogSub(typed, false, 0), null, 'a plain part still says nothing');
  assert.strictEqual(settingsCatalogSub(typed, false, 3), '3 options');
  assert.strictEqual(settingsCatalogSub(typed, true, 1), 'Gear & parts · 1 option');

  const imported = catPart('60 A 3-pole breaker · B360',
    { source: QED, sku: '22590', lastListCents: 9900, priceCheckedISO: '2026-09-09' });
  assert.strictEqual(settingsCatalogSub(imported, false, 0),
    'QED 22590 · $99.00 list, Sep 9, 2026 · From QED');
});

// Only the parts that could actually hold an option: same drawer, still on the
// walk, and not already an option of something else. A two-deep chain would be
// a chooser that opens a chooser, and nobody standing on a ladder wants that.
test('settingsBelongsWithOptions: the generics in the same drawer, and nothing else', () => {
  const p = catPart('Siemens 60 A breaker');
  const sameDrawer = catPart('60 A 3-pole breaker');
  const alreadyAnOption = catPart('60 A 3-pole breaker · B360', { variantOf: '60 A 3-pole breaker' });
  const putAway = catPart('Old breaker', { hidden: true });
  const otherDrawer = Object.assign(catPart('3/4" EMT'), { category: 'conduit' });
  const list = [p, sameDrawer, alreadyAnOption, putAway, otherDrawer];
  assert.deepStrictEqual(settingsBelongsWithOptions(list, p).map((x) => x.name), ['60 A 3-pole breaker']);
});

test('settingsBelongsWithOptions: a part is never offered itself, nor one of its own options', () => {
  const p = catPart('60 A 3-pole breaker');
  const mine = catPart('60 A 3-pole breaker · B360', { variantOf: '60 A 3-pole breaker' });
  const list = [p, mine];
  assert.deepStrictEqual(settingsBelongsWithOptions(list, p).map((x) => x.name), []);
  assert.deepStrictEqual(settingsBelongsWithOptions(list, mine).map((x) => x.name), ['60 A 3-pole breaker']);
  assert.deepStrictEqual(settingsBelongsWithOptions(null, p).length, 0);
  assert.deepStrictEqual(settingsBelongsWithOptions([p], null).length, 0);
});

// ---------------------------------------------------------------------------
// IMPORT PARTS AND PRICES
// ---------------------------------------------------------------------------
// The button on the confirm is the last thing he reads before three hundred
// parts land on his phone, so it says both halves of what is about to happen
// rather than one of them.
test('the import button says what it will do, in both halves', () => {
  assert.strictEqual(settingsImportButton(12, 0), 'Update 12 prices');
  assert.strictEqual(settingsImportButton(1, 0), 'Update 1 price');
  assert.strictEqual(settingsImportButton(0, 320), 'Update 0 prices, add 320 parts');
  assert.strictEqual(settingsImportButton(12, 40), 'Update 12 prices, add 40 parts');
  assert.strictEqual(settingsImportButton(3, 1), 'Update 3 prices, add 1 part');
});

// And the banner afterwards says what DID happen. Each half only when there
// is a half to say, and the prices that were already right are still counted,
// because "nothing moved" is a real answer to an import and has to look like
// one rather than like a button that did nothing.
test('the import banner says what happened, and never trails off', () => {
  assert.strictEqual(settingsImportBanner(12, 3, 40),
    'Updated 12 prices and added 40 parts. 3 prices were already right.');
  assert.strictEqual(settingsImportBanner(12, 0, 0), 'Updated 12 prices.');
  assert.strictEqual(settingsImportBanner(0, 0, 40), 'Added 40 parts.');
  assert.strictEqual(settingsImportBanner(1, 0, 1), 'Updated 1 price and added 1 part.');
  assert.strictEqual(settingsImportBanner(0, 300, 0),
    '300 prices were already right. Nothing changed.');
  assert.strictEqual(settingsImportBanner(0, 1, 0), 'One price was already right. Nothing changed.');
  assert.strictEqual(settingsImportBanner(0, 0, 0), 'Nothing changed.');
});

test('neither sentence carries an em dash', () => {
  [settingsImportBanner(12, 3, 40), settingsImportBanner(0, 300, 0), settingsImportButton(0, 320)]
    .forEach((s) => assert.strictEqual(s.indexOf('—'), -1));
});

// The question above the button. With nothing to create it is the sentence it
// has always been; with parts about to appear, the button is what spells out
// the deal and the question just asks.
test('the import question suits what is about to happen', () => {
  assert.strictEqual(settingsImportQuestion(0), 'Update the bill-at prices?');
  assert.strictEqual(settingsImportQuestion(320), 'Go ahead?');
});

// v3.2.1. MATCHED IS NOT THE SAME AS CHANGED. Adrian sends the whole QED
// catalog every week, so the ordinary import matches three hundred parts and
// moves eight of them. "Update 318 prices" was the button promising work it
// was not going to do, and the one week the file moved nothing at all it read
// exactly the same as the week it moved everything.
test('the import counts the prices that would actually move', () => {
  const row = (was, now) => ({ oldListCents: was, newListCents: now });
  assert.strictEqual(settingsImportChanging([row(100, 120), row(250, 250), row(null, 400)]), 2,
    'a part with no price yet is a price that moves');
  assert.strictEqual(settingsImportChanging([row(250, 250)]), 0);
  assert.strictEqual(settingsImportChanging([]), 0);
  assert.strictEqual(settingsImportChanging(null), 0);
  // And the button says that number, not the number of rows it read.
  assert.strictEqual(settingsImportButton(8, 0), 'Update 8 prices');
});

// The ones that were already right are still said out loud, in the shape the
// moment calls for. With nothing else to do they ARE the answer and the
// sentence ends by saying so; beside prices that are moving they are a
// footnote on a summary that already counted the matches.
test('the import says what is already right', () => {
  assert.strictEqual(settingsImportRightText(318, 0, 0),
    'They are already right. Nothing to change.');
  assert.strictEqual(settingsImportRightText(1, 0, 0),
    'It is already right. Nothing to change.');
  assert.strictEqual(settingsImportRightText(318, 8, 0), '310 are already right.');
  assert.strictEqual(settingsImportRightText(2, 1, 0), 'One is already right.');
  // Nothing matched, or every match is moving: there is nothing to add.
  assert.strictEqual(settingsImportRightText(8, 8, 0), '');
  assert.strictEqual(settingsImportRightText(0, 0, 320), '');
  // Parts about to appear is work, so this stays a footnote and does not
  // claim there is nothing to change.
  assert.strictEqual(settingsImportRightText(318, 0, 40), '318 are already right.');
});

test('the already-right sentence carries no em dash', () => {
  [settingsImportRightText(318, 0, 0), settingsImportRightText(318, 8, 0),
    settingsImportRightText(1, 0, 0), settingsImportRightText(2, 1, 0)]
    .forEach((s) => assert.strictEqual(s.indexOf('—'), -1));
});

// A link that lands on nothing is not a link. He deleted the generic, and the
// option under it went back to standing on its own everywhere else in the app.
// "Belongs with" was the one place still reading the dead pointer as a live
// one, so a part he could no longer see the generic of could not be offered as
// somewhere to put anything, and its own row said it already belonged to
// something.
test('settingsBelongsWithOptions: a link that lands on nothing is not a link', () => {
  const p = catPart('Siemens 60 A breaker');
  const orphan = catPart('Old option', { variantOf: 'a generic he deleted' });
  const putAwayGeneric = catPart('20 A 1-pole breaker', { hidden: true });
  const underPutAway = catPart('20 A 1-pole breaker · QO120', { variantOf: '20 A 1-pole breaker' });
  const list = [p, orphan, putAwayGeneric, underPutAway];
  assert.deepStrictEqual(settingsBelongsWithOptions(list, p).map((x) => x.name),
    ['Old option', '20 A 1-pole breaker · QO120']);
});

test('settingsBelongsWithNow: the marker reads a dead link the same way', () => {
  const generic = catPart('60 A 3-pole breaker');
  const live = catPart('60 A 3-pole breaker · B360', { variantOf: '60 A 3-pole breaker' });
  const orphan = catPart('Orphan breaker', { variantOf: 'gone' });
  const list = [generic, live, orphan];
  assert.strictEqual(settingsBelongsWithNow(list, live, '60 A 3-pole breaker'), 'Now');
  assert.strictEqual(settingsBelongsWithNow(list, live, null), null);
  // The dead pointer is None, which is where the rest of the app already has
  // him: None is the row that says "Now".
  assert.strictEqual(settingsBelongsWithNow(list, orphan, null), 'Now');
  assert.strictEqual(settingsBelongsWithNow(list, orphan, 'gone'), null);
});

// Whether the part is a doorway is a question about the file, not about what
// is on the walk today. Put every option under a generic away and the generic
// is still the row they are behind: offering it "Belongs with" would let him
// build the chain the chooser cannot draw.
test('settingsHasOptions: a generic whose options are all put away still has them', () => {
  const generic = catPart('60 A 3-pole breaker');
  const putAway = catPart('60 A 3-pole breaker · B360', { variantOf: '60 A 3-pole breaker', hidden: true });
  const plain = catPart('Wire nuts');
  const list = [generic, putAway, plain];
  assert.strictEqual(settingsHasOptions(list, generic), true);
  assert.strictEqual(settingsHasOptions(list, plain), false);
  assert.strictEqual(settingsHasOptions(list, null), false);
});
