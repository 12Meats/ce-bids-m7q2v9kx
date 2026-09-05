// bidmath.js — pure pricing math. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r = Math.round;

  function unitPrice(costCents, markupPct) { return r(costCents * (1 + markupPct / 100)); }

  // What a day of an owned tool bills at: pct of what it cost new, to the
  // nearest $5, with a floor of $5 for any tool that cost something. Without
  // the floor a $40 pair of bits derives $1.60 at 4%, rounds to $0.00, and the
  // screens hand back the very $0/day line their cost prompts exist to
  // prevent. A tool with no cost has no rate (null); the caller asks for the
  // cost rather than billing a day of gear at nothing. An override typed in
  // Settings never reaches here — ui.js equipmentDayCents returns it as typed,
  // a deliberate $0 included.
  function equipmentDayRate(costCents, pct) {
    if (costCents == null) return null;
    const derived = r(costCents * (pct / 100) / 500) * 500;           // nearest $5
    return costCents > 0 ? Math.max(500, derived) : derived;          // $5 minimum
  }

  function items(bid) { return (bid.areas || []).flatMap((a) => a.items || []); }

  function materialCost(bid) { return items(bid).reduce((s, it) => s + r(it.qty * it.costCents), 0); }

  // Per-line primitives shared with docmodel.js so a document's printed rows
  // and this module's cost stack are computed by the exact same code, not
  // two hand-synced copies of the same rounding rule.
  function resolveMarkup(bid, settings) {
    return bid.pricing && bid.pricing.markupPct != null ? bid.pricing.markupPct : settings.markupPct;
  }
  function itemPrice(it, markupPct) {
    const unit = it.priceCents != null ? it.priceCents : unitPrice(it.costCents, markupPct);
    return { unit, cents: r(it.qty * unit) };
  }
  function rentalPrice(x, markupPct) { return x.markup ? unitPrice(x.cents, markupPct) : x.cents; }
  function equipmentLine(x) { return r(x.days * x.dayCents); }

  function materialPrice(bid, markupPct) {
    return items(bid).reduce((s, it) => s + itemPrice(it, markupPct).cents, 0);
  }

  const EMPTY_LABOR = { crewIds: [], days: 0, tasks: null };
  function getLabor(bid) { return bid.labor || EMPTY_LABOR; }

  // Resolves crew ids to wages; unknown ids bill at $0 (never throw on a stale/edited bid)
  // but are reported back so the UI can flag them instead of silently under-billing.
  function crewWage(ids, settings, unknown) {
    return ids.map((id) => {
      const c = settings.crew.find((c) => c.id === id);
      if (!c && unknown) unknown.add(id);
      return c ? c.wageCents : 0;
    });
  }

  // days × hours-per-day × how many men are on the line. The ONE place that
  // multiplication is written, so the total in the readout and a single task's
  // own caption cannot drift apart — they are the same function, not two
  // copies of the same arithmetic. hoursPerDay comes in already resolved.
  function lineHours(line, hoursPerDay) {
    return line.days * hoursPerDay * ((line.crewIds || []).length);
  }

  function laborReal(bid, settings) {
    const labor = getLabor(bid);
    const hpd = settings.hoursPerDay || 8;
    const lines = labor.tasks && labor.tasks.length ? labor.tasks : [labor];
    let hours = 0, wageCents = 0;
    const unknown = new Set();
    for (const ln of lines) {
      const wages = crewWage(ln.crewIds || [], settings, unknown);
      const h = ln.days * hpd;   // hours ONE man works on this line
      hours += lineHours(ln, hpd);
      wageCents += wages.reduce((s, w) => s + r(w * h), 0);
    }
    return { hours, wageCents, unknownCrewIds: Array.from(unknown) };
  }

  // Merging a task list back into one line preserves the person-hours EXACTLY.
  // No rounding: the day count that comes back can be 1.25, and the hours on
  // the bid do not move by a minute. Hours are what bid hours and the price
  // are built on, and a merge is a different way of looking at the same job,
  // not a chance to re-estimate it.
  //
  //   days = Σ(task.days × task crew count) ÷ union crew count
  //
  // Hours-per-day cancels out of that division, which is why it is not a
  // parameter here: the answer is the same for a 6-hour day and a 12-hour one.
  //
  // A task with days on it and NOBODY on it has no honest place in that sum.
  // Its days can't go through the division (it contributes no person-hours),
  // and adding them to the merged line multiplies them by the union crew — two
  // men and a 3-day unassigned task came out as 80 hours where the tasks said
  // 32. Both readings are wrong, so the merge REFUSES and names the task: the
  // owner either puts a crew on it or deletes it, and either answer is his to
  // make, not this function's to guess. A crewless task with 0 days is just an
  // empty line he hasn't filled in yet — it is ignored, and changes nothing.
  //
  // Returns { ok: false, reason, taskName } or { ok: true, crewIds, days }.
  //
  // Two things DO move when the crews differ from task to task, and the screen
  // says so, with the numbers, before it asks:
  //
  //   Wages — the merged line puts the whole union crew on the whole job, so
  //   an expensive man who only worked one task now bills for all of it.
  //
  //   Truck days — costStack bills the truck per day: summed across the tasks
  //   before the merge, taken off the single day count after it. Three men on
  //   three one-day tasks is 3 truck days before and 1 after.
  //
  // Nothing here mutates what it was handed; the caller writes the result onto
  // the bid and clears labor.tasks.
  function mergeTasks(labor) {
    const tasks = (labor && labor.tasks) || [];
    const crewIds = [];
    let crewDayUnits = 0;   // Σ days × men, over the tasks that have men on them
    for (const t of tasks) {
      const ids = t.crewIds || [];
      if (ids.length === 0) {
        if (t.days > 0) return { ok: false, reason: 'crewless', taskName: t.name };
        continue;           // 0 days and nobody on it: an empty line, no hours either way
      }
      for (const id of ids) if (crewIds.indexOf(id) === -1) crewIds.push(id);
      crewDayUnits += t.days * ids.length;
    }
    return { ok: true, crewIds, days: crewIds.length ? crewDayUnits / crewIds.length : 0 };
  }

  // The tasks that say a day of work and name nobody to do it. They are worth
  // no hours (lineHours multiplies by a crew of zero) and yet their days still
  // bill truck and gas through truckDays, so the bid quietly carries a cost
  // with no labor behind it — and mergeTasks refuses to fold them at all. The
  // rule is written here, once, so the Labor screen's card flag and the Costs
  // & price screen's labor flag are the same question asked twice, not two
  // guesses. A crewless task with 0 days is an empty line he hasn't filled in
  // and is not one of these.
  function crewlessTasks(labor) {
    return ((labor && labor.tasks) || []).filter((t) => t && t.days > 0 && ((t.crewIds || []).length === 0));
  }

  // The day count the truck and gas bill off: the sum of the tasks' days once
  // the job has been split, the single line's days before that. costStack uses
  // it, and it is exported because the Price screen has to show the figure the
  // stack ACTUALLY used — reading labor.days over there would print "2 days"
  // beside a truck charge for three, and a number that doesn't match its own
  // label is worse than no number.
  function truckDays(bid) {
    const labor = getLabor(bid);
    return labor.tasks && labor.tasks.length ? labor.tasks.reduce((s, t) => s + t.days, 0) : labor.days;
  }

  function bidHours(realHours, cushionPct) {
    // + 0 normalizes the -0 that Math.ceil produces for realHours === 0 (ceil(-1e-9) is -0).
    return Math.ceil(realHours * (1 + cushionPct / 100) - 1e-9) + 0;
  }

  // The other direction: he types the hours he wants on the bid and this says
  // what cushion that is. bidHours(realHours, cushionForBidHours(r, b)) === b
  // is the property the price screen depends on — he types 8 and the row has
  // to read 8, not 9 — so this is the inverse of bidHours and not merely a
  // percentage difference.
  //
  // Which is why it rounds DOWN to a tenth of a percent rather than to the
  // nearest one. bidHours CEILS, so a cushion even a hair over the exact one
  // pushes the hours to the next whole number: 7 real hours quoted at 8 is
  // 14.2857…%, and 14.3% of 7 is 8.001 hours, which ceils to 9. Rounded down
  // to 14.2% it is 7.994, which ceils to 8. The give-away is at most a tenth
  // of a percent of the real hours — under an hour for any job this app will
  // ever see — so the ceiling still lands on the number he typed.
  //
  // Below the real hours the answer is NEGATIVE, and that is allowed on
  // purpose: selling 40 hours for work he figured at 48 is a decision he is
  // entitled to make with his eyes open, and the screen says so in red.
  // Nothing to divide by with no real hours, so there is no cushion that
  // makes any difference: 0.
  function cushionForBidHours(realHours, bidHours2) {
    if (!(realHours > 0)) return 0;
    const exact = (bidHours2 / realHours - 1) * 100;
    // The epsilon keeps a clean 20% off falling to 19.9 when the division
    // lands at 19.999999999999996.
    return Math.floor(exact * 10 + 1e-9) / 10;
  }

  function costStack(bid, settings) {
    const p = bid.pricing;
    const mk = resolveMarkup(bid, settings);
    const mc = materialCost(bid);
    const mp = materialPrice(bid, mk);
    const rentalsCost = (bid.rentals || []).reduce((s, x) => s + x.cents, 0);
    const rentalsPrice = (bid.rentals || []).reduce((s, x) => s + rentalPrice(x, mk), 0);
    // Round each equipment/truck line individually — fractional days (0.5, 1.5, …) must never
    // leak fractional cents into the customer-facing price.
    const equipmentCost = (bid.equipment || []).reduce((s, x) => s + equipmentLine(x), 0);
    const equipmentPrice = equipmentCost;
    const misc = (bid.misc && bid.misc.cents) || 0;
    const lab = laborReal(bid, settings);
    const laborCost = r(lab.wageCents * (1 + settings.burdenPct / 100));
    const truck = r(truckDays(bid) * settings.truckDayCents);
    const consumables = r(mc * settings.consumablesPct / 100);
    const base = mc + rentalsCost + equipmentCost + misc + laborCost + truck + consumables;
    const trueCost = r(base * (1 + settings.overheadPct / 100));
    const bh = bidHours(lab.hours, p.cushionPct != null ? p.cushionPct : 0);
    return {
      materialCost: mc, materialPrice: mp, rentalsCost, rentalsPrice, equipmentCost, equipmentPrice, misc,
      laborCost, realHours: lab.hours, wageCents: lab.wageCents, unknownCrewIds: lab.unknownCrewIds,
      truck, consumables, overhead: trueCost - base,
      trueCost, bidHours: bh, fixedPrice: mp + rentalsPrice + equipmentPrice + misc,
    };
  }

  function marginPctOf(priceCents, costCents) { return priceCents > 0 ? (priceCents - costCents) / priceCents * 100 : 0; }

  // The returned {rateCents, priceCents, marginPct, why} is authoritative; callers must display
  // these values, never echo the typed input (e.g. a typed price below fixedPrice clamps the rate to 0).
  //
  // `why` classifies a TYPED PRICE against what came back, and it is null for
  // the rate and margin handles because neither of them types a total. The
  // screen turns it into a sentence and does no arithmetic of its own — the
  // classification is a comparison of three numbers, and a screen that made it
  // by looking at rateCents alone called an over-the-fixed-price bid a refusal:
  //
  //   'exact'    — the typed total was reachable at whole cents an hour. Say
  //                nothing; the number on screen is the number he typed.
  //   'rounded'  — reachable only between whole cents, so the rate rounded DOWN
  //                and the price came back under by less than a cent per bid
  //                hour. Nothing to decide, but he should see it.
  //   'floored'  — he typed LESS than the materials, rentals and equipment cost.
  //                The rate clamps to $0 rather than going negative, so the
  //                price came back UP, at the fixed cost. That is not rounding,
  //                it is the screen refusing to quote a job at a loss.
  //   'no-labor' — he typed at or above the fixed cost, but not enough above it
  //                to buy one whole cent an hour. The price fits; there is
  //                simply nothing left for labor. A parts-only bid lands here
  //                on purpose, and calling that a refusal would be a lie.
  //
  // A TYPED PRICE ROUNDS THE RATE DOWN, not to nearest (Adrian's call, 9/05).
  // The price is always fixedPrice + rate x bidHours off a whole-cent rate, so
  // a typed total that is not reachable at whole cents has to land on one side
  // of itself or the other. Rounding to nearest could put the number he says
  // out loud ABOVE the number he typed — $13,000 came back $13,000.30 — and a
  // price that grew after he set it is the one direction this app may never
  // move. Flooring gives up at most (bidHours - 1) cents and guarantees
  // priceCents <= value. Below fixedPrice the floor goes negative, the clamp
  // below takes the rate to 0, and the caller says so in different words.
  function solve(stack, handle, value) {
    let rateCents;
    if (handle === 'rate') {
      rateCents = r(value);
    } else if (handle === 'price') {
      rateCents = stack.bidHours === 0 ? 0 : Math.floor((value - stack.fixedPrice) / stack.bidHours);
    } else if (handle === 'margin') {
      if (stack.bidHours === 0) {
        rateCents = 0;
      } else {
        const m = Math.min(value, 99.9); // avoid divide-by-zero/Infinity at or above 100% margin
        const price = r(stack.trueCost / (1 - m / 100));
        rateCents = r((price - stack.fixedPrice) / stack.bidHours);
      }
    } else {
      throw new Error('bad handle');
    }
    if (!(rateCents > 0)) rateCents = 0; // also catches -0 and NaN, not just negatives
    const priceCents = stack.fixedPrice + rateCents * stack.bidHours;
    let why = null;
    if (handle === 'price') {
      if (value < stack.fixedPrice) why = 'floored';
      else if (rateCents === 0) why = 'no-labor';
      else if (priceCents !== value) why = 'rounded';
      else why = 'exact';
    }
    return { rateCents, priceCents, marginPct: marginPctOf(priceCents, stack.trueCost), why };
  }

  function belowFloor(rateCents, floorCents) { return rateCents < floorCents; }

  function atYourRate(stack, settingsRateCents, bidRateCents) {
    return { atRateCents: stack.bidHours * settingsRateCents, bidLaborCents: stack.bidHours * bidRateCents };
  }

  // -------------------------------------------------------------------------
  // THE JOB — what it actually cost once it was built
  // -------------------------------------------------------------------------

  // A change order is a small bid living inside the job: its own areas, its
  // own labor, and nothing else. It is priced off the PARENT bid's numbers —
  // the same labor rate, the same material markup, the same hours cushion —
  // so a day added in September bills the way the job was sold in August.
  // None of the parent's own money comes with it: misc, rentals and owned
  // equipment are already charged on the bid and must not be charged twice.
  function changeOrderScratch(co, bid) {
    return {
      areas: co.areas || [],
      labor: co.labor || EMPTY_LABOR,
      misc: { cents: 0 }, rentals: [], equipment: [],
      pricing: bid.pricing,
    };
  }

  // The cost stack of one change order, on the parent bid's terms. Its own
  // hours, its own materials, its own truck days — everything a small bid has.
  function changeOrderStack(co, bid, settings) {
    return costStack(changeOrderScratch(co, bid), settings);
  }

  // A change order with nothing on it: no items in any of its areas, and no
  // days of labor anywhere. It prices at $0 because there is nothing in it to
  // price, which is a different thing from work he has not costed yet — so the
  // paper leaves it out entirely and the job screen says "Nothing on it yet"
  // rather than quoting a customer a $0.00 line for extra work.
  //
  // Days without a crew still count as something: those days bill truck and
  // gas, so the change order has real money in it and is not empty.
  function changeOrderIsEmpty(co) {
    if (!co) return true;
    const hasItems = (co.areas || []).some((a) => ((a && a.items) || []).length > 0);
    if (hasItems) return false;
    return !(truckDays(co) > 0);
  }

  // What one change order sells for. DERIVED, never stored: the document, the
  // bids list and the job card all call this, so a day added on the change
  // order's labor screen moves the customer's price the instant it is typed
  // and nothing has to remember to write a cached number back.
  function changeOrderPrice(co, bid, settings) {
    return solve(changeOrderStack(co, bid, settings), 'rate', bid.pricing.rateCents).priceCents;
  }

  const EMPTY_JOB = { weeks: [], surprises: [], changeOrders: [], completedAt: null };

  // Bid versus actual, in one reading of one bid. Over ten jobs this is the
  // card that cures underbidding, so every number the job screen shows comes
  // from here — the screen does no arithmetic of its own.
  //
  //   marginStartPct is the LIVE margin off the stored rate, not the
  //   pricing.marginPct snapshot: that field stopped being true the moment a
  //   rental or an overhead change landed after the last handle move.
  //
  //   setAside is the cushion in money — the hours quoted above the hours
  //   planned, at the rate they were sold at. That is what a surprise is
  //   meant to come out of before it comes out of the margin.
  //
  //   The hours overrun is costed at the crew's loaded hourly cost — WAGES
  //   PLUS BURDEN AND NOTHING ELSE, taken off costStack rather than
  //   re-derived from wages, so there is one definition of what an hour of
  //   crew costs. Deliberately NOT the fully loaded hour: truck, consumables
  //   and overhead are charged off the plan (truck days, material cost, the
  //   overhead percentage on the whole base) and do not grow just because the
  //   crew stayed late. The card's caption says so in those words.
  //
  //   A CHANGE ORDER IS A SMALL BID, AND IT BRINGS ITS WHOLE SELF. Its price
  //   goes on the job, and so do its hours and its cost: its real hours join
  //   the plan (so the extra work is not read as an overrun), its bid hours
  //   join the quoted hours (so the burn bar has something to burn), and its
  //   true cost joins the job's. Fold in the money without the hours and a
  //   change order looks like free margin while its own crew time reads as a
  //   blown estimate — both halves wrong, in opposite directions.
  //
  //   marginStartPct is therefore the live margin of the WHOLE job as bid,
  //   change orders included: combined price over combined true cost. With no
  //   change orders it is exactly solve(stack, 'rate', rate).marginPct.
  function jobActuals(bid, settings) {
    const job = bid.job || EMPTY_JOB;
    const stack = costStack(bid, settings);
    const rate = bid.pricing.rateCents;

    const sold = solve(stack, 'rate', rate);

    // One pass over the change orders, one cost stack each: price, hours and
    // cost all come off the same stack rather than three walks that could
    // disagree. The price line is changeOrderPrice's definition, spelled out
    // here only because the stack it needs is already in hand.
    let changeOrderCents = 0, coRealHours = 0, coBidHours = 0, coTrueCost = 0, coLaborCost = 0;
    for (const co of (job.changeOrders || [])) {
      const cs = changeOrderStack(co, bid, settings);
      changeOrderCents += solve(cs, 'rate', rate).priceCents;
      coRealHours += cs.realHours;
      coBidHours += cs.bidHours;
      coTrueCost += cs.trueCost;
      coLaborCost += cs.laborCost;
    }

    // Equal to DocModel.build(bid, data, level).totalCents by construction —
    // a test pins that equality, so the card and the paper cannot drift.
    const priceCents = sold.priceCents + changeOrderCents;
    const realHours = stack.realHours + coRealHours;
    // Each change order's cushion is ceiled on its own hours, the way it was
    // sold; summing the ceilings is what the customer was quoted. Adding a
    // change order can only ever raise this number.
    const bidHours = stack.bidHours + coBidHours;
    const trueCostCents = stack.trueCost + coTrueCost;

    const actualHours = (job.weeks || []).reduce((s, w) => s + w.hours, 0);
    const surpriseCents = (job.surprises || []).reduce((s, x) => s + x.cents, 0);

    const setAsideCents = r((bidHours - realHours) * rate);

    const loadedWageCents = realHours > 0 ? r((stack.laborCost + coLaborCost) / realHours) : 0;
    const overrunCents = r(Math.max(0, actualHours - realHours) * loadedWageCents);
    const actualCostCents = trueCostCents + surpriseCents + overrunCents;

    return {
      bidHours, realHours, actualHours,
      // A bid with no hours on it has nothing to burn: 0%, not Infinity.
      hoursPct: bidHours > 0 ? actualHours / bidHours * 100 : 0,
      setAsideCents, surpriseCents, changeOrderCents, priceCents,
      trueCostCents, overrunCents, actualCostCents,
      // The rate the job was sold at, carried out so a reading over many jobs
      // can put each one's unused hours back into money at ITS OWN rate rather
      // than at whatever the settings say today.
      rateCents: rate,
      marginStartPct: marginPctOf(priceCents, trueCostCents),
      marginNowPct: marginPctOf(priceCents, actualCostCents),
      loadedWageCents,
    };
  }


  // -------------------------------------------------------------------------
  // TEN JOBS — what the estimating has been doing
  // -------------------------------------------------------------------------

  // One job says nothing. Ten say whether he underbids, and by how much, and
  // on which kind of work. This is that reading, and like jobActuals it is the
  // ONLY place the arithmetic behind it is written: the Reports screen prints
  // these fields and assembles sentences around them, and does no math of its
  // own.
  //
  // What counts as finished is status 'complete' — the one-way door on the job
  // screen — because a job is only worth measuring once nobody is going to log
  // another hour against it.
  //
  // Ratios are null, never Infinity or 0, when there is nothing to divide by:
  // a bid with no hours on it has no overrun, a job nothing was set aside on
  // has no surprise percentage, and a shop that has never lost a bid has no
  // win rate. The screen says "not yet" to a null; a 0 would be a lie with a
  // number on it.
  const STATS_MIN_COMPLETED = 3;

  // Lost bids are counted under the reasons storage.js stores; a lost bid with
  // no reason on it lands in 'none' rather than being quietly dropped, so the
  // counts always add up to the number of lost bids.
  const STATS_LOST_REASONS = ['price', 'timing', 'other', 'silence'];

  function ratioPct(part, whole) { return whole > 0 ? part / whole * 100 : null; }

  function mean(total, count) { return count > 0 ? total / count : null; }

  // realHours is the hours he FIGURED before the cushion was added. Carrying it
  // alongside bidHours is what lets the screen tell the two failures apart: a
  // gut number that was light, and a cushion that was too thin to cover it.
  function emptyHours() {
    return { count: 0, bidHours: 0, realHours: 0, actualHours: 0, pct: null, offBidPct: null, offRealPct: null };
  }

  // How far off an estimate was, signed, positive = over, one decimal — the
  // form the sentence uses. null when there is nothing to be off from: a job
  // with no hours planned is not "0% over", it is not a reading at all.
  function offPct(actual, planned) {
    return planned > 0 ? Math.round((actual / planned * 100 - 100) * 10) / 10 : null;
  }

  // The newest finished job first. completedAt is the day the door closed;
  // dateISO stands in for a job whose status was set some other way (an
  // imported document, an older build), so nothing sorts as undefined.
  function statsDoneAt(bid) { return (bid.job && bid.job.completedAt) || bid.dateISO || ''; }

  function estimatingStats(bids, settings) {
    const all = bids || [];
    const done = all.filter((b) => b && b.status === 'complete');

    const jobs = done
      .map((bid) => ({ bid, actuals: jobActuals(bid, settings) }))
      .sort((a, b) => {
        const x = statsDoneAt(a.bid), y = statsDoneAt(b.bid);
        return x < y ? 1 : x > y ? -1 : 0;
      });

    const hours = emptyHours();
    const byType = { service: emptyHours(), project: emptyHours() };
    let setAsideCents = 0, surpriseCents = 0, unspentCents = 0, startTotal = 0, nowTotal = 0;
    let priceTotal = 0, trueCostTotal = 0, actualCostTotal = 0;

    for (const j of jobs) {
      const a = j.actuals;
      hours.count += 1;
      hours.bidHours += a.bidHours;
      hours.realHours += a.realHours;
      hours.actualHours += a.actualHours;
      const t = byType[j.bid.jobType];
      if (t) {
        t.count += 1;
        t.bidHours += a.bidHours;
        t.realHours += a.realHours;
        t.actualHours += a.actualHours;
      }
      setAsideCents += a.setAsideCents;
      surpriseCents += a.surpriseCents;
      // THE CUSHION IN MONEY THAT ACTUALLY EXISTS. setAside is the cushion as
      // budgeted; these are the quoted hours nobody worked, at the rate that
      // job was sold at, which is the only place cushion dollars can come
      // from. A job that ran over its bid hours contributes nothing — that
      // money was spent on the crew before any surprise turned up.
      unspentCents += r(Math.max(0, a.bidHours - a.actualHours) * a.rateCents);
      startTotal += a.marginStartPct;
      nowTotal += a.marginNowPct;
      priceTotal += a.priceCents;
      trueCostTotal += a.trueCostCents;
      actualCostTotal += a.actualCostCents;
    }
    hours.pct = ratioPct(hours.actualHours, hours.bidHours);
    hours.offBidPct = offPct(hours.actualHours, hours.bidHours);
    hours.offRealPct = offPct(hours.actualHours, hours.realHours);
    for (const key of Object.keys(byType)) {
      const t = byType[key];
      t.pct = ratioPct(t.actualHours, t.bidHours);
      t.offBidPct = offPct(t.actualHours, t.bidHours);
      t.offRealPct = offPct(t.actualHours, t.realHours);
    }

    // Won counts the jobs he is still working as well as the ones he finished:
    // a won bid is a bid he won, and waiting for it to be complete would read
    // as a worse win rate than he actually has.
    const won = all.filter((b) => b && (b.status === 'won' || b.status === 'complete')).length;
    const lostBids = all.filter((b) => b && b.status === 'lost');
    const reasons = { none: 0 };
    STATS_LOST_REASONS.forEach((k) => { reasons[k] = 0; });
    lostBids.forEach((b) => {
      const k = STATS_LOST_REASONS.indexOf(b.lostReason) !== -1 ? b.lostReason : 'none';
      reasons[k] += 1;
    });
    // The reason he loses most — and only when there IS one. Two reasons level
    // on the same count is not "he loses on price", it is two reasons, and
    // naming either of them would send him to fix the wrong thing. A tie is
    // no answer, so the screen's clause disappears instead.
    let topCount = 0, topTies = 0, topReason = null;
    STATS_LOST_REASONS.forEach((k) => {
      if (reasons[k] > topCount) { topCount = reasons[k]; topTies = 1; topReason = k; }
      else if (reasons[k] > 0 && reasons[k] === topCount) { topTies += 1; }
    });
    if (topTies !== 1) topReason = null;
    const heard = won + lostBids.length;

    return {
      ready: jobs.length >= STATS_MIN_COMPLETED,
      completedCount: jobs.length,
      needed: STATS_MIN_COMPLETED,
      jobs,
      hours,
      byType,
      // coveredBy is the honest verdict the percentage alone cannot give:
      //   'cushion'  the unused hours were worth more than the surprises
      //   'hours'    nothing was left unused, so there was no money to cover
      //              them with, whatever the budget said
      //   'neither'  something was left, but not enough
      surprises: {
        setAsideCents,
        surpriseCents,
        unspentCents,
        pct: ratioPct(surpriseCents, setAsideCents),
        coveredBy: surpriseCents <= unspentCents ? 'cushion' : (unspentCents === 0 ? 'hours' : 'neither'),
      },
      win: { won, lost: lostBids.length, heard, pct: ratioPct(won, heard), reasons, topReason },
      // Two readings of the same jobs. The weighted pair is the shop's actual
      // margin over the period (all the money in, all the money out); the mean
      // pair is the typical JOB, where a $400 service call counts as much as a
      // $90,000 project. The screen headlines the weighted one, because that
      // is the one that has to match the bank.
      margin: {
        meanStartPct: mean(startTotal, jobs.length),
        meanNowPct: mean(nowTotal, jobs.length),
        weightedStartPct: priceTotal > 0 ? marginPctOf(priceTotal, trueCostTotal) : null,
        weightedNowPct: priceTotal > 0 ? marginPctOf(priceTotal, actualCostTotal) : null,
      },
    };
  }

  function fmt(cents) {
    if (!Number.isFinite(cents)) return '—'; // last line of defense: never render NaN/Infinity to a user
    const neg = cents < 0 ? '-' : '';
    const v = Math.abs(Math.round(cents));
    const d = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg}$${d}.${(v % 100).toString().padStart(2, '0')}`;
  }

  return {
    unitPrice, equipmentDayRate, materialCost, materialPrice, laborReal, lineHours, truckDays, bidHours, cushionForBidHours, mergeTasks, crewlessTasks, costStack, solve,
    marginPctOf, belowFloor, atYourRate, fmt,
    changeOrderScratch, changeOrderStack, changeOrderPrice, jobActuals,
    estimatingStats,
    resolveMarkup, itemPrice, rentalPrice, equipmentLine, changeOrderIsEmpty,
  };
});
