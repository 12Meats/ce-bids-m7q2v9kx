'use strict';

// screens/labor.js — how long the job takes and who is on it.
//
// The whole screen exists to turn the sentence the owner already says out loud
// — "two guys, four days" — into the two numbers the price is built from: real
// hours and bid hours. Crew is chips, days is one tap on the keypad, and the
// readout underneath shows what those two choices just cost.
//
// Most jobs never need more than that one line. The ones that do — a shutdown
// where the crew splits, a job with a rough-in week and a trim-out day — get
// **Split into tasks**: the same crew/days pair, once per task, adding up to
// the same readout. Merging back collapses them into one line of the same
// size (the rule lives in BidMath.mergeTasks, where it is tested).
//
// Hours per day is the one Settings value reachable from here, because it is
// the number that silently decides what "a day" means. Changing it changes
// every future bid, so it asks first.
//
// Every mutation is snapshot -> mutate -> persistOr(revert), and nothing
// navigates after a refused save.
//
// Sections, in order:
//   VIEW STATE     — the enter hook and the two transient flags
//   CREW           — the chips, and the warning for crew that no longer exist
//   DAYS / READOUT — one number, and what it works out to
//   TASKS          — split, edit, add, delete, merge back
//   REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------
// There is no view to remember here: the chips, the day count and the task
// list are all read straight off the bid, so a re-render rebuilds the screen
// exactly as it was. The one piece of screen-local state is the flash on a
// just-added task, true for a render and then gone.
//
// A rejected number doesn't need state either: nothing was written, so there
// is nothing to re-render — the row that was tapped is still on the glass and
// gets shaken where it stands.

const LABOR_HPD_MIN = 1;
const LABOR_HPD_MAX = 16;
// A year on one bid. Not a real limit on the work, a limit on the typo: 22
// meant as 2 is a day count he might not read twice, 2222 is one he will.
const LABOR_MAX_DAYS = 365;
const LABOR_FIRST_TASK = 'Main work';

let laborNewTask = null;    // the task just added, flashed for a second

function laborClearTransient() {
  laborNewTask = null;
}

// The screen's enter hook. show('labor', id) opens that bid; show('labor') —
// what the bid screen and the Back button do — keeps the bid we already had.
// The walk compares the incoming bid id against the one its view state belongs
// to; this screen has no such view state to keep, so there is nothing to
// compare — the flash is dropped on every entry, whichever bid we land on. One
// left over from another bid's task list would point at nothing.
function enterLabor(bidId) {
  if (typeof bidId === 'string' && bidId) state.bidId = bidId;
  laborClearTransient();
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function laborBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

function laborSettings() { return state.data.settings; }

function laborHoursPerDay() { return laborSettings().hoursPerDay || 8; }

// numText, not String(n): 0.1 + 0.2 days is 0.30000000000000004, and "two
// guys × 0.30000000000000004 days" is not a sentence anyone should read.
function laborPlural(n, one, many) { return numText(n) + ' ' + (n === 1 ? one : many); }

// ---------------------------------------------------------------------------
// CREW
// ---------------------------------------------------------------------------

// Every crew id this bid points at, wherever it points at it. Two things read
// this: which hidden crew still get a chip, and what "Remove" has to reach.
function laborReferencedCrewIds(bid) {
  const labor = bid.labor;
  const ids = new Set(labor.crewIds || []);
  (labor.tasks || []).forEach((t) => (t.crewIds || []).forEach((id) => ids.add(id)));
  return ids;
}

// Who gets offered. Hiding a crew member in Settings takes him off future
// bids, not off the ones he is already on: an old bid he worked has to stay
// editable, and a chip that vanishes takes the only way to un-select it with
// it. So: everyone still visible, plus anyone this bid already names.
function laborOfferedCrew(bid) {
  const referenced = laborReferencedCrewIds(bid);
  return laborSettings().crew.filter((c) => c.hidden === false || referenced.has(c.id));
}

// One row of chips writing to holder.crewIds — the bid's own labor line, or a
// single task. Both obey the same rules, so both come through here.
function laborCrewChips(bid, holder) {
  const wrap = document.createElement('div');
  wrap.className = 'labor-chips';

  laborOfferedCrew(bid).forEach((c) => {
    const on = (holder.crewIds || []).indexOf(c.id) !== -1;
    wrap.appendChild(chip(c.name || 'Crew', on, () => {
      const prev = (holder.crewIds || []).slice();
      holder.crewIds = on ? prev.filter((id) => id !== c.id) : prev.concat([c.id]);
      persistOr(() => { holder.crewIds = prev; });
      render();
    }));
  });

  return wrap;
}

// A crew id that isn't in Settings any more bills at $0 (BidMath refuses to
// throw on a stale bid), which is a silently under-priced job — so it is said
// out loud, with the one-tap way to fix it. The ids are shown as themselves:
// there is no name left to show, and the id is what he'd hunt for in a backup.
function laborUnknownWarn(bid, unknownIds) {
  const box = document.createElement('div');
  // Not just a display problem: Store.save validates crew ids against Settings
  // and refuses the whole document, so every other edit on this screen is
  // bouncing off the disk until this is cleared. He has to be told that.
  box.appendChild(inlineWarn('Crew member no longer in Settings: ' + unknownIds.join(', ')
    + '. Nothing on this bid will save until this is fixed.'));

  const actions = document.createElement('div');
  actions.className = 'labor-warn-actions';
  actions.appendChild(textButton('Remove', 'btn', () => {
    const gone = new Set(unknownIds);
    const labor = bid.labor;
    const prevCrew = (labor.crewIds || []).slice();
    const prevTasks = labor.tasks ? labor.tasks.map((t) => (t.crewIds || []).slice()) : null;

    labor.crewIds = prevCrew.filter((id) => !gone.has(id));
    (labor.tasks || []).forEach((t) => { t.crewIds = (t.crewIds || []).filter((id) => !gone.has(id)); });

    persistOr(() => {
      labor.crewIds = prevCrew;
      if (prevTasks) labor.tasks.forEach((t, i) => { t.crewIds = prevTasks[i]; });
    });
    render();
  }));
  box.appendChild(actions);

  return box;
}

function buildCrewCard(bid) {
  const box = card('Crew');
  box.appendChild(laborCrewChips(bid, bid.labor));
  if ((bid.labor.crewIds || []).length === 0) {
    box.appendChild(caption("Pick who's on this job."));
  }
  return box;
}

// ---------------------------------------------------------------------------
// DAYS / READOUT
// ---------------------------------------------------------------------------

// The one number on this screen he actually types. Half days are real (a
// service call is half a day), zero is real (a job priced on material alone),
// and Clear means "never mind" rather than zero — the row is one tap away if
// zero is what he meant.
function laborDaysRow(label, holder) {
  const line = row(label, numText(holder.days), () => {
    promptNumber(holder.days, {
      label: 'Days on the job',
      allowDecimal: true,
      maxDigits: 5,
      done: (v) => {
        if (v === null) return;
        if (v > LABOR_MAX_DAYS) {
          // Nothing was written, so there is nothing to re-render: the row he
          // tapped is still on the glass, and it is the thing that is wrong.
          showBanner('That is more than a year — check the number of days');
          shake(line);
          return;
        }
        const prev = holder.days;
        holder.days = v;
        persistOr(() => { holder.days = prev; });
        render();
      },
    });
  });
  line.classList.add('labor-days');
  return line;
}

// What the two choices above add up to. Real hours and wages are what the job
// costs him; bid hours is what the customer is quoted, cushion included. Both
// are on screen because pricing off the wrong one is the mistake this whole
// app is trying to stop.
function buildReadout(bid, real) {
  // costStack reads the cushion the same defensive way; a bid that somehow
  // arrived without one is quoted at its real hours, not at NaN.
  const cushionPct = bid.pricing.cushionPct != null ? bid.pricing.cushionPct : 0;

  const box = card();
  box.className += ' labor-readout';
  box.appendChild(row('Real hours', numText(real.hours)));
  box.appendChild(row('Wages', moneyText(real.wageCents)));
  box.appendChild(caption('at real wages, before burden'));
  box.appendChild(row('Bid hours', numText(BidMath.bidHours(real.hours, cushionPct))));
  box.appendChild(caption('includes ' + numText(cushionPct) + '% cushion'));
  return box;
}

// The row that decides what "a day" means everywhere in the app. It lives here
// because this is the screen where the answer matters, but it is a Settings
// value: it re-figures the hours, and therefore the price, on every bid in the
// file — including ones already in a customer's inbox. So it asks EVERY time,
// not once a session: the second change of the day is exactly as far-reaching
// as the first, and a screen that stops asking has stopped telling the truth.
function buildHoursPerDayRow() {
  const box = card();
  const line = row('Hours per day', laborPlural(laborHoursPerDay(), 'hour', 'hours'), async () => {
    const ok = await confirmPanel(
      'Change hours per day? This re-figures the hours and price on EVERY bid, including ones already sent.'
    );
    if (!ok) return;
    promptNumber(laborHoursPerDay(), {
      label: 'Hours in a work day',
      done: (v) => {
        if (v === null) return;
        if (!Number.isInteger(v) || v < LABOR_HPD_MIN || v > LABOR_HPD_MAX) {
          showBanner('A work day is between ' + LABOR_HPD_MIN + ' and ' + LABOR_HPD_MAX + ' whole hours');
          shake(line);
          return;
        }
        const settings = laborSettings();
        const prev = settings.hoursPerDay;
        settings.hoursPerDay = v;
        persistOr(() => { settings.hoursPerDay = prev; });
        render();
      },
    });
  });
  line.classList.add('labor-hpd');

  const chevron = document.createElement('span');
  chevron.className = 'labor-hpd-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');
  line.appendChild(chevron);

  box.appendChild(line);
  box.appendChild(caption('Changes every bid, not just this one.'));
  return box;
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

// What one task is worth on its own, in the words he would use. The hours come
// from BidMath.lineHours — the same function laborReal sums for the readout, so
// the captions and the total are the same arithmetic by construction and can
// never drift apart.
function laborTaskHoursText(task) {
  const crew = (task.crewIds || []).length;
  if (crew === 0) return '0 hours — nobody on this task yet';
  return numText(BidMath.lineHours(task, laborHoursPerDay())) + ' hours ('
    + laborPlural(crew, 'guy', 'guys') + ' × ' + laborPlural(task.days, 'day', 'days') + ')';
}

function buildTaskCard(bid, task, only) {
  const box = card();
  if (laborNewTask === task) box.classList.add('labor-task-new');

  box.appendChild(row('Task', task.name || 'Task', () => {
    promptText(task.name, {
      label: 'Task name',
      placeholder: 'What this part of the job is',
      done: (name) => {
        if (!name) return;
        const prev = task.name;
        task.name = name;
        persistOr(() => { task.name = prev; });
        render();
      },
    });
  }));

  box.appendChild(laborCrewChips(bid, task));
  box.appendChild(laborDaysRow('Days', task));
  box.appendChild(caption(laborTaskHoursText(task)));

  const actions = document.createElement('div');
  actions.className = 'labor-task-actions';
  const del = textButton('Delete', 'btn btn-danger-outline', only ? null : () => laborDeleteTask(bid, task));
  // Deleting the last task would leave labor.tasks as [], which BidMath reads
  // as "no tasks at all" — the readout would silently fall back to the bid's
  // own line and start quoting a day count nothing on screen shows. There is
  // already a door out of task mode, so this one is closed and points at it.
  del.disabled = !!only;
  actions.appendChild(del);
  box.appendChild(actions);
  if (only) box.appendChild(caption('Use Merge back to return to one line.'));

  return box;
}

async function laborDeleteTask(bid, task) {
  const ok = await confirmPanel('Delete ' + (task.name || 'this task') + '?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }

  const labor = bid.labor;
  const i = labor.tasks.indexOf(task);
  if (i === -1) { render(); return; }

  // The button that got us here is disabled on the last task, so this can only
  // ever leave a non-empty list. Belt and braces, because tasks:[] is a state
  // the rest of the app would read as "no tasks" and quietly mis-price.
  if (labor.tasks.length < 2) { render(); return; }

  const prevTasks = labor.tasks;
  labor.tasks = labor.tasks.filter((t) => t !== task);
  persistOr(() => { labor.tasks = prevTasks; });
  laborNewTask = null;
  render();
}

function laborSplitIntoTasks(bid) {
  const labor = bid.labor;
  const prev = labor.tasks;
  // The split has to be a no-op on the numbers: one task carrying exactly the
  // crew and days that were already there, so the readout doesn't move.
  labor.tasks = [{ name: LABOR_FIRST_TASK, crewIds: (labor.crewIds || []).slice(), days: labor.days }];
  persistOr(() => { labor.tasks = prev; });
  render();
}

function laborAddTask(bid) {
  promptText('', {
    label: 'Task name',
    placeholder: 'What this part of the job is',
    done: (name) => {
      if (!name) return;
      const labor = bid.labor;
      // Seeded with the bid's own crew — the usual crew — and no days, because
      // the days are the thing he is about to think about.
      const task = { name, crewIds: (labor.crewIds || []).slice(), days: 0 };
      labor.tasks.push(task);
      if (!persistOr(() => {
        const i = labor.tasks.indexOf(task);
        if (i !== -1) labor.tasks.splice(i, 1);
      })) { render(); return; }
      laborNewTask = task;
      render();
    },
  });
}

// The merge is exact on hours and NOT exact on money: the union crew now
// covers the whole job (an expensive man who worked one task bills for all of
// it), and the truck bills off one day count instead of the sum of the tasks'.
// So the question shows the shape he is about to get, says the hours are safe,
// and puts the two true-cost numbers side by side. Both come from costStack —
// the after figure off a clone, so asking is never a change.
async function laborMergeBack(bid) {
  const settings = laborSettings();
  const merged = BidMath.mergeTasks(bid.labor);
  // A task with days on it and nobody on it has no honest merged reading, so
  // BidMath refuses rather than guessing. Nothing was written and nothing on
  // screen has changed, so there is no render to do — just the answer, naming
  // the task and both ways out of it.
  if (!merged.ok) {
    showBanner((merged.taskName || 'A task')
      + ' has nobody on it — put a crew on it or delete it before combining');
    return;
  }

  const mergedLabor = { crewIds: merged.crewIds, days: merged.days, tasks: null };

  const before = BidMath.costStack(bid, settings);
  const after = BidMath.costStack(Object.assign({}, bid, { labor: mergedLabor }), settings);

  const crewCount = merged.crewIds.length;
  // An empty union now means every task was crewless with 0 days, so the
  // merged line is 0 days with nobody on it — an empty line, not a crew size.
  const shape = crewCount === 0
    ? 'one empty line'
    : laborPlural(crewCount, 'guy', 'guys') + ' × ' + laborPlural(merged.days, 'day', 'days');
  const money = before.trueCost === after.trueCost
    ? 'True cost stays ' + moneyText(after.trueCost) + '.'
    : 'True cost ' + moneyText(before.trueCost) + ' → ' + moneyText(after.trueCost) + '.';
  // Same shape as the money line, and for the same reason: the sentence is
  // read off the two numbers rather than asserting what they ought to be. With
  // the refusal above this should always read "stay", and if it ever doesn't,
  // the screen says so instead of promising something that isn't true.
  const hoursLine = before.realHours === after.realHours
    ? 'Labor hours stay ' + numText(after.realHours) + '.'
    : 'Labor hours ' + numText(before.realHours) + ' → ' + numText(after.realHours) + '.';

  const ok = await confirmPanel(
    'Combine into ' + shape + '? ' + hoursLine + ' ' + money + ' Task names are lost.',
    { ok: 'Combine' }
  );
  if (!ok) { render(); return; }

  const labor = bid.labor;
  const prevCrew = labor.crewIds;
  const prevDays = labor.days;
  const prevTasks = labor.tasks;

  labor.crewIds = mergedLabor.crewIds;
  labor.days = mergedLabor.days;
  labor.tasks = null;
  persistOr(() => { labor.crewIds = prevCrew; labor.days = prevDays; labor.tasks = prevTasks; });
  laborNewTask = null;
  render();
}

function buildTasksSection(bid, host) {
  const labor = bid.labor;

  if (labor.tasks === null) {
    host.appendChild(textButton('Split into tasks', 'btn btn-block', () => laborSplitIntoTasks(bid)));
    return;
  }

  const heading = document.createElement('h3');
  heading.className = 'section-heading';
  heading.textContent = 'Tasks';
  host.appendChild(heading);

  const only = labor.tasks.length === 1;
  labor.tasks.forEach((task) => host.appendChild(buildTaskCard(bid, task, only)));

  const actions = document.createElement('div');
  actions.className = 'bid-nav';
  actions.appendChild(textButton('+ Add task', 'btn btn-primary btn-block', () => laborAddTask(bid)));
  actions.appendChild(textButton('Merge back into one line', 'btn btn-block', () => laborMergeBack(bid)));
  host.appendChild(actions);
}

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------

function renderLabor() {
  const host = el('laborContent');
  host.textContent = '';

  const bid = laborBid();
  if (!bid) {
    host.appendChild(emptyNote("That bid isn't here anymore. Tap Back to return to your bids."));
    return;
  }

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

  // Read once and passed down: the readout wants the hours and the wages, the
  // warning wants the unknown ids, and they must be the same reading of the
  // same bid — not two calls a mutation could land between.
  const real = BidMath.laborReal(bid, laborSettings());

  // Above everything, in both modes: an unknown crew id can be sitting on a
  // task just as easily as on the bid's own line, and it is under-pricing the
  // job — and blocking every save — either way.
  if (real.unknownCrewIds.length) host.appendChild(laborUnknownWarn(bid, real.unknownCrewIds));

  // The crew/days pair is the single line. Once it has been split, the tasks
  // own both, and showing a second set here would be two answers to the same
  // question — so the pair steps aside and the readout keeps totalling.
  if (bid.labor.tasks === null) {
    host.appendChild(buildCrewCard(bid));
    const daysBox = card();
    daysBox.appendChild(laborDaysRow('Days on the job', bid.labor));
    host.appendChild(daysBox);
  }

  host.appendChild(buildReadout(bid, real));
  host.appendChild(buildHoursPerDayRow());

  buildTasksSection(bid, host);

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('Next: Costs & price →', 'btn btn-block', () => show('price', bid.id)));
  host.appendChild(nav);
}

registerScreen('labor', {
  id: 'screen-labor', title: 'Labor', back: 'bid', tab: 'bids',
  enter: enterLabor, render: renderLabor,
});
