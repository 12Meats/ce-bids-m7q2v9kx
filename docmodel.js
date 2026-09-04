// docmodel.js — bid → document data model, three detail levels. UMD so
// node:test and the browser both load it. Pure: no DOM, no persistence.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bidmath.js'));
  else root.DocModel = factory(root.BidMath);
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

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

  // "a" or "an" for a single countable item. First letter only: the name is a
  // part number as often as it is a word, and guessing at spoken sound
  // ("an LB") would be a rule that only sometimes fires. A name starting with
  // a digit or a fraction takes "a", which is what "a 20 A breaker" reads as.
  function article(name) { return /^[aeiou]/i.test(name) ? 'an' : 'a'; }

  // The plural of a part name, for counts other than one. Deliberately narrow:
  // it only fires when the name ENDS IN A LETTER, so `LB 3/4"`, `J-box 4x4`
  // and anything ending in a quote, a digit or punctuation is printed exactly
  // as he catalogued it rather than growing an "s" in a strange place. Names
  // already plural ("3/4\" hubs", "Straps & supports") are left alone.
  function plural(name) {
    if (!/[A-Za-z]$/.test(name)) return name;
    if (/s$/i.test(name)) return name;
    if (/(ch|sh|x|z)$/i.test(name)) return name + 'es';
    if (/[^aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies';
    return name + 's';
  }

  // One item as a sentence fragment a customer can read. The verb comes off
  // the unit, because that is the only thing in the record that says whether
  // the part is a length or a count:
  //
  //   ft    -> "run 180 ft of 3/4\" rigid"
  //   ea    -> "furnish and install 4 emergency light fixtures"
  //            (a count of one takes an article: "furnish and install a VFD")
  //   other -> "furnish and install 1 lot of straps & supports"
  //            ("roll", "lot", "day" all read correctly with a plain "s")
  function scopePhrase(it) {
    const nm = scopeCase(it.name.trim());
    const qty = qtyNum(it.qty);
    if (it.unit === 'ft') return `run ${qty} ft of ${nm}`;
    if (it.unit === 'ea') {
      return it.qty === 1
        ? `furnish and install ${article(nm)} ${nm}`
        : `furnish and install ${qty} ${plural(nm)}`;
    }
    return `furnish and install ${qty} ${it.unit}${it.qty === 1 ? '' : 's'} of ${nm}`;
  }

  // One line per area from its items, e.g.
  // "Warehouse: run 180 ft of 3/4\" rigid; furnish and install 4 emergency
  // light fixtures". Items keep the order he walked them in.
  //
  // Only area items become scope. Misc ("supports, anchors, and hardware") and
  // rentals are money on the bid, not work described to the customer: a line
  // reading "furnish and install 1 lift rental" is not a scope of work, and
  // the lift is already on the priced document where it belongs.
  function draftScope(bid) {
    return (bid.areas || []).filter((a) => a.items && a.items.length).map((a) => (
      `${a.name.trim()}: ${a.items.map(scopePhrase).join('; ')}`
    ));
  }

  // Shared lookup used everywhere a bid's customer name is printed (document
  // meta, signature line, file name) so an orphaned customerId — a customer
  // deleted or never resolved — reads the same "Customer" placeholder
  // everywhere instead of silently diverging per call site.
  // A blank name is as unusable as a missing record — both read "Customer"
  // rather than printing "Accepted by ()". Whitespace counts as blank: a name
  // of "   " prints as nothing at all on the signature line.
  function customerOf(bid, data) {
    const c = data.customers.find((c) => c.id === bid.customerId);
    return { name: (c && c.name && c.name.trim()) || 'Customer', contact: (c && c.contact) || '' };
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

    // A change order's price is DERIVED here, not read off the record. It used
    // to be cached on co.priceCents and rewritten by the job screen's render,
    // which meant editing a change order's labor and then leaving by any route
    // that did not pass back through that screen printed the old price on the
    // customer's proposal. bidmath.changeOrderPrice is the one definition, and
    // the paper, the bids list and the job card all call it.
    const changeOrders = (bid.job && bid.job.changeOrders) || [];
    const coSections = changeOrders.map((co, i) => ({
      title: `Change order ${i + 1}: ${co.name}`,
      rows: [{ desc: co.name, qtyText: '', unitCents: null, cents: B.changeOrderPrice(co, bid, s) }],
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

    // Summary and Scope & price always carry a scope: with nothing of his own
    // written, the walk drafts one. Full is the exception — see below.
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
      // Full prints his past bids' tail: Subtotal, then the tax line, then the
      // total. The subtotal is the sum of the priced rows BEFORE the tax line,
      // which is the same number totalCents already holds — tax is always
      // folded into material pricing, so taxLine is 0 and no second sum is
      // worth keeping honest. Summary and Scope have no tax line, so they have
      // nothing for a subtotal to sit above either.
      subtotalCents: level === 'full' ? totalCents : null,
      taxLine: level === 'full' ? 0 : null,
      signatures: { left: `Accepted by (${cust})`, right: s.company.name, signName: s.company.signName },
    };

    if (level === 'full') {
      const sections = [
        // A labor-only bid, and a plant bid with no lift or equipment, shouldn't
        // print an empty section — neither line-item section is pushed with no rows.
        ...(materialRows.length ? [{ title: 'Materials', rows: materialRows }] : []),
        ...(equipRows.length ? [{ title: 'Equipment & rentals', rows: equipRows }] : []),
        { title: 'Labor', rows: laborRows },
        ...coSections,
      ];
      // Full prints a scope only when he wrote one. The line items already
      // describe the work, so there is no draft here: an auto-drafted
      // paragraph would say the same thing as the table directly under it.
      // What he types is different — it is the sentence the table can't say.
      return { ...baseDoc, sections, summary: null, scope: bid.scope && bid.scope.length ? bid.scope : null };
    }

    if (level === 'summary') {
      const summary = [
        // Materials keeps its row at $0.00 even with no material rows: the
        // three-category summary is the level's shape, not a list of sections.
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
