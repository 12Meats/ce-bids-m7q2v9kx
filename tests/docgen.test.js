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

test('1 to 40 items: no section band is ever the last row on its page', () => {
  const bands = ['Materials', 'Equipment & rentals', 'Labor'];
  for (let n = 1; n <= 40; n += 1) {
    const doc = docFor(n, 'full', { rentals: true });
    const pdf = DocGen.render(doc, {});
    pageTexts(pdf).forEach((items, page) => {
      items.forEach((item) => {
        if (bands.indexOf(item.text) === -1) return;
        // The Labor section's one line item is also called "Labor". A band is
        // the only row with a single cell on its baseline; a line item always
        // has its cost beside it.
        if (items.filter((z) => Math.abs(z.y - item.y) < 0.5).length > 1) return;
        // Something has to follow the band on the same page. The page number
        // and the running head sit outside the body, so they don't count.
        const below = items.filter((z) => z.y > item.y + 1 && z.y <= BOTTOM);
        assert.ok(below.length > 0,
          n + ' items: band "' + item.text + '" is stranded at the foot of page ' + (page + 1));
      });
      // Same rule for the two rows the eye reads as one line.
      if (items.some((z) => z.text === 'Tax')) {
        assert.ok(items.some((z) => z.text === 'Total'),
          n + ' items: Tax is on page ' + (page + 1) + ' without its Total');
      }
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

test('a labor-only bid still has something above "Total price for the above"', () => {
  ['scope', 'summary'].forEach((level) => {
    const doc = docFor(0, level, { title: 'Two days of troubleshooting' });
    assert.strictEqual(doc.scope.length, 0, 'fixture should have no drafted scope');
    const text = allText(DocGen.render(doc, {}));
    assert.ok(text.indexOf('Scope of work') !== -1, level + ' dropped the scope heading');
    assert.ok(text.indexOf('Two days of troubleshooting') !== -1,
      level + ' does not fall back to the title for its scope');
  });
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
