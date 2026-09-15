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

  // THE ROLL LENGTH, off QED's own title: "(500ft Spool)", "(2500ft Reel)",
  // "(2000' SIMpull", "COILPAK 1250FT", "500R". Three to five digits, then
  // ft, a foot mark, or QED's own R, so a ten-foot stick of pipe and a
  // catalog number never read as a roll. Null for cut wire and master reels,
  // which is the truth: they have no roll.
  const ROLL_RE = /(\d{3,5})\s*(?:ft\b|'|R\b)/i;
  function rollFtOf(title) {
    const m = String(title == null ? '' : title).match(ROLL_RE);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 100 && n <= 10000 ? n : null;
  }

  // AND ONLY A LENGTH IS ASKED. QED's own R for a reel is also the last letter
  // of a hundred catalog numbers ("Hubbell 1223R Hubbell-PRO 3-Way Toggle
  // Switch"), and no reading of a title tells those two apart. What does tell
  // them apart is the part: a toggle switch is counted each, it cannot be
  // billed by the foot, and a roll length on it would be a number on his
  // Settings row that means nothing. So a roll length is only ever taken for
  // a part counted by the foot or by the roll.
  function isLengthUnit(unit) { return unit === 'ft' || unit === 'roll'; }
  function rowRollFt(row, unit, partRollFt) {
    if (!isLengthUnit(unit)) return null;
    return rollFtOf(row.name) || (Number.isInteger(partRollFt) && partRollFt > 0 ? partRollFt : null);
  }
  function titleRollFt(row, unit) { return isLengthUnit(unit) ? rollFtOf(row.name) : null; }

  // CENTS PER THOUSAND FEET, the exact basis a length keeps, off any way QED
  // quotes one: per thousand as is, per hundred times ten, per foot times a
  // thousand, and a spool (per each, with a length in its title) divided
  // through the length. Null when the row is not a length at all.
  function perMOf(row, rollFt) {
    if (row.per === 'm') return row.listCents;
    if (row.per === 'c') return row.listCents * 10;
    if (row.per === 'ft') return row.listCents * 1000;
    if (row.per === 'ea' && Number.isInteger(rollFt) && rollFt > 0) return r(row.listCents * 1000 / rollFt);
    return null;
  }

  // Cents per HIS unit, or null when the supplier's unit and his cannot be
  // the same thing. The supplier sells by the each, the foot, the hundred (C)
  // or the thousand (M). A roll, a box, a case, a lot and a day are all sold
  // each. Since v3.5 a LENGTH crosses through the roll length when one is
  // known (off the title, or off the part): a spool on a foot part is the
  // spool divided through, and per-thousand on a roll part is the roll's
  // share. Without a length those two are still a guess, and a guess is
  // what the walk's keypad is for, not an import.
  const COUNTED = ['ea', 'roll', 'box', 'case', 'lot', 'day'];
  function convertCents(row, unit, rollFt) {
    const per = row.per;
    const len = Number.isInteger(rollFt) && rollFt > 0 ? rollFt : null;
    if (per === 'ea') {
      if (COUNTED.indexOf(unit) !== -1) return row.listCents;
      if (unit === 'ft' && len) return Math.max(1, r(row.listCents / len));
      return null;
    }
    if (unit === 'roll' && len && (per === 'ft' || per === 'c' || per === 'm')) {
      return Math.max(1, r(perMOf(row, len) * len / 1000));
    }
    if (per === 'ft') return unit === 'ft' ? row.listCents : null;
    // A per-hundred or per-thousand price still clamps to at least a cent: a
    // fraction of a cent is a real cost, not a free part.
    if (per === 'c') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 100)) : null;
    if (per === 'm') return (unit === 'ft' || unit === 'ea') ? Math.max(1, r(row.listCents / 1000)) : null;
    return null;
  }

  // match(rows, catalog) -> { matched, unmatched, mismatched, duplicates }
  //   matched:    [{ part, row, newListCents, oldListCents, changePct, newPerM, newRollFt }]
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
      // The length this row is about: QED's title first, and failing that the
      // one the part already carries. It is what lets a spool row price a
      // foot part and a per-thousand row price a roll part (v3.5).
      const rollFt = rowRollFt(row, part.unit, part.rollFt);
      const cents = convertCents(row, part.unit, rollFt);
      if (cents === null) {
        out.mismatched.push({ part, row, reason: 'QED sells it per ' + row.per + ' and it is counted by the ' + part.unit });
        return;
      }
      const old = Number.isInteger(part.lastListCents) ? part.lastListCents : null;
      out.matched.push({
        part, row, newListCents: cents, oldListCents: old,
        changePct: old > 0 ? (cents - old) / old * 100 : null,
        // The exact basis, and the TITLE's length only: apply writes the
        // length onto a part that has none, and never over one of his.
        newPerM: perMOf(row, rollFt), newRollFt: titleRollFt(row, part.unit),
      });
    });
    return out;
  }

  // apply(matched, checkedISO) -> { changed, unchanged }
  // Mutates the parts in place; the caller wraps it in persistOr. Writes the
  // bill-at price, the supplier's name, the part number a part lacked, the
  // date, and since v3.5 the per-thousand basis and, on a part with no roll
  // length, the length off the title. NEVER the cost (his), NEVER a length
  // he typed, NEVER a line on a bid (history).
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
      // AND ONLY A LENGTH KEEPS A BASIS. "Cents per thousand feet" is a fact
      // about wire, cable and cord; on a connector QED quotes per hundred it
      // is a number with no meaning, and it is read by suggestedUnit and by
      // the foot/roll flip, neither of which a connector has any business
      // reaching. The same rule the roll length has always had.
      if (Number.isInteger(m.newPerM) && isLengthUnit(p.unit)) p.lastListPerM = m.newPerM;
      if (!(Number.isInteger(p.rollFt) && p.rollFt > 0) && Number.isInteger(m.newRollFt)) p.rollFt = m.newRollFt;
    });
    return { changed, unchanged };
  }

  // What apply is about to touch, remembered first, so a refused save can put
  // every part back exactly as it was. Kept HERE, beside apply, so the list
  // of fields cannot drift from the list apply writes. A key that was ABSENT
  // comes back absent: undefined is what a part written before v3.5 carries,
  // and the validator takes it, where a null coerced in its place would be a
  // field this import invented on a part it was supposed to leave alone.
  function snapshot(matched) {
    return matched.map((m) => ({ p: m.part, lastListCents: m.part.lastListCents, supplierName: m.part.supplierName,
      sku: m.part.sku, priceCheckedISO: m.part.priceCheckedISO, lastListPerM: m.part.lastListPerM, rollFt: m.part.rollFt }));
  }
  function restore(snap) {
    snap.forEach((b) => {
      b.p.lastListCents = b.lastListCents; b.p.supplierName = b.supplierName; b.p.sku = b.sku; b.p.priceCheckedISO = b.priceCheckedISO;
      // The two v3.5 fields are the only ones a part can be missing
      // ALTOGETHER, so they are the only ones put back by deleting: a part off
      // a backup written before v3.5 has no lastListPerM key, and handing it
      // one set to undefined is not the part it was.
      if (b.lastListPerM === undefined) delete b.p.lastListPerM; else b.p.lastListPerM = b.lastListPerM;
      if (b.rollFt === undefined) delete b.p.rollFt; else b.p.rollFt = b.rollFt;
    });
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
      // THE GENERIC THIS ROW WOULD HANG UNDER, worked out first because the
      // lane below has to know what drawer the row belongs in before it can
      // say whether the part it found is the right one.
      //
      // A generic that is ITSELF an option is refused: the file is asking for
      // a chooser inside a chooser, which is not a thing the walk can draw. The
      // row still becomes a part, standing on its own, and Settings is where he
      // says otherwise.
      let seedPart = (typeof row.forPart === 'string' && row.forPart !== '')
        ? (byName.get(Catalog.normalizeName(row.forPart)) || null) : null;
      if (seedPart && typeof seedPart.variantOf === 'string' && seedPart.variantOf !== '') seedPart = null;
      // A part of that name in a DIFFERENT drawer is not this part. The name
      // an option carries is its generic's name plus a catalog number, and two
      // drawers can hold the same words: a 60 A 3-pole breaker in gear and a
      // length of something QED named the same way in wire. Letting the wrong
      // drawer take the row wrote a breaker's price onto a foot of wire.
      const found = byName.get(key) || null;
      const part = found && seedPart && found.category !== seedPart.category ? null : found;
      if (part) {
        if (taken.has(part.id)) { out.duplicates.push(row); return; }
        taken.add(part.id);
        const rollFt = rowRollFt(row, part.unit, part.rollFt);
        const cents = convertCents(row, part.unit, rollFt);
        if (cents === null) {
          out.mismatched.push({ part, row, reason: 'QED sells it per ' + row.per + ' and it is counted by the ' + part.unit });
          return;
        }
        const old = Number.isInteger(part.lastListCents) ? part.lastListCents : null;
        out.matched.push({
          part, row, newListCents: cents, oldListCents: old,
          changePct: old > 0 ? (cents - old) / old * 100 : null,
          newPerM: perMOf(row, rollFt), newRollFt: titleRollFt(row, part.unit),
        });
        return;
      }
      if (claimed.has(key)) { out.duplicates.push(row); return; }
      if (claimedSkus.has(row.sku)) { out.duplicates.push(row); return; }
      claimed.add(key);
      claimedSkus.add(row.sku);
      const unit = unitFor(row, seedPart);
      out.creatable.push({
        row,
        name,
        // The roll length QED's own title says this option comes in, or null
        // for cut wire and for anything that is not a length at all (v3.5).
        rollFt: titleRollFt(row, unit),
        unit,
        // The drawer the generic sits in, so a variant is filed beside the part
        // it is a variant of. Only a row with nothing to inherit from is read
        // off its own words.
        category: seedPart && typeof seedPart.category === 'string' ? seedPart.category : guessCategory(row.name),
        seedPart,
      });
    });

    // A GENERIC WITH NO ROLL LENGTH takes the smallest one its new options
    // carry: the spool he buys, not the master reel. Offered, not written:
    // the screen applies it with the rest under the same save. A length he
    // typed is his and is never on this list.
    const smallest = new Map();
    out.creatable.forEach((c) => {
      const g = c.seedPart;
      if (!g || !Number.isInteger(c.rollFt)) return;
      if (Number.isInteger(g.rollFt) && g.rollFt > 0) return;
      if (!smallest.has(g.id) || c.rollFt < smallest.get(g.id).rollFt) smallest.set(g.id, { part: g, rollFt: c.rollFt });
    });
    out.genericRolls = Array.from(smallest.values());
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
  // The price is converted into the unit the part is actually counted in.
  // Since v3.5 a LENGTH crosses through the roll length QED's title carries,
  // so a 500 ft spool on a part counted by the foot comes in per foot and a
  // per-thousand price on a part counted by the roll comes in per roll; the
  // part keeps the exact per-thousand basis beside it. Only a length with no
  // length at all in its title (cut wire on a roll part) is left without a
  // bill-at price, and the walk's keypad is where that guess belongs. Cost is
  // never written: that is his own number.
  function newParts(creatable, checkedISO, uid) {
    const list = Array.isArray(creatable) ? creatable : [];
    return list.map((c) => {
      const p = {
        id: uid(),
        category: c.category,
        name: c.name,
        unit: c.unit,
        lastCostCents: null,
        lastListCents: convertCents(c.row, c.unit, c.rollFt),
        uses: 0,
        hidden: false,
        sku: typeof c.row.sku === 'string' && c.row.sku !== '' ? c.row.sku : null,
        // The same 120-character ceiling supplierName wears everywhere else
        // it is stored, applied again here rather than trusted from parse:
        // newParts is called with whatever plan() was called with.
        supplierName: Catalog.straighten(c.row.name).slice(0, 120),
        priceCheckedISO: checkedISO,
        lastPriceCents: null, lastPriceISO: null,
        rollFt: Number.isInteger(c.rollFt) ? c.rollFt : null,
        // The basis only on a part that is a LENGTH, the same rule the roll
        // length above it follows: QED quotes half the fittings in the file
        // per hundred, and "cents per thousand feet" on a setscrew connector
        // is a number that means nothing and that the suggestion and the
        // foot/roll flip would both go on to read.
        lastListPerM: isLengthUnit(c.unit) ? perMOf(c.row, c.rollFt) : null,
      };
      if (c.seedPart && typeof c.seedPart.id === 'string' && c.seedPart.id !== '') p.variantOf = c.seedPart.id;
      p.source = { kind: 'qed', checkedISO };
      return p;
    });
  }

  // WHAT AN IMPORT WOULD WRITE BEYOND PRICES.
  //
  //   matchedGains(matched) -> { lengths: [{ part, rollFt }], bases: n }
  //
  // apply does more than reprice: it puts a roll length on a wire part that
  // has none, and QED's exact price per thousand feet on one whose basis is
  // not the file's yet. Neither shows up in a count of prices that moved, and
  // the screen skipped apply altogether on a week where none did, so a wire
  // part that matched every single week never got either of them: the next
  // file would not move a price either, and nor would the one after that.
  //
  // So the screen asks this. It is a reason to open the confirm at all, and it
  // is something the confirm then has to NAME, because a question about a
  // change it does not mention is a question he cannot answer.
  //
  // Only ever a GAIN, never a correction. A length he typed is his and apply
  // will not touch it, so it is not on the list either.
  function matchedGains(matched) {
    const rows = Array.isArray(matched) ? matched : [];
    const lengths = [];
    let bases = 0;
    rows.forEach((x) => {
      if (!x || !x.part) return;
      const p = x.part;
      if (Number.isInteger(x.newRollFt) && !(Number.isInteger(p.rollFt) && p.rollFt > 0)) {
        lengths.push({ part: p, rollFt: x.newRollFt });
      }
      if (Number.isInteger(x.newPerM) && isLengthUnit(p.unit) && p.lastListPerM !== x.newPerM) bases += 1;
    });
    return { lengths, bases };
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
    const gains = matchedGains(m.matched);
    // ONE LIST FOR ONE FACT. A wire part is handed a roll length two ways in
    // the same import — off the title of the row that matched it, and off the
    // smallest length the new options under it carry — and he does not care
    // which. Two sentences about roll lengths would read like two different
    // things happening. The generic's own list goes FIRST because its number
    // is the one that lands: the screen writes it after apply, on purpose.
    const generics = Array.isArray(m.genericRolls) ? m.genericRolls : [];
    const named = new Set(generics.map((g) => g.part));
    const rolls = generics.concat(gains.lengths.filter((g) => !named.has(g.part)));
    // The "put the part numbers on your parts first" sentence only belongs
    // to a file that found NOTHING: no matches, no mismatches, no duplicates,
    // nothing to create, and no roll length to hand a wire part either. A
    // file whose only row matched a part but was skipped for a unit mismatch
    // (or landed on a repeat) is not that file, and telling him to add part
    // numbers he already added is wrong. Neither is a file that is about to
    // put 320 parts on his phone: it is going to write those numbers itself.
    if (!m.matched.length && !m.mismatched.length && !m.duplicates.length && !creatable.length && !rolls.length) {
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
    // And the wire parts that had no roll length until this file gave them
    // one. Said out loud because it changes what a line of that part can do
    // afterwards: it can be billed by the roll or by the foot.
    if (rolls.length === 1) parts.push(rolls[0].part.name + ' gets a roll length of ' + rolls[0].rollFt + ' ft.');
    else if (rolls.length > 1) {
      parts.push(rolls.length + ' wire parts get a roll length: ' + namesList(rolls, (g) => g.part.name + ' (' + g.rollFt + ' ft)') + '.');
    }
    // AND THE BASIS, when it is the only thing left for this file to write.
    // QED's exact price per thousand feet is what a length's per-foot and
    // per-roll suggestions are both figured off, and the week every price is
    // already right is exactly the week a part that has none finally gets one.
    // A price that MOVED brings its basis along with it and was counted at the
    // top, so the sentence would only be noise beside real work: it is said
    // when there is no other news, and then it is the whole reason the confirm
    // opened. The moved rule is the screen's own settingsImportChanging,
    // written out once more because a pure module cannot reach into a screen.
    const moved = m.matched.filter((x) => x.newListCents !== x.oldListCents).length;
    if (gains.bases && !moved && !creatable.length && !rolls.length) {
      parts.push("QED's exact prices per thousand feet are kept on " + n(gains.bases, 'wire part', 'wire parts') + '.');
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

  return { parse, convertCents, rollFtOf, perMOf, match, plan, guessCategory, newParts, apply, snapshot, restore, matchedGains, summaryText };
});
