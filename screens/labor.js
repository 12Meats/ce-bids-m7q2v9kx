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
// Which change order's labor the screen is editing, or null for the bid's own.
// A change order is priced off the same crew and days as the bid it hangs on,
// so it is this screen pointed at a different labor line rather than a second
// crew picker written somewhere else.
let laborCoId = null;

function laborClearTransient() {
  laborNewTask = null;
}

// The screen's enter hook. show('labor', id) opens that bid's own labor;
// show('labor', { bidId, changeOrderId }) opens one change order's;
// show('labor') — the Back button — keeps whichever we already had. The walk
// compares the incoming target against the one its view state belongs to; this
// screen has no such view state to keep, so there is nothing to compare — the
// flash is dropped on every entry, whichever line we land on. One left over
// from another task list would point at nothing.
function enterLabor(arg) {
  if (arg !== undefined) {
    const t = navTarget(arg);
    if (t.bidId) state.bidId = t.bidId;
    laborCoId = t.changeOrderId;
  }
  laborClearTransient();
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function laborBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

// The change order being edited, or null when this is the bid's own labor.
function laborChangeOrder(bid) {
  if (!laborCoId || !bid) return null;
  return ((bid.job && bid.job.changeOrders) || []).find((c) => c.id === laborCoId) || null;
}

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
function laborReferencedCrewIds(edit) {
  const labor = edit.labor;
  const ids = new Set(labor.crewIds || []);
  (labor.tasks || []).forEach((t) => (t.crewIds || []).forEach((id) => ids.add(id)));
  return ids;
}

// Who gets offered. Hiding a crew member in Settings takes him off future
// bids, not off the ones he is already on: an old bid he worked has to stay
// editable, and a chip that vanishes takes the only way to un-select it with
// it. So: everyone still visible, plus anyone this bid already names.
function laborOfferedCrew(edit) {
  const referenced = laborReferencedCrewIds(edit);
  return laborSettings().crew.filter((c) => c.hidden === false || referenced.has(c.id));
}

// One row of chips writing to holder.crewIds — the bid's own labor line, or a
// single task. Both obey the same rules, so both come through here.
function laborCrewChips(edit, holder) {
  const wrap = document.createElement('div');
  wrap.className = 'labor-chips';

  laborOfferedCrew(edit).forEach((c) => {
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
function laborUnknownWarn(edit, unknownIds) {
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
    const labor = edit.labor;
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

function buildCrewCard(edit) {
  const box = card('Crew');
  box.appendChild(laborCrewChips(edit, edit.labor));
  if ((edit.labor.crewIds || []).length === 0) {
    box.appendChild(emptyNote("Pick who's on this job."));
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
function laborDaysRow(label, holder, promptLabel) {
  const line = row(label, numText(holder.days), () => {
    promptNumber(holder.days, {
      label: promptLabel || label,
      allowDecimal: true,
      // Quarter and half days are real; a third decimal is a fat-fingered tap.
      maxDecimals: 2,
      // Characters, not digits — the cap counts the decimal point too, and
      // "365.25" is six of them.
      maxChars: 6,
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
  }, { keypad: true });
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

// The sentence he already says out loud, at the top of the screen and in the
// biggest type on it: "2 guys × 3 days = 48 hrs". The hours were only ever in
// a readout below the fold, so the one number this screen exists to produce
// was the one thing it never showed him.
//
// Once the job is split into tasks there is no single crew and no single day
// count to say it with — the tasks each have their own — so what stays is the
// number itself, which is still the answer to the same question.
function buildLaborBigNumber(edit, real) {
  const box = card();
  box.classList.add('labor-big');

  const big = document.createElement('div');
  big.className = 'labor-big-line';
  const labor = edit.labor;
  big.textContent = (labor.tasks === null)
    ? crewDaysText((labor.crewIds || []).length, labor.days, real.hours)
    : laborPlural(real.hours, 'hr', 'hrs');
  box.appendChild(big);

  if (labor.tasks !== null) box.appendChild(caption('Across ' + laborPlural(labor.tasks.length, 'task', 'tasks') + '.'));
  return box;
}

// What "a day" means everywhere in the app. It lives on this screen because
// this is where the answer matters, but it is a SETTINGS value: it re-figures
// the hours, and therefore the price, on every bid in the file — including
// ones already in a customer's inbox. So it asks EVERY time, not once a
// session.
//
// And it is deliberately quiet now. It used to be the only chevron on the
// screen, which made the one global setting here look like the main road
// through it: he tapped it looking for this bid's hours. It reads as the fact
// it is, with a small Change beside it, and the every-bid confirm is unchanged.
function buildHoursPerDayRow() {
  const box = card();
  const line = document.createElement('div');
  line.className = 'labor-hpd';

  const text = document.createElement('span');
  text.className = 'labor-hpd-text';
  text.textContent = 'A work day is ' + laborPlural(laborHoursPerDay(), 'hour', 'hours')
    + '. Changes every bid, not just this one.';
  line.appendChild(text);

  line.appendChild(textButton('Change', 'link-btn labor-hpd-change', async () => {
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
  }));

  box.appendChild(line);
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

function buildTaskCard(edit, task, only) {
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

  box.appendChild(laborCrewChips(edit, task));
  // The keypad names the task: three cards of "Days on the job" in a row is
  // three identical questions with three different right answers.
  box.appendChild(laborDaysRow('Days', task, 'Days on "' + (task.name || 'Task') + '"'));
  box.appendChild(caption(laborTaskHoursText(task)));

  // Days on it and nobody on it. The caption above already says "0 hours", but
  // a zero reads like a number he is about to fill in; this says the days are
  // costing him truck and gas in the meantime, and it is the same sentence the
  // Costs & price screen puts on the labor line. Merge back refuses this card
  // by name, so flagging it here is what stops him meeting that refusal cold.
  if (BidMath.crewlessTasks({ tasks: [task] }).length) box.appendChild(inlineWarn(CREWLESS_TASK_WARN));

  // Deleting the last task would leave labor.tasks as [], which BidMath reads
  // as "no tasks at all" - the readout would silently fall back to the bid's
  // own line and start quoting a day count nothing on screen shows. There is
  // already a door out of task mode, so on the last task Delete is simply not
  // here. It used to be a dead red button, which reads as an app that is
  // broken rather than as a door that is somewhere else.
  if (!only) {
    const actions = document.createElement('div');
    actions.className = 'labor-task-actions';
    actions.appendChild(textButton('Delete', 'btn btn-danger-outline', () => laborDeleteTask(edit, task)));
    box.appendChild(actions);
  } else {
    box.appendChild(caption('Use Merge back to return to one line.'));
  }

  return box;
}

async function laborDeleteTask(edit, task) {
  const ok = await confirmPanel('Delete ' + (task.name || 'this task') + '?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }

  const labor = edit.labor;
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

function laborSplitIntoTasks(edit) {
  const labor = edit.labor;
  const prev = labor.tasks;
  // The split has to be a no-op on the numbers: one task carrying exactly the
  // crew and days that were already there, so the readout doesn't move.
  labor.tasks = [{ name: LABOR_FIRST_TASK, crewIds: (labor.crewIds || []).slice(), days: labor.days }];
  persistOr(() => { labor.tasks = prev; });
  render();
}

function laborAddTask(edit) {
  promptText('', {
    label: 'Task name',
    placeholder: 'What this part of the job is',
    done: (name) => {
      if (!name) return;
      const labor = edit.labor;
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
async function laborMergeBack(bid, edit) {
  const settings = laborSettings();
  const merged = BidMath.mergeTasks(edit.labor);
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

  // What the merge does to the money is asked of the thing being merged: the
  // bid, or the change order priced the way BidMath prices one. Handing
  // costStack a raw change order would price it against the bid's materials.
  const priceable = edit === bid ? bid : BidMath.changeOrderScratch(edit, bid);
  const before = BidMath.costStack(priceable, settings);
  const after = BidMath.costStack(Object.assign({}, priceable, { labor: mergedLabor }), settings);

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

  const labor = edit.labor;
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

function buildTasksSection(bid, edit, host) {
  const labor = edit.labor;

  if (labor.tasks === null) {
    // Outlined in the accent, not the plain grey the pinned Next used to
    // share with it: two identical-looking block buttons one above the other
    // is two primary actions, and only one of them is the way forward.
    host.appendChild(textButton('Split into tasks', 'btn btn-block btn-outline', () => laborSplitIntoTasks(edit)));
    return;
  }

  const heading = document.createElement('h3');
  heading.className = 'section-heading';
  heading.textContent = 'Tasks';
  host.appendChild(heading);

  const only = labor.tasks.length === 1;
  labor.tasks.forEach((task) => host.appendChild(buildTaskCard(edit, task, only)));

  const actions = document.createElement('div');
  actions.className = 'bid-nav';
  actions.appendChild(textButton('+ Add task', 'btn btn-primary btn-block', () => laborAddTask(edit)));
  actions.appendChild(textButton('Merge back into one line', 'btn btn-block', () => laborMergeBack(bid, edit)));
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

  // A change order deleted on the job screen leaves this screen pointing at
  // nothing. Say so rather than putting live crew chips on the glass.
  const co = laborChangeOrder(bid);
  if (laborCoId && !co) {
    host.appendChild(emptyNote("That change order isn't here anymore. Tap Back to return to the job."));
    return;
  }
  const edit = co || bid;

  // A change order has a walk and a labor screen and nothing else, so it gets
  // no strip: the four steps belong to the bid.
  if (!co) host.appendChild(stepStrip(bid, laborSettings(), 'labor'));

  host.appendChild(screenHead(
    co ? ('Change order: ' + (co.name || 'Change order')) : (bid.title || 'No title yet'),
    co ? (bid.title || bidCustomerName(bid, state.data)) : bidCustomerName(bid, state.data)
  ));

  // Read once and passed down: the readout wants the hours and the wages, the
  // warning wants the unknown ids, and they must be the same reading of the
  // same labor line — not two calls a mutation could land between.
  const real = BidMath.laborReal(edit, laborSettings());

  // Above everything, in both modes: an unknown crew id can be sitting on a
  // task just as easily as on the bid's own line, and it is under-pricing the
  // job — and blocking every save — either way.
  if (real.unknownCrewIds.length) host.appendChild(laborUnknownWarn(edit, real.unknownCrewIds));

  // Before the controls, not after them: the answer he came for goes at the
  // top, and the crew chips and the day count under it are how he changes it.
  host.appendChild(buildLaborBigNumber(edit, real));

  // The crew/days pair is the single line. Once it has been split, the tasks
  // own both, and showing a second set here would be two answers to the same
  // question — so the pair steps aside and the readout keeps totalling.
  if (edit.labor.tasks === null) {
    host.appendChild(buildCrewCard(edit));
    const daysBox = card();
    daysBox.appendChild(laborDaysRow('Days on the job', edit.labor, 'Days on the job'));
    host.appendChild(daysBox);
  }

  // The cushion is the bid's, on a change order as much as on the bid: extra
  // work sold in September is quoted the way the job was sold in August.
  host.appendChild(buildReadout(bid, real));
  host.appendChild(buildHoursPerDayRow());

  buildTasksSection(bid, edit, host);

  // A change order has no price screen of its own - its price is worked out on
  // the job screen, which is where this leads.
  if (co) pinnedBar(host, 'Done, back to the job', () => show('job', bid.id));
  else pinnedBar(host, 'Next: Costs & price', () => show('price', bid.id));
}

// title and back are functions for the same reason the walk's are: this screen
// edits either the bid's labor or one change order's, and the shell reads both
// after enter() has settled which.
registerScreen('labor', {
  id: 'screen-labor', tab: 'bids',
  title: () => {
    const co = laborChangeOrder(laborBid());
    return co ? 'Change order: ' + (co.name || 'Change order') : 'Labor';
  },
  back: () => (laborCoId ? 'job' : 'bid'),
  enter: enterLabor, render: renderLabor,
});
