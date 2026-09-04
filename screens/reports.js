'use strict';

// screens/reports.js — Task 14: win rate, job history, and estimate-vs-actual.
// Until then this renderer is deliberately empty: the screen's placeholder
// markup lives in index.html and simply stays on screen.

function renderReports() {
  // Task 14 fills #reportsContent.
}

registerScreen('reports', { id: 'screen-reports', title: 'Reports', back: 'settings', tab: 'settings', render: renderReports });
