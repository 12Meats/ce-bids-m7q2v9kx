'use strict';
// screens/log.js — one visit, written at the truck before he drives off.
//
// This is the first of the three moments the Invoices tab is built around, and
// it is the one that has to be quick: he is standing at the tailgate with the
// phone in one hand. Nothing here is typed that can be tapped. The customer is
// a chip, the project is a chip, the date is four digits on the number keypad,
// the hours are a keypad each, and the parts come through the same picker the
// walk uses, so the flow he already knows is the flow he gets here.
//
// A NEW entry lives in memory until Save: Back throws it away, and nothing
// half-logged can end up in the pile waiting to be billed. An entry he opens
// again from the pile is edited in place and saves as he goes, the way the
// walk does, because it is already a thing that exists. One entry that is
// already on an invoice is read-only — the invoice is the record now, and
// changing the hours under it would make the paper a lie.
//
// Sections: VIEW STATE · CUSTOMER · PROJECT · DATE · WHO AND HOURS ·
// PARTS, RENTALS, EQUIPMENT · NOTES · SAVE · REGISTER

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

const LOG_CAPTION_PROJECT = 'Pick the job this visit belongs to. A title stays here until you mark it done.';

// enter(arg): an entry id opens that entry, null starts a new one, and
// undefined is the Back button coming home from the picker or an invoice,
// which keeps whatever is on the glass.
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

// A new entry is not on the disk, so there is nothing to save and nothing to
// restore: Back is the undo. An entry that exists writes every change on its
// own, with an exact restore, the way the walk does.
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

function buildLogProject(host, e) {
  const box = card('Project');
  const chips = document.createElement('div');
  chips.className = 'equip-chips';
  Store.openProjects(logData(), e.customerId).forEach((p) => {
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
  host.appendChild(box);
}

function logPickProject(e, id) {
  const prev = e.projectId;
  e.projectId = id;
  logCommit(() => { e.projectId = prev; });
  render();
}

// ---------------------------------------------------------------------------
// DATE
// ---------------------------------------------------------------------------
// The bid screen's idiom, and the app's only one: four digits on the number
// keypad, six with a year. There is no date picker in this app and none is
// added for this screen.

function buildLogDate(host, e) {
  const box = card();
  box.appendChild(row('Date', fmtDate(e.dateISO), () => {
    promptNumber(null, {
      label: 'Date: type 915 for Sep 15, or 91526',
      maxChars: 6,
      wasText: 'was ' + fmtDate(e.dateISO),
      done: (v) => {
        if (v === null) return;
        const iso = Dates.parseTypedDate(v, Store.todayISO());
        if (!iso) { showBanner('That date needs 4 digits (MMDD) or 6 (MMDDYY)'); render(); return; }
        const prev = e.dateISO;
        e.dateISO = iso;
        logCommit(() => { e.dateISO = prev; });
        render();
      },
    });
  }, { keypad: true }));
  host.appendChild(box);
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
    box.appendChild(row(c.name, logCrewValue(e, c.id), () => {
      promptNumber(m ? m.hours : null, {
        label: c.name + ', hours',
        allowDecimal: true,
        maxDecimals: 2,
        done: (v) => logSetHours(e, c.id, v),
      });
    }, { keypad: true }));
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
        persistOr: logCommit,
        onChanged: render,
        onClose: () => { logItemMenu = null; render(); },
      });
    }
  });

  (e.rentals || []).forEach((x) => {
    const line = lineRow(x.name || 'Rental', logRentalSub(x), moneyText(x.cents),
      () => { logRentalMenu = logRentalMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (logRentalMenu === x) buildLogRentalActions(box, line, e, x);
  });

  (e.equipment || []).forEach((x) => {
    const line = lineRow(x.name || 'Equipment', numText(x.days) + (x.days === 1 ? ' day' : ' days') + ' · ' + moneyText(x.dayCents) + ' a day',
      BidMath.fmt(BidMath.equipmentLine(x)),
      () => { logEquipMenu = logEquipMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (logEquipMenu === x) buildLogEquipActions(box, line, e, x);
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
  nav.appendChild(textButton('+ Equipment', 'btn btn-block', () => { logSheet = 'equip'; render(); }));
  box.appendChild(nav);
  host.appendChild(box);
}

function logRentalSub(x) {
  return numText(x.days) + (x.days === 1 ? ' day' : ' days')
    + ' · ' + moneyText(x.cents)
    + ' · markup ' + (x.markup ? 'on' : 'off');
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
    persistOr: logCommit,
    data: logData(),
  });
}

// Name, days, cost, in that order, and then the line is on the visit with its
// markup switch off. Three panels rather than a form, because there are no
// forms in this app; the switch is on the line's own strip, where changing it
// later is the same tap as setting it now.
function logAddRental(e, prefill) {
  promptRentalName(logData().catalog, prefill, (name) => {
    promptNumber(1, {
      label: (name || 'Rental') + ', how many days?',
      allowDecimal: true,
      done: (days) => {
        if (days === null) return;
        if (!(days > 0)) { showBanner('Days have to be more than zero'); render(); return; }
        promptMoney(null, {
          label: (name || 'Rental') + ', what did it cost?',
          done: (cents) => {
            const line = { name, days, cents: cents === null ? 0 : cents, markup: false };
            e.rentals.push(line);
            if (!logCommit(() => {
              const i = e.rentals.indexOf(line);
              if (i !== -1) e.rentals.splice(i, 1);
            })) { render(); return; }
            logRentalMenu = line;
            if (logView === 'add') logView = 'entry';
            showBanner(name + ' added. Tap it to bill it with markup.', 'ok');
            render();
          },
        });
      },
    });
  });
}

function buildLogRentalActions(box, lineEl, e, x) {
  const close = () => { logRentalMenu = null; render(); };
  const strip = attachedStrip(lineEl, [
    { label: 'Days', onTap: () => {
      promptNumber(x.days, {
        label: (x.name || 'Rental') + ', how many days?',
        allowDecimal: true,
        done: (v) => {
          if (v === null) return;
          if (!(v > 0)) { showBanner('Days have to be more than zero'); render(); return; }
          const prev = x.days;
          x.days = v;
          logCommit(() => { x.days = prev; });
          close();
        },
      });
    } },
    { label: 'Cost', onTap: () => {
      promptMoney(x.cents, {
        label: (x.name || 'Rental') + ', what did it cost?',
        done: (cents) => {
          const prev = x.cents;
          x.cents = cents === null ? 0 : cents;
          logCommit(() => { x.cents = prev; });
          close();
        },
      });
    } },
    // The one switch on a rental: does the customer pay the markup on it, or
    // does it pass through at what the yard charged. It says which way it is
    // now, so tapping it is a change he can see the result of.
    { label: x.markup ? 'Markup on' : 'Markup off', onTap: () => {
      const prev = x.markup;
      x.markup = !prev;
      logCommit(() => { x.markup = prev; });
      close();
    } },
    { label: 'Delete', quiet: true, onTap: async () => {
      const ok = await confirmPanel('Delete ' + (x.name || 'this rental') + '?', { ok: 'Delete', danger: true });
      if (!ok) { render(); return; }
      const i = e.rentals.indexOf(x);
      if (i !== -1) {
        e.rentals.splice(i, 1);
        logCommit(() => { e.rentals.splice(i, 0, x); });
      }
      close();
    } },
  ], { cancel: close });
  if (!strip.parentNode) box.appendChild(strip);
}

// His own gear carries its day rate with it, so the line lands priced. A tool
// Settings has no cost for is asked about rather than added at $0: a $0
// equipment line is a day of his own gear given away, and on the glass it
// looks exactly like a priced one.
function logAddEquipment(e, equip) {
  const settings = logData().settings;
  const existing = (e.equipment || []).find((x) => x.equipmentId === equip.id);
  if (existing) {
    logSheet = null;
    showBanner((equip.name || 'That tool') + ' is already on this visit.');
    render();
    return;
  }
  const rate = equipmentDayCents(equip, settings.equipmentPct);
  if (rate != null) { logPushEquipment(e, equip, rate); return; }
  promptMoney(null, {
    label: 'What does a ' + (equip.name || 'tool') + ' cost new?',
    done: (cents) => {
      if (cents === null || !(cents > 0)) return;
      const prev = equip.costCents;
      equip.costCents = cents;
      // Settings is written on its own: what a tool cost is true whether or not
      // the line that asked makes it onto this visit, and a refused save must
      // not leave Settings holding a number the disk never took.
      if (!persistOr(() => { equip.costCents = prev; })) { render(); return; }
      const made = equipmentDayCents(equip, settings.equipmentPct);
      logPushEquipment(e, equip, made == null ? 0 : made);
    },
  });
}

function logPushEquipment(e, equip, dayCents) {
  const line = { equipmentId: equip.id, name: equip.name, days: 1, dayCents };
  e.equipment.push(line);
  if (!logCommit(() => {
    const i = e.equipment.indexOf(line);
    if (i !== -1) e.equipment.splice(i, 1);
  })) { render(); return; }
  logSheet = null;
  logEquipMenu = line;
  showBanner((equip.name || 'The tool') + ' added at ' + moneyText(dayCents) + ' a day. Tap it to change the days.', 'ok');
  render();
}

function buildLogEquipActions(box, lineEl, e, x) {
  const close = () => { logEquipMenu = null; render(); };
  const strip = attachedStrip(lineEl, [
    { label: 'Days', onTap: () => {
      promptNumber(x.days, {
        label: (x.name || 'Tool') + ', how many days?',
        allowDecimal: true,
        done: (v) => {
          if (v === null) return;
          if (!(v > 0)) { showBanner('Days have to be more than zero'); render(); return; }
          const prev = x.days;
          x.days = v;
          logCommit(() => { x.days = prev; });
          close();
        },
      });
    } },
    { label: 'Delete', quiet: true, onTap: async () => {
      const ok = await confirmPanel('Delete ' + (x.name || 'this line') + '?', { ok: 'Delete', danger: true });
      if (!ok) { render(); return; }
      const i = e.equipment.indexOf(x);
      if (i !== -1) {
        e.equipment.splice(i, 1);
        logCommit(() => { e.equipment.splice(i, 0, x); });
      }
      close();
    } },
  ], { cancel: close });
  if (!strip.parentNode) box.appendChild(strip);
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
  box.appendChild(row('Date', fmtDate(e.dateISO), null));
  logCrewOffered(e).forEach((c) => {
    const m = (e.crew || []).find((x) => x.crewId === c.id);
    if (m) box.appendChild(row(c.name, logCrewValue(e, c.id), null));
  });
  (e.items || []).forEach((it) => {
    box.appendChild(lineRow(it.name, itemCountText(it.qty, it.unit, it.costCents), null, null));
  });
  (e.rentals || []).forEach((x) => box.appendChild(lineRow(x.name || 'Rental', logRentalSub(x), null, null)));
  (e.equipment || []).forEach((x) => box.appendChild(lineRow(x.name || 'Equipment',
    numText(x.days) + (x.days === 1 ? ' day' : ' days') + ' · ' + moneyText(x.dayCents) + ' a day', null, null)));
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
  if (logView === 'add') { renderLogAdd(host, e); return; }
  const inv = logInvoice(e);
  if (inv) { renderLogBilled(host, e, inv); return; }

  buildLogCustomer(host, e);
  if (e.customerId) buildLogProject(host, e);
  buildLogDate(host, e);
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
  return false;
}

registerScreen('log', {
  id: 'screen-log', tab: 'invoices',
  title: 'Log hours',
  back: 'invoices',
  backStep: logBackStep,
  enter: enterLog,
  // The flash timer outlives this screen by up to a second. Clearing the
  // highlight on the state object the timer is holding is what makes that late
  // timer a no-op, instead of a redraw of whatever screen took the glass.
  leave: () => { logPicker.highlight = null; },
  render: renderLog,
});
