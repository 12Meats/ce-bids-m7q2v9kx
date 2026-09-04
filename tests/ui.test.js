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

// --- Backups ----------------------------------------------------------------
// Four more that are pure and load-bearing. backupDateFromName is what the
// restore confirm names the file's day off; backupSinceMs decides what counts
// as "made since"; backupSelection decides which PDFs actually leave the phone
// and how far the date is allowed to move afterwards. Every one of them fails
// silently when it is wrong.

const { backupDateFromName, backupSinceMs, backupSelection } = sandbox;

// Midnight local of a plain day, the way the app reads its own dates.
function at(iso, hour, min) {
  return new Date(iso + 'T' + String(hour == null ? 0 : hour).padStart(2, '0')
    + ':' + String(min == null ? 0 : min).padStart(2, '0') + ':00').getTime();
}

test('backupDateFromName reads the day out of a backup file name', () => {
  assert.equal(backupDateFromName('ce-bids-backup-2026-09-04.json'), '2026-09-04');
});

test('backupDateFromName survives the copy the phone renamed', () => {
  assert.equal(backupDateFromName('ce-bids-backup-2026-09-04 (1).json'), '2026-09-04');
  assert.equal(backupDateFromName('/var/mobile/Downloads/ce-bids-backup-2026-09-04.json'), '2026-09-04');
});

test('backupDateFromName is null when there is no date to read', () => {
  ['backup.json', 'ce-bids-backup.json', 'ce-bids-backup-09-04.json', '', null, undefined]
    .forEach((v) => assert.equal(backupDateFromName(v), null, String(v)));
});

test('backupSinceMs is midnight of the backup day, and zero when there is no backup', () => {
  assert.equal(backupSinceMs('2026-09-04'), at('2026-09-04'));
  [null, undefined, '', 'nope', 42].forEach((v) => assert.equal(backupSinceMs(v), 0, String(v)));
});

test('a PDF archived the same day as the last backup is still included', () => {
  const lastBackupAt = '2026-09-04';
  const sameDay = { id: 'a', bidId: 'b1', at: at('2026-09-04', 9, 30) };   // hours before the backup or after it
  const dayBefore = { id: 'b', bidId: 'b1', at: at('2026-09-03', 23, 59) };
  const sel = backupSelection([dayBefore, sameDay], lastBackupAt, '2026-09-10', 25);
  assert.deepEqual(sel.send.map((e) => e.id), ['a']);
  assert.equal(sel.truncated, 0);
  assert.equal(sel.nextLastBackupAt, '2026-09-10');
});

test('backupSelection on an empty phone sends nothing and dates the backup today', () => {
  const sel = backupSelection([], '2026-09-01', '2026-09-04', 25);
  assert.deepEqual(sel.send, []);
  assert.equal(sel.truncated, 0);
  assert.equal(sel.nextLastBackupAt, '2026-09-04');
});

test('backupSelection under the cap sends everything pending, oldest first', () => {
  const entries = [
    { id: 'c', bidId: 'b1', at: at('2026-09-03') },
    { id: 'a', bidId: 'b1', at: at('2026-09-01') },
    { id: 'b', bidId: 'b2', at: at('2026-09-02') },
  ];
  const sel = backupSelection(entries, null, '2026-09-04', 25);
  assert.deepEqual(sel.send.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(sel.truncated, 0);
  assert.equal(sel.nextLastBackupAt, '2026-09-04');
});

test('over the cap it takes the OLDEST and only dates the backup up to the last one sent', () => {
  // Ten days, one PDF each. A cap of four must take days 1-4 and leave 5-10
  // pending, which only happens if the date stops at day 4.
  const entries = [];
  for (let i = 1; i <= 10; i += 1) {
    entries.push({ id: 'p' + i, bidId: 'b1', at: at('2026-09-' + String(i).padStart(2, '0'), 8) });
  }
  const sel = backupSelection(entries.slice().reverse(), null, '2026-09-20', 4);
  assert.deepEqual(sel.send.map((e) => e.id), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(sel.truncated, 6);
  assert.equal(sel.nextLastBackupAt, '2026-09-04');

  // The next backup picks up where that one stopped and drains the rest.
  const next = backupSelection(entries, sel.nextLastBackupAt, '2026-09-20', 25);
  assert.deepEqual(next.send.map((e) => e.id), ['p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  assert.equal(next.truncated, 0);
});

test('backupSelection ignores anything that is not a real archive stamp', () => {
  const sel = backupSelection([null, { id: 'x' }, { id: 'y', at: NaN }, { id: 'z', at: at('2026-09-02') }],
    null, '2026-09-04', 25);
  assert.deepEqual(sel.send.map((e) => e.id), ['z']);
});
