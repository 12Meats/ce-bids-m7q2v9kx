'use strict';

// screens/proposal.js — Task 11: scope, notes, clauses, and the PDF.
// Until then this renderer is deliberately empty: the screen's placeholder
// markup lives in index.html and simply stays on screen.

function renderProposal() {
  // Task 11 fills #proposalContent.
}

registerScreen('proposal', { id: 'screen-proposal', title: 'Proposal', back: 'bid', tab: 'bids', render: renderProposal });
