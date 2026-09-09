'use strict';
// screens/invoices.js — the Invoices tab home: who owes you, what is ready to
// bill, the invoices themselves, and the way in (+ Log hours).
//
// The pile is grouped BEFORE he taps Bill these (customer + project + week),
// so the rows he checks are the invoices he will get. Everything counted here
// is InvMath's; this file draws. The two sentences the rows are written in
// (pileRowText, invoiceListText) are pure and pinned in tests/invoices.test.js,
// because the words on this screen are the whole point of it: they are what
// tells him a job has been sitting unbilled for two weeks.

let invoicesShowAll = false;
const INVOICES_FOLD = 10;

function invData() { return state.data; }
function invToday() { return Store.todayISO(); }

// Every group in the pile, checked or not: this screen draws them all and the
// tick on each row says which ones Friday will bill. pileSelection lives in
// picker.js because the Bill these review reads the same answer and a screen
// may not call another screen's file. It remembers what he turned OFF, so an
// entry logged after the last time he touched this list is on by default.
function invAllGroups() { return InvMath.group(invData().logs || [], invData(), Store.mondayOf); }
// A group is checked when ANY entry in it is. The store holds entry ids, not
// groups, because Combine and Split on the review change what a group is — and
// the review bills every entry that is on, one at a time. Read with every(),
// a group with one entry off drew an unchecked row on the home and was still
// billed by the review, which is the one disagreement these two screens may
// never have. Tapping the check sets every entry in the group, so the two
// readings only come apart on a row nobody has touched since the pile changed.
function invGroupOn(g) { return g.entries.some((e) => pileSelection.isOn(e.id)); }
function invCustomerName(id) {
  const c = (invData().customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}

// What the pile says when there is nothing in it. Two different pieces of
// news wearing one sentence: a phone with no visits on it yet is waiting to be
// used, and a phone whose every visit is already on an invoice is finished for
// the week. "Nothing logged yet" said to a man who logged five visits and
// billed them all on Friday is the app telling him his work is not there.
function pileEmptyText(data) {
  return ((data.logs || []).length > 0)
    ? 'Nothing waiting to bill.'
    : 'Nothing logged yet. Tap + Log hours after a visit.';
}

// The second line of a pile row: what it covers, how old it is, and how much
// is in it. "Aug 24 to Aug 28 · 15 days · 2 entries · 21 hrs · $216.00 parts".
// The age is the OLDEST entry's, because that is the one that has been waiting.
// A single entry does not say "1 entries", and a visit with no parts on it does
// not say "$0.00 parts".
function pileRowText(g, today) {
  // Both sums are InvMath's: a screen prints what comes back and counts
  // nothing of its own.
  const hours = InvMath.pileHours(g);
  const parts = InvMath.pileParts(g);
  const span = g.from === g.to ? dayText(g.from) : dayText(g.from) + ' to ' + dayText(g.to);
  return span
    + ' · ' + InvMath.ageDays(g.from, today) + ' days'
    + (g.entries.length > 1 ? ' · ' + g.entries.length + ' entries' : '')
    + ' · ' + numText(hours) + ' hrs'
    + (parts > 0 ? ' · ' + moneyText(parts) + ' parts' : '');
}

// One line of the invoice list, in four pieces so the row can put each one
// where it belongs. The pill is the status in his words, not the file's: a
// part-paid invoice says what is on it and what has come in, because "Sent"
// on an invoice a customer has half paid is the wrong news.
function invoiceListText(inv, today) {
  const t = InvMath.totals(inv);
  const st = InvMath.statusOf(inv);
  const paid = InvMath.paidCents(inv);
  const pays = inv.payments || [];
  // A sent invoice for nothing reads paid with no payment on it, so the date
  // of the last payment is asked for rather than assumed.
  const last = pays.length ? pays[pays.length - 1] : null;
  const pill = st === 'paid' ? 'Paid'
    : st === 'sent' ? (paid > 0 ? 'Paid ' + moneyText(paid) + ' of ' + moneyText(t.total) : 'Sent')
      : 'Draft';
  const when = st === 'sent' ? fmtDateShort(inv.sentAt) + ' · ' + InvMath.ageDays(inv.sentAt, today) + ' days'
    : st === 'paid' ? (last ? fmtDateShort(last.dateISO) : '')
      : '';
  return {
    name: inv.number === null ? 'Draft' : '#' + inv.number,
    value: moneyText(t.total),
    sub: [pill, when].filter(Boolean).join(' · '),
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
      + ' · oldest ' + w.oldestDays + ' days (' + invCustomerName(w.oldestCustomerId) + ')'));
  host.appendChild(box);
}

// One row per group: the check, "UDA · UF Project", and the sentence above.
// Age of 14 days or more takes the amber tint, never red.
function buildPile(host) {
  // ONE list, read twice: the count in the heading and the tick on each row are
  // the same question asked of the same groups. They were two different
  // groupings once — the heading counted the groups the review would build and
  // the rows drew the groups on file — and a row could say unchecked while the
  // heading counted it.
  const all = invAllGroups();
  const box = card();
  const head = document.createElement('h3');
  head.className = 'card-title';
  const checkedCount = all.filter(invGroupOn).length;
  head.textContent = 'Ready to bill' + (all.length ? '  ·  ' + checkedCount + ' checked' : '');
  box.appendChild(head);
  if (!all.length) {
    box.appendChild(emptyNote(pileEmptyText(invData())));
    host.appendChild(box);
    return;
  }
  all.forEach((g) => {
    const on = invGroupOn(g);
    const line = checkRow(invCustomerName(g.customerId) + ' · ' + g.title, pileRowText(g, invToday()), on,
      () => { invoicesToggle(g, on); render(); },
      () => show('log', g.entries[0].id));
    if (InvMath.isStale(g.from, invToday())) line.classList.add('inv-stale');
    box.appendChild(line);
  });
  const bill = textButton('Bill these', 'btn btn-block', () => {
    // Nothing checked is nothing to bill. Belt to the disabled attribute's
    // brace: the button cannot be pressed, and if it ever could it does
    // nothing rather than opening a review of no invoices.
    if (!checkedCount) return;
    show('billreview');
  });
  // The real attribute, which is what .btn:disabled and every assistive
  // technology already read, rather than a class of this screen's own.
  bill.disabled = !checkedCount;
  box.appendChild(bill);
  host.appendChild(box);
}

// Turning a row off is turning its entries off, one at a time: the store holds
// entry ids, not groups, because Combine and Split on the review change what a
// group is and the entries are the things that do not move.
function invoicesToggle(g, wasOn) {
  g.entries.forEach((e) => pileSelection.setOn(e.id, !wasOn));
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
  buildWhoOwes(host);
  buildPile(host);
  buildInvoiceList(host);
  pinnedBar(host, '+ Log hours', () => show('log', null));
}

registerScreen('invoices', {
  id: 'screen-invoices', title: 'Invoices', back: null, tab: 'invoices', render: renderInvoices,
  // Nothing to reset. What is checked survives a trip into an entry and back,
  // and it survives a tab tap: unchecking four rows and losing it because he
  // looked at a bid is how a checkbox stops being worth using.
  enter: () => {},
});
