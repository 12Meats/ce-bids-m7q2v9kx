'use strict';
// screens/invoice.js — a placeholder, so the tab and its navigation work end to
// end while the screen behind it is still being written. It registers the same
// way the real one will and draws one sentence; the next task in the plan
// replaces this file wholesale.

function renderInvoice() {
  const host = el('invoiceContent');
  host.textContent = '';
  host.appendChild(screenHead('Invoice', null));
  host.appendChild(emptyNote('Coming in the next task.'));
}

registerScreen('invoice', {
  id: 'screen-invoice', title: 'Invoice', back: 'invoices', tab: 'invoices', render: renderInvoice,
});
