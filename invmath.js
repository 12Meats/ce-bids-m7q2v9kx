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
    groups.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    return groups;
  }

  function canCombine(groups, i) {
    const a = groups[i], b = groups[i + 1];
    return !!(a && b && a.customerId === b.customerId && a.projectId === b.projectId);
  }
  // Combine groups[i] with the next one when they are the same job: the
  // catch-up case. Returns the SAME array when they are not, so a caller can
  // test identity rather than re-deriving the rule.
  function combine(groups, i) {
    if (!canCombine(groups, i)) return groups;
    const a = groups[i], b = groups[i + 1];
    const merged = { ...a, key: a.key + '+' + b.key, entries: a.entries.concat(b.entries),
      from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
    return groups.slice(0, i).concat([merged], groups.slice(i + 2));
  }
  function split(groups, i) {
    const g = groups[i];
    if (!g || g.entries.length < 2) return groups;
    const parts = g.entries.map((e) => ({ ...g, key: g.key + '#' + e.id, entries: [e], from: e.dateISO, to: e.dateISO }));
    return groups.slice(0, i).concat(parts, groups.slice(i + 1));
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
    const labor = Array.from(byCrew.entries()).map(([crewId, hours]) => ({
      crewId, name: crewName(data, crewId), loggedHours: hours, billedHours: hours,
    }));
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
    const remaining = projectRemainingCents(bid, data, invoices || []);
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
  function statusOf(inv) {
    if (totals(inv).total > 0 && paidCents(inv) >= totals(inv).total) return 'paid';
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
  function qtyNum(q) { return String(Math.round(q * 1000) / 1000); }
  function unitText(it) { return it.qty === 1 && it.unit === 'ea' ? '1' : qtyNum(it.qty) + ' ' + it.unit; }
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
    const hours = (inv.labor || []).reduce((s, l) => s + l.billedHours, 0);
    const labor = hours > 0 ? [{
      qtyText: hoursText(hours),
      desc: inv.serviceFrom === inv.serviceTo ? 'Labor hours' : 'Labor hours, ' + rangeText(inv.serviceFrom, inv.serviceTo),
      unitCents: inv.rateCents, cents: laborCents(inv),
    }] : [];
    return { materials, rentals, equipment, labor };
  }

  return {
    AMBER_AFTER_DAYS, group, canCombine, combine, split,
    draftInvoice, draftProjectInvoice, projectRemainingCents,
    laborCents, totals, paidCents, balanceCents, statusOf,
    ageDays, isStale, whoOwes, invoiceRows, rangeText,
  };
});
