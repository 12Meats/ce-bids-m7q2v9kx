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
// exactly as it was. The only screen-local state is two things that are true
// for one render and then gone.

const LABOR_HPD_MIN = 1;
const LABOR_HPD_MAX = 16;
const LABOR_FIRST_TASK = 'Main work';

let laborNewTask = null;    // the task just added, flashed for a second
let laborShakeHpd = false;  // the hours-per-day row got a number it can't use
let laborHpdAsked = false;  // he has already agreed to change it once this session

function laborClearTransient() {
  laborNewTask = null;
  laborShakeHpd = false;
}

// The screen's enter hook. show('labor', id) opens that bid; show('labor') —
// what the bid screen and the Back button do — keeps the bid we already had.
// The walk compares the incoming bid id against the one its view state belongs
// to; this screen has no such view state to keep, so there is nothing to
// compare — the two transient flags are dropped on every entry, whichever bid
// we land on. A flash left over from another bid's task list would point at
// nothing.
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

function laborCaption(text) {
  const p = document.createElement('p');
  p.className = 'labor-caption';
  p.textContent = text;
  return p;
}

function laborPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

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
  box.appendChild(inlineWarn('Crew member no longer in Settings: ' + unknownIds.join(', ')));

  const actions = document.createElement('div');
  actions.className = 'labor-warn-actions';
  actions.appendChild(textButton('Remove', 'btn', () => {
    const gone = new Set(unknownIds);
    const labor = bid.labor;
    const prevCrew = (labor.crewIds || []).slice();
    const prevTasks = labor.tasks ? labor.tasks.map((t) => t.crewIds.slice()) : null;

    labor.crewIds = prevCrew.filter((id) => !gone.has(id));
    (labor.tasks || []).forEach((t) => { t.crewIds = t.crewIds.filter((id) => !gone.has(id)); });

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
    box.appendChild(laborCaption("Pick who's on this job."));
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
function buildReadout(bid) {
  const settings = laborSettings();
  const real = BidMath.laborReal(bid, settings);
  const cushionPct = bid.pricing.cushionPct;

  const box = card();
  box.className += ' labor-readout';
  box.appendChild(row('Real hours', numText(real.hours)));
  box.appendChild(row('Wages', moneyText(real.wageCents)));
  box.appendChild(laborCaption('at real wages, before burden'));
  box.appendChild(row('Bid hours', numText(BidMath.bidHours(real.hours, cushionPct))));
  box.appendChild(laborCaption('includes ' + numText(cushionPct) + '% cushion'));
  return box;
}

// The quiet row that decides what "a day" means everywhere in the app. It
// lives here because this is the screen where the answer matters, but it is a
// Settings value and it changes every bid he writes after today, so the first
// change of a session asks before the keypad opens.
function buildHoursPerDayRow() {
  const btn = textButton(
    laborPlural(laborHoursPerDay(), 'hour', 'hours') + ' per day · change',
    'link-btn labor-hpd',
    async () => {
      if (!laborHpdAsked) {
        const ok = await confirmPanel('Change hours per day for all future bids?');
        if (!ok) { render(); return; }
        laborHpdAsked = true;
      }
      promptNumber(laborHoursPerDay(), {
        label: 'Hours in a work day',
        done: (v) => {
          if (v === null) return;
          if (!Number.isInteger(v) || v < LABOR_HPD_MIN || v > LABOR_HPD_MAX) {
            laborShakeHpd = true;
            showBanner('A work day is between ' + LABOR_HPD_MIN + ' and ' + LABOR_HPD_MAX + ' whole hours');
            render();
            return;
          }
          const settings = laborSettings();
          const prev = settings.hoursPerDay;
          settings.hoursPerDay = v;
          persistOr(() => { settings.hoursPerDay = prev; });
          render();
        },
      });
    }
  );
  return btn;
}

// ---------------------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------------------

// What one task is worth on its own, in the words he would use: the crew, the
// days, and the hours those two make. BidMath adds the same numbers up for the
// readout, so a task's caption and the total can never disagree.
function laborTaskHoursText(task) {
  const crew = (task.crewIds || []).length;
  const hours = task.days * laborHoursPerDay() * crew;
  if (crew === 0) return '0 hours — nobody on this task yet';
  return numText(hours) + ' hours (' + laborPlural(crew, 'guy', 'guys')
    + ' × ' + laborPlural(task.days, 'day', 'days') + ')';
}

function buildTaskCard(bid, task) {
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
  box.appendChild(laborCaption(laborTaskHoursText(task)));

  const actions = document.createElement('div');
  actions.className = 'labor-task-actions';
  actions.appendChild(textButton('Delete', 'btn btn-danger-outline', () => laborDeleteTask(bid, task)));
  box.appendChild(actions);

  return box;
}

async function laborDeleteTask(bid, task) {
  const ok = await confirmPanel('Delete ' + (task.name || 'this task') + '?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }

  const labor = bid.labor;
  const i = labor.tasks.indexOf(task);
  if (i === -1) { render(); return; }

  const prevTasks = labor.tasks;
  const prevDays = labor.days;
  const rest = labor.tasks.filter((t) => t !== task);
  // An empty task list is not a state this screen may leave behind: BidMath
  // reads tasks:[] as "no tasks", falls back to the single line, and the
  // readout would quietly start reporting a day count nothing on screen shows.
  // Deleting the last task means there is no labor left, so say exactly that.
  if (rest.length === 0) {
    labor.tasks = null;
    labor.days = 0;
  } else {
    labor.tasks = rest;
  }
  persistOr(() => { labor.tasks = prevTasks; labor.days = prevDays; });
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

async function laborMergeBack(bid) {
  const ok = await confirmPanel('Combine tasks into one line? Task names are lost.', { ok: 'Combine' });
  if (!ok) { render(); return; }

  const labor = bid.labor;
  const merged = BidMath.mergeTasks(labor, laborHoursPerDay());
  const prevCrew = labor.crewIds;
  const prevDays = labor.days;
  const prevTasks = labor.tasks;

  labor.crewIds = merged.crewIds;
  labor.days = merged.days;
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

  labor.tasks.forEach((task) => host.appendChild(buildTaskCard(bid, task)));

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

  // Above everything, in both modes: an unknown crew id can be sitting on a
  // task just as easily as on the bid's own line, and it is under-pricing the
  // job either way.
  const unknown = BidMath.laborReal(bid, laborSettings()).unknownCrewIds;
  if (unknown.length) host.appendChild(laborUnknownWarn(bid, unknown));

  // The crew/days pair is the single line. Once it has been split, the tasks
  // own both, and showing a second set here would be two answers to the same
  // question — so the pair steps aside and the readout keeps totalling.
  if (bid.labor.tasks === null) {
    host.appendChild(buildCrewCard(bid));
    const daysBox = card();
    daysBox.appendChild(laborDaysRow('Days on the job', bid.labor));
    host.appendChild(daysBox);
  }

  host.appendChild(buildReadout(bid));

  const hpd = buildHoursPerDayRow();
  host.appendChild(hpd);
  if (laborShakeHpd) shake(hpd);
  laborShakeHpd = false;

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
