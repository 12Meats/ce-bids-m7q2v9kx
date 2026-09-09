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
// One render long: the "Wrong button?" card is scrolled to only when it is
// the answer to a tap he just made, never when he opens a lost bid later.
let bidRevealUndo = false;
let bidDraft = null;         // the not-yet-created bid, while state.bidId is null
let bidShakeField = null;    // 'customer' | 'date' — shaken once after the next render
let bidBillOpen = false;     // the Bill this job strip is hanging under its row

// ---------------------------------------------------------------------------
// Entering the screen
// ---------------------------------------------------------------------------

// The two rows on the header form that open a number keypad. row()'s options
// argument is the whole difference; naming it here keeps the form readable.
function rowKeypad(label, value, onTap) { return row(label, value, onTap, { keypad: true }); }

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
  bidBillOpen = false;
  state.bidId = bidId;
  bidDraft = bidId === null ? newBidDraft() : null;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

// fieldLabel() and toggleRow() moved to ui.js when the proposal screen grew
// its own detail-level toggle: the same three buttons, written twice, is how
// two screens end up disagreeing about what "Scope & price" is called.

// Customers matching what he has typed so far, best guess first. Three keys,
// in this order:
//
//   1. A name that STARTS with what he typed beats one that merely contains
//      it. Typing "des" is aiming at "Desert Dairy", not at "Sunrise Design" —
//      and the chips are only eight long, so an interior match sitting on top
//      is a chip he has to scroll past.
//   2. The customer on the most recent bid: the one he is most likely bidding
//      again.
//   3. Alphabetical, so a long list stays scannable.
//
// With sixty customers an unfiltered list is a wall, which is how the same
// company ends up in the file twice under two spellings.
function customerSuggestions(query) {
  const q = String(query || '').trim().toLowerCase();
  const matches = state.data.customers.filter((c) => {
    if (!c.name || c.name.trim() === '') return false;
    // Hidden is how a customer is retired. The record stays on the file
    // because bids and invoices name it, and every other list in the app folds
    // it away; this one used to offer it as readily as a live one, so the
    // customer he stopped working for two years ago was still the first
    // suggestion under an empty box. Store.findOrCreateCustomer still finds it
    // by an exact name, so typing the name out in full reuses the record
    // rather than making a second one under the same words.
    if (c.hidden === true) return false;
    return q === '' || c.name.toLowerCase().indexOf(q) !== -1;
  });

  const newest = state.data.bids.slice().sort(Dates.bidsSortCompare)[0];
  const topId = newest ? newest.customerId : null;

  // An empty query makes every name a prefix match, which lands this back on
  // the old ordering: most recent first, then alphabetical.
  const rank = (c) => (c.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) * 2 + (c.id === topId ? 0 : 1);
  return matches
    .slice()
    .sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name))
    .map((c) => c.name);
}

// ---------------------------------------------------------------------------
// The header form
// ---------------------------------------------------------------------------

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
  box.appendChild(rowKeypad('Bid #', '#' + cur.number, () => {
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
  const dateRow = rowKeypad('Date', fmtDate(cur.dateISO), () => {
    promptNumber(null, {
      label: 'Date: type 915 for Sep 15, or 91526',
      // Six digits is the whole vocabulary; a seventh is a fat-fingered tap.
      maxChars: 6,
      // The panel would otherwise say "was not set" for a date that is always
      // set; show the day it currently reads, in the form he reads it in.
      wasText: 'was ' + fmtDate(cur.dateISO),
      done: (v) => {
        // Clear means "never mind", the same as Cancel — not a rejected date.
        if (v === null) return;
        // Which year "915" belongs to is decided in dates.js and tested
        // there: a bare MMDD means the nearest such day, either side of today.
        const iso = Dates.parseTypedDate(v, Store.todayISO());
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
    // The button outlives what it was drawn for. A tap that lands after the
    // draft became a real bid, or after the bid was deleted from another
    // screen, has nothing to write to: it does nothing rather than throw and
    // take the whole screen down with it.
    if (isNew ? !bidDraft : !bid) return;
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
    if (isNew ? !bidDraft : !bid) return;
    if (isNew) { bidDraft.detail = value; bidDraft.detailTouched = true; }
    else {
      const prev = bid.detail;
      bid.detail = value;
      persistOr(() => { bid.detail = prev; });
    }
    render();
  }));
  // Three words on a pill are not an explanation of what leaves the office.
  // The line says what the button he is looking at actually puts on the
  // paper, and it changes as he taps — which is how he finds out that
  // "Scope & price" is the one that takes the line items away. The wording is
  // ui.js's, shared with anywhere else these three ever appear.
  host.appendChild(caption(detailCaption(cur.detail)));

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

  // The detail level goes IN, it is not written on afterwards. newBid seeds
  // the bid's notes off the level it lands on, so a level applied a line later
  // seeded them off the customer's default instead of off what he just tapped.
  const bid = Store.newBid(state.data, {
    customerName: name,
    title: bidDraft.title,
    jobType: bidDraft.jobType,
    detail: bidDraft.detail,
    dateISO: bidDraft.dateISO,
  });
  // If he typed a different number, honor it and keep the counter past it.
  if (bidDraft.number !== bid.number) {
    bid.number = bidDraft.number;
    s.nextNumber = Math.max(s.nextNumber, bidDraft.number + 1);
  }
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
  // WITH the id. A bare show('walk') means "keep whatever you had", and what
  // he had one Back tap after a change order is that change order — so the
  // first walk of a brand new bid opened onto "That change order isn't here
  // anymore." Every navigation into walk/labor names the thing it means.
  show('walk', bid.id);
}

// ---------------------------------------------------------------------------
// The bid screen
// ---------------------------------------------------------------------------

// --- Taking back a Won or a Lost -------------------------------------------
//
// Won and Lost are one tap each, side by side, on a phone held in a truck.
// The wrong half gets tapped, and without a way back the only fix is a bid
// that reads as lost forever. So both answers come back, with a question
// first because both of them throw something away.
//
// A lost bid always reopens: the reason is one tap to pick again. A won bid
// reopens only while its job is still bare, because the moment a week of
// hours, a surprise, or a change order is on that job the app is the only
// place that work is written down, and no undo may delete it. Those bids keep
// the Job button and nothing else. A complete job is a finished record and
// never reopens at all.

async function bidReopenLost(bid) {
  const ok = await confirmPanel('Put this bid back to Sent? The lost reason is cleared.',
    { ok: 'Reopen' });
  if (!ok) { render(); return; }
  // The question is answered on a later turn of the loop, so the bid may have
  // moved on under it. Anything but a lost bid is left alone.
  if (bid.status !== 'lost') { render(); return; }
  const prevStatus = bid.status;
  const prevReason = bid.lostReason;
  bid.status = 'sent';
  bid.lostReason = null;
  // sentAt is untouched on purpose: the day the proposal went out is a fact
  // about the paper, and picking the wrong button today did not change it.
  persistOr(() => { bid.status = prevStatus; bid.lostReason = prevReason; });
  render();
}

async function bidUndoWon(bid) {
  // Asked before the question is, because there is no question to ask: an
  // invoice against this bid bills the proposal, and a bid back on Sent is a
  // proposal the app says was never agreed. The banner names the number so he
  // knows which piece of paper is holding the bid where it is.
  if (bidHasInvoices(state.data, bid)) {
    const inv = (state.data.invoices || []).find((x) => x.bidId === bid.id);
    showBanner(inv && inv.number !== null
      ? 'This bid has invoice #' + inv.number + ' on it.'
      : 'This bid has an invoice on it.');
    render();
    return;
  }
  const ok = await confirmPanel('Put this bid back to Sent? Nothing has been logged on the job yet.',
    { ok: 'Undo Won' });
  if (!ok) { render(); return; }
  // Re-asked after the question, not just before it: a job that filled up
  // while the panel was open is a job this must not drop.
  if (bid.status !== 'won' || !Store.jobIsEmpty(bid.job)) { render(); return; }
  const prevStatus = bid.status;
  const prevJob = bid.job;
  bid.status = 'sent';
  bid.job = null;
  persistOr(() => { bid.status = prevStatus; bid.job = prevJob; });
  render();
}

// ---------------------------------------------------------------------------
// BILL THIS JOB
// ---------------------------------------------------------------------------
// A won bid is money owed the day the work is done, and until this row existed
// the only way to invoice one was to log every hour of it at the truck as
// though it were a service call. It is not a service call: the customer agreed
// a price, signed a proposal, and the invoice bills THAT — the proposal and its
// change orders, as one line, exactly as the paper reads.
//
// The row says what is still to bill, so the answer to "have I been paid for
// the cheese plant yet" is on the bid itself. It is a whole amount or a part of
// it, because a job that runs three months gets billed in pieces, and the part
// is capped at what is left so two invoices can never bill the same dollar
// twice. The sentences are picker.js's; this screen asks the question and
// writes the answer.
//
// It NAVIGATES to the invoice with show(). A bid screen may not reach into the
// invoice screen's file, and it does not need to: everything an invoice is
// belongs to invmath.js, which is pure and belongs to nobody.
function buildBidBilling(host, bid) {
  const d = state.data;
  const box = card('Billing');
  const left = InvMath.projectRemainingCents(bid, d, d.invoices || []);
  // Nothing left is a row with nothing to tap: an invoice for $0 is not an
  // invoice, and a button that refuses every press is a button he tries twice.
  const billRow = row('Bill this job', billThisJobText(bid, d),
    left > 0 ? () => { bidBillOpen = !bidBillOpen; render(); } : null);
  box.appendChild(billRow);
  if (left > 0 && bidBillOpen) bidBillStrip(box, billRow, bid, left);

  // Every one of these carries a number: a project invoice is numbered on the
  // spot, on the tap that made it, because there is one of them and he is
  // looking at it. There is no draft state for this row to have a word for.
  const mine = (d.invoices || []).filter((inv) => inv.kind === 'project' && inv.bidId === bid.id);
  mine.forEach((inv) => {
    box.appendChild(lineRow('Invoiced #' + inv.number,
      invoiceStatusPill(inv), moneyText(InvMath.totals(inv).total),
      () => show('invoice', inv.id)));
  });

  box.appendChild(caption(left > 0
    ? 'Bills the proposal and its change orders. Bill the whole thing, or part of it now and the rest later.'
    : 'Every dollar of this job is on an invoice.'));
  host.appendChild(box);
}

// Whole, or part. A strip under the row rather than a confirm panel, because
// this is not a yes-or-no: it is two answers and a way out, and a confirm has
// only one of each. It was a confirm whose Cancel meant "Part of it", which
// made the back gesture — the thing that cancels every other panel in this app —
// commit him to the amount keypad instead. Now Back closes the strip, the way
// it closes every other strip, and the question the confirm used to ask is the
// strip's own heading.
function bidBillStrip(box, rowEl, bid, left) {
  const d = state.data;
  const close = () => { bidBillOpen = false; render(); };
  box.appendChild(attachedStrip(rowEl, [
    // Two plain buttons, like every other strip in the app: both are real
    // answers, and promoting one of them would be the screen leaning on him.
    { label: 'Whole amount', onTap: () => { bidBillOpen = false; bidBillThisJob(bid, null); } },
    { label: 'Part of it', onTap: () => { bidBillOpen = false; bidBillAskPart(bid, left); } },
  ], { label: billThisJobConfirm(bid, d), cancel: close }));
}

// The amount keypad behind Part of it, capped at what is left so two invoices
// can never bill the same dollar twice.
function bidBillAskPart(bid, left) {
  promptMoney(null, {
    label: 'How much of it',
    caption: moneyText(left) + ' is left on this bid.',
    done: (cents) => {
      // Clear is nothing, and nothing is not an invoice.
      if (cents === null || !(cents > 0)) { showBanner('An invoice has to bill something'); render(); return; }
      if (cents > left) {
        showBanner('That is more than the ' + moneyText(left) + ' left on this bid');
        render();
        return;
      }
      bidBillThisJob(bid, cents);
    },
  });
}

// The last gate before a number is spent. Asked again here rather than only on
// the strip: an invoice written while the keypad was up could have taken the
// rest of the job.
function bidBillThisJob(bid, partCents) {
  const d = state.data;
  const left = InvMath.projectRemainingCents(bid, d, d.invoices || []);
  if (!(left > 0)) { showBanner('This job is invoiced in full'); render(); return; }
  if (partCents !== null && partCents > left) {
    showBanner('That is more than the ' + moneyText(left) + ' left on this bid');
    render();
    return;
  }
  bidWriteProjectInvoice(bid, partCents);
}

// Numbered on the spot, unlike the weekly batch: there is one of these and he
// is looking at it, so there is nothing to review. The number, the invoice and
// the counter go to disk in ONE save, and a refused save spends nothing.
function bidWriteProjectInvoice(bid, partCents) {
  const d = state.data;
  const prevNext = d.settings.nextInvoiceNumber;
  const inv = InvMath.draftProjectInvoice(bid, d, partCents, Date.now());
  inv.id = Store.uid();
  inv.number = Store.takeInvoiceNumber(d);
  inv.dateISO = Store.todayISO();
  inv.status = InvMath.statusOf(inv);
  // A file restored from before this release has no invoices array at all:
  // every new key is optional on disk. The restore has to be able to take the
  // ARRAY back off with the invoice, or a refused save leaves the document
  // changed — an empty invoices: [] where there was nothing before.
  const madeArray = !d.invoices;
  if (madeArray) d.invoices = [];
  d.invoices.push(inv);
  if (!persistOr(() => {
    const i = d.invoices.indexOf(inv);
    if (i !== -1) d.invoices.splice(i, 1);
    if (madeArray) delete d.invoices;
    d.settings.nextInvoiceNumber = prevNext;
  })) { render(); return; }
  show('invoice', inv.id);
}

function renderBidScreen(bid, host) {
  // Where he is in the bid, and a way straight to any of the four. No step is
  // current here: this screen is the hub the four hang off, not one of them.
  host.appendChild(stepStrip(bid, state.data.settings, null));

  // --- Summary ---
  const box = card();

  box.appendChild(screenHead(bidCustomerName(bid, state.data), bid.title || 'No title yet'));
  box.appendChild(bigNumber(bidPriceText(bid, state.data)));

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

  box.appendChild(textButton('Edit details', 'link-btn link-btn-inline', () => {
    bidHeaderOpen = true;
    render();
  }));
  host.appendChild(box);

  // --- Where the work happens ---
  // The four steps used to be four big buttons here as well as four names in
  // the strip at the top: the same nav twice, the second copy pushing the
  // status cards off the screen. The strip is the nav now. What is left is the
  // one door the strip does not have — the job, and only once there is one.
  if (bid.status === 'won' || bid.status === 'complete') {
    const nav = document.createElement('div');
    nav.className = 'bid-nav';
    nav.appendChild(textButton('Job', 'btn btn-block', () => show('job', bid.id)));
    host.appendChild(nav);
    buildBidBilling(host, bid);
  }

  // --- Won / lost ---
  // Only once it's out the door. A draft becomes 'sent' on the Proposal
  // screen, which is the moment it's actually been handed over.
  if (bid.status === 'sent') {
    const ask = card('Did you get it?');
    if (bidLostSheetOpen) {
      const reasons = [];
      LOST_REASONS.forEach(([value, label]) => {
        reasons.push({ label, onTap: () => {
          const prevStatus = bid.status;
          const prevReason = bid.lostReason;
          bid.status = 'lost';
          bid.lostReason = value;
          bidLostSheetOpen = false;
          bidRevealUndo = true;
          // On a refused save the sheet comes back up, so the answer he picked
          // is one tap away rather than four.
          persistOr(() => {
            bid.status = prevStatus;
            bid.lostReason = prevReason;
            bidLostSheetOpen = true;
          });
          render();
        } });
      });
      // The one shape every inline menu in this app wears. It used to be a
      // column of block buttons ending in a Cancel that touched the next card.
      ask.appendChild(attachedStrip(null, reasons, {
        label: 'What happened?',
        cancel: () => { bidLostSheetOpen = false; render(); },
      }));
      // On an SE this card renders below the fold, behind the tab bar: tapping
      // Lost looked like nothing had happened. The question comes to him.
      revealAfterRender(ask);
    } else {
      const pair = document.createElement('div');
      pair.className = 'toggle-row';
      pair.appendChild(textButton('Won', 'btn btn-confirm btn-half', () => {
        const prevStatus = bid.status;
        const prevJob = bid.job;
        bid.status = 'won';
        // The empty-job shape lives in storage.js so the screens that write it
        // and the validator that checks it are one definition.
        bid.job = Store.newJob();
        // Never open the job screen for a win that wasn't recorded.
        if (!persistOr(() => { bid.status = prevStatus; bid.job = prevJob; })) {
          render();
          return;
        }
        show('job', bid.id);
      }));
      // Not red. Losing a bid is a fact he is recording, not a destructive
      // act, and a red button here made the honest answer look like the wrong
      // one. Nothing on a screen is red.
      pair.appendChild(textButton('Lost', 'btn btn-half', () => {
        bidLostSheetOpen = true;
        render();
      }));
      ask.appendChild(pair);
    }
    host.appendChild(ask);
  } else if (bid.status === 'lost') {
    const undo = card('Wrong button?');
    undo.appendChild(caption('Marked lost: ' + lostReasonLabel(bid.lostReason).toLowerCase() + '.'));
    undo.appendChild(textButton('Reopen', 'btn btn-block', () => bidReopenLost(bid)));
    host.appendChild(undo);
    // Only on the render that follows the answer he just gave: the card takes
    // the question's place at the bottom of the screen, and it is the receipt
    // for the tap. Opening a lost bid later must not yank the page down.
    if (bidRevealUndo) revealAfterRender(undo);
  } else if (bid.status === 'won' && Store.jobIsEmpty(bid.job)) {
    const undo = card('Wrong button?');
    undo.appendChild(textButton('Undo Won', 'btn btn-block', () => bidUndoWon(bid)));
    host.appendChild(undo);
    if (bidRevealUndo) revealAfterRender(undo);
  }
  bidRevealUndo = false;
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
