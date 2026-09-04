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
//
// Every mutation here goes through persistOr(revert): if the save is refused,
// the change is put back. A bid screen showing a number that isn't on disk is
// worse than one that refused the edit out loud.

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

// How far behind today a bare MMDD may land before it is read as next year.
const DATE_ROLLOVER_DAYS = 180;

// Builds an ISO date, or null if that day doesn't exist. Feb 30 passes a range
// check and fails here, which is the point.
function composeDate(yyyy, mm, dd) {
  const iso = yyyy + '-' + pad2(mm) + '-' + pad2(dd);
  const dt = new Date(iso + 'T12:00:00');
  if (isNaN(dt.getTime()) || dt.getMonth() + 1 !== mm || dt.getDate() !== dd) return null;
  return iso;
}

// The owner types digits on the same keypad as everything else: 915 is
// September 15, 91526 is September 15, 2026. The keypad drops a leading zero
// (0915 comes back as the number 915), so the digits are padded back out to 4
// or 6 before they are read.
//
// A bare MMDD takes the current year, and rolls FORWARD a year when that would
// land more than half a year behind us: in December, "115" means next January,
// not the one eleven months gone. It never rolls backward, so a bid date is
// always today or ahead of it — which is what a bid date almost always is.
// Six typed digits are never second-guessed: he named the year, and that is
// the way to write down a date in the past.
function parseTypedDate(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.round(v) !== v) return null;
  let digits = String(v);
  if (digits.length === 3 || digits.length === 4) digits = digits.padStart(4, '0');
  else if (digits.length === 5 || digits.length === 6) digits = digits.padStart(6, '0');
  else return null;

  const mm = Number(digits.slice(0, 2));
  const dd = Number(digits.slice(2, 4));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  if (digits.length === 6) return composeDate(2000 + Number(digits.slice(4, 6)), mm, dd);

  const thisYear = Number(Store.todayISO().slice(0, 4));
  const iso = composeDate(thisYear, mm, dd);
  if (!iso) return null;
  const behind = daysSince(iso);
  if (behind !== null && behind > DATE_ROLLOVER_DAYS) return composeDate(thisYear + 1, mm, dd);
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

// Customers matching what he has typed so far, best guess first: the customer
// on the most recent bid is the one he is most likely bidding again, and the
// rest follow alphabetically so a long list stays scannable. With sixty
// customers an unfiltered list is a wall, which is how the same company ends
// up in the file twice under two spellings.
function customerSuggestions(query) {
  const q = String(query || '').trim().toLowerCase();
  const matches = state.data.customers.filter((c) => {
    if (!c.name || c.name.trim() === '') return false;
    return q === '' || c.name.toLowerCase().indexOf(q) !== -1;
  });

  const newest = state.data.bids.reduce((best, b) => {
    if (!best) return b;
    if (b.dateISO !== best.dateISO) return b.dateISO > best.dateISO ? b : best;
    return b.number > best.number ? b : best;
  }, null);
  const topId = newest ? newest.customerId : null;

  const top = matches.filter((c) => c.id === topId);
  const rest = matches.filter((c) => c.id !== topId).sort((a, b) => a.name.localeCompare(b.name));
  return top.concat(rest).map((c) => c.name);
}

// ---------------------------------------------------------------------------
// The header form
// ---------------------------------------------------------------------------

const DETAIL_OPTIONS = [['full', 'Full'], ['summary', 'Summary'], ['scope', 'Scope & price']];
const JOB_TYPE_OPTIONS = [['service', 'Service'], ['project', 'Project']];

// bid === null builds the new-bid form off bidDraft; an existing bid edits
// itself in place, and every edit either saves or is put back.
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

  // The row shows "Customer" when the id doesn't resolve, but the prompt must
  // not prefill that word: a tap and a Done would create a customer actually
  // named "Customer".
  const custRecord = isNew ? null : state.data.customers.find((c) => c.id === bid.customerId);
  const customerPrefill = isNew ? bidDraft.customerName : ((custRecord && custRecord.name) || '');

  const box = card(isNew ? 'New bid' : 'Bid details');

  // --- Customer ---
  const customerRow = row('Customer', cur.customerName, () => {
    promptText(customerPrefill, {
      label: 'Customer',
      placeholder: 'Company or name',
      suggest: customerSuggestions,
      done: (name) => {
        if (!name) return;
        if (isNew) {
          bidDraft.customerName = name;
          // A customer he's bid before already has a detail level that works
          // for them — unless he's already picked one for this bid by hand.
          const hit = state.data.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (hit && !bidDraft.detailTouched) bidDraft.detail = hit.defaultDetail;
        } else {
          // findOrCreateCustomer may add a customer, so the undo has to drop
          // that too, not just point the bid back at the old one.
          const prevId = bid.customerId;
          const prevCount = state.data.customers.length;
          bid.customerId = Store.findOrCreateCustomer(state.data, name).id;
          persistOr(() => {
            bid.customerId = prevId;
            state.data.customers.length = prevCount;
          });
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
        else {
          const prev = bid.title;
          bid.title = title;
          persistOr(() => { bid.title = prev; });
        }
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
          const s = state.data.settings;
          const prevNumber = bid.number;
          const prevNext = s.nextNumber;
          bid.number = n;
          // Keep the counter ahead of anything he types by hand, so the next
          // new bid doesn't hand out a number that's already on a proposal.
          if (n >= s.nextNumber) s.nextNumber = n + 1;
          persistOr(() => { bid.number = prevNumber; s.nextNumber = prevNext; });
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
      label: 'Date — type 915 for Sep 15, or 91526',
      // Six digits is the whole vocabulary; a seventh is a fat-fingered tap.
      maxDigits: 6,
      // The panel would otherwise say "was not set" for a date that is always
      // set; show the day it currently reads, in the form he reads it in.
      wasText: 'was ' + fmtDate(cur.dateISO),
      done: (v) => {
        // Clear means "never mind", the same as Cancel — not a rejected date.
        if (v === null) return;
        const iso = parseTypedDate(v);
        if (!iso) {
          bidShakeField = 'date';
          showBanner('That date needs 4 digits (MMDD) or 6 (MMDDYY)');
          render();
          return;
        }
        if (isNew) bidDraft.dateISO = iso;
        else {
          const prev = bid.dateISO;
          bid.dateISO = iso;
          persistOr(() => { bid.dateISO = prev; });
        }
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
    else {
      const prev = bid.jobType;
      bid.jobType = value;
      persistOr(() => { bid.jobType = prev; });
    }
    render();
  }));

  // --- Detail level ---
  host.appendChild(fieldLabel('Detail level'));
  host.appendChild(toggleRow(DETAIL_OPTIONS, cur.detail, (value) => {
    if (isNew) { bidDraft.detail = value; bidDraft.detailTouched = true; }
    else {
      const prev = bid.detail;
      bid.detail = value;
      persistOr(() => { bid.detail = prev; });
    }
    render();
  }));

  // --- The way out ---
  const actions = document.createElement('div');
  actions.className = 'bid-nav';
  if (isNew) {
    actions.appendChild(textButton('Start the walk →', 'btn btn-primary btn-block', startTheWalk));
  } else {
    actions.appendChild(textButton('Done', 'btn btn-primary btn-block', () => {
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

  // newBid both hands out settings.nextNumber and may add a customer, so both
  // are snapshotted before the call, not after.
  const s = state.data.settings;
  const prevNextNumber = s.nextNumber;
  const prevCustomerCount = state.data.customers.length;

  const bid = Store.newBid(state.data, {
    customerName: name,
    title: bidDraft.title,
    jobType: bidDraft.jobType,
    dateISO: bidDraft.dateISO,
  });
  // If he typed a different number, honor it and keep the counter past it.
  if (bidDraft.number !== bid.number) {
    bid.number = bidDraft.number;
    s.nextNumber = Math.max(s.nextNumber, bidDraft.number + 1);
  }
  bid.detail = bidDraft.detail;
  state.data.bids.push(bid);

  // Walking a plant with a bid that was never saved is the worst outcome this
  // screen has: an hour of measurements landing in a record that vanishes at
  // the next launch. On a refused save nothing moves and the form stays up,
  // with his typing still in it.
  if (!persistOr(() => {
    state.data.bids.pop();
    s.nextNumber = prevNextNumber;
    state.data.customers.length = prevCustomerCount;
  })) {
    render();
    return;
  }

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

  box.appendChild(textButton('Edit details', 'link-btn', () => {
    bidHeaderOpen = true;
    render();
  }));
  host.appendChild(box);

  // --- Where the work happens ---
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('Walk', 'btn btn-block', () => show('walk')));
  nav.appendChild(textButton('Labor', 'btn btn-block', () => show('labor')));
  nav.appendChild(textButton('Costs & price', 'btn btn-block', () => show('price')));
  nav.appendChild(textButton('Proposal', 'btn btn-block', () => show('proposal')));
  // Job tracking only means something once there's a job to track.
  if (bid.status === 'won' || bid.status === 'complete') {
    nav.appendChild(textButton('Job', 'btn btn-block', () => show('job')));
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
        reasons.appendChild(textButton(label, 'btn btn-block', () => {
          const prevStatus = bid.status;
          const prevReason = bid.lostReason;
          bid.status = 'lost';
          bid.lostReason = value;
          bidLostSheetOpen = false;
          // On a refused save the sheet comes back up, so the answer he picked
          // is one tap away rather than four.
          persistOr(() => {
            bid.status = prevStatus;
            bid.lostReason = prevReason;
            bidLostSheetOpen = true;
          });
          render();
        }));
      });
      reasons.appendChild(textButton('Cancel', 'btn btn-block', () => {
        bidLostSheetOpen = false;
        render();
      }));
      ask.appendChild(fieldLabel('What happened?'));
      ask.appendChild(reasons);
    } else {
      const pair = document.createElement('div');
      pair.className = 'toggle-row';
      pair.appendChild(textButton('Won', 'btn btn-confirm btn-half', () => {
        const prevStatus = bid.status;
        const prevJob = bid.job;
        bid.status = 'won';
        bid.job = { weeks: [], surprises: [], changeOrders: [], completedAt: null };
        // Never open the job screen for a win that wasn't recorded.
        if (!persistOr(() => { bid.status = prevStatus; bid.job = prevJob; })) {
          render();
          return;
        }
        show('job');
      }));
      pair.appendChild(textButton('Lost', 'btn btn-danger-outline btn-half', () => {
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
    host.appendChild(emptyNote("That bid isn't here anymore. Tap Back to return to your bids."));
    return;
  }

  if (bidHeaderOpen) renderBidHeader(bid, host);
  else renderBidScreen(bid, host);
}

registerScreen('bid', { id: 'screen-bid', title: 'Bid', back: 'bids', tab: 'bids', enter: enterBid, render: renderBid });
