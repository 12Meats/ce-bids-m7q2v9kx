// invdoc.js — invoice → document, the way docmodel.js turns a bid into one.
// Pure. The renderer in docgen.js draws exactly this and nothing else, and
// the invoice screen's preview mirrors it row for row.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bidmath.js'), require('./invmath.js'), require('./dates.js'));
  else root.InvDoc = factory(root.BidMath, root.InvMath, root.Dates);
})(typeof self !== 'undefined' ? self : this, function (B, I, Dates) {
  'use strict';

  const FOOTER = 'Thank you for choosing Cantu Electric LLC. We appreciate your business';

  function customerOf(inv, data) { return (data.customers || []).find((c) => c.id === inv.customerId) || null; }

  function fileName(inv, data) {
    const cust = customerOf(inv, data);
    const name = B.fileNameSegment(cust && cust.name ? cust.name : 'Customer');
    const title = B.fileNameSegment(inv.projectTitle || '').slice(0, 80).replace(/[.\s]+$/, '');
    const num = inv.number === null ? 'draft' : String(inv.number);
    return ['CE Invoice ' + num, name, title].filter((s) => s !== '').join(' - ') + '.pdf';
  }

  function serviceText(inv) {
    if (inv.kind === 'project') return '';
    return inv.serviceFrom === inv.serviceTo
      ? 'Service date: ' + Dates.fmtDate(inv.serviceFrom)
      : 'Service dates: ' + I.rangeText(inv.serviceFrom, inv.serviceTo);
  }

  function build(inv, data) {
    const s = data.settings;
    const cust = customerOf(inv, data);
    const header = { ...s.company, logo: 'logo.png' };
    const address = cust && typeof cust.address === 'string' ? cust.address : '';
    const meta = {
      number: inv.number, dateISO: inv.dateISO,
      customer: (cust && cust.name && cust.name.trim()) || 'Customer',
      attn: (cust && typeof cust.attn === 'string') ? cust.attn.trim() : '',
      addressLines: address.split('\n').map((l) => l.trim()).filter((l) => l !== ''),
      po: inv.po || '', terms: inv.terms || '', rep: s.company.person || '',
      project: inv.projectTitle || '', serviceText: serviceText(inv),
    };
    let sections;
    if (inv.kind === 'project') {
      const bid = (data.bids || []).find((b) => b.id === inv.bidId);
      const label = (inv.projectTitle || 'Project') + (bid ? ', as proposed #' + bid.number : '');
      sections = [{ title: 'Project', rows: [{ qtyText: '', desc: label, unitCents: null, cents: I.totals(inv).total }] }];
    } else {
      const rows = I.invoiceRows(inv);
      sections = [
        ...(rows.materials.length ? [{ title: 'Materials', rows: rows.materials }] : []),
        ...((rows.rentals.length || rows.equipment.length) ? [{ title: 'Rentals and equipment', rows: rows.rentals.concat(rows.equipment) }] : []),
        ...(rows.labor.length ? [{ title: 'Labor', rows: rows.labor }] : []),
      ];
    }
    const t = I.totals(inv);
    return {
      kind: 'invoice', header, meta, sections,
      subtotalCents: t.subtotal, taxCents: 0, totalCents: t.total,
      notes: (inv.notes || []).slice(), footer: FOOTER, fileName: fileName(inv, data),
    };
  }

  return { build, fileName, FOOTER };
});
