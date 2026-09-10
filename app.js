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
const APP_VERSION = 'billing-v3.2.2';

// The day that build was made, as a plain ISO date. The version line at the
// bottom of Settings reads "CE Billing · v3 · built Sep 9, 2026" off these two
// together: the version says WHICH build and this says WHEN, which is the half
// he can check against the day he was told to update. Bumped with APP_VERSION
// and CACHE, in the same commit, every release.
const APP_BUILT = '2026-09-10';

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
// opts.onTap: the banner names a place, so the banner goes there. The text
// becomes a button, the dismiss X stays its own control beside it, and the
// banner clears itself on the way — the screen it lands on is the answer, and a
// warning still sitting over it is a warning about the thing he is now fixing.
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

  if (typeof opts.onTap === 'function') {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'banner-text banner-go';
    go.textContent = text;
    go.addEventListener('click', () => {
      banner.remove();
      opts.onTap();
    });
    banner.appendChild(go);
  } else {
    const span = document.createElement('span');
    span.className = 'banner-text';
    span.textContent = text;
    banner.appendChild(span);
  }

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
// The one way round it is a closes: true caption link, which takes its own
// panel down before it opens the next; the next must not carry a closes link
// of its own.

const keypadCtx = { open: false, buffer: null, done: null, captionAction: null, captionCloses: false };
// field: whichever of the two text controls this prompt is using — the
// single-line input or the multi-line textarea. Everything after promptText
// reads the field through the context rather than by id, so Done, the chips
// and the close path work the same either way.
const textCtx = { open: false, done: null, suggest: null, field: null, multiline: false };
const confirmCtx = { open: false, resolve: null };

function anyPanelOpen() { return keypadCtx.open || textCtx.open || confirmCtx.open || dateCtx.open; }

// A panel is a full-screen question, and the pinned action bar under it belongs
// to the screen he is no longer looking at. The overlay already covers it, but
// a fixed element on iOS can still take a touch at the edge of a scrolling
// sheet, so it is taken off the glass outright. One flag, set from the same
// four places that open and close a panel.
function syncPanelClass() {
  try { document.body.classList.toggle('panel-open', anyPanelOpen()); } catch (e) { /* no body in a test DOM */ }
}

// Cancel whatever panel is up, exactly as its own Cancel button would: the
// done callback never runs, so nothing is written. Returns true if there was
// one. This is what a navigation goes through, because a panel is drawn OVER
// the screen it was opened from: leave that screen with the keypad still up
// and the next Done commits into the bid he is no longer looking at.
function closeAnyPanel() {
  if (keypadCtx.open) { closeKeypad(); return true; }
  if (textCtx.open) { closeText(); return true; }
  if (confirmCtx.open) { closeConfirm(false); return true; }
  if (dateCtx.open) { closeDate(); return true; }
  // An attached strip is a question too — smaller, drawn in the flow rather
  // than over it, and just as much a thing a back gesture should answer before
  // it answers "leave this screen". See currentStrip in ui.js.
  return closeAnyStrip();
}

// --- Number keypad ---------------------------------------------------------

// promptNumber(current, { label, caption, captionAction, allowDecimal, maxChars,
//               maxDecimals, wasText, done })
// current: the existing value (Number) or null — shown as "was 12" but never
// preloaded into the buffer: retyping beats editing on a phone. wasText
// overrides that line for callers that format their own (see promptMoney).
// done(value) fires with a Number on Done and with null on Clear. Cancel calls
// nothing. There is no native number input anywhere in this app.
//
// Done with nothing typed hands back `current` unchanged when there is one —
// looking at a number and agreeing with it is an answer. A caller that would
// REFUSE its own current value (a wage of $0, say) must not pass it as
// current, or Done would re-ask the same question forever.
function promptNumber(current, opts) {
  opts = opts || {};
  if (anyPanelOpen()) return;

  const allowDecimal = !!opts.allowDecimal;
  keypadCtx.open = true;
  keypadCtx.buffer = Keypad.createBuffer({
    allowDecimal, maxChars: opts.maxChars, maxDecimals: opts.maxDecimals, prior: current,
  });
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

  // captionAction: { label, onTap, closes } — one link under that sentence.
  // Written for the one panel that has somewhere to send him: "Check price"
  // opens the search in another tab and does NOT close the keypad, so the
  // half-typed number is still here when he comes back. closes: true is the
  // other kind of link, the one that hands off to a different keypad ("Price
  // the whole line instead"): this panel goes down first, because promptNumber
  // refuses to open over an open panel, and what he had typed here goes down
  // with it, which is what "instead" means. Stored on the context rather than
  // bound to the button, because the button is wired once at boot and the
  // panel is opened a thousand times.
  const act = opts.captionAction && opts.captionAction.label ? opts.captionAction : null;
  keypadCtx.captionAction = act ? act.onTap : null;
  keypadCtx.captionCloses = !!(act && act.closes);
  const actBtn = el('keypadCaptionAction');
  if (actBtn) {
    actBtn.textContent = act ? act.label : '';
    actBtn.hidden = !act;
  }

  // The decimal key only exists for callers that allow one; otherwise it stays
  // blanked so 0 and backspace never shift under the thumb.
  const dot = el('keypadDot');
  dot.classList.toggle('key-blank', !allowDecimal);
  dot.disabled = !allowDecimal;
  dot.tabIndex = allowDecimal ? 0 : -1;
  dot.setAttribute('aria-hidden', allowDecimal ? 'false' : 'true');

  renderKeypad();
  el('panel-keypad').hidden = false;
  syncPanelClass();
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

// What Done hands back: what he typed, or — when he typed nothing on a panel
// that opened with a value — that value. Keypad.submit decides which, and is
// tested there.
function keypadValue() {
  return keypadCtx.buffer ? keypadCtx.buffer.submit() : null;
}

function closeKeypad() {
  el('panel-keypad').hidden = true;
  keypadCtx.open = false;
  keypadCtx.buffer = null;
  keypadCtx.done = null;
  keypadCtx.captionAction = null;
  keypadCtx.captionCloses = false;
  const actBtn = el('keypadCaptionAction');
  if (actBtn) { actBtn.hidden = true; actBtn.textContent = ''; }
  syncPanelClass();
}

// The caption link under a keypad. Wired once at boot; what it does is
// whatever the open panel put on the context. A closes: true link takes
// this panel down first, and what he had typed here goes down with it,
// which is what "instead" means on the one link that uses it.
function keypadCaptionTapped() {
  const act = keypadCtx.captionAction;
  if (!act) return;
  if (keypadCtx.captionCloses) closeKeypad();   // read before the close, which clears the context
  act();
}

function keypadDone() {
  const v = keypadValue();
  // Null here means nothing typed AND nothing to keep — a brand new line. The
  // panel stays up and shakes, because closing it would look like it had
  // written something.
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

// promptMoney(cents, { label, caption, captionAction, done }) — the ONE money entry point. Every later
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
    captionAction: opts.captionAction,
    allowDecimal: true,
    maxDecimals: 2, // cents are the smallest thing money has
    wasText: has ? 'was ' + BidMath.fmt(cents) : 'was not set',
    done: (v) => { if (done) done(v === null ? null : Math.round(v * 100)); },
  });
}

// --- Text prompt -----------------------------------------------------------

// promptText(current, { label, caption, placeholder, suggestions | suggest, multiline, maxLength, done })
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
//
// maxLength: an optional ceiling, handed straight to the field's own maxlength
// so the phone stops taking characters at the wall instead of accepting a
// paragraph and having something further down refuse it. Callers that do not
// name one get no cap at all, which is every caller but the area note.
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
  // An optional sentence under the question, the same one promptNumber takes.
  const cap = el('textCaption');
  cap.textContent = opts.caption || '';
  cap.hidden = !opts.caption;
  const input = el('textInput');
  const area = el('textArea');
  input.hidden = textCtx.multiline;
  area.hidden = !textCtx.multiline;
  const field = textCtx.multiline ? area : input;
  textCtx.field = field;
  field.value = current == null ? '' : String(current);
  field.placeholder = opts.placeholder || '';
  // Set on the field this prompt is using and taken off it again when the next
  // caller does not ask for one: the two controls are reused panel after panel,
  // and a cap left behind would silently truncate somebody else's answer.
  const maxLength = (typeof opts.maxLength === 'number' && opts.maxLength > 0)
    ? Math.floor(opts.maxLength)
    : null;
  if (maxLength) field.setAttribute('maxlength', String(maxLength));
  else field.removeAttribute('maxlength');
  renderTextChips();

  el('panel-text').hidden = false;
  syncPanelClass();

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
  el('textCaption').hidden = true;
  el('textChips').textContent = '';
  el('textChips').hidden = true;
  textCtx.open = false;
  textCtx.done = null;
  textCtx.suggest = null;
  textCtx.field = null;
  textCtx.multiline = false;
  syncPanelClass();
}

function textDone() {
  const field = textCtx.field || el('textInput');
  const value = field.value.trim();
  const done = textCtx.done;
  closeText();
  if (done) done(value);
}

// --- Calendar --------------------------------------------------------------

// promptDate(initialISO, label, onPick, opts) — the first thing he sees for any
// date in this app: log From and To, a bid's date, a payment.
//
// Four digits on the keypad was the whole vocabulary until the Invoices tab
// asked him for two dates on one screen. It is still the fastest way to write
// a day he knows the number of, and it is still here — "Type it" under the
// grid hands straight off to that same keypad, so there is one date parser and
// one panel of digits, not a second copy of either. What the keypad could not
// answer is "the Friday", which is a thing a man finds by looking.
//
// onPick(iso) fires with an ISO date, from a tapped day or from the keypad.
// Cancel and the back gesture call nothing, exactly like the other panels; the
// arithmetic underneath is Dates', so this draws a month and decides nothing
// about what one is.
const dateCtx = { open: false, done: null, iso: null, month: null, today: null, typeLabel: '' };

// The one question this panel asks of a string, and it asks it through Dates
// rather than a regex of its own: fmtDate refuses anything that is not a real
// YYYY-MM-DD, which is the same gate every other date in this app passes.
function dateIsReal(iso) { return Dates.fmtDate(iso) !== ''; }

const DATE_TYPE_LABEL = 'Date: type 915 for Sep 15, or 91526';
const DATE_TYPE_REFUSAL = 'That date needs 4 digits (MMDD) or 6 (MMDDYY)';

function promptDate(initialISO, label, onPick, opts) {
  opts = opts || {};
  if (anyPanelOpen()) return;

  const today = Store.todayISO();
  dateCtx.open = true;
  dateCtx.done = typeof onPick === 'function' ? onPick : null;
  // A row with no date on it yet opens on today rather than on nothing: the
  // month he is standing in is the month he means nine times in ten.
  dateCtx.iso = dateIsReal(initialISO) ? initialISO : today;
  dateCtx.month = dateCtx.iso;
  dateCtx.today = today;
  dateCtx.typeLabel = opts.typeLabel || DATE_TYPE_LABEL;

  el('dateLabel').textContent = label || '';
  // The same line the keypad panel wears, and hidden rather than blank when a
  // caller has nothing to put in it, so the spacing does not move.
  const was = el('dateWas');
  was.textContent = opts.wasText || '';
  was.hidden = !opts.wasText;

  renderDate();
  el('panel-date').hidden = false;
  syncPanelClass();
}

// The month on the glass. Redrawn whole on every arrow: five rows of seven is
// a cheap rebuild and diffing them would be more code than it saves.
function renderDate() {
  el('dateTitle').textContent = Dates.monthTitle(dateCtx.month);
  const grid = el('dateGrid');
  grid.textContent = '';
  const year = Number(dateCtx.month.slice(0, 4));
  const month = Number(dateCtx.month.slice(5, 7));
  Dates.monthGrid(year, month).forEach((week) => {
    week.forEach((iso) => {
      if (!iso) {
        // A blank cell rather than no cell: the columns may not shift under
        // his thumb between one month and the next.
        const gap = document.createElement('div');
        gap.className = 'cal-day cal-blank';
        gap.setAttribute('aria-hidden', 'true');
        grid.appendChild(gap);
        return;
      }
      const day = document.createElement('button');
      day.type = 'button';
      day.className = 'cal-day'
        + (iso === dateCtx.iso ? ' cal-on' : '')
        + (iso === dateCtx.today ? ' cal-today' : '');
      day.textContent = String(Number(iso.slice(8, 10)));
      // The whole date, said out loud, because "12" on its own is not one.
      day.setAttribute('aria-label', Dates.fmtDate(iso));
      day.setAttribute('aria-pressed', iso === dateCtx.iso ? 'true' : 'false');
      day.dataset.iso = iso;
      grid.appendChild(day);
    });
  });
}

// The arrows. A month that will not compose leaves him where he is rather
// than navigating to nothing.
function dateStep(n) {
  if (!dateCtx.open) return;
  const next = Dates.addMonths(dateCtx.month, n);
  if (!next) return;
  dateCtx.month = next;
  renderDate();
}

function datePick(iso) {
  if (!dateCtx.open || !dateIsReal(iso)) return;
  const done = dateCtx.done;
  closeDate();
  if (done) done(iso);
}

// "Type it" — the hand-off to the keypad, on the captionCloses pattern the
// cost keypad already uses: this panel goes down FIRST, because promptNumber
// refuses to open over an open panel. The result feeds the SAME onPick, so a
// caller never learns which of the two he used.
function dateTypeTapped() {
  if (!dateCtx.open) return;
  const done = dateCtx.done;
  const was = dateCtx.iso;
  const label = dateCtx.typeLabel;
  closeDate();                       // read off the context before it is cleared
  promptNumber(null, {
    label,
    maxChars: 6,
    wasText: 'was ' + Dates.fmtDate(was),
    done: (v) => {
      // Clear is never mind, the way it is on every other date in this app.
      if (v === null) return;
      const iso = Dates.parseTypedDate(v, Store.todayISO());
      if (!iso) { showBanner(DATE_TYPE_REFUSAL); render(); return; }
      if (done) done(iso);
    },
  });
}

function closeDate() {
  el('panel-date').hidden = true;
  el('dateGrid').textContent = '';
  dateCtx.open = false;
  dateCtx.done = null;
  dateCtx.iso = null;
  dateCtx.month = null;
  dateCtx.today = null;
  dateCtx.typeLabel = '';
  syncPanelClass();
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
    syncPanelClass();
  });
}

function closeConfirm(answer) {
  el('panel-confirm').hidden = true;
  confirmCtx.open = false;
  syncPanelClass();
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
      setPinMessage("PINs didn't match. Start over");
      // On the first run the message line IS the screen; mid-change the banner
      // says it too, because the screen he came from is the one he is thinking
      // about and the message under the dots is easy to walk past.
      if (pinChanging) showBanner("PINs didn't match. Start over");
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
  setPinMessage('Wrong PIN. Try again');
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

  // A banner is about the screen it was raised on. Left standing across a
  // navigation it becomes a lie: "Put a price on \"Permits\" first." was about
  // the bid he just left, and on the next bid it names a line that bid does not
  // have — and its tap, which carries the OLD bid's line with it, silently
  // moves him to a different bid's room. Leaving a screen ends the sentence.
  // Persistent banners are conditions, not events, so they stay.
  if (key !== state.screen) clearBanner();

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
  // Every strip on the glass is about to be rebuilt or not rebuilt by the
  // screen below, so what was tracked a moment ago is not news. Whichever strip
  // this render draws registers itself again on the way past.
  stripsCleared();
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
    showBanner("Couldn't save. Nothing changed", 'danger');
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
  // One gesture, one thing dismissed: a panel if there is one, otherwise a
  // strip. closeAnyPanel answers for both and says whether it found anything.
  if (closeAnyPanel()) { navPush(); return; }
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
  // The optional link under a keypad's caption. Wired once; what it does is
  // whatever the panel that is open put on the context. Most leave the panel
  // standing (Check price); captionCloses is the one kind that hands off to a
  // different keypad instead.
  const capAct = el('keypadCaptionAction');
  if (capAct) capAct.addEventListener('click', keypadCaptionTapped);
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

  // The calendar. The grid is rebuilt on every arrow, so the days are read
  // through one delegated listener the way the keypad's keys are, rather than
  // wiring thirty buttons a month.
  el('dateGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled || !btn.dataset.iso) return;
    datePick(btn.dataset.iso);
  });
  el('datePrev').addEventListener('click', () => dateStep(-1));
  el('dateNext').addEventListener('click', () => dateStep(1));
  el('dateType').addEventListener('click', dateTypeTapped);
  el('dateCancel').addEventListener('click', closeDate);

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
    showBanner('Storage was unreadable. Restore from a backup in Settings', 'danger', { persistent: true });
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
