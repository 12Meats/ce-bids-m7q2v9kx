'use strict';
// screens/billreview.js — the last look before anything is numbered.
//
// This is the second of the three moments the Invoices tab is built around,
// and it is the one that costs money to get wrong: an invoice number is spent
// the moment it is taken and a numbered invoice is never deleted. So nothing
// on this screen is on disk. The groups he checked on the home come in, one
// draft invoice is built off each of them, and he can combine two weeks of the
// same job into the one invoice he used to write by hand, split a week back
// into its days, or open a draft and change what it bills. Only the pinned
// button writes, and it writes every invoice in ONE save.
//
// Sections: STATE · THE SENTENCES · THE CARDS · COMBINE AND SPLIT · SEND

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

// The groups this screen is working on. Rebuilt on enter() from the pile, and
// changed after that only by Combine and Split.
let reviewGroups = null;

function reviewData() { return state.data; }

// The pile as he left it on the home: pileSelection remembers what he turned
// OFF, so everything else is in. It lives in picker.js because both screens
// read it and a screen may never call another screen's file.
function reviewExclude() {
  const exclude = new Set();
  (reviewData().logs || []).forEach((e) => {
    if (!e.invoiceId && !pileSelection.isOn(e.id)) exclude.add(e.id);
  });
  return exclude;
}

// The drafts, one per group, in the same order. Rebuilt whenever the groups
// change — a Combine or a Split makes different invoices out of the same
// hours, and a draft carried across would be an invoice for a group that no
// longer exists. They are kept in the shared store rather than here because
// the invoice screen opens one to edit it before it is numbered.
function reviewBuildDrafts() {
  const d = reviewData();
  const now = Date.now();
  reviewDrafts.set((reviewGroups || []).map((g) => InvMath.draftInvoice(g, d, now)));
}

// WHAT THE DRAFTS WERE BUILT FROM, as one string.
//
// The drafts on hand are kept across a trip into an invoice and back, so
// Combine, Split and every billed hour he changed survive it. They may only be
// kept while they are still TRUE, and the ids of the entries under them do not
// answer that: he can open a visit from the pile, correct eight hours to four
// or move it to the Friday, and come back to a review still holding the old
// draft — which would then bill the old hours under a real invoice number.
//
// So the key is a fingerprint of the CONTENT: who the visit was for, the job,
// the day, every man's hours, and every line on it. Anything that would make a
// different invoice makes a different key, and a different key is rebuilt.
function reviewLineStamp(x) {
  // items count a qty, rentals and equipment count days; items carry a cost,
  // a rental carries the whole hire, a tool carries its day rate. One line
  // reads all three shapes, because what is being compared is "is this the
  // same line as before", not "what is this line worth".
  const count = x.qty === undefined ? x.days : x.qty;
  const money = x.costCents === undefined ? (x.cents === undefined ? x.dayCents : x.cents) : x.costCents;
  return [x.name, count, money, x.lotCents, x.listCents].join(':');
}
function reviewEntryStamp(e) {
  const crew = (e.crew || []).map((m) => m.crewId + '=' + m.hours).join(',');
  const lines = (e.items || []).concat(e.rentals || [], e.equipment || []).map(reviewLineStamp).join(',');
  return [e.id, e.customerId, e.projectId, e.dateISO, crew, lines].join('|');
}
function reviewPileKey() {
  return (reviewData().logs || [])
    .filter((e) => !e.invoiceId && pileSelection.isOn(e.id))
    .map(reviewEntryStamp).sort().join('\n');
}

// The key the drafts on hand were built from. Combine and Split do not touch
// it: they make different invoices out of the same visits, which is exactly
// the work this screen exists for and exactly what must not be thrown away.
let reviewBuiltKey = null;

function enterBillreview() {
  const key = reviewPileKey();
  if (reviewGroups && reviewBuiltKey === key) return;
  reviewGroups = InvMath.group(reviewData().logs || [], reviewData(), Store.mondayOf,
    { exclude: reviewExclude() });
  reviewBuildDrafts();
  reviewBuiltKey = key;
}

// ---------------------------------------------------------------------------
// THE SENTENCES
// ---------------------------------------------------------------------------
// Pinned in tests/invoices.test.js, because they are what he reads before he
// spends four invoice numbers.

function reviewCustomerName(id) {
  const c = (reviewData().customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}

// "Mon Aug 24". The weekday is what tells him which visit this was without
// counting back through the month.
const REVIEW_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function reviewWeekdayText(iso) {
  // Noon, like every other date this app reads, so a DST shift cannot move a
  // Monday onto the Sunday before it.
  const dt = new Date(iso + 'T12:00:00');
  if (isNaN(dt.getTime())) return dayText(iso);
  return REVIEW_WEEKDAYS[dt.getDay()] + ' ' + dayText(iso);
}

// "$85" for a whole-dollar rate, "$85.50" for one that isn't. The rate is the
// one number on this line he knows by heart, and ".00" on it is noise.
function reviewRateText(cents) {
  return cents % 100 === 0 ? '$' + Math.round(cents / 100) : moneyText(cents);
}

// The line under the customer and the job: what it covers, the hours it bills
// and at what, and what the parts come to. Parts are at what they BILL here,
// not at cost: this is the invoice, and the number beside it is the total the
// customer will read. A draft with no parts on it does not say "$0.00 parts".
function reviewCardSub(draft) {
  const t = InvMath.totals(draft);
  // InvMath's, not a reduce of this screen's own: the paper's labor row and
  // the invoice screen count the same hours, and three copies of one sum is
  // three chances for one of them to drift.
  const hours = InvMath.billedHours(draft);
  const span = draft.serviceFrom === draft.serviceTo
    ? dayText(draft.serviceFrom)
    : dayText(draft.serviceFrom) + ' to ' + dayText(draft.serviceTo);
  return span
    + (hours > 0 ? ' · ' + numText(hours) + ' hrs at ' + reviewRateText(draft.rateCents) : '')
    + (t.materials > 0 ? ' · ' + moneyText(t.materials) + ' parts' : '');
}

// One line per visit inside the card: "Mon Aug 24 · Shawn 8, George 5". The
// card is one invoice and this is what is under it, so a week that looks wrong
// can be told apart from a week that looks right without opening it.
function reviewEntryText(e, data) {
  const crew = (e.crew || []).map((m) => {
    const c = ((data.settings.crew || []).find((x) => x.id === m.crewId));
    return (c ? c.name : 'Crew') + ' ' + numText(m.hours);
  }).join(', ');
  const lines = (e.items || []).concat(e.rentals || [], e.equipment || []);
  // One line is worth naming; six are a list nobody reads on a card.
  const linesText = lines.length === 0 ? ''
    : lines.length === 1 ? (lines[0].name || 'One line')
      : lines.length + ' lines';
  return [reviewWeekdayText(e.dateISO), crew, linesText].filter(Boolean).join(' · ');
}

// Nothing is numbered until every draft has something on it. A $0 invoice is
// not a bill, it is a mistake he would have to void, and this app has no
// voiding: the invoice number is spent the moment it is taken.
function reviewCanSend(drafts) {
  const list = drafts || [];
  if (!list.length) return false;
  return list.every((inv) => InvMath.totals(inv).total > 0);
}

const REVIEW_ZERO_TEXT = 'One of these bills nothing. Put hours or a line on it, or uncheck it.';

// ---------------------------------------------------------------------------
// THE CARDS
// ---------------------------------------------------------------------------

function buildReviewCard(host, draft, i) {
  const g = reviewGroups[i];
  const box = card();
  const t = InvMath.totals(draft);

  // The whole head is the way in: tapping the card opens the draft to be
  // edited, which is the only thing there is to do with one besides sending it.
  box.appendChild(lineRow(reviewCustomerName(draft.customerId) + ' · ' + draft.projectTitle,
    reviewCardSub(draft), moneyText(t.total), () => show('invoice', { draft: i })));

  // One muted line per visit, in the shape every other quiet line in the app
  // wears. No class of this screen's own: what is under the card is a note
  // about it, which is what a caption is.
  g.entries.forEach((e) => box.appendChild(caption(reviewEntryText(e, reviewData()))));

  // Combine reaches for the next week of the SAME job, which may not be the
  // next card: another customer's week can sit between two weeks of the job he
  // fell behind on. Split is the other direction, one invoice per visit.
  const canCombine = InvMath.canCombine(reviewGroups, i);
  const canSplit = g.entries.length > 1;
  if (canCombine || canSplit) {
    const nav = document.createElement('div');
    nav.className = 'bid-nav';
    if (canCombine) {
      nav.appendChild(textButton('Combine with the next week', 'btn btn-block', () => reviewCombine(i)));
    }
    if (canSplit) {
      nav.appendChild(textButton('Split', 'btn btn-block', () => reviewSplit(i)));
    }
    box.appendChild(nav);
  }
  if (t.total === 0) box.appendChild(caption(REVIEW_ZERO_TEXT));
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// COMBINE AND SPLIT
// ---------------------------------------------------------------------------
// Both are InvMath's, both hand back a new list in the same oldest-first
// order, and both throw the drafts away and build them again: a draft is an
// invoice for one group, and after this the groups are different.

function reviewCombine(i) {
  reviewGroups = InvMath.combine(reviewGroups, i);
  reviewBuildDrafts();
  render();
}

function reviewSplit(i) {
  reviewGroups = InvMath.split(reviewGroups, i);
  reviewBuildDrafts();
  render();
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

function billreviewSend() {
  const d = reviewData();
  // A file restored from a backup written before this release has no invoices
  // array at all: every new key is optional on disk, and nothing else in the
  // app creates this one. Making it here rather than reading (d.invoices || [])
  // is deliberate — the invoices about to be pushed have to land on the
  // document itself, not on a throwaway copy of a missing array.
  if (!d.invoices) d.invoices = [];
  const drafts = reviewDrafts.get();
  if (!reviewCanSend(drafts)) { showBanner(REVIEW_ZERO_TEXT); render(); return; }
  // Numbered in service-date order, because the groups are already oldest
  // first: his numbers run with the work, not with the order he happened to
  // tap the cards. Every invoice and every lock go to disk in ONE save.
  const made = [];
  const before = { next: d.settings.nextInvoiceNumber, invoices: d.invoices.slice(), locks: [] };
  drafts.forEach((inv) => {
    inv.id = Store.uid();
    inv.number = Store.takeInvoiceNumber(d);
    inv.dateISO = Store.todayISO();
    // Written by the screen after the write, never by invmath's constructors:
    // nothing has been sent yet, so this reads draft.
    inv.status = InvMath.statusOf(inv);
    d.invoices.push(inv);
    inv.logIds.forEach((id) => {
      const e = (d.logs || []).find((x) => x.id === id);
      if (e) { before.locks.push([e, e.invoiceId]); e.invoiceId = inv.id; }
    });
    made.push(inv);
  });
  if (!persistOr(() => {
    d.settings.nextInvoiceNumber = before.next;
    d.invoices = before.invoices;
    before.locks.forEach(([e, v]) => { e.invoiceId = v; });
    // The drafts go back to being drafts, or a second Send would push invoices
    // that already carry a number the disk never took.
    made.forEach((inv) => { inv.id = null; inv.number = null; inv.dateISO = null; });
  })) { render(); return; }

  // The pile is empty now: every entry that was in it is locked to an invoice,
  // and what he turned off is a decision about entries that are still waiting.
  pileSelection.clear();
  // And so is the review. These drafts are invoices on the file now; left
  // standing they would be a second, editable copy of a numbered invoice, and
  // the next Bill these would open holding last Friday's batch.
  reviewGroups = null;
  reviewDrafts.set([]);
  reviewBuiltKey = null;
  // The share sheet needs a tap, so the invoice screen owns sending and they
  // go out one at a time. This lands on the first one with the rest queued
  // behind it, and replaces: the review is finished, and Back from an invoice
  // must not walk into a screen whose drafts have all been numbered.
  show('invoice', { id: made[0].id, queue: made.slice(1).map((x) => x.id) }, { replace: true });
  // AFTER the navigation, not before it: leaving a screen ends whatever
  // sentence was on it, so a banner raised here and then navigated away from
  // is a banner he never sees. This one belongs to the screen he lands on
  // anyway — it says what the invoice in front of him just became.
  showBanner(made.length + (made.length === 1 ? ' invoice numbered.' : ' invoices numbered.'), 'ok');
}

// ---------------------------------------------------------------------------
// RENDER AND REGISTER
// ---------------------------------------------------------------------------

function renderBillreview() {
  const host = el('billreviewContent');
  host.textContent = '';
  const drafts = reviewDrafts.get();
  const n = drafts.length;
  host.appendChild(screenHead(n + (n === 1 ? ' invoice' : ' invoices')));
  if (!n) {
    host.appendChild(emptyNote('Nothing is checked. Go back and tick what you want billed.'));
    return;
  }
  host.appendChild(caption('Nothing is numbered yet. Check each one, then send.'));
  drafts.forEach((draft, i) => buildReviewCard(host, draft, i));
  const ok = reviewCanSend(drafts);
  // The caption sits with the card that is empty, up above; down here the
  // button simply cannot be pressed, and the real disabled attribute is what
  // says so to a thumb and to a screen reader both.
  pinnedBar(host, 'Number and send ' + n + (n === 1 ? ' invoice' : ' invoices'),
    () => { if (ok) billreviewSend(); }, { disabled: !ok });
}

registerScreen('billreview', {
  id: 'screen-billreview', title: 'Bill these', back: 'invoices', tab: 'invoices',
  enter: enterBillreview, render: renderBillreview,
});
