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
