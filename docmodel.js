// docmodel.js — bid → document data model, three detail levels. UMD so
// node:test and the browser both load it. Pure: no DOM, no persistence.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bidmath.js'));
  else root.DocModel = factory(root.BidMath);
})(typeof self !== 'undefined' ? self : this, function (B) {
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // Adds n days to a YYYY-MM-DD date string, composing the result from local
  // getFullYear/getMonth/getDate (not toISOString, which is UTC) — mirrors
  // Store.mondayOf. Returns null for anything that isn't a valid date.
  function addDays(iso, n) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const dt = new Date(iso + 'T12:00:00');
    if (isNaN(dt.getTime())) return null;
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  // Formats an item's quantity for a document row: "1 ea" prints as "1";
  // whole-number quantities print without a decimal (String(180) is "180",
  // never "180.0"); fractional quantities print as typed (e.g. "2.5 days").
  function qtyNum(qty) { return String(qty); }
  function unitText(it) {
    if (it.qty === 1 && it.unit === 'ea') return '1';
    return `${qtyNum(it.qty)} ${it.unit}`;
  }

  // Lower-cases only the first character of a name, and only when that first
  // character is an uppercase letter followed by a lowercase letter — so
  // "Emergency light fixtures" -> "emergency light fixtures", but "LED high
  // bay" and "VFD" (all-caps or non-letter leads) are left alone.
  function scopeCase(name) {
    if (/^[A-Z][a-z]/.test(name)) return name.charAt(0).toLowerCase() + name.slice(1);
    return name;
  }

  // One line per area from its items, e.g.
  // "Warehouse: 180 ft 3/4\" rigid; 4 emergency light fixtures".
  function draftScope(bid) {
    return (bid.areas || []).filter((a) => a.items && a.items.length).map((a) => {
      const parts = a.items.map((it) => {
        const nm = scopeCase(it.name);
        return it.unit === 'ea' ? `${qtyNum(it.qty)} ${nm}` : `${qtyNum(it.qty)} ${it.unit} ${nm}`;
      });
      return `${a.name}: ${parts.join('; ')}`;
    });
  }

  function fileName(bid, data) {
    const cust = (data.customers.find((c) => c.id === bid.customerId) || { name: 'Customer' }).name;
    const clean = (t) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `CE Bid ${bid.number} - ${clean(cust)} - ${clean(bid.title)}.pdf`;
  }

  function build(bid, data, level) {
    const s = data.settings;
    const cust = data.customers.find((c) => c.id === bid.customerId) || { name: '', contact: '' };
    const stack = B.costStack(bid, s);
    const rate = bid.pricing.rateCents;
    const laborCents = stack.bidHours * rate;
    const markup = bid.pricing.markupPct != null ? bid.pricing.markupPct : s.markupPct;

    // Materials: one row per item (qty × unit price, override respected —
    // same rounding as bidmath.materialPrice, per line), plus a misc row
    // when there's a misc cost.
    const materialRows = bid.areas.flatMap((a) => (a.items || []).map((it) => {
      const unit = it.priceCents != null ? it.priceCents : B.unitPrice(it.costCents, markup);
      return { desc: it.name, qtyText: unitText(it), unitCents: unit, cents: Math.round(it.qty * unit) };
    }));
    if (bid.misc && bid.misc.cents > 0) {
      materialRows.push({ desc: bid.misc.label, qtyText: '', unitCents: null, cents: bid.misc.cents });
    }

    // Equipment & rentals: rentals (marked up per-bid-markup when flagged,
    // same rule as bidmath.costStack's rentalsPrice) then equipment
    // (rounded per line, same as bidmath's equipmentCost).
    const equipRows = [
      ...(bid.rentals || []).map((x) => ({
        desc: x.name,
        qtyText: x.days ? `${qtyNum(x.days)} day${x.days === 1 ? '' : 's'}` : '',
        unitCents: null,
        cents: x.markup ? B.unitPrice(x.cents, markup) : x.cents,
      })),
      ...(bid.equipment || []).map((x) => ({
        desc: x.name,
        qtyText: `${qtyNum(x.days)} day${x.days === 1 ? '' : 's'}`,
        unitCents: x.dayCents,
        cents: Math.round(x.days * x.dayCents),
      })),
    ];

    const laborRows = [{ desc: 'Labor', qtyText: `${stack.bidHours} hrs`, unitCents: rate, cents: laborCents }];

    const sum = (rows) => rows.reduce((t, r) => t + r.cents, 0);

    const changeOrders = (bid.job && bid.job.changeOrders) || [];
    const coSections = changeOrders.map((co, i) => ({
      title: `Change order ${i + 1} — ${co.name}`,
      rows: [{ desc: co.name, qtyText: '', unitCents: null, cents: co.priceCents }],
    }));

    const totalCents = sum(materialRows) + sum(equipRows) + laborCents + sum(coSections.flatMap((x) => x.rows));

    const header = { ...s.company, logo: 'logo.png' };
    const meta = {
      number: bid.number, dateISO: bid.dateISO, validThrough: addDays(bid.dateISO, bid.validityDays),
      customer: cust.name, contact: cust.contact, title: bid.title, detail: level,
    };

    const scope = bid.scope && bid.scope.length ? bid.scope : draftScope(bid);

    const terms = [
      `Pricing held ${bid.validityDays} days from the date above.`,
      ...bid.notes,
      ...(level === 'scope' ? ['Changes to scope priced by written change order before work proceeds.'] : []),
    ];

    // Hidden clauses (soft-deleted in Settings) are excluded even when a bid
    // still references their id.
    const clauses = (bid.clauseIds || [])
      .map((id) => s.clauses.find((c) => c.id === id))
      .filter((c) => c && !c.hidden);

    const baseDoc = {
      level, header, meta, notes: bid.notes, terms, clauses, totalCents, fileName: fileName(bid, data),
      taxLine: level === 'full' ? 0 : null,
      signatures: { left: `Accepted by (${cust.name || 'Customer'})`, right: s.company.name, signName: s.company.signName },
    };

    if (level === 'full') {
      const sections = [
        { title: 'Materials', rows: materialRows },
        // A plant bid with no lift or equipment shouldn't print an empty section.
        ...(equipRows.length ? [{ title: 'Equipment & rentals', rows: equipRows }] : []),
        { title: 'Labor', rows: laborRows },
        ...coSections,
      ];
      return { ...baseDoc, sections, summary: null, scope: null };
    }

    if (level === 'summary') {
      const summary = [
        { label: 'Materials', cents: sum(materialRows) },
        { label: 'Equipment & rentals', cents: sum(equipRows) },
        { label: `Labor (${stack.bidHours} hrs)`, cents: laborCents },
        ...coSections.map((c) => ({ label: c.title, cents: sum(c.rows) })),
      ];
      return { ...baseDoc, sections: null, scope, summary };
    }

    return { ...baseDoc, sections: null, summary: null, scope };
  }

  return { build, fileName, addDays, draftScope };
});
