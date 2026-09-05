'use strict';

// app.js — the app SHELL and nothing else: state, the screen registry,
// navigation, banners, the three overlay panels, the PIN screen, and boot.
// Screens live one-per-file in screens/*.js and register themselves; shared
// DOM helpers live in ui.js. Depends on globals BidMath, Store, DocModel,
// Keypad, Dates, Catalog, Photos, DocGen and the ui.js helpers, all loaded
// before this file.
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
// re-renders. A screen that has to be opened *for* something ("open the bid
// screen for this bid") registers an enter hook and is reached with
// show('<key>', arg) — so no screen ever has to call into another screen's
// file to set that up.

// The build the phone is actually running, shown at the bottom of Settings.
// Must match CACHE in sw.js; both bump on every deploy that changes a cached
// file. tests/sw.test.js fails if the two ever drift.
const APP_VERSION = 'bids-v1';

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
//
//   enter(arg): optional; resets the screen's private view state and receives
//   the navigation argument (usually a bid id). Called by show() after the
//   section toggle and before render(). Screens are reached with
//   show(key, arg); a plain show(key) — what the Back button and the tab bar
//   do — passes undefined, which a screen should read as "coming back, keep
//   what's on the glass".
//
//   backStep(peek): optional; a screen with views of its own (the walk) uses
//   it to take ONE step inside itself instead of leaving. Return true if a
//   step was taken (and re-render), false if there is nothing left inside and
//   Back should go to cfg.back. Called with peek === true it must answer the
//   same question WITHOUT moving: that is the shell asking what to write on
//   the Back button.
//
//   leave(): optional; called on the screen being left, before the switch. For
//   the resources a renderer hands out and a re-render would normally take
//   back — object URLs, timers — because the last render before a navigation
//   never gets a next render to clean up after it.
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

  // Never let banners eat the screen: past three, the oldest drops off — but
  // only ever a transient one. A persistent banner describes a condition that
  // is still true (storage unreadable), and three routine notices in a row
  // must not be able to push that warning off the screen. If everything
  // showing is persistent, they all stay.
  while (area.children.length > BANNER_MAX) {
    const victim = Array.prototype.find.call(area.children, (b) => b.dataset.persistent !== '1');
    if (!victim) break;
    victim.remove();
  }

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
// field: whichever of the two text controls this prompt is using — the
// single-line input or the multi-line textarea. Everything after promptText
// reads the field through the context rather than by id, so Done, the chips
// and the close path work the same either way.
const textCtx = { open: false, done: null, suggest: null, field: null, multiline: false };
const confirmCtx = { open: false, resolve: null };

function anyPanelOpen() { return keypadCtx.open || textCtx.open || confirmCtx.open; }

// Cancel whatever panel is up, exactly as its own Cancel button would: the
// done callback never runs, so nothing is written. Returns true if there was
// one. This is what a navigation goes through, because a panel is drawn OVER
// the screen it was opened from: leave that screen with the keypad still up
// and the next Done commits into the bid he is no longer looking at.
function closeAnyPanel() {
  if (keypadCtx.open) { closeKeypad(); return true; }
  if (textCtx.open) { closeText(); return true; }
  if (confirmCtx.open) { closeConfirm(false); return true; }
  return false;
}

// --- Number keypad ---------------------------------------------------------

// promptNumber(current, { label, caption, allowDecimal, maxChars, maxDecimals, wasText, done })
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
  keypadCtx.buffer = Keypad.createBuffer({ allowDecimal, maxChars: opts.maxChars, maxDecimals: opts.maxDecimals });
  keypadCtx.done = typeof opts.done === 'function' ? opts.done : null;

  el('keypadLabel').textContent = opts.label || '';
  el('keypadWas').textContent = opts.wasText || ((typeof current === 'number' && isFinite(current))
    ? 'was ' + numText(current)
    : 'was not set');

  // An optional sentence under the question, for the few keypads where the
  // question alone leaves the answer ambiguous. Hidden, not blank, so a
  // caption-less panel keeps its old spacing exactly.
  const cap = el('keypadCaption');
  cap.textContent = opts.caption || '';
  cap.hidden = !opts.caption;

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

// promptMoney(cents, { label, caption, done }) — the ONE money entry point. Every later
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
    caption: opts.caption,
    allowDecimal: true,
    maxDecimals: 2, // cents are the smallest thing money has
    wasText: has ? 'was ' + BidMath.fmt(cents) : 'was not set',
    done: (v) => { if (done) done(v === null ? null : Math.round(v * 100)); },
  });
}

// --- Text prompt -----------------------------------------------------------

// promptText(current, { label, placeholder, suggestions | suggest, multiline, done })
// A real <input type="text"> — words are not scroll wheels. done(string) fires
// on Done (or Enter) with the trimmed value; Cancel calls nothing.
//
// Chips above the input, either way of naming them:
//   suggestions: a fixed array of strings
//   suggest(query): a function re-run on every keystroke, so the chips narrow
//                   as he types — with sixty customers a fixed list is a wall,
//                   and typing the same name a second time, slightly
//                   differently, is how one customer becomes two.
//
// multiline: true swaps the input for a <textarea> and stops Enter from
// submitting, because in a scope of work Enter is a new line. Everything else
// about the panel is unchanged: same title, same chips, same Done and Cancel.
// The value still comes back trimmed — of the whole string, not per line; the
// caller splits it if it wants lines.
const TEXT_SUGGESTION_MAX = 8;

function promptText(current, opts) {
  opts = opts || {};
  if (anyPanelOpen()) return;

  textCtx.open = true;
  textCtx.done = typeof opts.done === 'function' ? opts.done : null;
  textCtx.suggest = typeof opts.suggest === 'function'
    ? opts.suggest
    : (Array.isArray(opts.suggestions) ? () => opts.suggestions : null);
  textCtx.multiline = !!opts.multiline;

  el('textLabel').textContent = opts.label || '';
  const input = el('textInput');
  const area = el('textArea');
  input.hidden = textCtx.multiline;
  area.hidden = !textCtx.multiline;
  const field = textCtx.multiline ? area : input;
  textCtx.field = field;
  field.value = current == null ? '' : String(current);
  field.placeholder = opts.placeholder || '';
  renderTextChips();

  el('panel-text').hidden = false;

  // Focus twice: immediately (keeps the iOS keyboard inside the tap gesture)
  // and once more on the next tick, for browsers that ignore focus on an
  // element revealed in the same frame.
  //
  // A paragraph is EDITED, not retyped: selecting the whole scope would mean
  // the first key he presses wipes the draft the walk wrote for him. So the
  // multi-line field puts the caret at the end instead of selecting.
  const place = () => {
    field.focus();
    if (textCtx.multiline) field.setSelectionRange(field.value.length, field.value.length);
    else field.select();
  };
  place();
  setTimeout(() => { if (textCtx.open) place(); }, 50);
}

// Redrawn from scratch on every keystroke: eight chips is a cheap rebuild,
// and diffing them would be more code than it saves.
function renderTextChips() {
  const chips = el('textChips');
  chips.textContent = '';
  if (!textCtx.suggest) { chips.hidden = true; return; }

  const input = textCtx.field || el('textInput');
  let list = [];
  try {
    list = textCtx.suggest(input.value) || [];
  } catch {
    list = []; // a broken suggester costs him chips, never the text field
  }
  list = list.filter((s) => typeof s === 'string' && s.trim() !== '').slice(0, TEXT_SUGGESTION_MAX);

  list.forEach((s) => {
    chips.appendChild(chip(s, false, () => {
      input.value = s;
      input.focus();
      renderTextChips(); // the picked name now narrows the list to itself
    }));
  });
  chips.hidden = list.length === 0;
}

function closeText() {
  el('panel-text').hidden = true;
  el('textInput').blur();
  el('textArea').blur();
  // Back to the single-line default, so the next prompt is never handed the
  // shape the last one asked for.
  el('textInput').hidden = false;
  el('textArea').hidden = true;
  el('textChips').textContent = '';
  el('textChips').hidden = true;
  textCtx.open = false;
  textCtx.done = null;
  textCtx.suggest = null;
  textCtx.field = null;
  textCtx.multiline = false;
}

function textDone() {
  const field = textCtx.field || el('textInput');
  const value = field.value.trim();
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

// Settings changes the PIN through THIS screen rather than a fourth panel:
// one keypad, one set of dots, one definition of what a PIN is, and leading
// zeros survive (the number keypad would turn 0412 into 412). pinChanging is
// what tells handlePinComplete to go back to Settings instead of unlocking,
// and it puts a Cancel under the keys — a man who opened the wrong row must
// not be shut out of an app he is already inside.
let pinChanging = false;

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
  // Replaces rather than pushes: the home screen is where the app starts, and
  // a back gesture from it must not be able to reach the lock screen.
  show('bids', undefined, { replace: true });
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
      // Changing a PIN is a write to a document that is already on disk, so it
      // gets the same treatment every other mutation gets: put the old one
      // back if the save is refused, and never navigate away from a change
      // that isn't saved. The first run is left alone — there is nothing on
      // disk to put back, and refusing to let him in would strand him.
      if (pinChanging) {
        const prev = state.data.pin;
        state.data.pin = entered;
        if (!persistOr(() => { state.data.pin = prev; })) {
          firstPinDigits = null;
          resetPinEntry('choose');
          return;
        }
        endPinChange();
        showBanner('PIN changed', 'ok');
        return;
      }
      state.data.pin = entered;
      persist();
      unlock();
    } else {
      pinBusy = true;
      pinBuffer = [];
      updateDots();
      shake(el('pinDots'));
      setPinMessage("PINs didn't match — start over");
      // On the first run the message line IS the screen; mid-change the banner
      // says it too, because the screen he came from is the one he is thinking
      // about and the message under the dots is easy to walk past.
      if (pinChanging) showBanner("PINs didn't match — start over");
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

// Opened from Settings. Everything the first run resets, reset again — a
// previous unlock's wrong-try count has nothing to do with picking a new PIN.
function startPinChange() {
  pinChanging = true;
  firstPinDigits = null;
  pinBusy = false;
  pinWrongTries = 0;
  const hint = el('pinHint');
  hint.textContent = '';
  hint.hidden = true;
  el('pinCancel').hidden = false;
  show('pin');
  resetPinEntry('choose');
}

// Back to Settings, and the screen is left the way the lock screen expects to
// find it: no Cancel, no half-typed first entry.
function endPinChange() {
  pinChanging = false;
  firstPinDigits = null;
  el('pinCancel').hidden = true;
  pinBuffer = [];
  updateDots();
  show('settings');
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

// --- History ---------------------------------------------------------------
//
// One edge swipe used to leave the app: a blank page, the PIN screen, and the
// four taps back to where he was. The app pushes nothing on its own, so the
// phone's back gesture had only the page it was launched from to go to.
//
// So every step DEEPER pushes an entry — every show() that is not the PIN
// screen and not a tab, plus the walk's own views through navPush() — and
// popstate spends one by running the app's own Back for whatever screen is up.
// Back and the swipe are then the same action, which is the point: two
// different backs on one phone is how he ends up somewhere he did not ask for.
//
// Three rules keep the two sides in step:
//   - the entry carries its own depth, so the counter re-reads itself off
//     whatever the browser hands back rather than trusting a running total;
//   - nothing pushes while a popstate is being handled (goBack() calls show(),
//     and a push in there would make the stack grow as he walks out of it);
//   - a screen with nothing behind it re-anchors instead of letting the swipe
//     through, because leaving the app is never the answer to a back gesture.
let navDepth = 0;
let navSuppress = false;

// Where a tab tap came FROM, when it came from somewhere that is not a tab.
// Neither tab has a Back of its own — they are the top — so a tap on Settings
// from four levels into a walk used to be a one-way door: the back gesture had
// nothing to go to and he was left rebuilding his way back into the room he
// was standing in. Set by the tab bar, spent by the first Back, dropped by any
// other navigation.
let navTabFrom = null;

function navPush() {
  if (navSuppress) return;
  navDepth += 1;
  try { history.pushState({ ceb: navDepth }, ''); } catch (e) { /* no history here */ }
}

function navReplace() {
  try { history.replaceState({ ceb: navDepth }, ''); } catch (e) { /* no history here */ }
}

// The single navigation entry point: switches sections, updates the top bar
// and tab bar, then renders the destination. Accepts either a screen key
// ('bids') or its section id ('screen-bids').
//
// opts.replace: no history entry. The tab bar uses it — the two tabs are two
// ways of standing at the top, not a way in and a way further in — and so does
// every navigation that is itself a Back.
function show(screenId, arg, opts) {
  const key = SCREENS[screenId] ? screenId : String(screenId).replace(/^screen-/, '');
  const cfg = SCREENS[key];
  if (!cfg) return;

  // Defensive, and the one rule this screen has no way to enforce from inside
  // a panel: nothing navigates out from under an open sheet. onPopState turns
  // the back gesture into a cancel before it ever gets here; this catches any
  // other caller that navigates while a panel is up.
  closeAnyPanel();

  // A tab return survives exactly one navigation — the tab tap that set it.
  // Anything else drops it, so Back off a tab can never jump to a screen he
  // left three moves ago.
  navTabFrom = (opts && opts.tabFrom) || null;

  // The PIN screen is never a history entry: a swipe must not be able to land
  // on it, and coming back from it must not re-ask for the PIN.
  if (key !== 'pin' && !(opts && opts.replace)) navPush();
  // A replace stands ON the entry it found, so that entry has to be restamped
  // with the depth we are actually at. Left alone it still carries the depth
  // of the screen it replaced, and the next popstate reads that stale number
  // back into navDepth.
  else if (key !== 'pin') navReplace();

  // The screen being left gets to put its resources back first. Nothing that
  // happens in here may navigate, so a throwing leave() is contained rather
  // than being allowed to strand the app between two screens.
  const leaving = SCREENS[state.screen];
  if (leaving && leaving.leave && key !== state.screen) {
    try { leaving.leave(); } catch (err) { console.error('leave() failed for ' + state.screen, err); }
  }

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

  // The destination's own file decides what a navigation argument means and
  // what stale view state to clear — before render(), so the renderer only
  // ever sees settled state. It runs before the top bar is drawn too: a screen
  // opened FOR something (the walk on a change order) titles itself off that
  // argument, and Back leads somewhere different because of it.
  if (cfg.enter) cfg.enter(arg);

  if (!onPin) {
    document.querySelectorAll('#tabbar .tab').forEach((btn) => {
      btn.classList.toggle('tab-active', btn.dataset.tab === cfg.tab);
    });
  }

  render();
}

// The title and the Back button, redrawn with the screen rather than only on
// arrival: a screen with views of its own (the walk) changes what Back means
// without a navigation, and a button that still says "‹ Bid" while Back goes
// one step up the list is a button that lies.
function renderTopBar() {
  const cfg = SCREENS[state.screen];
  if (!cfg || state.screen === 'pin') return;
  el('topbarTitle').textContent = screenTitle(cfg);
  const back = el('backBtn');
  back.hidden = !screenBack(cfg);
  back.textContent = '‹ ' + screenBackLabel(cfg);
}

// Renders whatever screen is current. Call directly to refresh in place.
function render() {
  const cfg = SCREENS[state.screen];
  renderTopBar();
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

// persistOr(revert) — save, or put it back. A refused save leaves state.data
// holding a change that is not on disk: the screen shows a number the next
// launch won't have. Every mutation site hands in the undo for its own change,
// so the document and the disk never disagree. persist() has already put the
// reason on screen, so a caller only has to re-render and stay put.
function persistOr(revert) {
  if (!persist()) { revert(); return false; }
  return true;
}

// title and back may each be a plain value or a function of the screen's
// current state, read AFTER enter() has settled it. The walk is the reason:
// on a change order it is titled for that change order and Back goes to the
// job, not to the bid.
function screenTitle(cfg) { return (typeof cfg.title === 'function' ? cfg.title() : cfg.title) || ''; }
function screenBack(cfg) { return typeof cfg.back === 'function' ? cfg.back() : cfg.back; }

// What the Back button SAYS. A screen with views of its own answers "Back",
// because one step is one step; anything else names where it lands, so "‹ Bid"
// on the price screen is a promise the button keeps. Only a destination with a
// fixed title gets named — a title that is a function is a title that depends
// on state the button is about to leave.
function screenBackLabel(cfg) {
  if (cfg && cfg.backStep && cfg.backStep(true)) return 'Back';
  const back = cfg && screenBack(cfg);
  const dest = back && SCREENS[back];
  return (dest && typeof dest.title === 'string' && dest.title) ? dest.title : 'Back';
}

// ONE step back, whatever that means where he is standing: a screen with its
// own views (the walk: item list -> area -> areas) walks those first and only
// then leaves. Returns false when there is nothing behind this screen at all,
// which is what tells the history handler to stay put rather than let the
// swipe out of the app.
//
// Nothing in here pushes: going back is never a step deeper, and a push here
// would mean the stack grew every time he tried to leave it.
function goBack() {
  const cfg = SCREENS[state.screen];
  const wasSuppressed = navSuppress;
  navSuppress = true;
  try {
    if (cfg && cfg.backStep && cfg.backStep()) return true;
    const back = cfg && screenBack(cfg);
    if (back) { show(back); return true; }
    // A tab he stepped onto from inside a bid goes back to where he was
    // standing. show() with no argument means "keep what's on the glass", so
    // the walk comes back on the same area he left.
    if (navTabFrom && SCREENS[navTabFrom]) { const to = navTabFrom; show(to); return true; }
    return false;
  } finally {
    navSuppress = wasSuppressed;
  }
}

// The Back button spends a history entry rather than navigating behind the
// browser's back, so the button and the swipe stay one action. With no entry
// of ours to spend (a fresh launch straight onto a screen), it just goes.
function backTapped() {
  if (navDepth > 0) { try { history.back(); return; } catch (e) { /* fall through */ } }
  goBack();
}

// The phone's back gesture, and the browser's back button. The entry we land
// on carries the depth it was pushed at, so the counter corrects itself here
// rather than drifting.
function onPopState(e) {
  const depth = e && e.state && typeof e.state.ceb === 'number' ? e.state.ceb : 0;
  navDepth = depth;
  // A panel is a question, and the back gesture is the answer "no". It must
  // never navigate underneath one: the sheet would stay on the glass over
  // whatever screen the swipe landed on, and Done would then write into the
  // bid he had just left. So cancel it, put the entry the swipe spent back,
  // and stay exactly where he is — one gesture, one thing dismissed.
  if (anyPanelOpen()) { closeAnyPanel(); navPush(); return; }
  // On the PIN screen there is nothing to go back to and everything to lose.
  if (!state.unlocked) { navPush(); return; }
  navSuppress = true;
  let moved = false;
  try { moved = goBack(); } finally { navSuppress = false; }
  // Home, with nothing behind it: put an entry back so the NEXT swipe has
  // something of ours to spend and the app stays on the glass.
  if (!moved) navPush();
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
  // Only ever visible during a Settings-initiated change; on the lock screen
  // there is nowhere for a cancel to go.
  el('pinCancel').addEventListener('click', () => { if (pinChanging) endPinChange(); });
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
  el('textInput').addEventListener('input', () => { if (textCtx.open) renderTextChips(); });
  el('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); textDone(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeText(); }
  });

  // The multi-line field is the same panel with one rule reversed: Enter is a
  // new line in a scope of work, so only Done finishes it.
  el('textArea').addEventListener('input', () => { if (textCtx.open) renderTextChips(); });
  el('textArea').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeText(); }
  });

  el('confirmOk').addEventListener('click', () => closeConfirm(true));
  el('confirmCancel').addEventListener('click', () => closeConfirm(false));
}

function wireNav() {
  el('backBtn').addEventListener('click', backTapped);
  el('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn || !state.unlocked) return;
    // Tab to tab REPLACES: the two tabs are two places to stand, not a way in
    // and a way further in, and a swipe should not have to walk back through
    // every time he has flipped between them.
    //
    // From anywhere else the tap is a step AWAY, so it PUSHES and remembers
    // what it left. Replacing there spent the entry that led back to the walk,
    // and the next back gesture took him out of the app instead of back to the
    // room he was counting in.
    const from = SCREENS[state.screen];
    const onTab = !!from && from.tab === state.screen;
    show(btn.dataset.tab, undefined, onTab ? { replace: true } : { tabFrom: state.screen });
  });
  window.addEventListener('popstate', onPopState);
}

// Ask the browser to keep this origin's data even when the phone is short of
// space. Every bid he has ever written lives in localStorage and IndexedDB, and
// storage a browser considers "best effort" is storage it is allowed to throw
// away on its own. Fire-and-forget on purpose: iOS grants or refuses it without
// a prompt in a home-screen app, there is nothing useful to say either way, and
// a browser without the API must not break boot.
function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch { /* no storage manager on this browser */ }
}

function boot() {
  requestPersistentStorage();
  if (Store.loadProblem() === 'corrupt') {
    showBanner('Storage was unreadable — restore from a backup in Settings', 'danger', { persistent: true });
  }
  wirePinKeypad();
  wirePanels();
  wireNav();
  initPinScreen();
  // The entry the app launched on becomes ours, rather than a stranger the
  // first back gesture would fall through to.
  navDepth = 0;
  navReplace();
  show('pin');
}

document.addEventListener('DOMContentLoaded', boot);

// Service worker registration. Same pattern as CE Timesheets: this is what
// makes the app work in a plant with no signal.
if ('serviceWorker' in navigator) {
  // Home-screen apps on iOS resume from the background far more often than
  // they cold-launch, and iOS's own periodic SW update check is unreliable
  // there. So we don't just register-and-forget: pull for updates right
  // after registering, and again every time the app comes back to the
  // foreground.
  let reloadedForNewWorker = false; // guards against a reload loop

  // On a first-ever install there is no controller yet, so the worker's
  // clients.claim() fires controllerchange about a second in and the handler
  // below would reload a page that is already running the newest code — a
  // visible blink on the PIN screen, twice on iOS (once in Safari, once on
  // the first standalone launch). Snapshot whether a controller existed when
  // this ran: a real update always has one by then, so updates still reload.
  const hadController = !!navigator.serviceWorker.controller;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });
      })
      .catch(() => {});
  });

  // When a new worker takes control, reload once to pick it up. Everything the
  // user has committed lives in localStorage (every screen saves on change), so
  // a reload here can only lose an in-progress, not-yet-committed field edit.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;   // first install claiming the page, not an update
    if (reloadedForNewWorker) return;
    reloadedForNewWorker = true;
    location.reload();
  });
}
