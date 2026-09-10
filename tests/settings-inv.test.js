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
  settingsPriceSearchIsDefault, settingsPriceSearchValue } = sandbox;

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
