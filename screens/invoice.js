'use strict';
// screens/invoice.js — one invoice: what it bills, what it says, what came in
// against it, and the tap that sends it.
//
// This is the third of the three moments the Invoices tab is built around, and
// it is two screens wearing one file. Before Bill these has numbered anything
// it is a DRAFT under review: it lives in memory on the shared store, Back
// goes to the review, and nothing here writes to disk. After the review has
// numbered it, it is an invoice on the file: every change is written as he
// makes it, Back goes to the home list, and the pinned button hands the PDF to
// the share sheet.
//
// It is reached three ways:
//   show('invoice', id)                    an invoice on the file
//   show('invoice', { draft: i })          the i-th draft under review, in memory
//   show('invoice', { id, queue: [...] })  the first of a batch just numbered
//
// The rules are all somewhere else. What an invoice comes to is InvMath's,
// what the paper says is InvDoc's, the lines and their strips are picker.js's,
// and this file draws them and asks the questions.
//
// Sections: VIEW STATE · WHAT IS BEING EDITED · WRITING · SUMMARY · LABOR ·
// LINES · THE PROJECT LINE · ON THE INVOICE · PAYMENTS · PREVIEW · THE PDFS ·
// SEND · DELETE · RENDER AND REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

let invoiceId = null;             // the invoice on the file, or null
let invoiceDraft = null;          // the index into the drafts under review, or null
let invoiceQueue = [];            // the ones waiting behind this one to be sent
let invoiceBusy = false;          // a PDF is being made / the share sheet is up
let invoiceView = 'invoice';      // 'invoice' | 'add'
let invoicePicker = pickerState();
let invoiceItemMenu = null;       // the line showing its action strip
let invoiceRentalMenu = null;
let invoiceEquipMenu = null;
let invoiceSheet = null;          // 'equip' while the tool list is up
let invoicePreviewOpen = false;   // the paper, unfolded
let invoicePdfs = null;           // [{ id, at, blob }] newest first; null = still loading
let invoicePdfToken = 0;          // async list fills from an older render are dropped

const INVOICE_PDF_KEEP = 10;

// The number is spent the moment Bill these takes it, and this app has no
// voiding. Said on the delete confirm, because "delete" on paper he has
// numbered is a bigger word than it looks.
const INVOICE_NUMBER_SPENT = 'The number is spent either way. Numbers are never reused.';

function enterInvoice(arg) {
  // The steps inside this screen are put back whichever way he arrives: coming
  // home from a keypad should never land on a strip hanging under a row he
  // cannot see, or inside the add-a-part flow he left ten minutes ago.
  invoiceView = 'invoice';
  invoicePicker = pickerState();
  invoiceItemMenu = null;
  invoiceRentalMenu = null;
  invoiceEquipMenu = null;
  invoiceSheet = null;
  invoiceBusy = false;
  // undefined is the Back button coming home: keep what is on the glass, and
  // keep the queue with it. The queue lives here rather than in the navigation
  // argument for exactly that reason — a look at the home list and back must
  // not lose the four invoices still waiting to go out.
  if (arg !== undefined) {
    if (arg && typeof arg === 'object') {
      invoiceId = typeof arg.id === 'string' ? arg.id : null;
      invoiceDraft = typeof arg.draft === 'number' ? arg.draft : null;
      invoiceQueue = Array.isArray(arg.queue) ? arg.queue.slice() : [];
    } else {
      const id = typeof arg === 'string' ? arg : null;
      invoiceId = id;
      invoiceDraft = null;
      // Coming back to one of the batch from the home list is STILL the batch.
      // He numbered four on Friday, sent the first, went out to the list to
      // check something and tapped the second one from there: the two behind
      // it are still waiting to go out, and a queue thrown away here is three
      // invoices that quietly never get sent. Anything that is not in the
      // queue is a different errand, and the queue goes with it.
      const at = invoiceQueue.indexOf(id);
      invoiceQueue = at === -1 ? [] : invoiceQueue.slice(at + 1);
    }
    invoicePreviewOpen = false;
  }
  invoicePdfs = null;
  invoiceLoadPdfs();
}

// ---------------------------------------------------------------------------
// WHAT IS BEING EDITED
// ---------------------------------------------------------------------------

function invoiceData() { return state.data; }

// The draft under review, or the invoice on the file. A draft is not on disk
// and never will be until the review numbers it, so it is read out of the
// shared store rather than out of state.data.
function invoiceTarget() {
  if (invoiceDraft !== null) return reviewDrafts.get()[invoiceDraft] || null;
  return ((invoiceData().invoices || []).find((x) => x.id === invoiceId)) || null;
}

// True while this screen is looking at a draft the review has not numbered.
// It is the whole difference between the two screens in this file: what Back
// means, whether anything is written, and whether there is a PDF to send.
function invoiceIsReviewDraft() { return invoiceDraft !== null; }

function invoiceCustomerName(id) {
  const c = (invoiceData().customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}

function invoiceBid(inv) {
  return inv.bidId ? ((invoiceData().bids || []).find((b) => b.id === inv.bidId) || null) : null;
}

// The service date(s), the way the paper says them: one day, or a range with
// the year said once at the end.
function invoiceServiceText(inv) {
  return inv.serviceFrom === inv.serviceTo
    ? fmtDate(inv.serviceFrom)
    : InvMath.rangeText(inv.serviceFrom, inv.serviceTo);
}

// ---------------------------------------------------------------------------
// WRITING
// ---------------------------------------------------------------------------

// Every change to the invoice itself goes through here.
//
// A draft under review is an object in memory that the review is holding: it
// is not on the file, there is nothing to save, and a save here would only
// risk a refusal that undoes an edit the disk was never asked to keep. An
// invoice on the file is written change by change with an exact restore, the
// way the walk and an existing log entry are.
//
// The status is derived on every write rather than set by hand: it is a
// function of what the invoice comes to, what has been paid against it and
// whether it has gone out, and all three of those change on this screen.
// Draft-vs-disk is read off the INVOICE it is handed rather than off this
// screen's view state: everything that writes here is already holding the
// record it is writing to, and a rule that consults module state instead is a
// rule that can be asked about the wrong invoice.
function invoiceWrite(inv, restore) {
  const prevStatus = inv.status;
  inv.status = InvMath.statusOf(inv);
  const put = () => { restore(); inv.status = prevStatus; };
  if (!inv.id) return true;
  return persistOr(put);
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
// Who it is for, what it covers, what it comes to, and where it stands. The
// one card he reads before deciding whether the rest of the screen needs him.

function buildInvoiceSummary(host, inv) {
  const box = card();
  box.appendChild(row(invoiceCustomerName(inv.customerId), inv.projectTitle || 'Work', null));
  if (inv.kind !== 'project') box.appendChild(row('Service', invoiceServiceText(inv), null));
  box.appendChild(bigNumber(moneyText(InvMath.totals(inv).total),
    // picker.js's pill, the same words the home list prints, and the terms
    // beside it because "Upon receipt" is the answer to "when do I get paid".
    invoiceStatusPill(inv) + ' · ' + (inv.terms || 'Upon receipt')));
  if (inv.sentAt) {
    box.appendChild(caption('Sent ' + fmtDate(inv.sentAt)
      + (inv.savedToFilesAt ? ' · saved on the phone ' + fmtDate(inv.savedToFilesAt) : ' · not saved on the phone yet')));
  }
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// LABOR
// ---------------------------------------------------------------------------
// One row per man: what he logged, and what this invoice bills for him. They
// start the same and the second one is Adrian's to change — the four hours of
// a five-hour visit he is willing to charge for is a decision he makes here,
// once, rather than by editing the visit and losing what really happened.

function buildInvoiceLabor(host, inv) {
  const box = card('Labor');
  if (!(inv.labor || []).length) {
    box.appendChild(emptyNote('No hours on this one.'));
    host.appendChild(box);
    return;
  }
  inv.labor.forEach((l) => {
    box.appendChild(lineRow(l.name, 'logged ' + numText(l.loggedHours) + ' hrs',
      numText(l.billedHours) + ' hrs',
      () => {
        promptNumber(l.billedHours, {
          label: l.name + ', hours to bill',
          allowDecimal: true,
          maxDecimals: 2,
          done: (v) => invoiceSetBilled(inv, l, v),
        });
      }, { keypad: true }));
  });
  const hours = InvMath.billedHours(inv);
  box.appendChild(caption(numText(hours) + ' hrs at ' + moneyText(inv.rateCents)
    + ' · ' + moneyText(InvMath.laborCents(inv))));
  box.appendChild(caption('Clear bills nothing for that man. The rate is the one this invoice was drafted at.'));
  host.appendChild(box);
}

// Clear is zero, not "take him off": his name and what he logged stay on the
// invoice, billing nothing, because the row is the record of a decision. A
// negative is refused the way the log screen refuses negative hours.
function invoiceSetBilled(inv, l, v) {
  const next = v === null ? 0 : v;
  if (next < 0) { showBanner('Hours to bill cannot be less than nothing'); render(); return; }
  const prev = l.billedHours;
  l.billedHours = next;
  invoiceWrite(inv, () => { l.billedHours = prev; });
  render();
}

// ---------------------------------------------------------------------------
// LINES
// ---------------------------------------------------------------------------
// The parts, the rentals and his own gear, exactly as the walk and the truck
// log hold them, through exactly the same strips. The money here is what the
// CUSTOMER pays: the markup on this invoice, snapshotted the day it was
// drafted, never re-read from Settings.

function buildInvoiceLines(host, inv) {
  const box = card('Materials, rentals, equipment');
  const markup = inv.markupPct;
  const empty = !(inv.items || []).length && !(inv.rentals || []).length && !(inv.equipment || []).length;
  if (empty) box.appendChild(emptyNote('Nothing but hours on this one. Tap + Part for anything you fitted.'));

  (inv.items || []).forEach((it) => {
    const bills = itemBillText(it, markup);
    const line = lineRow(it.name,
      itemCountText(it.qty, it.unit, it.costCents) + (bills ? ' · ' + bills : ''),
      moneyText(BidMath.itemPrice(it, markup).cents),
      () => { invoiceItemMenu = invoiceItemMenu === it ? null : it; render(); });
    if (invoicePicker.highlight === it) line.classList.add('walk-row-new');
    box.appendChild(line);
    if (invoiceItemMenu === it) {
      lineActions(box, line, inv.items, it, invoiceLineOpts(inv));
    }
  });

  (inv.rentals || []).forEach((x) => {
    const line = lineRow(x.name || 'Rental', rentalSubText(x), moneyText(BidMath.rentalPrice(x, markup)),
      () => { invoiceRentalMenu = invoiceRentalMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (invoiceRentalMenu === x) {
      rentalActions(box, line, inv.rentals, x, {
        data: invoiceData(),
        markupPct: markup,
        persistOr: (restore) => invoiceWrite(inv, restore),
        onChanged: render,
        onClose: () => { invoiceRentalMenu = null; render(); },
      });
    }
  });

  (inv.equipment || []).forEach((x) => {
    const line = lineRow(x.name || 'Equipment', equipSubText(x),
      moneyText(BidMath.equipmentLine(x)),
      () => { invoiceEquipMenu = invoiceEquipMenu === x ? null : x; render(); });
    box.appendChild(line);
    if (invoiceEquipMenu === x) equipActions(box, line, inv.equipment, x, invoiceEquipOpts(inv));
  });

  // The tool list takes the place of the three buttons while it is up: it IS
  // the question, and a + Part button under it is a second one.
  if (invoiceSheet === 'equip') {
    host.appendChild(box);
    const pick = equipmentPickerCard('Which tool?', invoiceData().settings.equipment,
      invoiceData().settings.equipmentPct, (equip) => invoiceAddEquipment(inv, equip));
    pick.appendChild(textButton('Cancel', 'link-btn link-btn-quiet', () => { invoiceSheet = null; render(); }));
    host.appendChild(pick);
    return;
  }

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('+ Part', 'btn btn-primary btn-block', () => {
    navPush();
    invoiceView = 'add';
    invoiceItemMenu = null;
    invoicePicker = pickerState();
    render();
  }));
  nav.appendChild(textButton('+ Rental', 'btn btn-block', () => invoiceAddRental(inv, '')));
  // navPush like + Part above: the tool list is a step into this screen, and
  // one Back is what closes it.
  nav.appendChild(textButton('+ Equipment', 'btn btn-block', () => {
    navPush();
    invoiceSheet = 'equip';
    render();
  }));
  box.appendChild(nav);
  host.appendChild(box);
}

// What the line strip is handed, in one place: the line strip and the test that
// pins it ask for it the same way, the way invoiceEquipOpts below is already
// asked for.
//
// Every material line goes through invoiceWrite, the way the rentals and the
// equipment do: a quantity, a cost, a bill price and a delete all change what
// this invoice comes to, and what it comes to is what decides whether it reads
// as paid.
//
// persistCatalog is the shell's own save, not invoiceWrite. What a part costs
// and what it bills at are facts about the CATALOG, true whether or not this
// draft is ever numbered, and on a draft under review invoiceWrite writes
// nothing at all: without the split, correcting a fat-fingered cost on a
// Friday-night draft taught the catalog nothing.
function invoiceLineOpts(inv) {
  return {
    // The INVOICE's markup, snapshotted the day it was drafted, never
    // Settings': a rate changed since then may not move paper already written.
    markupPct: inv.markupPct,
    data: invoiceData(),
    persistOr: (restore) => invoiceWrite(inv, restore),
    persistCatalog: persistOr,
    onChanged: render,
    onClose: () => { invoiceItemMenu = null; render(); },
  };
}

// The add-a-part flow: the picker, onto this invoice's own items.
function renderInvoiceAdd(host, inv) {
  renderItemPicker(host, invoicePicker, {
    title: 'Add to this invoice',
    items: inv.items,
    tally: (items) => areaTallyText({ items }),
    allowRentals: true,
    onRental: (name) => invoiceAddRental(inv, name || ''),
    onDone: () => { invoiceView = 'invoice'; render(); },
    onChanged: render,
    navPush,
    // invoiceWrite, for the reason spelled out on invoiceLineOpts above: a part
    // added here changes what this invoice comes to. The catalog's own memory
    // goes to disk through the shell's save beside it, so a part invented on a
    // draft under review is in the catalog whether or not the draft ever is.
    persistOr: (restore) => invoiceWrite(inv, restore),
    persistCatalog: persistOr,
    data: invoiceData(),
  });
}

function invoiceAddRental(inv, prefill) {
  addRental(inv.rentals, prefill, {
    data: invoiceData(),
    persistOr: (restore) => invoiceWrite(inv, restore),
    onChanged: render,
    onAdded: (line) => {
      invoiceRentalMenu = line;
      if (invoiceView === 'add') invoiceView = 'invoice';
    },
  });
}

// His own gear, added and edited through picker.js's shared adder: the log
// screen offers the identical three questions, and the only difference between
// the two was the noun in one banner.
//
// persistSettings is the shell's own save rather than invoiceWrite: what a
// tool cost new is a fact about the tool, true whether or not this draft is
// ever numbered, and on a draft under review invoiceWrite writes nothing.
function invoiceEquipOpts(inv) {
  return {
    data: invoiceData(),
    persistOr: (restore) => invoiceWrite(inv, restore),
    persistSettings: persistOr,
    onChanged: render,
    noun: 'invoice',
    onAdded: (line) => { invoiceSheet = null; invoiceEquipMenu = line; },
    onClose: () => { invoiceEquipMenu = null; render(); },
  };
}

function invoiceAddEquipment(inv, equip) {
  addEquipment(inv.equipment, equip, { ...invoiceEquipOpts(inv), onClose: () => { invoiceSheet = null; } });
}

// ---------------------------------------------------------------------------
// THE PROJECT LINE
// ---------------------------------------------------------------------------
// A project invoice bills the proposal, change orders folded in, as ONE line.
// There is nothing on it to count: what it can be changed by is how much of
// the job this one bills, and what is left on the bid after it.

function invoiceProjectRemaining(inv) {
  const bid = invoiceBid(inv);
  if (!bid) return null;
  // Every OTHER project invoice on this bid, so the number underneath is what
  // is left for this one to take rather than what is left after it.
  const others = (invoiceData().invoices || []).filter((x) => x !== inv);
  return InvMath.projectRemainingCents(bid, invoiceData(), others);
}

function buildInvoiceProject(host, inv) {
  const bid = invoiceBid(inv);
  const box = card('The job');
  // The words are the DOCUMENT's, read off the one line a project invoice
  // prints. They were written out a second time here and the two copies were
  // one edit apart from disagreeing about what the paper says.
  const rows = (InvDoc.build(inv, invoiceData()).sections[0] || {}).rows || [];
  const label = rows.length ? rows[0].desc : (inv.projectTitle || 'Project');
  box.appendChild(lineRow(label, bid ? 'The proposal and its change orders' : 'The bid is not on this phone any more',
    moneyText(InvMath.totals(inv).total), null));
  const remaining = invoiceProjectRemaining(inv);
  if (remaining === null) { host.appendChild(box); return; }
  box.appendChild(row('Part of it', moneyText(inv.partCents || 0) + ' of ' + moneyText(remaining),
    () => {
      promptMoney(inv.partCents, {
        label: 'How much of it',
        caption: moneyText(remaining) + ' is left on this bid.',
        done: (cents) => {
          if (cents === null || !(cents > 0)) { showBanner('An invoice has to bill something'); render(); return; }
          if (cents > remaining) { showBanner('That is more than the ' + moneyText(remaining) + ' left on this bid'); render(); return; }
          const prev = inv.partCents;
          inv.partCents = cents;
          invoiceWrite(inv, () => { inv.partCents = prev; });
          render();
        },
      });
    }, { keypad: true }));
  box.appendChild(caption('Bill part of the job now and the rest on a later invoice.'));
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// ON THE INVOICE
// ---------------------------------------------------------------------------
// The three things the paper says that are not money: his customer's purchase
// order, when it is due, and anything he wants written on it. All three are
// snapshots — Settings and the customer card cannot change an invoice that
// already exists — so they are edited here or not at all.

function buildInvoiceSays(host, inv) {
  const box = card('On the invoice');
  box.appendChild(row('P.O. number', inv.po || 'None', () => {
    promptText(inv.po || '', {
      label: 'P.O. number',
      placeholder: 'Leave blank if they do not use them',
      done: (text) => {
        const prev = inv.po;
        inv.po = text == null ? '' : String(text).trim();
        invoiceWrite(inv, () => { inv.po = prev; });
        render();
      },
    });
  }));
  box.appendChild(row('Terms', inv.terms || 'Upon receipt', () => {
    promptText(inv.terms || '', {
      label: 'Terms',
      placeholder: invoiceData().settings.invoiceTerms || 'Upon receipt',
      done: (text) => {
        const next = text == null ? '' : String(text).trim();
        const prev = inv.terms;
        inv.terms = next || (invoiceData().settings.invoiceTerms || 'Upon receipt');
        invoiceWrite(inv, () => { inv.terms = prev; });
        render();
      },
    });
  }));
  box.appendChild(caption('The P.O. cell is left off the paper when there is no number.'));
  host.appendChild(box);

  const notes = card('Notes');
  notes.appendChild((inv.notes || []).length === 0
    ? emptyNote('Nothing extra. Tap a chip or write your own.')
    : caption('These print under the table, above the thank-you line.'));
  if (!Array.isArray(inv.notes)) inv.notes = [];
  notePhrasesPicker(notes, inv.notes, invoiceNoteOpts(inv));
  host.appendChild(notes);
}

// The note goes on THIS invoice through invoiceWrite, which writes nothing
// while the invoice is a draft under review. The LIBRARY is not this invoice:
// "keep this on every future invoice" is an answer about his settings, and it
// has to reach the disk whichever document he happened to be looking at when
// he gave it. So the library gets the shell's own save.
function invoiceNoteOpts(inv) {
  return {
    data: invoiceData(),
    persistOr: (restore) => invoiceWrite(inv, restore),
    persistLibrary: persistOr,
    onChanged: render,
    label: 'Note',
    placeholder: 'Anything the customer should read',
    addLabel: '+ Note',
    keepWhere: 'every future invoice',
    keepCancel: 'Just this invoice',
  };
}

// ---------------------------------------------------------------------------
// PAYMENTS
// ---------------------------------------------------------------------------
// The check, when it comes. Only on something numbered: a draft is not a bill
// and nobody has paid it. The date is typed on the number keypad the way every
// date in this app is, and it defaults to today because the day he records one
// is almost always the day it turned up.

function buildInvoicePayments(host, inv) {
  const box = card('Payments');
  const t = InvMath.totals(inv);
  const paid = InvMath.paidCents(inv);
  const pays = inv.payments || [];
  if (!pays.length) box.appendChild(emptyNote('Nothing in yet.'));
  pays.forEach((p) => {
    box.appendChild(lineRow(fmtDate(p.dateISO), '', moneyText(p.cents),
      () => invoiceDeletePayment(inv, p)));
  });
  box.appendChild(textButton('Record payment', 'btn btn-block', () => invoiceRecordPayment(inv)));
  box.appendChild(caption(paid === 0
    ? moneyText(t.total) + ' outstanding.'
    : moneyText(paid) + ' in · ' + moneyText(InvMath.balanceCents(inv)) + ' left of ' + moneyText(t.total)));
  if (pays.length) box.appendChild(caption('Tap a payment to take it off.'));
  host.appendChild(box);
}

// Date, then the money. Two panels rather than a form, because there are no
// forms in this app.
//
// Today is already ON the keypad rather than being what an empty Done means:
// this keypad refuses an empty Done and shakes (nothing typed and nothing to
// keep is not an answer), and Clear is "never mind" here the way it is on
// every other date in this app. So the default arrives as the prior, and one
// tap on Done records a check that came in this morning, which is nearly all
// of them.
function invoiceTodayTyped(todayISO) {
  return Number(todayISO.slice(5, 7) + todayISO.slice(8, 10));
}

function invoiceRecordPayment(inv) {
  const today = Store.todayISO();
  promptNumber(invoiceTodayTyped(today), {
    label: 'Date: type 915 for Sep 15, or 91526',
    maxChars: 6,
    wasText: 'today is ' + fmtDate(today),
    done: (v) => {
      // Clear means never mind, the same as Cancel, not a rejected date.
      if (v === null) return;
      const iso = Dates.parseTypedDate(v, today);
      if (!iso) { showBanner('That date needs 4 digits (MMDD) or 6 (MMDDYY)'); render(); return; }
      promptMoney(null, {
        label: 'How much came in',
        caption: moneyText(InvMath.balanceCents(inv)) + ' is outstanding.',
        done: (cents) => {
          if (cents === null || !(cents > 0)) { showBanner('A payment has to be more than nothing'); render(); return; }
          const line = { dateISO: iso, cents };
          if (!Array.isArray(inv.payments)) inv.payments = [];
          inv.payments.push(line);
          if (!invoiceWrite(inv, () => {
            const i = inv.payments.indexOf(line);
            if (i !== -1) inv.payments.splice(i, 1);
          })) { render(); return; }
          render();
          showBanner(InvMath.statusOf(inv) === 'paid'
            ? 'Paid in full.'
            : moneyText(InvMath.balanceCents(inv)) + ' left on this one.', 'ok');
        },
      });
    },
  });
}

async function invoiceDeletePayment(inv, p) {
  const ok = await confirmPanel('Take off the ' + moneyText(p.cents) + ' from ' + fmtDate(p.dateISO) + '?',
    { ok: 'Take it off', danger: true });
  if (!ok) { render(); return; }
  const i = (inv.payments || []).indexOf(p);
  if (i !== -1) {
    inv.payments.splice(i, 1);
    invoiceWrite(inv, () => { inv.payments.splice(i, 0, p); });
  }
  render();
}

// ---------------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------------
// The paper, near enough, off the SAME InvDoc.build the PDF is drawn from —
// so a number he reads here is the number that prints. Not pixel-faithful: a
// 390px phone is not US Letter.

function buildInvoicePreview(inv) {
  const doc = InvDoc.build(inv, invoiceData());
  const box = card('Preview');
  box.appendChild(caption('What the customer sees.'));

  const paper = document.createElement('div');
  paper.className = 'prop-preview';

  const head = document.createElement('div');
  head.className = 'prop-doc-head';
  const co = document.createElement('div');
  co.className = 'prop-co';
  co.textContent = doc.header.name;
  head.appendChild(co);
  const contact = [doc.header.person, doc.header.phone, doc.header.email, doc.header.address, doc.header.roc]
    .filter((s) => s && String(s).trim() !== '');
  const sub = document.createElement('div');
  sub.className = 'prop-co-sub';
  sub.textContent = contact.join(' · ');
  head.appendChild(sub);

  // The Invoice box, top right on paper: two values and nothing else. The
  // words are the model's (meta.numberText, meta.dateText) so a document with
  // no number yet reads "draft" here exactly as it does on the page.
  const meta = document.createElement('div');
  meta.className = 'prop-meta';
  const put = (label, value) => {
    if (!value) return;
    const r = document.createElement('div');
    r.className = 'prop-meta-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    r.appendChild(l);
    r.appendChild(v);
    meta.appendChild(r);
  };
  put('Invoice #', doc.meta.numberText);
  put('Date', doc.meta.dateText);
  head.appendChild(meta);
  paper.appendChild(head);

  // Bill To, already stacked by the model in the order it is read.
  const billTo = document.createElement('div');
  billTo.className = 'prop-sec-title';
  billTo.textContent = 'Bill To';
  paper.appendChild(billTo);
  paper.appendChild(paperBullets(doc.meta.billToLines));

  // The strip: the P.O. cell is left out when there is no number, the way the
  // paper leaves the cell out.
  const strip = [
    doc.meta.po ? 'P.O. Number: ' + doc.meta.po : '',
    doc.meta.terms ? 'Terms: ' + doc.meta.terms : '',
    doc.meta.rep ? 'Rep: ' + doc.meta.rep : '',
    doc.meta.project,
  ].filter(Boolean).join(' · ');
  if (strip) {
    const s = document.createElement('div');
    s.className = 'prop-co-sub';
    s.textContent = strip;
    paper.appendChild(s);
  }

  (doc.sections || []).forEach((sec) => {
    const h = document.createElement('div');
    h.className = 'prop-sec-title';
    h.textContent = sec.title;
    paper.appendChild(h);
    sec.rows.forEach((r) => paper.appendChild(paperLine(r.desc, r.qtyText, r.unitCents, r.cents)));
  });

  if (doc.meta.serviceText) {
    const sd = document.createElement('div');
    sd.className = 'prop-courtesy';
    sd.textContent = doc.meta.serviceText;
    paper.appendChild(sd);
  }

  paper.appendChild(paperLine('Subtotal', '', null, doc.subtotalCents));
  paper.appendChild(paperLine('Tax', '', null, doc.taxCents));
  const total = document.createElement('div');
  total.className = 'prop-total';
  const tl = document.createElement('span');
  tl.textContent = 'Total';
  const tv = document.createElement('span');
  tv.textContent = moneyText(doc.totalCents);
  total.appendChild(tl);
  total.appendChild(tv);
  paper.appendChild(total);

  if (doc.notes.length) paper.appendChild(paperBullets(doc.notes));

  const foot = document.createElement('div');
  foot.className = 'prop-courtesy';
  foot.textContent = doc.footer;
  paper.appendChild(foot);

  box.appendChild(paper);
  return box;
}

// ---------------------------------------------------------------------------
// THE PDFS
// ---------------------------------------------------------------------------
// Every PDF this invoice has produced is kept, and the bytes are in hand
// BEFORE the Share button is drawn. Reading a blob out of IndexedDB inside the
// tap spends the transient activation navigator.share needs, and the share
// then never resolves and never rejects: on screen that is a button that is
// dead until the app is reloaded. Measured on the proposal screen, not guessed
// at, and the rule is the same here.

function invoiceLoadPdfs() {
  const inv = invoiceTarget();
  if (!inv || !inv.id) { invoicePdfs = []; return; }
  const token = ++invoicePdfToken;
  Photos.list('pdf').then((ids) => {
    if (token !== invoicePdfToken) return;
    // invoicePdfParse rather than a prefix test written out again here: it is
    // the one thing that knows an invoice id has dashes of its own in it, and
    // it is the same function the archive and the backup pile read these with.
    const entries = ids
      .map(invoicePdfParse)
      .filter((x) => x && x.invoiceId === inv.id)
      .map((x) => ({ id: x.id, at: x.at, blob: null }))
      .sort((a, b) => b.at - a.at)
      .slice(0, INVOICE_PDF_KEEP);
    return Promise.all(entries.map((e) => Photos.get(e.id).then((b) => { e.blob = b; })))
      .then(() => {
        if (token !== invoicePdfToken) return;
        invoicePdfs = entries;
        if (state.screen === 'invoice') render();
      });
  });
}

async function invoiceReshare(inv, entry) {
  if (invoiceBusy) return;
  if (!entry.blob) { showBanner("That copy isn't on this phone any more", 'danger'); return; }
  invoiceBusy = true;
  render();
  try {
    await DocGen.share(entry.blob, InvDoc.fileName(inv, invoiceData()));
  } catch (err) {
    console.error('Could not re-share an invoice PDF', err);
    showBanner("Couldn't open the share sheet", 'danger');
  }
  invoiceBusy = false;
  render();
}

function buildInvoicePrevious(host, inv) {
  const box = card('Previous PDFs');
  if (invoicePdfs === null) {
    box.appendChild(emptyNote('Looking…'));
    host.appendChild(box);
    return;
  }
  if (invoicePdfs.length === 0) {
    box.appendChild(emptyNote('Nothing made for this invoice yet.'));
    host.appendChild(box);
    return;
  }
  invoicePdfs.forEach((entry) => {
    const line = document.createElement('div');
    line.className = 'prop-pdf';
    const when = document.createElement('span');
    when.className = 'prop-pdf-when';
    when.textContent = fmtDateTime(entry.at);
    line.appendChild(when);
    // A row whose bytes are gone still stands: the fact that a document went
    // out that day is itself the record.
    const btn = textButton(entry.blob ? 'Share' : 'Gone', 'btn', () => invoiceReshare(inv, entry));
    if (invoiceBusy || !entry.blob) btn.disabled = true;
    line.appendChild(btn);
    box.appendChild(line);
  });
  box.appendChild(caption('The last ' + INVOICE_PDF_KEEP + ' copies made of this invoice.'));
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

async function invoiceShare(inv) {
  if (invoiceBusy) return;
  // Read before anything re-renders: this is where he was standing when he
  // pressed the button, and it is where he goes back to when the questions are
  // done. The proposal screen sends the same way, off the same two helpers.
  const wasAt = scrollNow();
  invoiceBusy = true;
  render();

  // Two failures, two pieces of news. Nothing was made is "start again"; the
  // sheet would not open is "the document exists, here is where it is".
  let doc = null;
  let pdfBlob = null;
  try {
    doc = InvDoc.build(inv, invoiceData());
    pdfBlob = await DocGen.blobInvoice(doc);
  } catch (err) {
    console.error('Could not build the invoice', err);
    showBanner("Couldn't make the PDF", 'danger');
    invoiceBusy = false;
    render();
    return;
  }

  const id = invoicePdfPrefix(inv.id) + Date.now();
  const stored = Photos.put(id, pdfBlob, 'pdf');

  let result = null;
  let failed = false;
  try {
    result = await DocGen.share(pdfBlob, doc.fileName);
  } catch (err) {
    console.error('Could not share the invoice', err);
    failed = true;
  }
  invoiceBusy = false;

  // On EVERY way out of here — shared, cancelled, or a share that threw —
  // because the row in Previous PDFs is the proof the document was made, and
  // a document he cannot see is a document he makes again.
  //
  // Through deferredBanner because this write finishes at a moment nothing
  // here controls, and the moments straight after a share are the two
  // confirms: a banner raised behind one of them is drawn under the panel and
  // has timed out by the time he has answered it.
  const news = deferredBanner();
  stored.then((ok) => {
    if (!ok) news.show("Couldn't keep a copy on this phone (storage full?)", 'danger');
    invoiceLoadPdfs();
  });

  if (failed) {
    // Flushed first: the sheet that would not open is the news he needs, so it
    // is the sentence left standing.
    news.flush();
    showBanner("Couldn't open the share sheet. The PDF is saved under Previous PDFs.", 'danger');
    render();
    return;
  }
  if (result === 'cancelled') { render(); scrollBack(wasAt); news.flush(); return; }

  // The proposal's two questions, and the answers written in ONE save so a
  // refused write can never leave an invoice marked sent but not filed.
  const markSent = await confirmPanel('Sent to the customer?', { ok: 'Yes', cancel: 'Not yet' });
  const markFiled = await confirmPanel('Did you save a copy on the phone?', { ok: 'Yes', cancel: 'Not yet' });
  const prev = { sentAt: inv.sentAt, savedToFilesAt: inv.savedToFilesAt };
  const today = Store.todayISO();
  if (markSent && !inv.sentAt) inv.sentAt = today;
  if (markFiled) inv.savedToFilesAt = today;
  if (!invoiceWrite(inv, () => {
    inv.sentAt = prev.sentAt;
    inv.savedToFilesAt = prev.savedToFilesAt;
  })) { render(); scrollBack(wasAt); news.flush(); return; }
  render();
  scrollBack(wasAt);
  news.flush();
  if (markSent) showBanner('Marked sent', 'ok');
  invoiceNext();
}

// The queue: the batch the review just numbered, going out one at a time
// because the share sheet needs a tap each. Nothing left is not an error and
// not a banner — it is simply the end of Friday.
// An id in the queue that is no longer on the file is skipped rather than
// opened: he can delete one of the batch from its own screen, and landing on
// "That invoice is not here anymore" with three still to send is a dead end.
// Hands back whether it moved, so a caller with somewhere else to go knows.
function invoiceNext() {
  const d = invoiceData();
  const rest = invoiceQueue.slice();
  while (rest.length) {
    const next = rest.shift();
    if ((d.invoices || []).some((x) => x.id === next)) {
      // Replace: this invoice is finished with, and Back must not walk into an
      // invoice he has already sent.
      show('invoice', { id: next, queue: rest }, { replace: true });
      return true;
    }
  }
  invoiceQueue = [];
  return false;
}

// What the pinned button says. A draft under review goes back to the review,
// where the numbering happens; anything numbered is either going out for the
// first time or going out again.
function invoicePinnedLabel(inv) {
  if (invoiceIsReviewDraft()) return 'Back to the review';
  if (invoiceBusy) return 'Making the PDF…';
  return inv.sentAt ? 'Share again' : 'Send invoice';
}

// The head's second line while a batch is going out: how many are still behind
// this one. Kept as its own sentence because it is the only thing on the
// screen that says Friday is not finished.
function invoiceQueueText(n) {
  if (!n) return null;
  return n + ' more to send';
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
// A numbered invoice he has not sent is a mistake nobody outside has seen, and
// it can go: its hours come back to the pile and he bills them properly. One
// he has already sent cannot — the customer is holding it, and this app has no
// voiding. A draft under review is not deleted either; it is unchecked on the
// home, which is where the decision belongs.

function invoiceCanDelete(inv) {
  if (!inv || !inv.id) return false;
  return !inv.sentAt;
}

async function invoiceDelete(inv) {
  // The pile is only mentioned when there is something to put back in it: a
  // project invoice bills a bid, carries no visits, and a sentence promising
  // him hours back is a sentence about nothing.
  const ok = await confirmPanel('Delete invoice #' + inv.number + '?'
    + ((inv.logIds || []).length ? ' Its hours go back in the pile.' : ''),
    { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  const d = invoiceData();
  const i = (d.invoices || []).indexOf(inv);
  if (i === -1) { render(); return; }
  // Every entry this invoice locked comes back to the pile, and the invoice
  // comes off the file, in ONE save.
  const locks = [];
  (inv.logIds || []).forEach((id) => {
    const e = (d.logs || []).find((x) => x.id === id);
    if (e) { locks.push([e, e.invoiceId]); e.invoiceId = null; }
  });
  d.invoices.splice(i, 1);
  if (!persistOr(() => {
    d.invoices.splice(i, 0, inv);
    locks.forEach(([e, v]) => { e.invoiceId = v; });
  })) { render(); return; }
  // The document is off disk first and the blobs only after: a refused save
  // with the PDFs already gone is the one outcome there is no way back from.
  invoiceDeletePdfs(inv);
  // Friday is not over because one of the batch was a mistake: the rest are
  // still numbered and still waiting to go out.
  if (!invoiceNext()) show('invoices', undefined, { replace: true });
  showBanner('Deleted. ' + INVOICE_NUMBER_SPENT, 'ok');
}

function invoiceDeletePdfs(inv) {
  Photos.list('pdf')
    .then((ids) => Photos.delMany(ids.filter((x) => {
      const hit = invoicePdfParse(x);
      return !!hit && hit.invoiceId === inv.id;
    })))
    .then((ok) => {
      if (!ok) showBanner("Couldn't clear this invoice's PDFs from the phone. They take space but change nothing.");
    });
}

// ---------------------------------------------------------------------------
// RENDER AND REGISTER
// ---------------------------------------------------------------------------

function renderInvoice() {
  const host = el('invoiceContent');
  host.textContent = '';
  const inv = invoiceTarget();
  if (!inv) {
    host.appendChild(screenHead('Invoice', null));
    host.appendChild(emptyNote('That invoice is not here anymore.'));
    return;
  }
  if (invoiceView === 'add') { renderInvoiceAdd(host, inv); return; }

  host.appendChild(screenHead(inv.number === null ? 'Draft invoice' : 'Invoice #' + inv.number,
    invoiceQueueText(invoiceQueue.length)));
  buildInvoiceSummary(host, inv);
  if (inv.kind === 'project') {
    buildInvoiceProject(host, inv);
  } else {
    buildInvoiceLabor(host, inv);
    buildInvoiceLines(host, inv);
    // The tool list stands in for the rest of the screen while it is up: it is
    // the question, and the cards under it are things to answer instead of it.
    if (invoiceSheet === 'equip') return;
  }
  buildInvoiceSays(host, inv);
  if (inv.number !== null) buildInvoicePayments(host, inv);
  if (!invoiceIsReviewDraft()) buildInvoicePrevious(host, inv);

  const toggle = textButton(invoicePreviewOpen ? 'Hide preview' : 'Preview', 'btn btn-block prop-preview-toggle',
    () => { invoicePreviewOpen = !invoicePreviewOpen; render(); });
  toggle.setAttribute('aria-expanded', invoicePreviewOpen ? 'true' : 'false');
  host.appendChild(toggle);
  if (invoicePreviewOpen) host.appendChild(buildInvoicePreview(inv));

  if (invoiceCanDelete(inv)) {
    host.appendChild(textButton('Delete this invoice', 'link-btn link-btn-quiet', () => invoiceDelete(inv)));
    host.appendChild(caption(INVOICE_NUMBER_SPENT));
  }

  pinnedBar(host, invoicePinnedLabel(inv), () => {
    if (invoiceIsReviewDraft()) { show('billreview'); return; }
    invoiceShare(inv);
  }, { disabled: invoiceBusy });
}

// The steps inside this screen: the picker's own, then the tool list, then out.
// A peek must answer without moving, because the shell asks it to decide what
// to write on the Back button.
function invoiceBackStep(peek) {
  if (invoiceView === 'add') {
    if (peek) return true;
    if (pickerBackStep(invoicePicker)) { render(); return true; }
    invoiceView = 'invoice';
    render();
    return true;
  }
  if (invoiceSheet) {
    if (!peek) { invoiceSheet = null; render(); }
    return true;
  }
  return false;
}

registerScreen('invoice', {
  id: 'screen-invoice', title: 'Invoice', tab: 'invoices',
  // A draft belongs to the review it was built on; anything numbered belongs to
  // the list on the home.
  back: () => (invoiceIsReviewDraft() ? 'billreview' : 'invoices'),
  enter: enterInvoice, render: renderInvoice, backStep: invoiceBackStep,
  // The picker's flash timer outlives this screen by up to a second. Clearing
  // the highlight on the state object the timer is holding is what makes that
  // late timer a no-op instead of a redraw of whatever screen took the glass.
  leave: () => { invoicePicker.highlight = null; },
});
