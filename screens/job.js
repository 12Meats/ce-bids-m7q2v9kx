'use strict';

// screens/job.js — Task 12: change orders and job tracking on a won bid.
// Until then this renderer is deliberately empty: the screen's placeholder
// markup lives in index.html and simply stays on screen.

function renderJob() {
  // Task 12 fills #jobContent.
}

registerScreen('job', { id: 'screen-job', title: 'Job', back: 'bid', tab: 'bids', render: renderJob });
