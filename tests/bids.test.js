'use strict';

// tests/bids.test.js — the sentence on the delete confirm.
//
// Delete is the one button in the app that destroys work, and the only thing
// standing in front of it is a sentence. That sentence has to say which bid,
// whose bid, what state it was in, and whether anything already left the
// office — because "Delete bid #3053?" alone is a question he can answer yes
// to while looking at the wrong row. So it is asserted here character for
// character, the way reports.js's sentences are.
//
// screens/bids.js is browser code loaded as globals, so it runs in a VM with
// the handful of globals it touches at load time — the same trick
// reports.test.js uses. Only the pure builder is exercised; everything else on
// that screen needs a document.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../dates.js');

const state = { data: null };
const sandbox = {
  console,
  document: undefined,
  state,
  Store: S,
  BidMath: B,
  Dates: D,
  registerScreen: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js holds bidCustomerName and STATUS_LABELS: the customer name and the
// status word in the sentence are the real ones, not a stub's idea of them.
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'bids.js'), 'utf8'), sandbox, { filename: 'bids.js' });

const { bidsDeleteConfirmText } = sandbox;

// A real bid off real defaults, so the number in the sentence is the number
// the app would actually have handed him.
function bidWith(o) {
  const data = S.emptyData();
  state.data = data;
  const bid = S.newBid(data, {
    customerName: 'Schreiber Foods',
    title: 'Lactose motor',
    jobType: 'project',
    dateISO: '2026-09-05',
  });
  data.bids.push(bid);
  Object.assign(bid, o);
  return bid;
}

test('a draft names the bid and says only that it is gone', () => {
  assert.strictEqual(
    bidsDeleteConfirmText(bidWith({ status: 'draft' })),
    "Delete bid #3053 for Schreiber Foods? This can't be undone."
  );
});

test('a sent bid says it HAPPENED, and that the customer keeps their copy', () => {
  assert.strictEqual(
    bidsDeleteConfirmText(bidWith({ status: 'sent', sentAt: '2026-09-05T17:00:00.000Z' })),
    "Delete bid #3053 for Schreiber Foods? It was SENT; the customer's copy is not affected."
      + " This can't be undone."
  );
});

test('lost after it went out is something he MARKED, and the copy still stands', () => {
  assert.strictEqual(
    bidsDeleteConfirmText(bidWith({ status: 'lost', sentAt: '2026-09-05T17:00:00.000Z' })),
    "Delete bid #3053 for Schreiber Foods? It was marked LOST; the customer's copy is not affected."
      + " This can't be undone."
  );
});

// Won without a sentAt is the shape the ⋯ menu allows a delete on: marked won
// off a handshake, no PDF ever sent, no hours logged. Nothing is in anybody's
// inbox, so the sentence must not claim there is.
test('a won bid that never went out makes no promise about a customer copy', () => {
  assert.strictEqual(
    bidsDeleteConfirmText(bidWith({ status: 'won', sentAt: null })),
    "Delete bid #3053 for Schreiber Foods? It was marked WON. This can't be undone."
  );
});

test('complete reads the same way, with its own status word', () => {
  assert.strictEqual(
    bidsDeleteConfirmText(bidWith({ status: 'complete', sentAt: '2026-09-05T17:00:00.000Z' })),
    "Delete bid #3053 for Schreiber Foods? It was marked COMPLETE;"
      + " the customer's copy is not affected. This can't be undone."
  );
});
