'use strict';
// screens/log.js — one invoice in progress, kept at the truck as the job runs.
//
// This is the first of the three moments the Invoices tab is built around, and
// it is the one that has to be quick: he is standing at the tailgate with the
// phone in one hand. Nothing here is typed that can be tapped. The customer is
// a chip, the project is a chip, the dates come off a calendar, the hours are a
// keypad each, and the parts come through the same picker the walk uses, so the
// flow he already knows is the flow he gets here.
//
// It was a page about ONE DAY until the first week on v3. What he actually does
// is open the invoice when the job starts, add to it as the week goes, and say
// it is finished when the work is: so an entry carries a From and a To he moves
// as it runs on, and a switch that says Ready. Nothing merges on its own and
// nothing is billed on its own. The number is not spent until Bill these, which
// the caption at the top says out loud.
//
// A NEW entry lives in memory until Save: Back throws it away, and nothing
// half-logged can end up in the list waiting to be billed. An entry he opens
// again from the list is edited in place and saves as he goes, the way the
// walk does, because it is already a thing that exists. One entry that is
// already on an invoice is read-only — the invoice is the record now, and
// changing the hours under it would make the paper a lie.
//
// Sections: VIEW STATE · CUSTOMER · PROJECT · FROM AND TO · READY TO BILL ·
// WHO AND HOURS · PARTS, RENTALS, EQUIPMENT · NOTES · SAVE · REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

let logId = null;                 // the entry being edited, or null for a new one
let logDraft = null;              // a new entry's fields, held here until Save
let logPicker = pickerState();    // the add-a-part flow's own state
let logView = 'entry';            // 'entry' | 'add'
let logItemMenu = null;           // the item showing its action strip
let logRentalMenu = null;         // the rental showing its action strip
let logEquipMenu = null;          // the equipment line showing its action strip
let logSheet = null;             // 'equip' while the equipment picker is up
let logDiscardAsking = false;     // true while "Throw this visit away?" is up

const LOG_CAPTION_PROJECT = 'Pick the job this visit belongs to. A title stays here until you mark it done.';

// The one line at the top of an entry that is not billed yet. He asked where
// the number was on his first day: it is not spent until Bill these, and a
// screen that never says so reads like a number that failed to appear.
const LOG_NUMBER_CAPTION = 'It gets its number when you bill it.';

// What the top bar says. An entry IS the invoice now, before it has a number;
// once an invoice carries its hours the invoice is the record and this screen
// is only what happened on the day. Read off the FILE rather than off
// logTarget(), which builds a draft as a side effect of being asked.
function logScreenTitle() {
  const d = logData();
  const e = logId && d ? (d.logs || []).find((x) => x.id === logId) : null;
  return e && e.invoiceId ? 'Billed visit' : 'Invoice in progress';
}

// enter(arg): an entry id opens that entry, null starts a new one, and
// undefined is the Back button coming home from an invoice, which keeps
// whatever entry is on the glass. The view, the picker's own step, the three
// line strips and the equipment sheet are put back either way: coming home
// should never land on a strip hanging under a row he cannot see.
function enterLog(arg) {
  logView = 'entry';
  logPicker = pickerState();
  logItemMenu = null;
  logRentalMenu = null;
  logEquipMenu = null;
  logSheet = null;
  if (arg === undefined) return;
  logId = arg || null;
  logDraft = logId ? null : logNewDraft();
}

function logNewDraft() {
  return {
    customerId: null, projectId: null, dateISO: Store.todayISO(),
    crew: [], items: [], rentals: [], equipment: [], notes: '',
  };
}

function logData() { return state.data; }

// The thing being edited: the entry on disk, or the draft in memory. They are
// the same shape on purpose, so every builder below is written once.
function logTarget() {
  if (logId) return (logData().logs || []).find((e) => e.id === logId) || null;
  if (!logDraft) logDraft = logNewDraft();
  return logDraft;
}
function logIsNew() { return !logId; }

// Whether a new visit has anything on it worth asking about before Back throws
// it away. Not the date: it starts at today and he never typed it, so a screen
// he opened by accident is still nothing.
function logDirty() {
  const e = logDraft;
  if (!e) return false;
  return !!(e.customerId || e.projectId
    || (e.crew || []).length || (e.items || []).length
    || (e.rentals || []).length || (e.equipment || []).length
    || (e.notes || '').trim());
}

// A new entry is not on the disk, so there is nothing to save and nothing to
// restore: Back is the undo. An entry that exists writes every change on its
// own, with an exact restore, the way the walk does.
//
// This is for the fields of the VISIT — who it was for, the date, the hours,
// the notes, the lines themselves. It is NOT what the picker and the line
// strips are handed: what those write besides the line is a catalog fact, and
// a catalog fact lands on disk at once (see renderLogAdd).
function logCommit(restore) {
  if (logIsNew()) return true;
  return persistOr(restore);
}

function logInvoice(e) {
  return e.invoiceId ? ((logData().invoices || []).find((inv) => inv.id === e.invoiceId) || null) : null;
}

// ---------------------------------------------------------------------------
// THE TWO ANSWERS THIS SCREEN IS TESTED ON
// ---------------------------------------------------------------------------

// What Save is still waiting for, in the order he fills the screen in. One
// name, not a list: a sentence that says three things are missing is a
// sentence he reads none of.
function logMissing(draft) {
  if (!draft) return 'customer';
  if (!draft.customerId) return 'customer';
  if (!draft.projectId) return 'project';
  const hours = (draft.crew || []).some((m) => m.hours > 0);
  const lines = (draft.items || []).length + (draft.rentals || []).length + (draft.equipment || []).length;
  // Hours OR a line: a visit that dropped off a lift and left is a real visit,
  // and so is an hour of troubleshooting with nothing fitted.
  if (!hours && lines === 0) return 'hours or a line';
  return null;
}

const LOG_MISSING_TEXT = {
  customer: 'Pick who this visit was for',
  project: 'Pick the job this visit belongs to',
  'hours or a line': 'Put some hours or a part on it first',
};

// What a man's row on the right says. Hours, or that he was not on this one —
// said in words rather than left blank, because a blank right-hand side reads
// as a number the app failed to show.
function logCrewValue(draft, crewId) {
  const m = ((draft && draft.crew) || []).find((x) => x.crewId === crewId);
  return m ? numText(m.hours) + ' hrs' : 'not on this one';
}

// ---------------------------------------------------------------------------
// CUSTOMER
// ---------------------------------------------------------------------------

function logCustomers() {
  return (logData().customers || []).filter((c) => c.hidden !== true)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
}

function buildLogCustomer(host, e) {
  const box = card('Customer');
  const chips = document.createElement('div');
  chips.className = 'equip-chips';
  logCustomers().forEach((c) => {
    chips.appendChild(chip(c.name, e.customerId === c.id, () => logPickCustomer(e, c.id)));
  });
  chips.appendChild(chip('+ New', false, () => {
    promptText('', {
      label: 'Customer',
      placeholder: 'Who the work is for',
      done: (name) => {
        if (!name || !name.trim()) { showBanner('A customer needs a name'); render(); return; }
        const d = logData();
        const before = d.customers.length;
        const c = Store.findOrCreateCustomer(d, name);
        // A customer is memory, like a catalog part: he is on the file the
        // moment he is named, whether or not this entry is ever saved. Typing a
        // name that is already there picks that one instead of making a second.
        const added = d.customers.length > before;
        if (!persistOr(() => { if (added) d.customers.splice(d.customers.indexOf(c), 1); })) { render(); return; }
        logPickCustomer(e, c.id);
      },
    });
  }));
  box.appendChild(chips);
  host.appendChild(box);
}

function logPickCustomer(e, id) {
  const prevC = e.customerId;
  const prevP = e.projectId;
  e.customerId = id;
  // A project belongs to a customer, so changing the customer cannot leave the
  // last one's job sitting selected underneath.
  if (prevC !== id) e.projectId = null;
  logCommit(() => { e.customerId = prevC; e.projectId = prevP; });
  render();
}

// ---------------------------------------------------------------------------
// PROJECT
// ---------------------------------------------------------------------------

// The jobs this entry may name: the ones still open under this customer, plus
// the one it already names. The crew rows have worked this way for two
// releases and for the same reason — a job marked done last month is still the
// job this visit was on, and dropping its chip would make the entry he is
// looking at read as an entry with no job on it.
function logProjectsOffered(e) {
  const open = Store.openProjects(logData(), e.customerId);
  if (!e.projectId || open.some((p) => p.id === e.projectId)) return open;
  const mine = (logData().projects || []).find((p) => p.id === e.projectId);
  return mine ? open.concat([mine]) : open;
}

// MARK IT DONE, from the screen he is standing on. Settings keeps its own, and
// this is the same flag: the title comes off the chips and stops being offered
// on the next visit. The sentence says both halves, because "done" on a job
// with two unbilled visits on it reads like it takes them with it.
// The title is quoted in both places it appears, because a job called Test job
// left bare reads as three words of the instruction rather than as the name of
// the thing being finished. Straight double quotes, the ones his keyboard
// types, so the link and the confirm say it the same way.
function logMarkDoneLabel(title) {
  return 'Mark "' + title + '" done';
}
function logMarkDoneText(title) {
  return logMarkDoneLabel(title) + '? It leaves the chips. Its unbilled invoices stay in the list.';
}

async function logMarkDone(p) {
  const ok = await confirmPanel(logMarkDoneText(p.title), { ok: 'Mark done' });
  if (!ok) { render(); return; }
  // Not logCommit: a job being finished is a fact about the JOB, true whether
  // or not this visit is ever saved, the same split the catalog and the crew
  // already have.
  p.done = true;
  if (!persistOr(() => { p.done = false; })) { render(); return; }
  render();
  showBanner(p.title + ' is done.', 'ok');
}

function buildLogProject(host, e) {
  const box = card('Project');
  const chips = document.createElement('div');
  chips.className = 'equip-chips';
  logProjectsOffered(e).forEach((p) => {
    chips.appendChild(chip(p.title, e.projectId === p.id, () => logPickProject(e, p.id)));
  });
  chips.appendChild(chip('+ New', false, () => {
    promptText('', {
      label: 'Project',
      placeholder: 'What the job is',
      done: (title) => {
        if (!title || !title.trim()) { showBanner('A project needs a title'); render(); return; }
        const d = logData();
        const before = (d.projects || []).length;
        // A project is written straight away, like a customer and for the same
        // reason: it is the thing that keeps "UF project" and "UF Project" from
        // splitting one job into two invoices, and it is worth remembering
        // whether or not this visit is saved.
        const p = Store.newProject(d, e.customerId, title, Store.todayISO());
        if (!p) { showBanner('A project needs a title'); render(); return; }
        const added = d.projects.length > before;
        if (!persistOr(() => { if (added) d.projects.splice(d.projects.indexOf(p), 1); })) { render(); return; }
        logPickProject(e, p.id);
      },
    });
  }));
  box.appendChild(chips);
  box.appendChild(caption(LOG_CAPTION_PROJECT));
  // The way to say a job is finished, from the screen he is standing on. Quiet,
  // under the chips, and only when there is a job to say it about.
  const picked = e.projectId ? logProjectsOffered(e).find((p) => p.id === e.projectId) : null;
  if (picked && !picked.done) {
    box.appendChild(textButton(logMarkDoneLabel(picked.title), 'link-btn link-btn-quiet',
      () => logMarkDone(picked)));
  }
  host.appendChild(box);
}

function logPickProject(e, id) {
  const prev = e.projectId;
  e.projectId = id;
  logCommit(() => { e.projectId = prev; });
  render();
}

// ---------------------------------------------------------------------------
// FROM AND TO
// ---------------------------------------------------------------------------
// An entry used to be one day and one keypad. The first week on v3 said
// otherwise: he opens the invoice when the job starts and keeps adding to it
// until the work is done, which is how the paper always worked. So there are
// two dates, both of them his to move until it is billed, and both of them
// opening the calendar — "the Friday" is a thing a man finds by looking, and
// the keypad is still one tap under the grid for a day he knows the number of.
//
// The To is OPTIONAL on disk and follows the From while it is absent, so every
// entry written before this release reads as the one day it was.

const LOG_SWAP_TEXT = 'That day is before the From, so the two of them swapped.';
const LOG_DATE_CAPTION = 'Move the To along as the job runs on. It is the range the invoice will cover.';

function buildLogDates(host, e) {
  const box = card();
  box.appendChild(row('From', fmtDate(InvMath.entryFrom(e)), () => {
    promptDate(InvMath.entryFrom(e), 'From', (iso) => logSetFrom(e, iso),
      { wasText: 'was ' + fmtDate(InvMath.entryFrom(e)) });
  }, { keypad: true }));
  box.appendChild(row('To', fmtDate(InvMath.entryTo(e)), () => {
    promptDate(InvMath.entryTo(e), 'To', (iso) => logSetTo(e, iso),
      { wasText: 'was ' + fmtDate(InvMath.entryTo(e)) });
  }, { keypad: true }));
  box.appendChild(caption(LOG_DATE_CAPTION));
  host.appendChild(box);
}

// The restore both setters share. A To that was never there has to go back to
// never having been there: writing null instead would be a key validateImport
// refuses, on an entry he only meant to look at.
function logDateRestore(e, prev) {
  return () => {
    e.dateISO = prev.dateISO;
    if (prev.toISO === undefined) delete e.toISO; else e.toISO = prev.toISO;
  };
}

// Two dates the wrong way round is not an error to send him back to undo: they
// swap, and the banner says so, which is one tap instead of three. Both rows
// do it, because he can arrive at the same impossible pair from either end.
function logSetFrom(e, iso) {
  if (!iso) return;
  const prev = { dateISO: e.dateISO, toISO: e.toISO };
  const swap = typeof e.toISO === 'string' && e.toISO < iso;
  if (swap) { e.dateISO = e.toISO; e.toISO = iso; }
  else e.dateISO = iso;
  logCommit(logDateRestore(e, prev));
  if (swap) showBanner(LOG_SWAP_TEXT);
  render();
}

function logSetTo(e, iso) {
  if (!iso) return;
  const prev = { dateISO: e.dateISO, toISO: e.toISO };
  const swap = iso < InvMath.entryFrom(e);
  if (swap) { e.toISO = e.dateISO; e.dateISO = iso; }
  else e.toISO = iso;
  logCommit(logDateRestore(e, prev));
  if (swap) showBanner(LOG_SWAP_TEXT);
  render();
}

// ---------------------------------------------------------------------------
// READY TO BILL
// ---------------------------------------------------------------------------
// The switch that ends the invoice. Nothing merges on its own and nothing is
// billed on its own: Bill these takes the ones he has said are finished, and
// this is where he says it, at the truck, on the entry itself. The pile row on
// the home flips the same flag and shows the same two words.
//
// Only on an entry that EXISTS. A brand-new draft is not on the disk, so a
// switch on it would write nothing and promise something; it turns up the
// moment he saves.

const LOG_READY_CAPTION = 'Bill these only takes the ones that are ready.';

function buildLogReady(host, e) {
  const box = card();
  box.appendChild(fieldLabel('Ready to bill'));
  box.appendChild(toggleRow([[false, 'In progress'], [true, 'Ready']], InvMath.isReady(e),
    (v) => logSetReady(e, v)));
  box.appendChild(caption(LOG_READY_CAPTION));
  host.appendChild(box);
}

function logSetReady(e, v) {
  const on = v === true;
  if (on === InvMath.isReady(e)) return;
  const prev = e.ready;
  e.ready = on;
  logCommit(() => { if (prev === undefined) delete e.ready; else e.ready = prev; });
  render();
}

// ---------------------------------------------------------------------------
// WHO AND HOURS
// ---------------------------------------------------------------------------
// One row per man offered: the crew Settings still shows, plus anyone already
// on this entry — the labor screen's rule, and for the same reason. A man
// hidden last month is still on the visit he worked, and his row has to be
// there to be corrected.

function logCrewOffered(e) {
  const on = new Set((e.crew || []).map((m) => m.crewId));
  return (logData().settings.crew || []).filter((c) => c.hidden === false || on.has(c.id));
}

function buildLogCrew(host, e) {
  const box = card('Who and hours');
  const offered = logCrewOffered(e);
  if (!offered.length) {
    box.appendChild(emptyNote('No crew in Settings yet.'));
    host.appendChild(box);
    return;
  }
  offered.forEach((c) => {
    const m = (e.crew || []).find((x) => x.crewId === c.id);
    const line = row(c.name, logCrewValue(e, c.id), () => {
      promptNumber(m ? m.hours : null, {
        label: c.name + ', hours',
        allowDecimal: true,
        maxDecimals: 2,
        done: (v) => logSetHours(e, c.id, v),
      });
    }, { keypad: true });
    // "not on this one" is an answer, not a number, and it is muted so that a
    // card of four men reads at a glance as the two who were there.
    if (!m) line.classList.add('log-crew-off');
    box.appendChild(line);
  });
  box.appendChild(caption('Clear takes a man off this visit.'));
  host.appendChild(box);
}

function logSetHours(e, crewId, v) {
  const prev = (e.crew || []).slice();
  // Clear means he was not on this one, which is a real answer and the way a
  // man comes back off a visit he was put on by mistake.
  if (v === null) {
    e.crew = prev.filter((x) => x.crewId !== crewId);
    logCommit(() => { e.crew = prev; });
    render();
    return;
  }
  if (!(v > 0)) { showBanner('Hours have to be more than zero'); render(); return; }
  const hit = prev.find((x) => x.crewId === crewId);
  e.crew = hit
    ? prev.map((x) => (x.crewId === crewId ? { crewId, hours: v } : x))
    : prev.concat([{ crewId, hours: v }]);
  logCommit(() => { e.crew = prev; });
  render();
}

// ---------------------------------------------------------------------------
// PARTS, RENTALS, EQUIPMENT
// ---------------------------------------------------------------------------
// The walk's three kinds, on the same entry: material lines counted through
// the picker, a rental passed through with its markup switch, and his own gear
// at the day rate Settings keeps. The money on this screen is COST, the way it
// is on the walk; what the customer pays is decided on the invoice.

function logMarkup() { return logData().settings.markupPct; }

function buildLogLines(host, e) {
  const box = card('Parts, rentals, equipment');
  const markup = logMarkup();
  const empty = !(e.items || []).length && !(e.rentals || []).length && !(e.equipment || []).length;
  if (empty) box.appendChild(emptyNote('Nothing on this visit yet. Tap + Part for what you fitted.'));

  (e.items || []).forEach((it) => {
    const bills = itemBillText(it, markup);
    const line = lineRow(it.name,
      itemCountText(it.qty, it.unit, it.costCents) + (bills ? ' · ' + bills : ''),
      BidMath.fmt(BidMath.materialCost({ areas: [{ items: [it] }] })),
      () => { logItemMenu = logItemMenu === it ? null : it; render(); });
    if (logPicker.highlight === it) line.classList.add('walk-row-new');
    box.appendChild(line);
    if (logItemMenu === it) {
      lineActions(box, line, e.items, it, {
        markupPct: markup,
        data: logData(),
        // Two saves, and they are for two different things. The LINE belongs
        // to this visit, so it goes through logCommit, which writes nothing
        // while the visit is still a draft in memory. What the strip writes
        // BESIDES the line is the CATALOG's memory of what the part costs and
        // what it bills at, and that is a fact about the part rather than a
        // field of this draft: it goes to disk through the shell's own save,
        // whether or not the visit is ever kept.
        persistOr: logCommit,
        persistCatalog: persistOr,
        onChanged: render,
        onClose: () => { logItemMenu = null; render(); },
      });
    }
  });

  (e.rentals || []).forEach((x) => {
    const line = lineRow(x.name || 'Rental', rentalSubText(x), moneyText(x.cents),
      () => { logRentalMenu = logRentalMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (logRentalMenu === x) {
      rentalActions(box, line, e.rentals, x, {
        data: logData(),
        markupPct: markup,
        persistOr: logCommit,
        onChanged: render,
        onClose: () => { logRentalMenu = null; render(); },
      });
    }
  });

  (e.equipment || []).forEach((x) => {
    const line = lineRow(x.name || 'Equipment', equipSubText(x),
      BidMath.fmt(BidMath.equipmentLine(x)),
      () => { logEquipMenu = logEquipMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (logEquipMenu === x) equipActions(box, line, e.equipment, x, logEquipOpts(e));
  });

  // The tool list takes the place of the three buttons while it is up: it IS
  // the question, and a + Part button under it is a second one.
  if (logSheet === 'equip') {
    host.appendChild(box);
    const pick = equipmentPickerCard('Which tool?', logData().settings.equipment,
      logData().settings.equipmentPct, (equip) => logAddEquipment(e, equip));
    pick.appendChild(textButton('Cancel', 'link-btn link-btn-quiet', () => { logSheet = null; render(); }));
    host.appendChild(pick);
    return;
  }

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('+ Part', 'btn btn-primary btn-block', () => {
    navPush();
    logView = 'add';
    logItemMenu = null;
    logPicker = pickerState();
    render();
  }));
  nav.appendChild(textButton('+ Rental', 'btn btn-block', () => logAddRental(e, '')));
  // navPush like + Part above: the tool list is a step into this screen, and
  // one Back is what closes it. Without the push the back gesture left the
  // screen entirely and took the half-logged visit with it.
  nav.appendChild(textButton('+ Equipment', 'btn btn-block', () => {
    navPush();
    logSheet = 'equip';
    render();
  }));
  box.appendChild(nav);
  host.appendChild(box);
}

// The add-a-part flow: the picker, onto this entry's own items.
function renderLogAdd(host, e) {
  renderItemPicker(host, logPicker, {
    title: 'Add to this visit',
    items: e.items,
    tally: (items) => areaTallyText({ items }),
    // A visit rents lifts as readily as a bid does, so the tile and the rental
    // hits in a search are both offered here.
    allowRentals: true,
    onRental: (name) => {
      // Both calls end in the same editor. The picker's TILE arrives with no
      // name because it is the start of a question, and on a log entry the
      // answer is simply "what is it, then?" — there is no bid to hang a
      // rented-or-your-own sheet off. A rental picked out of a drawer or a
      // search arrives already named and the editor starts one step further on.
      logAddRental(e, name || '');
    },
    onDone: () => { logView = 'entry'; render(); },
    onChanged: render,
    navPush,
    // The line goes through logCommit, which writes nothing while this visit is
    // still a draft in memory. The CATALOG goes through the shell's own save:
    // a part invented at the truck, the unit it is counted in, one more use,
    // and what it cost this time are facts about his catalog and they are true
    // whether or not this visit is ever saved. The walk has always written
    // them at once, and a part invented here and lost on Back is the same part
    // typed again tomorrow.
    persistOr: logCommit,
    persistCatalog: persistOr,
    data: logData(),
  });
}

// Name, days, cost, in that order, and then the line is on the visit with its
// markup switch off and its strip open. All three questions are addRental in
// picker.js, the same three the bid's Costs & price screen asks: a lift is a
// lift whether it turns up on a bid or on a Tuesday.
//
// No banner. The strip it opens is already the answer, and a banner over an
// open strip is a sentence about a thing he is looking at.
function logAddRental(e, prefill) {
  addRental(e.rentals, prefill, {
    data: logData(),
    persistOr: logCommit,
    onChanged: render,
    onAdded: (line) => {
      logRentalMenu = line;
      if (logView === 'add') logView = 'entry';
    },
  });
}

// His own gear, added and edited through picker.js's shared adder: the invoice
// screen offers the identical three questions, and the only difference between
// the two was the noun in one banner.
//
// persistSettings is the shell's own save rather than logCommit: what a tool
// cost new is a fact about the tool, true whether or not this visit is ever
// saved, and on a new visit logCommit writes nothing.
function logEquipOpts(e) {
  return {
    data: logData(),
    persistOr: logCommit,
    persistSettings: persistOr,
    onChanged: render,
    noun: 'visit',
    onAdded: (line) => { logSheet = null; logEquipMenu = line; },
    onClose: () => { logEquipMenu = null; render(); },
  };
}

function logAddEquipment(e, equip) {
  addEquipment(e.equipment, equip, { ...logEquipOpts(e), onClose: () => { logSheet = null; } });
}

// ---------------------------------------------------------------------------
// NOTES
// ---------------------------------------------------------------------------
// His note about the visit, not the customer's: nothing in invdoc.js reads it
// and no invoice prints it. "The disconnect they want moved is behind the
// pallet racking" is worth writing down and is nobody else's business.

function buildLogNotes(host, e) {
  const box = card();
  box.appendChild(row('Notes for you', areaNoteLine(e.notes, AREA_NOTE_PREVIEW_MAX) || 'None', () => {
    promptText(e.notes, {
      label: 'Notes',
      multiline: true,
      maxLength: Store.AREA_NOTES_MAX,
      done: (text) => {
        const prev = e.notes;
        e.notes = text == null ? '' : String(text);
        logCommit(() => { e.notes = prev; });
        render();
      },
    });
  }));
  box.appendChild(caption('Never prints.'));
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// SAVE
// ---------------------------------------------------------------------------

function logSave() {
  const draft = logDraft;
  const missing = logMissing(draft);
  if (missing) { showBanner(LOG_MISSING_TEXT[missing]); render(); return; }
  const d = logData();
  const e = Store.newLogEntry(d, {
    customerId: draft.customerId, projectId: draft.projectId, dateISO: draft.dateISO,
  });
  e.crew = draft.crew;
  e.items = draft.items;
  e.rentals = draft.rentals;
  e.equipment = draft.equipment;
  e.notes = draft.notes;
  // The To is OPTIONAL on disk and newLogEntry does not make one, so it is
  // copied over the same way it is written: only when there is one. A draft he
  // gave a range to has to be saved with the range, and a one-day visit has to
  // land without the key at all, the way every entry written before v3.1 did.
  if (typeof draft.toISO === 'string') e.toISO = draft.toISO;
  if (!persistOr(() => {
    const i = d.logs.indexOf(e);
    if (i !== -1) d.logs.splice(i, 1);
  })) { render(); return; }
  logId = e.id;
  logDraft = null;
  // Back onto the home replaces rather than pushes: Save is the end of this
  // screen, not a step further in, and the gesture from the pile should not
  // walk back into an entry he has finished with.
  show('invoices', undefined, { replace: true });
}

// ---------------------------------------------------------------------------
// A BILLED ENTRY
// ---------------------------------------------------------------------------
// Once an invoice carries these hours the invoice is the record. The entry is
// shown as it was, with the way through to the paper it is on.

function renderLogBilled(host, e, inv) {
  const box = card('Billed');
  box.appendChild(row('Customer', logCustomerName(e.customerId), null));
  box.appendChild(row('Project', logProjectTitle(e.projectId), null));
  box.appendChild(row('Service', InvMath.rangeText(InvMath.entryFrom(e), InvMath.entryTo(e)), null));
  logCrewOffered(e).forEach((c) => {
    const m = (e.crew || []).find((x) => x.crewId === c.id);
    if (m) box.appendChild(row(c.name, logCrewValue(e, c.id), null));
  });
  (e.items || []).forEach((it) => {
    box.appendChild(lineRow(it.name, itemCountText(it.qty, it.unit, it.costCents), null, null));
  });
  (e.rentals || []).forEach((x) => box.appendChild(lineRow(x.name || 'Rental', rentalSubText(x), null, null)));
  (e.equipment || []).forEach((x) => box.appendChild(lineRow(x.name || 'Equipment', equipSubText(x), null, null)));
  if (e.notes) box.appendChild(caption(e.notes));
  box.appendChild(lineRow('Billed on ' + (inv.number === null ? 'a draft invoice' : '#' + inv.number),
    'Open the invoice these hours are on', null, () => show('invoice', inv.id)));
  box.appendChild(caption('These hours are on an invoice now, so they are read-only here.'));
  host.appendChild(box);
}

function logCustomerName(id) {
  const c = (logData().customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}
function logProjectTitle(id) {
  const p = (logData().projects || []).find((x) => x.id === id);
  return p ? p.title : 'Project';
}

// ---------------------------------------------------------------------------
// RENDER AND REGISTER
// ---------------------------------------------------------------------------

function renderLog() {
  const host = el('logContent');
  host.textContent = '';
  const e = logTarget();
  if (!e) {
    host.appendChild(emptyNote('That entry is not here anymore.'));
    return;
  }
  // The invoice is asked about FIRST, before the add view: an entry that is on
  // an invoice is read-only, and read-only holds by construction rather than by
  // there happening to be no way into the picker from a billed entry.
  const inv = logInvoice(e);
  if (inv) { renderLogBilled(host, e, inv); return; }
  if (logView === 'add') { renderLogAdd(host, e); return; }

  // What this screen IS, said once at the top. He asked where the invoice
  // number was; it is not spent until Friday, and a screen that says nothing
  // about that reads like a number that failed to appear.
  host.appendChild(caption(LOG_NUMBER_CAPTION));
  buildLogCustomer(host, e);
  if (e.customerId) buildLogProject(host, e);
  buildLogDates(host, e);
  // Only on an entry that exists: a switch on a draft would write nothing.
  if (!logIsNew()) buildLogReady(host, e);
  buildLogCrew(host, e);
  buildLogLines(host, e);
  buildLogNotes(host, e);
  // Only a new entry has a Save: an entry that already exists has been saving
  // itself change by change, and a Save button on it would be a button that
  // does nothing and says something has not happened yet.
  if (logIsNew()) pinnedBar(host, 'Save', logSave);
}

// The steps inside this screen: the picker's own, then the equipment sheet,
// then out. A peek must answer without moving, because the shell asks it to
// decide what to write on the Back button.
function logBackStep(peek) {
  if (logView === 'add') {
    if (peek) return true;
    if (pickerBackStep(logPicker)) { render(); return true; }
    logView = 'entry';
    render();
    return true;
  }
  if (logSheet) {
    if (!peek) { logSheet = null; render(); }
    return true;
  }
  // A new visit with something on it is thrown away by going back, and that is
  // worth one question: eight parts counted at the tailgate and a thumb on the
  // edge of the glass is the whole visit gone with nothing to undo it. An
  // untouched new visit still goes back silently — a screen he opened by
  // accident is not a thing to confirm.
  if (logIsNew() && logDirty()) {
    // The peek must answer without moving, and a second Back while the question
    // is already up is not a second question.
    if (peek || logDiscardAsking) return true;
    logDiscardAsking = true;
    confirmPanel('Throw this visit away?', { ok: 'Throw it away', cancel: 'Keep it', danger: true })
      .then((ok) => {
        logDiscardAsking = false;
        if (!ok) {
          // He kept the visit, so nothing moved — but the gesture that asked
          // the question already spent a history entry on the way in
          // (onPopState runs goBack, goBack runs this, and a backStep that
          // answers true tells the shell not to re-anchor). Without this the
          // entry is gone: the NEXT swipe has nothing of ours to spend and
          // walks out of the app with the visit still on the glass.
          //
          // Unconditional on purpose. The Back BUTTON spends an entry too
          // (backTapped calls history.back()), so both ways in are the same
          // way; the one path that spent nothing is a Back at depth zero,
          // where onPopState's own "if (!moved) navPush()" would have put an
          // entry there anyway. navPush is safe here because navSuppress is
          // only up for the length of goBack, and this runs after it.
          navPush();
          render();
          return;
        }
        logDraft = null;
        logId = null;
        // Replace: the gesture that asked the question already spent its own
        // history entry, and going back is never a step further in.
        show('invoices', undefined, { replace: true });
      });
    return true;
  }
  return false;
}

registerScreen('log', {
  id: 'screen-log', tab: 'invoices',
  title: logScreenTitle,
  back: 'invoices',
  backStep: logBackStep,
  enter: enterLog,
  // The flash timer outlives this screen by up to a second. Clearing the
  // highlight on the state object the timer is holding is what makes that late
  // timer a no-op, instead of a redraw of whatever screen took the glass.
  leave: () => { logPicker.highlight = null; },
  render: renderLog,
});
