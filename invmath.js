// invmath.js — every rule behind the Invoices tab, in one pure module. UMD so
// node:test and the browser both load it. The screens print what comes back
// and do no arithmetic of their own.
//
// It reads bidmath for the per-line primitives (a lot, a list price, a
// rental's markup, a day of owned equipment) so an invoice line and a bid
// line are priced by the same code, and docmodel for a project invoice's
// amount, which is the proposal's own total.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bidmath.js'), require('./docmodel.js'), require('./dates.js'));
  else root.InvMath = factory(root.BidMath, root.DocModel, root.Dates);
})(typeof self !== 'undefined' ? self : this, function (B, DocModel, Dates) {
  'use strict';

  const r = Math.round;
  const AMBER_AFTER_DAYS = 14;

  // -------------------------------------------------------------------------
  // AN ENTRY: WHAT IT COVERS, AND WHETHER HE IS FINISHED WITH IT
  // -------------------------------------------------------------------------
  // A visit was one day until the first week on v3 said otherwise: he opens an
  // entry on Monday and keeps adding to it until the job is done, which is the
  // way the paper always worked. So an entry has a From (dateISO, the field
  // that was always there) and a To (toISO, new and optional), and a state that
  // says whether it is finished: ready, also new and also optional.
  //
  // Both fall back rather than being migrated. A backup written before this
  // release has neither, and every one of its entries reads as one day, still
  // in progress, which is what it was on the phone that wrote it. Nothing in
  // this app writes a toISO that is not an ISO date, so anything else — a null
  // left behind, a hand edit, a half-finished write — reads as the day it
  // started rather than as a date the screens would then try to print.
  function isISOish(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x); }
  function entryFrom(e) { return e && isISOish(e.dateISO) ? e.dateISO : null; }
  function entryTo(e) {
    if (!e) return null;
    return isISOish(e.toISO) ? e.toISO : entryFrom(e);
  }
  // Ready is a decision he made, not a shape the data fell into: only the
  // boolean this app writes counts, so a truthy string off a hand-edited file
  // is not him saying the week is finished.
  function isReady(e) { return !!e && e.ready === true; }

  // -------------------------------------------------------------------------
  // THE PILE: which entries become which invoices
  // -------------------------------------------------------------------------
  // customer + project + the Monday that starts the week. He bills weekly; the
  // two-week invoice on his 6/22 to 7/2 paper only happened because he fell
  // behind, and that case is Combine on the review, not the default.
  // mondayOf is handed in (Store.mondayOf on the phone) so this file owns no
  // calendar rule of its own.
  function group(entries, data, mondayOf, opts) {
    const o = opts || {};
    const exclude = o.exclude || new Set();
    const byKey = new Map();
    (entries || []).forEach((e) => {
      if (!e || e.invoiceId) return;
      if (exclude.has(e.id)) return;
      const key = e.customerId + '|' + e.projectId + '|' + mondayOf(e.dateISO);
      if (!byKey.has(key)) {
        const proj = (data.projects || []).find((p) => p.id === e.projectId);
        byKey.set(key, { key, customerId: e.customerId, projectId: e.projectId,
          title: proj ? proj.title : '', entries: [], from: e.dateISO, to: e.dateISO });
      }
      const g = byKey.get(key);
      g.entries.push(e);
      if (e.dateISO < g.from) g.from = e.dateISO;
      if (e.dateISO > g.to) g.to = e.dateISO;
    });
    const groups = Array.from(byKey.values());
    groups.forEach((g) => g.entries.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0)));
    groups.sort(byFrom);
    return groups;
  }

  // The comparator group() sorts by: oldest from() first. Combine and split
  // both hand back an array under this same order, so a caller never has to
  // re-sort what either one returns.
  function byFrom(a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; }

  // The first LATER group of the SAME job (customer + project), not merely
  // the next card on the list: a catch-up invoice can have another
  // customer's week land, by date, between two weeks of the one job he fell
  // behind on, and Combine has to reach past it rather than stop at it.
  function nextSameJob(groups, i) {
    const a = groups[i];
    if (!a) return -1;
    for (let j = i + 1; j < groups.length; j += 1) {
      if (groups[j].customerId === a.customerId && groups[j].projectId === a.projectId) return j;
    }
    return -1;
  }
  function canCombine(groups, i) { return nextSameJob(groups, i) !== -1; }
  // Combine groups[i] with the next group of the SAME job, wherever it sits.
  // The entries are concatenated and re-sorted by date (they came from two
  // different weeks); the groups that sat between the two keep their own
  // place on the list, merely shifted down by the one slot that closed up.
  // Returns the SAME array when there is no later group of this job, so a
  // caller can test identity rather than re-deriving the rule.
  function combine(groups, i) {
    const j = nextSameJob(groups, i);
    if (j === -1) return groups;
    const a = groups[i], b = groups[j];
    const merged = { ...a, key: a.key + '+' + b.key,
      entries: a.entries.concat(b.entries).sort((x, y) => (x.dateISO < y.dateISO ? -1 : x.dateISO > y.dateISO ? 1 : 0)),
      from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
    return groups.slice(0, i).concat([merged], groups.slice(i + 1, j), groups.slice(j + 1));
  }
  // One group per entry. The pieces come back in the SAME position as the
  // group they replaced only by date: split can turn one card into entries
  // that belong before AND after a neighbouring group (a Monday and a Friday
  // either side of someone else's Wednesday), so the whole list is re-sorted
  // by from rather than spliced in as a run.
  function split(groups, i) {
    const g = groups[i];
    if (!g || g.entries.length < 2) return groups;
    const parts = g.entries.map((e) => ({ ...g, key: g.key + '#' + e.id, entries: [e], from: entryFrom(e), to: entryTo(e) }));
    return groups.slice(0, i).concat(parts, groups.slice(i + 1)).sort(byFrom);
  }

  // ONE GROUP PER ENTRY, which is what the pile is now.
  //
  // group() above put a week of one job on one card and billed it as one
  // invoice. The first week on v3 said no: he opens an entry when the job
  // starts, keeps adding to it, and marks it Ready when the work is done. So
  // the entry IS the invoice, two entries on one job only ever exist because
  // he tapped Start invoice twice, and nothing merges on its own. group()
  // stays for the tests that pin what it used to do; no screen calls it.
  //
  // Same shape group() hands back, so draftInvoice, Combine and Split all read
  // it without knowing which of the two made it.
  function groupEach(entries, data, opts) {
    const o = opts || {};
    const exclude = o.exclude || new Set();
    const groups = [];
    (entries || []).forEach((e) => {
      if (!e || e.invoiceId) return;
      if (exclude.has(e.id)) return;
      const proj = ((data && data.projects) || []).find((p) => p.id === e.projectId);
      groups.push({
        key: e.id, customerId: e.customerId, projectId: e.projectId,
        title: proj ? proj.title : '', entries: [e], from: entryFrom(e), to: entryTo(e),
      });
    });
    // Array#sort is stable, so two entries that start the same day keep the
    // order they were logged in.
    groups.sort(byFrom);
    return groups;
  }

  // Every later group of the same job, folded into this one at once. Combine
  // does the pair; this is the three-visit week he used to write as one paper,
  // without three taps and a re-read of the list between each of them.
  //
  // Written as repeated combine() rather than as a second merge rule of its
  // own: one definition of what merging two cards means, so the pair and the
  // whole can never come apart. The same array comes back when there is
  // nothing later of this job, exactly as combine's does.
  function combineAll(groups, i) {
    if (!groups || !groups[i]) return groups;
    let out = groups;
    // combine() closes one slot up each time and leaves the merged card at i,
    // so i does not move: the next fold is the next later group of the job.
    for (;;) {
      const next = combine(out, i);
      if (next === out) return out;
      out = next;
    }
  }

  // How long an entry has been waiting, in the only sense that means anything:
  // since he said it was finished. An entry he is still working is not late
  // however long it has been open, so it has no age at all — the job is not
  // done. Once it is Ready the clock runs from the LAST day worked, because
  // that is the day the customer stopped seeing his trucks.
  function pileAge(e, todayISO) {
    if (!isReady(e)) return null;
    return Dates.daysSince(entryTo(e), todayISO);
  }

  // THE WEEK AT A GLANCE — the one line at the top of the Invoices home.
  //
  // Monday to Sunday of the day he is standing in (mondayOf is handed in, the
  // way group() takes it, so this file owns no calendar rule of its own), and
  // only what is still unbilled. An entry counts when either end of it falls
  // in the week: an open tab started last Thursday is this week's work too.
  //
  // The money is what those entries would bill if he sent them today, and it
  // is figured by drafting them through draftInvoice and totalling the drafts
  // — the same two functions the Bill these review uses. Nothing is re-derived
  // here, so the sentence at the top of the screen and the invoices at the
  // bottom of it can never say two different numbers.
  function thisWeek(data, todayISO, mondayOf) {
    const from = mondayOf(todayISO);
    const to = from ? Dates.addDays(from, 6) : null;
    const inWeek = (e) => {
      const a = entryFrom(e), b = entryTo(e);
      return (a >= from && a <= to) || (b >= from && b <= to);
    };
    const mine = ((data && data.logs) || []).filter((e) => e && !e.invoiceId && from && inWeek(e));
    const hours = mine.reduce((s, e) => s + (e.crew || []).reduce((t, m) => t + m.hours, 0), 0);
    const ready = mine.filter(isReady).length;
    const unbilledCents = groupEach(mine, data)
      .reduce((s, g) => s + totals(draftInvoice(g, data, 0)).total, 0);
    return { hours, inProgress: mine.length - ready, ready, unbilledCents, from, to };
  }

  // What is IN a group, before anything is priced: the hours everybody put in
  // and what the parts cost him. The pile rows on the Invoices home say both,
  // and a screen does no arithmetic of its own — these were two reduce chains
  // sitting in a row builder, which is the shape a rounding bug hides in.
  //
  // Parts are at COST here, not at what they bill: this is the row telling him
  // what is sitting there unbilled, and the customer's price is a decision the
  // invoice has not made yet.
  function pileHours(g) {
    return ((g && g.entries) || []).reduce((s2, e) => s2 + (e.crew || []).reduce((t, m) => t + m.hours, 0), 0);
  }
  function pileParts(g) {
    return ((g && g.entries) || []).reduce((s2, e) => s2 + B.materialCost({ areas: [{ items: e.items || [] }] }), 0);
  }

  // -------------------------------------------------------------------------
  // THE INVOICE
  // -------------------------------------------------------------------------
  function crewName(data, crewId) {
    const c = (data.settings.crew || []).find((x) => x.id === crewId);
    return c ? c.name : crewId;
  }
  function customerOf(data, id) { return (data.customers || []).find((c) => c.id === id) || null; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Snapshots, like a bid: the rate, the markup, the PO and the terms are
  // copied on the day the invoice is drafted and never re-read from Settings
  // or the customer card. Labor is one row per man with the hours summed
  // across the entries; billedHours starts equal to loggedHours and is his to
  // change on the invoice.
  function draftInvoice(g, data, createdAt) {
    const s = data.settings;
    const cust = customerOf(data, g.customerId);
    const byCrew = new Map();
    g.entries.forEach((e) => (e.crew || []).forEach((m) => {
      byCrew.set(m.crewId, (byCrew.get(m.crewId) || 0) + m.hours);
    }));
    // Rows follow the man's position in Settings, the order the crew screen
    // shows him in, so a truck run out of order at the truck does not print
    // a different man first on every other invoice. An id Settings no longer
    // has falls to the end, in the order it first showed up on this job.
    const crewOrder = (s.crew || []).map((c) => c.id);
    // Infinity would be right arithmetically and wrong as a comparator: two
    // unknown ids give Infinity - Infinity = NaN, and a NaN comparator sorts
    // by nothing. crewOrder.length puts them after every known man and keeps
    // their difference a real number.
    const rank = (id) => { const i = crewOrder.indexOf(id); return i === -1 ? crewOrder.length : i; };
    const labor = Array.from(byCrew.entries())
      .map(([crewId, hours]) => ({ crewId, name: crewName(data, crewId), loggedHours: hours, billedHours: hours }))
      .sort((x, y) => rank(x.crewId) - rank(y.crewId));
    return {
      id: null, number: null, kind: 'tm', customerId: g.customerId, projectTitle: g.title,
      dateISO: null, serviceFrom: g.from, serviceTo: g.to,
      po: (cust && typeof cust.po === 'string') ? cust.po : '',
      terms: (cust && typeof cust.terms === 'string' && cust.terms.trim()) ? cust.terms : (s.invoiceTerms || 'Upon receipt'),
      rateCents: (cust && Number.isInteger(cust.rateCents)) ? cust.rateCents : s.rateCents,
      markupPct: s.markupPct,
      labor,
      items: clone(g.entries.flatMap((e) => e.items || [])),
      rentals: clone(g.entries.flatMap((e) => e.rentals || [])),
      equipment: clone(g.entries.flatMap((e) => e.equipment || [])),
      logIds: g.entries.map((e) => e.id),
      bidId: null, partCents: null, notes: [],
      status: 'draft', sentAt: null, savedToFilesAt: null, payments: [], createdAt,
    };
  }

  // A project invoice: the bid's price plus its change orders (the document
  // total docmodel prints), less what earlier project invoices on the same
  // bid already billed. partCents, when set, is the amount he typed.
  function projectRemainingCents(bid, data, invoices) {
    const whole = DocModel.build(bid, data, 'full').totalCents;
    const billed = (invoices || []).filter((x) => x.kind === 'project' && x.bidId === bid.id)
      .reduce((s, x) => s + totals(x).total, 0);
    return Math.max(0, whole - billed);
  }
  function draftProjectInvoice(bid, data, partCents, createdAt, invoices) {
    const s = data.settings;
    const cust = customerOf(data, bid.customerId);
    // A caller that forgets this argument must NOT read as "nothing billed
    // yet" — that is the one wrong answer, and it is the one that bills the
    // job a second time. Anything that is not an array (undefined, and null,
    // which is just as easy to hand in by accident) falls back to every
    // project invoice already on the file; an explicit [] is his to pass
    // when he means it.
    const prior = Array.isArray(invoices) ? invoices : (data.invoices || []);
    const remaining = projectRemainingCents(bid, data, prior);
    return {
      id: null, number: null, kind: 'project', customerId: bid.customerId, projectTitle: bid.title || '',
      dateISO: null, serviceFrom: bid.dateISO, serviceTo: bid.dateISO,
      po: (cust && typeof cust.po === 'string') ? cust.po : '',
      terms: (cust && typeof cust.terms === 'string' && cust.terms.trim()) ? cust.terms : (s.invoiceTerms || 'Upon receipt'),
      rateCents: bid.pricing.rateCents, markupPct: B.resolveMarkup(bid, s),
      labor: [], items: [], rentals: [], equipment: [], logIds: [],
      bidId: bid.id, partCents: partCents === null || partCents === undefined ? remaining : Math.min(partCents, remaining),
      notes: [], status: 'draft', sentAt: null, savedToFilesAt: null, payments: [], createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // MONEY
  // -------------------------------------------------------------------------
  // The hours ON this invoice, which is what he decided to bill and not what
  // the men logged. Three places were summing it with a reduce of their own —
  // the paper's labor row, the review card, and the invoice screen's own muted
  // line — and three copies of a sum is three chances for one of them to keep
  // counting a man the other two have dropped.
  function billedHours(inv) {
    return ((inv && inv.labor) || []).reduce((s, l) => s + l.billedHours, 0);
  }
  function laborCents(inv) {
    return (inv.labor || []).reduce((s, l) => s + r(l.billedHours * inv.rateCents), 0);
  }
  function totals(inv) {
    if (inv.kind === 'project') {
      const t = inv.partCents || 0;
      return { labor: 0, materials: 0, rentals: 0, equipment: 0, subtotal: t, tax: 0, total: t };
    }
    const labor = laborCents(inv);
    const materials = (inv.items || []).reduce((s, it) => s + B.itemPrice(it, inv.markupPct).cents, 0);
    const rentals = (inv.rentals || []).reduce((s, x) => s + B.rentalPrice(x, inv.markupPct), 0);
    const equipment = (inv.equipment || []).reduce((s, x) => s + B.equipmentLine(x), 0);
    const subtotal = labor + materials + rentals + equipment;
    return { labor, materials, rentals, equipment, subtotal, tax: 0, total: subtotal };
  }
  function paidCents(inv) { return (inv.payments || []).reduce((s, p) => s + p.cents, 0); }
  function balanceCents(inv) { return Math.max(0, totals(inv).total - paidCents(inv)); }
  // Sent gates paid, not the amount owed: a $0 invoice he actually sent has
  // nothing left to collect and reads paid the moment it goes out, rather
  // than sitting "sent" forever because zero was already >= zero before he
  // ever mailed it.
  function statusOf(inv) {
    if (inv.sentAt && paidCents(inv) >= totals(inv).total) return 'paid';
    if (inv.sentAt) return 'sent';
    return 'draft';
  }

  // -------------------------------------------------------------------------
  // AGE, AND WHO OWES
  // -------------------------------------------------------------------------
  function ageDays(iso, todayISO) { return Dates.daysSince(iso, todayISO); }
  function isStale(iso, todayISO) { return ageDays(iso, todayISO) >= AMBER_AFTER_DAYS; }

  function whoOwes(invoices, todayISO) {
    const open = (invoices || []).filter((x) => x.sentAt && balanceCents(x) > 0);
    let totalCents = 0, oldest = null;
    open.forEach((x) => {
      totalCents += balanceCents(x);
      if (!oldest || x.sentAt < oldest.sentAt) oldest = x;
    });
    return {
      totalCents, openCount: open.length,
      oldestDays: oldest ? ageDays(oldest.sentAt, todayISO) : null,
      oldestCustomerId: oldest ? oldest.customerId : null,
    };
  }

  // -------------------------------------------------------------------------
  // ROWS, the way the paper prints them
  // -------------------------------------------------------------------------
  function hoursText(h) { return String(Math.round(h * 100) / 100) + ' hrs'; }
  // qtyNum/unitText live in bidmath.js now, shared with docmodel.js so a part
  // reads the same way on a bid and on an invoice.
  const qtyNum = B.qtyNum;
  const unitText = B.unitText;
  function rangeText(from, to) {
    if (from === to) return Dates.fmtDate(from);
    // "Aug 31 to Sep 4, 2026": the year once, at the end, when both are in it.
    const a = Dates.fmtDate(from), b = Dates.fmtDate(to);
    const ya = a.slice(-4), yb = b.slice(-4);
    return ya === yb ? a.slice(0, -6) + ' to ' + b : a + ' to ' + b;
  }
  function invoiceRows(inv) {
    const materials = (inv.items || []).map((it) => {
      const p = B.itemPrice(it, inv.markupPct);
      const supplier = typeof it.supplierName === 'string' ? it.supplierName.trim() : '';
      return { qtyText: unitText(it), desc: supplier || it.name.trim(), unitCents: p.unit, cents: p.cents };
    });
    const rentals = (inv.rentals || []).map((x) => ({
      qtyText: x.days ? qtyNum(x.days) + (x.days === 1 ? ' day' : ' days') : '', desc: x.name, unitCents: null, cents: B.rentalPrice(x, inv.markupPct),
    }));
    const equipment = (inv.equipment || []).map((x) => ({
      qtyText: qtyNum(x.days) + (x.days === 1 ? ' day' : ' days'), desc: x.name, unitCents: x.dayCents, cents: B.equipmentLine(x),
    }));
    const hours = billedHours(inv);
    const labor = hours > 0 ? [{
      qtyText: hoursText(hours),
      desc: inv.serviceFrom === inv.serviceTo ? 'Labor hours' : 'Labor hours, ' + rangeText(inv.serviceFrom, inv.serviceTo),
      unitCents: inv.rateCents, cents: laborCents(inv),
    }] : [];
    return { materials, rentals, equipment, labor };
  }

  return {
    AMBER_AFTER_DAYS, entryFrom, entryTo, isReady,
    groupEach, combineAll, pileAge, thisWeek,
    AMBER_AFTER_DAYS, group, canCombine, combine, split, pileHours, pileParts,
    draftInvoice, draftProjectInvoice, projectRemainingCents,
    billedHours, laborCents, totals, paidCents, balanceCents, statusOf,
    ageDays, isStale, whoOwes, invoiceRows, rangeText,
  };
});
