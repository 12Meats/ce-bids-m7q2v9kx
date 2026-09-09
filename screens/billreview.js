'use strict';
// screens/billreview.js — a placeholder, so the tab and its navigation work end to
// end while the screen behind it is still being written. It registers the same
// way the real one will and draws one sentence; the next task in the plan
// replaces this file wholesale.

function renderBillreview() {
  const host = el('billreviewContent');
  host.textContent = '';
  host.appendChild(screenHead('Bill these', null));
  host.appendChild(emptyNote('Coming in the next task.'));
}

registerScreen('billreview', {
  id: 'screen-billreview', title: 'Bill these', back: 'invoices', tab: 'invoices', render: renderBillreview,
});
