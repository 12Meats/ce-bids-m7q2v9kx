// tests/picker.test.js — the add-a-part picker, the flow lifted out of the
// walk so the log screen can offer the same one onto a log entry.
//
// Task 5 moved the code before anything new used it, which is exactly when a
// refactor is cheap and exactly when it is easiest to change something by
// accident. These tests pin the two pieces that are not DOM: the commit, which
// is the only thing in the flow that writes to disk, and the back step, which
// is the only thing that decides where Back goes.
//
// ui.js is browser code loaded as plain globals, so it is evaluated in a VM
// with the handful of globals the picker touches — the same trick ui.test.js
// and docgen.test.js use. document is undefined here on purpose: a function
// that needs it is a function this file is not testing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const S = require('../storage.js');
const B = require('../bidmath.js');
const C = require('../catalog.js');

const banners = [];
const timers = [];
const sandbox = {
  document: undefined,
  console,
  BidMath: B,
  Store: S,
  Catalog: C,
  navigator: { onLine: true },
  // Every panel the picker opens is a call into app.js. None of the pure
  // parts below reaches one; a stub that throws would be a better alarm than
  // silence, so each records the call instead.
  promptText: () => { throw new Error('promptText should not be reached here'); },
  promptNumber: () => { throw new Error('promptNumber should not be reached here'); },
  promptMoney: () => { throw new Error('promptMoney should not be reached here'); },
  showBanner: (msg) => banners.push(msg),
  // The highlight's timer: held rather than run, so a test can fire it when it
  // wants to and assert on what it did.
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
const { pickerState, pickerCommitItem, pickerBackStep, renderItemPicker } = sandbox;

// A world with one part in the catalog and one list to push onto: the log
// entry's items and an area's items are the same array to this code, which is
// the whole point of the extraction.
function world(overrides) {
  const d = S.emptyData();
  const part = S.addCatalogItem(d, { category: 'wire', name: '#12 THHN', unit: 'ft' });
  Object.assign(part, overrides || {});
  const items = [];
  const saved = [];
  const changed = [];
  timers.length = 0;
  const opts = {
    title: 'Add to Lactose room',
    items,
    tally: null,
    allowRentals: true,
    onRental: () => {},
    onDone: () => {},
    onChanged: () => changed.push(items.slice()),
    navPush: () => {},
    persistOr: (restore) => { saved.push(restore); return true; },
    data: d,
  };
  return { d, part, items, opts, saved, changed, ps: pickerState() };
}

// The picker builds its objects inside the VM, so they carry the VM's own
// Object prototype and deepStrictEqual would fail on that alone. deepEqual
// asks the question these tests actually mean: are these the same fields with
// the same values. ui.test.js reads ui.js the same way.
test('pickerState is the six things the flow is in the middle of, and nothing else', () => {
  assert.deepEqual(pickerState(), {
    cat: null, search: '', listEl: null, newPart: null, pending: null, highlight: null,
  });
  // A fresh one every call: two pickers on two screens must not share a step.
  assert.notStrictEqual(pickerState(), pickerState());
});

test('pickerCommitItem builds the line, pushes it, and records the price against the part', () => {
  const w = world({ lastListCents: 71, supplierName: 'Elliott' });
  const ok = pickerCommitItem(w.ps, w.opts, w.part, 500, 38);
  assert.strictEqual(ok, true);
  assert.deepEqual(w.items, [{
    catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: 38,
    priceCents: null, listCents: 71, supplierName: 'Elliott',
  }]);
  // The catalog's memory of the part moves with the line: one more use, and
  // the price this line paid is the price the next one starts at.
  assert.strictEqual(w.part.uses, 1);
  assert.strictEqual(w.part.lastCostCents, 38);
  // recordCatalogUse takes THREE arguments here. A fourth would be a list
  // price, and the picker has no new list price to record: passing
  // part.lastListCents back in would look harmless and would overwrite the
  // one on the part with itself forever, which is how a fourth argument gets
  // added later and quietly wipes it.
  assert.strictEqual(w.part.lastListCents, 71, 'the list price on the part was not touched');
});

test('pickerCommitItem: no second price and no supplier read as null, not undefined', () => {
  const w = world();
  pickerCommitItem(w.ps, w.opts, w.part, 2, 1200);
  assert.deepEqual(w.items[0], {
    catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 2, costCents: 1200,
    priceCents: null, listCents: null, supplierName: null,
  });
  // A supplier of whitespace is no supplier.
  const w2 = world({ supplierName: '   ' });
  pickerCommitItem(w2.ps, w2.opts, w2.part, 1, 100);
  assert.strictEqual(w2.items[0].supplierName, null);
});

test('pickerCommitItem clears pending, flashes the new line, and lets the flash time out', () => {
  const w = world();
  w.ps.pending = { part: w.part, qty: 3 };
  pickerCommitItem(w.ps, w.opts, w.part, 3, 900);
  assert.strictEqual(w.ps.pending, null, 'the same-price question is answered and gone');
  assert.strictEqual(w.ps.highlight, w.items[0], 'the line he just added is the one that flashes');
  assert.strictEqual(w.changed.length, 1, 'the caller was told to redraw once');
  assert.strictEqual(timers.length, 1);
  timers.pop().fn();
  assert.strictEqual(w.ps.highlight, null, 'the flash goes out on its own');
  assert.strictEqual(w.changed.length, 2, 'and the caller redraws without it');
});

test('pickerCommitItem: a refused save puts the line, the uses and the price back', () => {
  const w = world({ lastCostCents: 40, uses: 7 });
  w.ps.pending = { part: w.part, qty: 500 };
  w.opts.persistOr = (restore) => { restore(); return false; };
  const ok = pickerCommitItem(w.ps, w.opts, w.part, 500, 38);
  assert.strictEqual(ok, false);
  assert.deepEqual(w.items, [], 'the line came back off the list');
  assert.strictEqual(w.part.uses, 7, 'the use count came back');
  assert.strictEqual(w.part.lastCostCents, 40, 'the last price came back');
  // Nothing was saved, so nothing is behind him: the flow stays where it is
  // rather than flashing a line that is not there.
  assert.strictEqual(w.ps.pending, null);
  assert.strictEqual(w.ps.highlight, null);
});

test('the flash only clears itself, never a newer one', () => {
  const w = world();
  pickerCommitItem(w.ps, w.opts, w.part, 1, 100);
  const fired = timers.pop().fn;
  pickerCommitItem(w.ps, w.opts, w.part, 2, 200);
  const second = w.ps.highlight;
  fired();                                   // the FIRST line's timer, late
  assert.strictEqual(w.ps.highlight, second, 'a stale timer put out the wrong flash');
  timers.pop();
});

test('pickerBackStep eats pending, then the new part, then the search, then the category', () => {
  const ps = pickerState();
  ps.cat = 'wire';
  ps.search = '3/4';
  ps.newPart = { category: 'gear', name: 'Widget' };
  ps.pending = { part: {}, qty: 1 };

  assert.strictEqual(pickerBackStep(ps), true);
  assert.deepEqual([ps.pending, ps.newPart], [null, { category: 'gear', name: 'Widget' }],
    'the price answer went and the unit picker behind it stayed');
  assert.strictEqual(pickerBackStep(ps), true);
  assert.strictEqual(ps.newPart, null);
  // A search and a category are the same step out of the tiles: both go back
  // to them together, rather than the search clearing and leaving him in a
  // drawer he did not choose.
  assert.strictEqual(pickerBackStep(ps), true);
  assert.deepEqual([ps.cat, ps.search], [null, '']);
  assert.strictEqual(pickerBackStep(ps), false, 'nothing left to eat: the caller takes the step');
});

test('pickerBackStep: whitespace in the search box is not a step', () => {
  const ps = pickerState();
  ps.search = '   ';
  assert.strictEqual(pickerBackStep(ps), false);
  ps.cat = 'wire';
  assert.strictEqual(pickerBackStep(ps), true);
  assert.deepEqual([ps.cat, ps.search], [null, '']);
});

// The two wiring mistakes a screen that does not exist yet will make. They are
// checked on the first render rather than at the commit eight taps in, so the
// screen that gets them wrong says so the first time it is opened. document is
// undefined in this sandbox and both throws happen before anything is drawn,
// which is exactly the point: nothing is built until the wiring is right.
test('renderItemPicker refuses a caller with no list to push onto', () => {
  const w = world();
  assert.throws(() => renderItemPicker({}, w.ps, { ...w.opts, items: undefined }),
    /renderItemPicker needs opts\.items/);
  assert.throws(() => renderItemPicker({}, w.ps, undefined),
    /renderItemPicker needs opts\.items/);
});

test('renderItemPicker refuses rentals with nobody to answer them', () => {
  const w = world();
  assert.throws(() => renderItemPicker({}, w.ps, { ...w.opts, onRental: undefined }),
    /renderItemPicker needs opts\.onRental when allowRentals is true/);
});

test('the picker knows nothing about the walk', () => {
  // The comments come off first. This section of ui.js talks about the walk on
  // purpose — it says why the flow moved out of it — and a scan that read the
  // prose would either fail on the explanation or force the explanation out of
  // the file, which is the wrong way round. The [^:] guard keeps the "//" in
  // an https: URL from being read as the start of a comment.
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  ['walkView', 'walkSheet', 'walkAreaId', 'walkAddCat', 'state.screen', 'state.data'].forEach((name) => {
    // Word boundaries, not indexOf: a longer name that merely contains one of
    // these is not a reach into the walk, and a bare substring match would
    // start failing on the first innocent identifier that happens to spell one.
    const re = new RegExp('\\b' + name.replace(/\./g, '\\.') + '\\b');
    assert.strictEqual(re.test(src), false, 'ui.js reaches into the walk: ' + name);
  });
});

// Its own test, because it is its own claim: the assertions above are about
// what the picker did, and this one is about what it did NOT do. Riding along
// at the end of another test, it passed or failed for reasons that had nothing
// to do with the name over it.
test('nothing in the picker put a banner up', () => {
  assert.deepEqual(banners, []);
});
