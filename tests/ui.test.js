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

// A space anywhere is what a typed or half-pasted address looks like, and it
// used to pass: one @, something either side, and a To: line Mail refuses.
test('isEmailAddress refuses whitespace anywhere in the address', () => {
  ['andy smith@cox.net', 'andy@cox net', ' andy@cox.net', 'andy@cox.net ', 'andy@cox.net\n'].forEach((v) => {
    assert.equal(isEmailAddress(v), false, JSON.stringify(v));
  });
});

// --- Backups ----------------------------------------------------------------
// Three more that are pure and load-bearing. backupDateFromName is what the
// restore confirm names the file's day off. pendingPdfs and backupSelection
// decide which PDFs actually leave the phone and where the watermark lands
// afterwards, off settings.pdfsSentThroughMs — the stamp of the newest PDF
// that has really gone. Every one of them fails silently when it is wrong: a
// PDF that never leaves, or a confirm naming the wrong week's file.

const { backupDateFromName, pendingPdfs, backupSelection } = sandbox;

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

test('a null watermark means nothing has gone yet, so everything is pending', () => {
  const entries = [{ id: 'b', at: at('2026-09-02') }, { id: 'a', at: at('2026-09-01') }];
  [null, undefined, 'nope'].forEach((v) => {
    assert.deepEqual(pendingPdfs(entries, v).map((e) => e.id), ['a', 'b'], String(v));
  });
});

test('the PDF the watermark names has already gone and is not offered again', () => {
  // This is the whole point of a stamp instead of a day: on-or-after re-sent
  // the last PDF on every single backup.
  const sent = { id: 'sent', at: at('2026-09-04', 9, 30) };
  const older = { id: 'older', at: at('2026-09-03', 23, 59) };
  const newer = { id: 'newer', at: at('2026-09-04', 9, 31) };
  assert.deepEqual(pendingPdfs([older, sent, newer], sent.at).map((e) => e.id), ['newer']);
});

test('pendingPdfs ignores anything that is not a real archive stamp', () => {
  const good = { id: 'z', at: at('2026-09-02') };
  const junk = [null, undefined, { id: 'x' }, { id: 'y', at: NaN }, { id: 'w', at: 'soon' }];
  assert.deepEqual(pendingPdfs(junk.concat([good]), null).map((e) => e.id), ['z']);
  assert.deepEqual(pendingPdfs(null, null), []);
});

test('backupSelection on an empty phone sends nothing and leaves the watermark alone', () => {
  const was = at('2026-09-01');
  assert.deepEqual(backupSelection([], was, 25), { send: [], nextSentThroughMs: was, truncated: 0 });
  assert.deepEqual(backupSelection([], null, 25), { send: [], nextSentThroughMs: null, truncated: 0 });
});

test('backupSelection under the cap sends everything pending, oldest first', () => {
  const entries = [
    { id: 'c', bidId: 'b1', at: at('2026-09-03') },
    { id: 'a', bidId: 'b1', at: at('2026-09-01') },
    { id: 'b', bidId: 'b2', at: at('2026-09-02') },
  ];
  const sel = backupSelection(entries, null, 25);
  assert.deepEqual(sel.send.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(sel.truncated, 0);
  assert.equal(sel.nextSentThroughMs, at('2026-09-03'));
});

test('over the cap it takes the OLDEST and the watermark stops at the last one sent', () => {
  // Ten days, one PDF each. A cap of four must take days 1-4 and leave 5-10
  // pending, which only happens if the watermark stops at day 4.
  const entries = [];
  for (let i = 1; i <= 10; i += 1) {
    entries.push({ id: 'p' + i, bidId: 'b1', at: at('2026-09-' + String(i).padStart(2, '0'), 8) });
  }
  const sel = backupSelection(entries.slice().reverse(), null, 4);
  assert.deepEqual(sel.send.map((e) => e.id), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(sel.truncated, 6);
  assert.equal(sel.nextSentThroughMs, at('2026-09-04', 8));

  // The next backup picks up where that one stopped and drains the rest —
  // without offering p4, which already went.
  const next = backupSelection(entries, sel.nextSentThroughMs, 25);
  assert.deepEqual(next.send.map((e) => e.id), ['p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  assert.equal(next.truncated, 0);
  assert.equal(next.nextSentThroughMs, at('2026-09-10', 8));
});

test('the watermark steps over a capful whose blobs are gone', () => {
  // iOS evicts the blob and leaves the id listed. The screen filters those out
  // before it draws a button, and taking the watermark off what SURVIVED that
  // filter froze it: a capful of unreadable PDFs left it null, the same dead
  // capful was picked again next time, and the readable PDFs behind them could
  // never leave. The selection's own stamp is the one that has to be written —
  // the newest one SELECTED, readable or not, because an evicted PDF is gone
  // for good and has to be stepped over.
  const entries = [];
  for (let i = 1; i <= 10; i += 1) {
    // `unreadable` is the screen's business, not backupSelection's. It is here
    // to say out loud that the answer must not depend on it.
    entries.push({ id: 'p' + i, bidId: 'b1', at: at('2026-09-' + String(i).padStart(2, '0'), 8), unreadable: true });
  }
  const sel = backupSelection(entries, null, 4);
  assert.deepEqual(sel.send.map((e) => e.id), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(sel.send.filter((e) => !e.unreadable).length, 0);
  assert.equal(sel.nextSentThroughMs, at('2026-09-04', 8));

  // Which is the point: the next backup is past the dead ones and offers the
  // rest, instead of picking the same four corpses forever.
  const next = backupSelection(entries, sel.nextSentThroughMs, 4);
  assert.deepEqual(next.send.map((e) => e.id), ['p5', 'p6', 'p7', 'p8']);
});

test('a cap of zero sends nothing and moves nothing', () => {
  const entries = [{ id: 'a', at: at('2026-09-01') }];
  const sel = backupSelection(entries, null, 0);
  assert.deepEqual(sel.send, []);
  assert.equal(sel.truncated, 1);
  assert.equal(sel.nextSentThroughMs, null);
});
