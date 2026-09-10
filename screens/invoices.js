'use strict';
// screens/invoices.js — the Invoices tab home: how the week is going, who owes
// you, the invoices in progress, the invoices themselves, and the way in
// (+ Start invoice).
//
// NOTHING GROUPS ITSELF HERE any more. An entry is an invoice in progress and
// each one gets its own card; two cards for one job only ever exist because he
// tapped Start invoice twice, and the only thing that decides what Friday bills
// is the check on the card, which is the entry's own Ready flag and the same
// state the entry screen's switch shows. Everything counted here is InvMath's;
// this file draws. The sentences the rows are written in (thisWeekText,
// pileRowText, invoiceListText) are pure and pinned in tests/invoices.test.js,
// because the words on this screen are the whole point of it.

let invoicesShowAll = false;
const INVOICES_FOLD = 10;

function invData() { return state.data; }
function invToday() { return Store.todayISO(); }

// One group per unbilled entry, oldest first. The check on each card is
// InvMath.isReady of the one entry under it, so the card and the entry screen
// read the same field rather than two ideas of what is going to be billed.
function invAllGroups() { return InvMath.groupEach(invData().logs || [], invData()); }
function invGroupOn(g) { return InvMath.isReady(g.entries[0]); }
// What Bill these will take. Asked of the FILE rather than of the list on the
// glass, so the button and the review can never disagree.
function invReadyCount() {
  return (invData().logs || []).filter((e) => !e.invoiceId && InvMath.isReady(e)).length;
}
function invCustomerName(id) {
  const c = (invData().customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}

// THE WEEK, IN ONE SENTENCE. Monday to Sunday, unbilled only, and the money is
// what those invoices would come to if he sent them today. It is the only
// thing on the screen that answers "how did this week go" without opening
// anything, so it is a line of text rather than a card: a card would make it
// the subject of the screen, and the subject of the screen is who owes him.
//
// A week with nothing in it says so. Four zeros in a row is a sentence he has
// to read to find out it says nothing.
function thisWeekText(w) {
  if (!w || (w.inProgress + w.ready) === 0) return 'This week: nothing logged yet.';
  const hrs = numText(w.hours) + (w.hours === 1 ? ' hour' : ' hours');
  return 'This week: ' + hrs
    + ', ' + w.inProgress + ' in progress'
    + ', ' + w.ready + ' ready'
    + ', ' + moneyText(w.unbilledCents) + ' unbilled.';
}

// What the list says when there is nothing in it. Two different pieces of news
// wearing one sentence: a phone with no visits on it yet is waiting to be
// used, and a phone whose every visit is already on an invoice is finished for
// the week. "Nothing logged yet" said to a man who logged five visits and
// billed them all on Friday is the app telling him his work is not there.
function pileEmptyText(data) {
  return ((data.logs || []).length > 0)
    ? 'Nothing waiting to bill.'
    : 'Nothing logged yet. Tap + Start invoice after a visit.';
}

// The second line of a card: what it covers, where it stands, and the hours on
// it. "Aug 24 to Aug 28 · Ready · 13 hrs · 11 days".
//
// The age is only on the ones he has finished with, and it counts from the To.
// An entry he is still working is not late however long it has been open — the
// job is not done — and a number of days on it would be the app nagging him
// about work that is still going on.
function pileRowText(g, today) {
  const e = g.entries[0];
  const hours = InvMath.pileHours(g);
  const span = g.from === g.to ? dayText(g.from) : dayText(g.from) + ' to ' + dayText(g.to);
  const age = InvMath.pileAge(e, today);
  return span
    + ' · ' + entryStatusPill(e)
    + ' · ' + numText(hours) + ' hrs'
    + (age === null ? '' : ' · ' + daysText(age));
}

// One line of the invoice list, in four pieces so the row can put each one
// where it belongs. The pill is the status in his words, not the file's: a
// part-paid invoice says what is on it and what has come in, because "Sent"
// on an invoice a customer has half paid is the wrong news.
function invoiceListText(inv, today) {
  const t = InvMath.totals(inv);
  const st = InvMath.statusOf(inv);
  const pays = inv.payments || [];
  // A sent invoice for nothing reads paid with no payment on it, so the date
  // of the last payment is asked for rather than assumed.
  const last = pays.length ? pays[pays.length - 1] : null;
  // picker.js's, because the invoice's own summary card prints the same words
  // and the two must never disagree about what an invoice is.
  const pill = invoiceStatusPill(inv);
  // The tick is the same mark the check on a card wears, and it rides with the
  // words "Sent to office" because that is the one status on this list that is
  // a thing he DID rather than a thing the invoice is. A part-paid invoice was
  // also sent, but the news on that row is the money, and a tick beside
  // "Paid $500.00 of $2,001.00" reads as a claim about the payment.
  const mark = st === 'sent' && InvMath.paidCents(inv) === 0 ? ' ' + SENT_GLYPH : '';
  const when = st === 'sent' ? fmtDateShort(inv.sentAt) + ' · ' + daysText(InvMath.ageDays(inv.sentAt, today))
    : st === 'paid' ? (last ? fmtDateShort(last.dateISO) : '')
      : '';
  return {
    name: inv.number === null ? 'Draft' : '#' + inv.number,
    value: moneyText(t.total),
    sub: [pill + mark, when].filter(Boolean).join(' · '),
    // Sent and old. Amber, like everything else in this app that is late.
    stale: st === 'sent' && !!inv.sentAt && InvMath.isStale(inv.sentAt, today),
  };
}

// The one number the tab exists to answer, on the navy the primary button
// wears. Under it: how many are open, and how long the oldest has been out,
// with the name of whoever is sitting on it.
function buildWhoOwes(host) {
  const w = InvMath.whoOwes(invData().invoices || [], invToday());
  const box = card();
  box.classList.add('inv-owes');
  box.appendChild(caption('Who owes you'));
  const big = document.createElement('div');
  big.className = 'inv-big';
  big.textContent = moneyText(w.totalCents);
  box.appendChild(big);
  box.appendChild(caption(w.openCount === 0 ? 'Nothing open.'
    : w.openCount + (w.openCount === 1 ? ' open invoice' : ' open invoices')
      + ' · oldest ' + daysText(w.oldestDays) + ' (' + invCustomerName(w.oldestCustomerId) + ')'));
  host.appendChild(box);
}

const BILL_THESE_WAITING = 'Check the ones that are ready first.';

// One CARD per invoice in progress: the check, "UDA · UF Project", and the
// sentence above. They were rows in a single card while a card was a week of
// one job; an entry is the invoice now, and an invoice is a card.
//
// Ready and waiting fourteen days takes the amber, never red.
function buildPile(host) {
  const all = invAllGroups();
  host.appendChild(groupHeading('Invoices in progress'));
  if (!all.length) {
    const box = card();
    box.appendChild(emptyNote(pileEmptyText(invData())));
    host.appendChild(box);
    return;
  }
  all.forEach((g) => {
    const box = card();
    const on = invGroupOn(g);
    box.appendChild(checkRow(invCustomerName(g.customerId) + ' · ' + g.title,
      pileRowText(g, invToday()), on,
      () => invoicesToggle(g),
      () => show('log', g.entries[0].id)));
    const age = InvMath.pileAge(g.entries[0], invToday());
    if (age !== null && age >= InvMath.AMBER_AFTER_DAYS) box.classList.add('inv-stale');
    host.appendChild(box);
  });

  // Air, and then the button. It bills every Ready entry on the file, so it is
  // not part of any one card and does not sit inside one.
  const ready = invReadyCount();
  const bill = textButton('Bill these', 'btn btn-block mt-3', () => {
    // Nothing ready is nothing to bill. Belt to the disabled attribute's
    // brace: the button cannot be pressed, and if it ever could it does
    // nothing rather than opening a review of no invoices.
    if (!ready) return;
    show('billreview');
  });
  bill.disabled = !ready;
  host.appendChild(bill);
  // The caption says what it is waiting for. A disabled button with nothing
  // under it is a button that looks broken.
  if (!ready) host.appendChild(caption(BILL_THESE_WAITING));
}

// The check IS the Ready flag on the entry, written straight to disk with an
// exact restore. There is no second, screen-local idea of what is going to be
// billed: the switch at the truck and this check are one field.
function invoicesToggle(g) {
  const e = g.entries[0];
  const prev = e.ready;
  e.ready = !InvMath.isReady(e);
  if (!persistOr(() => { if (prev === undefined) delete e.ready; else e.ready = prev; })) { render(); return; }
  render();
}

function buildInvoiceList(host) {
  const list = (invData().invoices || []).slice().sort((a, b) => (b.createdAt - a.createdAt));
  const box = card('Invoices');
  if (!list.length) {
    box.appendChild(emptyNote('No invoices yet.'));
    host.appendChild(box);
    return;
  }
  const shown = invoicesShowAll ? list : list.slice(0, INVOICES_FOLD);
  shown.forEach((inv) => {
    const t = invoiceListText(inv, invToday());
    const line = lineRow(t.name + ' · ' + invCustomerName(inv.customerId), t.sub, t.value,
      () => show('invoice', inv.id));
    if (t.stale) line.classList.add('inv-stale');
    box.appendChild(line);
  });
  // Ten is the fold: the ones he is still waiting on are at the top, and the
  // year behind them is a tap away rather than a scroll.
  if (list.length > INVOICES_FOLD) {
    box.appendChild(textButton(invoicesShowAll ? 'Show fewer' : 'Show all ' + list.length, 'link-btn',
      () => { invoicesShowAll = !invoicesShowAll; render(); }));
  }
  host.appendChild(box);
}

function renderInvoices() {
  const host = el('invoicesContent');
  host.textContent = '';
  host.appendChild(caption(thisWeekText(InvMath.thisWeek(invData(), invToday(), Store.mondayOf))));
  buildWhoOwes(host);
  buildPile(host);
  buildInvoiceList(host);
  pinnedBar(host, '+ Start invoice', () => show('log', null));
}

registerScreen('invoices', {
  id: 'screen-invoices', title: 'Invoices', back: null, tab: 'invoices', render: renderInvoices,
  // Nothing to reset. What is checked lives on the entries themselves now, so
  // it survives a trip into one and back, a tab tap, and the phone being put
  // in a pocket.
  enter: () => {},
});
