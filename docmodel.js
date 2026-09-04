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

  // Formats a quantity for a document row: "1 ea" prints as "1"; whole
  // numbers print without a decimal; fractional quantities round to 3
  // decimal places so float noise (0.1 + 0.2 style) never leaks into print.
  function qtyNum(q) { return String(Math.round(q * 1000) / 1000); }
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
        const nm = scopeCase(it.name.trim());
        return it.unit === 'ea' ? `${qtyNum(it.qty)} ${nm}` : `${qtyNum(it.qty)} ${it.unit} ${nm}`;
      });
      return `${a.name.trim()}: ${parts.join('; ')}`;
    });
  }

  // Shared lookup used everywhere a bid's customer name is printed (document
  // meta, signature line, file name) so an orphaned customerId — a customer
  // deleted or never resolved — reads the same "Customer" placeholder
  // everywhere instead of silently diverging per call site.
  // A blank name is as unusable as a missing record — both read "Customer"
  // rather than printing "Accepted by ()".
  function customerOf(bid, data) {
    const c = data.customers.find((c) => c.id === bid.customerId);
    return { name: (c && c.name) || 'Customer', contact: (c && c.contact) || '' };
  }
  function customerName(bid, data) { return customerOf(bid, data).name; }

  function fileName(bid, data) {
    const clean = (t) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const cust = clean(customerName(bid, data));
    const title = clean(bid.title || '').slice(0, 80).replace(/[.\s]+$/, '');
    const segments = [`CE Bid ${bid.number}`, cust, title].filter((s) => s !== '');
    return `${segments.join(' - ')}.pdf`;
  }

  function build(bid, data, level) {
    const s = data.settings;
    const { name: cust, contact: custContact } = customerOf(bid, data);
    const stack = B.costStack(bid, s);
    const rate = bid.pricing.rateCents;
    const laborCents = stack.bidHours * rate;
    const markup = B.resolveMarkup(bid, s);

    // Materials: one row per item (qty × unit price, override respected —
    // computed with bidmath.itemPrice, the same primitive costStack's
    // materialPrice uses), plus a misc row when there's a misc cost.
    const materialRows = (bid.areas || []).flatMap((a) => (a.items || []).map((it) => {
      const { unit, cents } = B.itemPrice(it, markup);
      return { desc: it.name.trim(), qtyText: unitText(it), unitCents: unit, cents };
    }));
    if (bid.misc && bid.misc.cents > 0) {
      materialRows.push({ desc: bid.misc.label, qtyText: '', unitCents: null, cents: bid.misc.cents });
    }

    // Equipment & rentals: rentals (bidmath.rentalPrice — marked up per-bid
    // markup when flagged) then equipment (bidmath.equipmentLine — rounded
    // per line), same primitives costStack's rentalsPrice/equipmentCost use.
    const equipRows = [
      ...(bid.rentals || []).map((x) => ({
        desc: x.name,
        qtyText: x.days ? `${qtyNum(x.days)} day${x.days === 1 ? '' : 's'}` : '',
        unitCents: null,
        cents: B.rentalPrice(x, markup),
      })),
      ...(bid.equipment || []).map((x) => ({
        desc: x.name,
        qtyText: `${qtyNum(x.days)} day${x.days === 1 ? '' : 's'}`,
        unitCents: x.dayCents,
        cents: B.equipmentLine(x),
      })),
    ];

    const laborRows = [{ desc: 'Labor', qtyText: `${stack.bidHours} hrs`, unitCents: rate, cents: laborCents }];

    const sum = (rows) => rows.reduce((t, r) => t + r.cents, 0);

    const changeOrders = (bid.job && bid.job.changeOrders) || [];
    const coSections = changeOrders.map((co, i) => ({
      title: `Change order ${i + 1}: ${co.name}`,
      rows: [{ desc: co.name, qtyText: '', unitCents: null, cents: co.priceCents }],
    }));

    // Change orders are part of the document total but not of solve()'s base
    // price; the price screen shows solve(), the home list and documents
    // show this total.
    const totalCents = sum(materialRows) + sum(equipRows) + laborCents + sum(coSections.flatMap((x) => x.rows));

    const header = { ...s.company, logo: 'logo.png' };
    const meta = {
      number: bid.number, dateISO: bid.dateISO, validThrough: addDays(bid.dateISO, bid.validityDays),
      customer: cust, contact: custContact, title: bid.title, detail: level,
    };

    const scope = bid.scope && bid.scope.length ? bid.scope : draftScope(bid);

    const terms = [
      `Pricing held ${bid.validityDays} days from the date above.`,
      s.taxMode === 'included'
        ? 'Estimated material taxes are included in the prices above.'
        : 'Sales tax on materials will be added to the invoice.',
      ...(bid.notes || []),
      ...(level === 'scope' ? ['Changes to scope priced by written change order before work proceeds.'] : []),
    ];

    // Hidden clauses (soft-deleted in Settings) are excluded even when a bid
    // still references their id.
    const clauses = (bid.clauseIds || [])
      .map((id) => s.clauses.find((c) => c.id === id))
      .filter((c) => c && !c.hidden);

    const baseDoc = {
      level, header, meta, terms, clauses, totalCents, fileName: fileName(bid, data),
      taxLine: level === 'full' ? 0 : null,
      signatures: { left: `Accepted by (${cust})`, right: s.company.name, signName: s.company.signName },
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
        // Mirror the Full-level omission: no $0.00 Equipment & rentals row
        // when the bid has neither rentals nor equipment.
        ...(equipRows.length ? [{ label: 'Equipment & rentals', cents: sum(equipRows) }] : []),
        { label: `Labor (${stack.bidHours} hrs)`, cents: laborCents },
        ...coSections.map((c) => ({ label: c.title, cents: sum(c.rows) })),
      ];
      return { ...baseDoc, sections: null, scope, summary };
    }

    return { ...baseDoc, sections: null, summary: null, scope };
  }

  return { build, fileName, addDays, draftScope };
});
