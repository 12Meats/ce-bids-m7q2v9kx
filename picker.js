'use strict';

// picker.js — the shared pieces the lists of counted lines are built from:
// the add-a-part picker, the strip a line opens, the rental editor, the row
// and the check in front of it, and the one answer two Invoices screens share.
//
// Loaded after ui.js and before app.js and screens/*.js. It was the last third
// of ui.js until the truck log turned every one of these into a thing two
// screens do — an area on a walk and a visit at the tailgate hold the same
// lines, and a bid and a visit rent the same lift — and a file that holds
// everything shared eventually holds everything. Same rules as ui.js: nothing
// here reaches into app state, every function takes values and callbacks and
// hands back elements or booleans, and a screen file never defines a helper
// another screen calls.
//
// Sections: THE ROW · THE CHECK · THE PILE SELECTION · THE DRAFTS UNDER REVIEW ·
// AN INVOICE IN WORDS · THE LINE STRIP · THE RENTAL EDITOR · THE PAPER ·
// THE NOTE PHRASES · THE ITEM PICKER

// ---------------------------------------------------------------------------
// THE ROW
// ---------------------------------------------------------------------------
// A two-line tappable line: name and money on top, the detail underneath.
// Pass no onTap for an inert one (the area-cost footer), which then wears
// .flat: no chevron, no press state, nothing to aim at. opts.keypad says the
// tap opens a number panel, so the value goes navy instead of taking a ›.
//
// This was the walk's own walkRow until the add-a-part flow moved here: the
// picker draws these, and so does every list of counted lines the picker
// feeds — an area on the walk, a log entry at the truck. One row, one class,
// one set of measurements, wherever the lines are shown.
function lineRow(name, sub, value, onTap, opts) {
  const node = document.createElement(onTap ? 'button' : 'div');
  node.className = 'walk-row' + tapClasses(onTap, opts);
  if (onTap) {
    node.type = 'button';
    node.addEventListener('click', onTap);
  }

  const text = document.createElement('div');
  text.className = 'walk-row-text';
  const n = document.createElement('div');
  n.className = 'walk-row-name';
  n.textContent = name;
  text.appendChild(n);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'walk-row-sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  node.appendChild(text);

  if (value !== null && value !== undefined && value !== '') {
    const v = document.createElement('div');
    v.className = 'walk-row-value';
    v.textContent = String(value);
    node.appendChild(v);
  }
  if (onTap && !(opts && opts.keypad)) node.appendChild(chevron());
  return node;
}

// ---------------------------------------------------------------------------
// THE CHECK
// ---------------------------------------------------------------------------
// checkRow(label, sub, on, onToggle, onOpen) -> a lineRow with a square check
// in front of it. Two targets on one line, and they mean different things: the
// square says whether this group is in the batch about to be billed, the text
// opens what it is about. Two buttons rather than one row with a corner that
// behaves differently, so a thumb that misses by 4px does the harmless one.
//
// The mark is always in the DOM and turns transparent when it is off, so
// checking a row cannot make the row move.
//
// The BUTTON is 44px square and the square he sees inside it is 24px: a 24px
// button is half the size of every other target in this app, sitting a
// thumb's width from a second button that opens a different screen. The mark
// is a box inside the target rather than the target itself, so the thing to
// aim at is bigger than the thing to look at.
function checkRow(label, sub, on, onToggle, onOpen) {
  const wrap = document.createElement('div');
  wrap.className = 'check-row';

  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'check-box' + (on ? ' on' : '');
  box.setAttribute('aria-pressed', on ? 'true' : 'false');
  box.setAttribute('aria-label', (on ? 'Uncheck ' : 'Check ') + label);
  const mark = document.createElement('span');
  mark.className = 'check-mark';
  mark.textContent = '✓';
  mark.setAttribute('aria-hidden', 'true');
  box.appendChild(mark);
  if (onToggle) box.addEventListener('click', onToggle);
  wrap.appendChild(box);

  const text = lineRow(label, sub, null, onOpen);
  text.classList.add('check-text');
  wrap.appendChild(text);
  return wrap;
}

// ---------------------------------------------------------------------------
// THE PILE SELECTION
// ---------------------------------------------------------------------------
// Which log entries are checked to be billed. It is one answer read by two
// screens — the Invoices home, where he checks and unchecks, and the Bill
// these review, which bills exactly what was checked — and a screen may never
// call another screen's file. So it lives here, with the other things both of
// them use, rather than as a module variable on whichever of the two happened
// to be written first.
//
// It remembers what he turned OFF, never what is on. An entry logged after the
// last time he touched this list is ON, because he has never said otherwise:
// a set of the checked ids would have been written before that entry existed,
// and the visit he logged this morning would come back unchecked and be left
// out of Friday's billing without anything on the glass saying so.
const pileSelection = (function () {
  let off = new Set();
  return {
    isOn(id) { return !off.has(id); },
    setOn(id, on) { if (on) off.delete(id); else off.add(id); },
    clear() { off = new Set(); },
  };
})();

// ---------------------------------------------------------------------------
// THE DRAFTS UNDER REVIEW
// ---------------------------------------------------------------------------
// The invoices the Bill these review has built and not numbered yet. The same
// rule as pileSelection, and for the same reason: the review builds them, the
// invoice screen opens one of them to be edited before anything is numbered,
// and neither screen may call the other's file. Nothing here is on disk — a
// draft becomes real on the review's own Number and send.
const reviewDrafts = (function () {
  let drafts = [];
  return {
    get() { return drafts; },
    set(next) { drafts = Array.isArray(next) ? next : []; },
  };
})();

// ---------------------------------------------------------------------------
// AN INVOICE IN WORDS
// ---------------------------------------------------------------------------
// What an invoice IS, in the one or two words a man wants at a glance. The
// status on file is three flat words (draft, sent, paid) and only one of them
// is the whole news: "Sent" on an invoice a customer has half paid is the
// wrong thing to say, so a part-paid one says what came in and what is on it.
//
// Two screens print it — the list on the Invoices home and the invoice's own
// summary card — so it is written once, here, rather than once per screen.
// InvMath decides what the status IS; this only chooses the words.
function invoiceStatusPill(inv) {
  const st = InvMath.statusOf(inv);
  if (st === 'paid') return 'Paid';
  if (st === 'draft') return 'Draft';
  const paid = InvMath.paidCents(inv);
  return paid > 0
    ? 'Paid ' + moneyText(paid) + ' of ' + moneyText(InvMath.totals(inv).total)
    : 'Sent';
}

// ---------------------------------------------------------------------------
// THE LINE STRIP
// ---------------------------------------------------------------------------
// What a counted line can be after it is on the list: Quantity, Cost, Bills at,
// Delete. This was the walk's buildItemActions, and it moved here for the same
// reason the picker did — the truck log holds the same lines and had to be able
// to fix a fat-fingered count without a second copy of these four buttons
// drifting away from the first.
//
//   lineActions(box, lineEl, items, it, opts)
//     items          the array the line is IN, so Delete can take it out
//     opts.markupPct what this line bills at, for the Bills at caption
//     opts.data      the shell's data (the catalog's memory of the price, the
//                    settings the price search reads)
//     opts.persistOr the shell's persistOr
//     opts.onChanged () => void   redraw; the strip stays where it is
//     opts.onClose   () => void   the strip is answered: close it and redraw
//
// The two callbacks are two different things and both are needed: a count of
// zero puts a banner up and leaves the strip open to be answered again, and a
// count that took leaves nothing to answer.
// THE FOUR QUESTIONS A LINE IS ASKED, in words, by name.
//
// They live with the strip that asks them rather than in ui.js: nothing else
// in the app asks a part how many of it there are. The catalog's vocabulary
// (UNIT_MANY, UNIT_ONE, perUnitText) stays in ui.js, where every other
// sentence about a unit reads it from.

// '3/4" EMT, how many feet?'
function partQtyLabel(name, unit) {
  const w = UNIT_MANY[unit];
  return w ? name + ', how many ' + w + '?' : name + ', how many?';
}

// '3/4" EMT, cost per foot'
function partCostLabel(name, unit) {
  const w = UNIT_ONE[unit];
  return w ? name + ', cost per ' + w : name + ', cost each';
}

// '#12 wire, bill price per foot' — the second price, asked the way the cost is.
function partBillLabel(name, unit) {
  return name + ', bill price' + perUnitText(unit);
}

// '#12 wire, all 500 feet together' — one number for the whole line. A count
// of one has nothing to gather ("all 1 lot together" reads like a bug), so it
// says what it is: the whole line.
function partLotLabel(name, qty, unit) {
  if (qty === 1) return name + ', the whole line';
  const w = UNIT_MANY[unit];
  return name + ', all ' + numText(qty) + (w ? ' ' + w : '') + ' together';
}

function lineCatalogPart(it, data) {
  return it.catalogId ? ((data.catalog || []).find((p) => p.id === it.catalogId) || null) : null;
}

function lineActions(box, lineEl, items, it, opts) {
  const strip = attachedStrip(lineEl, [
    { label: 'Quantity', onTap: () => {
      promptNumber(it.qty, {
        label: partQtyLabel(it.name, it.unit),
        allowDecimal: true,
        done: (v) => {
          if (v === null) return;
          if (!(v > 0)) { showBanner('A count has to be more than zero'); opts.onChanged(); return; }
          const prev = it.qty;
          it.qty = v;
          opts.persistOr(() => { it.qty = prev; });
          opts.onClose();
        },
      });
    } },
    { label: 'Cost', onTap: () => {
      promptMoney(it.costCents, {
        label: partCostLabel(it.name, it.unit),
        caption: pickerPriceCaption(),
        captionAction: pickerPriceAction(opts.data.settings, it.name),
        done: (cents) => {
          const part = lineCatalogPart(it, opts.data);
          const prev = it.costCents;
          const prevLast = part ? part.lastCostCents : null;
          it.costCents = cents === null ? 0 : cents;
          // The catalog remembers the last price he actually paid, so correcting
          // a fat-fingered cost here also corrects what the next bid offers him.
          if (part) part.lastCostCents = it.costCents;
          opts.persistOr(() => {
            it.costCents = prev;
            if (part) part.lastCostCents = prevLast;
          });
          opts.onClose();
        },
      });
    } },
    { label: 'Bills at', onTap: () => lineAskBillsAt(it, opts) },
    { label: 'Delete', quiet: true, onTap: async () => {
      const ok = await confirmPanel('Delete ' + it.name + '?', { ok: 'Delete', danger: true });
      if (!ok) { opts.onChanged(); return; }
      const i = items.indexOf(it);
      if (i !== -1) {
        items.splice(i, 1);
        opts.persistOr(() => { items.splice(i, 0, it); });
      }
      opts.onClose();
    } },
  ], { cancel: () => opts.onClose() });
  // The row is already in the card, so attachedStrip has placed it. This is the
  // belt-and-braces path for a caller that built the row off-screen.
  if (!strip.parentNode) box.appendChild(strip);
}

// The SECOND price. His supply houses sell him a part under list and the
// customer is billed at list, then the markup, so a line has two numbers:
// Cost, which the margin is figured on, and this, which the paper prints.
// Absent, the markup goes on the cost, which is what every line did before
// this button existed, and Clear puts a line back there. The catalog
// remembers it the way it remembers the cost, so the next bid offers both.
//
// The caption's link is the door to the lot: one number for the whole line.
// It CLOSES this keypad (captionAction.closes) because promptMoney will not
// open over an open panel, and a link that did nothing would read as broken.
// A line restored from an old file with a per-unit price of its own
// (priceCents, which no screen writes any more) says so, because that price
// wins over this one and a Done that moved nothing would look like a bug.
function lineAskBillsAt(it, opts) {
  const part = lineCatalogPart(it, opts.data);
  promptMoney(it.listCents != null ? it.listCents : null, {
    label: partBillLabel(it.name, it.unit),
    caption: it.lotCents != null
      ? 'This line is priced as a lot at ' + moneyText(it.lotCents) + '. The lot wins until you clear it.'
      : it.priceCents != null
        ? 'This line has a price of its own at ' + moneyText(it.priceCents) + ', and that wins.'
        : 'Before the ' + pctText(opts.markupPct) + ' markup. Clear to bill off the cost instead.',
    captionAction: {
      label: it.lotCents != null ? "Change the whole line's price" : 'Price the whole line instead',
      closes: true,
      onTap: () => lineAskLot(it, opts),
    },
    done: (cents) => {
      const prev = it.listCents;
      const prevLast = part ? part.lastListCents : undefined;
      const prevChecked = part ? part.priceCheckedISO : undefined;
      it.listCents = cents;                       // null is "back to the cost"
      // A price he types here is his own, typed by hand, not QED's. If the
      // part still carried the date of an earlier import, that date now lies
      // about where this number came from, so it comes off with it.
      if (part) { part.lastListCents = cents; part.priceCheckedISO = null; }
      opts.persistOr(() => {
        it.listCents = prev;
        if (part) { part.lastListCents = prevLast; part.priceCheckedISO = prevChecked; }
      });
      opts.onClose();
    },
  });
}

// THE LOT. $216.00 for 500 ft of #12 is 43.2 cents a foot, which the cost
// keypad cannot take, so the line takes one number instead: what the customer
// pays for all of it, markup included. The paper prints the quantity, a blank
// unit price and the amount, which is how his own invoices do a roll of wire.
// Clear takes the line back to per-unit pricing. A lot does not follow the
// quantity: change the count and the lot is still the lot, and the row says
// so in words.
function lineAskLot(it, opts) {
  const per = perUnitText(it.unit);             // ' per foot' / ' each'
  promptMoney(it.lotCents != null ? it.lotCents : null, {
    label: partLotLabel(it.name, it.qty, it.unit),
    caption: 'The whole line, markup included. No price' + per + ' prints. Clear to price it' + per + ' again.',
    done: (cents) => {
      const prev = it.lotCents;
      it.lotCents = cents;
      opts.persistOr(() => { it.lotCents = prev; });
      opts.onClose();
    },
  });
}

// ---------------------------------------------------------------------------
// THE RENTAL EDITOR
// ---------------------------------------------------------------------------
// What a rented lift is on a list: a name, how many days, what the yard
// charges for the whole hire, and one switch saying whether the customer pays
// the markup on it. Two screens hold rentals now — the bid's Costs & price
// screen and a visit written at the truck — and they held two copies of these
// four questions, which is two places for the words to drift apart.
//
//   addRental(rentals, prefill, opts)             name, then days, then money
//   rentalActions(box, lineEl, rentals, x, opts)  the strip a line opens
//     opts.data       the shell's data (the catalog the name chips come from)
//     opts.markupPct  what this line bills at, for the Prints at caption
//     opts.persistOr  the caller's save, with an exact restore handed to it
//     opts.onChanged  () => void  redraw; the strip stays where it is
//     opts.onClose    () => void  the strip is answered: close it and redraw
//     opts.onAdded    (line) => void  optional, addRental only: the line landed
//     opts.promptDays optional, for a caller with a day-count question of its
//                     own — the price screen shakes the chip he tapped and
//                     re-asks a refused number, because mid-flow there is
//                     nothing behind the panel to go back to.
//
// The switch says the ACTION, "Add markup" or "Remove markup", and the caption
// under the strip says the state in the only units that matter: the number the
// paper will print. It was "Markup on/off" once, which said the state and left
// him to work out what tapping it would do (screens/price.js:331-336).
//
// The cents field is the TOTAL for the whole hire and not a day rate (Adrian's
// call, 9/05: it is what his paper bids say, "Lift rental · 1 week · $501"), so
// the button and the keypad both say so.
function rentalTotalLabel(name) {
  return 'What will the ' + (name || 'rental') + ' cost in total?';
}
function rentalTotalCaption(days) {
  return 'For all ' + numText(days) + ' ' + (days === 1 ? 'day' : 'days') + ', what the rental house charges.';
}

function rentalPromptDays(opts, current, label, apply) {
  if (typeof opts.promptDays === 'function') { opts.promptDays(current, label, apply); return; }
  promptNumber(current, {
    label,
    allowDecimal: true,
    done: (v) => {
      if (v === null) return;
      if (!(v > 0)) { showBanner('Days have to be more than zero'); opts.onChanged(); return; }
      apply(v);
    },
  });
}

// Three panels rather than a form, because there are no forms in this app, and
// in the order he would say them out loud. The naming step is the walk's, so
// the chips he gets on a bid are the chips he gets standing at the tailgate.
function addRental(rentals, prefill, opts) {
  promptRentalName(opts.data.catalog, prefill || '', (name) => {
    rentalPromptDays(opts, 1, (name || 'Rental') + ', how many days?', (days) => {
      promptMoney(null, {
        label: rentalTotalLabel(name),
        caption: rentalTotalCaption(days),
        done: (cents) => {
          // Clear means none of it, which is a real answer here, not a cancel:
          // the yard has not said what it costs yet and the lift is still on
          // the job. The line goes on at $0 and reads as unpriced.
          const line = { name, days, cents: cents === null ? 0 : cents, markup: false };
          rentals.push(line);
          if (!opts.persistOr(() => {
            const i = rentals.indexOf(line);
            if (i !== -1) rentals.splice(i, 1);
          })) { opts.onChanged(); return; }
          if (opts.onAdded) opts.onAdded(line);
          opts.onChanged();
        },
      });
    });
  });
}

// Days, the money, the switch, and the way off the list. Everything but Delete
// leaves the strip open: the caption under it moves when he changes something,
// and a strip that closed would take the answer off the glass with it.
function rentalActions(box, lineEl, rentals, x, opts) {
  const strip = attachedStrip(lineEl, [
    { label: 'Days', onTap: () => rentalPromptDays(opts, x.days, (x.name || 'Rental') + ', how many days?', (v) => {
      const prev = x.days;
      x.days = v;
      opts.persistOr(() => { x.days = prev; });
      opts.onChanged();
    }) },
    { label: 'Total cost', onTap: () => {
      promptMoney(x.cents, {
        label: rentalTotalLabel(x.name),
        caption: rentalTotalCaption(x.days),
        done: (cents) => {
          const prev = x.cents;
          x.cents = cents === null ? 0 : cents;
          opts.persistOr(() => { x.cents = prev; });
          opts.onChanged();
        },
      });
    } },
    { label: x.markup ? 'Remove markup' : 'Add markup', onTap: () => {
      const prev = x.markup;
      x.markup = !prev;
      opts.persistOr(() => { x.markup = prev; });
      opts.onChanged();
    } },
    { label: 'Delete rental', quiet: true, onTap: async () => {
      const ok = await confirmPanel('Delete ' + (x.name || 'this rental') + '?', { ok: 'Delete', danger: true });
      if (!ok) { opts.onChanged(); return; }
      const i = rentals.indexOf(x);
      if (i !== -1) {
        rentals.splice(i, 1);
        opts.persistOr(() => { rentals.splice(i, 0, x); });
      }
      opts.onClose();
    } },
  ], { cancel: () => opts.onClose() });
  // The row may already be in the card, in which case attachedStrip has placed
  // the strip under it; a caller assembling a line off-screen appends it here.
  if (!strip.parentNode) box.appendChild(strip);
  // And the caption goes directly under the strip, wherever the strip ended up.
  const cap = caption('Prints at ' + moneyText(BidMath.rentalPrice(x, opts.markupPct)));
  strip.parentNode.insertBefore(cap, strip.nextSibling);
  return strip;
}

// ---------------------------------------------------------------------------
// THE PAPER
// ---------------------------------------------------------------------------
// One row of a document as it is previewed on the glass: what it is on the
// left, what it costs on the right. The quantity and the unit price ride
// UNDER the description in the muted second line rather than in columns of
// their own — four columns at 390px is four columns of nothing, and run
// together on one line an iPhone SE wrapped the unit price down under the
// row's total, two dollar amounts stacked with one of them small, reading as
// the same number printed twice.
//
// This was proposalPreviewLine. It moved here when the invoice grew a preview
// of its own: two documents, two screens, one drawing of a row, and a screen
// may never call another screen's file. The PAPER is unaffected either way;
// docgen.js has four real columns at fixed widths.
function paperLine(desc, qtyText, unitCents, cents) {
  const line = document.createElement('div');
  line.className = 'prop-line';

  const d = document.createElement('span');
  d.className = 'prop-line-desc';
  const name = document.createElement('span');
  name.className = 'prop-line-name';
  name.textContent = desc;
  d.appendChild(name);

  // "240 ft at $1.12", the way he says it out loud — and it still reads right
  // with only one of the two ("48 hrs", "$1.12").
  const unit = (unitCents === null || unitCents === undefined) ? '' : moneyText(unitCents);
  const detail = (qtyText && unit) ? (qtyText + ' at ' + unit) : (qtyText || unit);
  if (detail) {
    const sub = document.createElement('span');
    sub.className = 'prop-line-sub';
    sub.textContent = detail;
    d.appendChild(sub);
  }

  const m = document.createElement('span');
  m.className = 'prop-line-money';
  m.textContent = cents === null ? '' : moneyText(cents);
  line.appendChild(d);
  line.appendChild(m);
  return line;
}

// A bulleted block on the same preview: scope, terms, the numbered clause
// titles, the notes on an invoice.
function paperBullets(lines) {
  const ul = document.createElement('ul');
  ul.className = 'prop-bullets';
  lines.forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
  return ul;
}

// ---------------------------------------------------------------------------
// THE NOTE PHRASES
// ---------------------------------------------------------------------------
// The sentences a document carries in its own words: notes and exclusions on a
// proposal, the line or two he adds to an invoice. Both are a plain array of
// strings on the record, and both are filled the same way — chips for the
// wording he already uses (settings.notePhrases) plus anything on THIS
// document that is not in that list, so a one-off can be tapped back off.
//
//   notePhrasesPicker(box, notes, opts)
//     notes           the array on the record (bid.notes / inv.notes)
//     opts.data       the shell's data (settings.notePhrases)
//     opts.persistOr  the caller's save, with an exact restore handed to it
//     opts.onChanged  () => void   redraw
//     opts.label      the + button's prompt ('Note or exclusion')
//     opts.placeholder
//     opts.addLabel   the + button's own words ('+ Note')
//     opts.keepWhere  'every future bid' / 'every future invoice', for the
//     opts.keepCancel one question the library asks about a new sentence
//
// The notes array is mutated IN PLACE and restored in place: this file is
// handed the array, not the record it hangs off, so it has no property to
// put back.
function notePhraseChips(notes, data) {
  const phrases = ((data.settings && data.settings.notePhrases) || []).slice();
  notes.forEach((n) => { if (phrases.indexOf(n) === -1) phrases.push(n); });
  return phrases;
}

function notePhrasesRestore(notes, prev) {
  notes.length = 0;
  prev.forEach((n) => notes.push(n));
}

function noteToggle(notes, phrase, opts) {
  const prev = notes.slice();
  const i = notes.indexOf(phrase);
  if (i === -1) notes.push(phrase);
  else notes.splice(i, 1);
  if (!opts.persistOr(() => notePhrasesRestore(notes, prev))) { opts.onChanged(); return; }
  opts.onChanged();
}

// A new sentence goes on THIS document first and is offered to the library
// second, so a refused save of the phrase list can never cost him the note he
// just wrote.
function noteAdd(notes, opts) {
  promptText('', {
    label: opts.label || 'Note',
    placeholder: opts.placeholder || '',
    done: async (text) => {
      if (!text) return;
      if (notes.indexOf(text) === -1) {
        const prev = notes.slice();
        notes.push(text);
        if (!opts.persistOr(() => notePhrasesRestore(notes, prev))) { opts.onChanged(); return; }
      }
      opts.onChanged();

      const s = opts.data.settings;
      if (!Array.isArray(s.notePhrases) || s.notePhrases.indexOf(text) !== -1) return;
      const keep = await confirmPanel(
        'Keep "' + text + '" as a chip on ' + (opts.keepWhere || 'every future document') + '?',
        { ok: 'Keep it', cancel: opts.keepCancel || 'Just this one' }
      );
      if (!keep) { opts.onChanged(); return; }
      const prevPhrases = s.notePhrases.slice();
      s.notePhrases.push(text);
      opts.persistOr(() => { s.notePhrases = prevPhrases; });
      opts.onChanged();
    },
  });
}

function notePhrasesPicker(box, notes, opts) {
  const chips = document.createElement('div');
  chips.className = 'prop-chips';
  notePhraseChips(notes, opts.data).forEach((phrase) => {
    chips.appendChild(chip(phrase, notes.indexOf(phrase) !== -1, () => noteToggle(notes, phrase, opts)));
  });
  box.appendChild(chips);
  box.appendChild(textButton(opts.addLabel || '+ Note', 'btn btn-block', () => noteAdd(notes, opts)));
  return box;
}

// ---------------------------------------------------------------------------
// THE ITEM PICKER
// ---------------------------------------------------------------------------
// Six tiles, then a list, then two numbers. The hybrid: the catalog is there
// so he never types "3/4 EMT" again, and + New part is there so the one thing
// the catalog has never heard of doesn't stop the walk.
//
// This was the walk's add-a-part flow. It lives here because the truck log
// needs the identical flow onto a log entry's items, and the one thing worse
// than a second copy of a screen is a second copy of a screen that drifts.
// The picker knows nothing about who is using it: it is handed a state object
// and a list to push onto, and it calls back for everything else.
//
//   pickerState() -> { cat, search, listEl, newPart, pending, highlight }
//   renderItemPicker(host, ps, opts) draws the whole add flow into host:
//     opts.title        'Add to Lactose room'      (screenHead, centered)
//     opts.items        the array a picked part is pushed onto
//     opts.tally        (items) => string          the running strip text, or null for none
//     opts.allowRentals boolean                    the rentals tile and rental hits in search
//     opts.onRental     (name) => void             TWO calls, and a caller must answer both.
//                                                  A NAME is a rental picked out of a drawer or
//                                                  found by a search: it has everything the line
//                                                  needs and goes straight onto the caller's own
//                                                  rentals list. NULL is the rentals TILE, which
//                                                  is a question with no answer in the picker
//                                                  ("rented, or your own?"); a caller that has no
//                                                  such question of its own must still do
//                                                  something with it rather than drop it, or the
//                                                  tile is a tap that does nothing.
//     opts.onDone       () => void                 the pinned Done
//     opts.onChanged    () => void                 the picker's state moved: redraw the screen.
//                                                  Called from EVERY state change, not only a
//                                                  commit — a tile tapped, a search that could not
//                                                  redraw its own list, a part invented, a refused
//                                                  save, the flash going out.
//     opts.navPush      () => void                 pushed for the step INTO a drawer and for the
//                                                  FIRST search keystroke, so each of those is
//                                                  exactly one Back
//     opts.persistOr    the shell's persistOr
//     opts.data         the shell's own data object (catalog, settings)
//   pickerCommitItem(ps, opts, part, qty, costCents) -> boolean
//   pickerBackStep(ps) -> boolean: pending, then newPart, then the search, then the category.
//
// Every mutation goes through opts.persistOr with an exact restore. The flash
// timer outlives the screen it was started on, so the caller clears
// ps.highlight in its own leave(), and a late flash timer cannot redraw a
// screen that is no longer up.

const PICKER_HIGHLIGHT_MS = 1000;

function pickerState() {
  return {
    cat: null,          // the category being browsed
    search: '',
    listEl: null,       // the live list, so typing in search redraws only it
    newPart: null,      // { category, name } while the unit picker is up
    pending: null,      // { part, qty } waiting on the same-price answer
    highlight: null,    // the item flashed for a second after it was added
  };
}

function renderItemPicker(host, ps, opts) {
  // Written for callers that do not exist yet. Both of these are wiring
  // mistakes that would otherwise show up as a tap that does nothing on a
  // screen nobody has written yet: a missing items array throws at the commit,
  // eight taps into the flow, and a missing onRental throws only when he
  // happens to pick a lift. Said here, on the first render, they are found the
  // first time the screen is opened.
  if (!opts || !Array.isArray(opts.items)) {
    throw new Error('renderItemPicker needs opts.items (the array a picked part is pushed onto)');
  }
  if (opts.allowRentals && typeof opts.onRental !== 'function') {
    throw new Error('renderItemPicker needs opts.onRental when allowRentals is true');
  }
  host.appendChild(screenHead(opts.title, null, { center: true }));

  if (ps.pending) { host.appendChild(pickerPriceAnswer(ps, opts)); return; }
  if (ps.newPart) { host.appendChild(pickerUnitPicker(ps, opts)); return; }

  // What he has counted here so far, and what it costs him. He adds eight
  // things in a row without leaving this screen, so the running total is the
  // only way he can tell that any of it landed.
  if (opts.tally) host.appendChild(pickerTallyStrip(ps, opts));

  // The search is ABOVE the tiles and searches everything: knowing the name of
  // the part is not the same as knowing which of six drawers this app filed it
  // under, and he knows the name. Redraws only the list below it — rebuilding
  // the input under a typing thumb would drop focus and close the keyboard.
  host.appendChild(searchInput({
    className: 'walk-search',
    placeholder: 'Search all parts',
    label: 'Search all parts',
    value: ps.search,
    onInput: (value) => {
      // The first character is the step from the tiles into a list; the rest
      // are typing. One entry, so one Back puts the tiles back.
      if (ps.search.trim() === '' && value.trim() !== '') opts.navPush();
      ps.search = value;
      if (ps.listEl && ps.listEl.isConnected) pickerBody(ps, opts, ps.listEl);
      else opts.onChanged();
    },
  }));

  ps.listEl = document.createElement('div');
  pickerBody(ps, opts, ps.listEl);
  host.appendChild(ps.listEl);

  // The way out of the add flow that is not Back: he is done counting here,
  // rather than one step up the list. Pinned, because it is eleven rows down
  // a parts list by the time he wants it.
  pinnedBar(host, 'Done', () => opts.onDone());
}

// Tiles, or a list. A search beats a category — typing crosses all six drawers,
// which is what Catalog.matches does with a query — and clearing it puts the
// tiles back exactly where they were.
function pickerBody(ps, opts, host) {
  host.textContent = '';
  if (ps.search.trim() === '' && !ps.cat) {
    host.appendChild(pickerTiles(ps, opts));
    return;
  }
  const box = card();
  pickerList(ps, opts, box);
  host.appendChild(box);
}

// "3 items · $412.00" — the running total of the list he is adding to, at
// cost. The arithmetic is the caller's (areaTallyText for an area), where it
// is pure and tested; this only decides whether it flashes, which it does for
// a second after something is added.
function pickerTallyStrip(ps, opts) {
  const strip = document.createElement('div');
  strip.className = 'walk-tally';
  strip.textContent = opts.tally(opts.items);
  if (ps.highlight) strip.classList.add('walk-row-new');
  return strip;
}

// allowRentals drops the rentals tile when it is false: a rental line lives on
// the bid's own rentals list, which a change order does not have and must not
// borrow.
function pickerTiles(ps, opts) {
  const grid = document.createElement('div');
  grid.className = 'walk-tiles';
  CATALOG_CATEGORIES.filter(([key]) => !(!opts.allowRentals && key === 'rentals')).forEach(([key, label]) => {
    grid.appendChild(textButton(label, 'walk-tile', () => {
      // Rentals and owned equipment are not material lines — they are priced
      // per day on the Costs & price screen. All this tile does is get the
      // line onto the bid before he forgets it exists, and WHAT that means is
      // the caller's: it is handed the tile with no name and answers it.
      opts.navPush();
      if (key === 'rentals') { opts.onRental(null); return; }
      ps.cat = key;
      ps.search = '';
      opts.onChanged();
    }));
  });
  return grid;
}

// Which parts to offer and in what order is a rule, not a rendering decision,
// so it lives in catalog.js where it is pure and tested: hidden ones excluded,
// rentals kept out of the material lists, search crossing categories, most-used
// first. This only decides what to do with what comes back.
function pickerMatches(ps, opts) {
  const searching = ps.search.trim() !== '';
  return Catalog.matches(opts.data.catalog, {
    category: ps.cat,
    query: ps.search,
    // A search crosses the drawers, and rentals are one of the drawers. He
    // types "scissor lift" because a scissor lift is the thing he needs; a
    // search that hides it offered him "+ New part" instead, and the lift went
    // on the bid as a gear line at material markup. Only a search reaches
    // them — the browsing lists still keep rentals out, because they are not
    // material — and a caller with no rentals list of its own never does.
    includeRentals: searching && !!opts.allowRentals,
  });
}

function pickerList(ps, opts, box) {
  box.textContent = '';
  const searching = ps.search.trim() !== '';

  const h = document.createElement('h3');
  h.className = 'card-title';
  h.textContent = searching ? 'All parts' : catalogCategoryLabel(ps.cat);
  box.appendChild(h);

  const list = pickerMatches(ps, opts);
  if (list.length === 0) {
    box.appendChild(emptyNote(searching ? 'Nothing matches that.' : 'Nothing in here yet.'));
  } else {
    list.forEach((p) => {
      // Search crosses categories on purpose — typing "3/4" should find the
      // hubs as well as the EMT — so each row has to say which drawer it came
      // out of, or two identical-looking names are indistinguishable.
      const sub = searching ? catalogCategoryLabel(p.category) : '';
      const value = p.lastCostCents === null
        ? p.unit
        : BidMath.fmt(p.lastCostCents) + ' / ' + p.unit;
      box.appendChild(lineRow(p.name, sub, value, () => pickerPickPart(ps, opts, p), { keypad: true }));
    });
  }

  box.appendChild(lineRow('+ New part', 'Something not on the list', null, () => {
    promptText('', {
      label: 'New part',
      placeholder: 'What it is',
      done: (name) => {
        if (!name) { showBanner('A new part needs a name'); return; }
        // A part invented while searching across everything has no category to
        // belong to; gear is the drawer for anything that isn't the other five.
        ps.newPart = { category: searching ? 'gear' : ps.cat, name };
        opts.onChanged();
      },
    });
  }));
}

function pickerUnitPicker(ps, opts) {
  const box = card('How is ' + ps.newPart.name + ' counted?');
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  CATALOG_UNITS.forEach((unit) => {
    nav.appendChild(textButton(unit, 'btn btn-block', () => pickerCreatePart(ps, opts, unit)));
  });
  box.appendChild(nav);
  return box;
}

function pickerCreatePart(ps, opts, unit) {
  const { category, name } = ps.newPart;
  const part = Store.addCatalogItem(opts.data, { category, name, unit });
  if (!part) { showBanner('A new part needs a name'); ps.newPart = null; opts.onChanged(); return; }
  // The catalog entry is saved on its own: if the quantity keypad is cancelled
  // a moment from now, a part that is on screen must already be on disk rather
  // than living in memory until some later save happens to carry it along.
  if (!opts.persistOr(() => {
    const i = opts.data.catalog.indexOf(part);
    if (i !== -1) opts.data.catalog.splice(i, 1);
  })) { opts.onChanged(); return; }
  ps.newPart = null;
  pickerPickPart(ps, opts, part);
}

// Quantity, then price. A part he has bought before offers the price he paid
// last time as one button, because typing the same $3.40 for the fortieth
// length of EMT is the kind of friction that gets an app put down.
function pickerPickPart(ps, opts, part) {
  // The catalog carries a rentals category, and a lift is not a material line:
  // priced as one it would take material markup and be counted in the material
  // total. It goes where rentals go, whatever list he found it in.
  if (part.category === 'rentals') {
    opts.onRental(part.name);
    return;
  }
  promptNumber(null, {
    label: partQtyLabel(part.name, part.unit || 'ea'),
    allowDecimal: true,
    done: (v) => {
      if (v === null) return;
      if (!(v > 0)) { showBanner('A count has to be more than zero'); opts.onChanged(); return; }
      if (typeof part.lastCostCents === 'number') {
        ps.pending = { part, qty: v };
        opts.onChanged();
        return;
      }
      pickerAskCost(ps, opts, part, v);
    },
  });
}

function pickerPriceAnswer(ps, opts) {
  const { part, qty } = ps.pending;
  const box = card();
  box.appendChild(lineRow(part.name, itemCountText(qty, part.unit, part.lastCostCents), null, null));

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton(
    'Same price (' + BidMath.fmt(part.lastCostCents) + ')',
    'btn btn-primary btn-block',
    () => pickerCommitItem(ps, opts, part, qty, part.lastCostCents)
  ));
  // The pending state is NOT cleared here: pickerCommitItem owns clearing it.
  // If he cancels the cost keypad, this view is still what is on the glass and
  // Back still walks one step, rather than the screen and the state disagreeing.
  nav.appendChild(textButton('Different price', 'btn btn-block', () => {
    pickerAskCost(ps, opts, part, qty);
  }));
  box.appendChild(nav);
  return box;
}

// "Check price" under a cost keypad. Offline it is not offered at all rather
// than offered and then refused: a link that opens the browser's own no-signal
// page is a tab he has to find his way back out of, and in a plant with no
// signal that is every tap. Nothing here blocks anything either way.
function pickerPriceCaption() {
  return navigator.onLine === false ? '' : 'Not sure? Check the price first.';
}

// settings rather than opts, because the walk's own Cost strip puts the same
// caption under the same keypad and has no picker in front of it.
function pickerPriceAction(settings, name) {
  if (navigator.onLine === false) return null;
  return { label: 'Check price', onTap: () => openPriceSearch(settings, name) };
}

function pickerAskCost(ps, opts, part, qty) {
  promptMoney(part.lastCostCents, {
    label: partCostLabel(part.name, part.unit || 'ea'),
    // The one panel in the app with somewhere to send him. It opens the search
    // in another tab and leaves the keypad standing, so what he was half way
    // through typing is still here when he comes back with the number.
    caption: pickerPriceCaption(),
    captionAction: pickerPriceAction(opts.data.settings, part.name),
    done: (cents) => {
      // Clear on the cost keypad means "I don't know yet". The count he just
      // walked off is worth more than the price he hasn't looked up, so the
      // line goes on at zero and shows on the list until it has been priced.
      const zero = cents === null;
      if (pickerCommitItem(ps, opts, part, qty, zero ? 0 : cents) && zero) {
        showBanner('Added at $0. Put a price on it when you know it');
      }
    },
  });
}

function pickerCommitItem(ps, opts, part, qty, costCents) {
  // The second price comes along when the catalog has one for this part: he
  // put it there on a line once, and the next line starts where that one
  // ended. A part with none has none, and the line bills off its cost.
  const listCents = part.lastListCents != null ? part.lastListCents : null;
  const supplierName = typeof part.supplierName === 'string' && part.supplierName.trim() !== '' ? part.supplierName : null;
  const item = { catalogId: part.id, name: part.name, unit: part.unit, qty, costCents, priceCents: null, listCents, supplierName };
  const prevUses = part.uses;
  const prevCost = part.lastCostCents;
  opts.items.push(item);
  // One mutation, one save: the line and the catalog's memory of the price go
  // to disk together or not at all.
  Store.recordCatalogUse(opts.data, part.id, costCents);
  if (!opts.persistOr(() => {
    const i = opts.items.indexOf(item);
    if (i !== -1) opts.items.splice(i, 1);
    part.uses = prevUses;
    part.lastCostCents = prevCost;
  })) {
    // Stay in the add view: nothing was saved, so nothing is behind him.
    ps.pending = null;
    opts.onChanged();
    return false;
  }

  // He stays in the list he was looking at. Eight items used to be eight round
  // trips out to the area and back in through the tiles; the running strip at
  // the top is what says the last one landed, and Done is the way out.
  ps.pending = null;
  ps.highlight = item;
  opts.onChanged();
  setTimeout(() => {
    // Its own flash and no other: a later line has a timer of its own, and a
    // stale one firing must not put the newer one out.
    if (ps.highlight !== item) return;
    ps.highlight = null;
    opts.onChanged();
  }, PICKER_HIGHLIGHT_MS);
  return true;
}

// ONE step back inside the picker: the price answer or the unit picker, then
// the category list and the search together, and then nothing, at which point
// the step belongs to the caller. That is what false says.
function pickerBackStep(ps) {
  // Both are the same one step out, and only one of them is ever set: the
  // unit picker is gone before a part is picked, and the same-price question
  // only comes up after it. Two clauses rather than one so the order the
  // contract names is the order the code reads in.
  if (ps.pending) { ps.pending = null; return true; }
  if (ps.newPart) { ps.newPart = null; return true; }
  // A search and a category are the same step out of the tiles, and both go
  // back to them rather than all the way out of the add flow.
  if (ps.cat || ps.search.trim() !== '') {
    ps.cat = null;
    ps.search = '';
    return true;
  }
  return false;
}
