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

// row(label, value, onTap) -> a label/value line. With onTap it is a real
// button (56px tall, the whole line is the target — no tiny pencil icons);
// without one it is inert text.
function row(label, value, onTap) {
  const node = document.createElement(onTap ? 'button' : 'div');
  node.className = 'row' + (onTap ? ' row-tap' : '');
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

  node.appendChild(l);
  node.appendChild(v);
  return node;
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
// (BidMath.equipmentDayRate). null when the tool has no cost on it yet — the
// caller asks him for one rather than quietly billing $0.
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
    chips.appendChild(chip(rate == null ? e.name : e.name + ' · ' + moneyText(rate) + '/day', false, () => onPick(e)));
  });
  box.appendChild(chips);
  return box;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// The rules themselves live in dates.js, where they are pure and tested. These
// two are the browser's shorthand for them: everything on screen shares one
// idea of what day it is, and it comes from Store.todayISO() (local, not UTC)
// so it agrees with the dates already stored.

function fmtDate(iso) { return Dates.fmtDate(iso); }

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
