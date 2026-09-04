'use strict';

// screens/bid.js — two views on one screen.
//
//   1. The header form: customer, title, job type, bid number, date, detail
//      level. For a bid that doesn't exist yet it ends in "Start the walk →";
//      for one that does, it edits the same fields in place and each change
//      saves as it is made.
//   2. The bid itself: a summary of what it's worth, the five places the work
//      happens, and — once it's been sent — the Won / Lost question.
//
// No native pickers anywhere: the date is typed on the number keypad as MMDD
// or MMDDYY, and job type and detail level are toggle buttons.

// Screen-local view state.
let bidHeaderOpen = false;   // the header form is showing for an existing bid
let bidLostSheetOpen = false;
let bidDraft = null;         // the not-yet-created bid, while state.bidId is null
let bidShakeField = null;    // 'customer' | 'date' — shaken once after the next render

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// ---------------------------------------------------------------------------
// Entering the screen
// ---------------------------------------------------------------------------

function newBidDraft() {
  return {
    customerName: '',
    title: '',
    jobType: 'service',
    number: state.data.settings.nextNumber,
    dateISO: Store.todayISO(),
    detail: 'full',
    detailTouched: false,
  };
}

// The screen's enter hook, called by show('bid', arg). Three arguments, three
// meanings — and every one of them is a navigation the shell performs, so no
// other screen has to reach into this file to open a bid:
//
//   a bid id  — open that bid, on the summary view
//   null      — the header form for a bid that doesn't exist yet
//   undefined — coming back from Walk/Labor/Price/Proposal/Job (the Back
//               button passes nothing): keep the bid and the view we left
function enterBid(bidId) {
  if (bidId === undefined) return;
  bidHeaderOpen = false;
  bidLostSheetOpen = false;
  bidShakeField = null;
  state.bidId = bidId;
  bidDraft = bidId === null ? newBidDraft() : null;
}

// ---------------------------------------------------------------------------
// Typed dates
// ---------------------------------------------------------------------------

// The owner types digits on the same keypad as everything else: 0915 is
// September 15 of this year, 091526 is September 15, 2026. The keypad drops a
// leading zero (0915 comes back as the number 915), so the digits are padded
// back out to 4 or 6 before they are read. Returns null for anything that
// isn't a real day — including Feb 30, which passes the range check but not
// the calendar.
function parseTypedDate(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.round(v) !== v) return null;
  let digits = String(v);
  if (digits.length === 3 || digits.length === 4) digits = digits.padStart(4, '0');
  else if (digits.length === 5 || digits.length === 6) digits = digits.padStart(6, '0');
  else return null;

  const mm = Number(digits.slice(0, 2));
  const dd = Number(digits.slice(2, 4));
  const yyyy = digits.length === 6 ? 2000 + Number(digits.slice(4, 6)) : new Date().getFullYear();
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const iso = yyyy + '-' + pad2(mm) + '-' + pad2(dd);
  const dt = new Date(iso + 'T12:00:00');
  if (isNaN(dt.getTime()) || dt.getMonth() + 1 !== mm || dt.getDate() !== dd) return null;
  return iso;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

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

function inlineWarn(text) {
  const d = document.createElement('div');
  d.className = 'inline-warn';
  d.textContent = text;
  return d;
}

function bigButton(label, cls, onTap) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener('click', onTap);
  return btn;
}

// ---------------------------------------------------------------------------
// The header form
// ---------------------------------------------------------------------------

const DETAIL_OPTIONS = [['full', 'Full'], ['summary', 'Summary'], ['scope', 'Scope & price']];
const JOB_TYPE_OPTIONS = [['service', 'Service'], ['project', 'Project']];

// bid === null builds the new-bid form off bidDraft; an existing bid edits
// itself in place and persists after every change.
function renderBidHeader(bid, host) {
  host = host || el('bidContent');
  const isNew = !bid;
  const cur = isNew ? bidDraft : {
    customerName: bidCustomerName(bid, state.data),
    title: bid.title,
    jobType: bid.jobType,
    number: bid.number,
    dateISO: bid.dateISO,
    detail: bid.detail,
  };

  const box = card(isNew ? 'New bid' : 'Bid details');

  // --- Customer ---
  const customerRow = row('Customer', cur.customerName, () => {
    promptText(cur.customerName, {
      label: 'Customer',
      placeholder: 'Company or name',
      // Chips of who he already bids for: typing "Shamrock Farms" a second
      // time, slightly differently, is how one customer becomes two.
      suggestions: state.data.customers.map((c) => c.name),
      done: (name) => {
        if (!name) return;
        if (isNew) {
          bidDraft.customerName = name;
          // A customer he's bid before already has a detail level that works
          // for them — unless he's already picked one for this bid by hand.
          const hit = state.data.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (hit && !bidDraft.detailTouched) bidDraft.detail = hit.defaultDetail;
        } else {
          bid.customerId = Store.findOrCreateCustomer(state.data, name).id;
          persist();
        }
        render();
      },
    });
  });
  box.appendChild(customerRow);

  // --- Title ---
  box.appendChild(row('Title', cur.title, () => {
    promptText(cur.title, {
      label: 'Title',
      placeholder: 'What the job is',
      done: (title) => {
        if (isNew) bidDraft.title = title;
        else { bid.title = title; persist(); }
        render();
      },
    });
  }));

  // --- Bid number ---
  box.appendChild(row('Bid #', '#' + cur.number, () => {
    promptNumber(cur.number, {
      label: 'Bid number',
      done: (v) => {
        if (v === null) return;
        const n = Math.max(1, Math.round(v));
        if (isNew) bidDraft.number = n;
        else {
          bid.number = n;
          // Keep the counter ahead of anything he types by hand, so the next
          // new bid doesn't hand out a number that's already on a proposal.
          const s = state.data.settings;
          if (n >= s.nextNumber) s.nextNumber = n + 1;
          persist();
        }
        render();
      },
    });
  }));
  // A warning, not a block: two bids can share a number for as long as it
  // takes him to decide which one is wrong.
  if (Store.numberInUse(state.data, cur.number, isNew ? null : bid.id)) {
    box.appendChild(inlineWarn('Already used on another bid'));
  }

  // --- Date ---
  const dateRow = row('Date', fmtDate(cur.dateISO), () => {
    promptNumber(null, {
      label: 'Date — type MMDD or MMDDYY',
      // The panel would otherwise say "was not set" for a date that is always
      // set; show the day it currently reads, in the form he reads it in.
      wasText: 'was ' + fmtDate(cur.dateISO),
      done: (v) => {
        const iso = v === null ? null : parseTypedDate(v);
        if (!iso) {
          bidShakeField = 'date';
          showBanner('That date needs 4 digits (MMDD) or 6 (MMDDYY)');
          render();
          return;
        }
        if (isNew) bidDraft.dateISO = iso;
        else { bid.dateISO = iso; persist(); }
        render();
      },
    });
  });
  box.appendChild(dateRow);

  host.appendChild(box);

  // --- Job type ---
  host.appendChild(fieldLabel('Job type'));
  host.appendChild(toggleRow(JOB_TYPE_OPTIONS, cur.jobType, (value) => {
    if (isNew) bidDraft.jobType = value;
    else { bid.jobType = value; persist(); }
    render();
  }));

  // --- Detail level ---
  host.appendChild(fieldLabel('Detail level'));
  host.appendChild(toggleRow(DETAIL_OPTIONS, cur.detail, (value) => {
    if (isNew) { bidDraft.detail = value; bidDraft.detailTouched = true; }
    else { bid.detail = value; persist(); }
    render();
  }));

  // --- The way out ---
  const actions = document.createElement('div');
  actions.className = 'bid-nav';
  if (isNew) {
    actions.appendChild(bigButton('Start the walk →', 'btn btn-primary btn-block', startTheWalk));
  } else {
    actions.appendChild(bigButton('Done', 'btn btn-primary btn-block', () => {
      bidHeaderOpen = false;
      render();
    }));
  }
  host.appendChild(actions);

  // A rejected date or a missing customer name is answered where the mistake
  // is, not only in a banner at the top of the screen.
  if (bidShakeField === 'customer') shake(customerRow);
  else if (bidShakeField === 'date') shake(dateRow);
  bidShakeField = null;
}

function startTheWalk() {
  const name = (bidDraft.customerName || '').trim();
  if (!name) {
    bidShakeField = 'customer';
    showBanner('Add a customer name first');
    render();
    return;
  }

  const bid = Store.newBid(state.data, {
    customerName: name,
    title: bidDraft.title,
    jobType: bidDraft.jobType,
    dateISO: bidDraft.dateISO,
  });
  // newBid hands out settings.nextNumber and steps the counter; if he typed a
  // different number, honor it and keep the counter past it.
  const s = state.data.settings;
  if (bidDraft.number !== bid.number) {
    bid.number = bidDraft.number;
    s.nextNumber = Math.max(s.nextNumber, bidDraft.number + 1);
  }
  bid.detail = bidDraft.detail;
  state.data.bids.push(bid);
  persist();

  bidDraft = null;
  state.bidId = bid.id;
  show('walk');
}

// ---------------------------------------------------------------------------
// The bid screen
// ---------------------------------------------------------------------------

const LOST_REASONS = [
  ['price', 'Price'],
  ['timing', 'Timing'],
  ['other', 'Went another way'],
  ['silence', 'Never heard back'],
];

function renderBidScreen(bid, host) {
  // --- Summary ---
  const box = card();

  const name = document.createElement('div');
  name.className = 'bid-head-name';
  name.textContent = bidCustomerName(bid, state.data);
  box.appendChild(name);

  const title = document.createElement('div');
  title.className = 'bid-head-title';
  title.textContent = bid.title || 'No title yet';
  box.appendChild(title);

  const price = document.createElement('div');
  price.className = 'bid-head-price';
  price.textContent = bidPriceText(bid, state.data);
  box.appendChild(price);

  const meta = document.createElement('div');
  meta.className = 'bid-head-meta';
  meta.appendChild(statusPill(bid.status));
  const num = document.createElement('span');
  num.textContent = '#' + bid.number;
  meta.appendChild(num);
  const date = document.createElement('span');
  date.textContent = fmtDate(bid.dateISO);
  meta.appendChild(date);
  box.appendChild(meta);

  box.appendChild(bigButton('Edit details', 'link-btn', () => {
    bidHeaderOpen = true;
    render();
  }));
  host.appendChild(box);

  // --- Where the work happens ---
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(bigButton('Walk', 'btn btn-block', () => show('walk')));
  nav.appendChild(bigButton('Labor', 'btn btn-block', () => show('labor')));
  nav.appendChild(bigButton('Costs & price', 'btn btn-block', () => show('price')));
  nav.appendChild(bigButton('Proposal', 'btn btn-block', () => show('proposal')));
  // Job tracking only means something once there's a job to track.
  if (bid.status === 'won' || bid.status === 'complete') {
    nav.appendChild(bigButton('Job', 'btn btn-block', () => show('job')));
  }
  host.appendChild(nav);

  // --- Won / lost ---
  // Only once it's out the door. A draft becomes 'sent' on the Proposal
  // screen, which is the moment it's actually been handed over.
  if (bid.status === 'sent') {
    const ask = card('Did you get it?');
    if (bidLostSheetOpen) {
      const reasons = document.createElement('div');
      reasons.className = 'bid-nav';
      LOST_REASONS.forEach(([value, label]) => {
        reasons.appendChild(bigButton(label, 'btn btn-block', () => {
          bid.status = 'lost';
          bid.lostReason = value;
          bidLostSheetOpen = false;
          persist();
          render();
        }));
      });
      reasons.appendChild(bigButton('Cancel', 'btn btn-block', () => {
        bidLostSheetOpen = false;
        render();
      }));
      ask.appendChild(fieldLabel('What happened?'));
      ask.appendChild(reasons);
    } else {
      const pair = document.createElement('div');
      pair.className = 'toggle-row';
      pair.appendChild(bigButton('Won', 'btn btn-confirm btn-half', () => {
        bid.status = 'won';
        bid.job = { weeks: [], surprises: [], changeOrders: [], completedAt: null };
        persist();
        show('job');
      }));
      pair.appendChild(bigButton('Lost', 'btn btn-danger-outline btn-half', () => {
        bidLostSheetOpen = true;
        render();
      }));
      ask.appendChild(pair);
    }
    host.appendChild(ask);
  }
}

// ---------------------------------------------------------------------------

function renderBid() {
  const host = el('bidContent');
  host.textContent = '';

  if (state.bidId === null) {
    if (!bidDraft) bidDraft = newBidDraft();
    renderBidHeader(null, host);
    return;
  }

  const bid = state.data.bids.find((b) => b.id === state.bidId);
  if (!bid) {
    // Deleted from the list, or a stale id after an import. Say so rather than
    // showing an empty screen with live buttons on it.
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = "That bid isn't here anymore. Tap Back to return to your bids.";
    host.appendChild(p);
    return;
  }

  if (bidHeaderOpen) renderBidHeader(bid, host);
  else renderBidScreen(bid, host);
}

registerScreen('bid', { id: 'screen-bid', title: 'Bid', back: 'bids', tab: 'bids', enter: enterBid, render: renderBid });
