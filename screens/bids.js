'use strict';

// screens/bids.js — the home screen. Four things, in the order the owner's eye
// hits them: the nudge bands (what needs attention), a search field once the
// list is long enough to need one, the bid list, and a New bid button pinned
// above the tab bar so it is always under the thumb.
//
// Every row is built with createElement/textContent — customer names and bid
// titles are free text and never go near innerHTML.

const BIDS_SEARCH_AFTER = 8;  // the search field appears once the list is longer than this
const NUDGE_DAYS = 14;        // "sent, no answer" and "backup is stale" both mean two weeks
const LONG_PRESS_MS = 600;

// Screen-local view state, deliberately not persisted: a filter or a
// half-typed search is about this glance at the list, not about the business.
let bidsFilterSent = false;
let bidsSearch = '';
let bidsMenuId = null;        // the bid showing its Duplicate/Delete row, if any
let bidsListEl = null;        // the live list container, so search can redraw only it
let bidsSuppressTapUntil = 0; // a long press must not also count as a tap

// ---------------------------------------------------------------------------
// Reading a bid
// ---------------------------------------------------------------------------
// bidCustomerName and bidPriceText live in ui.js, and so does bidPhotoIds:
// the bid screen prints the same two things and Settings exports the same
// photos, and none of the three screens may disagree about any of them.

// Newest first — the ordering itself lives in dates.js, where it is tested.
function bidsSorted() {
  return state.data.bids.slice().sort(Dates.bidsSortCompare);
}

// ---------------------------------------------------------------------------
// Nudge bands
// ---------------------------------------------------------------------------

// Sent more than two weeks ago and still sitting there. This is the whole
// reason the app exists: a proposal nobody followed up on is money left on a
// table in a dairy plant.
function bidsSentNoAnswer() {
  return Dates.sentNoAnswer(state.data.bids, Store.todayISO(), NUDGE_DAYS);
}

function nudgeBand(text, kind, onTap) {
  return textButton(text, 'nudge nudge-' + kind, onTap);
}

function buildNudges() {
  const wrap = document.createElement('div');
  wrap.className = 'nudges';

  const stale = bidsSentNoAnswer();
  if (stale.length) {
    const band = nudgeBand(
      `${stale.length} bid${stale.length === 1 ? '' : 's'} sent, no answer. Tap to ${bidsFilterSent ? 'show all' : 'review'}`,
      'warn',
      () => { bidsFilterSent = !bidsFilterSent; render(); }
    );
    if (bidsFilterSent) band.classList.add('nudge-on');
    wrap.appendChild(band);
  } else if (bidsFilterSent) {
    // The last stale bid just got answered — drop the filter rather than
    // leaving the owner staring at an empty list with no band to un-tap.
    bidsFilterSent = false;
  }

  // Two separate ways the work can be lost: a proposal that only exists inside
  // this phone, and a whole app that hasn't been backed up. Both point at the
  // same place, so they share one band and only the parts that apply are said.
  // Sent today and not filed yet isn't a lapse, it's the next thing on the
  // list — a proposal only counts as unfiled once a day has passed.
  const unsaved = state.data.bids.filter((b) => {
    if (!b.sentAt || b.savedToFilesAt) return false;
    const age = daysSince(b.sentAt);
    return age !== null && age >= 1;
  }).length;
  const backupAge = daysSince(state.data.settings.lastBackupAt);
  const parts = [];
  if (unsaved) parts.push(`${unsaved} proposal${unsaved === 1 ? '' : 's'} not saved to Files`);
  // Two different holes, and having one is no reason to stop saying the other:
  // filing a proposal to Files does nothing for a phone that has never been
  // backed up. A fresh install has nothing to back up, though — opening the
  // app for the first time to a warning band teaches him to ignore them.
  if (backupAge === null && state.data.bids.length > 0) parts.push('no backup yet');
  if (backupAge !== null && backupAge > NUDGE_DAYS) parts.push(`last backup ${backupAge} days ago`);
  if (parts.length) {
    // A sentence with somewhere to go, not a breadcrumb. "no backup yet -
    // Settings > Backup" told him where the screen was; what he needed was
    // that the band itself is the way there.
    const said = parts.join(' · ');
    const sentence = said.charAt(0).toUpperCase() + said.slice(1);
    const tail = backupAge === null || backupAge > NUDGE_DAYS
      ? ' Tap here to send one.'
      : ' Tap here to file them.';
    // 'warn', like the band above it. Both bands say the same KIND of thing —
    // something you have not done yet — and this one was full red on the first
    // screen of the app, which is where he learns what red means here.
    wrap.appendChild(nudgeBand(sentence + '.' + tail, 'warn', () => show('settings')));
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function bidsRefreshList() {
  if (bidsListEl && bidsListEl.isConnected) renderBidsList(bidsListEl);
  else render();
}

function bidsToggleMenu(id) {
  bidsMenuId = bidsMenuId === id ? null : id;
  bidsRefreshList();
}

function bidsDuplicate(id) {
  bidsMenuId = null;
  // duplicateBid pushes the copy itself and steps the number counter, so a
  // refused save has to put both back. Leaving the copy in memory would show a
  // row that isn't on disk and won't survive the next launch — and would burn
  // a bid number on a bid that never existed.
  const prevNextNumber = state.data.settings.nextNumber;
  const copy = Store.duplicateBid(state.data, id);
  if (!copy) { showBanner("Couldn't copy that bid", 'danger'); render(); return; }
  if (!persistOr(() => {
    const i = state.data.bids.indexOf(copy);
    if (i !== -1) state.data.bids.splice(i, 1);
    state.data.settings.nextNumber = prevNextNumber;
  })) {
    render();
    return;
  }
  show('bid', copy.id);
}

// Which bids offer Delete at all.
//
// It used to be drafts only, on the reasoning that a sent bid is a record of
// what a customer was told. But he types bids in a truck and mis-types some of
// them, and a wrong number that has been emailed is exactly the one he most
// wants off the list — the app hid the button and said nothing about why, so
// the list filled up with bids he had already decided were dead.
//
// The one thing that really cannot be deleted is WORK. A won or complete bid
// whose job holds hours, surprises or change orders is the only place that
// work is written down, and no confirm makes that safe to throw away. Those
// keep the button hidden; a won bid with a bare job does not.
function bidsCanDelete(bid) {
  if (!bid) return false;
  // An invoice against this bid is money already claimed off it, and the
  // invoice bills the proposal itself: take the bid away and the paper the
  // customer is holding has nothing behind it. Same answer as a job with work
  // written down, and given the same way — the button is simply not there.
  if (bidHasInvoices(state.data, bid)) return false;
  if (bid.status === 'won' || bid.status === 'complete') return Store.jobIsEmpty(bid.job);
  return true;
}

// The confirm NAMES THE BID and then its status. "Delete this SENT bid?" was
// true of four rows on the screen, and the one he was looking at was the one
// the panel covered up — a confirm that cannot be checked against the thing it
// is about is a confirm he taps through. The number and the customer are how
// he says which bid he means, so they are how the question asks it.
//
// A draft carries no clause: it never left the office and there is nothing to
// weigh. Sent is something that HAPPENED; won and lost are things he MARKED,
// so they read that way. And whatever the status, a bid whose PDF actually
// went out says the delete does not reach the customer — the document is in
// somebody's inbox and nothing on this phone can take it back.
function bidsDeleteConfirmText(bid) {
  const head = 'Delete bid #' + bid.number + ' for ' + bidCustomerName(bid, state.data) + '?';
  const label = (STATUS_LABELS[bid.status] || bid.status || '').toUpperCase();
  if (bid.status === 'draft') return head + " This can't be undone.";
  const was = bid.status === 'sent' ? 'It was ' + label : 'It was marked ' + label;
  return head + ' ' + was
    + (bid.sentAt ? "; the customer's copy is not affected." : '.')
    + " This can't be undone.";
}

async function bidsDelete(id) {
  const bid = state.data.bids.find((b) => b.id === id);
  if (!bidsCanDelete(bid)) return;
  bidsMenuId = null;

  const ok = await confirmPanel(bidsDeleteConfirmText(bid), { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  // Asked again after the question: a job that filled up while the panel was
  // open is a job this must not take with it.
  if (!bidsCanDelete(state.data.bids.find((b) => b.id === id))) { render(); return; }

  // The document goes FIRST and the blobs only once it is really off disk.
  // A refused save with the photos already deleted is the one outcome there is
  // no way back from: the bid survives, its pictures do not, and nothing on
  // screen says why. Stranded blobs are the cheaper failure by far — they cost
  // storage, not work — so they are cleaned up after, never before.
  const i = state.data.bids.findIndex((b) => b.id === id);
  if (i === -1) { render(); return; }
  const [removed] = state.data.bids.splice(i, 1);
  if (!persistOr(() => { state.data.bids.splice(i, 0, removed); })) { render(); return; }
  render();
  bidsDeleteBlobs(removed);
}

// Everything in IndexedDB that belonged to a bid that is now gone: the photos
// its areas (and its change orders' areas) point at, and every PDF it ever
// produced. Not awaited by the caller — the bid is already deleted and the
// list has already been redrawn — so this only ever has news, never a decision.
// bidPdfParse rather than a prefix test written out here: it was the last
// hand-rolled reading of a stored id in the app, and it is the one place a
// second kind of PDF could be swept up by accident. An invoice's PDF sits in
// the same store under a longer prefix that begins with the bid's, so a raw
// indexOf test on a bid id that happened to start "inv-" would have taken
// invoices with it. The parser refuses the other kind by name.
function bidsDeleteBlobs(bid) {
  Photos.list('pdf')
    .then((ids) => Photos.delMany(bidPhotoIds(bid).concat(ids.filter((x) => {
      const hit = bidPdfParse(x);
      return !!hit && hit.bidId === bid.id;
    }))))
    .then((ok) => {
      // The sweep takes the photos and the PDFs together, so a failure here
      // may have left either kind behind. Naming only photos sends him looking
      // for the wrong thing.
      if (!ok) showBanner("Couldn't clear this bid's photos and PDFs from the phone. They take space but change nothing.");
    });
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function bidRow(bid) {
  const wrap = document.createElement('div');
  wrap.className = 'bid-card';

  // The card is a container rather than one big button because it holds a
  // second button (⋯), and a button inside a button is not a thing.
  const main = document.createElement('button');
  main.type = 'button';
  // .tap and a chevron, the same two things every other door in the app wears.
  // This is the most-tapped row in the file and it was the one row wearing its
  // own press colour and no › at all — a list of bids that did not look like a
  // list of things you could open.
  main.className = 'bid-main tap tap-chevron';

  const text = document.createElement('div');
  text.className = 'bid-main-text';

  const line1 = document.createElement('div');
  line1.className = 'bid-line1';
  line1.textContent = bidCustomerName(bid, state.data) + (bid.title ? ' · ' + bid.title : '');
  text.appendChild(line1);

  const line2 = document.createElement('div');
  line2.className = 'bid-line2';
  const price = document.createElement('span');
  price.className = 'bid-price';
  price.textContent = bidPriceText(bid, state.data);
  line2.appendChild(price);
  line2.appendChild(statusPill(bid.status));
  // The day the bid is dated. Without it the list is a wall of names and
  // prices with nothing to place them in time, and "the UDA one" is a bid he
  // wrote in March and a bid he wrote last week. Before the number, not after
  // it: the date and the number are one block on the right edge.
  //
  // The SHORT form, because this line is four things wide. Price, status, date
  // and number came to 265px of a 249px row on a 375px phone, and the row that
  // went over was the DRAFT one — 'Draft' is the widest pill — so the list
  // wrapped on exactly the bids he has most of. 9/4/26 buys back 34 of those
  // pixels and says the same thing.
  const when = document.createElement('span');
  when.className = 'bid-when';
  when.textContent = fmtDateShort(bid.dateISO);
  line2.appendChild(when);
  const num = document.createElement('span');
  num.className = 'bid-number';
  num.textContent = '#' + bid.number;
  line2.appendChild(num);
  text.appendChild(line2);
  main.appendChild(text);
  main.appendChild(chevron());

  // Long press opens the same menu the ⋯ button does. The button exists
  // because a hidden gesture is a feature nobody finds; the gesture exists
  // because once you know it, it is faster.
  let timer = null;
  const cancelPress = () => { if (timer) { clearTimeout(timer); timer = null; } };
  main.addEventListener('pointerdown', () => {
    cancelPress();
    timer = setTimeout(() => {
      timer = null;
      bidsSuppressTapUntil = Date.now() + 400;
      bidsToggleMenu(bid.id);
    }, LONG_PRESS_MS);
  });
  main.addEventListener('pointerup', cancelPress);
  main.addEventListener('pointercancel', cancelPress);
  main.addEventListener('pointerleave', cancelPress);
  main.addEventListener('click', () => {
    if (Date.now() < bidsSuppressTapUntil) return;
    show('bid', bid.id);
  });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'bid-more';
  more.setAttribute('aria-label', 'More actions for bid ' + bid.number);
  more.textContent = '⋯';
  more.addEventListener('click', () => bidsToggleMenu(bid.id));

  wrap.appendChild(main);
  wrap.appendChild(more);

  if (bidsMenuId === bid.id) {
    // "Close", not "Cancel". In a menu that has Delete in it, Cancel reads as
    // "cancel the bid" - he thought it was the button that killed a job.
    wrap.appendChild(attachedStrip(null, [
      { label: 'Duplicate', onTap: () => bidsDuplicate(bid.id) },
      bidsCanDelete(bid)
        ? { label: 'Delete', quiet: true, onTap: () => bidsDelete(bid.id) }
        : null,
    ], {
      cancelLabel: 'Close',
      cancel: () => { bidsMenuId = null; bidsRefreshList(); },
    }));
  }

  return wrap;
}

function renderBidsList(host) {
  host.textContent = '';

  const all = bidsSorted();
  if (all.length === 0) {
    const box = card();
    box.appendChild(emptyNote('No bids yet. Tap + New bid to start your first walk.'));
    host.appendChild(box);
    return;
  }

  const needle = bidsSearch.trim().toLowerCase();
  // The filter reads off the same list the band counted, so the band can never
  // promise a number of bids that the list then declines to show.
  const stale = new Set(bidsSentNoAnswer().map((b) => b.id));
  const shown = all.filter((b) => {
    if (bidsFilterSent && !stale.has(b.id)) return false;
    if (!needle) return true;
    return (bidCustomerName(b, state.data) + ' ' + (b.title || '')).toLowerCase().indexOf(needle) !== -1;
  });

  if (shown.length === 0) {
    // Carded like the no-bids state: a bare line of grey text under a search
    // field reads as the list failing to load rather than as an answer.
    const box = card();
    box.appendChild(emptyNote(needle ? 'Nothing matches that search.' : 'Nothing sent and waiting.'));
    host.appendChild(box);
    return;
  }

  shown.forEach((b) => host.appendChild(bidRow(b)));
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

function renderBids() {
  const host = el('bidsContent');
  host.textContent = '';

  const nudges = buildNudges();
  if (nudges.children.length) host.appendChild(nudges);

  // Search only shows up once the list is long enough that scanning it stops
  // working. Below that it is one more control in the way of the real one.
  if (state.data.bids.length > BIDS_SEARCH_AFTER) {
    // The same field as the walk's, from ui.js: same keyboard settings, same
    // clear-X. Redraws only the list, never the whole screen — re-rendering
    // the input under a typing thumb would drop focus and close the keyboard.
    host.appendChild(searchInput({
      className: 'bids-search',
      placeholder: 'Search customer or title',
      label: 'Search bids',
      value: bidsSearch,
      onInput: (value) => { bidsSearch = value; bidsRefreshList(); },
    }));
  } else if (bidsSearch) {
    bidsSearch = '';
  }

  bidsListEl = document.createElement('div');
  bidsListEl.className = 'bid-list';
  host.appendChild(bidsListEl);
  renderBidsList(bidsListEl);

  // Pinned above the tab bar rather than appended after the list: on a phone
  // with thirty bids, the one button the owner needs must not be a scroll away.
  pinnedBar(host, '+ New bid', () => show('bid', null));
}

registerScreen('bids', { id: 'screen-bids', title: 'Bids', back: null, tab: 'bids', render: renderBids });
