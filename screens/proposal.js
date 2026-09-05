'use strict';

// screens/proposal.js — the document, and the way out of the app.
//
// Everything before this screen was him working out a number. This is the
// screen where the number becomes a piece of paper somebody else reads, so the
// rule the file is built around is: WHAT IS ON THE GLASS IS WHAT PRINTS. The
// preview is not a summary of the PDF and it is not a second opinion about it
// — it is DocModel.build's document, drawn in HTML instead of in jsPDF, off
// the same call the share button hands to DocGen. If the two ever disagree the
// bug is one of them being built twice, so they aren't.
//
// The other rule is that the detail level changes what the customer is SHOWN,
// never what he is CHARGED. DocModel.totalCents is the same at all three
// levels, and the preview prints that field — so tapping through Full,
// Summary and Scope & price moves rows around and leaves the total sitting
// exactly where it was. That is the promise the toggle makes, and it is the
// one thing about this screen worth checking by hand.
//
// The cards are CONTROLS FIRST and the document last. The preview used to sit
// second, which put four screens of paper between him and the Share button —
// the one thing this screen is for.
//
//   How much detail   — Full / Summary / Scope & price. Writes the bid AND
//                       this customer's default, because a plant that wants
//                       line items this time wants them next time.
//   Send it           — build the PDF, hand it to the share sheet, and then
//                       ask the two questions only he can answer. Plus the
//                       archive copy and the customer's address to paste.
//   Notes & exclusions— the sentences that keep him out of an argument later.
//                       Chips are his own phrases; a new one can join them.
//   Terms & conditions— the clause library, by group. Project bids start with
//                       the Always group ticked; a service call can turn them
//                       on and doesn't have to.
//   Valid for         — how long the price is good.
//   Scope of work     — drafted from the walk, edited or dictated by him.
//                       Optional on Full, which prints one only if he wrote
//                       it, so Full offers the editor rather than a draft.
//   Previous PDFs     — every document this bid has ever produced.
//   Preview           — the document, near enough, behind a button at the
//                       bottom. Folded up unless he opens it, and it stays
//                       open for the rest of the session once he has.
//
// SENT AND SAVED ARE FLAGS, NOT FACTS. Nothing in a PWA can tell whether a
// share sheet ended in a sent email or a closed window, so the app doesn't
// pretend to know: it asks, once, right after the sheet closes, and takes his
// word. Guessing would put "Sent" on a bid still sitting in a draft folder.
//
// Sections, in order:
//   VIEW STATE  — the enter/leave hooks and the transient flags
//   PREVIEW     — the document on screen
//   NOTES       — the chips and a new phrase
//   CLAUSES     — the library, by group
//   VALIDITY    — how long the price holds
//   SCOPE       — drafted from the walk, then his
//   SHARE       — the PDF, the share sheet, and the two questions
//   PREVIOUS    — re-sharing what was already made
//   RENDER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

const PROPOSAL_MIN_VALIDITY = 1;
const PROPOSAL_MAX_VALIDITY = 365;   // a year on one line: a limit on the typo
const PROPOSAL_PDF_KEEP = 10;        // previous PDFs listed for one bid

let proposalClausesOpen = false;  // the clause library, expanded
let proposalRevealClauses = false; // one render long, after the tap that opened them
let proposalTermsOn = false;      // a service bid that wants terms anyway
let proposalBusy = false;         // a PDF is being built / the sheet is open
let proposalPdfs = null;          // [{ id, at }] newest first; null = still loading
let proposalToken = 0;            // async list fills from an older render are dropped

// The last PDF built in this session, kept so "Save to Files" can hand the
// share sheet the very same bytes the customer got rather than building a
// second document that might not be identical (a price edited in between).
let proposalLast = null;          // { bidId, id, blob, name }

// Is the preview unfolded? Deliberately NOT reset by enterProposal, and
// deliberately not stored on the bid either: it is a preference for this
// session at the workbench, not a fact about the job. He checks the document
// once, then spends the rest of the afternoon on the controls.
let proposalPreviewOpen = false;

function proposalBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

// bid.clauseIds is null until he has been asked — see proposalSeedClauses.
// Everything that only READS the list treats that as no clauses, so nothing on
// this screen has to know which of the two empties it is looking at.
function proposalClauseIds(bid) { return bid.clauseIds || []; }

function proposalCustomer(bid) {
  return state.data.customers.find((c) => c.id === bid.customerId) || null;
}

// The screen's enter hook. show('proposal', id) opens that bid; show('proposal')
// keeps the one we had. Every flag above answers a question he has stopped
// asking the moment he leaves, so they all reset.
function enterProposal(bidId) {
  if (typeof bidId === 'string' && bidId) state.bidId = bidId;
  proposalClausesOpen = false;
  proposalBusy = false;
  proposalPdfs = null;

  const bid = proposalBid();
  // Terms are on for a service bid the moment it has any clause on it — he
  // turned them on last time and the document still says so.
  proposalTermsOn = !!(bid && proposalClauseIds(bid).length);
  if (proposalLast && (!bid || proposalLast.bidId !== bid.id)) proposalLast = null;

  // Spent NOW, not out of the share tap. loadLogo() caches, and the first
  // share of a session would otherwise burn its transient user activation on
  // a network fetch and hand Chrome a navigator.share it will never resolve.
  DocGen.loadLogo();

  proposalSeedClauses(bid);
  proposalLoadPdfs();
}

// leave(): the async PDF list is the only thing this screen has in flight, and
// a fill that lands after he has walked away would re-render whatever screen
// he walked to.
function proposalLeave() { proposalToken += 1; }

// A project bid arrives with the Always clauses ticked. They are the terms he
// puts on every project he has ever bid, and starting from an empty list means
// the one bid he forgets is the one that goes to court. A service call gets
// nothing: a two-hour troubleshoot does not need nineteen numbered clauses.
//
// Once, and only once. null on the bid is the question "has he been asked?",
// and this is the only thing that answers it — so un-ticking every clause
// leaves [], which is HIS answer, and reopening the bid (or the app) never
// argues with it. The seed is written like every other mutation on this
// screen, so a refused save puts the bid back to unasked rather than to a
// choice he never made.
function proposalSeedClauses(bid) {
  if (!bid || bid.jobType !== 'project' || bid.clauseIds !== null) return;
  const ids = state.data.settings.clauses.filter((c) => c.group === 'always' && !c.hidden).map((c) => c.id);
  if (!ids.length) return;
  bid.clauseIds = ids;
  if (!persistOr(() => { bid.clauseIds = null; })) return;
  proposalTermsOn = true;
}

// ---------------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------------
// A simplified drawing of the same document object docgen.js draws on paper.
// It is deliberately not pixel-faithful — a 390px phone is not US Letter — but
// every NUMBER in it comes off the model, formatted by moneyText, which is
// BidMath.fmt, which is what the PDF prints.

// One row of the document: what it is on the left, what it costs on the right.
// The quantity and the unit price ride with the description rather than in
// their own columns — four columns at 390px is four columns of nothing.
//
// They ride UNDER it, in the muted second line, and that is the whole fix for
// what an iPhone SE did with them. Run together on one line, "3/4\" EMT ·
// 240 ft · $1.12" wrapped, and the unit price landed alone on the second line
// directly beneath the row's total — two dollar amounts stacked, one of them
// small, reading as the same number printed twice. On its own line it is
// plainly the detail: what one of them costs, under what they are. The PAPER
// is unaffected; it has four real columns at fixed widths (docgen.js).
function proposalPreviewLine(desc, qtyText, unitCents, cents) {
  const line = document.createElement('div');
  line.className = 'prop-line';

  const d = document.createElement('span');
  d.className = 'prop-line-desc';
  const name = document.createElement('span');
  name.className = 'prop-line-name';
  name.textContent = desc;
  d.appendChild(name);

  // "240 ft at $1.12", the way he says it out loud — and it still reads right
  // with only one of the two ("48 hrs", "$1.12").
  const unit = (unitCents === null || unitCents === undefined) ? '' : moneyText(unitCents);
  const detail = (qtyText && unit) ? (qtyText + ' at ' + unit) : (qtyText || unit);
  if (detail) {
    const sub = document.createElement('span');
    sub.className = 'prop-line-sub';
    sub.textContent = detail;
    d.appendChild(sub);
  }

  const m = document.createElement('span');
  m.className = 'prop-line-money';
  m.textContent = cents === null ? '' : moneyText(cents);
  line.appendChild(d);
  line.appendChild(m);
  return line;
}

function proposalPreviewBullets(lines) {
  const ul = document.createElement('ul');
  ul.className = 'prop-bullets';
  lines.forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
  return ul;
}

function proposalPreviewHead(doc) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-doc-head';

  const co = document.createElement('div');
  co.className = 'prop-co';
  co.textContent = doc.header.name;
  wrap.appendChild(co);

  const contact = [doc.header.person, doc.header.phone, doc.header.email, doc.header.address, doc.header.roc]
    .filter((s) => s && String(s).trim() !== '');
  const sub = document.createElement('div');
  sub.className = 'prop-co-sub';
  sub.textContent = contact.join(' · ');
  wrap.appendChild(sub);

  // The tagline keeps its own line, the way the letterhead prints it.
  if (doc.header.tagline && String(doc.header.tagline).trim() !== '') {
    const tag = document.createElement('div');
    tag.className = 'prop-co-sub';
    tag.textContent = doc.header.tagline;
    wrap.appendChild(tag);
  }

  const meta = document.createElement('div');
  meta.className = 'prop-meta';
  const put = (label, value) => {
    if (!value) return;
    const r = document.createElement('div');
    r.className = 'prop-meta-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    r.appendChild(l);
    r.appendChild(v);
    meta.appendChild(r);
  };
  put('Bid', '#' + doc.meta.number);
  put('Date', fmtDate(doc.meta.dateISO));
  put('Valid through', fmtDate(doc.meta.validThrough));
  put('For', doc.meta.customer);
  put('Attn', doc.meta.contact);
  wrap.appendChild(meta);

  if (doc.meta.title) {
    const t = document.createElement('div');
    t.className = 'prop-doc-title';
    t.textContent = doc.meta.title;
    wrap.appendChild(t);
  }
  return wrap;
}

// The document, near enough. Built from one DocModel.build call so the rows,
// the terms, the clauses and the total on screen are all the same document —
// two calls in one render could straddle an edit and print half of each.
function buildPreview(bid, doc) {
  const box = card('Preview');
  box.appendChild(caption('What the customer sees. The price is the same at all three levels.'));

  const paper = document.createElement('div');
  paper.className = 'prop-preview';
  paper.appendChild(proposalPreviewHead(doc));

  // Scope always prints on Summary and Scope & price. On Full the line items
  // ARE the description of the work, so nothing is drafted there — but a scope
  // he wrote himself prints, and it prints where docgen puts it: above the
  // money, at every level that has one.
  if (doc.scope && doc.scope.length) {
    const h = document.createElement('div');
    h.className = 'prop-sec-title';
    h.textContent = 'Scope of work';
    paper.appendChild(h);
    paper.appendChild(proposalPreviewBullets(doc.scope));
  }

  if (doc.level === 'full') {
    (doc.sections || []).forEach((sec) => {
      const h = document.createElement('div');
      h.className = 'prop-sec-title';
      h.textContent = sec.title;
      paper.appendChild(h);
      sec.rows.forEach((r) => paper.appendChild(proposalPreviewLine(r.desc, r.qtyText, r.unitCents, r.cents)));
    });
    // The paper's tail, in the paper's order: Subtotal, tax, then the total
    // block below.
    if (doc.taxLine === 0) {
      if (doc.subtotalCents != null) {
        paper.appendChild(proposalPreviewLine('Subtotal', '', null, doc.subtotalCents));
      }
      paper.appendChild(proposalPreviewLine('Tax', '', null, 0));
    }
  } else if (doc.level === 'summary') {
    const h = document.createElement('div');
    h.className = 'prop-sec-title';
    h.textContent = 'Summary';
    paper.appendChild(h);
    doc.summary.forEach((r) => paper.appendChild(proposalPreviewLine(r.label, '', null, r.cents)));
  }

  const total = document.createElement('div');
  total.className = 'prop-total';
  const tl = document.createElement('span');
  tl.textContent = 'Total';
  const tv = document.createElement('span');
  tv.id = 'proposalPreviewTotal';
  tv.textContent = moneyText(doc.totalCents);
  total.appendChild(tl);
  total.appendChild(tv);
  paper.appendChild(total);

  // The heading over these is docgen's, not a second opinion about what to
  // call them: Scope & price says Terms, the other two say Notes & exclusions
  // because they have a Terms and conditions addendum behind them.
  if (doc.terms.length) {
    const h = document.createElement('div');
    h.className = 'prop-sec-title';
    h.textContent = DocGen.termsHeading(doc);
    paper.appendChild(h);
    paper.appendChild(proposalPreviewBullets(doc.terms));
  }

  if (doc.clauses.length) {
    const h = document.createElement('div');
    h.className = 'prop-sec-title';
    h.textContent = 'Terms and conditions';
    paper.appendChild(h);
    // Titles only. The full text is pages of it, and this is a preview he
    // thumbs through on a phone, not the document itself.
    paper.appendChild(proposalPreviewBullets(doc.clauses.map((c, i) => (i + 1) + '. ' + c.title)));
  }

  // The sentence that introduces the signature block on paper, off the same
  // function docgen wraps — a preview that leaves it out is a preview of a
  // document nobody is holding. Empty on Scope & price, which has neither.
  const courtesy = DocGen.courtesyText(doc);
  if (courtesy) {
    const c = document.createElement('div');
    c.className = 'prop-courtesy';
    c.textContent = courtesy;
    paper.appendChild(c);
  }

  const sign = document.createElement('div');
  sign.className = 'prop-sign';
  sign.textContent = doc.signatures.left + '   /   ' + doc.signatures.right;
  paper.appendChild(sign);

  box.appendChild(paper);
  return box;
}

// ---------------------------------------------------------------------------
// DETAIL LEVEL
// ---------------------------------------------------------------------------

function buildDetail(bid) {
  const box = card('How much detail?');
  box.appendChild(toggleRow(DETAIL_OPTIONS, bid.detail, (value) => {
    if (value === bid.detail) return;
    const cust = proposalCustomer(bid);
    const prevBid = bid.detail;
    const prevCust = cust ? cust.defaultDetail : null;
    bid.detail = value;
    // The customer's default moves with it. A plant that wanted every line
    // item this time wants them next time, and making him set it twice is how
    // the second bid goes out in the wrong shape.
    if (cust) cust.defaultDetail = value;
    persistOr(() => {
      bid.detail = prevBid;
      if (cust) cust.defaultDetail = prevCust;
    });
    render();
  }));
  // What the button he is looking at actually puts on the paper, in ui.js's
  // words — the same line the bid header shows, so the two places these three
  // pills appear cannot describe them differently. It is redrawn on every tap,
  // which is how he finds out here, with the document in front of him, that
  // "Scope & price" is the one that takes the line items away. The old static
  // sentence listed all three at once and said nothing about the one he had
  // picked; this one only ever describes that one.
  box.appendChild(caption(detailCaption(bid.detail)));
  const cust = proposalCustomer(bid);
  if (cust) {
    box.appendChild(caption('Also becomes the starting detail level for ' + cust.name + "'s next bid."));
  }
  return box;
}

// ---------------------------------------------------------------------------
// NOTES
// ---------------------------------------------------------------------------
// bid.notes is a plain list of sentences that print under Terms. The chips are
// settings.notePhrases — his own wording, reused — plus anything on this bid
// that isn't in that list, so a one-off note can still be tapped back off.

function proposalNoteChips(bid) {
  const phrases = state.data.settings.notePhrases.slice();
  bid.notes.forEach((n) => { if (phrases.indexOf(n) === -1) phrases.push(n); });
  return phrases;
}

function proposalToggleNote(bid, phrase) {
  const prev = bid.notes.slice();
  const i = bid.notes.indexOf(phrase);
  if (i === -1) bid.notes.push(phrase);
  else bid.notes.splice(i, 1);
  if (!persistOr(() => { bid.notes = prev; })) { render(); return; }
  render();
}

// A new note goes on THIS bid first and is offered to the library second, so a
// refused save of the phrase list can never cost him the note he just wrote.
function proposalAddNote(bid) {
  promptText('', {
    label: 'Note or exclusion',
    placeholder: 'Does not include...',
    done: async (text) => {
      if (!text) return;
      if (bid.notes.indexOf(text) === -1) {
        const prev = bid.notes.slice();
        bid.notes.push(text);
        if (!persistOr(() => { bid.notes = prev; })) { render(); return; }
      }
      render();

      const s = state.data.settings;
      if (s.notePhrases.indexOf(text) !== -1) return;
      const keep = await confirmPanel(
        'Keep "' + text + '" as a chip on every future bid?',
        { ok: 'Keep it', cancel: 'Just this bid' }
      );
      if (!keep) { render(); return; }
      const prevPhrases = s.notePhrases.slice();
      s.notePhrases.push(text);
      persistOr(() => { s.notePhrases = prevPhrases; });
      render();
    },
  });
}

function buildNotes(bid) {
  const box = card('Notes & exclusions');
  // Not "under Terms": that block is called Notes & exclusions on Full and
  // Summary and Terms only on Scope & price, and the caption should not name
  // a heading the customer's copy might not have.
  box.appendChild(caption('Tap one to put it on this bid. These print above the signature line.'));
  const chips = document.createElement('div');
  chips.className = 'prop-chips';
  proposalNoteChips(bid).forEach((phrase) => {
    chips.appendChild(chip(phrase, bid.notes.indexOf(phrase) !== -1, () => proposalToggleNote(bid, phrase)));
  });
  box.appendChild(chips);
  box.appendChild(textButton('+ Note', 'btn btn-block', () => proposalAddNote(bid)));
  return box;
}

// ---------------------------------------------------------------------------
// CLAUSES
// ---------------------------------------------------------------------------

// A hidden clause is soft-deleted in Settings, and DocModel.build drops it
// from the document even when the bid still names its id. So it is not on the
// paper, and it is not on this screen either: a ticked line he can read and a
// count he can add up have to be the clauses the customer will get, or the one
// place he checks his terms is the one place that lies about them.
//
// The id stays on the bid. Un-hiding the clause in Settings brings it back,
// still ticked, rather than quietly dropping a term he chose.
function proposalClauseList(bid) {
  return state.data.settings.clauses.filter((c) => !c.hidden);
}

// The clauses this bid PRINTS, in the order the document numbers them — the
// same map-then-drop-hidden docmodel.js does, so "On this bid: 4 clauses" and
// the four numbered titles in the preview are one answer counted once.
function proposalPrintingClauses(bid) {
  return proposalClauseIds(bid)
    .map((id) => state.data.settings.clauses.find((c) => c.id === id))
    .filter((c) => c && !c.hidden);
}

// Every write goes through here, so the null-to-array step happens once: the
// list on screen is always a copy, the bid gets the new one, and a refused
// save restores what was there before — null included.
function proposalWriteClauses(bid, next) {
  const prev = bid.clauseIds;
  bid.clauseIds = next;
  if (!persistOr(() => { bid.clauseIds = prev; })) { render(); return; }
  render();
}

function proposalToggleClause(bid, id) {
  const next = proposalClauseIds(bid).slice();
  const i = next.indexOf(id);
  if (i === -1) next.push(id);
  else next.splice(i, 1);
  proposalWriteClauses(bid, next);
}

function proposalClauseRow(bid, clause) {
  const on = proposalClauseIds(bid).indexOf(clause.id) !== -1;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'prop-clause' + (on ? ' prop-clause-on' : '');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const tick = document.createElement('span');
  tick.className = 'prop-tick';
  tick.textContent = on ? '✓' : '';
  const label = document.createElement('span');
  label.className = 'prop-clause-title';
  label.textContent = clause.title;
  btn.appendChild(tick);
  btn.appendChild(label);
  btn.addEventListener('click', () => proposalToggleClause(bid, clause.id));
  return btn;
}

// Every clause in one group, plus the all-or-nothing button. Nineteen taps to
// put the Always block on a bid is nineteen chances to miss one.
function proposalClauseGroup(bid, title, list) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-group';

  const head = document.createElement('div');
  head.className = 'prop-group-head';
  // Title, count, control — three spans on one line, so a long group name
  // wraps on its own without taking the count and the button with it. The
  // list is the printable clauses, so the count is what the paper will carry.
  const h = document.createElement('span');
  h.className = 'prop-group-title';
  h.textContent = title;
  head.appendChild(h);
  const on = list.filter((c) => proposalClauseIds(bid).indexOf(c.id) !== -1).length;
  const n = document.createElement('span');
  n.className = 'prop-group-count';
  n.textContent = on + ' of ' + list.length;
  head.appendChild(n);
  const allOn = on === list.length;
  head.appendChild(textButton(allOn ? 'None' : 'All', 'link-btn', () => {
    const current = proposalClauseIds(bid);
    const ids = list.map((c) => c.id);
    proposalWriteClauses(bid, allOn
      ? current.filter((id) => ids.indexOf(id) === -1)
      : current.concat(ids.filter((id) => current.indexOf(id) === -1)));
  }));
  wrap.appendChild(head);

  list.forEach((c) => wrap.appendChild(proposalClauseRow(bid, c)));
  return wrap;
}

function buildClauses(bid) {
  const box = card('Terms & conditions');
  const list = proposalClauseList(bid);
  const count = proposalPrintingClauses(bid).length;

  box.appendChild(row('On this bid', count + ' clause' + (count === 1 ? '' : 's')));

  if (!proposalClausesOpen) {
    box.appendChild(textButton('Choose clauses', 'btn btn-block',
      () => { proposalClausesOpen = true; proposalRevealClauses = true; render(); }));
    return box;
  }

  const named = new Set(CLAUSE_GROUPS.map(([k]) => k));
  CLAUSE_GROUPS.forEach(([key, title]) => {
    const group = list.filter((c) => c.group === key);
    if (group.length) box.appendChild(proposalClauseGroup(bid, title, group));
  });
  const other = list.filter((c) => !named.has(c.group));
  if (other.length) box.appendChild(proposalClauseGroup(bid, 'Other', other));

  box.appendChild(textButton('Done', 'btn btn-block', () => { proposalClausesOpen = false; render(); }));
  // The groups open below the button he tapped, which on a small phone is
  // below the fold: the first group comes up to meet him. Once, on the render
  // that follows the tap — not again on every clause he ticks.
  if (proposalRevealClauses) { proposalRevealClauses = false; revealAfterRender(box); }
  return box;
}

// A service call doesn't get the clause library thrown at it, but a service
// call that turns into a two-week retrofit can ask for it.
//
// Opening the library is itself an answer: the bid goes from null (never
// asked) to [] (asked, none ticked yet), so nothing seeds it behind him later
// if the job type ever changes to project.
function buildTermsToggle(bid) {
  const box = card('Terms & conditions');
  box.appendChild(caption('Service bids go out without the clause library. Add it if this one needs it.'));
  box.appendChild(textButton('Add terms & conditions', 'btn btn-block', () => {
    proposalTermsOn = true;
    proposalClausesOpen = true;
    if (bid.clauseIds === null) { proposalWriteClauses(bid, []); return; }
    render();
  }));
  return box;
}

// ---------------------------------------------------------------------------
// VALIDITY
// ---------------------------------------------------------------------------

function buildValidity(bid) {
  const box = card('Valid for');
  box.appendChild(row('Price held', bid.validityDays + ' day' + (bid.validityDays === 1 ? '' : 's'), () => {
    promptNumber(bid.validityDays, {
      label: 'Days the price holds',
      maxChars: 3,
      done: (v) => {
        // Clear means "leave it alone": there is no such thing as a bid with
        // no validity, and a document that doesn't say when the price expires
        // is a document he is still bound by next year.
        if (v === null) { render(); return; }
        const days = Math.round(v);
        if (days < PROPOSAL_MIN_VALIDITY || days > PROPOSAL_MAX_VALIDITY) {
          showBanner('Days must be between ' + PROPOSAL_MIN_VALIDITY + ' and ' + PROPOSAL_MAX_VALIDITY, 'danger');
          render();
          return;
        }
        const prev = bid.validityDays;
        bid.validityDays = days;
        if (!persistOr(() => { bid.validityDays = prev; })) { render(); return; }
        render();
      },
    });
  }));
  box.appendChild(caption('Prints as a valid-through date on the document.'));
  return box;
}

// ---------------------------------------------------------------------------
// SCOPE
// ---------------------------------------------------------------------------
// bid.scope === null means "nobody has written one" — the document falls back
// to the draft DocModel makes out of the walk, and so does this card. The
// moment he saves an edit the draft stops being consulted: the words are his.

function proposalScopeLines(bid) {
  return bid.scope === null ? DocModel.draftScope(bid) : bid.scope;
}

function proposalEditScope(bid) {
  const lines = proposalScopeLines(bid);
  promptText(lines.join('\n'), {
    label: 'Scope of work',
    multiline: true,
    placeholder: 'One line per area',
    done: (text) => {
      // Blank lines are how a paragraph gets typed, not content: the model
      // stores the lines that say something.
      const next = text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
      const prev = bid.scope;
      bid.scope = next;
      if (!persistOr(() => { bid.scope = prev; })) { render(); return; }
      render();
    },
  });
}

async function proposalRedraft(bid) {
  // Only ask when there is something of his to lose. A scope still sitting at
  // the draft is nothing to confirm about.
  const edited = bid.scope !== null && bid.scope.join('\n') !== DocModel.draftScope(bid).join('\n');
  if (edited) {
    const ok = await confirmPanel('Replace what you wrote with a fresh draft from the walk?', { ok: 'Re-draft', danger: true });
    if (!ok) { render(); return; }
  }
  const prev = bid.scope;
  bid.scope = null;
  if (!persistOr(() => { bid.scope = prev; })) { render(); return; }
  render();
}

function buildScope(bid) {
  const box = card('Scope of work');

  // WHAT IS ON THE GLASS IS WHAT PRINTS applies here too. On Full, DocModel
  // prints a scope only when he wrote one — the line items already describe
  // the work — so a Full bid with nothing written shows the collapsed state
  // and NOT the draft: bullets under "Drafted from your walk" would be a
  // paragraph he can read on the screen and will never find on the paper.
  // The draft is still one tap away, in the editor, prefilled.
  if (bid.detail === 'full' && bid.scope === null) {
    box.appendChild(textButton('Add a scope of work (optional)', 'btn btn-block', () => proposalEditScope(bid)));
    box.appendChild(caption('Optional on Full. If you add one, it prints above the line items.'));
    return box;
  }

  const lines = proposalScopeLines(bid);
  // Nothing to show is the whole message: the empty note already says why
  // there is no draft, and a caption under it saying one was drafted is the
  // screen arguing with itself.
  if (lines.length === 0) {
    box.appendChild(emptyNote(bid.scope === null
      ? 'Nothing yet. The walk had no items to draft from.'
      : 'Nothing yet. Tap Edit to write one.'));
  } else {
    box.appendChild(proposalPreviewBullets(lines));
    box.appendChild(caption(bid.scope === null
      ? 'Drafted from your walk. Edit it, or tap the mic to dictate.'
      : 'Your words. Re-draft to go back to what the walk says.'));
  }

  const actions = document.createElement('div');
  actions.className = 'prop-actions';
  actions.appendChild(textButton('Edit', 'btn btn-half', () => proposalEditScope(bid)));
  actions.appendChild(textButton('Re-draft from walk', 'btn btn-half', () => proposalRedraft(bid)));
  box.appendChild(actions);
  return box;
}

// ---------------------------------------------------------------------------
// SHARE
// ---------------------------------------------------------------------------

// Every PDF this bid produces is kept. Storage is cheap next to "what exactly
// did I send them in March", and a proposal is the one document in this app
// that somebody else is holding a copy of.
// The id shape itself lives in ui.js (bidPdfPrefix): the home list has to
// recognize this bid's PDFs to delete them with it, and Settings has to
// recognize every bid's to send the new ones off with a backup.
function proposalPdfPrefix(bid) { return bidPdfPrefix(bid.id); }

// The list AND the bytes, together, before either Share button is drawn.
//
// This is not eagerness for its own sake. navigator.share only works inside a
// live tap, and reading a blob out of IndexedDB in the handler spends it: the
// share then never resolves and never rejects, and the button is dead until
// the app is reloaded. Measured in the browser, not guessed at — a re-share
// that fetched its own blob hung exactly this way. So every PDF this bid can
// re-share is already in memory when its button appears, and the handler has
// nothing to wait for. Ten proposals is a couple of hundred kilobytes.
function proposalLoadPdfs() {
  const bid = proposalBid();
  if (!bid) { proposalPdfs = []; return; }
  const token = ++proposalToken;
  const prefix = proposalPdfPrefix(bid);
  Photos.list('pdf').then((ids) => {
    if (token !== proposalToken) return;
    const entries = ids
      .filter((id) => id.indexOf(prefix) === 0)
      .map((id) => ({ id, at: Number(id.slice(prefix.length)), blob: null }))
      .filter((x) => isFinite(x.at))
      .sort((a, b) => b.at - a.at)
      .slice(0, PROPOSAL_PDF_KEEP);
    // A blob that has gone missing (iOS evicted it) leaves its row with no
    // bytes; the row says so when tapped rather than disappearing, because the
    // fact that a document WAS made on that date is itself the record.
    return Promise.all(entries.map((e) => Photos.get(e.id).then((b) => { e.blob = b; })))
      .then(() => {
        if (token !== proposalToken) return;
        proposalPdfs = entries;
        if (state.screen === 'proposal') render();
      });
  });
}

// Where he was on the page, and putting him back there.
//
// The share questions each re-render the whole screen, and the render that
// follows the last of them used to land him at the top — four cards above the
// button he had just pressed, with nothing on screen saying the document had
// gone. The position is read BEFORE the sheet opens (the page does not move
// while it is up) and restored after the questions, on the frame after the
// render, because a page that has just been rebuilt has no scroll height yet.
function proposalScrollNow() {
  const doc = document.scrollingElement || document.documentElement;
  return doc ? doc.scrollTop : 0;
}

function proposalScrollBack(top) {
  const put = () => {
    try {
      const doc = document.scrollingElement || document.documentElement;
      if (doc) doc.scrollTop = top;
    } catch (e) { /* no layout in this environment */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(put);
  else put();
}

// The two questions the app cannot answer for itself. Asked one at a time,
// after the sheet has closed, and written in ONE save so a refused write can
// never leave a bid marked sent but not filed (or the other way round).
async function proposalAfterShare(bid, opts) {
  opts = opts || {};
  let markSent = false;
  // Only where the answer can still mean something: a bid already marked won,
  // lost or complete is not "sent" news, and re-sharing a revised proposal to a
  // customer who already has one IS — it resets the no-answer clock.
  if (opts.askSent && (bid.status === 'draft' || bid.status === 'sent')) {
    markSent = await confirmPanel('Sent to the customer?', { ok: 'Yes', cancel: 'Not yet' });
  }
  const markFiled = await confirmPanel('Saved to Files?', { ok: 'Yes', cancel: 'Not yet' });
  if (!markSent && !markFiled) { render(); return; }

  const prev = { status: bid.status, sentAt: bid.sentAt, savedToFilesAt: bid.savedToFilesAt };
  const today = Store.todayISO();
  if (markSent) { bid.status = 'sent'; bid.sentAt = today; }
  if (markFiled) bid.savedToFilesAt = today;
  if (!persistOr(() => {
    bid.status = prev.status;
    bid.sentAt = prev.sentAt;
    bid.savedToFilesAt = prev.savedToFilesAt;
  })) { render(); return; }
  if (markSent) showBanner('Marked sent', 'ok');
  render();
}

// The share button's whole job, in the order that keeps the tap alive:
//
//   1. build the document model and render the PDF
//   2. START the write to IndexedDB — but do not wait on it
//   3. hand the blob to the share sheet
//
// Step 3 must happen while the browser still considers the tap "active".
// Chrome will neither resolve nor reject a navigator.share that has lost its
// transient activation, which on screen is a button that never comes back — so
// nothing that can wait goes in front of it. The archive write is checked
// afterwards, where a failure is a banner rather than a hung button.
// Nothing leaves this phone with a $0.00 line on it. He walks a plant counting
// things and prices them later, which is exactly right until the moment a PDF
// is made — at that point every unpriced line is a number he is giving away,
// and the customer's copy is the worst place to find that out. The banner
// names the first one rather than counting them: a count sends him hunting.
function proposalBlockedByUnpriced(bid) {
  const lines = unpricedLines(bid, state.data.settings);
  if (lines.length === 0) return false;
  showBanner(unpricedBlockText(lines), 'danger');
  return true;
}

async function proposalShare(bid) {
  if (proposalBusy) return;
  if (proposalBlockedByUnpriced(bid)) return;
  // Read before anything re-renders: this is where he was standing when he
  // pressed the button, and it is where he goes back to when the questions
  // are done.
  const wasAt = proposalScrollNow();
  proposalBusy = true;
  render();

  // Two failures, two pieces of news. Nothing was made is "start again";
  // the sheet wouldn't open is "the document exists, here is where it is" —
  // and telling him the PDF failed when it is sitting in the archive is how
  // he builds the same document four times.
  let doc = null;
  let pdfBlob = null;
  try {
    doc = DocModel.build(bid, state.data, bid.detail);
    pdfBlob = await DocGen.blob(doc);
  } catch (err) {
    console.error('Could not build the proposal', err);
    showBanner("Couldn't make the PDF", 'danger');
    proposalBusy = false;
    render();
    return;
  }

  const id = proposalPdfPrefix(bid) + Date.now();
  const stored = Photos.put(id, pdfBlob, 'pdf');
  proposalLast = { bidId: bid.id, id, blob: pdfBlob, name: doc.fileName };

  let result = null;
  let shareFailed = false;
  try {
    result = await DocGen.share(pdfBlob, doc.fileName);
  } catch (err) {
    console.error('Could not share the proposal', err);
    shareFailed = true;
  }
  proposalBusy = false;

  // A PDF the archive refused is still a PDF the customer has. Say so, and
  // carry on with the questions — the flags are about what he did, not about
  // what this phone managed to keep.
  //
  // This runs on EVERY way out of here — shared, cancelled, or a share that
  // threw — because the row in Previous PDFs is the proof the document was
  // made, and a document he can't see is a document he makes again.
  stored.then((ok) => {
    if (!ok) showBanner("Couldn't keep a copy on this phone (storage full?)", 'danger');
    proposalLoadPdfs();
  });

  if (shareFailed) {
    showBanner("Couldn't open the share sheet. The PDF is saved under Previous PDFs.", 'danger');
    render();
    return;
  }
  if (result === 'cancelled') { render(); proposalScrollBack(wasAt); return; }
  await proposalAfterShare(bid, { askSent: true });
  proposalScrollBack(wasAt);
}

// The archive step, on its own. Re-shares the exact bytes the customer got
// where they exist, so what lands in Files is the document that was sent and
// not a rebuild of it.
async function proposalSaveToFiles(bid) {
  if (proposalBusy) return;
  // Checked here too, not only on Share: this hands over bytes that were built
  // before he added the line, and a copy in Files is a copy he will send.
  if (proposalBlockedByUnpriced(bid)) return;
  const wasAt = proposalScrollNow();
  const last = proposalLast && proposalLast.bidId === bid.id ? proposalLast : null;
  const newest = proposalPdfs && proposalPdfs.length ? proposalPdfs[0] : null;
  // Both candidates are already bytes in memory — nothing is read from
  // IndexedDB here, because a read would cost the tap its share sheet.
  const pdfBlob = last ? last.blob : (newest && newest.blob);
  if (!pdfBlob) {
    showBanner(last || newest ? "That copy isn't on this phone any more" : 'Make the PDF first', 'danger');
    return;
  }
  const name = last ? last.name : DocModel.fileName(bid, state.data);

  proposalBusy = true;
  render();
  let result = null;
  try {
    result = await DocGen.share(pdfBlob, name);
  } catch (err) {
    console.error('Could not re-share the proposal', err);
    showBanner("Couldn't open the share sheet", 'danger');
    proposalBusy = false;
    render();
    return;
  }
  proposalBusy = false;

  // He backed out of the sheet, so nothing left the phone and there is nothing
  // to ask about. Asking anyway is how a bid gets marked saved to Files on the
  // strength of a sheet he closed.
  if (result === 'cancelled') { render(); proposalScrollBack(wasAt); return; }
  await proposalAfterShare(bid, { askSent: false });
  proposalScrollBack(wasAt);
}

// Mail cannot be pre-addressed from a web app: there is no way to hand iOS a
// recipient without also handing it a body, and an attachment can only go
// through the share sheet. So the address is put where his thumb can copy it
// and paste it into the To: field the share sheet just opened.
function buildEmail(bid, box) {
  const cust = proposalCustomer(bid);
  if (!cust) return;
  if (!cust.email) {
    box.appendChild(row('Customer email', 'Add', () => {
      promptText('', {
        label: 'Email for ' + cust.name,
        placeholder: 'name@company.com',
        done: (value) => {
          if (!value) return;
          const email = String(value).trim();
          if (!isEmailAddress(email)) {
            showBanner("That doesn't look like an email address.", 'danger');
            render();
            return;
          }
          const prev = cust.email;
          cust.email = email;
          if (!persistOr(() => { cust.email = prev; })) { render(); return; }
          render();
        },
      });
    }));
    return;
  }

  const line = document.createElement('div');
  line.className = 'prop-email';
  const addr = document.createElement('span');
  addr.className = 'prop-email-addr';
  addr.textContent = cust.email;
  line.appendChild(addr);
  line.appendChild(textButton('Copy', 'btn', () => {
    // No clipboard (an old browser, a page without permission) is a copy that
    // silently did nothing, which is worse than being told to type it.
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showBanner("This browser won't let the app copy", 'danger');
      return;
    }
    navigator.clipboard.writeText(cust.email).then(
      () => showBanner('Copied', 'ok'),
      () => showBanner("Couldn't copy", 'danger')
    );
  }));
  box.appendChild(line);
}

function buildShare(bid) {
  const box = card('Send it');

  const shareBtn = textButton(
    proposalBusy ? 'Making the PDF…' : 'Share proposal',
    'btn btn-primary btn-block',
    () => proposalShare(bid)
  );
  if (proposalBusy) {
    shareBtn.disabled = true;
    shareBtn.setAttribute('aria-busy', 'true');
  }
  box.appendChild(shareBtn);

  const saveBtn = textButton('Save to Files', 'btn btn-block', () => proposalSaveToFiles(bid));
  if (proposalBusy) saveBtn.disabled = true;
  box.appendChild(saveBtn);

  buildEmail(bid, box);

  if (bid.sentAt) box.appendChild(caption('Sent ' + fmtDate(bid.sentAt)
    + (bid.savedToFilesAt ? ' · saved to Files ' + fmtDate(bid.savedToFilesAt) : ' · not saved to Files yet')));
  return box;
}

// ---------------------------------------------------------------------------
// PREVIOUS
// ---------------------------------------------------------------------------

// Same rule as everywhere else on this screen: the bytes are in hand before
// the tap, so DocGen.share is the first thing the handler waits on.
async function proposalReshare(bid, entry) {
  if (proposalBusy) return;
  if (!entry.blob) { showBanner("That copy isn't on this phone any more", 'danger'); return; }
  proposalBusy = true;
  render();
  try {
    await DocGen.share(entry.blob, DocModel.fileName(bid, state.data));
  } catch (err) {
    console.error('Could not re-share a previous PDF', err);
    showBanner("Couldn't open the share sheet", 'danger');
  }
  proposalBusy = false;
  render();
}

function buildPrevious(bid) {
  const box = card('Previous PDFs');
  if (proposalPdfs === null) {
    box.appendChild(emptyNote('Looking…'));
    return box;
  }
  if (proposalPdfs.length === 0) {
    box.appendChild(emptyNote('Nothing made for this bid yet.'));
    return box;
  }
  proposalPdfs.forEach((entry) => {
    const line = document.createElement('div');
    line.className = 'prop-pdf';
    const when = document.createElement('span');
    when.className = 'prop-pdf-when';
    // Local time: the clock he was standing next to when he sent it.
    when.textContent = fmtDateTime(entry.at);
    line.appendChild(when);
    // A row whose bytes are gone still stands: it is the record that a
    // document went out that day, which is the reason the list exists.
    const btn = textButton(entry.blob ? 'Share' : 'Gone', 'btn', () => proposalReshare(bid, entry));
    if (proposalBusy || !entry.blob) btn.disabled = true;
    line.appendChild(btn);
    box.appendChild(line);
  });
  box.appendChild(caption('The last ' + PROPOSAL_PDF_KEEP + ' documents made for this bid.'));
  return box;
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

function renderProposal() {
  const host = el('proposalContent');
  host.textContent = '';

  const bid = proposalBid();
  if (!bid) {
    host.appendChild(emptyNote('No bid open. Pick one from Bids.'));
    return;
  }

  const head = document.createElement('div');
  head.className = 'screen-head';
  const title = document.createElement('div');
  title.className = 'screen-head-title';
  title.textContent = bid.title || 'No title yet';
  head.appendChild(title);
  const cust = document.createElement('div');
  cust.className = 'screen-head-cust';
  cust.textContent = bidCustomerName(bid, state.data) + ' · Bid #' + bid.number;
  head.appendChild(cust);
  host.appendChild(head);

  // ONE reading of the bid, handed to the preview. Everything below edits the
  // bid and re-renders, so the document on screen is never older than the
  // controls under it.
  let doc = null;
  try {
    doc = DocModel.build(bid, state.data, bid.detail);
  } catch (err) {
    console.error('Could not build the document', err);
  }

  // CONTROLS FIRST, PREVIEW LAST. The preview used to sit second, which put
  // four screens of document between him and the Share button — the one thing
  // this screen is for. It is still the whole document, still built off the
  // same DocModel call, and it is now behind a button at the bottom for the
  // times he actually wants to read it.
  host.appendChild(buildDetail(bid));
  // The exception to "controls first": a bid that cannot be priced has no
  // document to share, and that has to be said before the Share button rather
  // than under it.
  if (!doc) host.appendChild(inlineWarn("This bid can't be priced yet — check the Costs & price screen."));
  host.appendChild(buildShare(bid));

  host.appendChild(buildNotes(bid));
  if (bid.jobType === 'project' || proposalTermsOn) host.appendChild(buildClauses(bid));
  else host.appendChild(buildTermsToggle(bid));
  host.appendChild(buildValidity(bid));
  host.appendChild(buildScope(bid));
  host.appendChild(buildPrevious(bid));

  if (doc) {
    const toggle = textButton(proposalPreviewOpen ? 'Hide preview' : 'Preview', 'btn btn-block prop-preview-toggle',
      () => { proposalPreviewOpen = !proposalPreviewOpen; render(); });
    toggle.setAttribute('aria-expanded', proposalPreviewOpen ? 'true' : 'false');
    host.appendChild(toggle);
    if (proposalPreviewOpen) host.appendChild(buildPreview(bid, doc));
  }
}

registerScreen('proposal', {
  id: 'screen-proposal', title: 'Proposal', back: 'bid', tab: 'bids',
  enter: enterProposal, leave: proposalLeave, render: renderProposal,
});
