// tests/picker.test.js — the add-a-part picker, the flow lifted out of the
// walk so the log screen can offer the same one onto a log entry.
//
// Task 5 moved the code before anything new used it, which is exactly when a
// refactor is cheap and exactly when it is easiest to change something by
// accident. These tests pin the two pieces that are not DOM: the commit, which
// is the only thing in the flow that writes to disk, and the back step, which
// is the only thing that decides where Back goes.
//
// picker.js is browser code loaded as plain globals, so it is evaluated in a
// VM with the handful of globals the picker touches — the same trick
// ui.test.js and docgen.test.js use — with ui.js in front of it, because the
// picker is written in ui.js's vocabulary (screenHead, textButton, moneyText).
// document is undefined here on purpose: a function that needs it is a
// function this file is not testing.
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
  Dates: require('../dates.js'),
  // entryStatusPill asks InvMath what Ready is; the pill only chooses words.
  InvMath: require('../invmath.js'),
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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'picker.js'), 'utf8'), sandbox, { filename: 'picker.js' });
const { pickerState, pickerCommitItem, pickerBackStep, renderItemPicker,
  partQtyLabel, partPriceLabel, partListLabel, partLotLabel,
  lineAskPrice, lineAskList,
  rentalSubText, equipSubText, addEquipment, pushEquipment, entryStatusPill,
  pickerChooserRows, pickerOptionsTag, pickerVariantCounts, pickerRowValue } = sandbox;

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
    onClose: () => {},
    navPush: () => {},
    persistOr: (restore) => { saved.push(restore); return true; },
    // The markup a new line's suggestion is figured at; the strip and the
    // add flow both read it, and nothing on the paper depends on it.
    markupPct: 15,
    data: d,
  };
  return { d, part, items, opts, saved, changed, ps: pickerState() };
}

// The picker builds its objects inside the VM, so they carry the VM's own
// Object prototype and deepStrictEqual would fail on that alone. deepEqual
// asks the question these tests actually mean: are these the same fields with
// the same values. ui.test.js reads ui.js the same way.
test('pickerState is the seven things the flow is in the middle of, and nothing else', () => {
  assert.deepEqual(pickerState(), {
    cat: null, search: '', listEl: null, newPart: null, choose: null, pending: null, highlight: null,
  });
  // A fresh one every call: two pickers on two screens must not share a step.
  assert.notStrictEqual(pickerState(), pickerState());
});

test('pickerCommitItem builds the line, pushes it, and records the price against the part', () => {
  const w = world({ lastListCents: 71, supplierName: 'Elliott' });
  const ok = pickerCommitItem(w.ps, w.opts, w.part, 500, 38);
  assert.strictEqual(ok, true);
  assert.deepEqual(w.items, [{
    catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: null,
    priceCents: 38, listCents: 71, supplierName: 'Elliott',
  }]);
  // The catalog's memory of the part moves with the line: one more use, and
  // the price he just charged is the price the next line starts at.
  assert.strictEqual(w.part.uses, 1);
  assert.strictEqual(w.part.lastPriceCents, 38);
  assert.strictEqual(w.part.lastPriceISO, S.todayISO());
  // Since v3.4 this flow names no cost at all: recordCatalogUse is called with
  // TWO arguments, so what he paid last time is left standing rather than
  // overwritten with a price, and the list price is left alone the same way.
  assert.strictEqual(w.part.lastCostCents, null, 'what he paid was not touched');
  assert.strictEqual(w.part.lastListCents, 71, 'the list price on the part was not touched');
});

test('pickerCommitItem: no second price and no supplier read as null, not undefined', () => {
  const w = world();
  pickerCommitItem(w.ps, w.opts, w.part, 2, 1200);
  assert.deepEqual(w.items[0], {
    catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 2, costCents: null,
    priceCents: 1200, listCents: null, supplierName: null,
  });
  // A supplier of whitespace is no supplier.
  const w2 = world({ supplierName: '   ' });
  pickerCommitItem(w2.ps, w2.opts, w2.part, 1, 100);
  assert.strictEqual(w2.items[0].supplierName, null);
});

test('pickerCommitItem: the line carries his price, no cost, and QED list from the catalog; the part remembers the price', () => {
  const w = world({ lastListCents: 1800, lastCostCents: 1500 });
  const ps = pickerState();
  assert.ok(pickerCommitItem(ps, w.opts, w.part, 2, 2200));
  const it = w.items[0];
  assert.strictEqual(it.costCents, null);
  assert.strictEqual(it.priceCents, 2200);
  assert.strictEqual(it.listCents, 1800);
  assert.strictEqual(w.part.lastPriceCents, 2200);
  assert.strictEqual(w.part.lastPriceISO, S.todayISO());
  assert.strictEqual(w.part.lastCostCents, 1500, 'what he paid is left alone');
  assert.strictEqual(w.part.uses, 1);
});

test('pickerCommitItem: Clear adds the line with no price of its own and remembers nothing', () => {
  const w = world({ lastListCents: 1800, lastPriceCents: 2000, lastPriceISO: '2026-09-01' });
  assert.ok(pickerCommitItem(pickerState(), w.opts, w.part, 1, null));
  assert.strictEqual(w.items[0].priceCents, null);
  assert.strictEqual(w.items[0].listCents, 1800, 'it prints the suggestion');
  assert.strictEqual(w.part.lastPriceCents, 2000, 'a line with no price does not erase the memory');
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
  const w = world({ lastCostCents: 40, uses: 7, lastPriceCents: 45, lastPriceISO: '2026-09-01' });
  w.ps.pending = { part: w.part, qty: 500 };
  w.opts.persistOr = (restore) => { restore(); return false; };
  const ok = pickerCommitItem(w.ps, w.opts, w.part, 500, 38);
  assert.strictEqual(ok, false);
  assert.deepEqual(w.items, [], 'the line came back off the list');
  assert.strictEqual(w.part.uses, 7, 'the use count came back');
  assert.strictEqual(w.part.lastPriceCents, 45, 'the price he charged last time came back');
  assert.strictEqual(w.part.lastPriceISO, '2026-09-01', 'and its date came back with it');
  assert.strictEqual(w.part.lastCostCents, 40, 'what he paid was never touched');
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

// ---------------------------------------------------------------------------
// THE FOUR QUESTIONS A LINE IS ASKED
// ---------------------------------------------------------------------------
// They moved here from ui.js with the strip that asks them: nothing else in
// the app asks a part how many of it there are. Pure string work, and every
// one of them is a sentence he reads standing in a plant with one thumb free.

test('a keypad asks about the part by name, in words', () => {
  assert.equal(partQtyLabel('3/4" EMT', 'ft'), '3/4" EMT, how many feet?');
  assert.equal(partPriceLabel('3/4" EMT', 'ft'), '3/4" EMT, price per foot');
  assert.equal(partQtyLabel('Wire nuts', 'box'), 'Wire nuts, how many boxes?');
  assert.equal(partPriceLabel('Wire nuts', 'box'), 'Wire nuts, price per box');
  // 'ea' has no English form that reads: "how many each?" is not a question.
  assert.equal(partQtyLabel('4-square', 'ea'), '4-square, how many?');
  assert.equal(partPriceLabel('4-square', 'ea'), '4-square, price each');
  // An unknown unit is passed through rather than dropped.
  assert.equal(partQtyLabel('Thing', 'crate'), 'Thing, how many?');
  assert.equal(partPriceLabel('Thing', 'crate'), 'Thing, price each');
});

test('partListLabel and partLotLabel read the way partPriceLabel does', () => {
  assert.equal(partPriceLabel('#12 THHN', 'ft'), '#12 THHN, price per foot');
  assert.equal(partPriceLabel('20 A breaker', 'ea'), '20 A breaker, price each');
  assert.equal(partListLabel('#12 THHN', 'ft'), "#12 THHN, QED's price per foot");
  assert.equal(partListLabel('20 A breaker', 'ea'), "20 A breaker, QED's price each");
  assert.equal(partLotLabel('#12 wire', 500, 'ft'), '#12 wire, all 500 feet together');
  assert.equal(partLotLabel('#12 THHN', 2, 'roll'), '#12 THHN, all 2 rolls together');
  assert.equal(partLotLabel('20 A breaker', 6, 'ea'), '20 A breaker, all 6 together');
  // A count of one has nothing to gather up. "Permits, all 1 lot together" is
  // what the rule would say, and it reads like a bug; the line is the line.
  assert.equal(partLotLabel('Permits', 1, 'lot'), 'Permits, the whole line');
  assert.equal(partLotLabel('VFD', 1, 'ea'), 'VFD, the whole line');
});

test('the picker knows nothing about the walk', () => {
  // The comments come off first. Both files talk about the walk on purpose —
  // they say why the flow moved out of it — and a scan that read the prose
  // would either fail on the explanation or force the explanation out of the
  // file, which is the wrong way round. The [^:] guard keeps the "//" in an
  // https: URL from being read as the start of a comment.
  ['ui.js', 'picker.js'].forEach((file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    ['walkView', 'walkSheet', 'walkAreaId', 'walkAddCat', 'state.screen', 'state.data'].forEach((name) => {
      // Word boundaries, not indexOf: a longer name that merely contains one of
      // these is not a reach into the walk, and a bare substring match would
      // start failing on the first innocent identifier that happens to spell one.
      const re = new RegExp('\\b' + name.replace(/\./g, '\\.') + '\\b');
      assert.strictEqual(re.test(src), false, file + ' reaches into the walk: ' + name);
    });
  });
});

// Its own test, because it is its own claim: the assertions above are about
// what the picker did, and this one is about what it did NOT do. Riding along
// at the end of another test, it passed or failed for reasons that had nothing
// to do with the name over it.
test('nothing in the picker put a banner up', () => {
  assert.deepEqual(banners, []);
});

// ---------------------------------------------------------------------------
// THE EQUIPMENT ADDER
// ---------------------------------------------------------------------------
// A day of his own gear, on a visit or on an invoice. The two screens held a
// copy each of these forty lines, right down to the wording of the banner, and
// the only real difference between them was one noun. What is pinned here is
// the shape of the line and the one refusal: a tool cannot go on twice,
// because a second line for the same tool is a day billed twice.

function toolWorld() {
  const d = S.emptyData();
  const tool = S.newTool(d, 'Scissor lift', 300000);
  const list = [];
  const saved = [];
  const closed = [];
  const added = [];
  banners.length = 0;
  const opts = {
    data: d,
    persistOr: (restore) => { saved.push(restore); return true; },
    onChanged: () => {},
    onAdded: (line) => added.push(line),
    onClose: () => closed.push(true),
    noun: 'visit',
  };
  return { d, tool, list, opts, saved, closed, added };
}

test('pushEquipment puts one day of the tool on the list, at the rate it carries', () => {
  const w = toolWorld();
  const line = pushEquipment(w.list, w.tool, 15000, w.opts);
  assert.deepEqual(line, { equipmentId: w.tool.id, name: 'Scissor lift', days: 1, dayCents: 15000 });
  assert.strictEqual(w.list.length, 1);
  assert.strictEqual(w.list[0], line);
  assert.deepStrictEqual(w.added, [line], 'the caller is handed the line, to open its strip on');
  assert.deepStrictEqual(banners, ['Scissor lift added at $150.00 a day. Tap it to change the days.']);
  // One save, and its restore takes the line back off.
  assert.strictEqual(w.saved.length, 1);
  w.saved[0]();
  assert.deepStrictEqual(w.list, []);
});

test('a refused save leaves nothing on the list and nothing for the caller to open', () => {
  const w = toolWorld();
  w.opts.persistOr = () => false;
  const line = pushEquipment(w.list, w.tool, 15000, w.opts);
  assert.strictEqual(line, null);
  assert.deepStrictEqual(w.added, []);
});

test('a tool already on the list is refused, by name, and nothing is written', () => {
  const w = toolWorld();
  pushEquipment(w.list, w.tool, 15000, w.opts);
  banners.length = 0;
  w.saved.length = 0;
  addEquipment(w.list, w.tool, w.opts);
  assert.strictEqual(w.list.length, 1, 'a second line is a day billed twice');
  assert.deepStrictEqual(w.saved, [], 'nothing to save');
  assert.deepStrictEqual(banners, ['Scissor lift is already on this visit.']);
  // The tool list it was picked from is answered and closes with it.
  assert.deepStrictEqual(w.closed, [true]);
  // The noun is the only thing that differs between the two screens.
  w.opts.noun = 'invoice';
  banners.length = 0;
  addEquipment(w.list, w.tool, w.opts);
  assert.deepStrictEqual(banners, ['Scissor lift is already on this invoice.']);
});

test('addEquipment puts a priced tool straight on, at the day rate Settings works out', () => {
  const w = toolWorld();
  addEquipment(w.list, w.tool, w.opts);
  assert.strictEqual(w.list.length, 1);
  // 4% of $3,000, to the nearest $5.
  assert.strictEqual(w.list[0].dayCents, B.equipmentDayRate(300000, w.d.settings.equipmentPct));
  assert.deepStrictEqual(w.closed, [], 'nothing was refused, so nothing was closed early');
});

test('the two sub-lines a shared line wears', () => {
  assert.equal(rentalSubText({ name: 'Boom lift', days: 1, cents: 28500, markup: true }),
    '1 day · $285.00 · markup on');
  assert.equal(rentalSubText({ name: 'Boom lift', days: 3, cents: 50100, markup: false }),
    '3 days · $501.00 · markup off');
  assert.equal(equipSubText({ name: 'Scissor lift', days: 1, dayCents: 15000 }), '1 day · $150.00 a day');
  assert.equal(equipSubText({ name: 'Scissor lift', days: 2.5, dayCents: 15000 }), '2.5 days · $150.00 a day');
});

// ---------------------------------------------------------------------------
// WHAT AN ENTRY IS, IN TWO WORDS
// ---------------------------------------------------------------------------
// The pill on the pile row and on the entry itself. Two screens print it, so
// it is written once here beside invoiceStatusPill, for the same reason: the
// card on the home and the switch on the entry may never say two different
// things about the same visit.

test('entryStatusPill says In progress until he says Ready', () => {
  assert.equal(entryStatusPill({ dateISO: '2026-09-09' }), 'In progress');
  assert.equal(entryStatusPill({ dateISO: '2026-09-09', ready: false }), 'In progress');
  assert.equal(entryStatusPill({ dateISO: '2026-09-09', ready: true }), 'Ready');
  // An entry off a backup written before this release has no such field, and
  // an entry that is not there at all is not a crash.
  assert.equal(entryStatusPill({}), 'In progress');
  assert.equal(entryStatusPill(null), 'In progress');
});

// ---------------------------------------------------------------------------
// THE CHOOSER
// ---------------------------------------------------------------------------
// v3.2. A generic part with options under it does not commit when it is
// tapped: it opens a chooser, which is the options and then "Just" the generic
// itself. Everything below is the pure half — what the rows say and where Back
// goes — because the drawing is DOM and this file has no DOM.
function optionWorld() {
  const d = S.emptyData();
  d.catalog = [];
  const generic = S.addCatalogItem(d, { category: 'gear', name: '60 A 3-pole breaker', unit: 'ea' });
  const a = S.addCatalogItem(d, { category: 'gear', name: '60 A 3-pole breaker · B360', unit: 'ea' });
  const b = S.addCatalogItem(d, { category: 'gear', name: '60 A 3-pole breaker · QO360', unit: 'ea' });
  const away = S.addCatalogItem(d, { category: 'gear', name: '60 A 3-pole breaker · BR360', unit: 'ea' });
  a.variantOf = generic.id;
  a.supplierName = 'Siemens B360 3-Pole 60 Amp 240 Volt 10 K Circuit Breaker';
  a.lastListCents = 9900;
  b.variantOf = generic.id;
  b.supplierName = 'Square D QO360 3-Pole 60 Amp Breaker';
  b.uses = 4;
  away.variantOf = generic.id;
  away.hidden = true;
  return { d, generic, a, b, away };
}

test('pickerChooserRows: the options, then Just the generic', () => {
  const w = optionWorld();
  const rows = pickerChooserRows(w.d.catalog, w.generic.id);
  assert.deepStrictEqual(rows.map((r) => r.title), [
    '60 A 3-pole breaker · QO360',
    '60 A 3-pole breaker · B360',
    'Just 60 A 3-pole breaker',
  ], 'most-used option first, and the plain part last');
  assert.strictEqual(rows[rows.length - 1].part, w.generic);
  assert.strictEqual(rows[rows.length - 1].sub, '');
});

// The second line is what tells two breakers apart: whose it is, and what it
// bills at. A part with no price yet says who makes it and nothing else,
// rather than a dollar sign with nothing after it.
test('pickerChooserRows: the sub says whose it is and what it bills at', () => {
  const w = optionWorld();
  const rows = pickerChooserRows(w.d.catalog, w.generic.id);
  const byTitle = (t) => rows.find((r) => r.title === t);
  assert.strictEqual(byTitle('60 A 3-pole breaker · B360').sub,
    'Siemens B360 3-Pole 60 Amp 240 Volt 10 K Circuit Breaker · $99.00 / ea');
  assert.strictEqual(byTitle('60 A 3-pole breaker · QO360').sub,
    'Square D QO360 3-Pole 60 Amp Breaker');
});

test('pickerChooserRows: a generic that is not there has nothing to choose from', () => {
  const w = optionWorld();
  assert.strictEqual(pickerChooserRows(w.d.catalog, 'nobody').length, 0);
  assert.strictEqual(pickerChooserRows(null, w.generic.id).length, 0);
});

test('pickerOptionsTag counts in words he would say', () => {
  assert.strictEqual(pickerOptionsTag(1), '1 option');
  assert.strictEqual(pickerOptionsTag(3), '3 options');
});

// One pass over the catalog rather than one pass per row: a list of 120 parts
// redrawn on every keystroke of a search cannot afford to ask the question 120
// times.
test('pickerVariantCounts counts the live options under each generic', () => {
  const w = optionWorld();
  const counts = pickerVariantCounts(w.d.catalog);
  assert.strictEqual(counts.get(w.generic.id), 2, 'the put-away one is not an option');
  assert.strictEqual(counts.get(w.a.id), undefined);
  assert.strictEqual(pickerVariantCounts(null).size, 0);
});

// The chooser is a step, so Back leaves it. It goes AFTER the two panels: the
// same-price question is opened from inside the chooser, and answering Back
// there has to take that question down first, or Back would clear the chooser
// behind a panel that is still on the glass and look like it did nothing.
test('pickerBackStep leaves the chooser, after the panels and before the list', () => {
  const ps = pickerState();
  ps.cat = 'gear';
  ps.choose = 'g1';
  ps.pending = { part: {}, qty: 1 };

  assert.strictEqual(pickerBackStep(ps), true);
  assert.strictEqual(ps.pending, null);
  assert.strictEqual(ps.choose, 'g1', 'the chooser is still open behind the question');
  assert.strictEqual(pickerBackStep(ps), true);
  assert.strictEqual(ps.choose, null);
  assert.strictEqual(ps.cat, 'gear', 'and he is back in the drawer he was browsing');
  assert.strictEqual(pickerBackStep(ps), true);
  assert.strictEqual(ps.cat, null);
});

// Committing anything out of the chooser closes it: he came in to pick one of
// the three, and he has picked one. A refused save leaves it open, because
// nothing was written and nothing is behind him.
test('pickerCommitItem closes the chooser, and a refused save leaves it open', () => {
  const w = world();
  w.ps.choose = 'g1';
  assert.strictEqual(pickerCommitItem(w.ps, w.opts, w.part, 2, 100), true);
  assert.strictEqual(w.ps.choose, null);

  const w2 = world();
  w2.ps.choose = 'g1';
  w2.opts.persistOr = () => false;
  assert.strictEqual(pickerCommitItem(w2.ps, w2.opts, w2.part, 2, 100), false);
  assert.strictEqual(w2.ps.choose, 'g1');
});

test('pickerState starts with no chooser open', () => {
  assert.strictEqual(pickerState().choose, null);
});

// The number on the right of every row in the parts drawer: a promise about
// the next step, which is the keypad this row opens. It printed what he PAID
// until v3.4 retired that keypad, and nothing has written the field since.
test('pickerRowValue promises the number the Price keypad will open on', () => {
  assert.equal(pickerRowValue({ unit: 'roll', lastPriceCents: 20000, lastListCents: 17267 }, 15),
    '$200.00 / roll', 'his own price first: it is what the keypad opens on');
  assert.equal(pickerRowValue({ unit: 'roll', lastPriceCents: null, lastListCents: 17267 }, 15),
    '$198.57 / roll', 'no price of his: QED plus the markup, the one-tap suggestion');
  assert.equal(pickerRowValue({ unit: 'roll', lastPriceCents: null, lastListCents: null }, 15),
    'roll', 'neither: the keypad opens empty, so the row promises nothing');
  assert.equal(pickerRowValue({ unit: 'ea' }, 15), 'ea', 'a part from before either field');
  assert.equal(pickerRowValue({ unit: 'ea', lastPriceCents: 0, lastListCents: 1800 }, 15),
    '$0.00 / ea', 'a price of nothing is a price he typed');
});

test('lineAskPrice: writes his price on the line and into the catalog, Clear takes both off', () => {
  const w = world({ lastListCents: 1800 });
  const it = { catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: null, priceCents: null, listCents: 1800 };
  w.items.push(it);
  let opened = null;
  sandbox.promptMoney = (cur, o) => { opened = { cur, o }; };
  lineAskPrice(it, Object.assign({ markupPct: 15 }, w.opts));
  assert.strictEqual(opened.cur, 2070, 'opens on what the line prints today, the suggestion');
  assert.equal(opened.o.label, '#12 THHN, price per foot');
  assert.deepEqual(opened.o.suggestions, [{ label: 'QED list + 15%', cents: 2070 }]);
  // No caption over a suggestion row: the row says it, and the sentence over
  // it is what put Done below the fold on a 375x667 phone. The link stays.
  assert.equal(opened.o.caption, '');
  assert.equal(opened.o.captionAction.label, 'Price the whole line instead');
  opened.o.done(2500);
  assert.strictEqual(it.priceCents, 2500);
  assert.strictEqual(w.part.lastPriceCents, 2500);
  assert.strictEqual(w.part.lastPriceISO, S.todayISO());
  sandbox.promptMoney = (cur, o) => { opened = { cur, o }; };
  lineAskPrice(it, Object.assign({ markupPct: 15 }, w.opts));
  assert.strictEqual(opened.cur, 2500, 'his own price now');
  assert.deepEqual(opened.o.suggestions.map((s) => s.cents), [2070, 2500]);
  opened.o.done(null);
  assert.strictEqual(it.priceCents, null, 'Clear: back to the suggestion');
  assert.strictEqual(w.part.lastPriceCents, null);
  assert.strictEqual(w.part.lastPriceISO, null);
  sandbox.promptMoney = () => { throw new Error('promptMoney should not be reached here'); };
});

test('lineAskPrice with nothing to suggest keeps a caption, and it names no suggestion', () => {
  const w = world({});
  const it = { catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: null, priceCents: null, listCents: null };
  w.items.push(it);
  let opened = null;
  sandbox.promptMoney = (cur, o) => { opened = { cur, o }; };
  lineAskPrice(it, Object.assign({ markupPct: 15 }, w.opts));
  assert.deepEqual(opened.o.suggestions, []);
  // Nothing to go back TO, so the old "Clear to go back to the suggestion"
  // half of this sentence would have been a lie as well as a line of height.
  assert.equal(opened.o.caption, 'What the paper prints, to the penny.');
  sandbox.promptMoney = () => { throw new Error('promptMoney should not be reached here'); };
});

test('lineAskPrice on a lot: the lot wins, the keypad says so, and the link changes the lot', () => {
  const w = world({});
  const it = { catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: null, priceCents: null, listCents: 40, lotCents: 21600 };
  w.items.push(it);
  let opened = null;
  sandbox.promptMoney = (cur, o) => { opened = { cur, o }; };
  lineAskPrice(it, Object.assign({ markupPct: 15 }, w.opts));
  assert.strictEqual(opened.cur, null);
  assert.ok(/priced as a lot at \$216\.00/.test(opened.o.caption));
  assert.equal(opened.o.captionAction.label, "Change the whole line's price");
  assert.deepEqual(opened.o.suggestions, []);
  sandbox.promptMoney = () => { throw new Error('promptMoney should not be reached here'); };
});

test('lineAskList: QED\'s price on the line and in the catalog, dated as his own reading', () => {
  const w = world({ lastListCents: 1800, priceCheckedISO: '2026-09-09' });
  const it = { catalogId: w.part.id, name: '#12 THHN', unit: 'ft', qty: 500, costCents: null, priceCents: null, listCents: 1800 };
  w.items.push(it);
  let opened = null;
  sandbox.promptMoney = (cur, o) => { opened = { cur, o }; };
  lineAskList(it, Object.assign({ markupPct: 15 }, w.opts));
  assert.strictEqual(opened.cur, 1800);
  assert.equal(opened.o.label, "#12 THHN, QED's price per foot");
  assert.ok(!/markup/i.test(opened.o.caption), 'no markup talk on this keypad');
  assert.equal(opened.o.captionAction.label, 'Check price');
  opened.o.done(1900);
  assert.strictEqual(it.listCents, 1900);
  assert.strictEqual(w.part.lastListCents, 1900);
  assert.strictEqual(w.part.priceCheckedISO, null, 'typed by hand, not the file');
  sandbox.promptMoney = () => { throw new Error('promptMoney should not be reached here'); };
});
