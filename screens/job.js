'use strict';

// screens/job.js — the job, once he has won it.
//
// Everything before this screen is a guess. This is where the guess meets the
// week: hours actually worked, money he did not see coming, and the extra work
// the customer asked for after the price was agreed. Over ten jobs the card at
// the bottom — what he bid against what it really cost — is the thing that
// cures underbidding, which is the whole reason this app exists.
//
// Four cards, in the order the week happens:
//
//   Hours this week — one big number, typed on the keypad, filed under the
//                     Monday of the week it belongs to. A burn bar under it
//                     says how much of the bid hours are gone.
//   Surprises       — the ten-inch wall and the new bit. An amount and a note.
//   Change orders   — extra work, priced the way the job was sold. Each one is
//                     a small bid: its own areas and its own labor, edited on
//                     the SAME walk and labor screens the bid uses (they take
//                     a { bidId, changeOrderId } argument), never on a second
//                     copy of those screens living in here.
//   Bid vs. actual  — the navy card. Hours, surprises against the set-aside,
//                     the price including change orders, and what the margin
//                     started at against what it is running at now.
//
// NOTHING on this screen does money or hours arithmetic. Every number comes
// out of BidMath.jobActuals or BidMath.changeOrderPrice, both pure and tested,
// so the card and the paperwork can never be two opinions about one job.
//
// Once he marks the job complete the screen stays readable and stops being
// editable: the record of a finished job is worth more than the ability to
// tidy it up six months later.
//
// Every mutation is snapshot -> mutate -> persistOr(revert), and nothing
// navigates after a refused save.
//
// Sections, in order:
//   VIEW STATE      — the enter hook and the week being looked at
//   WEEKLY HOURS    — the big number, the arrows, the burn bar
//   SURPRISES       — add, list, delete
//   CHANGE ORDERS   — add, list, the two ways into the shared editors
//   BID VS ACTUAL   — the navy card
//   COMPLETE        — the one-way door
//   REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

// A week is nobody's idea of a decimal: 500 hours is twelve men working the
// whole week, which is not this business. It is a limit on the typo.
const JOB_MAX_WEEK_HOURS = 500;
// Characters, not digits — "168.25" is six of them.
const JOB_HOURS_KEYS = 6;
let jobWeekISO = null;   // the Monday being looked at; null = the current week
let jobCoMenu = null;    // the change order showing its action row
let jobSurpriseMenu = null;  // the surprise showing its Delete row

function jobClearTransient() {
  jobCoMenu = null;
  jobSurpriseMenu = null;
}

// The screen's enter hook. show('job', id) opens that bid's job; show('job') —
// the Back button out of the walk or labor screens — keeps the one we had.
// The week always resets to this week: the phone comes out on a Friday
// afternoon, and the week he is standing in is the week he means.
function enterJob(bidId) {
  if (typeof bidId === 'string' && bidId) state.bidId = bidId;
  jobWeekISO = null;
  jobClearTransient();
}

function jobBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

function jobSettings() { return state.data.settings; }

// The Monday of the week that contains today. Every week on this screen is
// named by its Monday, so two entries for the same week are impossible.
function jobThisMonday() { return Store.mondayOf(Store.todayISO()); }

// The two ends of the week nav, from Store.jobWeekWindow — the one rule about
// which weeks a job can hold hours, clamped so the first week is never after
// the last one.
function jobWindow(bid) {
  return Store.jobWeekWindow(bid.dateISO) || { firstISO: jobThisMonday(), lastISO: jobThisMonday() };
}

// The week on the glass. Defaults to the week he is standing in — the phone
// comes out on a Friday afternoon — and is pulled back inside the window if
// what it is holding fell outside it (a bid re-dated while the screen was up).
function jobSelectedMonday(bid) {
  const w = jobWindow(bid);
  if (!jobWeekISO) return w.lastISO;
  if (jobWeekISO < w.firstISO) return w.firstISO;
  if (jobWeekISO > w.lastISO) return w.lastISO;
  return jobWeekISO;
}

// 'This week', or the Monday spelled out. He does not think in ISO dates.
function jobWeekLabel(weekISO) {
  return weekISO === jobThisMonday() ? 'This week' : 'Week of ' + fmtDate(weekISO);
}

// The same label mid-sentence: 'Hours worked, week of Aug 24, 2026'. Only the
// leading word is lowered — .toLowerCase() on the whole string flattened the
// month too and printed "week of aug 24, 2026".
function jobWeekLabelMidSentence(weekISO) {
  const t = jobWeekLabel(weekISO);
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function jobWeekEntry(job, weekISO) {
  return (job.weeks || []).find((w) => w.weekISO === weekISO) || null;
}

// Newest week first: the last thing he did is the thing he is checking.
function jobWeeksNewestFirst(job) {
  return (job.weeks || []).slice().sort((a, b) => (a.weekISO < b.weekISO ? 1 : a.weekISO > b.weekISO ? -1 : 0));
}

// ---------------------------------------------------------------------------
// WEEKLY HOURS
// ---------------------------------------------------------------------------

function jobLogHours(bid, weekISO) {
  const job = bid.job;
  const entry = jobWeekEntry(job, weekISO);
  promptNumber(entry ? entry.hours : null, {
    label: 'Hours worked, ' + jobWeekLabelMidSentence(weekISO),
    allowDecimal: true,
    maxDecimals: 2,
    maxChars: JOB_HOURS_KEYS,
    done: (v) => {
      const prevWeeks = job.weeks.slice();
      // Clear means "nothing logged for this week" — the week comes off the
      // list rather than sitting there as a zero he has to read past. A typed
      // 0 means the same thing and is treated the same way: nobody worked that
      // week, and a "0 hrs" row in Other weeks is a line that says nothing.
      if (v === null || v === 0) {
        if (!entry) return;
        job.weeks = prevWeeks.filter((w) => w !== entry);
        persistOr(() => { job.weeks = prevWeeks; });
        render();
        return;
      }
      if (v > JOB_MAX_WEEK_HOURS) {
        showBanner('That is more than ' + JOB_MAX_WEEK_HOURS + ' hours in a week — check the number');
        render();
        return;
      }
      if (entry) {
        const prevHours = entry.hours;
        entry.hours = v;
        persistOr(() => { entry.hours = prevHours; });
      } else {
        const added = { weekISO, hours: v };
        job.weeks.push(added);
        persistOr(() => { job.weeks = prevWeeks; });
      }
      render();
    },
  });
}

// ◀ ▶ around the week's name. Forward stops at the week he is standing in:
// there are no hours yet in a week that has not happened. Back stops at the
// bid's own week — bid.dateISO and not sentAt or the day it was won, because a
// job cannot have been worked before it was measured, and dateISO is the only
// one of the three that every bid is guaranteed to have. Without a floor the
// back arrow ran into 2019 one tap at a time.
function jobWeekNav(bid, weekISO) {
  const wrap = document.createElement('div');
  wrap.className = 'job-weeknav';

  const window_ = jobWindow(bid);
  const atStart = weekISO <= window_.firstISO;
  const back = textButton('◀', 'btn job-weeknav-btn', atStart ? null : () => {
    jobWeekISO = Dates.addDays(weekISO, -7);
    render();
  });
  back.disabled = atStart;
  back.setAttribute('aria-label', 'Previous week');
  wrap.appendChild(back);

  const label = document.createElement('div');
  label.className = 'job-weeknav-label';
  label.textContent = jobWeekLabel(weekISO);
  wrap.appendChild(label);

  const atNow = weekISO >= window_.lastISO;
  const fwd = textButton('▶', 'btn job-weeknav-btn', atNow ? null : () => {
    jobWeekISO = Dates.addDays(weekISO, 7);
    render();
  });
  fwd.disabled = atNow;
  fwd.setAttribute('aria-label', 'Next week');
  wrap.appendChild(fwd);

  return wrap;
}

function buildHoursCard(bid, actuals, done) {
  const weekISO = jobSelectedMonday(bid);
  const entry = jobWeekEntry(bid.job, weekISO);
  const box = card('Hours');

  box.appendChild(jobWeekNav(bid, weekISO));

  // A job won the same week it was bid has exactly one week to log against, so
  // BOTH arrows are off and the row reads dead. Say why: a greyed-out arrow
  // that never explains itself is how a working screen gets read as a broken
  // one on the first Friday of a job.
  const window_ = jobWindow(bid);
  if (window_.firstISO === window_.lastISO) {
    box.appendChild(caption('This is the first week of the job, so there is nothing either side of it yet.'));
  }

  // Zero, not a dash. A week with no entry has had no hours logged against it,
  // which is what zero means — and a dash on the one number this screen exists
  // to collect read as a field that was not working. Clearing the keypad still
  // takes the week's row off the job, so nothing about what is stored changes.
  const line = row('Hours', entry ? numText(entry.hours) : '0',
    done ? null : () => jobLogHours(bid, weekISO));
  line.classList.add('job-hours');
  box.appendChild(line);

  box.appendChild(barMeter(actuals.hoursPct));
  box.appendChild(caption('Logged ' + numText(actuals.actualHours) + ' of '
    + numText(actuals.bidHours) + ' bid hrs'));

  const weeks = jobWeeksNewestFirst(bid.job).filter((w) => w.weekISO !== weekISO);
  if (weeks.length) {
    box.appendChild(fieldLabel('Other weeks'));
    weeks.forEach((w) => {
      box.appendChild(row(jobWeekLabel(w.weekISO), numText(w.hours) + ' hrs', () => {
        jobWeekISO = w.weekISO;
        render();
      }));
    });
  }

  return box;
}

// ---------------------------------------------------------------------------
// SURPRISES
// ---------------------------------------------------------------------------

// What happened, THEN what it cost. That is the order he says it in — "we hit
// a ten-inch wall, cost me a bit" — and it is the order every other add in the
// app asks in (a change order is named first, a rental is named first). Asking
// for the money first made this the one flow that started with a number and no
// idea what the number was for.
//
// Cancel at either panel adds nothing: the note alone is not a surprise, and
// nothing is pushed until both answers are in.
function jobAddSurprise(bid) {
  promptText('', {
    label: 'What happened?',
    placeholder: 'Ten-inch wall, new bit',
    done: (note) => {
      promptMoney(null, {
        label: 'What did it cost?',
        done: (cents) => {
          if (cents === null) return;
          // A $0 surprise is nothing to record, but dropping it in silence
          // looks like the app lost the entry. Say what happened.
          if (cents === 0) { showBanner('Nothing added'); render(); return; }
          const job = bid.job;
          const item = { cents, note, at: Store.todayISO() };
          job.surprises.push(item);
          persistOr(() => {
            const i = job.surprises.indexOf(item);
            if (i !== -1) job.surprises.splice(i, 1);
          });
          jobSurpriseMenu = null;
          render();
        },
      });
    },
  });
}

async function jobDeleteSurprise(bid, item) {
  const ok = await confirmPanel('Delete ' + moneyText(item.cents) + ' — ' + (item.note || 'this surprise') + '?',
    { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  const job = bid.job;
  const i = job.surprises.indexOf(item);
  if (i !== -1) {
    job.surprises.splice(i, 1);
    persistOr(() => { job.surprises.splice(i, 0, item); });
  }
  jobSurpriseMenu = null;
  render();
}

function buildSurprisesCard(bid, done) {
  const box = card('Surprises');
  const list = bid.job.surprises || [];

  if (list.length === 0) {
    box.appendChild(emptyNote('Nothing unexpected yet.'));
  } else {
    list.forEach((item) => {
      const label = item.note || 'Surprise';
      const line = row(label, moneyText(item.cents), done ? null : () => {
        jobSurpriseMenu = jobSurpriseMenu === item ? null : item;
        render();
      });
      box.appendChild(line);
      box.appendChild(caption(fmtDate(item.at)));
      if (jobSurpriseMenu === item) {
        const acts = document.createElement('div');
        acts.className = 'job-actions';
        acts.appendChild(textButton('Delete', 'btn btn-danger-outline', () => jobDeleteSurprise(bid, item)));
        box.appendChild(acts);
      }
    });
  }

  if (!done) {
    box.appendChild(textButton('+ Surprise', 'btn btn-block', () => jobAddSurprise(bid)));
  }
  return box;
}

// ---------------------------------------------------------------------------
// CHANGE ORDERS
// ---------------------------------------------------------------------------

// Named here, then built on the walk. The name is the only thing this screen
// asks for, because the moment he has one he is already thinking about the
// work — and the work is areas and items, which the walk already knows how to
// take down.
function jobAddChangeOrder(bid) {
  promptText('', {
    label: 'Change order',
    placeholder: 'What the extra work is',
    done: (name) => {
      if (!name) return;
      const job = bid.job;
      const co = Store.newChangeOrder(state.data, name);
      job.changeOrders.push(co);
      if (!persistOr(() => {
        const i = job.changeOrders.indexOf(co);
        if (i !== -1) job.changeOrders.splice(i, 1);
      })) { render(); return; }
      jobCoMenu = null;
      show('walk', { bidId: bid.id, changeOrderId: co.id });
    },
  });
}

function jobRenameChangeOrder(bid, co) {
  promptText(co.name, {
    label: 'Change order',
    placeholder: 'What the extra work is',
    done: (name) => {
      if (!name) return;
      const prev = co.name;
      co.name = name;
      persistOr(() => { co.name = prev; });
      render();
    },
  });
}

async function jobDeleteChangeOrder(bid, co, settings) {
  const ok = await confirmPanel('Delete ' + (co.name || 'this change order') + ' at '
    + moneyText(BidMath.changeOrderPrice(co, bid, settings)) + "? This can't be undone.",
  { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  const job = bid.job;
  const i = job.changeOrders.indexOf(co);
  if (i !== -1) {
    job.changeOrders.splice(i, 1);
    persistOr(() => { job.changeOrders.splice(i, 0, co); });
  }
  jobCoMenu = null;
  render();
}

function buildChangeOrdersCard(bid, settings, done) {
  const box = card('Change orders');
  const list = bid.job.changeOrders || [];

  if (list.length === 0) {
    box.appendChild(emptyNote('No extra work yet.'));
  } else {
    list.forEach((co) => {
      // Priced on the spot off the change order's own areas and labor. It is
      // not stored anywhere, so there is nothing to write back and nothing to
      // go stale, and the proposal quotes the same function.
      const priceCents = BidMath.changeOrderPrice(co, bid, settings);
      // Three states, and only one of them is a price. Empty is a change order
      // he opened the moment the customer said the word and has not described
      // yet — it never prints, so the row says so instead of quoting $0.00.
      // Non-empty and still $0 is work with no money on it, which is the same
      // amber every other unpriced line on this bid gets.
      const empty = BidMath.changeOrderIsEmpty(co);
      box.appendChild(row(co.name || 'Change order', empty ? 'Nothing on it yet' : moneyText(priceCents),
        done ? null : () => {
          jobCoMenu = jobCoMenu === co ? null : co;
          render();
        }));
      if (!empty && !(priceCents > 0)) box.appendChild(unpricedWarn());
      if (jobCoMenu === co) {
        const acts = document.createElement('div');
        acts.className = 'job-actions';
        // The same two screens the bid itself uses, pointed at this change
        // order. Nothing about walking a room or picking a crew is written
        // twice in this app.
        acts.appendChild(textButton('Scope', 'btn',
          () => show('walk', { bidId: bid.id, changeOrderId: co.id })));
        acts.appendChild(textButton('Labor', 'btn',
          () => show('labor', { bidId: bid.id, changeOrderId: co.id })));
        acts.appendChild(textButton('Rename', 'btn', () => jobRenameChangeOrder(bid, co)));
        acts.appendChild(textButton('Delete', 'btn btn-danger-outline', () => jobDeleteChangeOrder(bid, co, settings)));
        box.appendChild(acts);
      }
    });
  }

  if (!done) {
    box.appendChild(textButton('+ Change order', 'btn btn-block', () => jobAddChangeOrder(bid)));
  }
  return box;
}

// ---------------------------------------------------------------------------
// BID VS ACTUAL
// ---------------------------------------------------------------------------

// The card the app is for. Four lines, no controls, and every figure handed
// over by BidMath.jobActuals — including the margin it started at, which is
// computed live off the stored rate rather than read out of the marginPct
// snapshot on the bid (that field stopped being true the first time a cost
// moved after the last handle edit).
function buildActualCard(actuals) {
  const box = card('Bid vs. actual');
  box.classList.add('job-actual');

  box.appendChild(row('Hours', numText(actuals.actualHours) + ' / ' + numText(actuals.bidHours)));
  box.appendChild(row('Surprises', moneyText(actuals.surpriseCents) + ' of ' + moneyText(actuals.setAsideCents)));
  box.appendChild(caption('set aside in the hours cushion'));

  box.appendChild(row('Price', moneyText(actuals.priceCents)));
  if (actuals.changeOrderCents !== 0) {
    box.appendChild(caption('includes ' + moneyText(actuals.changeOrderCents) + ' of change orders'));
  }

  const ok = marginOnTrack(actuals.marginStartPct, actuals.marginNowPct);
  const margin = row('Margin', pctText(actuals.marginStartPct) + ' → ' + pctText(actuals.marginNowPct));
  margin.classList.add(ok ? 'job-good' : 'job-bad');
  box.appendChild(margin);
  box.appendChild(caption('costing ' + moneyText(actuals.actualCostCents)
    + ', bid at ' + moneyText(actuals.trueCostCents)));
  box.appendChild(caption('overrun hours costed at wages and burden only'));

  return box;
}

// ---------------------------------------------------------------------------
// COMPLETE
// ---------------------------------------------------------------------------

async function jobMarkComplete(bid) {
  const ok = await confirmPanel('Mark this job complete? The job record stops taking changes.',
    { ok: 'Complete' });
  if (!ok) { render(); return; }
  const prevStatus = bid.status;
  const prevDone = bid.job.completedAt;
  bid.job.completedAt = Store.todayISO();
  bid.status = 'complete';
  persistOr(() => { bid.job.completedAt = prevDone; bid.status = prevStatus; });
  jobClearTransient();
  render();
}

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------

// RENDERING NEVER WRITES: nothing in this function, or anything it calls,
// mutates the bid or persists. A completed job is a record, and reading it
// must not be able to change it. Every save on this screen hangs off a tap.
function renderJob() {
  const host = el('jobContent');
  host.textContent = '';

  const bid = jobBid();
  if (!bid) {
    host.appendChild(emptyNote("That bid isn't here anymore. Tap Back to return to your bids."));
    return;
  }
  if (!bid.job) {
    // Reachable only by a stale navigation: the Job button appears on a won
    // bid, and winning is what creates the job.
    host.appendChild(emptyNote('This bid is not a job yet. Mark it Won on the bid screen.'));
    return;
  }

  const settings = jobSettings();
  const actuals = BidMath.jobActuals(bid, settings);
  const done = !!bid.job.completedAt;

  const head = document.createElement('div');
  head.className = 'labor-head';
  const title = document.createElement('div');
  title.className = 'labor-head-title';
  title.textContent = bid.title || 'No title yet';
  head.appendChild(title);
  const cust = document.createElement('div');
  cust.className = 'labor-head-cust';
  cust.textContent = bidCustomerName(bid, state.data);
  head.appendChild(cust);
  host.appendChild(head);

  if (done) {
    const line = document.createElement('div');
    line.className = 'job-done';
    line.textContent = 'Completed ' + fmtDate(bid.job.completedAt);
    host.appendChild(line);
  }

  host.appendChild(buildHoursCard(bid, actuals, done));
  host.appendChild(buildSurprisesCard(bid, done));
  host.appendChild(buildChangeOrdersCard(bid, settings, done));
  host.appendChild(buildActualCard(actuals));

  if (!done) {
    const nav = document.createElement('div');
    nav.className = 'bid-nav';
    nav.appendChild(textButton('Mark complete', 'btn btn-confirm btn-block', () => jobMarkComplete(bid)));
    host.appendChild(nav);
  }
}

registerScreen('job', { id: 'screen-job', title: 'Job', back: 'bid', tab: 'bids', enter: enterJob, render: renderJob });
