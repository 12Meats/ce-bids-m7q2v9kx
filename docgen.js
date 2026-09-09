// docgen.js — the document model, on paper. Takes a DocModel document and
// draws it with jsPDF; nothing in here decides what a job costs. Every cents
// value printed comes off the model, and every one of them is formatted by
// BidMath.fmt, so a number on the customer's PDF and the same number on the
// owner's screen can never be two different opinions.
//
// The one exception is the hour-cost exhibit at the bottom of this file, which
// is a report about his own rate rather than a bid — it is allowed to do
// arithmetic, and that arithmetic lives in the one pure function
// hourCostRows() so it can be unit-tested in Node.
//
// UMD, for hourCostRows' sake: the browser gets a global DocGen, node:test
// gets the same object through require(). Everything that touches the DOM or
// jsPDF is inside a function, so loading this file in Node touches neither.
//
// Layout:  LOGO · UNITS & HELPERS · HEADER/META · BODY · TERMS/CLAUSES ·
//          SIGNATURES/FOOTER · RENDER · SHARE · HOUR COST
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bidmath.js'), require('./dates.js'));
  else root.DocGen = factory(root.BidMath, root.Dates);
})(typeof self !== 'undefined' ? self : this, function (B, D) {
  'use strict';

  // ---------------------------------------------------------------------------
  // UNITS & HELPERS
  // ---------------------------------------------------------------------------
  // Everything is in points, US Letter portrait, because that is what comes out
  // of a plant's printer. 612 x 792 with a 40 pt margin leaves a 532 pt column.

  const PAGE_W = 612;
  const PAGE_H = 792;
  const M = 40;
  const CONTENT_W = PAGE_W - M * 2;
  const BOTTOM = PAGE_H - 56;          // last y a line of body text may sit on
  const FOOTER_Y = PAGE_H - 26;
  // Page one opens with the letterhead; every page after it opens with a
  // one-line running head, so body text on those pages starts lower down.
  const TOP_NEXT = M + 14;

  const NAVY = [4, 30, 66];            // #041E42
  const BLACK = [0, 0, 0];
  const WHITE = [255, 255, 255];
  const INK = [17, 17, 17];
  const GRAY = [51, 65, 85];           // #334155
  const MUTED = [100, 116, 139];       // #64748b
  const SEC_FILL = [241, 245, 249];
  const TOTAL_FILL = [248, 250, 252];
  const HAIRLINE = [226, 232, 240];

  // The logo is sized to the height of the contact block beside it, not to a
  // round number: the wordmark under the mark is a twelfth of the image, and
  // at the 34 pt the design called for it printed as an illegible smudge under
  // the company's own name. 52 pt makes it read and squares off the header.
  const LOGO_H = 52;

  // jsPDF's built-in Helvetica is WinAnsi: it can print ¾, ·, — and • but has
  // no glyph at all for the arrows and math signs the app's own copy uses in
  // places. A missing glyph is not a visible error, it is a silently wrong
  // character in front of a customer, so every string on the page goes through
  // str(): the few we know about are spelled out, and anything else outside
  // WinAnsi becomes a question mark rather than a surprise.
  const CHAR_FIX = {
    '→': '->', '←': '<-', '↔': '<->', '⇒': '=>',
    '≈': '~', '≠': '!=', '≤': '<=', '≥': '>=',
    ' ': ' ', '✓': '', '✗': '', '­': '',
  };
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹Œ'
    + 'Ž‘’“”•–—˜™š›œžŸ';

  function str(x) {
    let s = String(x === null || x === undefined ? '' : x);
    s = s.replace(/[←-⇿∀-⋿ ­✓✗]/g,
      (c) => (Object.prototype.hasOwnProperty.call(CHAR_FIX, c) ? CHAR_FIX[c] : ' '));
    return s.replace(/[^\x20-\xff]/g, (c) => (WINANSI_EXTRA.indexOf(c) !== -1 ? c : '?'));
  }

  // The ONE place cents become dollars on paper — the same function the screen
  // uses. Nothing here adds, multiplies or rounds a cents value.
  function money(cents) { return B.fmt(cents); }

  function dateText(iso) { return D && D.fmtDate ? D.fmtDate(iso) : ''; }

  // Navy everywhere, unless the company is set to the plain style, in which
  // case every accent on the page is black — one switch, read once per draw.
  function accentOf(doc) { return (doc && doc.header && doc.header.plainStyle) ? BLACK : NAVY; }

  function setFont(pdf, size, style, color) {
    pdf.setFont('helvetica', style || 'normal');
    pdf.setFontSize(size);
    const c = color || INK;
    pdf.setTextColor(c[0], c[1], c[2]);
  }

  function setDraw(pdf, color, width) {
    pdf.setDrawColor(color[0], color[1], color[2]);
    pdf.setLineWidth(width);
  }

  // Text is measured with whatever font jsPDF last had set, which is not
  // always the font the text is about to be drawn in — measure a 10 pt bullet
  // in 8.5 pt type and it wraps a line short, or long enough to run off the
  // paper. Every measurement below names the font it is measuring in.
  function useFont(pdf, size, style) {
    if (size == null) return;
    pdf.setFont('helvetica', style || 'normal');
    pdf.setFontSize(size);
  }

  // Wraps to a column. splitTextToSize handles the spaces; the second pass
  // handles what it can't — a part number or a URL longer than the column,
  // which would otherwise run off the edge of the paper.
  function wrap(pdf, text, width, size, style) {
    useFont(pdf, size, style);
    const src = pdf.splitTextToSize(str(text), width) || [];
    const out = [];
    src.forEach((line) => {
      if (line.length < 2 || pdf.getTextWidth(line) <= width) { out.push(line); return; }
      let cur = '';
      for (let i = 0; i < line.length; i += 1) {
        const next = cur + line.charAt(i);
        if (cur && pdf.getTextWidth(next) > width) { out.push(cur); cur = line.charAt(i); } else cur = next;
      }
      if (cur) out.push(cur);
    });
    return out.length ? out : [''];
  }

  // One line that must not overflow its cell.
  function fit(pdf, text, width, size, style) {
    useFont(pdf, size, style);
    let s = str(text);
    if (pdf.getTextWidth(s) <= width) return s;
    while (s.length > 1 && pdf.getTextWidth(s + '...') > width) s = s.slice(0, -1);
    return s + '...';
  }

  // Two lines, and only then an ellipsis: the customer's own name and the line
  // he signs on are the two things on the page he checks first, and a name cut
  // off at "Kraft Foods Group, Tolles..." is the one that gets queried.
  function wrapTwo(pdf, text, width, size, style) {
    const lines = wrap(pdf, text, width, size, style);
    if (lines.length <= 2) return lines;
    return [lines[0], fit(pdf, lines.slice(1).join(' '), width, size, style)];
  }

  // The drawing cursor. Screens of text are drawn top-down; need(h) is how
  // every block asks whether it still fits before it starts.
  function newCtx(pdf) { return { pdf, y: M }; }
  function need(ctx, h) {
    if (ctx.y + h <= BOTTOM) return false;
    ctx.pdf.addPage();
    ctx.y = TOP_NEXT;
    return true;
  }

  // ---------------------------------------------------------------------------
  // LOGO
  // ---------------------------------------------------------------------------
  // Fetched once per session and kept as a data URL — jsPDF wants bytes, not a
  // URL, and the service worker precaches logo.png so this works with the phone
  // in a plant basement. A failed load costs the picture, never the document:
  // render() falls back to the company name set in type.

  let logoPromise = null;

  function loadLogo() {
    if (logoPromise) return logoPromise;
    if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(null);
    logoPromise = (async () => {
      const res = await fetch('logo.png');
      if (!res.ok) throw new Error('logo ' + res.status);
      const bytes = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error || new Error('logo unreadable'));
        fr.readAsDataURL(bytes);
      });
      const size = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
      if (!size || !size.w || !size.h) throw new Error('logo has no size');
      return { dataUrl, w: size.w, h: size.h };
    })().catch((err) => {
      console.error('Could not load the logo for the PDF', err);
      logoPromise = null;   // a network blip must not poison every later document
      return null;
    });
    return logoPromise;
  }

  // ---------------------------------------------------------------------------
  // HEADER & META
  // ---------------------------------------------------------------------------

  function drawHeader(ctx, doc, logo) {
    const pdf = ctx.pdf;
    const h = doc.header || {};
    const accent = accentOf(doc);
    const right = PAGE_W - M;

    let logoBottom = M;
    if (logo && logo.dataUrl && logo.w && logo.h) {
      const w = LOGO_H * (logo.w / logo.h);
      pdf.addImage(logo.dataUrl, 'PNG', M, M, w, LOGO_H);
      logoBottom = M + LOGO_H;
    } else {
      setFont(pdf, 13, 'bold', accent);
      pdf.text(fit(pdf, h.name, CONTENT_W * 0.5, 13, 'bold'), M, M + 12);
      logoBottom = M + 16;
    }

    const lines = [
      { t: h.person, bold: true },
      { t: [h.phone, h.email].map(str).filter((x) => x.trim() !== '').join('  ·  ') },
      { t: h.address },
      { t: h.roc },
      { t: h.tagline },
    ].filter((l) => str(l.t).trim() !== '');

    let y = M + 8;
    lines.forEach((l) => {
      setFont(pdf, 8.5, l.bold ? 'bold' : 'normal', l.bold ? accent : GRAY);
      pdf.text(fit(pdf, l.t, CONTENT_W * 0.62, 8.5, l.bold ? 'bold' : 'normal'), right, y, { align: 'right' });
      y += 10.5;
    });

    const ruleY = Math.max(logoBottom, y - 4) + 8;
    setDraw(pdf, accent, 2.5);
    pdf.line(M, ruleY, right, ruleY);
    ctx.y = ruleY + 18;
  }

  // Two columns of label/value. The grid reads "Bid for:" / "Bid #:" at every
  // level — the file name docmodel hands out is always "CE Bid <n> - …", and a
  // document whose header and file name disagree is the one that gets queried.
  function drawMeta(ctx, doc) {
    const pdf = ctx.pdf;
    const meta = doc.meta || {};
    // Explicit [left, right] rows rather than one list paired by index: a bid
    // with no valid-through date has to leave that slot empty, not slide the
    // date up into the column beside it and re-label everything below.
    const rows = [
      [['Bid for:', meta.customer], ['Bid #:', meta.number]],
      [['Date:', dateText(meta.dateISO)], ['Valid through:', dateText(meta.validThrough)]],
    ];

    const colW = CONTENT_W / 2;
    const xs = [M, M + colW];
    let y = ctx.y;
    rows.forEach((row) => {
      if (row.every((c) => str(c[1]).trim() === '')) return;
      let tall = 1;
      row.forEach((c, i) => {
        if (str(c[1]).trim() === '') return;
        setFont(pdf, 8.5, 'normal', MUTED);
        pdf.text(str(c[0]), xs[i], y);
        const lw = pdf.getTextWidth(str(c[0])) + 5;
        const value = wrapTwo(pdf, c[1], colW - lw - 10, 9, 'bold');
        setFont(pdf, 9, 'bold', INK);
        value.forEach((line, k) => pdf.text(line, xs[i] + lw, y + k * 11));
        tall = Math.max(tall, value.length);
      });
      y += 13 + (tall - 1) * 11;
    });
    ctx.y = y + 7;
  }

  function drawTitle(ctx, doc) {
    const pdf = ctx.pdf;
    const title = str((doc.meta || {}).title).trim();
    if (title === '') return;
    setFont(pdf, 14, 'bold', accentOf(doc));
    wrap(pdf, title, CONTENT_W, 14, 'bold').forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 17; });
    ctx.y += 6;
  }

  // ---------------------------------------------------------------------------
  // BODY
  // ---------------------------------------------------------------------------

  // A heading reserves room for the first line of what follows it as well as
  // for itself. A heading alone at the foot of a page is a promise the page
  // does not keep, and on a two-line section it reads as a missing section.
  function heading(ctx, doc, text, size, nextH) {
    const pdf = ctx.pdf;
    const s = size || 10.5;
    need(ctx, s + 5 + (nextH == null ? 14 : nextH));
    setFont(pdf, s, 'bold', accentOf(doc));
    pdf.text(str(text), M, ctx.y);
    ctx.y += s + 5;
  }

  function drawBullets(ctx, items, size) {
    const pdf = ctx.pdf;
    const indent = 12;
    const step = size + 3.5;
    (items || []).forEach((item) => {
      const text = str(item).trim();
      if (text === '') return;
      const lines = wrap(pdf, text, CONTENT_W - indent, size, 'normal');
      // The whole bullet is reserved, not the first line or two of it: an
      // exclusion broken across a page break is read as two half-sentences,
      // and the half on the next page has no bullet in front of it. A single
      // bullet taller than a page is not a case worth handling.
      need(ctx, lines.length * step);
      setFont(pdf, size, 'normal', INK);
      pdf.text('•', M + 2, ctx.y);
      lines.forEach((line) => {
        pdf.text(line, M + indent, ctx.y);
        ctx.y += step;
      });
      ctx.y += 2.5;
    });
    ctx.y += 6;
  }

  // Shared table setup. autoTable owns the page breaks inside a table (and
  // repeats the head), so nothing here has to; theme 'plain' plus a hand-drawn
  // hairline under each row is the mockup's look, and does not depend on which
  // border options this version of the plugin happens to accept.
  //
  // topRuleRow is the body row that gets the heavy accent rule above it (the
  // Total). It is drawn from the row's LAST cell so it lands on top of the
  // fills of the cells to its left, which are painted after the first one.
  // The options both passes of a table are built from: the pass that is
  // measured, and the pass that is drawn.
  function tableOpts(accent, head, body, columnStyles, startY) {
    return {
      startY,
      margin: { left: M, right: M, top: TOP_NEXT, bottom: PAGE_H - BOTTOM },
      head: [head],
      body,
      theme: 'plain',
      // A row that does not fit moves to the next page whole. Half a line item
      // above the fold and half below it is not a line item anyone can read.
      rowPageBreak: 'avoid',
      styles: {
        font: 'helvetica', fontSize: 9.5, textColor: INK, overflow: 'linebreak',
        cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
      },
      headStyles: { fillColor: accent, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5 },
      columnStyles,
    };
  }

  // autoTable decides where a page breaks from the height of the row in front
  // of it and has no notion of keeping one row with the next. So the table is
  // laid out twice: once on a throwaway document, purely to learn how tall
  // every row comes out, and then for real with those heights in hand.
  // The accent is handed in rather than assumed: the measuring pass has to be
  // built from the same options as the drawing pass, or the heights it hands
  // back are heights of a table nobody is going to print.
  function measureRows(accent, head, body, columnStyles) {
    const heights = [];
    const scratch = newPdf();
    const opts = tableOpts(accent, head, body, columnStyles, M);
    opts.willDrawCell = (data) => {
      if (data.section === 'body') heights[data.row.index] = data.row.height;
    };
    scratch.autoTable(opts);
    return heights;
  }

  // keepWith lists the body rows that must not be the last row on a page: a
  // section band ("Labor") stranded from its first line item reads as a
  // section with nothing in it, and Subtotal or Tax without the row under it
  // reads as the end of the bid.
  function table(ctx, doc, head, body, columnStyles, topRuleRow, keepWith) {
    const pdf = ctx.pdf;
    const accent = accentOf(doc);
    const keep = (keepWith || []).filter((i) => i >= 0 && i < body.length - 1);
    const heights = keep.length ? measureRows(accent, head, body, columnStyles) : null;
    // A RUN of held rows binds as one block, not as a chain of pairs: Subtotal
    // holds Tax and Tax holds Total, so Subtotal's claim has to cover all
    // three or the page can still break under it. heldHeight returns the
    // height of the whole run starting at i (0 when the row is not held).
    const heldHeight = (i) => {
      if (!heights || keep.indexOf(i) === -1 || !heights[i]) return 0;
      let total = heights[i];
      let j = i;
      for (;;) {
        if (!heights[j + 1]) return 0;
        total += heights[j + 1];
        if (keep.indexOf(j + 1) === -1) return total;
        j += 1;
      }
    };
    const held = (i) => heldHeight(i) > 0;
    const opts = tableOpts(accent, head, body, columnStyles, ctx.y);

    // Claim the next row's height as well, so autoTable's own does-this-fit
    // test is answered for the pair and it breaks the page BEFORE the band.
    opts.didParseCell = (data) => {
      if (data.section !== 'body' || !held(data.row.index)) return;
      data.cell.styles.minCellHeight = heldHeight(data.row.index);
    };
    // The claim was for that test only. Give the row its own height back before
    // a fill, a rule or a line of text is drawn from it.
    opts.willDrawCell = (data) => {
      if (data.section !== 'body' || !held(data.row.index)) return;
      data.cell.styles.minCellHeight = 0;
      data.cell.height = heights[data.row.index];
      data.row.height = heights[data.row.index];
    };
    opts.didDrawCell = (data) => {
      if (data.section !== 'body') return;
      const cell = data.cell;
      setDraw(pdf, HAIRLINE, 0.5);
      pdf.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      const last = data.column.index === data.table.columns.length - 1;
      if (topRuleRow != null && data.row.index === topRuleRow && last) {
        setDraw(pdf, accent, 1.5);
        pdf.line(M, cell.y, PAGE_W - M, cell.y);
      }
    };
    pdf.autoTable(opts);
    ctx.y = pdf.lastAutoTable.finalY + 16;
  }

  // Full detail — his UDA format. One table, a styled band per section, then
  // the tail his past bids print: a Subtotal, the $0.00 tax line the plant's
  // accounts payable expects to see, and the total.
  function drawFull(ctx, doc) {
    // Optional here, and only ever his own words (DocModel drafts no scope at
    // this level). It sits above the table for the same reason it does on
    // Summary: the sentence that says what the job is comes before the money.
    drawScopeList(ctx, doc);
    const accent = accentOf(doc);
    const body = [];
    const keepWith = [];
    (doc.sections || []).forEach((sec) => {
      keepWith.push(body.length);
      body.push([{
        content: str(sec.title), colSpan: 4,
        styles: { fillColor: SEC_FILL, textColor: accent, fontStyle: 'bold' },
      }]);
      (sec.rows || []).forEach((r) => body.push([
        str(r.desc),
        str(r.qtyText),
        r.unitCents == null ? '' : money(r.unitCents),
        money(r.cents),
      ]));
    });
    if (doc.taxLine === 0) {
      if (doc.subtotalCents != null) {
        keepWith.push(body.length);
        body.push([{ content: 'Subtotal', colSpan: 3, styles: { halign: 'right' } }, money(doc.subtotalCents)]);
      }
      keepWith.push(body.length);
      body.push([{ content: 'Tax', colSpan: 3, styles: { halign: 'right' } }, money(0)]);
    }
    body.push([
      { content: 'Total', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
      { content: money(doc.totalCents), styles: { fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
    ]);
    table(ctx, doc, ['Description', 'Qty', 'Unit', 'Cost'], body, {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 72 },
      2: { halign: 'right', cellWidth: 72 },
      3: { halign: 'right', cellWidth: 84 },
    }, body.length - 1, keepWith);
  }

  // Summary — the shape of the price without the parts list.
  function drawSummary(ctx, doc) {
    drawScopeList(ctx, doc);
    const body = (doc.summary || []).map((s) => [str(s.label), money(s.cents)]);
    body.push([
      { content: 'Total', styles: { fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
      { content: money(doc.totalCents), styles: { fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
    ]);
    table(ctx, doc, ['Summary', 'Cost'], body, {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 120 },
    }, body.length - 1);
  }

  function scopeOf(doc) { return (doc.scope || []).filter((s) => str(s).trim() !== ''); }

  // A labor-only bid drafts no scope. Repeating the job's own title as its one
  // bullet printed the title twice in a row, an inch apart, so the section is
  // left out altogether: the title above the price is the description, and the
  // band under it says so in its own words.
  function drawScopeList(ctx, doc) {
    const scope = scopeOf(doc);
    if (!scope.length) return;
    heading(ctx, doc, 'Scope of work', 10.5, 13.5);
    drawBullets(ctx, scope, 10);
  }

  // Scope & price — the price is the price, in a band you cannot skim past.
  function drawScope(ctx, doc) {
    const pdf = ctx.pdf;
    drawScopeList(ctx, doc);
    const bandH = 36;
    need(ctx, bandH + 10);
    const accent = accentOf(doc);
    pdf.setFillColor(accent[0], accent[1], accent[2]);
    pdf.rect(M, ctx.y, CONTENT_W, bandH, 'F');
    setFont(pdf, 11, 'bold', WHITE);
    const label = scopeOf(doc).length ? 'Total price for the above' : 'Total price for the work described above';
    pdf.text(label, M + 14, ctx.y + bandH / 2 + 4);
    setFont(pdf, 16, 'bold', WHITE);
    pdf.text(money(doc.totalCents), PAGE_W - M - 14, ctx.y + bandH / 2 + 5.5, { align: 'right' });
    ctx.y += bandH + 18;
  }

  // ---------------------------------------------------------------------------
  // TERMS, COURTESY & CLAUSES
  // ---------------------------------------------------------------------------

  function drawTerms(ctx, doc) {
    const terms = (doc.terms || []).filter((t) => str(t).trim() !== '');
    if (!terms.length) return;
    heading(ctx, doc, termsHeading(doc), 10.5, 13);
    drawBullets(ctx, terms, 9.5);
  }

  // Straight off his own bids, in his own words — and punctuated the way he
  // writes: a question mark, not a dash.
  //
  // Exported as text, unwrapped, because the proposal screen's preview prints
  // the same sentence: a preview that promises a courtesy line the paper
  // doesn't carry (or the other way round) is the one thing that screen is
  // built not to do. '' means the level has no courtesy line at all.
  function courtesyText(doc) {
    if (!doc || doc.level === 'scope') return '';
    const h = doc.header || {};
    // First name only — "call Andy at", the way he says it on the phone.
    const who = str(h.person).trim().split(/\s+/)[0] || '';
    const phone = str(h.phone).trim();
    let text = 'We appreciate the opportunity to earn your business and look forward to working with you.';
    if (phone) text += ' Questions? Call ' + (who || 'us') + ' at ' + phone + '.';
    return text;
  }

  function courtesyLines(pdf, doc) {
    const text = courtesyText(doc);
    return text ? wrap(pdf, text, CONTENT_W, 9.5, 'normal') : [];
  }

  // The heading over doc.terms. Scope & price calls them Terms because that is
  // all the paper has; the other two levels have a Terms and conditions
  // addendum behind them, so these are Notes & exclusions and nothing else.
  function termsHeading(doc) { return doc && doc.level === 'scope' ? 'Terms' : 'Notes & exclusions'; }

  // The addendum, on its own page — the way his signed proposals are put
  // together: page one is what he is quoting and where it gets signed, the
  // terms follow behind it.
  function drawClauses(ctx, doc) {
    const clauses = doc.clauses || [];
    if (!clauses.length) return;
    const pdf = ctx.pdf;
    pdf.addPage();
    ctx.y = TOP_NEXT;
    heading(ctx, doc, 'Terms and conditions', 12, 12);
    ctx.y += 2;

    clauses.forEach((c, i) => {
      const title = (i + 1) + '. ' + str(c && c.title).trim();
      const text = str(c && c.text).trim();
      const titleLines = wrap(pdf, title, CONTENT_W, 9.5, 'bold');
      // Keep a heading with at least the first line of its clause.
      need(ctx, titleLines.length * 12 + 11);
      setFont(pdf, 9.5, 'bold', accentOf(doc));
      titleLines.forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 12; });
      ctx.y += 1;
      setFont(pdf, 8.5, 'normal', INK);
      wrap(pdf, text, CONTENT_W, 8.5, 'normal').forEach((line) => {
        need(ctx, 11);
        pdf.text(line, M, ctx.y);
        ctx.y += 11;
      });
      ctx.y += 8;
    });
  }

  // ---------------------------------------------------------------------------
  // SIGNATURES & FOOTER
  // ---------------------------------------------------------------------------

  // Never split across a page: a signature rule alone at the top of page two,
  // with nothing above it, is how a proposal comes back unsigned.
  //
  // The plan is measured before anything is drawn, and what it asks the page
  // for is what it actually puts on it — the caption under the rule is the
  // last ink in the block, so its baseline is the height that has to fit. The
  // fixed 90 pt this used to reserve was 37 pt of room the block never used,
  // which is a whole block pushed onto a page of its own for nothing.
  function signaturePlan(pdf, doc) {
    const sig = doc.signatures || {};
    const gap = 34;
    const colW = (CONTENT_W - gap) / 2;
    // "Accepted by (Kraft Foods Group, Tolleson Plant)" wraps to a second line
    // rather than losing its closing paren to an ellipsis. Both columns are
    // set from the taller caption, so the two rules stay level with each other.
    const caps = [
      wrapTwo(pdf, str(sig.left), colW, 9, 'normal'),
      wrapTwo(pdf, str(sig.right), colW, 9, 'normal'),
    ];
    const extra = (Math.max(caps[0].length, caps[1].length) - 1) * 11;
    return {
      caps, colW, extra,
      xs: [M, M + colW + gap],
      under: ['Signature / date', str(sig.signName)],
      height: 8 + 34 + extra + 11,     // top offset, rule drop, caption baseline
    };
  }

  function drawSignatures(ctx, doc, plan) {
    const pdf = ctx.pdf;
    const top = ctx.y + 8;
    const ruleY = top + 34 + plan.extra;
    plan.caps.forEach((lines, i) => {
      setFont(pdf, 9, 'normal', INK);
      lines.forEach((line, k) => pdf.text(line, plan.xs[i], top + k * 11));
      setDraw(pdf, INK, 0.7);
      pdf.line(plan.xs[i], ruleY, plan.xs[i] + plan.colW * 0.92, ruleY);
      setFont(pdf, 8.5, 'normal', MUTED);
      pdf.text(fit(pdf, plan.under[i], plan.colW, 8.5, 'normal'), plan.xs[i], ruleY + 11);
    });
    ctx.y = ruleY + 22;
  }

  // The courtesy line and the signature block are one thing, not two: the line
  // is what introduces the block, and a break between them leaves the customer
  // a bare rule at the top of a page with no sentence in front of it. Measured
  // together, and if the pair does not fit, the page breaks BEFORE the line.
  function drawSignOff(ctx, doc) {
    const pdf = ctx.pdf;
    const lines = courtesyLines(pdf, doc);
    const plan = signaturePlan(pdf, doc);
    need(ctx, lines.length * 13 + (lines.length ? 10 : 0) + plan.height);
    if (lines.length) {
      setFont(pdf, 9.5, 'normal', INK);
      lines.forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 13; });
      ctx.y += 10;
    }
    drawSignatures(ctx, doc, plan);
  }

  // Page one carries the letterhead. Every page after it carries a running
  // head as well as its number, because a continuation page that gets
  // separated from the stack on a plant manager's desk has to be able to say
  // whose bid it belongs to; "Page 2 of 3" cannot.
  function drawFooters(pdf, doc) {
    const n = pdf.internal.getNumberOfPages();
    const meta = (doc && doc.meta) || {};
    const numberLabel = (doc && doc.kind === 'invoice') ? 'Invoice #' : 'Bid #';
    const parts = [
      str(meta.number).trim() === '' ? '' : numberLabel + str(meta.number).trim(),
      str(meta.customer).trim(),
      str(((doc || {}).header || {}).name).trim(),
    ].filter((x) => x !== '');
    const running = parts.join('  ·  ');
    for (let i = 1; i <= n; i += 1) {
      pdf.setPage(i);
      setFont(pdf, 8, 'normal', MUTED);
      pdf.text('Page ' + i + ' of ' + n, PAGE_W - M, FOOTER_Y, { align: 'right' });
      if (i > 1 && running !== '') {
        setFont(pdf, 8.5, 'normal', MUTED);
        pdf.text(fit(pdf, running, CONTENT_W, 8.5, 'normal'), M, M - 12);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INVOICE
  // ---------------------------------------------------------------------------
  // His paper, read off six real UDA invoices (9/07): the proposal's header,
  // an Invoice box (Date / Invoice #), ONE Bill To with Attn and the address,
  // a strip of P.O. Number / Terms / Rep / Project (the PO cell drops out
  // when there is none), a four-column table (Quantity · Description ·
  // Price ea. · Amount) with a band per section, the service date as a plain
  // line under the table (his was red; nothing on this paper is red), then
  // Subtotal / Tax $0.00 / Total and the sentence he has always printed.
  //
  // The header's own contact block (person, phone · email, address, ROC,
  // tagline — five lines on his real letterhead) sits top-right, exactly
  // where an Invoice box drawn at the header's own top would land, so the
  // box is drawn BELOW the header rule instead, flush right, rather than
  // overlapping his name and phone number.

  function drawInvoiceBox(ctx, doc) {
    const pdf = ctx.pdf;
    const w = 150, h = 34, x = PAGE_W - M - w, y = ctx.boxY;
    setDraw(pdf, INK, 0.8);
    pdf.rect(x, y, w, h);
    pdf.line(x, y + 12, x + w, y + 12);
    pdf.line(x + w / 2, y + 12, x + w / 2, y + h);
    setFont(pdf, 9, 'bold', INK);
    pdf.text('Invoice', x + w / 2, y + 9, { align: 'center' });
    setFont(pdf, 7.5, 'normal', MUTED);
    pdf.text('Date', x + w / 4, y + 20, { align: 'center' });
    pdf.text('Invoice #', x + 3 * w / 4, y + 20, { align: 'center' });
    setFont(pdf, 9, 'bold', INK);
    pdf.text(str(dateText(doc.meta.dateISO)), x + w / 4, y + 30, { align: 'center' });
    pdf.text(doc.meta.number === null ? 'draft' : String(doc.meta.number), x + 3 * w / 4, y + 30, { align: 'center' });
  }

  function drawBillTo(ctx, doc) {
    const pdf = ctx.pdf;
    const m = doc.meta;
    const lines = [m.customer].concat(m.attn ? ['Attn: ' + m.attn] : []).concat(m.addressLines || []);
    const w = 220, lineH = 11, h = 14 + lines.length * lineH + 4;
    need(ctx, h + 14);
    setDraw(pdf, INK, 0.8);
    pdf.rect(M, ctx.y, w, h);
    setFont(pdf, 7.5, 'bold', INK);
    pdf.text('Bill To', M + 5, ctx.y + 9);
    pdf.line(M, ctx.y + 12, M + w, ctx.y + 12);
    setFont(pdf, 9, 'normal', INK);
    lines.forEach((t, i) => pdf.text(fit(pdf, str(t), w - 10, 9, 'normal'), M + 5, ctx.y + 23 + i * lineH));
    ctx.y += h + 12;
  }

  function drawStrip(ctx, doc) {
    const pdf = ctx.pdf;
    const m = doc.meta;
    const cells = (m.po ? [['P.O. Number', m.po]] : []).concat([['Terms', m.terms], ['Rep', m.rep], ['Project', m.project]]);
    const fixed = 96, projW = CONTENT_W - fixed * (cells.length - 1);
    const widths = cells.map((c, i) => (i === cells.length - 1 ? projW : fixed));
    const h = 26;
    need(ctx, h + 8);
    let x = M;
    setDraw(pdf, INK, 0.8);
    pdf.rect(M, ctx.y, CONTENT_W, h);
    cells.forEach((c, i) => {
      if (i > 0) pdf.line(x, ctx.y, x, ctx.y + h);
      setFont(pdf, 7.5, 'bold', MUTED);
      pdf.text(str(c[0]), x + 4, ctx.y + 9);
      setFont(pdf, 9, 'bold', INK);
      pdf.text(fit(pdf, str(c[1]), widths[i] - 8, 9, 'bold'), x + 4, ctx.y + 20);
      x += widths[i];
    });
    ctx.y += h;   // the table starts flush under the strip, like his sheet
  }

  function drawInvoiceTable(ctx, doc) {
    const accent = accentOf(doc);
    const body = [];
    const keepWith = [];
    (doc.sections || []).forEach((sec) => {
      keepWith.push(body.length);
      body.push([{ content: str(sec.title), colSpan: 4, styles: { fillColor: SEC_FILL, textColor: accent, fontStyle: 'bold' } }]);
      sec.rows.forEach((r) => body.push([str(r.qtyText), str(r.desc), r.unitCents == null ? '' : money(r.unitCents), money(r.cents)]));
    });
    if (doc.meta.serviceText) {
      body.push([{ content: str(doc.meta.serviceText), colSpan: 4, styles: { fontStyle: 'italic', textColor: MUTED } }]);
    }
    keepWith.push(body.length);
    body.push([{ content: 'Subtotal', colSpan: 3, styles: { halign: 'right' } }, money(doc.subtotalCents)]);
    keepWith.push(body.length);
    body.push([{ content: 'Tax', colSpan: 3, styles: { halign: 'right' } }, money(doc.taxCents)]);
    body.push([
      { content: 'Total', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
      { content: money(doc.totalCents), styles: { fontStyle: 'bold', fontSize: 11, fillColor: TOTAL_FILL } },
    ]);
    table(ctx, doc, ['Quantity', 'Description', 'Price ea.', 'Amount'], body, {
      0: { halign: 'center', cellWidth: 70 }, 1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 72 }, 3: { halign: 'right', cellWidth: 84 },
    }, body.length - 1, keepWith);
  }

  function drawInvoiceTail(ctx, doc) {
    const pdf = ctx.pdf;
    if (doc.notes && doc.notes.length) { ctx.y += 4; drawBullets(ctx, doc.notes, 9); }
    need(ctx, 30);
    setFont(pdf, 10, 'bold', INK);
    wrap(pdf, doc.footer, CONTENT_W, 10, 'bold').forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 13; });
  }

  // render(doc, opts) for an invoice. Same shell as render() above (header,
  // logo fallback, footers) with the invoice's own body in between.
  function renderInvoice(doc, opts) {
    const d = doc || {};
    const pdf = newPdf();
    const ctx = newCtx(pdf);
    drawHeader(ctx, d, (opts || {}).logo);
    // Below the rule, not at the header's own top: see the note above.
    ctx.boxY = ctx.y;
    ctx.y += 40;
    drawInvoiceBox(ctx, d);
    drawBillTo(ctx, d);
    drawStrip(ctx, d);
    drawInvoiceTable(ctx, d);
    drawInvoiceTail(ctx, d);
    drawFooters(pdf, d);
    return pdf;
  }

  async function blobInvoice(doc) {
    const logo = await loadLogo();
    return renderInvoice(doc, { logo }).output('blob');
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  function jsPDFCtor() {
    const ns = (typeof window !== 'undefined' && window.jspdf) || null;
    if (!ns || !ns.jsPDF) throw new Error('jsPDF is not loaded');
    return ns.jsPDF;
  }

  function newPdf() {
    const JsPDF = jsPDFCtor();
    const pdf = new JsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
    if (typeof pdf.autoTable !== 'function') throw new Error('jspdf-autotable is not loaded');
    return pdf;
  }

  // render(doc, opts) -> jsPDF. opts.logo is the {dataUrl, w, h} loadLogo()
  // hands back; without it the header falls back to the company name in type,
  // so a document is never blocked on a picture.
  function render(doc, opts) {
    const d = doc || {};
    const pdf = newPdf();
    const ctx = newCtx(pdf);

    drawHeader(ctx, d, (opts || {}).logo);
    drawMeta(ctx, d);
    drawTitle(ctx, d);

    if (d.level === 'full') drawFull(ctx, d);
    else if (d.level === 'summary') drawSummary(ctx, d);
    else drawScope(ctx, d);

    drawTerms(ctx, d);
    drawSignOff(ctx, d);
    drawClauses(ctx, d);
    drawFooters(pdf, d);
    return pdf;
  }

  // ---------------------------------------------------------------------------
  // SHARE
  // ---------------------------------------------------------------------------

  async function blob(doc) {
    const logo = await loadLogo();
    return render(doc, { logo }).output('blob');
  }

  // The share sheet on the phone (Mail, Messages, Files), a download in a
  // desktop browser. Backing out of the sheet is 'cancelled', not a failure —
  // the caller must not then also download the file behind his back.
  //
  // CALL THIS FROM INSIDE A TAP. navigator.share needs the transient user
  // activation a click gives it; called from a timer or after an await that
  // spent the activation, Chrome neither resolves nor rejects it and this
  // promise hangs forever, which on screen is a Send button that never comes
  // back. Build the blob first, then share it in the handler.
  async function share(pdfBlob, fileName) {
    const name = str(fileName) || 'proposal.pdf';
    const file = new File([pdfBlob], name, { type: 'application/pdf' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(pdfBlob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return 'downloaded';
  }

  // ---------------------------------------------------------------------------
  // HOUR COST
  // ---------------------------------------------------------------------------
  // "What an hour of Cantu Electric costs" — the page he puts in front of a
  // plant that wants to know why the rate went up. Not a bid: no logo bars, no
  // signature block, plain black on white, dated.
  //
  // This is the ONE function in this file allowed to do money arithmetic, and
  // it is pure so it can be tested. Consumables are a percentage of a material
  // job, not of an hour, so the page has to pick a job to be a percentage of:
  // a $2,000 material job over a 32-hour week, stated on the page as an
  // assumption rather than hidden inside the number.

  const CONSUMABLES_JOB_CENTS = 200000;   // a typical $2,000 material job
  const CONSUMABLES_JOB_HOURS = 32;

  // What he charges today cannot change what the hour costs, so the current
  // rate is not an argument here at all: it is the page's other headline
  // number, and hourCostPage prints it beside this function's answer.
  function hourCostRows(settings) {
    const s = settings || {};
    const r = Math.round;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

    const crew = (s.crew || []).filter((c) => c && !c.hidden);
    const wage = crew.length ? r(crew.reduce((t, c) => t + num(c.wageCents), 0) / crew.length) : 0;
    const burden = r(wage * num(s.burdenPct) / 100);
    const hpd = num(s.hoursPerDay) > 0 ? num(s.hoursPerDay) : 8;
    const truck = r(num(s.truckDayCents) / hpd);
    const consumables = r(CONSUMABLES_JOB_CENTS * num(s.consumablesPct) / 100 / CONSUMABLES_JOB_HOURS);
    const overhead = r((wage + burden + truck + consumables) * num(s.overheadPct) / 100);
    const subtotal = wage + burden + truck + consumables + overhead;
    // Margin is a share OF THE PRICE, not a markup on the cost — the same
    // definition BidMath.solve uses, so this page and the price screen agree.
    const m = Math.min(num(s.marginPct), 99.9) / 100;
    const rate = r(subtotal / (1 - m));

    // Every row carries a stable `key`. The labels are wording, and wording is
    // the thing most likely to be reworded; a caller that finds its number by
    // reading 'Subtotal' off the front of a label breaks silently the day that
    // label reads 'Cost per hour' instead.
    return [
      { key: 'wage', label: 'Wage', cents: wage, note: crew.length > 1 ? 'average of ' + crew.length + ' men on the payroll' : 'hourly wage' },
      { key: 'burden', label: 'Payroll taxes & comp', cents: burden, note: num(s.burdenPct) + '% of the wage' },
      { key: 'truck', label: 'Truck & fuel', cents: truck, note: money(num(s.truckDayCents)) + ' a day, spread over ' + hpd + ' working hours' },
      { key: 'consumables', label: 'Consumables & small tools', cents: consumables, note: num(s.consumablesPct) + '% of a $2,000 material job, over 32 hours' },
      { key: 'overhead', label: 'Overhead', cents: overhead, note: num(s.overheadPct) + '% of the four lines above' },
      { key: 'subtotal', label: 'Subtotal (cost per hour)', cents: subtotal, note: 'what the hour costs before any profit' },
      { key: 'profit', label: 'Fair profit', cents: rate - subtotal, note: num(s.marginPct) + '% margin' },
      { key: 'rate', label: 'Rate', cents: rate, note: 'what the hour has to bill at' },
    ];
  }

  // hourCostPage(settings, currentRateCents) — the exhibit.
  //
  // currentRateCents is the rate THEY PAY HIM TODAY, typed on the way in; it
  // is the only number on the page that does not come out of the settings, and
  // it is there to sit beside the one number the whole page exists to produce:
  // the Rate row, what an hour has to bill to carry its own costs. The footer
  // prints exactly those two. It used to print settings.rateCents as well,
  // under the word "Proposed", which was the rate field on the bid screen and
  // had nothing to do with this page's arithmetic — so a page whose own body
  // said $77.01 finished by proposing $65.00, and the argument was lost in
  // the footer.
  function hourCostPage(settings, currentRateCents) {
    const pdf = newPdf();
    const rows = hourCostRows(settings);
    // Off the settings, not hard-coded: the shop's name is his to change, and
    // an exhibit with the wrong name on it is not an exhibit.
    const company = str(((settings || {}).company || {}).name).trim() || 'this shop';
    let y = M + 6;

    setFont(pdf, 16, 'bold', BLACK);
    pdf.text(fit(pdf, 'What an hour of ' + company.replace(/\s+LLC\.?$/i, '') + ' costs', CONTENT_W, 16, 'bold'), M, y);
    y += 18;
    setFont(pdf, 9, 'normal', MUTED);
    pdf.text(fit(pdf, company + '  ·  ' + dateText(todayISO()), CONTENT_W, 9, 'normal'), M, y);
    y += 10;
    setDraw(pdf, BLACK, 1.5);
    pdf.line(M, y, PAGE_W - M, y);
    y += 22;

    setFont(pdf, 10, 'normal', INK);
    wrap(pdf, 'Every line below is a cost the hour has to carry before anyone is paid for '
      + 'their trouble. The numbers come out of the settings this shop actually runs on.', CONTENT_W, 10, 'normal')
      .forEach((line) => { pdf.text(line, M, y); y += 13; });
    y += 12;

    const amountX = PAGE_W - M;
    rows.forEach((row) => {
      const heavy = row.key === 'rate' || row.key === 'subtotal';
      if (heavy) {
        setDraw(pdf, BLACK, row.key === 'rate' ? 1.2 : 0.8);
        pdf.line(M, y - 12, amountX, y - 12);
      }
      setFont(pdf, heavy ? 11 : 10, heavy ? 'bold' : 'normal', INK);
      pdf.text(fit(pdf, row.label, CONTENT_W - 130, heavy ? 11 : 10, heavy ? 'bold' : 'normal'), M, y);
      pdf.text(money(row.cents), amountX, y, { align: 'right' });
      y += 12;
      if (row.note) {
        setFont(pdf, 8, 'normal', MUTED);
        pdf.text(fit(pdf, row.note, CONTENT_W - 130, 8, 'normal'), M, y);
        y += 8;
      }
      y += 10;
    });

    y += 10;
    setDraw(pdf, BLACK, 0.8);
    pdf.line(M, y, PAGE_W - M, y);
    y += 18;
    setFont(pdf, 11, 'bold', INK);
    const cur = money(currentRateCents);
    const needed = money((rows.find((x) => x.key === 'rate') || {}).cents);
    pdf.text('Current rate: ' + cur + '  ·  What an hour has to bill: ' + needed, M, y);
    y += 20;

    setFont(pdf, 8.5, 'normal', MUTED);
    wrap(pdf, 'Consumables and small tools are figured as ' + ((settings || {}).consumablesPct || 0)
      + '% of a typical $2,000 material job spread over 32 hours. Overhead is the shop’s own '
      + 'percentage on the lines above it. "Fair profit" is margin on the price, not markup on the cost.',
    CONTENT_W, 8.5, 'normal').forEach((line) => { pdf.text(line, M, y); y += 11; });

    drawFooters(pdf);
    return pdf;
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  return { render, blob, share, loadLogo, hourCostPage, hourCostRows, courtesyText, termsHeading, renderInvoice, blobInvoice };
});
