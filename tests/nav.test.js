'use strict';

// tests/nav.test.js — the back gesture and the three panels.
//
// The bug this file exists for: a swipe from the edge while the keypad was up
// navigated the screen underneath and left the keypad on the glass. He then
// tapped Done, and the number went into the bid he was no longer looking at.
// Nothing about that is visible in a screenshot, and it is not something a
// browser check can be trusted to reproduce on demand, so the rule is asserted
// here: a back gesture with a panel open cancels the panel and moves nothing.
//
// app.js is browser code loaded as plain globals, so it runs in a VM against a
// document stub — the same trick ui.test.js, reports.test.js and inputs.test.js
// use. The stub is small on purpose: getElementById hands back a recorded fake
// for any id, which is all the panels touch.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const B = require('../bidmath.js');
const D = require('../dates.js');
const K = require('../keypad.js');

function fakeElement(id) {
  return {
    id,
    tagName: 'DIV',
    attrs: {},
    children: [],
    className: '',
    value: '',
    hidden: false,
    disabled: false,
    tabIndex: 0,
    textContent: '',
    placeholder: '',
    // The banner area is a real parent in this stub: showBanner appends,
    // counts and removes, and clearBanner walks the same list.
    dataset: {},
    parent: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() {
      const p = this.parent;
      if (!p) return;
      const i = p.children.indexOf(this);
      if (i !== -1) p.children.splice(i, 1);
      this.parent = null;
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {}, blur() {}, select() {}, setSelectionRange() {},
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

// The history the app thinks it is standing in: pushState and replaceState
// record, and back() is never used — onPopState is called directly, which is
// what the browser does when the gesture lands.
const history = {
  entries: [{ ceb: 0 }],
  pushes: 0,
  pushState(st) { this.pushes += 1; this.entries.push(st); },
  replaceState(st) { this.entries[this.entries.length - 1] = st; },
};

const saved = { count: 0 };
const DATA = { version: 1, bids: [], customers: [], catalog: [], settings: {} };

const nodes = new Map();
const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, fakeElement(id));
    return nodes.get(id);
  },
  createElement: (tag) => fakeElement(tag),
  querySelectorAll: () => [],
  addEventListener() {},
};

const sandbox = {
  console,
  document,
  history,
  window: { scrollTo() {}, addEventListener() {} },
  navigator: {},          // no serviceWorker, so the block at the bottom of app.js is skipped
  setTimeout: () => 0,    // promptText re-focuses on a timer; nothing here needs it to run
  clearTimeout: () => {},
  BidMath: B,
  Dates: D,
  Keypad: K,
  Store: {
    load: () => DATA,
    loadProblem: () => null,
    save: () => { saved.count += 1; return true; },
    todayISO: () => '2026-09-05',
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js first: app.js is written in its helpers (el, shake, chip, numText).
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

const {
  registerScreen, show, goBack, onPopState, anyPanelOpen,
  promptNumber, promptMoney, promptText, confirmPanel, keypadPress, keypadDone, keypadClear,
  textDone, closeAnyPanel, attachedStrip, closeAnyStrip, keypadCaptionTapped,
} = sandbox;

// A function declaration lands on the context's global object; a top-level
// const does not, so the app's one state object is read out of the context's
// lexical scope rather than off the sandbox.
const state = vm.runInContext('state', sandbox);
const navDepth = () => vm.runInContext('navDepth', sandbox);

// Four screens standing in for the real ones: a walk inside a bid inside the
// list, and the other tab. Nothing renders; the assertions are about which
// screen is current and what got written.
registerScreen('bids', { id: 'screen-bids', title: 'Bids', back: null, tab: 'bids', render: () => {} });
registerScreen('bid', { id: 'screen-bid', title: 'Bid', back: 'bids', tab: 'bids', render: () => {} });
registerScreen('walk', { id: 'screen-walk', title: 'Walkthrough', back: 'bid', tab: 'bids', render: () => {} });
registerScreen('settings', { id: 'screen-settings', title: 'Settings', back: null, tab: 'settings', render: () => {} });

state.unlocked = true;

// Put him three levels in, the way the phone would, and hand back the counters
// so a test can assert that nothing moved.
function standInTheWalk() {
  show('bids', undefined, { replace: true });
  show('bid');
  show('walk');
  return { screen: state.screen, saves: saved.count, pushes: history.pushes };
}

// ---------------------------------------------------------------------------
// A back gesture with a panel open
// ---------------------------------------------------------------------------

test('the back gesture cancels an open keypad and navigates nothing', () => {
  const before = standInTheWalk();
  let committed = null;
  promptNumber(null, { label: 'How many ft?', done: (v) => { committed = v; } });
  assert.strictEqual(anyPanelOpen(), true);

  onPopState({ state: { ceb: 2 } });

  assert.strictEqual(anyPanelOpen(), false, 'the keypad is gone');
  assert.strictEqual(state.screen, before.screen, 'the screen underneath did not move');
  assert.strictEqual(committed, null, 'done() never fired: a cancel commits nothing');
  assert.strictEqual(saved.count, before.saves, 'nothing was written to the store');
  // The entry the swipe spent is put back, or the NEXT swipe leaves the app.
  assert.strictEqual(history.pushes, before.pushes + 1);
});

test('the keypad cancelled by a back gesture cannot commit afterwards', () => {
  standInTheWalk();
  let committed = null;
  promptNumber(null, { label: 'How many ft?', done: (v) => { committed = v; } });
  keypadPress('4'); keypadPress('0');   // 40 ft, typed and not yet finished
  onPopState({ state: { ceb: 2 } });
  // Whatever Done is wired to is dead: the buffer and the callback both went
  // with the panel, so a stray Done cannot post 40 ft into anything.
  keypadDone();
  assert.strictEqual(committed, null);
});

test('the back gesture cancels an open text prompt and navigates nothing', () => {
  const before = standInTheWalk();
  let committed = null;
  promptText('Mezzanine', { label: 'Area name', done: (v) => { committed = v; } });
  assert.strictEqual(anyPanelOpen(), true);

  onPopState({ state: { ceb: 2 } });

  assert.strictEqual(anyPanelOpen(), false);
  assert.strictEqual(state.screen, before.screen);
  assert.strictEqual(committed, null);
  assert.strictEqual(saved.count, before.saves);
  textDone();
  assert.strictEqual(committed, null);
});

test('the back gesture answers an open confirm with no, and navigates nothing', async () => {
  const before = standInTheWalk();
  const answer = confirmPanel('Delete Mezzanine?', { ok: 'Delete', danger: true });
  assert.strictEqual(anyPanelOpen(), true);

  onPopState({ state: { ceb: 2 } });

  assert.strictEqual(await answer, false, 'a back gesture is the answer "no"');
  assert.strictEqual(anyPanelOpen(), false);
  assert.strictEqual(state.screen, before.screen);
  assert.strictEqual(saved.count, before.saves);
});

test('with no panel open the back gesture still goes back one screen', () => {
  standInTheWalk();
  onPopState({ state: { ceb: 2 } });
  assert.strictEqual(state.screen, 'bid');
  onPopState({ state: { ceb: 1 } });
  assert.strictEqual(state.screen, 'bids');
});

// ---------------------------------------------------------------------------
// A banner belongs to the screen it was raised on
// ---------------------------------------------------------------------------
//
// The blocked-share banner names a line and, since Task D, TAPS to it. Left
// standing across a navigation it is about the bid he just left: on the next
// bid it names a line that bid does not have, and its tap carries the old
// bid's line with it and moves him to another bid's room without saying so.

test('leaving a screen clears the banner that was raised on it', () => {
  const bannerArea = () => document.getElementById('banner').children;
  standInTheWalk();
  let went = null;
  sandbox.showBanner('Put a price on "Permits" first.', 'danger', { onTap: () => { went = 'permits'; } });
  assert.strictEqual(bannerArea().length, 1);

  show('bid');

  assert.strictEqual(bannerArea().length, 0, 'the sentence ended with the screen');
  assert.strictEqual(went, null);
});

test('a banner survives a re-show of the SAME screen, and a persistent one survives everything', () => {
  standInTheWalk();
  const bannerArea = () => document.getElementById('banner').children;
  sandbox.showBanner('Added. Price it on the Costs & price screen.', 'ok');
  show('walk');                      // the walk re-entered for another area
  assert.strictEqual(bannerArea().length, 1, 'staying put is not leaving');

  sandbox.clearBanner();
  sandbox.showBanner('Storage was unreadable. Restore from a backup in Settings', 'danger', { persistent: true });
  show('bids');
  assert.strictEqual(bannerArea().length, 1, 'a condition that is still true stays on the glass');
  sandbox.clearBanner(true);
});

test('show() never leaves a panel floating over the screen it arrived at', () => {
  standInTheWalk();
  promptNumber(null, { label: 'How many ft?', done: () => {} });
  show('bid');
  assert.strictEqual(anyPanelOpen(), false);
  assert.strictEqual(state.screen, 'bid');
});

test('closeAnyPanel reports whether there was anything to close', () => {
  standInTheWalk();
  assert.strictEqual(closeAnyPanel(), false);
  promptText('', { label: 'Area name', done: () => {} });
  assert.strictEqual(closeAnyPanel(), true);
  assert.strictEqual(anyPanelOpen(), false);
});

// ---------------------------------------------------------------------------
// A tab tap from deep inside a bid
// ---------------------------------------------------------------------------
//
// The tab bar replaces rather than pushes, which is right between the two tabs
// and wrong from anywhere else: it spent the entry that led back to the walk,
// and the next back gesture took him out of the app instead of back to the
// room he was counting in.

test('a tab tapped from inside a bid pushes, and Back returns to the walk', () => {
  const before = standInTheWalk();
  show('settings', undefined, { tabFrom: state.screen });
  assert.strictEqual(state.screen, 'settings');
  assert.strictEqual(history.pushes, before.pushes + 1, 'leaving the walk for a tab pushes');

  onPopState({ state: { ceb: 3 } });
  assert.strictEqual(state.screen, 'walk', 'Back off the tab lands where he was standing');
});

test('tab to tab replaces, and Back off it does not jump to a stale screen', () => {
  standInTheWalk();
  show('settings', undefined, { tabFrom: state.screen });
  const pushes = history.pushes;
  // The second tab tap is tab to tab: two places to stand, not a way further in.
  show('bids', undefined, { replace: true });
  assert.strictEqual(history.pushes, pushes, 'tab to tab pushes nothing');
  assert.strictEqual(goBack(), false, 'the tab return was dropped by the second tap');
  assert.strictEqual(state.screen, 'bids');
});

// The entry is the counter's memory: onPopState reads navDepth back off
// whatever the browser hands it. A replace stands ON an entry, so it has to
// restamp it — otherwise the entry still carries the depth of the screen it
// replaced, and one popstate later the counter is a stranger's number.
test('a replace restamps the entry it is standing on', () => {
  standInTheWalk();
  // A back gesture onto an entry that is not ours (a stateless one) resets the
  // counter to 0 while the top entry still carries the depth it was pushed at.
  const stale = history.entries[history.entries.length - 1].ceb;
  assert.ok(stale > 0, 'the walk was pushed at a real depth');
  onPopState({});
  assert.strictEqual(navDepth(), 0);
  assert.strictEqual(history.entries[history.entries.length - 1].ceb, stale);

  show('bids', undefined, { replace: true });
  assert.strictEqual(history.entries[history.entries.length - 1].ceb, navDepth(),
    'the entry carries the depth we are actually at, not the one it was pushed with');
});

// ---------------------------------------------------------------------------
// A back gesture with an attached strip open
// ---------------------------------------------------------------------------
//
// The same rule the panels get, for the smaller question. A strip is the menu
// that opens under a row he tapped, and a swipe answering it by leaving the
// screen entirely is one step too many: he opens the ⋯ on a bid, swipes back to
// close it, and lands somewhere else with the menu simply gone.

test('the back gesture closes an open strip and navigates nothing', () => {
  const before = standInTheWalk();
  let closed = 0;
  attachedStrip(null, [{ label: 'Delete', onTap: () => {} }], { cancel: () => { closed += 1; } });

  onPopState({ state: { ceb: 2 } });

  assert.strictEqual(closed, 1, 'the strip was cancelled, exactly once');
  assert.strictEqual(state.screen, before.screen, 'the screen underneath did not move');
  assert.strictEqual(history.pushes, before.pushes + 1, 'the entry the swipe spent is put back');

  // And the NEXT swipe, with nothing left open, goes back for real.
  onPopState({ state: { ceb: 2 } });
  assert.strictEqual(state.screen, 'bid');
});

test('a panel open over a strip is the thing the gesture answers first', () => {
  standInTheWalk();
  let closed = 0;
  attachedStrip(null, [{ label: 'Rename', onTap: () => {} }], { cancel: () => { closed += 1; } });
  promptText('', { label: 'Area name', done: () => {} });

  onPopState({ state: { ceb: 2 } });
  assert.strictEqual(anyPanelOpen(), false, 'the panel went');
  assert.strictEqual(closed, 0, 'the strip is still open behind it');
  assert.strictEqual(state.screen, 'walk');

  onPopState({ state: { ceb: 2 } });
  assert.strictEqual(closed, 1, 'the second gesture closes the strip');
  assert.strictEqual(state.screen, 'walk');
});

test('a strip with no Cancel is not something the gesture can close', () => {
  standInTheWalk();
  // Not every strip has a way out of its own: some are a list of buttons and
  // nothing else. Tracking one would leave a back gesture spending itself on
  // nothing at all.
  attachedStrip(null, [{ label: 'Days', onTap: () => {} }], {});
  assert.strictEqual(closeAnyStrip(), false);
});

// ---------------------------------------------------------------------------
// DONE WITH NOTHING TYPED
// ---------------------------------------------------------------------------
// The panel half of the rule Keypad.submit decides. What matters here is what
// the OWNER sees: whether the panel closes, and what number reaches the caller.

test('Done with nothing typed keeps the value the panel opened with', () => {
  standInTheWalk();
  const seen = [];
  promptNumber(32, { label: 'Hours per day', done: (v) => seen.push(v) });
  keypadDone();
  assert.strictEqual(anyPanelOpen(), false, 'the panel closes: he answered the question');
  assert.deepStrictEqual(seen, [32], 'the caller sees the value it already had');
});

test('Done with nothing typed on a NEW line shakes and stays up', () => {
  standInTheWalk();
  const seen = [];
  promptNumber(null, { label: 'How many ft?', done: (v) => seen.push(v) });
  keypadDone();
  assert.strictEqual(anyPanelOpen(), true, 'nothing to keep, so the question is still on screen');
  assert.deepStrictEqual(seen, [], 'and nothing reached the caller');
  closeAnyPanel();
});

test('money keeps its prior to the cent, with no float dust on the way back', () => {
  standInTheWalk();
  const seen = [];
  // $32.00 and a price with an odd number of cents on it: the panel speaks
  // dollars, so a kept value goes out to dollars and back to cents, and a
  // rounding slip there would write a different number than the one on screen.
  promptMoney(3200, { label: 'Wage', done: (c) => seen.push(c) });
  keypadDone();
  promptMoney(1234567, { label: 'Bid price', done: (c) => seen.push(c) });
  keypadDone();
  assert.deepStrictEqual(seen, [3200, 1234567]);
});

test('typing over the prior still wins, and a typed zero is not the prior', () => {
  standInTheWalk();
  const seen = [];
  promptMoney(3200, { label: 'Wage', done: (c) => seen.push(c) });
  keypadPress('4'); keypadPress('0');
  keypadDone();
  promptMoney(3200, { label: 'Wage', done: (c) => seen.push(c) });
  keypadPress('0');
  keypadDone();
  assert.deepStrictEqual(seen, [4000, 0]);
});

test('Clear still means leave it, on a panel that has a prior', () => {
  standInTheWalk();
  const seen = [];
  promptNumber(32, { label: 'Hours per day', done: (v) => seen.push(v) });
  keypadClear();
  assert.strictEqual(anyPanelOpen(), false);
  assert.deepStrictEqual(seen, [null], 'Clear is its own answer and is not the prior');
});

test('a keypad cancelled by the back gesture keeps nothing either', () => {
  standInTheWalk();
  const seen = [];
  promptNumber(32, { label: 'Hours per day', done: (v) => seen.push(v) });
  onPopState({ state: { ceb: 2 } });
  keypadDone();
  assert.deepStrictEqual(seen, [], 'a cancel commits nothing, prior or not');
});

// ---------------------------------------------------------------------------
// The caption link under a keypad
// ---------------------------------------------------------------------------
// Two kinds. "Check price" leaves the panel standing (the number he was half
// way through typing is still there when he comes back from the browser).
// "Price the whole line instead" is closes: true: this keypad goes down,
// buffer and all, and the link opens the next one. Done afterwards belongs to
// the second keypad and never to the first.
const keypadCtx = () => vm.runInContext('keypadCtx', sandbox);
const keypadLabel = () => sandbox.document.getElementById('keypadLabel').textContent;

// Order matters here: the closes: true test runs first so the plain-link
// test below it also proves that closing a keypad resets captionCloses —
// if closeKeypad ever left that flag set, the plain link would close too.
test('a closes: true caption link hands off: one keypad up, the second label, the second done', () => {
  standInTheWalk();
  let first = null, second = null;
  promptMoney(null, { label: 'Wire, bills at per foot', caption: 'Before the markup.',
    captionAction: { label: 'Price the whole line instead', closes: true,
      onTap: () => promptMoney(null, { label: 'Wire, all 500 feet together', done: (c) => { second = c; } }) },
    done: (c) => { first = c; } });
  keypadPress('4');                       // half-typed, abandoned by "instead"
  keypadCaptionTapped();
  assert.strictEqual(anyPanelOpen(), true, 'exactly one keypad is up');
  assert.strictEqual(keypadLabel(), 'Wire, all 500 feet together', 'and it is the second one');
  assert.strictEqual(keypadCtx().buffer.text(), '', 'the abandoned 4 did not carry over');
  assert.strictEqual(keypadCtx().captionAction, null, 'the second keypad has no link of its own');
  keypadPress('2'); keypadPress('1'); keypadPress('6');
  keypadDone();
  assert.strictEqual(second, 21600, 'Done went to the lot keypad');
  assert.strictEqual(first, null, 'and never to the one that closed');
  assert.strictEqual(anyPanelOpen(), false);
});

test('a plain caption link leaves the keypad standing with what he typed', () => {
  standInTheWalk();
  let opened = 0;
  promptMoney(null, { label: 'Cost per foot', caption: 'Not sure?',
    captionAction: { label: 'Check price', onTap: () => { opened += 1; } }, done: () => {} });
  keypadPress('4');
  keypadCaptionTapped();
  assert.strictEqual(opened, 1, 'the link ran');
  assert.strictEqual(anyPanelOpen(), true, 'the keypad is still up');
  assert.strictEqual(keypadCtx().buffer.text(), '4', 'and so is the 4 he typed');
  keypadClear();
});
