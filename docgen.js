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

  // Wraps to a column. splitTextToSize handles the spaces; the second pass
  // handles what it can't — a part number or a URL longer than the column,
  // which would otherwise run off the edge of the paper.
  function wrap(pdf, text, width) {
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

  // One line that must not overflow its cell — a customer name in the meta
  // grid, a caption under a signature rule.
  function fit(pdf, text, width) {
    let s = str(text);
    if (pdf.getTextWidth(s) <= width) return s;
    while (s.length > 1 && pdf.getTextWidth(s + '...') > width) s = s.slice(0, -1);
    return s + '...';
  }

  // The drawing cursor. Screens of text are drawn top-down; need(h) is how
  // every block asks whether it still fits before it starts.
  function newCtx(pdf) { return { pdf, y: M }; }
  function need(ctx, h) {
    if (ctx.y + h <= BOTTOM) return false;
    ctx.pdf.addPage();
    ctx.y = M;
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
      pdf.text(fit(pdf, h.name, CONTENT_W * 0.5), M, M + 12);
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
      pdf.text(fit(pdf, l.t, CONTENT_W * 0.62), right, y, { align: 'right' });
      y += 10.5;
    });

    const ruleY = Math.max(logoBottom, y - 4) + 8;
    setDraw(pdf, accent, 2.5);
    pdf.line(M, ruleY, right, ruleY);
    ctx.y = ruleY + 18;
  }

  // Two columns of label/value. On a Scope & price document the word is
  // "Proposal", not "Bid" — a fixed-price proposal that calls itself a bid
  // invites the line-item questions the level exists to avoid.
  function drawMeta(ctx, doc) {
    const pdf = ctx.pdf;
    const meta = doc.meta || {};
    const word = doc.level === 'scope' ? 'Proposal' : 'Bid';
    const cells = [
      [word + ' for:', meta.customer],
      [word + ' #:', meta.number],
      ['Date:', dateText(meta.dateISO)],
      ['Valid through:', dateText(meta.validThrough)],
    ].filter((c) => str(c[1]).trim() !== '');

    const colW = CONTENT_W / 2;
    const xs = [M, M + colW];
    let y = ctx.y;
    cells.forEach((c, i) => {
      if (i > 0 && i % 2 === 0) y += 13;
      const x = xs[i % 2];
      setFont(pdf, 8.5, 'normal', MUTED);
      pdf.text(str(c[0]), x, y);
      const lw = pdf.getTextWidth(str(c[0])) + 5;
      setFont(pdf, 9, 'bold', INK);
      pdf.text(fit(pdf, c[1], colW - lw - 10), x + lw, y);
    });
    ctx.y = y + 20;
  }

  function drawTitle(ctx, doc) {
    const pdf = ctx.pdf;
    const title = str((doc.meta || {}).title).trim();
    if (title === '') return;
    setFont(pdf, 14, 'bold', accentOf(doc));
    wrap(pdf, title, CONTENT_W).forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 17; });
    ctx.y += 6;
  }

  // ---------------------------------------------------------------------------
  // BODY
  // ---------------------------------------------------------------------------

  function heading(ctx, doc, text, size) {
    const pdf = ctx.pdf;
    need(ctx, (size || 10.5) + 8);
    setFont(pdf, size || 10.5, 'bold', accentOf(doc));
    pdf.text(str(text), M, ctx.y);
    ctx.y += (size || 10.5) + 5;
  }

  function drawBullets(ctx, items, size) {
    const pdf = ctx.pdf;
    const indent = 12;
    const step = size + 3.5;
    (items || []).forEach((item) => {
      const text = str(item).trim();
      if (text === '') return;
      const lines = wrap(pdf, text, CONTENT_W - indent);
      need(ctx, Math.min(lines.length, 2) * step);
      setFont(pdf, size, 'normal', INK);
      pdf.text('•', M + 2, ctx.y);
      lines.forEach((line, i) => {
        if (i > 0) need(ctx, step);
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
  function table(ctx, doc, head, body, columnStyles, topRuleRow) {
    const pdf = ctx.pdf;
    const accent = accentOf(doc);
    pdf.autoTable({
      startY: ctx.y,
      margin: { left: M, right: M, top: M, bottom: PAGE_H - BOTTOM },
      head: [head],
      body,
      theme: 'plain',
      styles: {
        font: 'helvetica', fontSize: 9.5, textColor: INK, overflow: 'linebreak',
        cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
      },
      headStyles: { fillColor: accent, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5 },
      columnStyles,
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const cell = data.cell;
        setDraw(pdf, HAIRLINE, 0.5);
        pdf.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
        const last = data.column.index === data.table.columns.length - 1;
        if (topRuleRow != null && data.row.index === topRuleRow && last) {
          setDraw(pdf, accent, 1.5);
          pdf.line(M, cell.y, PAGE_W - M, cell.y);
        }
      },
    });
    ctx.y = pdf.lastAutoTable.finalY + 16;
  }

  // Full detail — his UDA format. One table, a styled band per section, the
  // $0.00 tax line the plant's accounts payable expects to see, then the total.
  function drawFull(ctx, doc) {
    const accent = accentOf(doc);
    const body = [];
    (doc.sections || []).forEach((sec) => {
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
    }, body.length - 1);
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

  function drawScopeList(ctx, doc) {
    const scope = (doc.scope || []).filter((s) => str(s).trim() !== '');
    if (!scope.length) return;
    heading(ctx, doc, 'Scope of work');
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
    pdf.text('Total price for the above', M + 14, ctx.y + bandH / 2 + 4);
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
    heading(ctx, doc, doc.level === 'scope' ? 'Terms' : 'Notes & exclusions');
    drawBullets(ctx, terms, 9.5);
  }

  // Straight off his own bids, in his own words.
  function drawCourtesy(ctx, doc) {
    if (doc.level === 'scope') return;
    const h = doc.header || {};
    const who = str(h.person).trim();
    const phone = str(h.phone).trim();
    let text = 'We appreciate the opportunity to earn your business and look forward to working with you.';
    if (who && phone) text += ' Questions — call ' + who + ' at ' + phone + '.';
    else if (phone) text += ' Questions — call ' + phone + '.';
    const pdf = ctx.pdf;
    const lines = wrap(pdf, text, CONTENT_W);
    need(ctx, lines.length * 13);
    setFont(pdf, 9.5, 'normal', INK);
    lines.forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 13; });
    ctx.y += 10;
  }

  // The addendum, on its own page — the way his signed proposals are put
  // together: page one is what he is quoting and where it gets signed, the
  // terms follow behind it.
  function drawClauses(ctx, doc) {
    const clauses = doc.clauses || [];
    if (!clauses.length) return;
    const pdf = ctx.pdf;
    pdf.addPage();
    ctx.y = M;
    heading(ctx, doc, 'Terms and conditions', 12);
    ctx.y += 2;

    clauses.forEach((c, i) => {
      const title = (i + 1) + '. ' + str(c && c.title).trim();
      const text = str(c && c.text).trim();
      const titleLines = wrap(pdf, title, CONTENT_W);
      // Keep a heading with at least the first line of its clause.
      need(ctx, titleLines.length * 12 + 11);
      setFont(pdf, 9.5, 'bold', accentOf(doc));
      titleLines.forEach((line) => { pdf.text(line, M, ctx.y); ctx.y += 12; });
      ctx.y += 1;
      setFont(pdf, 8.5, 'normal', INK);
      wrap(pdf, text, CONTENT_W).forEach((line) => {
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
  function drawSignatures(ctx, doc) {
    const pdf = ctx.pdf;
    const sig = doc.signatures || {};
    need(ctx, 90);
    const gap = 34;
    const colW = (CONTENT_W - gap) / 2;
    const xs = [M, M + colW + gap];
    const caps = [str(sig.left), str(sig.right)];
    const under = ['Signature / date', str(sig.signName)];
    const top = ctx.y + 8;
    caps.forEach((cap, i) => {
      setFont(pdf, 9, 'normal', INK);
      pdf.text(fit(pdf, cap, colW), xs[i], top);
      setDraw(pdf, INK, 0.7);
      pdf.line(xs[i], top + 34, xs[i] + colW * 0.92, top + 34);
      setFont(pdf, 8.5, 'normal', MUTED);
      pdf.text(fit(pdf, under[i], colW), xs[i], top + 45);
    });
    ctx.y = top + 56;
  }

  function drawFooters(pdf) {
    const n = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= n; i += 1) {
      pdf.setPage(i);
      setFont(pdf, 8, 'normal', MUTED);
      pdf.text('Page ' + i + ' of ' + n, PAGE_W - M, FOOTER_Y, { align: 'right' });
    }
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
    drawCourtesy(ctx, d);
    drawSignatures(ctx, d);
    drawClauses(ctx, d);
    drawFooters(pdf);
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

  // currentRateCents is not part of the arithmetic — what he charges today
  // cannot change what the hour costs. It is named here only because it is the
  // page's other headline number, and the page reads both off one call site.
  function hourCostRows(settings, currentRateCents) {   // eslint-disable-line no-unused-vars
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

    return [
      { label: 'Wage', cents: wage, note: crew.length > 1 ? 'average of ' + crew.length + ' men on the payroll' : 'hourly wage' },
      { label: 'Payroll taxes & comp', cents: burden, note: num(s.burdenPct) + '% of the wage' },
      { label: 'Truck & fuel', cents: truck, note: money(num(s.truckDayCents)) + ' a day, spread over ' + hpd + ' working hours' },
      { label: 'Consumables & small tools', cents: consumables, note: num(s.consumablesPct) + '% of a $2,000 material job, over 32 hours' },
      { label: 'Overhead', cents: overhead, note: num(s.overheadPct) + '% of the four lines above' },
      { label: 'Subtotal (cost per hour)', cents: subtotal, note: 'what the hour costs before any profit' },
      { label: 'Fair profit', cents: rate - subtotal, note: num(s.marginPct) + '% margin' },
      { label: 'Rate', cents: rate, note: 'what the hour has to bill at' },
    ];
  }

  function hourCostPage(settings, currentRateCents) {
    const pdf = newPdf();
    const rows = hourCostRows(settings, currentRateCents);
    // Off the settings, not hard-coded: the shop's name is his to change, and
    // an exhibit with the wrong name on it is not an exhibit.
    const company = str(((settings || {}).company || {}).name).trim() || 'this shop';
    let y = M + 6;

    setFont(pdf, 16, 'bold', BLACK);
    pdf.text(fit(pdf, 'What an hour of ' + company.replace(/\s+LLC\.?$/i, '') + ' costs', CONTENT_W), M, y);
    y += 18;
    setFont(pdf, 9, 'normal', MUTED);
    pdf.text(fit(pdf, company + '  ·  ' + dateText(todayISO()), CONTENT_W), M, y);
    y += 10;
    setDraw(pdf, BLACK, 1.5);
    pdf.line(M, y, PAGE_W - M, y);
    y += 22;

    setFont(pdf, 10, 'normal', INK);
    wrap(pdf, 'Every line below is a cost the hour has to carry before anyone is paid for '
      + 'their trouble. The numbers come out of the settings this shop actually runs on.', CONTENT_W)
      .forEach((line) => { pdf.text(line, M, y); y += 13; });
    y += 12;

    const amountX = PAGE_W - M;
    rows.forEach((row) => {
      const heavy = row.label === 'Rate' || row.label.indexOf('Subtotal') === 0;
      if (heavy) {
        setDraw(pdf, BLACK, heavy && row.label === 'Rate' ? 1.2 : 0.8);
        pdf.line(M, y - 12, amountX, y - 12);
      }
      setFont(pdf, heavy ? 11 : 10, heavy ? 'bold' : 'normal', INK);
      pdf.text(fit(pdf, row.label, CONTENT_W - 130), M, y);
      pdf.text(money(row.cents), amountX, y, { align: 'right' });
      y += 12;
      if (row.note) {
        setFont(pdf, 8, 'normal', MUTED);
        pdf.text(fit(pdf, row.note, CONTENT_W - 130), M, y);
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
    const proposed = money((settings || {}).rateCents);
    pdf.text('Current rate: ' + cur + '  ·  Proposed: ' + proposed, M, y);
    y += 20;

    setFont(pdf, 8.5, 'normal', MUTED);
    wrap(pdf, 'Consumables and small tools are figured as ' + ((settings || {}).consumablesPct || 0)
      + '% of a typical $2,000 material job spread over 32 hours. Overhead is the shop’s own '
      + 'percentage on the lines above it. "Fair profit" is margin on the price, not markup on the cost.',
    CONTENT_W).forEach((line) => { pdf.text(line, M, y); y += 11; });

    drawFooters(pdf);
    return pdf;
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  return { render, blob, share, loadLogo, hourCostPage, hourCostRows };
});
