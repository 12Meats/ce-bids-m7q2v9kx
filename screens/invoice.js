'use strict';
// screens/invoice.js — a placeholder, so the tab and its navigation work end to
// end while the screen behind it is still being written. It registers the same
// way the real one will and draws what the invoice is and what it comes to;
// Task 9 replaces this file wholesale with the editable, sendable screen.
//
// It is reached three ways, and all three are already wired here so the screens
// that do the reaching are finished:
//   show('invoice', id)                    an invoice on the file
//   show('invoice', { draft: i })          the i-th draft under review, in memory
//   show('invoice', { id, queue: [...] })  the first of a batch just numbered

let invoiceId = null;
let invoiceDraft = null;      // the index into the drafts under review, or null
let invoiceQueue = [];        // the ones waiting behind this one to be sent

function enterInvoice(arg) {
  // undefined is the Back button coming home: keep what is on the glass.
  if (arg === undefined) return;
  if (arg && typeof arg === 'object') {
    invoiceId = typeof arg.id === 'string' ? arg.id : null;
    invoiceDraft = typeof arg.draft === 'number' ? arg.draft : null;
    invoiceQueue = Array.isArray(arg.queue) ? arg.queue.slice() : [];
    return;
  }
  invoiceId = typeof arg === 'string' ? arg : null;
  invoiceDraft = null;
  invoiceQueue = [];
}

// The draft under review, or the invoice on the file. A draft is not on disk
// and never will be until the review numbers it, so it is read out of the
// shared store rather than out of state.data.
function invoiceTarget() {
  if (invoiceDraft !== null) return reviewDrafts.get()[invoiceDraft] || null;
  return ((state.data.invoices || []).find((x) => x.id === invoiceId)) || null;
}

function invoiceCustomerName(id) {
  const c = (state.data.customers || []).find((x) => x.id === id);
  return c ? c.name : 'Customer';
}

function renderInvoice() {
  const host = el('invoiceContent');
  host.textContent = '';
  const inv = invoiceTarget();
  if (!inv) {
    host.appendChild(screenHead('Invoice', null));
    host.appendChild(emptyNote('That invoice is not here anymore.'));
    return;
  }
  host.appendChild(screenHead(inv.number === null ? 'Draft' : 'Invoice #' + inv.number, null));
  const box = card();
  box.appendChild(row(invoiceCustomerName(inv.customerId), inv.projectTitle || '', null));
  box.appendChild(row('Total', moneyText(InvMath.totals(inv).total), null));
  box.appendChild(emptyNote('Coming in the next task.'));
  host.appendChild(box);
  if (invoiceQueue.length) {
    host.appendChild(caption(invoiceQueue.length
      + (invoiceQueue.length === 1 ? ' more invoice is waiting to be sent.' : ' more invoices are waiting to be sent.')));
  }
}

registerScreen('invoice', {
  id: 'screen-invoice', title: 'Invoice', tab: 'invoices',
  // A draft belongs to the review it was built on; anything numbered belongs to
  // the list on the home.
  back: () => (invoiceDraft === null ? 'invoices' : 'billreview'),
  enter: enterInvoice, render: renderInvoice,
});
