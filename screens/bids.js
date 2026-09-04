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
// bidCustomerName and bidPriceText live in ui.js: the bid screen prints the
// same two things and the two screens must never disagree about either.

// Newest first: by date, then by number so two bids walked the same day still
// have a stable order with the most recent one on top.
function bidsSorted() {
  return state.data.bids.slice().sort((a, b) => {
    if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? 1 : -1;
    return b.number - a.number;
  });
}

// Every photo this bid owns — its own areas plus any change-order areas — so
// deleting a bid doesn't leave orphaned blobs in IndexedDB forever.
function bidPhotoIds(bid) {
  const areas = (bid.areas || []).slice();
  const cos = (bid.job && bid.job.changeOrders) || [];
  cos.forEach((co) => { (co.areas || []).forEach((a) => areas.push(a)); });
  return areas.reduce((ids, a) => ids.concat(a.photoIds || []), []);
}

// ---------------------------------------------------------------------------
// Nudge bands
// ---------------------------------------------------------------------------

// Sent more than two weeks ago and still sitting there. This is the whole
// reason the app exists: a proposal nobody followed up on is money left on a
// table in a dairy plant.
function bidsSentNoAnswer() {
  return state.data.bids.filter((b) => {
    if (b.status !== 'sent' || !b.sentAt) return false;
    const d = daysSince(b.sentAt);
    return d !== null && d > NUDGE_DAYS;
  });
}

function nudgeBand(text, kind, onTap) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nudge nudge-' + kind;
  btn.textContent = text;
  btn.addEventListener('click', onTap);
  return btn;
}

function buildNudges() {
  const wrap = document.createElement('div');
  wrap.className = 'nudges';

  const stale = bidsSentNoAnswer();
  if (stale.length) {
    const band = nudgeBand(
      `${stale.length} bid${stale.length === 1 ? '' : 's'} sent, no answer — tap to ${bidsFilterSent ? 'show all' : 'review'}`,
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
  const unsaved = state.data.bids.filter((b) => b.sentAt && !b.savedToFilesAt).length;
  const backupAge = daysSince(state.data.settings.lastBackupAt);
  const parts = [];
  if (unsaved) parts.push(`${unsaved} proposal${unsaved === 1 ? '' : 's'} not saved to Files`);
  if (backupAge === null) parts.push('no backup yet');
  else if (backupAge > NUDGE_DAYS) parts.push(`last backup ${backupAge} days ago`);
  if (parts.length) {
    wrap.appendChild(nudgeBand(parts.join(' · ') + ' — Settings › Backup', 'danger', () => show('settings')));
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
  if (!persist()) {
    const i = state.data.bids.indexOf(copy);
    if (i !== -1) state.data.bids.splice(i, 1);
    state.data.settings.nextNumber = prevNextNumber;
    render();  // persist() has already said why
    return;
  }
  show('bid', copy.id);
}

// Drafts only: a bid that has been sent is a record of what a customer was
// told, and the app does not offer to erase that.
async function bidsDelete(id) {
  const bid = state.data.bids.find((b) => b.id === id);
  if (!bid || bid.status !== 'draft') return;
  bidsMenuId = null;

  const ok = await confirmPanel(
    `Delete bid #${bid.number} for ${bidCustomerName(bid, state.data)}? This can't be undone.`,
    { ok: 'Delete', danger: true }
  );
  if (!ok) { render(); return; }

  // Photos first: if this fails the bid is still there to try again, where
  // dropping the bid first would strand its photos with nothing pointing at
  // them. delMany never rejects.
  await Photos.delMany(bidPhotoIds(bid));

  const i = state.data.bids.findIndex((b) => b.id === id);
  if (i !== -1) state.data.bids.splice(i, 1);
  persist();
  render();
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function bidActionButton(label, cls, onTap) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener('click', onTap);
  return btn;
}

function bidRow(bid) {
  const wrap = document.createElement('div');
  wrap.className = 'bid-card';

  // The card is a container rather than one big button because it holds a
  // second button (⋯), and a button inside a button is not a thing.
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'bid-main';

  const line1 = document.createElement('div');
  line1.className = 'bid-line1';
  line1.textContent = bidCustomerName(bid, state.data) + (bid.title ? ' · ' + bid.title : '');
  main.appendChild(line1);

  const line2 = document.createElement('div');
  line2.className = 'bid-line2';
  const price = document.createElement('span');
  price.className = 'bid-price';
  price.textContent = bidPriceText(bid, state.data);
  line2.appendChild(price);
  line2.appendChild(statusPill(bid.status));
  const num = document.createElement('span');
  num.className = 'bid-number';
  num.textContent = '#' + bid.number;
  line2.appendChild(num);
  main.appendChild(line2);

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
    const actions = document.createElement('div');
    actions.className = 'bid-actions';
    actions.appendChild(bidActionButton('Duplicate', 'btn', () => bidsDuplicate(bid.id)));
    if (bid.status === 'draft') {
      actions.appendChild(bidActionButton('Delete', 'btn btn-danger-outline', () => bidsDelete(bid.id)));
    }
    actions.appendChild(bidActionButton('Cancel', 'btn', () => { bidsMenuId = null; bidsRefreshList(); }));
    wrap.appendChild(actions);
  }

  return wrap;
}

function bidsEmptyNote(text) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = text;
  return p;
}

function renderBidsList(host) {
  host.textContent = '';

  const all = bidsSorted();
  if (all.length === 0) {
    const box = card();
    box.appendChild(bidsEmptyNote('No bids yet — tap + New bid to start your first walk.'));
    host.appendChild(box);
    return;
  }

  const needle = bidsSearch.trim().toLowerCase();
  const shown = all.filter((b) => {
    if (bidsFilterSent && !(b.status === 'sent' && b.sentAt && daysSince(b.sentAt) > NUDGE_DAYS)) return false;
    if (!needle) return true;
    return (bidCustomerName(b, state.data) + ' ' + (b.title || '')).toLowerCase().indexOf(needle) !== -1;
  });

  if (shown.length === 0) {
    // Carded like the no-bids state: a bare line of grey text under a search
    // field reads as the list failing to load rather than as an answer.
    const box = card();
    box.appendChild(bidsEmptyNote(needle ? 'Nothing matches that search.' : 'Nothing sent and waiting.'));
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
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bids-search';
    input.placeholder = 'Search customer or title';
    input.autocomplete = 'off';
    input.value = bidsSearch;
    // Redraws only the list, never the whole screen: re-rendering the input
    // under a typing thumb would drop focus and close the keyboard.
    input.addEventListener('input', () => { bidsSearch = input.value; bidsRefreshList(); });
    host.appendChild(input);
  } else if (bidsSearch) {
    bidsSearch = '';
  }

  bidsListEl = document.createElement('div');
  bidsListEl.className = 'bid-list';
  host.appendChild(bidsListEl);
  renderBidsList(bidsListEl);

  // Pinned above the tab bar rather than appended after the list: on a phone
  // with thirty bids, the one button the owner needs must not be a scroll away.
  const bar = document.createElement('div');
  bar.className = 'bids-newbar';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'btn btn-primary btn-block';
  newBtn.textContent = '+ New bid';
  newBtn.addEventListener('click', () => show('bid', null));
  bar.appendChild(newBtn);
  host.appendChild(bar);
}

registerScreen('bids', { id: 'screen-bids', title: 'Bids', back: null, tab: 'bids', render: renderBids });
