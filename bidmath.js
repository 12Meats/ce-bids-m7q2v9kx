// bidmath.js — pure pricing math. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r = Math.round;

  function unitPrice(costCents, markupPct) { return r(costCents * (1 + markupPct / 100)); }

  function equipmentDayRate(costCents, pct) {
    if (costCents == null) return null;
    return r(costCents * (pct / 100) / 500) * 500;                    // nearest $5
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

  function laborReal(bid, settings) {
    const labor = getLabor(bid);
    const hpd = settings.hoursPerDay || 8;
    const lines = labor.tasks && labor.tasks.length ? labor.tasks : [labor];
    let hours = 0, wageCents = 0;
    const unknown = new Set();
    for (const ln of lines) {
      const wages = crewWage(ln.crewIds || [], settings, unknown);
      const h = ln.days * hpd;
      hours += h * wages.length;
      wageCents += wages.reduce((s, w) => s + r(w * h), 0);
    }
    return { hours, wageCents, unknownCrewIds: Array.from(unknown) };
  }

  // Merging a task list back into one line has to leave the job the same size:
  // total hours is what the price is built on, so total hours is what is kept.
  // The merged line carries every crew member who appeared on any task (the
  // union), and its day count is how long THAT crew would take to work those
  // same hours:
  //
  //   days = Σ(task.days × hoursPerDay × task crew count)
  //          ────────────────────────────────────────────
  //                 hoursPerDay × union crew count
  //
  // rounded to the nearest half day, because half a day is the smallest thing
  // this app lets anyone type — so the merged number is one he could have
  // typed himself, at the cost of a few minutes either way.
  //
  // Hours, not the wage split: collapsing two tasks onto one line puts the
  // whole union crew on the whole job, so an expensive man who only worked one
  // task now bills for all of it (or the reverse). Total hours — what the bid
  // hours and the price are built on — comes through unchanged; the wage line
  // can move by a few dollars. That is the trade the confirmation is warning
  // about when it says the task names are lost.
  //
  // With nobody on any task there are no hours to divide by a crew of zero, so
  // the days simply add up and the line stays crewless (0 hours either way).
  //
  // Returns { crewIds, days }; the caller writes them onto the bid and clears
  // labor.tasks, so nothing here mutates what it was handed.
  function mergeTasks(labor, hoursPerDay) {
    const tasks = (labor && labor.tasks) || [];
    const hpd = hoursPerDay || 8;
    const crewIds = [];
    let personHours = 0;
    let plainDays = 0;
    for (const t of tasks) {
      const ids = t.crewIds || [];
      for (const id of ids) if (crewIds.indexOf(id) === -1) crewIds.push(id);
      personHours += t.days * hpd * ids.length;
      plainDays += t.days;
    }
    const days = crewIds.length
      ? Math.round(personHours / (hpd * crewIds.length) * 2) / 2
      : plainDays;
    return { crewIds, days };
  }

  function bidHours(realHours, cushionPct) {
    // + 0 normalizes the -0 that Math.ceil produces for realHours === 0 (ceil(-1e-9) is -0).
    return Math.ceil(realHours * (1 + cushionPct / 100) - 1e-9) + 0;
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
    const labor = getLabor(bid);
    const days = labor.tasks && labor.tasks.length ? labor.tasks.reduce((s, t) => s + t.days, 0) : labor.days;
    const truck = r(days * settings.truckDayCents);
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

  // The returned {rateCents, priceCents, marginPct} triple is authoritative; callers must display
  // these values, never echo the typed input (e.g. a typed price below fixedPrice clamps the rate to 0).
  function solve(stack, handle, value) {
    let rateCents;
    if (handle === 'rate') {
      rateCents = r(value);
    } else if (handle === 'price') {
      rateCents = stack.bidHours === 0 ? 0 : r((value - stack.fixedPrice) / stack.bidHours);
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
    return { rateCents, priceCents, marginPct: marginPctOf(priceCents, stack.trueCost) };
  }

  function belowFloor(rateCents, floorCents) { return rateCents < floorCents; }

  function atYourRate(stack, settingsRateCents, bidRateCents) {
    return { atRateCents: stack.bidHours * settingsRateCents, bidLaborCents: stack.bidHours * bidRateCents };
  }

  function fmt(cents) {
    if (!Number.isFinite(cents)) return '—'; // last line of defense: never render NaN/Infinity to a user
    const neg = cents < 0 ? '-' : '';
    const v = Math.abs(Math.round(cents));
    const d = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg}$${d}.${(v % 100).toString().padStart(2, '0')}`;
  }

  return {
    unitPrice, equipmentDayRate, materialCost, materialPrice, laborReal, bidHours, mergeTasks, costStack, solve,
    marginPctOf, belowFloor, atYourRate, fmt,
    resolveMarkup, itemPrice, rentalPrice, equipmentLine,
  };
});
