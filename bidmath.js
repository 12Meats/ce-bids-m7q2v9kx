// bidmath.js — pure pricing math. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const r = Math.round;

  function unitPrice(costCents, markupPct) { return r(costCents * (1 + markupPct / 100)); }

  function equipmentDayRate(costCents, pct) {
    if (costCents == null) return null;
    return r(costCents * (pct / 100) / 500) * 500;                    // nearest $5
  }

  function items(bid) { return (bid.areas || []).flatMap((a) => a.items || []); }

  function materialCost(bid) { return items(bid).reduce((s, it) => s + r(it.qty * it.costCents), 0); }

  function materialPrice(bid, markupPct) {
    return items(bid).reduce((s, it) => {
      const unit = it.priceCents != null ? it.priceCents : unitPrice(it.costCents, markupPct);
      return s + r(it.qty * unit);
    }, 0);
  }

  function crewWage(ids, settings) {
    return ids.map((id) => (settings.crew.find((c) => c.id === id) || { wageCents: 0 }).wageCents);
  }

  function laborReal(bid, settings) {
    const hpd = settings.hoursPerDay || 8;
    const lines = bid.labor.tasks && bid.labor.tasks.length ? bid.labor.tasks : [bid.labor];
    let hours = 0, wageCents = 0;
    for (const ln of lines) {
      const wages = crewWage(ln.crewIds || [], settings);
      const h = ln.days * hpd;
      hours += h * wages.length;
      wageCents += wages.reduce((s, w) => s + r(w * h), 0);
    }
    return { hours, wageCents };
  }

  function bidHours(realHours, cushionPct) {
    // + 0 normalizes the -0 that Math.ceil produces for realHours === 0 (ceil(-1e-9) is -0).
    return Math.ceil(realHours * (1 + cushionPct / 100) - 1e-9) + 0;
  }

  function costStack(bid, settings) {
    const p = bid.pricing;
    const mc = materialCost(bid);
    const mp = materialPrice(bid, p.markupPct != null ? p.markupPct : settings.markupPct);
    const rentalsCost = (bid.rentals || []).reduce((s, x) => s + x.cents, 0);
    const rentalsPrice = (bid.rentals || []).reduce((s, x) => s + (x.markup ? unitPrice(x.cents, settings.markupPct) : x.cents), 0);
    const equipmentCost = (bid.equipment || []).reduce((s, x) => s + x.days * x.dayCents, 0);
    const equipmentPrice = equipmentCost;
    const misc = (bid.misc && bid.misc.cents) || 0;
    const lab = laborReal(bid, settings);
    const laborCost = r(lab.wageCents * (1 + settings.burdenPct / 100));
    const days = bid.labor.tasks && bid.labor.tasks.length ? bid.labor.tasks.reduce((s, t) => s + t.days, 0) : bid.labor.days;
    const truck = days * settings.truckDayCents;
    const consumables = r(mc * settings.consumablesPct / 100);
    const base = mc + rentalsCost + equipmentCost + misc + laborCost + truck + consumables;
    const trueCost = r(base * (1 + settings.overheadPct / 100));
    const bh = bidHours(lab.hours, p.cushionPct != null ? p.cushionPct : 0);
    return {
      materialCost: mc, materialPrice: mp, rentalsCost, rentalsPrice, equipmentCost, equipmentPrice, misc,
      laborCost, realHours: lab.hours, wageCents: lab.wageCents, truck, consumables, overhead: trueCost - base,
      trueCost, bidHours: bh, fixedPrice: mp + rentalsPrice + equipmentPrice + misc,
    };
  }

  function marginPctOf(priceCents, costCents) { return priceCents > 0 ? (priceCents - costCents) / priceCents * 100 : 0; }

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
        const price = r(stack.trueCost / (1 - value / 100));
        rateCents = r((price - stack.fixedPrice) / stack.bidHours);
      }
    } else {
      throw new Error('bad handle');
    }
    if (rateCents < 0) rateCents = 0;
    const priceCents = stack.fixedPrice + rateCents * stack.bidHours;
    return { rateCents, priceCents, marginPct: marginPctOf(priceCents, stack.trueCost) };
  }

  function belowFloor(rateCents, floorCents) { return rateCents < floorCents; }

  function atYourRate(stack, settingsRateCents, bidRateCents) {
    return { atRateCents: stack.bidHours * settingsRateCents, bidLaborCents: stack.bidHours * bidRateCents };
  }

  function fmt(cents) {
    const neg = cents < 0 ? '-' : '';
    const v = Math.abs(cents);
    const d = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg}$${d}.${(v % 100).toString().padStart(2, '0')}`;
  }

  return {
    unitPrice, equipmentDayRate, materialCost, materialPrice, laborReal, bidHours, costStack, solve,
    marginPctOf, belowFloor, atYourRate, fmt,
  };
});
