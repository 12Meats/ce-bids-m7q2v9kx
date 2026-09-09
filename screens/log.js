'use strict';
// screens/log.js — a placeholder, so the tab and its navigation work end to
// end while the screen behind it is still being written. It registers the same
// way the real one will and draws one sentence; the next task in the plan
// replaces this file wholesale.

function renderLog() {
  const host = el('logContent');
  host.textContent = '';
  host.appendChild(screenHead('Log hours', null));
  host.appendChild(emptyNote('Coming in the next task.'));
}

registerScreen('log', {
  id: 'screen-log', title: 'Log hours', back: 'invoices', tab: 'invoices', render: renderLog,
});
