'use strict';

// screens/bid.js — Task 7: the bid header form: customer, title, date, job type, status.
// Until then this renderer is deliberately empty: the screen's placeholder
// markup lives in index.html and simply stays on screen.

function renderBid() {
  // Task 7 fills #bidContent.
}

registerScreen('bid', { id: 'screen-bid', title: 'Bid', back: 'bids', tab: 'bids', render: renderBid });
