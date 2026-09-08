'use strict';

// ui.js — shared DOM helpers and the small builders every screen composes from.
// Loaded before app.js and before screens/*.js. Nothing here reaches into app
// state: these functions take values and hand back elements or strings, so a
// screen can be read top to bottom as "what goes on the glass". Anything two
// screens both need lives here — a screen file never defines a helper another
// screen calls.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

// Plain-number display. Trims float noise (0.30000000000000004) without
// pretending to be a currency formatter — money goes through moneyText.
function numText(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  return String(Math.round(n * 1000) / 1000);
}

// A percentage on screen. One decimal is the finest anyone quotes a margin
// at, and it is the cap the keypad enforces for typed ones — but a margin
// READ BACK out of solve() is a float off a division (24.99871…), and printing
// that raw would put six digits of false precision next to a price. Display
// rounding only: nothing priced is ever computed from this string.
function pctText(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return numText(Math.round(n * 10) / 10) + '%';
}

// The one place cents become dollars on screen. BidMath.fmt already refuses to
// print NaN/Infinity, so a broken number shows as an em dash rather than
// garbage in front of a customer.
function moneyText(cents) { return BidMath.fmt(cents); }

// Restarts a CSS animation that may already be on the element.
function shake(node) {
  node.classList.remove('shake');
  void node.offsetWidth; // force reflow so a second trigger re-runs the animation
  node.classList.add('shake');
  node.addEventListener('animationend', () => node.classList.remove('shake'), { once: true });
}

// revealAfterRender(node) -> node
//
// Scrolls a thing that has just appeared far enough up to be READ. A card
// appended at the bottom of a screen renders below the fold on a small phone:
// on an iPhone SE the Lost reason question landed at y=660 in a 667-point
// window, under the tab bar, and tapping "Lost" looked like nothing had
// happened at all.
//
// The tab bar is fixed over the last 64 points of the window, so
// scrollIntoView({ block: 'nearest' }) alone would stop with the answer behind
// it. This scrolls to clear the bar and leaves the element where it already is
// if it is comfortably on screen — a prompt that jumps the page while he is
// reading it is its own kind of wrong. Runs after the frame the caller just
// built, because an element that is not laid out yet has no position to read.
//
// Returns the node, so a caller can append and reveal in one line.
const REVEAL_MARGIN = 12;

function revealAfterRender(node) {
  if (!node || typeof node.getBoundingClientRect !== 'function') return node;
  const run = () => {
    try {
      const bar = el('tabbar');
      const barH = (bar && !bar.hidden) ? bar.getBoundingClientRect().height : 0;
      const rect = node.getBoundingClientRect();
      const bottomLimit = window.innerHeight - barH - REVEAL_MARGIN;
      if (rect.bottom > bottomLimit) {
        // Never past its own top: a card taller than the space left should
        // show its beginning, not its end.
        const by = Math.min(rect.bottom - bottomLimit, Math.max(0, rect.top - REVEAL_MARGIN));
        if (by > 0) window.scrollBy({ top: by, behavior: 'smooth' });
      } else if (rect.top < REVEAL_MARGIN) {
        node.scrollIntoView({ block: 'nearest' });
      }
    } catch (e) { /* no layout in this environment */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
  return node;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

// card(title) -> <section class="card"> with an optional heading. Callers
// append rows and buttons into it.
function card(title) {
  const box = document.createElement('section');
  box.className = 'card';
  if (title) {
    const h = document.createElement('h3');
    h.className = 'card-title';
    h.textContent = title;
    box.appendChild(h);
  }
  return box;
}

// A heading that belongs to the CARDS UNDER IT rather than to one card. The
// walk's areas are one card each, which left the most important group on the
// screen with nothing naming it: a bid with a single area read as the job
// itself rather than as one area of it. Same size, weight and colour as a
// card's own title, sitting on the page instead of inside a box, so the
// heading and the cards under it are visibly one section.
function groupHeading(text) {
  const h = document.createElement('h3');
  h.className = 'card-title group-heading';
  h.textContent = text;
  return h;
}

// ---------------------------------------------------------------------------
// TAP AFFORDANCE
// ---------------------------------------------------------------------------
// One rule, applied by the builders rather than by nine screens' worth of CSS:
// a thing that does something LOOKS like it does something, and a thing that is
// only a fact looks like a fact.
//
//   .tap          press feedback — the background darkens for the length of the
//                 press, so a tap that opened a keypad off-screen still says it
//                 landed
//   .tap-chevron  a right-hand ›, meaning "this opens something"
//   .tap-value    the value in navy, meaning "this opens a keypad"
//   .flat         no chevron, no press state: information, not a control
//
// Six of the eleven rows on the Costs & price screen used to be tappable and
// the other five looked identical to them. Choosing between chevron and navy is
// the caller's, and it is the only decision a screen makes about tap styling.
function tapClasses(onTap, opts) {
  const o = opts || {};
  if (!onTap) return ' flat';
  // keypad and strip are the same answer for two reasons: neither one opens a
  // screen, so neither one gets the ›, and both change the value sitting on the
  // row, so the value is the thing that looks tappable.
  return ' tap' + (o.keypad || o.strip ? ' tap-value' : ' tap-chevron');
}

// The › itself. A span, not a pseudo-element, so it sits in the flex row after
// the value instead of overlapping it on a narrow phone.
function chevron() {
  const c = document.createElement('span');
  c.className = 'chev';
  c.setAttribute('aria-hidden', 'true');
  c.textContent = '›';
  return c;
}

// row(label, value, onTap, opts) -> a label/value line. With onTap it is a real
// button (56px tall, the whole line is the target — no tiny pencil icons);
// without one it is inert text and wears .flat.
//
// opts.keypad: this row opens a number panel, so the value goes navy and there
// is no chevron: a chevron says this opens a screen. opts.strip is the same
// promise for a row that opens an attached strip under itself rather than a
// panel. Anything else that taps gets the chevron.
function row(label, value, onTap, opts) {
  const node = document.createElement(onTap ? 'button' : 'div');
  node.className = 'row' + (onTap ? ' row-tap' : '') + tapClasses(onTap, opts);
  if (onTap) {
    node.type = 'button';
    node.addEventListener('click', onTap);
  }

  const l = document.createElement('span');
  l.className = 'row-label';
  l.textContent = label;

  const v = document.createElement('span');
  v.className = 'row-value';
  // A blank value would collapse the line and leave nothing to aim at.
  v.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);

  // opts.sub: the walk's muted second line, for a fact ABOUT the thing rather
  // than the thing's own value — which drawer a part came out of, when a
  // search is crossing all six of them. The value slot is left alone: what a
  // part is counted in belongs on the right, where every other row's answer
  // is, and a category shoved in beside it made one slot say two things.
  if (opts && opts.sub) {
    const text = document.createElement('span');
    text.className = 'row-text';
    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = String(opts.sub);
    text.appendChild(l);
    text.appendChild(sub);
    node.appendChild(text);
  } else {
    node.appendChild(l);
  }
  node.appendChild(v);
  if (onTap && !(opts && (opts.keypad || opts.strip))) node.appendChild(chevron());
  return node;
}

// tapCard({ title, sub, note, tag, value, onTap }) -> a whole card that is one
// button. The areas on the walk are the reason: they were rows inside a shared
// card, which made the most important list in the app read as a paragraph. A
// card with a border and a › reads as a door, which is what it is.
//
// tag: a small muted word over the title, saying what KIND of thing this card
// is. One area on a walk read as the job itself until a second one turned up
// beside it; "Area" over the name answers that on the first one.
// note: a second muted line under the sub, for a preview of something written
// rather than counted. Kept to one line by the caller, which is what decides
// how much of a paragraph belongs on a list.
function tapCard(opts) {
  const o = opts || {};
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card card-tap tap tap-chevron';

  const text = document.createElement('div');
  text.className = 'card-tap-text';
  if (o.tag) {
    const g = document.createElement('div');
    g.className = 'card-tap-tag';
    g.textContent = o.tag;
    text.appendChild(g);
  }
  const t = document.createElement('div');
  t.className = 'card-tap-title';
  t.textContent = o.title || '';
  text.appendChild(t);
  if (o.sub) {
    const s = document.createElement('div');
    s.className = 'card-tap-sub';
    s.textContent = o.sub;
    text.appendChild(s);
  }
  if (o.note) {
    const nt = document.createElement('div');
    nt.className = 'card-tap-note';
    nt.textContent = o.note;
    text.appendChild(nt);
  }
  btn.appendChild(text);

  if (o.value !== null && o.value !== undefined && o.value !== '') {
    const v = document.createElement('div');
    v.className = 'card-tap-value';
    v.textContent = String(o.value);
    btn.appendChild(v);
  }
  btn.appendChild(chevron());
  if (o.onTap) btn.addEventListener('click', o.onTap);
  return btn;
}

// attachedStrip(parentRowEl, buttons, opts) -> the strip, already inserted
// directly under the row that opened it.
//
// Every inline menu in this app used to be its own shape: a flex row here, a
// card there, an outlined red Cancel on the price screen and a block button on
// the walk. Worse, they were appended after the row's CARD, so the answer to
// "what do you want to do with this line?" appeared under a heading belonging
// to something else, and the Cancel button touched the next section.
//
// One shape now: inside the parent card, indented past the row, a left border
// in the accent, a light tint, 48px buttons, and 16px of clear space before
// whatever comes next. Cancel is a text button — backing out of a menu is not
// a destructive act and must not wear the color of one.
//
// buttons: [{ label, onTap, cls, disabled, link, quiet } | { node } | null]. A
// null entry is skipped, so a caller can write `cond ? {...} : null` inline.
//
// link and quiet take a button OUT of the grid and give it its own full-width
// line under it, in the order grid -> link -> quiet -> Cancel:
//   link   a navy text link. A side trip that is not one of the row's edits
//          ("Check price" opens a search in another tab).
//   quiet  a muted text link, and the ONLY shape a Delete or a Remove wears
//          anywhere on a screen. Nothing on a screen is red: an outlined red
//          Delete sitting beside Rename made the dangerous answer the loudest
//          thing in the strip and put it under the same thumb. Red is left to
//          the confirm panel's primary button, which is the one place a colour
//          is asking a question rather than sitting there being pressed. Quiet
//          entries come last, so the destructive one is always the furthest
//          from where the thumb lands.
// opts.label: a small heading over the buttons ("Which area?").
// opts.content: any element to sit above the buttons (a row of chips).
// opts.cancel: a function — renders the secondary Cancel. opts.cancelLabel
// renames it ("Close" in the bid ⋯ menu).
// The strip currently on the glass, as the function that closes it — which is
// exactly opts.cancel, the thing its own Cancel button is wired to.
//
// It exists so the back gesture has something to spend on a strip. A menu
// hanging under a row is a question, the same as a keypad is, and a swipe
// answering it by leaving the screen entirely is one step too many: he opens
// the ⋯ on a bid, swipes back to close it, and lands on the home screen.
//
// Cleared at the top of every render (stripsCleared) and set again by whichever
// strip that render draws, so it can never point at a strip that is no longer
// on screen.
let currentStrip = null;

function stripsCleared() { currentStrip = null; }

// Close the open strip, if there is one. True when there was.
function closeAnyStrip() {
  if (!currentStrip) return false;
  const cancel = currentStrip;
  currentStrip = null;
  cancel();
  return true;
}

function attachedStrip(parentRowEl, buttons, opts) {
  const o = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'attached-strip';

  if (o.label) wrap.appendChild(fieldLabel(o.label));
  if (o.content) wrap.appendChild(o.content);

  const all = (buttons || []).filter(Boolean);
  const list = all.filter((b) => !b.link && !b.quiet);
  if (list.length) {
    const btns = document.createElement('div');
    btns.className = 'attached-strip-btns';
    list.forEach((b) => {
      if (b.node) { btns.appendChild(b.node); return; }
      const node = textButton(b.label, 'btn' + (b.cls ? ' ' + b.cls : ''), b.onTap);
      if (b.disabled) node.disabled = true;
      btns.appendChild(node);
    });
    wrap.appendChild(btns);
  }

  // Two passes rather than one filter, so the order on the glass is the order
  // the rule promises and not the order the caller happened to list them in.
  all.filter((b) => b.link && !b.quiet).forEach((b) => {
    wrap.appendChild(b.node || textButton(b.label, 'link-btn link-btn-strip', b.onTap));
  });
  const quiet = all.filter((b) => b.quiet);
  quiet.forEach((b) => {
    wrap.appendChild(b.node || textButton(b.label, 'link-btn link-btn-quiet', b.onTap));
  });

  // A strip with buttons in it already separates the quiet line from the
  // Cancel under it — there is a row of blocks above them saying which part of
  // the strip is which. A strip whose ONLY action is quiet has no such row:
  // "Delete" and "Cancel" are two muted left-aligned lines of the same size,
  // and the first of them stops reading as a thing to press at all. A hairline
  // is the whole fix, and it costs one pixel.
  const lonely = quiet.length > 0 && list.length === 0
    && all.filter((b) => b.link && !b.quiet).length === 0;

  if (typeof o.cancel === 'function') {
    if (lonely) {
      const rule = document.createElement('div');
      rule.className = 'strip-rule';
      wrap.appendChild(rule);
    }
    // Whatever was tracked before is replaced: two strips are never open at
    // once, and the second one drawn is the one on the glass.
    currentStrip = o.cancel;
    wrap.appendChild(textButton(o.cancelLabel || 'Cancel', 'link-btn attached-strip-cancel', () => {
      currentStrip = null;
      o.cancel();
    }));
  }

  // Inserted for the caller when the row is already in the document; handed
  // back unplaced when it is not, so a builder assembling a card off-screen can
  // append it itself.
  //
  // And revealed, for the same reason the Lost question is. A strip hangs
  // UNDER the row that opened it, so tapping a row sitting at the bottom of the
  // glass drew the whole strip behind the pinned bar: on an SE, tapping "Hours
  // cushion" with that row above the bar put the strip at y=602 in a 667-point
  // window and not one pixel of it was on screen. Nothing had visibly happened,
  // which is the same nothing that made the Lost question look broken.
  // revealAfterRender leaves a strip that is already comfortably on screen
  // exactly where it is, so a re-render of an open strip moves nothing.
  if (parentRowEl && parentRowEl.parentNode) {
    parentRowEl.parentNode.insertBefore(wrap, parentRowEl.nextSibling);
    revealAfterRender(wrap);
  }
  return wrap;
}

// pinnedBar(host, label, onTap, opts) -> the one action this screen is for,
// fixed above the tab bar so thirty rows of scrolling never puts it out of
// reach. One per screen: two pinned buttons is two primary actions, which is
// none.
//
// A spacer goes into the flow with it rather than a class on the host, because
// every renderer clears its host with textContent = '' — which takes the spacer
// with it and leaves no state for a screen that only sometimes has a bar.
function pinnedBar(host, label, onTap, opts) {
  const o = opts || {};
  const bar = document.createElement('div');
  bar.className = 'pinbar';
  const btn = textButton(label, 'btn btn-block ' + (o.cls || 'btn-primary'), onTap);
  if (o.disabled) btn.disabled = true;
  bar.appendChild(btn);
  if (host) {
    const spacer = document.createElement('div');
    spacer.className = 'pinbar-spacer';
    host.appendChild(spacer);
    host.appendChild(bar);
  }
  return bar;
}

// ---------------------------------------------------------------------------
// THE STEP STRIP
// ---------------------------------------------------------------------------
// Walk · Labor · Price · Proposal, across the top of every screen inside a bid.
// Four screens that lead one to the next had no way to say where he was or to
// jump — the only route between them was Back, Back, Back and in again.
//
// A step is "done" when HE has done something on it. That is the only reading
// worth having: the first version called Price done on a brand new bid, because
// a bid seeded with the shop's default rate already solves to a price above
// zero, and a checkmark he did not earn is worse than no checkmark at all — it
// tells him a screen is finished that he has never opened.
//
// So each one asks for a mark he left: an item counted, a crew and days set, a
// handle moved, a proposal sent. Nothing here is used in any arithmetic.

const BID_STEPS = [
  ['walk', 'Walk'],
  ['labor', 'Labor'],
  ['price', 'Price'],
  ['proposal', 'Proposal'],
];

function bidStepDone(bid, settings, key) {
  if (!bid) return false;
  // An area with something counted in it. An empty area is a room he named and
  // walked out of; rentals and equipment are the price screen's rows, and a
  // checkmark on Walk for a line he added there is a lie about where he has
  // been.
  if (key === 'walk') {
    return (bid.areas || []).some((a) => (a.items || []).length > 0);
  }
  // Crew and days, which is what bid hours above zero means: neither one alone
  // makes an hour.
  if (key === 'labor') {
    try { return BidMath.costStack(bid, settings).bidHours > 0; } catch (e) { return false; }
  }
  // A handle he moved, and nothing else. bid.pricing.touched is set by the
  // price screen the first time one of the three handles, the markup or the
  // cushion is changed. It is OPTIONAL — a bid written before this existed
  // simply has no such key, which reads as untouched, which is the honest
  // answer for a bid nobody has priced since.
  //
  // There used to be a fallback under this: pricing that no longer matched the
  // shop's defaults counted as moved by hand. It compared the bid against
  // Settings, so changing the shop rate in Settings ticked Price on every
  // untouched bid on the phone at once. A step strip that ticks itself while
  // he is on another screen is worse than one that is a little behind.
  if (key === 'price') return (bid.pricing || {}).touched === true;
  if (key === 'proposal') return !!bid.sentAt;
  return false;
}

function stepStrip(bid, settings, current) {
  const wrap = document.createElement('div');
  wrap.className = 'stepstrip';
  BID_STEPS.forEach(([key, label], i) => {
    if (i) {
      const dot = document.createElement('span');
      dot.className = 'stepstrip-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '·';
      wrap.appendChild(dot);
    }
    const now = key === current;
    const done = !now && bidStepDone(bid, settings, key);
    const btn = textButton(
      (done ? '✓ ' : '') + label,
      'stepstrip-step' + (now ? ' stepstrip-now' : '') + (done ? ' stepstrip-done' : ''),
      () => { if (!now) show(key, bid.id); }
    );
    if (now) btn.setAttribute('aria-current', 'step');
    wrap.appendChild(btn);
  });
  return wrap;
}

// ---------------------------------------------------------------------------
// FEWER WORDS ON THE GLASS
// ---------------------------------------------------------------------------

// whatsThis(text) -> a "What's this?" link with the long explanation folded
// behind it. Every card keeps ONE caption line; the second and third sentences
// live here. Session state only — it folds back up on the next render, which is
// right: the explanation is for the day he wonders, not for every day after.
function whatsThis(text, label) {
  const wrap = document.createElement('div');
  wrap.className = 'whats-this';
  const body = document.createElement('div');
  body.hidden = true;
  // One line, or a list of them: Settings' rates card folds thirteen
  // explanations behind a single link, and thirteen sentences run together
  // into one paragraph is a wall he would not read once, let alone twice.
  (Array.isArray(text) ? text : [text]).forEach((line) => body.appendChild(caption(line)));
  const open = label || "What's this?";
  const btn = textButton(open, 'link-btn whats-this-btn', () => {
    body.hidden = !body.hidden;
    btn.textContent = body.hidden ? open : 'Hide';
    btn.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
  });
  btn.setAttribute('aria-expanded', 'false');
  wrap.appendChild(btn);
  wrap.appendChild(body);
  return wrap;
}

// bigNumber(text, sub) -> the one number a screen exists to produce, at the
// size of the answer it gives, with everything else on the screen stepped down
// around it.
function bigNumber(text, sub) {
  const wrap = document.createElement('div');
  wrap.className = 'big-number';
  const n = document.createElement('div');
  n.className = 'big-number-value';
  n.textContent = String(text);
  wrap.appendChild(n);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'big-number-sub';
    s.textContent = sub;
    wrap.appendChild(s);
  }
  return wrap;
}

// screenHead(title, sub, opts) -> the line at the top of a screen saying what
// he is looking at. Four screens had grown four identical copies of this with
// four class names; one drifts the moment anybody touches one of them.
// opts.center: the area screen, where the room's name is the subject of the
// whole screen rather than a label on the left.
function screenHead(title, sub, opts) {
  const o = opts || {};
  const head = document.createElement('div');
  head.className = 'screen-head' + (o.center ? ' screen-head-center' : '');
  const t = document.createElement('div');
  t.className = 'screen-head-title';
  t.textContent = title || '';
  head.appendChild(t);
  if (sub) {
    const c = document.createElement('div');
    c.className = 'screen-head-cust';
    c.textContent = sub;
    head.appendChild(c);
  }
  return head;
}

// textButton(label, cls, onTap) -> a plain <button> with a caller-chosen
// class. Both screens had grown their own copy of these four lines; the class
// is the only thing that ever differed.
function textButton(label, cls, onTap) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  if (onTap) btn.addEventListener('click', onTap);
  return btn;
}

// searchInput({ placeholder, label, value, onInput }) -> the search field, the
// same one on the walk and on the home screen.
//
// Everything about it is there because of an iPhone. Autocorrect turns 3/4
// into a word it likes better; autocapitalize puts a capital on EMT; the
// spellcheck underline makes a part number look like a mistake; the Return key
// says "go" when it should say "search". None of that is visible on a desktop,
// and all of it is in his way in a plant. They are set as ATTRIBUTES, not
// properties, because autocorrect and autocapitalize are not standard DOM
// properties — a tests/inputs.test.js assertion reads them back the same way
// the browser does.
//
// The clear-X is inside the field and only there when there is something to
// clear. It clears, refocuses (the keyboard stays up: he is mid-thought, not
// done), and tells the caller — one tap instead of nine backspaces.
//
// Returns the wrapper, with the input hung off it as .input so a caller can
// read the value or focus it without a querySelector for a class name.
function searchInput(opts) {
  const o = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'search-wrap' + (o.className ? ' ' + o.className : '');

  const input = document.createElement('input');
  const attrs = {
    type: 'text',
    placeholder: o.placeholder || 'Search',
    'aria-label': o.label || o.placeholder || 'Search',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    inputmode: 'search',
  };
  Object.keys(attrs).forEach((k) => input.setAttribute(k, attrs[k]));
  input.className = 'search-input';
  input.value = o.value || '';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.textContent = '✕';
  clear.hidden = input.value === '';

  const fire = () => { if (typeof o.onInput === 'function') o.onInput(input.value); };
  input.addEventListener('input', () => { clear.hidden = input.value === ''; fire(); });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    fire();
    try { input.focus(); } catch (e) { /* no focus in a test DOM */ }
  });

  wrap.appendChild(input);
  wrap.appendChild(clear);
  wrap.input = input;
  return wrap;
}

// emptyNote(text) -> the muted line that stands in for a list with nothing in
// it. Callers put it inside a card() so it reads as an answer rather than as
// the list having failed to load.
function emptyNote(text) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = text;
  return p;
}

// inlineWarn(text) -> the yellow strip that sits under the thing it is about.
// Not a banner: a banner is an event that just happened and times out, this is
// a condition the row underneath it is still in (a bid number already in use,
// a crew member the settings no longer have).
function inlineWarn(text) {
  const d = document.createElement('div');
  d.className = 'inline-warn';
  d.textContent = text;
  return d;
}

// caption(text) -> the muted line under the thing it explains: what a number
// means, what a list is measured in, what a card is for. Unlike emptyNote it
// sits beside real content rather than standing in for missing content.
function caption(text) {
  const p = document.createElement('p');
  p.className = 'caption';
  p.textContent = text;
  return p;
}

// The yellow line a task with days on it and nobody on it gets. Two screens
// say it: the Labor screen on the card itself (where the fix is one tap away)
// and the Costs & price screen on the labor line (where the missing hours are
// about to be priced). Same sentence in both, because it is one condition, not
// two — and it names what it costs, because "nobody on this task" alone reads
// like a note rather than a number that is wrong.
const CREWLESS_TASK_WARN = 'Nobody on this task. Its days bill truck and gas but no hours.';

// The same thing said about a list of them, for the screen that is looking at
// the bid rather than at one card.
function crewlessTaskWarnText(tasks) {
  const names = tasks.map((t) => (t && t.name) || 'Task');
  if (names.length === 1) return 'Nobody on ' + names[0] + '. Its days bill truck and gas but no hours.';
  return 'Nobody on these tasks: ' + names.join(', ') + '. Their days bill truck and gas but no hours.';
}

// chip(text, selected, onTap) -> a pill-shaped toggle (detail level, job type,
// crew members). Selected chips fill with the accent color.
function chip(text, selected, onTap) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip' + (selected ? ' chip-selected' : '');
  btn.textContent = text;
  btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (onTap) btn.addEventListener('click', onTap);
  return btn;
}

// fieldLabel(text) -> the small heading over a form control. Not a caption:
// a caption explains, this one names the thing directly underneath it.
function fieldLabel(text) {
  const d = document.createElement('div');
  d.className = 'field-label';
  d.textContent = text;
  return d;
}

// A row of big toggle buttons — the replacement for every <select> this app
// doesn't have. options: [[value, label], ...]
function toggleRow(options, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'toggle-row';
  options.forEach(([value, label]) => {
    const btn = chip(label, current === value, () => onPick(value));
    btn.classList.add('chip-lg');
    wrap.appendChild(btn);
  });
  return wrap;
}

// How much of the price the customer is shown. Set on the bid screen when the
// bid is created and again on the proposal screen with the document in front
// of him, so the labels live here rather than in either screen: the same three
// words in both places, or he will think they are two different settings.
const DETAIL_OPTIONS = [['full', 'Full'], ['summary', 'Summary'], ['scope', 'Scope & price']];

// One line under those three buttons saying what each one actually puts on the
// customer's paper. Three words on a pill is not an explanation — he picked
// "Scope & price" for a plant that wanted line items because nothing on the
// screen said the line items were the thing it takes away.
const DETAIL_CAPTIONS = {
  full: 'Every line and your hourly rate print.',
  summary: 'Three totals and the scope.',
  scope: 'One price and the scope.',
};

function detailCaption(level) { return DETAIL_CAPTIONS[level] || ''; }

// The handful of dollars nobody itemizes and everybody spends. ONE name for
// it: the walk called it this and the Costs & price screen called the same
// number "Misc hardware", which is how one line reads as two things.
//
// The string itself is Store's, not this file's — Store.newBid stamps it onto
// bid.misc.label on every new bid and storage.js loads before ui.js and cannot
// read it back the other way. So it is defined there and re-exported here,
// which is what the screens already reach for. The label is his to edit; this
// is only the fallback for a bid that has none.
const MISC_LABEL = Store.MISC_LABEL;

// crewDaysText(crew, days, hours) -> '2 guys × 3 days = 48 hrs'
//
// The sentence he already says out loud, which the Labor screen never showed
// him: the crew and the days are two rows he fills in and the hours were only
// ever in a readout below the fold. Pure text — the hours come in already
// worked out by BidMath.lineHours, so this can never quote a number the price
// is not built on.
function crewDaysText(crew, days, hours) {
  const one = (n, single, plural) => numText(n) + ' ' + (n === 1 ? single : plural);
  return one(crew, 'guy', 'guys') + ' × ' + one(days, 'day', 'days') + ' = ' + one(hours, 'hr', 'hrs');
}

// statusPill(status) -> the bid's state as a colored pill. Unknown values
// still render (as themselves, in the neutral style) rather than disappearing.
const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', won: 'Won', lost: 'Lost', complete: 'Complete' };

function statusPill(status) {
  const span = document.createElement('span');
  const known = Object.prototype.hasOwnProperty.call(STATUS_LABELS, status);
  span.className = 'pill' + (known ? ' pill-' + status : '');
  span.textContent = known ? STATUS_LABELS[status] : String(status || '');
  return span;
}

// Why a bid went away. The bid screen asks the question and the Reports
// screen counts the answers, so the four words live here rather than in
// either of them. The keys are Store's LOST_REASON enum.
const LOST_REASONS = [
  ['price', 'Price'],
  ['timing', 'Timing'],
  ['other', 'Went another way'],
  ['silence', 'Never heard back'],
];

function lostReasonLabel(key) {
  const hit = LOST_REASONS.find(([k]) => k === key);
  return hit ? hit[1] : 'No reason given';
}

// How far under the starting margin still counts as on track. Rounding and a
// couple of small surprises should not turn a card red on a job that is fine.
// The job screen colors one job by this and Reports colors a list of them, and
// two answers to "is this job still the job he sold" would be one too many.
const MARGIN_SLACK_PCT = 2;

function marginOnTrack(startPct, nowPct) { return nowPct >= startPct - MARGIN_SLACK_PCT; }

// barMeter(pct) -> the thin fill bar. Past 100% it turns red and STOPS: the
// bar is full, and the line underneath it says by how much. The only chart
// this app has, and it is four lines of CSS rather than a library.
function barMeter(pct) {
  const track = document.createElement('div');
  track.className = 'bar';
  const fill = document.createElement('div');
  const v = (typeof pct === 'number' && isFinite(pct)) ? pct : 0;
  fill.className = 'bar-fill' + (v > 100 ? ' bar-over' : '');
  fill.style.width = Math.min(100, Math.max(0, v)) + '%';
  track.appendChild(fill);
  return track;
}

// ---------------------------------------------------------------------------
// The catalog's and the library's own vocabulary
// ---------------------------------------------------------------------------
// Three lists that two screens each read from. The walk offers the category
// tiles and Settings edits the parts inside them; the walk names a new part's
// unit and Settings renames it; the proposal groups the clause library and
// Settings adds to it. Written once here rather than once per screen, because
// two copies is how "Boxes & fittings" becomes "Boxes" on one of them and the
// same part looks like two different parts.
//
// The keys are Store's enums (CATALOG_CATEGORY, CLAUSE_GROUP) and must stay in
// step with them; the labels are his words and are only ever on screen.

const CATALOG_CATEGORIES = [
  ['conduit', 'Conduit'],
  ['wire', 'Wire'],
  ['boxes', 'Boxes & fittings'],
  ['lighting', 'Lighting'],
  ['gear', 'Gear & parts'],
  ['rentals', 'Rentals/Equipment'],
];

const CATALOG_UNITS = ['ft', 'ea', 'roll', 'lot', 'day', 'box', 'case'];

// The catalog's units are abbreviations because they have to fit on a row. The
// KEYPAD is not a row: it is one question filling a phone, and "How many ft?"
// with no part named is the question he answers wrong when three parts in a row
// look the same. So the panels ask in words — his words — and these three maps
// are the whole of the translation.
//
// 'ea' is deliberately missing from both. "how many each?" and "cost per each"
// are not English; the caller falls back to "how many?" and "cost each", which
// is what he would say out loud.
const UNIT_MANY = { ft: 'feet', roll: 'rolls', lot: 'lots', day: 'days', box: 'boxes', case: 'cases' };
const UNIT_ONE = { ft: 'foot', roll: 'roll', lot: 'lot', day: 'day', box: 'box', case: 'case' };
// What a COUNT of them is called on a line: '12 ft', '2 rolls'. Feet and each
// are already what he says at any number.
const UNIT_PLURAL = { roll: 'rolls', lot: 'lots', day: 'days', box: 'boxes', case: 'cases' };

// '3/4" EMT, how many feet?'
function partQtyLabel(name, unit) {
  const w = UNIT_MANY[unit];
  return w ? name + ', how many ' + w + '?' : name + ', how many?';
}

// '3/4" EMT, cost per foot'
function partCostLabel(name, unit) {
  const w = UNIT_ONE[unit];
  return w ? name + ', cost per ' + w : name + ', cost each';
}

// '2 rolls at $185.00' — one unit, plural when there is more than one of it,
// and the price said once. It used to read '2 roll · $185.00 each', which is
// two things wrong in six words: a plural that isn't, and an "each" that made
// the unit price look like the line total.
function itemCountText(qty, unit, costCents) {
  const plural = (qty === 1 ? unit : (UNIT_PLURAL[unit] || unit));
  return numText(qty) + ' ' + plural + ' at ' + BidMath.fmt(costCents);
}

// ' per foot' or ' each': the tail of every sentence that names a unit price.
function perUnitText(unit) {
  const w = UNIT_ONE[unit];
  return w ? ' per ' + w : ' each';
}

// '#12 wire, bill price per foot' — the second price, asked the way the cost is.
function partBillLabel(name, unit) {
  return name + ', bill price' + perUnitText(unit);
}

// '#12 wire, all 500 feet together' — one number for the whole line. A count
// of one has nothing to gather ("all 1 lot together" reads like a bug), so it
// says what it is: the whole line.
function partLotLabel(name, qty, unit) {
  if (qty === 1) return name + ', the whole line';
  const w = UNIT_MANY[unit];
  return name + ', all ' + numText(qty) + (w ? ' ' + w : '') + ' together';
}

// What a walk row says under its cost when the line carries a list price or
// a lot: the marked-up unit for a list price, the whole amount for a lot.
// Empty when neither is set, so a row on an old bid reads exactly as it
// always has. BidMath.itemPrice does the arithmetic; this only chooses the
// sentence, and it asks the RESULT whether the line is a lot (no unit came
// back) rather than the field, so it can never disagree with the paper.
function itemBillText(it, markupPct) {
  const p = BidMath.itemPrice(it, markupPct);
  if (p.unit == null) return 'bills ' + BidMath.fmt(p.cents) + ' the lot';
  if (it.listCents == null) return '';
  return 'bills at ' + BidMath.fmt(p.unit) + perUnitText(it.unit);
}

// Order matters: what goes on everything, then the three kinds of job that
// carry their own risk, then subs. A clause whose group is not named here is
// still shown by both screens, under "Other" — a clause that is invisible is a
// clause he thinks is on the document when it isn't.
const CLAUSE_GROUPS = [
  ['always', 'Always'],
  // The subcontract language, kept verbatim and kept apart. It is the right
  // paper under a general contractor and the wrong paper in front of a plant
  // manager, so it is never seeded and never pre-ticked: he turns it on for
  // the jobs where he is the sub.
  ['gc', 'Under a general contractor'],
  ['trench', 'Trenching & underground'],
  ['site', 'Site & pavement'],
  ['hazmat', 'Hazardous waste'],
  ['subs', 'Subcontractors'],
];

function catalogCategoryLabel(key) {
  const hit = CATALOG_CATEGORIES.find(([k]) => k === key);
  return hit ? hit[1] : key;
}

// ---------------------------------------------------------------------------
// Rentals and owned equipment
// ---------------------------------------------------------------------------
// Two screens reach for a lift. The walk only remembers it exists — standing
// under the high bays is when he knows he needs one — and the Costs & price
// screen is where the number goes on it. What they SHARE is how a rental gets
// named and how a tool gets picked, so those two steps live here and neither
// screen owns a private copy: a rental named on the walk and a rental named on
// the price screen offer the same chips, in the same order, and land on a line
// of the same shape.
//
// Everything comes in as an argument (the catalog, the equipment list, the
// percentage) — nothing here reads app state.

// The rentals the catalog already knows about. They are deliberately kept out
// of the material lists — a boom lift priced as a material line would take
// material markup and be counted in the material total — so the name prompt is
// the one place they are reachable, and reaching them here is on purpose.
// Alphabetical in practice: nothing ever records a use against a rental, so
// the use-count key Catalog.matches sorts on first is zero for all of them.
function rentalNames(catalog) {
  return Catalog.matches(catalog, { category: 'rentals', includeRentals: true }).map((p) => p.name);
}

// promptRentalName(catalog, prefill, done) — the naming step, chips and all.
// done(name) fires with a non-empty name; Cancel, or a name typed back to
// nothing, calls nothing at all. What happens next is the caller's business:
// the walk writes a $0 placeholder, the price screen goes on to ask days and
// dollars.
function promptRentalName(catalog, prefill, done) {
  promptText(prefill || '', {
    label: 'Rental',
    placeholder: 'What you are renting',
    suggestions: rentalNames(catalog),
    done: (name) => { if (name) done(name); },
  });
}

// What one piece of his own equipment bills at per day: the override he typed
// in Settings, or equipmentPct of what it cost new, rounded to the nearest $5
// with a $5 minimum (BidMath.equipmentDayRate), so a cheap tool never derives
// $0.00 a day. null when the tool has no cost on it yet — the caller asks him
// for one rather than quietly billing $0.
function equipmentDayCents(equip, equipmentPct) {
  if (equip.overrideDayCents != null) return equip.overrideDayCents;
  return BidMath.equipmentDayRate(equip.costCents, equipmentPct);
}

// The tool picker, with each tool's day rate on its chip so the pick is made
// on the number rather than on the name. Hidden tools are gone from Settings
// and are not offered. Only what happens AFTER a pick differs between the two
// screens, so that is the caller's callback; the caller appends its own Cancel
// (and, on the price screen, + New tool) underneath.
function equipmentPickerCard(title, equipment, equipmentPct, onPick) {
  const box = card(title);
  const list = equipment.filter((e) => e.hidden === false);
  if (list.length === 0) {
    box.appendChild(emptyNote('No equipment in Settings yet.'));
    return box;
  }
  const chips = document.createElement('div');
  chips.className = 'equip-chips';
  list.forEach((e) => {
    const rate = equipmentDayCents(e, equipmentPct);
    // A tool with no cost on it yet is SAID to have none. A bare name next to
    // six priced ones reads as a tool the app forgot to price, and the answer
    // to that looks like adding a second one under the same name — which is
    // exactly how this list grew two "Bender" rows. Tapping it is still the
    // right move: the price screen asks what it cost new before it asks for
    // days, so the chip leads to the missing number instead of a $0 line.
    chips.appendChild(chip(rate == null ? e.name + ' · no cost yet' : e.name + ' · ' + moneyText(rate) + '/day', false, () => onPick(e)));
  });
  box.appendChild(chips);
  return box;
}

// ---------------------------------------------------------------------------
// CHECKING A PRICE
// ---------------------------------------------------------------------------
// He asked where material prices come from. The honest answer is his supply
// house's own account app, which knows HIS price; nothing public knows it. So
// this is a shortcut, not a data source: the name of the part, dropped into
// whatever search he already uses, opened in another tab so the keypad he was
// typing into is still there when he comes back.
//
// The template is a string with {q} in it. Google Shopping is the default
// because it needs no account, and Settings > Company can hold his supply
// house's search link instead. A template with no {q} in it still works — the
// name is appended — because a link pasted off his phone's address bar often
// has the search on the end of it already.

const PRICE_SEARCH_DEFAULT = 'https://www.google.com/search?tbm=shop&q={q}';

function priceSearchUrl(settings, name) {
  const co = settings && settings.company;
  const raw = co && typeof co.priceSearchUrl === 'string' ? co.priceSearchUrl.trim() : '';
  const template = raw || PRICE_SEARCH_DEFAULT;
  const q = encodeURIComponent(String(name == null ? '' : name).trim());
  return template.indexOf('{q}') === -1 ? template + q : template.split('{q}').join(q);
}

// Opens it, or says why it did not. A plant with no signal is the normal
// condition in this app, and a new tab that lands on the browser's own "no
// internet" page is a tab he then has to find his way back out of. Nothing
// here blocks anything: the price he was typing is still the price he types.
function openPriceSearch(settings, name) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showBanner('No signal, so no price to look up. Type what you know.');
    return false;
  }
  try { window.open(priceSearchUrl(settings, name), '_blank', 'noopener'); }
  catch (e) { showBanner('Could not open the search.'); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Navigation arguments
// ---------------------------------------------------------------------------

// The Walk and Labor screens edit two different things with the same controls:
// the bid itself, or one change order inside its job. Both are reached with
// show(key, arg), where arg is either a bid id — the plain form every other
// screen uses — or { bidId, changeOrderId }. This is the one place that shape
// is read, so the two screens can never disagree about what they were handed.
// undefined ("coming back, keep what's on the glass") is the caller's to
// notice before it gets here; everything else comes back normalized.
function navTarget(arg) {
  if (arg && typeof arg === 'object') {
    return {
      bidId: typeof arg.bidId === 'string' && arg.bidId ? arg.bidId : null,
      changeOrderId: typeof arg.changeOrderId === 'string' && arg.changeOrderId ? arg.changeOrderId : null,
    };
  }
  return { bidId: typeof arg === 'string' && arg ? arg : null, changeOrderId: null };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// The rules themselves live in dates.js, where they are pure and tested. These
// two are the browser's shorthand for them: everything on screen shares one
// idea of what day it is, and it comes from Store.todayISO() (local, not UTC)
// so it agrees with the dates already stored.

function fmtDate(iso) { return Dates.fmtDate(iso); }

// '9/4/26'. The home list's rows only — see dates.js for why they are the one
// place that cannot afford the long form.
function fmtDateShort(iso) { return Dates.fmtDateShort(iso); }

// Epoch milliseconds — a saved PDF's stamp — as 'Sep 4, 2026, 1:59 am'.
function fmtDateTime(ms) { return Dates.fmtDateTime(ms); }

function daysSince(iso) { return Dates.daysSince(iso, Store.todayISO()); }

// ---------------------------------------------------------------------------
// Reading a bid
// ---------------------------------------------------------------------------
// Both take the whole document rather than reading a global, so they stay
// honest about what they depend on. The bids list and the bid screen both
// print these two things and must never disagree about either.

// The customer name as the owner knows it. An orphaned customerId reads
// "Customer" — the same placeholder the printed document uses — rather than
// leaving a blank line with nothing to recognize.
function bidCustomerName(bid, data) {
  const c = data.customers.find((x) => x.id === bid.customerId);
  return (c && c.name && c.name.trim()) || 'Customer';
}

// Every photo a bid owns — its own areas plus any change-order areas. The home
// list deletes them with the bid and Settings exports them for one bid at a
// time, so the definition of "this bid's photos" lives here rather than once
// per screen.
function bidPhotoIds(bid) {
  const areas = (bid.areas || []).slice();
  const cos = (bid.job && bid.job.changeOrders) || [];
  cos.forEach((co) => { (co.areas || []).forEach((a) => areas.push(a)); });
  return areas.reduce((ids, a) => ids.concat(a.photoIds || []), []);
}

// Every PDF this bid has ever produced is stored under this prefix, with the
// millisecond it was made after it. Three screens need to recognize one - the
// proposal lists them, the home list deletes them with the bid, Settings sends
// the new ones off with a backup — so the shape is written once.
function bidPdfPrefix(bidId) { return 'pdf-' + bidId + '-'; }

// Splits a stored PDF id back into the bid it belongs to and when it was made.
// The bid id is a UUID and has its own dashes in it, so the timestamp is taken
// from the LAST dash, never the first. null for anything that isn't one.
function bidPdfParse(id) {
  if (typeof id !== 'string' || id.indexOf('pdf-') !== 0) return null;
  const cut = id.lastIndexOf('-');
  if (cut <= 3) return null;
  const at = Number(id.slice(cut + 1));
  if (!isFinite(at) || at <= 0) return null;
  const bidId = id.slice(4, cut);
  return bidId ? { id, bidId, at } : null;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
// Which PDFs ride along with a backup, and what day a backup file was made on.
// All of these are pure and take everything they need as arguments: Settings
// draws the Send button off them, and the restore confirm names a date off
// them, and getting either one wrong is silent — a PDF that never leaves the
// phone, or a confirm that names the wrong week's file.

// The day a backup file was made, read off its own name. The name is the
// FIRST answer to "from when?", not the fallback: settings.lastBackupAt inside
// a backup is written AFTER the file is built, so it carries the date of the
// backup BEFORE this one. The name carries this one's. A file the phone
// renamed on the way in ("…(1).json") still has the date in it; anything with
// no date in it at all comes back null and the caller says so.
function backupDateFromName(name) {
  const hit = /(\d{4}-\d{2}-\d{2})/.exec(String(name || ''));
  return hit ? hit[1] : null;
}

// The date the home band shows AFTER a restore.
//
// A restore used to write the file's settings straight to disk, and the file's
// own lastBackupAt can be null — the first backup a phone ever makes is built
// before that field is stamped. Restore that file and the home screen says "No
// backup yet" in red, on a phone whose entire contents just came out of a
// backup. He does the only thing that sentence asks for: another backup, to
// answer a warning that was never true.
//
// So it is never null coming out of here. The file's own date first, because
// that is the phone's own history and it is what he would have seen had he
// never restored. Then the file NAME, which carries the day the file was
// written. Then today, which is the weakest of the three and still true in the
// way that matters: the file in his hand IS a backup, and it exists.
//
// pdfsSentThroughMs is the other half and needs no help — the file's value
// rides along untouched, so the PDFs that had already gone stay gone and are
// not re-queued by a restore.
function restoredBackupDate(doc, fileName, todayISO) {
  const s = (doc && doc.settings) || {};
  const own = typeof s.lastBackupAt === 'string' && s.lastBackupAt ? s.lastBackupAt : null;
  return own || backupDateFromName(fileName) || todayISO;
}

// What has not left the phone yet.
//
// The watermark is settings.pdfsSentThroughMs: the archive stamp of the newest
// PDF that has actually gone. Null means none ever has, so everything is
// pending. Strictly greater than, not on-or-after: the PDF the watermark names
// is the one that went, and re-sending it every time is the bug that reading
// this off a DAY used to cause.
//
// This is deliberately not settings.lastBackupAt. That one answers "when did
// he last back up" for the home band, and it moves whenever the JSON leaves
// whether the PDFs did or not. Two questions, two fields.
function pendingPdfs(entries, sentThroughMs) {
  const through = (typeof sentThroughMs === 'number' && isFinite(sentThroughMs)) ? sentThroughMs : null;
  return (entries || [])
    .filter((e) => e && typeof e.at === 'number' && isFinite(e.at))
    .filter((e) => through === null || e.at > through)
    .sort((a, b) => a.at - b.at);
}

// backupSelection(entries, sentThroughMs, cap)
//   -> { send, nextSentThroughMs, truncated }
//
// entries are bidPdfParse results. What GOES is the OLDEST cap of what is
// pending, not the newest. Newest-first was the bug: the cap took the newest
// 25, the watermark then jumped past everything, and every older PDF behind
// the cap was pending no longer and never went anywhere. Oldest-first drains
// the backlog instead, a share sheet at a time.
//
// nextSentThroughMs is where the watermark lands IF this whole set leaves: the
// stamp of the newest one that actually fits under the cap, so the ones left
// behind are still pending next time. Nothing sent, nothing moved.
function backupSelection(entries, sentThroughMs, cap) {
  const limit = (typeof cap === 'number' && isFinite(cap) && cap > 0) ? Math.floor(cap) : 0;
  const pending = pendingPdfs(entries, sentThroughMs);
  const send = pending.slice(0, limit);
  const prev = (typeof sentThroughMs === 'number' && isFinite(sentThroughMs)) ? sentThroughMs : null;
  return { send, nextSentThroughMs: send.length ? send[send.length - 1].at : prev, truncated: pending.length - send.length };
}

// One @, with something on both sides of it. Not a check that the mailbox
// exists — nothing on this phone can know that — but a field meant for an
// address gets filled in with a name ("andy") or half of one often enough, and
// an address that isn't one is a Copy button that pastes garbage into a To:
// line. Both places that take an email address use this one.
function isEmailAddress(value) {
  const text = String(value);
  // No whitespace anywhere. An address with a space in it is not one, and it
  // used to get through: "andy smith@cox.net" has one @ with something either
  // side of it, and the Copy button then pastes a broken To: line that Mail
  // silently refuses. Checked before the split so a space anywhere counts.
  if (/\s/.test(text)) return false;
  const parts = text.split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '';
}

// A bid that can't price itself must not take the whole list down with it, so
// this is the one place the DocModel call is wrapped. The log fires once per
// session: a broken bid would otherwise print on every keystroke in the
// search field.
let bidPriceErrorLogged = false;

// The price the owner would see on the proposal, change orders included — the
// same number DocModel prints, not a second opinion.
function bidPriceText(bid, data) {
  try {
    return BidMath.fmt(DocModel.build(bid, data, bid.detail).totalCents);
  } catch (err) {
    if (!bidPriceErrorLogged) {
      bidPriceErrorLogged = true;
      console.error('Could not price a bid', err);
    }
    return '—';
  }
}

// areaNoteLine(notes) -> one line of a walk note, or ''.
//
// area.notes is optional and is whatever he dictated standing in the room: a
// paragraph, three lines, or nothing. Two places show a glance at it — the
// area card on the walk and the Notes row inside the area — and neither has
// room for a paragraph, so both get ONE line of it, cut at 60 characters.
// Absent, blank, or all whitespace all come back as '', which every caller
// reads as "no note yet".
//
// The lines are JOINED with " · " before the cut rather than thrown away.
// Taking only the first line meant a three-line note previewed as a short
// line with no ellipsis on it, which reads as the whole note: the two lines
// he dictated underneath were invisible and nothing on the glass said they
// were there. The separator is the one this app already puts between two
// facts on one line, and the ellipsis now fires whenever there is more note
// than there is line.
//
// It NEVER reaches the customer's paper. docmodel.js does not read the field
// at all: these are his notes about a room, not a description of the work.
const AREA_NOTE_PREVIEW_MAX = 60;
function areaNoteLine(notes, max) {
  const joined = String(notes == null ? '' : notes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ');
  if (!joined) return '';
  const cap = (typeof max === 'number' && max > 1) ? max : AREA_NOTE_PREVIEW_MAX;
  return joined.length <= cap ? joined : joined.slice(0, cap - 1).replace(/\s+$/, '') + '…';
}

// areaTallyText(area) -> "3 items · $412.00"
//
// What he has counted in this room so far, at cost. It sits at the top of the
// add-item list, where it is the only proof an add landed now that adding one
// no longer throws him back to the area. The money goes through
// BidMath.materialCost, the same primitive the area footer and the Price
// screen use, so the running total and the area cost can never disagree.
function areaTallyText(area) {
  const items = (area && area.items) || [];
  const n = items.length;
  return n + ' ' + (n === 1 ? 'item' : 'items') + ' · ' + BidMath.fmt(BidMath.materialCost({ areas: [area || {}] }));
}

// ---------------------------------------------------------------------------
// UNPRICED LINES
// ---------------------------------------------------------------------------
// A line that will print at $0.00 on the customer's page. He walks a plant
// counting things and prices them afterwards, so a bid legitimately holds
// half-priced lines for a while — but the moment a PDF is made, every one of
// them is a number he is giving away. The screens paint these amber and the
// proposal refuses to build until they are gone.
//
// "Unpriced" is decided by what will PRINT, not by what it cost: an item with
// a typed price override of $50 and no cost on the invoice yet is priced, and
// a $0 override is not.

const UNPRICED_WARN_TEXT = 'No price on this yet. Tap it to put a price on it.';
// The same warning, said the second time. A card with six unpriced items in it
// printed the same fourteen words six times, which is not six warnings, it is a
// wall of amber he stops reading. The first one teaches; the rest only have to
// mark.
const UNPRICED_WARN_SHORT = 'No price yet';

function unpricedWarn() { return inlineWarn(UNPRICED_WARN_TEXT); }

// unpricedWarns() -> a warn-maker for ONE card. The first line it is asked for
// gets the sentence, every line after it in that card gets the short form.
// A fresh one per card, so the sentence appears once wherever he is looking.
function unpricedWarns() {
  let first = true;
  return () => {
    const node = inlineWarn(first ? UNPRICED_WARN_TEXT : UNPRICED_WARN_SHORT);
    first = false;
    return node;
  };
}

// Every line on this bid that would print at nothing, in the order he would
// find them: areas top to bottom, then rentals, then equipment, then change
// orders. Each entry is { kind, name } — the name is what the banner puts in
// quotes, so it is the words he gave the line, never an id.
//
// Misc is deliberately NOT here. A misc of $0 does not print at all (docmodel
// only pushes the row when it has money in it), so it is not a $0 line on the
// customer's page and must not stand between him and a PDF. The walk still
// paints it amber, where it is a nudge and not a gate.
//
// A change order with nothing on it is skipped for the same reason: it does
// not print either.
//
// Labor is the exception to "every entry is a line": see the tail of the
// function. It has no row to tap, and it is the last thing checked.
function unpricedLines(bid, settings) {
  const out = [];
  const markup = BidMath.resolveMarkup(bid, settings);

  (bid.areas || []).forEach((a) => {
    (a.items || []).forEach((it) => {
      if (!(BidMath.itemPrice(it, markup).cents > 0)) {
        out.push({ kind: 'item', name: it.name || 'this item', area: a.name || '', areaId: a.id });
      }
    });
  });
  (bid.rentals || []).forEach((x) => {
    if (!(BidMath.rentalPrice(x, markup) > 0)) out.push({ kind: 'rental', name: x.name || 'this rental' });
  });
  (bid.equipment || []).forEach((x) => {
    if (!(BidMath.equipmentLine(x) > 0)) out.push({ kind: 'equipment', name: x.name || 'this equipment' });
  });
  let coCents = 0;
  ((bid.job && bid.job.changeOrders) || []).forEach((co) => {
    if (BidMath.changeOrderIsEmpty(co)) return;
    const cents = BidMath.changeOrderPrice(co, bid, settings);
    coCents += cents;
    if (!(cents > 0)) out.push({ kind: 'changeOrder', name: co.name || 'this change order', id: co.id });
  });

  // The whole bid, last. Everything above is a line he can tap; this is the
  // number at the bottom of the page, and it was the one thing that could reach
  // a customer at $0.00 with nothing on screen saying so.
  //
  // It is the BUILT TOTAL, not the labor row. Parts-only bids are real — a
  // breaker handed over with no days logged has a price and must still share —
  // so the gate is only ever "this page adds up to nothing". Hours at a $0 rate
  // is the case the first version of this check missed: it asked whether there
  // were hours, and a bid with three days on it at no rate an hour has hours
  // and still totals zero.
  const stack = BidMath.costStack(bid, settings);
  const rate = (bid.pricing && bid.pricing.rateCents) || 0;
  if (BidMath.solve(stack, 'rate', rate).priceCents + coCents <= 0) {
    // No name: there is no row to point at. unpricedBlockText says the number
    // instead, and a banner that can be tapped must not offer to take him to a
    // "Labor" line that does not exist anywhere on the bid.
    out.push({ kind: 'total', name: '' });
  }
  return out;
}

// The banner that stands between an unpriced line and a PDF. Names the first
// one: a count ("3 lines have no price") sends him hunting, a name sends him
// to the line.
//
// The whole-bid gate is the exception, because there is no line to name and
// "put a price on Labor" points at a row that does not exist. It says the
// number instead, which is the fact he needs.
function unpricedBlockText(lines) {
  if (lines[0].kind === 'total') return 'This bid totals $0.00. Put a price on it first.';
  return 'Put a price on "' + lines[0].name + '" first.';
}

// Where that line actually is, as a show() call: { screen, arg }.
//
// The banner names the line and then left him standing on the proposal screen
// to go find it. It is one tap from being the fastest route on the bid, and the
// mapping is the only thing that was missing — an item is counted on the walk,
// a rental and a piece of equipment are priced on the price screen, a change
// order is scoped in its own walk inside the job, and the whole-bid total is
// the price screen's handles.
//
// An item goes one better than the screen: it names the AREA it was counted
// in, so the tap lands inside that room rather than on the list of rooms with
// the hunt still to do. unpricedLines carries the area id for exactly this.
function unpricedTarget(line, bid) {
  const bidId = bid && bid.id;
  if (!line) return null;
  if (line.kind === 'item') {
    return line.areaId
      ? { screen: 'walk', arg: { bidId, areaId: line.areaId } }
      : { screen: 'walk', arg: bidId };
  }
  if (line.kind === 'changeOrder' && line.id) {
    return { screen: 'walk', arg: { bidId, changeOrderId: line.id } };
  }
  return { screen: 'price', arg: bidId };
}
