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

const CATALOG_UNITS = ['ft', 'ea', 'roll', 'lot', 'day'];

// Order matters: what goes on everything, then the three kinds of job that
// carry their own risk, then subs. A clause whose group is not named here is
// still shown by both screens, under "Other" — a clause that is invisible is a
// clause he thinks is on the document when it isn't.
const CLAUSE_GROUPS = [
  ['always', 'Always'],
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
  const parts = String(value).split('@');
  return parts.length === 2 && parts[0].trim() !== '' && parts[1].trim() !== '';
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
