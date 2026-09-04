// tests/docgen.test.js — the drawing half of docgen, rendered for real.
//
// hourcost.test.js covers the one function in docgen that does arithmetic.
// This file covers the other 600 lines: it loads the vendored jsPDF and
// autotable under Node, renders actual documents, and reads the text back out
// of the page content streams. That is worth the trouble because the bugs it
// guards against are not exceptions — they are documents that render perfectly
// and are wrong on paper: a section band stranded at the foot of a page with
// its line items on the next one, a price band with nothing above it, a
// continuation page with no name on it.
//
// jsPDF is a browser library, so two globals are shimmed: window, which is
// where docgen looks for jsPDF, and no fetch, which is the branch loadLogo
// already takes when there is no browser — the no-logo path the header falls
// back to.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const S = require('../storage.js');
const B = require('../bidmath.js');
const DM = require('../docmodel.js');

const jspdf = require(path.join(__dirname, '..', 'vendor', 'jspdf.umd.min.js'));
require(path.join(__dirname, '..', 'vendor', 'jspdf.plugin.autotable.min.js')).applyPlugin(jspdf.jsPDF);
global.window = { jspdf };
global.fetch = undefined;              // no browser, so loadLogo resolves null

const DocGen = require('../docgen.js');

const PAGE_H = 792;
const BOTTOM = PAGE_H - 56;

// ---------------------------------------------------------------------------
// Reading a rendered page back
// ---------------------------------------------------------------------------
// jsPDF keeps each page's content stream in internal.pages as plain, still
// uncompressed operators, so the text on a page can be read back without
// parsing a PDF: "x y Td" sets the pen, "(text) Tj" draws. y is flipped into
// the same top-down coordinates docgen draws in, which is what makes "is this
// band the last thing on its page" a question this file can ask.
function pageTexts(pdf) {
  const pages = pdf.internal.pages;
  const out = [];
  for (let i = 1; i < pages.length; i += 1) {
    const ops = (Array.isArray(pages[i]) ? pages[i].join('\n') : String(pages[i])).split('\n');
    const items = [];
    let y = 0;
    ops.forEach((op) => {
      const pen = op.match(/^(-?[\d.]+) (-?[\d.]+) (?:Td|TD)$/);
      if (pen) { y = PAGE_H - parseFloat(pen[2]); return; }
      const tj = op.match(/^\((.*)\) Tj$/);
      if (tj) items.push({ text: tj[1].replace(/\\([()\\])/g, '$1'), y });
    });
    out.push(items);
  }
  return out;
}

function allText(pdf) {
  return pageTexts(pdf).map((items) => items.map((i) => i.text).join('\n')).join('\n');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bidWith(items, extra) {
  const x = extra || {};
  const d = S.emptyData();
  d.settings.nextNumber = 4100;
  const b = S.newBid(d, {
    customerName: x.customerName || 'UDA Foods',
    title: x.title || 'Warehouse emergency lighting',
    jobType: 'service',
    dateISO: '2026-09-10',
  });
  if (items > 0) {
    b.areas.push({
      id: 'a1',
      name: 'Warehouse',
      items: Array.from({ length: items }, (_, i) => ({
        catalogId: null,
        name: 'Item ' + (i + 1),
        unit: 'ea',
        qty: i + 1,
        costCents: 1200 + i * 37,
        priceCents: null,
      })),
      photoIds: [],
    });
  }
  b.labor.days = 2;
  b.pricing.rateCents = 6500;
  if (x.rentals) b.rentals.push({ name: 'Lift rental', days: 1, cents: 44500, markup: false });
  if (x.clauses) b.clauseIds = d.settings.clauses.map((c) => c.id);
  d.bids.push(b);
  return { d, b };
}

function docFor(items, level, extra) {
  const { d, b } = bidWith(items, extra);
  return DM.build(b, d, level);
}

// ---------------------------------------------------------------------------

test('every level renders, and all three print the same total', () => {
  const totals = [];
  ['full', 'summary', 'scope'].forEach((level) => {
    const doc = docFor(6, level, { rentals: true });
    const pdf = DocGen.render(doc, {});
    assert.ok(pdf.internal.getNumberOfPages() >= 1, level + ' rendered no pages');
    // The model's total, formatted the one way money is ever formatted, has to
    // be on the paper at every level.
    const text = allText(pdf);
    assert.ok(text.indexOf(B.fmt(doc.totalCents)) !== -1,
      level + ' does not print its total ' + B.fmt(doc.totalCents));
    totals.push(B.fmt(doc.totalCents));
  });
  assert.strictEqual(totals[0], totals[1]);
  assert.strictEqual(totals[1], totals[2]);
});

// Which page each body row of the priced table landed on, straight from
// autoTable. "Is there text lower down the page" is too weak a question — the
// courtesy line and the signature block are also lower down the page, and they
// would answer yes for a band that had lost its line items to the next one.
// The only thing that settles it is where the NEXT ROW went.
//
// The last table autoTable draws is the real one; the pass before it is
// docgen's throwaway measuring pass, on a scratch document of its own.
// jsPDF copies jsPDF.API onto each instance as it is constructed, so the hook
// goes on API — patching a prototype would never reach the documents render()
// makes for itself.
function tableRows(doc) {
  const api = jspdf.jsPDF.API;
  const original = api.autoTable;
  const passes = [];
  api.autoTable = function patched(opts) {
    const rows = [];
    passes.push(rows);
    const userHook = opts.didDrawCell;
    opts.didDrawCell = (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const raw = data.cell.raw;
        rows[data.row.index] = {
          page: data.pageNumber,
          text: String(raw && raw.content != null ? raw.content : raw),
          // A section band is the one body row built from a single cell.
          band: Array.isArray(data.row.raw) && data.row.raw.length === 1,
        };
      }
      if (userHook) userHook(data);
    };
    return original.call(this, opts);
  };
  try { DocGen.render(doc, {}); } finally { api.autoTable = original; }
  return passes[passes.length - 1] || [];
}

// Scope is optional at Full and drafted at neither: what he typed is the only
// thing that can be there, and it has to be there ABOVE the price, the way it
// is on Summary. A heading drawn after the table would be a scope the customer
// reads once he has already seen the number.
test('full level with an explicit scope renders, and the scope lands above the line items', () => {
  const { d, b } = bidWith(6, {});
  b.scope = ['Replace the four bay fixtures on the north wall.'];
  const doc = DM.build(b, d, 'full');
  assert.deepStrictEqual(doc.scope, b.scope);

  let pdf = null;
  assert.doesNotThrow(() => { pdf = DocGen.render(doc, {}); });
  const first = pageTexts(pdf)[0].map((i) => i.text);
  const head = first.indexOf('Scope of work');
  assert.ok(head !== -1, 'the scope heading is not on the paper');
  assert.ok(first.some((t) => t.indexOf('Replace the four bay fixtures') !== -1),
    'the scope line is not on the paper');
  const table = first.indexOf('Description');
  assert.ok(table !== -1 && head < table, 'the scope printed under the line items');
});

test('1 to 40 items: no section band is ever the last row on its page', () => {
  for (let n = 1; n <= 40; n += 1) {
    const rows = tableRows(docFor(n, 'full', { rentals: true }));
    assert.ok(rows.length > 1, n + ' items: the priced table drew no rows');
    rows.forEach((row, i) => {
      if (!row.band && row.text !== 'Tax') return;
      const next = rows[i + 1];
      assert.ok(next, n + ' items: "' + row.text + '" is the last row in the table');
      assert.strictEqual(next.page, row.page,
        n + ' items: "' + row.text + '" is on page ' + row.page
          + ' and the row under it ("' + next.text + '") is on page ' + next.page);
    });
  }
});

test('a long bid runs to several pages, and every page after the first names the bid', () => {
  const doc = docFor(40, 'full', { rentals: true, clauses: true });
  const pdf = DocGen.render(doc, {});
  const pages = pageTexts(pdf);
  assert.ok(pages.length >= 3, 'expected a multi-page bid, got ' + pages.length);

  const running = pages.map((items) => items.filter((z) => z.text.indexOf('Bid #4100') === 0 && z.y < 40));
  assert.strictEqual(running[0].length, 0, 'page 1 carries the letterhead, not a running head');
  for (let i = 1; i < pages.length; i += 1) {
    assert.strictEqual(running[i].length, 1, 'page ' + (i + 1) + ' has no running head');
    assert.ok(running[i][0].text.indexOf('UDA Foods') !== -1, 'the running head omits the customer');
    assert.ok(running[i][0].text.indexOf('Cantu Electric') !== -1, 'the running head omits the company');
    // Body text on those pages clears the running head.
    pages[i].filter((z) => z.y >= 40 && z.y <= BOTTOM).forEach((z) => {
      assert.ok(z.y >= 48, 'page ' + (i + 1) + ' draws "' + z.text + '" under the running head');
    });
  }
});

test('a labor-only bid names the job once, and the band says what it is pricing', () => {
  const title = 'Two days of troubleshooting';
  ['scope', 'summary'].forEach((level) => {
    const doc = docFor(0, level, { title });
    assert.strictEqual(doc.scope.length, 0, 'fixture should have no drafted scope');
    const items = pageTexts(DocGen.render(doc, {}))[0];
    const text = items.map((z) => z.text).join('\n');
    // With no drafted scope there is no scope section: the title above the
    // price is the description, and printing it again as the lone bullet put
    // the same sentence on the page twice in a row.
    assert.strictEqual(text.indexOf('Scope of work'), -1,
      level + ' kept an empty scope heading');
    assert.strictEqual(items.filter((z) => z.text === title).length, 1,
      level + ' prints the job title twice');
  });

  const band = allText(DocGen.render(docFor(0, 'scope', { title }), {}));
  assert.ok(band.indexOf('Total price for the work described above') !== -1,
    'the band does not say what it is pricing');

  // A bid that does have a scope is untouched: heading, bullets, short label.
  const withScope = docFor(0, 'scope', { title });
  withScope.scope = ['Replace two failed ballasts', 'Test and label the panel'];
  const full = allText(DocGen.render(withScope, {}));
  assert.ok(full.indexOf('Scope of work') !== -1, 'a drafted scope lost its heading');
  assert.ok(full.indexOf('Replace two failed ballasts') !== -1, 'a drafted scope lost a bullet');
  assert.ok(full.indexOf('Total price for the above') !== -1, 'the short band label changed');
});

test('the courtesy line is punctuated the way he writes, with no em-dash', () => {
  const text = allText(DocGen.render(docFor(4, 'full'), {}));
  assert.strictEqual(text.indexOf('—'), -1, 'an em-dash reached the customer copy');
  assert.ok(text.indexOf('Questions? Call Andy at') !== -1,
    'the courtesy line does not invite the call the way he says it');
});

test('the signature block stays with its courtesy line at every body height', () => {
  for (let n = 6; n <= 18; n += 1) {
    const pdf = DocGen.render(docFor(n, 'full', { rentals: true }), {});
    const pages = pageTexts(pdf);
    let courtesy = -1;
    let signature = -1;
    pages.forEach((items, page) => {
      if (items.some((z) => z.text.indexOf('We appreciate the opportunity') === 0)) courtesy = page;
      if (items.some((z) => z.text === 'Signature / date')) signature = page;
    });
    assert.ok(courtesy !== -1, n + ' items: the courtesy line is missing');
    assert.ok(signature !== -1, n + ' items: the signature block is missing');
    assert.strictEqual(signature, courtesy,
      n + ' items: the signature block left its courtesy line behind on page ' + (courtesy + 1));
  }
});

test('a long customer name wraps instead of losing its tail', () => {
  const name = 'Kraft Foods Group Incorporated, Tolleson Dairy Plant';
  const doc = docFor(4, 'full', { customerName: name });
  const items = pageTexts(DocGen.render(doc, {}))[0];
  const cut = items.filter((z) => z.text.indexOf('...') !== -1);
  assert.deepStrictEqual(cut.map((z) => z.text), [], 'something on the page was ellipsized');
  // The name is on the page in full, across the two lines it needs.
  const joined = items.map((z) => z.text).join(' ');
  assert.ok(joined.indexOf(name) !== -1, 'the customer name is not printed in full');
  // And the signature caption keeps its closing paren.
  assert.ok(joined.indexOf('Accepted by (' + name + ')') !== -1,
    'the signature caption lost its closing paren');
});

test('the meta grid keeps its columns when a value is missing', () => {
  const doc = docFor(3, 'full');
  doc.meta.validThrough = null;
  const items = pageTexts(DocGen.render(doc, {}))[0];
  const at = (label) => items.find((z) => z.text === label);
  assert.ok(at('Bid for:') && at('Bid #:') && at('Date:'), 'a meta label went missing');
  assert.ok(!at('Valid through:'), 'an empty valid-through still printed its label');
  // The date stays on the second row of the left column, where it belongs — it
  // does not slide up into the slot beside "Bid for:".
  assert.ok(at('Date:').y > at('Bid for:').y, 'the meta grid shifted a cell into another row');
});

test('the hour-cost exhibit is one page', () => {
  const d = S.emptyData();
  const pdf = DocGen.hourCostPage(d.settings, 6500);
  assert.strictEqual(pdf.internal.getNumberOfPages(), 1);
  const text = allText(pdf);
  assert.ok(text.indexOf('Current rate: ' + B.fmt(6500)) !== -1, 'the current rate is not on the exhibit');
  assert.ok(text.indexOf(B.fmt(d.settings.rateCents)) !== -1, 'the proposed rate is not on the exhibit');
});

test('a bare document renders rather than throwing', () => {
  const pdf = DocGen.render({ level: 'full', header: {}, meta: {} }, {});
  assert.ok(pdf.internal.getNumberOfPages() >= 1);
  DocGen.render({ level: 'scope', header: {}, meta: {} }, {});
  DocGen.render({ level: 'summary', header: {}, meta: {} }, {});
  DocGen.render(undefined, undefined);
});

test('loadLogo gives up quietly with no browser to fetch from', async () => {
  assert.strictEqual(await DocGen.loadLogo(), null);
});
