'use strict';

// screens/reports.js — the reading that pays for all the typing.
//
// Every other screen in this app is about one bid. This one is about ten of
// them at once, and it answers the two questions the whole thing was built
// for:
//
//   Do I underbid, and by how much?   The estimating card: hours bid against
//                                     hours worked, surprises against the
//                                     cushion they were supposed to come out
//                                     of, what he wins, and what the margin
//                                     actually came in at.
//
//   What does an hour cost?           One page, plain black on white, that he
//                                     puts in front of a plant manager who
//                                     thinks $65 is a lot of money. It is the
//                                     October rate conversation in an exhibit.
//
// NOTHING here does money or hours arithmetic. Every figure comes out of
// BidMath.estimatingStats — pure, tested, and checkable in a console — and
// this file's only job is to put a sentence in his own words underneath each
// one. A percentage he has to interpret standing in a parking lot is a
// percentage he will not use.
//
// AND A SENTENCE IS A CLAIM. Every line under a number here says something
// that can be true or false, which is a harder standard than the number
// itself: "the cushion covered them" was printed off a set-aside that is only
// a budget, and on a job that ran over its hours that money went to the crew
// before any surprise turned up. The builders below are pure functions of
// plain data for exactly that reason — tests/reports.test.js pins the exact
// words, because a wrong number gets noticed and a wrong sentence gets
// believed.
//
// The estimating card needs three finished jobs before it says anything. Two
// jobs is not a pattern, it is two jobs, and a "you run 40% over" drawn off
// one bad week would send him into a negotiation with a wrong number.
//
// Sections, in order:
//   SENTENCES       — the plain-English lines under each stat
//   ESTIMATING      — the four stats and their bars
//   COMPLETED JOBS  — the list behind the averages
//   HOUR COST       — the exhibit
//   REGISTER

const REPORTS_HOURCOST_ID = 'hourcost-latest';   // one key, overwritten

let reportsBusy = false;      // building or sharing the hour-cost page
let reportsLastPdf = null;    // the last page's bytes, in hand before the tap
let reportsToken = 0;         // a preload that lands after he has walked away

// The bytes are fetched HERE, not in the Share handler. navigator.share only
// works inside a live tap and reading a blob out of IndexedDB in the handler
// spends that activation: the share then never resolves and never rejects and
// the button is dead until the app reloads. Same rule, same reason, as the
// proposal screen's previous-PDF list.
function reportsLoadLastPage() {
  const token = ++reportsToken;
  Photos.get(REPORTS_HOURCOST_ID).then((blob) => {
    if (token !== reportsToken) return;
    reportsLastPdf = blob || null;
    if (state.screen === 'reports') render();
  }, (err) => { console.error('Could not read the last hour-cost page', err); });
}

function enterReports() {
  reportsBusy = false;
  reportsLastPdf = null;
  reportsLoadLastPage();
}

// The preload is the only thing in flight; a fill that lands after he has
// walked away would re-render whatever screen he walked to.
function reportsLeave() { reportsToken += 1; }

function reportsSettings() { return state.data.settings; }

// ---------------------------------------------------------------------------
// SENTENCES
// ---------------------------------------------------------------------------

// '16% over' / '4% under' / 'right on the number'. Off the SIGNED figure
// BidMath already worked out — positive is over — so the screen turns a sign
// into a word and does no arithmetic of its own.
function reportsOffText(offPct) {
  if (offPct === null || offPct === undefined) return null;
  if (offPct === 0) return 'right on the number';
  return pctText(Math.abs(offPct)) + (offPct > 0 ? ' over' : ' under');
}

// 'Over 5 jobs you bid 320 hrs and worked 372. That is 16.3% over.'
// Bid hours, because that is the number the customer was handed. What he
// FIGURED before the cushion went on is the caption underneath.
function reportsHoursSays(hours) {
  const head = 'Over ' + hours.count + ' job' + (hours.count === 1 ? '' : 's')
    + ' you bid ' + numText(hours.bidHours) + ' hrs and worked ' + numText(hours.actualHours) + '.';
  if (hours.offBidPct === null) return head + ' No hours were bid, so there is nothing to compare.';
  return head + ' That is ' + reportsOffText(hours.offBidPct) + '.';
}

// The gut against the cushion — the two things a "16% over" hides. A shop can
// figure every job 20% light and still come in under the bid because the
// cushion carried it, and the fix for that shop is not the fix for one whose
// estimates are honest and whose cushion is too thin. Null only when nothing
// was figured at all.
function reportsGutSays(hours) {
  if (hours.offRealPct === null) return null;
  const gut = hours.offRealPct === 0
    ? 'so your own number was right'
    : 'so your own number was ' + pctText(Math.abs(hours.offRealPct))
      + (hours.offRealPct > 0 ? ' light' : ' generous');
  return 'Before the cushion you figured ' + numText(hours.realHours) + ' hrs and worked '
    + numText(hours.actualHours) + ', ' + gut + '; the cushion '
    + (hours.actualHours <= hours.bidHours ? 'covered it.' : 'did not cover it.');
}

// What was set aside is a BUDGET. What was left over is money, and only money
// pays for a surprise: hours nobody worked, at the rate that job was sold at.
// coveredBy is BidMath's verdict on which of those two the shop actually had.
function reportsSurprisesSays(sur) {
  if (sur.setAsideCents <= 0) {
    return sur.surpriseCents > 0
      ? 'Nothing was set aside on these jobs, and surprises came to ' + moneyText(sur.surpriseCents) + '.'
      : 'Nothing set aside, nothing unexpected.';
  }
  const head = 'Set aside ' + moneyText(sur.setAsideCents) + ', spent ' + moneyText(sur.surpriseCents);
  if (sur.coveredBy === 'cushion') return head + '. The unused hours covered them.';
  if (sur.coveredBy === 'hours') return head + ', but the hours ran over, so that money was already gone.';
  return head + '. The hours left ' + moneyText(sur.unspentCents) + ' unused, not enough to cover them.';
}

// The lost clause only appears when there is one reason to name. BidMath hands
// back a null topReason on a tie, because "he loses on price" drawn off two
// losses against two other losses sends him to fix the wrong thing.
function reportsWinSays(win) {
  if (win.heard === 0) return 'Nothing won or lost yet.';
  const line = 'Won ' + win.won + ' of ' + win.heard + ' you heard back on.';
  if (win.topReason === null) return line + (win.lost ? ' No one reason stands out on the ones you lost.' : '');
  return line + ' Lost ' + win.reasons[win.topReason] + ' on ' + lostReasonLabel(win.topReason).toLowerCase() + '.';
}

// The lost bids one line at a time: 'Price 2 · Timing 1 · No reason given 1'.
// Null when nothing has been lost.
function reportsLostBreakdown(win) {
  const parts = LOST_REASONS
    .filter(([k]) => win.reasons[k] > 0)
    .map(([k, label]) => label + ' ' + win.reasons[k]);
  if (win.reasons.none > 0) parts.push('No reason given ' + win.reasons.none);
  return parts.length ? parts.join('  ·  ') : null;
}

// DOLLAR-WEIGHTED, not the average of the percentages. A $90,000 project at 6%
// and a $400 service call at 40% average to 23%, and 23% is a number this shop
// has never seen: the money says 6.1%. The mean is worth knowing too, so it
// gets the caption underneath.
function reportsMarginSays(margin) {
  const line = 'Bid at ' + pctText(margin.weightedStartPct) + ', made ' + pctText(margin.weightedNowPct) + '.';
  if (marginOnTrack(margin.weightedStartPct, margin.weightedNowPct)) return line + ' The jobs came in the way you sold them.';
  return line + ' Surprises and extra hours took the rest.';
}

function reportsMarginMeanSays(margin) {
  return 'Job by job the average was ' + pctText(margin.meanStartPct) + ' → ' + pctText(margin.meanNowPct) + '.';
}

// The gate, with the count in it. 'Finish 3 jobs' on its own reads as a wall;
// '2 done, 1 to go' reads as a thing that is nearly finished.
function reportsGateSays(stats) {
  const left = Math.max(0, stats.needed - stats.completedCount);
  return 'Finish ' + stats.needed + ' jobs to see estimating stats. '
    + stats.completedCount + ' done, ' + left + ' to go.';
}

// '2 jobs · figured 96, bid 111, worked 115'. All three numbers, because two
// of them is where the argument always is.
function reportsTypeSays(t) {
  return t.count + ' job' + (t.count === 1 ? '' : 's') + '  ·  figured ' + numText(t.realHours)
    + ', bid ' + numText(t.bidHours) + ', worked ' + numText(t.actualHours);
}

// ---------------------------------------------------------------------------
// ESTIMATING
// ---------------------------------------------------------------------------

// One stat: its name, its headline number, its bar, its sentence. Written once
// because four of them in a row that each laid themselves out differently is
// four things to read instead of one thing four times.
//
// The heading names the stat and the row's own label names what the number IS,
// so nothing is said twice and the value stays short enough to sit on one line
// at the size it is set in.
//
// pct null means NO BAR, and that is a judgement, not an omission. A bar reads
// as "fuller is worse" on hours and on surprises, where 100% is the line you
// were not supposed to cross. On win rate and on margin fuller is BETTER, and
// the same shape meaning the opposite thing on the same card is worse than no
// shape at all.
function reportsStat(box, heading, label, value, pct, says, cls) {
  const wrap = document.createElement('div');
  wrap.className = 'rep-stat';
  wrap.appendChild(fieldLabel(heading));
  const line = row(label, value);
  line.classList.add('rep-headline');
  if (cls) line.classList.add(cls);
  wrap.appendChild(line);
  if (pct !== null) wrap.appendChild(barMeter(pct));
  const p = document.createElement('p');
  p.className = 'rep-says';
  p.textContent = says;
  wrap.appendChild(p);
  box.appendChild(wrap);
  return wrap;
}

const REPORTS_TYPE_LABELS = { service: 'Service jobs', project: 'Project jobs' };

function buildEstimatingCard(stats) {
  const box = card('Estimating');

  if (!stats.ready) {
    box.appendChild(emptyNote(reportsGateSays(stats)));
    return box;
  }

  // --- Bid vs actual hours ---
  const over = stats.hours.offBidPct !== null && stats.hours.offBidPct > 0;
  const hoursWrap = reportsStat(box, 'Bid vs actual hours', 'All jobs',
    reportsOffText(stats.hours.offBidPct) || '—', stats.hours.pct,
    reportsHoursSays(stats.hours), over ? 'rep-bad' : null);
  const gut = reportsGutSays(stats.hours);
  if (gut) hoursWrap.appendChild(caption(gut));
  // The same reading split by the two kinds of work he does. A shop can be
  // dead on its projects and 30% over on service calls, and the average of
  // those two is a number that describes neither of them.
  Object.keys(REPORTS_TYPE_LABELS).forEach((key) => {
    const t = stats.byType[key];
    if (!t || t.count === 0) return;
    const line = row(REPORTS_TYPE_LABELS[key], reportsOffText(t.offBidPct) || '—');
    if (t.offBidPct !== null && t.offBidPct > 0) line.classList.add('rep-bad');
    hoursWrap.appendChild(line);
    hoursWrap.appendChild(caption(reportsTypeSays(t)));
  });

  // --- Surprises ---
  reportsStat(box, 'Surprises', 'Used',
    stats.surprises.pct === null ? '—' : pctText(stats.surprises.pct),
    stats.surprises.pct, reportsSurprisesSays(stats.surprises));

  // --- Win rate --- no bar: a full bar here is a good thing, and on the two
  // stats above it is a bad one.
  const winWrap = reportsStat(box, 'Win rate', 'Won',
    stats.win.pct === null ? '—' : pctText(stats.win.pct), null, reportsWinSays(stats.win));
  const lost = reportsLostBreakdown(stats.win);
  if (lost) winWrap.appendChild(caption(lost));

  // --- Margin realized ---
  const onTrack = marginOnTrack(stats.margin.weightedStartPct, stats.margin.weightedNowPct);
  const marginWrap = reportsStat(box, 'Margin realized', 'Made',
    pctText(stats.margin.weightedNowPct), null, reportsMarginSays(stats.margin),
    onTrack ? 'rep-good' : 'rep-bad');
  marginWrap.appendChild(caption(reportsMarginMeanSays(stats.margin)));

  return box;
}

// ---------------------------------------------------------------------------
// COMPLETED JOBS
// ---------------------------------------------------------------------------

// The jobs the averages are made of, newest first, each one a tap away from
// its own card. An average he cannot open is an average he cannot argue with.
function buildCompletedCard(stats) {
  const box = card('Completed jobs');
  if (stats.jobs.length === 0) {
    box.appendChild(emptyNote('No finished jobs yet. Mark a job complete on its own screen.'));
    return box;
  }
  stats.jobs.forEach((j) => {
    const bid = j.bid, actuals = j.actuals;
    const label = bidCustomerName(bid, state.data) + '  ·  ' + (bid.title || 'No title');
    const line = row(label, pctText(actuals.marginStartPct) + ' → ' + pctText(actuals.marginNowPct),
      () => show('job', bid.id));
    line.classList.add(marginOnTrack(actuals.marginStartPct, actuals.marginNowPct) ? 'rep-good' : 'rep-bad');
    box.appendChild(line);
    box.appendChild(caption(numText(actuals.bidHours) + ' bid / ' + numText(actuals.actualHours) + ' worked hrs'
      + (bid.job && bid.job.completedAt ? '  ·  ' + fmtDate(bid.job.completedAt) : '')));
  });
  return box;
}

// ---------------------------------------------------------------------------
// HOUR COST
// ---------------------------------------------------------------------------

// The exhibit. It lives here and nowhere else: it is not about a bid, and
// hanging it off a bid's detail toggle is how it ends up in front of the
// customer being quoted rather than the one being renegotiated.
//
// The keypad asks FIRST and the share happens inside its done(), because
// navigator.share needs the transient activation of a tap and a prompt in the
// middle of the handler spends it — the same rule the proposal screen works
// under. Nothing is awaited before the share: the page is built synchronously
// (it has no logo to load), and the archive write is started and checked
// afterwards, where a failure is a banner rather than a hung button.
//
// ONE KEY, OVERWRITTEN. A proposal is a record — which document went to which
// customer on which day — so those are kept per bid and listed. This page is
// not a record of anything; it is the current settings printed. Keeping one
// per tap filled the phone with dated copies of the same page, and the only
// one worth re-sharing was always the newest.
function reportsMakeHourCost() {
  if (reportsBusy) return;
  const settings = reportsSettings();
  promptMoney(settings.rateCents, {
    label: 'The rate they pay you now',
    done: (cents) => {
      if (cents === null) return;
      reportsBusy = true;
      render();

      let pdfBlob = null;
      try {
        pdfBlob = DocGen.hourCostPage(settings, cents).output('blob');
      } catch (err) {
        console.error('Could not build the hour-cost page', err);
        showBanner("Couldn't make the page", 'danger');
        reportsBusy = false;
        render();
        return;
      }

      // Kept on the phone the way a proposal is, so a page he made in the
      // truck is still there when he walks into the meeting. Started, not
      // waited on: the share sheet needs this tap.
      const stored = Photos.put(REPORTS_HOURCOST_ID, pdfBlob, 'pdf');
      reportsLastPdf = pdfBlob;
      DocGen.share(pdfBlob, 'What an hour costs.pdf').then((result) => {
        reportsBusy = false;
        if (result === 'downloaded') showBanner('Page downloaded', 'ok');
        else if (result === 'shared') showBanner('Page sent', 'ok');
        render();
      }, (err) => {
        console.error('Could not share the hour-cost page', err);
        reportsBusy = false;
        showBanner("Couldn't open the share sheet", 'danger');
        render();
      });
      stored.then((ok) => {
        if (!ok) showBanner("Couldn't keep a copy on this phone (storage full?)", 'danger');
      });
    },
  });
}

// The bytes are already in hand (reportsLoadLastPage), so DocGen.share is the
// first thing this waits on and the tap's activation survives.
async function reportsReshareHourCost() {
  if (reportsBusy || !reportsLastPdf) return;
  reportsBusy = true;
  render();
  try {
    await DocGen.share(reportsLastPdf, 'What an hour costs.pdf');
  } catch (err) {
    console.error('Could not re-share the hour-cost page', err);
    showBanner("Couldn't open the share sheet", 'danger');
  }
  reportsBusy = false;
  render();
}

// The company's own name, without the LLC the page itself also drops, so the
// caption and the exhibit's headline are talking about the same shop.
function reportsShopName(settings) {
  const name = String(((settings.company || {}).name) || '').replace(/\s+LLC\.?$/i, '').trim();
  return name || 'your work';
}

// The page's own answer, on the glass, off the same function that prints it —
// so he can check the number without making the PDF, and the card can never
// quote a rate the exhibit does not. Matched on the row's key, never on its
// label: the labels are wording, and wording gets reworded.
function reportsHourCostCents(settings, key) {
  const hit = DocGen.hourCostRows(settings).find((r) => r.key === key);
  return hit ? hit.cents : NaN;
}

function buildHourCostCard() {
  const settings = reportsSettings();
  const box = card('What an hour costs');
  box.appendChild(caption('One page that shows what an hour of ' + reportsShopName(settings)
    + ' really costs. For the rate conversation.'));

  const line = row('An hour costs', moneyText(reportsHourCostCents(settings, 'subtotal')) + ' all in');
  line.classList.add('rep-headline');
  box.appendChild(line);
  box.appendChild(caption('Wage, payroll taxes, truck, consumables and overhead, before any profit.'));
  box.appendChild(row('Has to bill at', moneyText(reportsHourCostCents(settings, 'rate'))));
  box.appendChild(caption('At the ' + pctText(settings.marginPct) + ' margin in Settings. Your rate there is '
    + moneyText(settings.rateCents) + '.'));

  const btn = textButton(reportsBusy ? 'Making the page…' : 'Make the page', 'btn btn-primary btn-block',
    () => reportsMakeHourCost());
  if (reportsBusy) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  box.appendChild(btn);

  // The page he already made, one tap from the share sheet again — the
  // meeting is usually not the same trip as the making of it.
  if (reportsLastPdf) {
    const last = document.createElement('div');
    last.className = 'prop-pdf';
    const when = document.createElement('span');
    when.className = 'prop-pdf-when';
    when.textContent = 'Last page';
    last.appendChild(when);
    const share = textButton('Share', 'btn', () => reportsReshareHourCost());
    if (reportsBusy) share.disabled = true;
    last.appendChild(share);
    box.appendChild(last);
  }
  return box;
}

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------

// RENDERING NEVER WRITES. Everything on this screen is a reading of bids that
// are already finished, and looking at the record must not be able to change
// it.
function renderReports() {
  const host = el('reportsContent');
  host.textContent = '';

  const stats = BidMath.estimatingStats(state.data.bids, reportsSettings());

  host.appendChild(buildEstimatingCard(stats));
  host.appendChild(buildCompletedCard(stats));
  host.appendChild(buildHourCostCard());
}

registerScreen('reports', { id: 'screen-reports', title: 'Reports', back: 'settings', tab: 'settings', enter: enterReports, leave: reportsLeave, render: renderReports });
