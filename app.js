'use strict';

// app.js — the app SHELL and nothing else: state, the screen registry,
// navigation, banners, the three overlay panels, the PIN screen, and boot.
// Screens live one-per-file in screens/*.js and register themselves; shared
// DOM helpers live in ui.js. Depends on globals BidMath, Store, DocModel,
// Keypad, Photos, DocGen and the ui.js helpers, all loaded before this file.
//
// Sections, in order:
//   STATE     — the single app state object and the screen registry
//   BANNERS   — showBanner / clearBanner
//   PANELS    — promptNumber, promptMoney, promptText, confirmPanel
//   PIN       — set / confirm / unlock
//   NAV       — show(), render(), persist()
//   BOOT      — DOMContentLoaded wiring
//
// Adding a screen (Tasks 6-14): create screens/<key>.js with its renderer,
// call registerScreen() at the bottom of that file, add the <script> tag last
// in index.html, and navigate with show('<key>') so the destination always
// re-renders.

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

// Store.load() never throws: on unreadable data it stashes the raw text under
// a side key, returns a fresh document, and reports 'corrupt' through
// Store.loadProblem() — which boot() turns into a persistent red banner.
const state = { data: Store.load(), screen: 'pin', bidId: null, unlocked: false };

// Single source of truth per screen: its section element, top-bar title, where
// Back goes (null = no back button), which bottom tab lights up, and the
// render function show() calls after switching to it. The shell only knows
// about the PIN screen; every other screen adds itself from its own file.
const SCREENS = {
  pin: { id: 'screen-pin', title: '', back: null, tab: null, render: null },
};

// Called at the bottom of each screens/*.js. Keeping registration next to the
// renderer means a screen is one file to read and one file to delete, and the
// shell never has to be edited to add one.
function registerScreen(key, cfg) {
  SCREENS[key] = cfg;
}

// ---------------------------------------------------------------------------
// BANNERS
// ---------------------------------------------------------------------------

const BANNER_TIMEOUT_MS = 6000;
const BANNER_MAX = 3;

// kind: 'warn' (default) | 'danger' | 'ok'.
// opts.persistent: stays until clearBanner(true) — no dismiss X, no timeout.
// Used for conditions that are still true (storage unreadable), not events.
// Re-showing identical text replaces the existing banner rather than stacking.
function showBanner(text, kind, opts) {
  opts = opts || {};
  const area = el('banner');
  if (!area) return null;

  Array.prototype.slice.call(area.children).forEach((b) => {
    if (b.dataset.text === text) b.remove();
  });

  const banner = document.createElement('div');
  banner.className = 'banner' + (kind === 'danger' ? ' banner-danger' : kind === 'ok' ? ' banner-ok' : '');
  banner.dataset.text = text;
  if (opts.persistent) banner.dataset.persistent = '1';

  const span = document.createElement('span');
  span.className = 'banner-text';
  span.textContent = text;
  banner.appendChild(span);

  if (!opts.persistent) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'banner-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => banner.remove());
    banner.appendChild(dismiss);
    setTimeout(() => banner.remove(), BANNER_TIMEOUT_MS);
  }

  area.appendChild(banner);

  // Never let banners eat the screen: past three, the oldest drops off.
  while (area.children.length > BANNER_MAX) area.removeChild(area.firstElementChild);

  // A danger banner reports something that did NOT happen (a save refused, a
  // storage read that failed). The area is sticky under the top bar, but on a
  // screen scrolled deep down the sticky element can still be below the fold
  // mid-scroll, so scroll the page up to put it under the owner's eyes.
  if (kind === 'danger') window.scrollTo(0, 0);

  return banner;
}

// Clears transient banners. A persistent banner describes a condition that is
// still true, so it survives unless includePersistent is passed.
function clearBanner(includePersistent) {
  const area = el('banner');
  if (!area) return;
  Array.prototype.slice.call(area.children).forEach((b) => {
    if (includePersistent || b.dataset.persistent !== '1') b.remove();
  });
}

// ---------------------------------------------------------------------------
// PANELS
// ---------------------------------------------------------------------------
// Three full-screen sheets, all driven from static markup in index.html and
// wired once in boot(). Only one may be open at a time: a second request while
// a panel is up is dropped, which is what a fast double-tap on iOS produces.

const keypadCtx = { open: false, buffer: null, done: null };
const textCtx = { open: false, done: null };
const confirmCtx = { open: false, resolve: null };

function anyPanelOpen() { return keypadCtx.open || textCtx.open || confirmCtx.open; }

// --- Number keypad ---------------------------------------------------------

// promptNumber(current, { label, allowDecimal, wasText, done })
// current: the existing value (Number) or null — shown as "was 12" but never
// preloaded into the buffer: retyping beats editing on a phone. wasText
// overrides that line for callers that format their own (see promptMoney).
// done(value) fires with a Number on Done and with null on Clear. Cancel calls
// nothing. There is no native number input anywhere in this app.
function promptNumber(current, opts) {
  opts = opts || {};
  if (anyPanelOpen()) return;

  const allowDecimal = !!opts.allowDecimal;
  keypadCtx.open = true;
  keypadCtx.buffer = Keypad.createBuffer({ allowDecimal });
  keypadCtx.done = typeof opts.done === 'function' ? opts.done : null;

  el('keypadLabel').textContent = opts.label || '';
  el('keypadWas').textContent = opts.wasText || ((typeof current === 'number' && isFinite(current))
    ? 'was ' + numText(current)
    : 'was not set');

  // The decimal key only exists for callers that allow one; otherwise it stays
  // blanked so 0 and backspace never shift under the thumb.
  const dot = el('keypadDot');
  dot.classList.toggle('key-blank', !allowDecimal);
  dot.disabled = !allowDecimal;
  dot.tabIndex = allowDecimal ? 0 : -1;
  dot.setAttribute('aria-hidden', allowDecimal ? 'false' : 'true');

  renderKeypad();
  el('panel-keypad').hidden = false;
}

// What the thumb produces (leading zeros, the single decimal point, the digit
// cap, what counts as "nothing typed") is Keypad's business and is unit-tested
// there; the panel only draws the buffer and reads its value.
function renderKeypad() {
  el('keypadDigits').textContent = keypadCtx.buffer ? keypadCtx.buffer.text() : '';
}

function keypadPress(ch) {
  if (!keypadCtx.open) return;
  keypadCtx.buffer.press(ch);
  renderKeypad();
}

function keypadBackspace() {
  if (!keypadCtx.open) return;
  keypadCtx.buffer.backspace();
  renderKeypad();
}

function keypadValue() {
  return keypadCtx.buffer ? keypadCtx.buffer.value() : null;
}

function closeKeypad() {
  el('panel-keypad').hidden = true;
  keypadCtx.open = false;
  keypadCtx.buffer = null;
  keypadCtx.done = null;
}

function keypadDone() {
  const v = keypadValue();
  if (v === null) { shake(el('keypadDigits')); return; }
  const done = keypadCtx.done;
  closeKeypad();
  if (done) done(v);
}

function keypadClear() {
  const done = keypadCtx.done;
  closeKeypad();
  if (done) done(null);
}

// promptMoney(cents, { label, done }) — the ONE money entry point. Every later
// screen that takes dollars goes through this, so the cents<->dollars
// conversion and its rounding live in exactly one place: the keypad speaks
// dollars, the data model only ever sees integer cents.
// done(cents) fires with an integer, or null on Clear.
function promptMoney(cents, opts) {
  opts = opts || {};
  const done = typeof opts.done === 'function' ? opts.done : null;
  const has = typeof cents === 'number' && isFinite(cents);
  promptNumber(has ? cents / 100 : null, {
    label: opts.label,
    allowDecimal: true,
    wasText: has ? 'was ' + BidMath.fmt(cents) : 'was not set',
    done: (v) => { if (done) done(v === null ? null : Math.round(v * 100)); },
  });
}

// --- Text prompt -----------------------------------------------------------

// promptText(current, { label, placeholder, done })
// A real <input type="text"> — words are not scroll wheels. done(string) fires
// on Done (or Enter) with the trimmed value; Cancel calls nothing.
function promptText(current, opts) {
  opts = opts || {};
  if (anyPanelOpen()) return;

  textCtx.open = true;
  textCtx.done = typeof opts.done === 'function' ? opts.done : null;

  el('textLabel').textContent = opts.label || '';
  const input = el('textInput');
  input.value = current == null ? '' : String(current);
  input.placeholder = opts.placeholder || '';
  el('panel-text').hidden = false;

  // Focus twice: immediately (keeps the iOS keyboard inside the tap gesture)
  // and once more on the next tick, for browsers that ignore focus on an
  // element revealed in the same frame.
  input.focus();
  input.select();
  setTimeout(() => { if (textCtx.open) { input.focus(); input.select(); } }, 50);
}

function closeText() {
  el('panel-text').hidden = true;
  el('textInput').blur();
  textCtx.open = false;
  textCtx.done = null;
}

function textDone() {
  const value = el('textInput').value.trim();
  const done = textCtx.done;
  closeText();
  if (done) done(value);
}

// --- Confirm ---------------------------------------------------------------

// confirmPanel(message, { ok, cancel, danger }) -> Promise<boolean>.
// Resolves false if another panel is already open, so a caller can never hang.
function confirmPanel(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    if (anyPanelOpen()) { resolve(false); return; }
    confirmCtx.open = true;
    confirmCtx.resolve = resolve;

    el('confirmMessage').textContent = message;
    const ok = el('confirmOk');
    ok.textContent = opts.ok || 'OK';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    el('confirmCancel').textContent = opts.cancel || 'Cancel';
    el('panel-confirm').hidden = false;
  });
}

function closeConfirm(answer) {
  el('panel-confirm').hidden = true;
  confirmCtx.open = false;
  const resolve = confirmCtx.resolve;
  confirmCtx.resolve = null;
  if (resolve) resolve(answer);
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------
// Identical behavior to CE Timesheets. There is no recovery path by design:
// no server, no reset code. After three wrong tries the screen says where the
// only real way back is (a backup import), and the owner keeps trying.

// 'choose' (first run, picking a PIN) | 'confirm' (re-entering it) | 'enter'.
let pinMode = 'enter';
let pinBuffer = [];
let firstPinDigits = null;
let pinBusy = false;   // true while a mismatch message is on screen
let pinWrongTries = 0;

const PIN_HINT_AFTER = 3;
const PIN_HINT_TEXT = 'Forgot it? Import a backup from Settings to reset.';

function updateDots() {
  const dots = el('pinDots').querySelectorAll('.dot');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < pinBuffer.length));
}

function setPinMessage(text) { el('pinMessage').textContent = text; }

function resetPinEntry(mode) {
  el('pinDots').classList.remove('shake'); // dots return to their normal color on the next entry
  pinBuffer = [];
  updateDots();
  pinMode = mode;
  if (mode === 'choose') setPinMessage('Choose a 4-digit PIN');
  else if (mode === 'confirm') setPinMessage('Confirm PIN');
  else setPinMessage('Enter PIN');
}

function initPinScreen() {
  firstPinDigits = null;
  pinBusy = false;
  pinWrongTries = 0;
  const hint = el('pinHint');
  hint.textContent = '';
  hint.hidden = true;
  resetPinEntry(state.data.pin === null ? 'choose' : 'enter');
}

function unlock() {
  state.unlocked = true;
  show('bids');
}

function handlePinComplete() {
  const entered = pinBuffer.join('');

  if (pinMode === 'choose') {
    firstPinDigits = entered;
    resetPinEntry('confirm');
    return;
  }

  if (pinMode === 'confirm') {
    if (entered === firstPinDigits) {
      state.data.pin = entered;
      persist();
      unlock();
    } else {
      pinBusy = true;
      pinBuffer = [];
      updateDots();
      shake(el('pinDots'));
      setPinMessage("PINs didn't match — start over");
      setTimeout(() => {
        firstPinDigits = null;
        pinBusy = false;
        resetPinEntry('choose');
      }, 1400);
    }
    return;
  }

  // pinMode === 'enter'
  if (entered === state.data.pin) {
    unlock();
    return;
  }

  pinWrongTries += 1;
  pinBusy = true;
  pinBuffer = [];
  updateDots();
  shake(el('pinDots'));
  setPinMessage('Wrong PIN — try again');
  if (pinWrongTries >= PIN_HINT_AFTER) {
    const hint = el('pinHint');
    hint.textContent = PIN_HINT_TEXT;
    hint.hidden = false;
  }
  setTimeout(() => {
    pinBusy = false;
    resetPinEntry('enter'); // also drops the shake class, independent of animationend
  }, 1200);
}

function handleDigit(digit) {
  if (pinBusy || pinBuffer.length >= 4) return;
  pinBuffer.push(digit);
  updateDots();
  if (pinBuffer.length === 4) handlePinComplete();
}

function handleBackspace() {
  if (pinBusy) return;
  pinBuffer.pop();
  updateDots();
}

// ---------------------------------------------------------------------------
// NAV
// ---------------------------------------------------------------------------

// The single navigation entry point: switches sections, updates the top bar
// and tab bar, then renders the destination. Accepts either a screen key
// ('bids') or its section id ('screen-bids').
function show(screenId) {
  const key = SCREENS[screenId] ? screenId : String(screenId).replace(/^screen-/, '');
  const cfg = SCREENS[key];
  if (!cfg) return;

  state.screen = key;
  Object.keys(SCREENS).forEach((k) => {
    const section = el(SCREENS[k].id);
    if (section) section.hidden = k !== key;
  });

  // Screens toggle via [hidden] rather than a real navigation, so the scroll
  // position of the previous screen would otherwise carry over.
  window.scrollTo(0, 0);

  const onPin = key === 'pin';
  el('topbar').hidden = onPin;
  el('tabbar').hidden = onPin;
  if (!onPin) {
    el('topbarTitle').textContent = cfg.title || '';
    el('backBtn').hidden = !cfg.back;
    document.querySelectorAll('#tabbar .tab').forEach((btn) => {
      btn.classList.toggle('tab-active', btn.dataset.tab === cfg.tab);
    });
  }

  render();
}

// Renders whatever screen is current. Call directly to refresh in place.
function render() {
  const cfg = SCREENS[state.screen];
  if (cfg && cfg.render) cfg.render();
}

// Every write to state.data goes through here. Store.save validates before
// writing and returns false rather than minting a document that the next
// load() couldn't read — in that case nothing changed on disk, and the owner
// has to be told so he doesn't walk away trusting a number that isn't saved.
// Invariant: never call persist() while a panel is open — panels cover the
// banner area, so the failure notice would be invisible. Close the panel in
// the done() callback first, then persist.
function persist() {
  if (!Store.save(state.data)) {
    showBanner("Couldn't save — nothing changed", 'danger');
    return false;
  }
  return true;
}

function goBack() {
  const cfg = SCREENS[state.screen];
  if (cfg && cfg.back) show(cfg.back);
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------

function wirePinKeypad() {
  // Scoped to the PIN screen's own keypad by id — the number panel has its
  // own grid and the two must never be confused.
  el('pinKeypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.id === 'backspaceBtn') handleBackspace();
    else if (btn.dataset.digit !== undefined) handleDigit(btn.dataset.digit);
  });
}

function wirePanels() {
  el('keypadGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.id === 'keypadBack') keypadBackspace();
    else if (btn.dataset.dot !== undefined) keypadPress('.');
    else if (btn.dataset.digit !== undefined) keypadPress(btn.dataset.digit);
  });
  el('keypadDone').addEventListener('click', keypadDone);
  el('keypadClear').addEventListener('click', keypadClear);
  el('keypadCancel').addEventListener('click', closeKeypad);

  el('textDone').addEventListener('click', textDone);
  el('textCancel').addEventListener('click', closeText);
  el('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); textDone(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeText(); }
  });

  el('confirmOk').addEventListener('click', () => closeConfirm(true));
  el('confirmCancel').addEventListener('click', () => closeConfirm(false));
}

function wireNav() {
  el('backBtn').addEventListener('click', goBack);
  el('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn || !state.unlocked) return;
    show(btn.dataset.tab);
  });
}

function boot() {
  if (Store.loadProblem() === 'corrupt') {
    showBanner('Storage was unreadable — restore from a backup in Settings', 'danger', { persistent: true });
  }
  wirePinKeypad();
  wirePanels();
  wireNav();
  initPinScreen();
  show('pin');
}

document.addEventListener('DOMContentLoaded', boot);

// TODO Task 16: register the service worker here once sw.js exists, following
// the CE Timesheets pattern (register on load, reg.update() on visibilitychange,
// one reload on controllerchange). Registering before the file exists would
// only log a failed registration on every launch.
