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

// ---------------------------------------------------------------------------
// SENTENCES
// ---------------------------------------------------------------------------

let reportsBusy = false;     // building the hour-cost page

function enterReports() { reportsBusy = false; }

function reportsSettings() { return state.data.settings; }

// '16% over' / '4% under' / 'right on the number'. The stat's headline value,
// off a percentage where 100 means the estimate was exactly right.
function reportsOverUnder(pct) {
  if (pct === null) return null;
  const off = Math.round(Math.abs(pct - 100) * 10) / 10;
  if (off === 0) return 'right on the number';
  return pctText(off) + (pct > 100 ? ' over' : ' under');
}

// 'Over 5 jobs you bid 320 hrs and worked 372. That is 16% over: add it to
// your cushion.' Everything after the first sentence only appears when there
// is something to say about it.
function reportsHoursSays(hours) {
  const head = 'Over ' + hours.count + ' job' + (hours.count === 1 ? '' : 's')
    + ' you bid ' + numText(hours.bidHours) + ' hrs and worked ' + numText(hours.actualHours) + '.';
  if (hours.pct === null) return head + ' No hours were bid, so there is nothing to compare.';
  const off = reportsOverUnder(hours.pct);
  if (off === 'right on the number') return head + ' That is right on the number.';
  if (hours.pct > 100) return head + ' That is ' + off + ': add it to your cushion.';
  return head + ' That is ' + off + ', so the cushion is holding.';
}

function reportsSurprisesSays(sur) {
  if (sur.setAsideCents <= 0) {
    return sur.surpriseCents > 0
      ? 'Nothing was set aside on these jobs, and surprises came to ' + moneyText(sur.surpriseCents) + '.'
      : 'Nothing set aside, nothing unexpected.';
  }
  const line = 'Surprises used ' + pctText(sur.pct) + ' of what was set aside. Set aside '
    + moneyText(sur.setAsideCents) + ', spent ' + moneyText(sur.surpriseCents) + '.';
  return line + (sur.pct > 100 ? ' The cushion did not cover them.' : ' The cushion covered them.');
}

function reportsWinSays(win) {
  if (win.heard === 0) return 'Nothing won or lost yet.';
  const line = 'Won ' + win.won + ' of ' + win.heard + ' you heard back on.';
  if (win.topReason === null) return line + (win.lost ? ' No reason on the ones you lost.' : '');
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

function reportsMarginSays(margin) {
  const line = 'Bid at ' + pctText(margin.startPct) + ', made ' + pctText(margin.nowPct) + '.';
  if (marginOnTrack(margin.startPct, margin.nowPct)) return line + ' The jobs came in the way you sold them.';
  return line + ' Surprises and extra hours took the rest.';
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
function reportsStat(box, heading, label, value, pct, says) {
  const wrap = document.createElement('div');
  wrap.className = 'rep-stat';
  wrap.appendChild(fieldLabel(heading));
  const line = row(label, value);
  line.classList.add('rep-headline');
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
    box.appendChild(emptyNote('Complete ' + stats.needed + ' jobs to see estimating stats.'));
    box.appendChild(caption(stats.completedCount + ' of ' + stats.needed + ' done so far.'));
    return box;
  }

  // --- Bid vs actual hours ---
  const hoursWrap = reportsStat(box, 'Bid vs actual hours', 'All jobs',
    reportsOverUnder(stats.hours.pct) || '—', stats.hours.pct, reportsHoursSays(stats.hours));
  // The same reading split by the two kinds of work he does. A shop can be
  // dead on its projects and 30% over on service calls, and the average of
  // those two is a number that describes neither of them.
  Object.keys(REPORTS_TYPE_LABELS).forEach((key) => {
    const t = stats.byType[key];
    if (!t || t.count === 0) return;
    hoursWrap.appendChild(row(REPORTS_TYPE_LABELS[key], reportsOverUnder(t.pct) || '—'));
    hoursWrap.appendChild(caption(t.count + ' job' + (t.count === 1 ? '' : 's') + ', '
      + numText(t.bidHours) + ' bid / ' + numText(t.actualHours) + ' worked'));
  });

  // --- Surprises ---
  reportsStat(box, 'Surprises', 'Used',
    stats.surprises.pct === null ? '—' : pctText(stats.surprises.pct),
    stats.surprises.pct, reportsSurprisesSays(stats.surprises));

  // --- Win rate ---
  const winWrap = reportsStat(box, 'Win rate', 'Won',
    stats.win.pct === null ? '—' : pctText(stats.win.pct), stats.win.pct, reportsWinSays(stats.win));
  const lost = reportsLostBreakdown(stats.win);
  if (lost) winWrap.appendChild(caption(lost));

  // --- Margin realized ---
  // Two bars, not one: what he sold the work at, and what it came in at. The
  // gap between them is the answer, and a single number cannot show a gap.
  const marginWrap = document.createElement('div');
  marginWrap.className = 'rep-stat';
  marginWrap.appendChild(fieldLabel('Margin realized'));
  const pair = document.createElement('div');
  pair.className = 'rep-pair';
  pair.appendChild(row('Bid at', pctText(stats.margin.startPct)));
  pair.appendChild(barMeter(stats.margin.startPct));
  const made = row('Made', pctText(stats.margin.nowPct));
  made.classList.add(marginOnTrack(stats.margin.startPct, stats.margin.nowPct) ? 'rep-good' : 'rep-bad');
  pair.appendChild(made);
  pair.appendChild(barMeter(stats.margin.nowPct));
  marginWrap.appendChild(pair);
  const says = document.createElement('p');
  says.className = 'rep-says';
  says.textContent = reportsMarginSays(stats.margin);
  marginWrap.appendChild(says);
  box.appendChild(marginWrap);

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
      const stored = Photos.put('hourcost-' + Date.now(), pdfBlob, 'pdf');
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

// The company's own name, without the LLC the page itself also drops, so the
// caption and the exhibit's headline are talking about the same shop.
function reportsShopName(settings) {
  const name = String(((settings.company || {}).name) || '').replace(/\s+LLC\.?$/i, '').trim();
  return name || 'your work';
}

// The page's own answer, on the glass, off the same function that prints it —
// so he can check the number without making the PDF, and the card can never
// quote a rate the exhibit does not.
function reportsHourCostCents(settings, startsWith) {
  const hit = DocGen.hourCostRows(settings).find((r) => r.label.indexOf(startsWith) === 0);
  return hit ? hit.cents : NaN;
}

function buildHourCostCard() {
  const settings = reportsSettings();
  const box = card('What an hour costs');
  box.appendChild(caption('One page that shows what an hour of ' + reportsShopName(settings)
    + ' really costs. For the rate conversation.'));

  const line = row('An hour costs', moneyText(reportsHourCostCents(settings, 'Subtotal')) + ' all in');
  line.classList.add('rep-headline');
  box.appendChild(line);
  box.appendChild(caption('Wage, payroll taxes, truck, consumables and overhead, before any profit.'));
  box.appendChild(row('Has to bill at', moneyText(reportsHourCostCents(settings, 'Rate'))));
  box.appendChild(caption('At the ' + pctText(settings.marginPct) + ' margin in Settings. Your rate there is '
    + moneyText(settings.rateCents) + '.'));

  const btn = textButton(reportsBusy ? 'Making the page…' : 'Make the page', 'btn btn-primary btn-block',
    () => reportsMakeHourCost());
  if (reportsBusy) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  box.appendChild(btn);
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

registerScreen('reports', { id: 'screen-reports', title: 'Reports', back: 'settings', tab: 'settings', enter: enterReports, render: renderReports });
