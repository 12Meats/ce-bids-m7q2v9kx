// tests/ui.test.js — the pure helpers in ui.js.
//
// ui.js is browser code: it builds DOM nodes and it is loaded as plain globals
// rather than as a module, so most of it has no business being tested here.
// Three of its functions are different — they are pure, they take plain data,
// and every one of them is load-bearing in a way a screenshot would not catch:
//
//   bidPdfParse   — a bid id is a UUID with its own dashes in it. Split on the
//                   wrong one and Settings sends the wrong bid's proposals off
//                   with a backup, or the home list deletes them.
//   bidPhotoIds   — misses the change-order areas and deleting a bid strands
//                   half its photos in IndexedDB with nothing pointing at them.
//   isEmailAddress— the gate in front of the address a backup is sent to.
//
// The file is evaluated in a VM with the handful of globals those three touch,
// which is the same trick docgen.test.js uses to run browser code under Node.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { document: undefined, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
const { bidPdfParse, bidPdfPrefix, bidPhotoIds, isEmailAddress } = sandbox;

test('bidPdfPrefix and bidPdfParse are inverses over a UUID bid id', () => {
  const bidId = '8f1c2b34-5d6e-47a8-9012-3456789abcde';
  const id = bidPdfPrefix(bidId) + 1757000000000;
  assert.equal(id, 'pdf-8f1c2b34-5d6e-47a8-9012-3456789abcde-1757000000000');
  assert.deepEqual(bidPdfParse(id), { id, bidId, at: 1757000000000 });
});

test('bidPdfParse also handles the base36 fallback id shape', () => {
  const id = bidPdfPrefix('k3n8xq2p') + 42;
  assert.deepEqual(bidPdfParse(id), { id, bidId: 'k3n8xq2p', at: 42 });
});

test('bidPdfParse refuses anything that is not one of ours', () => {
  [
    'photo-abc-123',            // the other kind of blob
    'pdf-1757000000000',        // no bid id at all
    'pdf--1757000000000',       // empty bid id
    'pdf-abc-',                 // no timestamp
    'pdf-abc-nope',             // a timestamp that isn't a number
    'pdf-abc-0',                // epoch zero is not a moment anything was made
    'pdf-',
    '',
    null,
    undefined,
    42,
  ].forEach((v) => assert.equal(bidPdfParse(v), null, String(v)));
});

test('bidPhotoIds collects the bid areas and the change-order areas, in order', () => {
  const bid = {
    areas: [{ photoIds: ['p1', 'p2'] }, { photoIds: [] }, { photoIds: ['p3'] }],
    job: { changeOrders: [{ areas: [{ photoIds: ['c1'] }] }, { areas: [] }] },
  };
  assert.deepEqual(bidPhotoIds(bid), ['p1', 'p2', 'p3', 'c1']);
});

test('bidPhotoIds survives every shape a half-built bid can be in', () => {
  assert.deepEqual(bidPhotoIds({}), []);
  assert.deepEqual(bidPhotoIds({ areas: [{}] }), []);
  assert.deepEqual(bidPhotoIds({ areas: [], job: null }), []);
  assert.deepEqual(bidPhotoIds({ areas: [], job: { changeOrders: [{}] } }), []);
});

test('isEmailAddress wants exactly one @ with something either side', () => {
  ['a@b', 'adriancantu95@gmail.com', 'first.last@sub.domain.co'].forEach((v) => {
    assert.equal(isEmailAddress(v), true, v);
  });
  ['', 'andy', '@gmail.com', 'andy@', 'a@b@c', ' @ ', 'andy at gmail.com'].forEach((v) => {
    assert.equal(isEmailAddress(v), false, JSON.stringify(v));
  });
});
