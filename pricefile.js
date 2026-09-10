// pricefile.js — the price file a script writes off the supplier's site and
// the app reads in Settings. UMD so node:test and the browser both load it.
// Pure: no DOM, no persistence. The screen shows summaryText and asks; this
// file decides everything else. A row with no name, or a price of nothing,
// is refused, the same as a row missing its sku or its per. bidmath.js must
// load before this file (summaryText formats money through BidMath.fmt).
//
// THE APP NEVER TALKS TO THE SUPPLIER. tools/qed-prices.py, run by hand on a
// PC, reads one public product page per part that has a part number and
// writes the file below; if the supplier ever objects, that script stops and
// nothing in here changes, because this only ever read a file.
//
//   { source, checkedISO: 'YYYY-MM-DD',
//     rows: [{ sku, name, listCents, per,
//             forPart?, catalogNo?, brand? }] }  per: 'ea' | 'ft' | 'c' | 'm' | anything else the page said
//
// forPart, catalogNo and brand are optional and were added in v3.1: forPart
// names the generic part in HIS catalog this row is a variant of, catalogNo is
// the number printed on the shelf, brand is who made it. They are what lets an
// import CREATE the part it cannot find, named the way he would name it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./bidmath.js'));
  else root.PriceFile = factory(root.Catalog, root.BidMath);
})(typeof self !== 'undefined' ? self : this, function (Catalog, BidMath) {
  'use strict';

  const r = Math.round;
  const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  // A price of nothing is not a price: a $0 row is refused the same as a
  // fractional-cent one, so a supplier's out-of-stock placeholder never
  // becomes a free part.
  const isCents = (v) => Number.isInteger(v) && v > 0;

  // parse(text) -> { error: null, checkedISO, rows } or { error: 'why', rows: [] }
  // The error names the first bad row by its 1-based number, which is the
  // number Adrian sees in the file.
  function parse(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { error: 'That is not a price file.', rows: [] }; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.rows)) return { error: 'That is not a price file.', rows: [] };
    if (!isISO(obj.checkedISO)) return { error: 'The price file has no date on it (checkedISO).', rows: [] };
    const rows = [];
    for (let i = 0; i < obj.rows.length; i++) {
      const x = obj.rows[i];
      if (!x || typeof x !== 'object') return { error: 'Row ' + (i + 1) + ' of the price file is not a price row.', rows: [] };
      const nameBad = typeof x.name !== 'string' || x.name.trim() === '';
      const bad = typeof x.sku !== 'string' || x.sku.trim() === ''
        || nameBad || !isCents(x.listCents) || typeof x.per !== 'string' || x.per === '';
      if (bad) return { error: 'Row ' + (i + 1) + ' of the price file is not a price row.', rows: [] };
      // Capped at 120: the same ceiling supplierName wears everywhere else it
      // is stored, so a row cannot put a longer string on a part than typing
      // it in Settings ever could. sku strips ALL whitespace, not just the
      // ends, the same as the typed path in Settings, so "330 2434" off a
      // scanned receipt matches the part he typed "3302434" onto.
      const row = { sku: x.sku.replace(/\s+/g, ''), name: Catalog.straighten(x.name).slice(0, 120), listCents: x.listCents, per: x.per.trim().toLowerCase() };
      // OPTIONAL, and only ever additive: the generic part this row is a
      // variant of, the manufacturer's catalog number, and the brand. A file
      // written before v3.1 carries none of them and parses exactly as it
      // always did. Anything that is not a non-empty string is left OFF the
      // row rather than refused: a hole a scraper left is not a bad price.
      // Straightened and capped at 120, the same as the name, so a generated
      // file cannot put a longer string on a part than typing it ever could.
      ['forPart', 'catalogNo', 'brand'].forEach((k) => {
        if (typeof x[k] !== 'string') return;
        const v = Catalog.straighten(x[k]).slice(0, 120);
        if (v !== '') row[k] = v;
      });
      rows.push(row);
    }
    return { error: null, checkedISO: obj.checkedISO, rows };
  }

  // Cents per HIS unit, or null when the supplier's unit and his cannot be
  // the same thing. The supplier sells by the each, the foot, the hundred (C)
  // or the thousand (M). A roll, a box, a case, a lot and a day are all sold
  // each. A foot price on a counted part, an each price on a length, or a
  // roll price on a length (how long is the roll?) is a guess, and a guess is
  // what the walk's cost keypad is for, not an import.
  const COUNTED = ['ea', 'roll', 'box', 'case', 'lot', 'day'];
  function convertCents(row, unit) {
    const per = row.per;
    if (per === 'ea') return COUNTED.indexOf(unit) !== -1 ? row.listCents : null;
    if (per === 'ft') return unit === 'ft' ? row.listCents : null;
    // A per-hundred or per-thousand price still clamps to at least a cent: a
    // fraction of a cent is a real cost, not a free part.
    if (per === 'c') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 100)) : null;
    if (per === 'm') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 1000)) : null;
    return null;
  }

  // match(rows, catalog) -> { matched, unmatched, mismatched, duplicates }
  //   matched:    [{ part, row, newListCents, oldListCents, changePct }]
  //   unmatched:  rows for parts he never listed (skipped, said out loud)
  //   mismatched: [{ part, row, reason }] units that cannot convert
  //   duplicates: rows that land on a part an earlier row already took
  // By part number first; then by the supplier's name a part remembers from
  // an earlier import. His own names are never compared to the supplier's:
  // "3/4 EMT" and "Republic 3/4 in. EMT Conduit 10 ft" are the same part and
  // no rule says so reliably. Hidden parts still match: a price remembered on
  // a part he has put away is there the day he brings it back. Two parts with
  // the same part number is a typo; the first one in the catalog wins and the
  // second is left alone. Settings refuses the duplicate when he types it.
  function match(rows, catalog) {
    const parts = Array.isArray(catalog) ? catalog : [];
    const bySku = new Map();
    const byName = new Map();
    parts.forEach((p) => {
      const hasSku = typeof p.sku === 'string' && p.sku.trim() !== '';
      // Stripped of ALL whitespace, not just trimmed: a stored sku with an
      // inner space (typed off a receipt) still matches a row whose sku was
      // stripped the same way in parse().
      if (hasSku) {
        const k = p.sku.replace(/\s+/g, '');
        if (!bySku.has(k)) bySku.set(k, p);
      }
      // A part with its own QED number is only ever found by that number: the
      // name lane exists for a part still waiting on one, and letting it also
      // catch a part that already has a different number would let a row for
      // the wrong part overwrite this one because they once shared a name.
      if (!hasSku && typeof p.supplierName === 'string' && p.supplierName.trim() !== '') {
        const k = Catalog.normalizeName(p.supplierName);
        if (!byName.has(k)) byName.set(k, p);
      }
    });
    const seen = new Set();
    const out = { matched: [], unmatched: [], mismatched: [], duplicates: [] };
    rows.forEach((row) => {
      const part = bySku.get(row.sku) || byName.get(Catalog.normalizeName(row.name)) || null;
      if (!part) { out.unmatched.push(row); return; }
      if (seen.has(part.id)) { out.duplicates.push(row); return; }
      seen.add(part.id);
      const cents = convertCents(row, part.unit);
      if (cents === null) {
        out.mismatched.push({ part, row, reason: 'QED sells it per ' + row.per + ' and it is counted by the ' + part.unit });
        return;
      }
      const old = Number.isInteger(part.lastListCents) ? part.lastListCents : null;
      out.matched.push({
        part, row, newListCents: cents, oldListCents: old,
        changePct: old > 0 ? (cents - old) / old * 100 : null,
      });
    });
    return out;
  }

  // apply(matched, checkedISO) -> { changed, unchanged }
  // Mutates the parts in place; the caller wraps it in persistOr. Writes the
  // bill-at price, the supplier's name, the part number a part lacked, and
  // the date. NEVER the cost (his), NEVER a line on a bid (history).
  function apply(matched, checkedISO) {
    let changed = 0, unchanged = 0;
    matched.forEach((m) => {
      const p = m.part;
      // Only the price counts here: a part can gain a sku or a supplier name
      // on this same call and still be reported as "already right".
      if (p.lastListCents === m.newListCents) unchanged += 1; else changed += 1;
      p.lastListCents = m.newListCents;
      p.supplierName = m.row.name;
      if (!(typeof p.sku === 'string' && p.sku.trim() !== '')) p.sku = m.row.sku;
      p.priceCheckedISO = checkedISO;
    });
    return { changed, unchanged };
  }

  // What apply is about to touch, remembered first, so a refused save can put
  // every part back exactly as it was. Kept HERE, beside apply, so the list
  // of fields cannot drift from the list apply writes.
  function snapshot(matched) {
    return matched.map((m) => ({ p: m.part, lastListCents: m.part.lastListCents, supplierName: m.part.supplierName,
      sku: m.part.sku, priceCheckedISO: m.part.priceCheckedISO }));
  }
  function restore(snap) {
    snap.forEach((b) => { b.p.lastListCents = b.lastListCents; b.p.supplierName = b.supplierName; b.p.sku = b.sku; b.p.priceCheckedISO = b.priceCheckedISO; });
  }

  // -------------------------------------------------------------------------
  // WHICH ROWS BECOME NEW PARTS
  // -------------------------------------------------------------------------
  // v3.2. Before this, a row that found no part of his was skipped and said
  // out loud, and putting the part on the phone was three panels of typing per
  // row. The file Adrian builds already knows what each row IS — the generic
  // part of his it belongs under (forPart), the number printed on the shelf
  // (catalogNo) — so the import can make the part itself and get the walk 320
  // priced parts in one tap.
  //
  // Everything below is still pure and still decides nothing: plan() hands the
  // screen a list of what it WOULD create, and the screen asks first.

  // The drawer, read off the supplier's own title, for a row with no generic
  // part of his to inherit one from. A keyword table and nothing cleverer:
  // case-insensitive, FIRST HIT WINS, and everything it has no opinion about
  // is gear, which is the drawer this app already keeps for exactly that.
  //
  // The order of the lanes is the whole rule. Wire is read first because a
  // spool of THHN says nothing else about itself; conduit second, and it wants
  // a LENGTH of pipe (the ten-foot stick in the title) rather than the word
  // EMT, which is on every fitting that goes on it; fittings third, so the
  // connector, the coupling and the strap land together whatever pipe they
  // fit; lighting last, before gear takes the rest.
  const CATEGORY_RULES = [
    ['wire', /THHN|XHHW|cable|cord|wire|SOOW|Cat ?6|MC-/i],
    ['conduit', /x 10'|x 10ft|EMT Conduit|Rigid Conduit|PVC .*Conduit(?!.*(connector|coupling|body|hub|strap|fitting))/i],
    ['boxes', /connector|coupling|strap|clamp|\bbox\b|\bhub\b|conduit body|\bLB\b|fitting|bushing|enclosure|wireway|strut|grip|tape|lug/i],
    ['lighting', /LED|lamp|light|fixture|exit|sensor|photocell|wall pack|high bay|strip/i],
  ];
  function guessCategory(name) {
    const s = String(name == null ? '' : name);
    for (const rule of CATEGORY_RULES) if (rule[1].test(s)) return rule[0];
    return 'gear';
  }

  // WHAT THE TILE SAYS. His short name for the thing, then the number on the
  // shelf: "60 A 3-pole breaker · B360". The middle dot is U+00B7, the same
  // separator every sub-line in this app uses, and never a dash.
  //
  // A row with no forPart has no short name of his to lead with, so it leads
  // with QED's own title and is a part standing on its own. Either way the
  // catalog number half is only added when the row carries one.
  function variantName(row) {
    const base = typeof row.forPart === 'string' && row.forPart !== '' ? row.forPart : row.name;
    const no = typeof row.catalogNo === 'string' && row.catalogNo !== '' ? row.catalogNo : '';
    return no === '' ? base : base + ' \u00b7 ' + no;
  }

  // HOW A NEW PART IS COUNTED. THE GENERIC DECIDES, the same way it decides
  // the drawer: an option under "1/2" EMT connector (setscrew)" is counted the
  // way he counts connectors, and QED's "per hundred" on the price sheet is a
  // way of quoting a bag of a hundred, not a way of counting them. Read off
  // the row instead, the real file put 91 of its 323 rows on a different
  // footing from the part they hang under, and the chooser would have asked
  // him how many FEET of connector he wanted.
  //
  // Only a row with no generic behind it is read off QED's own unit: each
  // stays each, and the foot, the hundred and the thousand are all feet.
  // Anything else is read as a counted thing, which is what convertCents
  // already assumes.
  //
  // A price that cannot cross into the generic's unit simply does not come:
  // a 500 ft spool of #12 quoted per thousand feet says nothing about what one
  // SPOOL costs, and the part is created with no bill-at price rather than a
  // guess. Guessing is what the walk's cost keypad is for.
  function unitFor(row, seedPart) {
    if (seedPart && typeof seedPart.unit === 'string' && seedPart.unit !== '') return seedPart.unit;
    if (row.per === 'ft' || row.per === 'c' || row.per === 'm') return 'ft';
    return 'ea';
  }

  // plan(rows, catalog) -> everything match() returns, plus:
  //   creatable: [{ row, name, unit, category, seedPart }]
  //
  // Two passes, and the second one is the new half. match() finds the rows
  // that land on a part he already has, by number and by remembered supplier
  // name. Every row it could not place is then asked a second question: what
  // would this part be CALLED? A part of that name already in the catalog
  // takes the row (which is what makes a second import of the same file add
  // nothing, and what lets a file three weeks newer reprice what the first one
  // created); a name nothing answers to becomes a creatable; a name an earlier
  // row in this same file already claimed is a duplicate, exactly as two rows
  // on one part number are.
  //
  // Nothing here touches the catalog. The screen shows the counts and asks.
  function plan(rows, catalog) {
    const parts = Array.isArray(catalog) ? catalog : [];
    const out = match(rows, parts);
    out.creatable = [];

    // His OWN names this time, not the supplier's: match() deliberately never
    // compares the two, and this lane is comparing a name the file asked for
    // against a name the catalog already holds. First one wins, the way every
    // other index in this file resolves a duplicate.
    const byName = new Map();
    parts.forEach((p) => {
      const k = Catalog.normalizeName(typeof p.name === 'string' ? p.name : '');
      if (k !== '' && !byName.has(k)) byName.set(k, p);
    });
    // A part one row already took cannot be taken by a second one.
    const taken = new Set();
    out.matched.forEach((x) => taken.add(x.part.id));
    out.mismatched.forEach((x) => taken.add(x.part.id));
    // And a name one row already claimed for a NEW part cannot be claimed
    // twice: the second row would create a second part of the same name.
    const claimed = new Set();
    // Nor a NUMBER. Two parts with one QED number is a typo, which is what
    // match() has always said about the catalog, and it is worse when the
    // import writes it: the second part could never be found again, because
    // the next file looks a part up by its number and the first one wins. The
    // real 9/09 file carries five products twice, under two different names
    // for the same generic.
    const claimedSkus = new Set();

    // A row that becomes a part is not a row he was told was skipped, so the
    // list is emptied and only a row this pass still cannot place goes back on
    // it. Today nothing does; the key stays because it is match()'s contract
    // and the screen's sentence reads off it.
    const unplaced = out.unmatched;
    out.unmatched = [];
    unplaced.forEach((row) => {
      const name = variantName(row);
      const key = Catalog.normalizeName(name);
      const part = byName.get(key) || null;
      if (part) {
        if (taken.has(part.id)) { out.duplicates.push(row); return; }
        taken.add(part.id);
        const cents = convertCents(row, part.unit);
        if (cents === null) {
          out.mismatched.push({ part, row, reason: 'QED sells it per ' + row.per + ' and it is counted by the ' + part.unit });
          return;
        }
        const old = Number.isInteger(part.lastListCents) ? part.lastListCents : null;
        out.matched.push({
          part, row, newListCents: cents, oldListCents: old,
          changePct: old > 0 ? (cents - old) / old * 100 : null,
        });
        return;
      }
      if (claimed.has(key)) { out.duplicates.push(row); return; }
      if (claimedSkus.has(row.sku)) { out.duplicates.push(row); return; }
      claimed.add(key);
      claimedSkus.add(row.sku);
      const seedPart = (typeof row.forPart === 'string' && row.forPart !== '')
        ? (byName.get(Catalog.normalizeName(row.forPart)) || null) : null;
      out.creatable.push({
        row,
        name,
        unit: unitFor(row, seedPart),
        // The drawer the generic sits in, so a variant is filed beside the part
        // it is a variant of. Only a row with nothing to inherit from is read
        // off its own words.
        category: seedPart && typeof seedPart.category === 'string' ? seedPart.category : guessCategory(row.name),
        seedPart,
      });
    });
    return out;
  }

  // newParts(creatable, checkedISO, uid) -> the catalog parts to push.
  //
  // Shaped exactly like a part Store.emptyData seeds and a part + New part
  // builds, because from the moment it lands it IS one of those: it is tapped
  // on the walk, priced on a line, printed on the paper. Two optional fields
  // on top of that shape, both new in v3.2:
  //
  //   variantOf — the generic part this one is an option of. An id, so a
  //               rename of either end leaves the link standing.
  //   source    — { kind: 'qed', checkedISO }: the import put this part here,
  //               not his thumb. It is what Settings filters on, and it is
  //               what lets him weed out the ones he never uses without
  //               touching the ones he typed.
  //
  // A part with nothing to hang under carries no variantOf key at all rather
  // than a null one: absent is how "stands on its own" is spelled everywhere
  // the link is read.
  //
  // The price is converted into the unit the part is actually counted in. One
  // QED sells by that cannot cross into his (a 500 ft spool quoted per
  // thousand feet, on a part he counts by the roll) leaves the part with no
  // bill-at price rather than a guess, and the walk's keypad is where a guess
  // belongs. Cost is never written: that is his own number.
  function newParts(creatable, checkedISO, uid) {
    const list = Array.isArray(creatable) ? creatable : [];
    return list.map((c) => {
      const p = {
        id: uid(),
        category: c.category,
        name: c.name,
        unit: c.unit,
        lastCostCents: null,
        lastListCents: convertCents(c.row, c.unit),
        uses: 0,
        hidden: false,
        sku: typeof c.row.sku === 'string' && c.row.sku !== '' ? c.row.sku : null,
        // The same 120-character ceiling supplierName wears everywhere else
        // it is stored, applied again here rather than trusted from parse:
        // newParts is called with whatever plan() was called with.
        supplierName: Catalog.straighten(c.row.name).slice(0, 120),
        priceCheckedISO: checkedISO,
      };
      if (c.seedPart && typeof c.seedPart.id === 'string' && c.seedPart.id !== '') p.variantOf = c.seedPart.id;
      p.source = { kind: 'qed', checkedISO };
      return p;
    });
  }

  function n(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

  // Names a list of movers or mismatches, at most SHOWN of them, with the
  // rest folded into a trailing count rather than a wall of names.
  const SHOWN = 5;
  function namesList(items, nameFn) {
    const shown = items.slice(0, SHOWN).map(nameFn).join(', ');
    const rest = items.length - SHOWN;
    return shown + (rest > 0 ? ', and ' + rest + ' more' : '');
  }

  // The sentence the confirm shows before anything is written. Every clause is
  // a full sentence ending in a period, and there is no em dash in any of it:
  // this is copy read on a phone in a plant.
  //
  // One opening and one shared tail. The opening says what happened to the
  // parts he already has; the tail says what was skipped and why, and it is
  // the same three sentences however the summary opened.
  function summaryText(m) {
    const creatable = Array.isArray(m.creatable) ? m.creatable : [];
    // The "put the part numbers on your parts first" sentence only belongs
    // to a file that found NOTHING: no matches, no mismatches, no duplicates,
    // and nothing to create either. A file whose only row matched a part but
    // was skipped for a unit mismatch (or landed on a repeat) is not that
    // file, and telling him to add part numbers he already added is wrong.
    // Neither is a file that is about to put 320 parts on his phone: it is
    // going to write those numbers itself.
    if (!m.matched.length && !m.mismatched.length && !m.duplicates.length && !creatable.length) {
      return 'None of the rows in that file match a part with a QED part number. Put the part numbers on your parts first.';
    }
    const parts = [];
    if (m.matched.length) {
      parts.push(m.matched.length + ' of your parts matched.');
      const big = m.matched.filter((x) => x.changePct !== null && Math.abs(x.changePct) > 10);
      if (big.length) {
        parts.push(big.length + ' moved more than 10%: '
          + namesList(big, (x) => x.part.name + ' (' + BidMath.fmt(x.oldListCents) + ' to ' + BidMath.fmt(x.newListCents) + ')') + '.');
      }
    } else if (!creatable.length) {
      // Said only when there is no better news. A file that repriced nothing
      // because everything in it is NEW opens with the new parts instead.
      parts.push('None of your parts got a new price.');
    }
    if (creatable.length) {
      parts.push(n(creatable.length, 'new part', 'new parts') + ' will be added: '
        + namesList(creatable, (c) => c.name) + '.');
    }
    if (m.unmatched.length) parts.push(n(m.unmatched.length, 'row is', 'rows are') + ' not in your catalog and ' + (m.unmatched.length === 1 ? 'is' : 'are') + ' skipped.');
    if (m.mismatched.length) {
      parts.push(n(m.mismatched.length, 'part is', 'parts are') + ' counted differently than QED sells '
        + (m.mismatched.length === 1 ? 'it' : 'them') + ' and ' + (m.mismatched.length === 1 ? 'is' : 'are') + ' skipped: '
        + namesList(m.mismatched, (x) => x.part.name) + '.');
    }
    if (m.duplicates.length) parts.push(n(m.duplicates.length, 'row repeats', 'rows repeat') + ' a part number and ' + (m.duplicates.length === 1 ? 'is' : 'are') + ' skipped.');
    return parts.join(' ');
  }

  return { parse, convertCents, match, plan, guessCategory, newParts, apply, snapshot, restore, summaryText };
});
