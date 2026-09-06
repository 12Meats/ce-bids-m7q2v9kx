// catalog.js — two decisions the walk screen kept making by hand, as pure
// functions. UMD so node:test and the browser both load it. No DOM, no
// storage, no app state: everything comes in as arguments, so the same inputs
// always give the same answer and both rules can be tested without a browser.
//
//   matches()   — which parts to offer him, and in what order
//   straighten()/normalizeName()/sizeKey() — the three rules matches() is
//                 built out of: what a name really says, and how big it is
//   fitWithin() — how big a photo should be after it is shrunk
//
// They are together because they are the two places the walk screen was doing
// arithmetic in a render function, not because they are related.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The rentals category is in the catalog because a boom lift is a thing he
  // pays for, but it is not a material line: priced as one it would take
  // material markup and be counted in the material total. So it is kept out of
  // the lists the walk adds items from, and is reachable on purpose — as name
  // chips on the rental prompt — rather than by accident through a search.
  const RENTALS = 'rentals';

  // -------------------------------------------------------------------------
  // What a name really says
  // -------------------------------------------------------------------------
  // iOS turns every quote he types into a curly one. `1"` typed on the phone
  // is `1”`, which does not match the `1"` in the catalog, so the search for
  // the one part he uses most came back empty — the bug that started this.
  //
  // straighten() keeps his capitals: it is what gets SAVED, so a part named on
  // the phone is stored with the same quote characters as the seed list.
  // normalizeName() is straighten plus lowercase, and it is what MATCHING
  // compares — never what is written to the file.

  const CURLY_S = /[‘’‛′]/g;   // ‘ ’ ‛ ′
  const CURLY_D = /[“”‟″]/g;   // “ ” ‟ ″

  function straighten(s) {
    return String(s == null ? '' : s)
      .replace(CURLY_S, "'")
      .replace(CURLY_D, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeName(s) { return straighten(s).toLowerCase(); }

  // What he types on a phone keyboard when the part list says 1". The quote
  // key is two taps away and the inch mark is not on the first page at all, so
  // "1 in", "1in" and "1-in" all mean 1", and "10 ft"/"10ft" mean 10'. Applied
  // to the QUERY only — the catalog's own names keep their marks.
  //
  // Bounded on the left by a digit and on the right by a word boundary, so
  // "install" and "inline" are left alone.
  function expandUnits(q) {
    return q
      .replace(/(\d)\s*-?\s*in\b\.?/g, '$1"')
      .replace(/(\d)\s*-?\s*ft\b\.?/g, "$1'");
  }

  // -------------------------------------------------------------------------
  // How big a part is
  // -------------------------------------------------------------------------
  // sizeKey(name) -> a number that sorts by TRADE SIZE, or null for a name
  // with no size in front of it (a J-box, a contactor). Sorting these as text
  // put 1-1/4" before 1/2" and #10 before #2, which is the order a computer
  // reads and nobody else does.
  //
  // Two scales in one number, because a category holds one or the other:
  //   conduit — the inches themselves: 1/2" -> 0.5, 1-1/4" -> 1.25
  //   wire    — 1000 - gauge for #14…#1 (986…999), 1000 + n for n/0
  //             (1/0 -> 1001, 4/0 -> 1004). Ascending in conductor size, with
  //             no lookup table to keep in step with the seed list.
  //
  // An inch mark is REQUIRED for the fraction forms, because "10/4 SO cord" is
  // not two and a half inches of anything. It is a CABLE CONFIGURATION — four
  // conductors of #10 — and it has a size of its own: the gauge in front of the
  // slash, on the same scale the building wire runs, so a family of cord reads
  // 14, 12, 10, 8, 6 the way a family of THHN does. Read as text it came off
  // the shelf 10/2, 10/3, 12/2, 12/3, which is the order a computer reads.
  //
  // Only from #6 up, which is where his cable starts and where a trade size
  // stops: 1/2" and 3/4" are the two fractions the pipe uses, and no cord is
  // built out of half a conductor. So a name that lost its inch mark still is
  // not mistaken for a gauge.
  const CABLE_CFG = /^(\d+)\/(\d+)\b/;
  function cableKey(m) {
    const gauge = Number(m[1]);
    const conductors = Number(m[2]);
    if (gauge < 6 || gauge > 40) return null;
    if (conductors < 2 || conductors > 12) return null;
    return 1000 - gauge;
  }

  //
  // GEAR IS NOT SIZED IN INCHES. A breaker is amps, a VFD is horsepower, a
  // transformer is kVA, a light is watts, and an enclosure is the two numbers
  // on its door. Sorted as text the gear list read 100 A, 15 A, 20 A, 200 A,
  // 30 A, 60 A, which is the order a computer reads and nobody on a ladder
  // does. Those numbers also sit ANYWHERE in the name ("VFD 10 HP" as well as
  // "15 A 1-pole breaker"), so unlike the trade sizes above they are looked
  // for through the whole of it and not only at the front.
  //
  // Each unit gets its own BAND a thousand wide, so one number can be compared
  // without ever pretending 15 amps and 15 horsepower are the same size.
  // Inside a band it is the rating itself: 15 A under 100 A, 1 HP under 10 HP,
  // 6x6 under 12x12. Nothing sorts ACROSS bands in practice, because the
  // families below keep amps with amps, but a key that could is a key that lies.
  const UNIT_BAND = { a: 2000, hp: 3000, kva: 4000, w: 5000 };
  const RATED = /(?:^|\s)(\d+(?:\.\d+)?)\s*(a|hp|kva|w)\b/;
  // 6x6, 8x8, 12x12, 4x4: two numbers in the order they are said, so a 6x6
  // enclosure sorts under a 12x12 and a 4x4 wireway is not four inches of pipe.
  const BOX_DIMS = /(?:^|\s)(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/;

  const SIZE_PATTERNS = [
    [/^#(\d+)\b/, (m) => 1000 - Number(m[1])],
    [/^(\d+)\/0\b/, (m) => 1000 + Number(m[1])],
    [/^(\d+)[-\s](\d+)\/(\d+)\s*"/, (m) => Number(m[1]) + Number(m[2]) / Number(m[3])],
    [/^(\d+)\/(\d+)\s*"/, (m) => Number(m[1]) / Number(m[2])],
    [/^(\d+(?:\.\d+)?)\s*"/, (m) => Number(m[1])],
    [CABLE_CFG, cableKey],
    [BOX_DIMS, (m) => 6000 + Number(m[1]) + Number(m[2]) / 1000],
    [RATED, (m) => UNIT_BAND[m[2]] + Number(m[1])],
  ];

  // The match, with WHERE it was found, because familyKey() below is the same
  // question asked backwards: what is left of the name once the size is out of
  // it. One scan answers both, so the two can never disagree about which words
  // in "15 A 1-pole breaker" are the size.
  function sizeMatch(s) {
    for (const pair of SIZE_PATTERNS) {
      const m = s.match(pair[0]);
      if (!m) continue;
      const v = pair[1](m);
      if (typeof v !== 'number' || !isFinite(v)) continue;
      return { key: v, start: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  function sizeKey(name) {
    const m = sizeMatch(expandUnits(normalizeName(name)));
    return m ? m.key : null;
  }

  // -------------------------------------------------------------------------
  // What KIND of part it is
  // -------------------------------------------------------------------------
  // familyKey(name) -> the name with its size taken out. '3/4" EMT' and
  // '1-1/4" EMT' are both 'emt', '15 A 1-pole breaker' is '1-pole breaker',
  // 'VFD 10 HP' is 'vfd'. A name with no size in it is its own family.
  //
  // This is what the rack looks like and what the counter looks like: one kind
  // of thing, in every size, together. Sorted by size alone the conduit list
  // read 1/2" EMT, 1/2" PVC, 1/2" rigid, 1/2" seal-tight, 3/4" EMT, and so on:
  // six materials shuffled into each other, so finding the 1" PVC meant
  // reading every sixth row.
  function familyKey(name) {
    const s = expandUnits(normalizeName(name));
    const m = sizeMatch(s);
    const rest = m ? (s.slice(0, m.start) + ' ' + s.slice(m.end)) : s;
    return rest.replace(/\s+/g, ' ').trim();
  }

  // -------------------------------------------------------------------------
  // WHICH FAMILY COMES FIRST
  // -------------------------------------------------------------------------
  // Alphabetical is a fair tiebreak between two families nobody has an opinion
  // about. Wire is not that. On a phone nobody has used yet, every uses count
  // still at zero, codepoint order opened the wire tile on the bare ground,
  // then the MC, then the cord, and put THHN — the wire on nearly every job he
  // writes — eighteen rows down. A rack does not start with the ground wire.
  //
  // So a category may carry an order of its own, and wire is the one that
  // does: THHN, XHHW, MC, SO/SOOW, VFD, bare ground, and then everything else
  // (Cat6, the wire nuts) in the alphabetical order it always had. Written as
  // patterns against the FAMILY, not as whole names, so '#12 THHN stranded'
  // typed on the phone lands with the THHN and not at the bottom.
  //
  // This is a tiebreak and nothing else. uses still wins outright: the month
  // he taps the MC cable forty times it is at the top of the tile wherever
  // this list would have put it, which is the whole reason the taps are
  // counted. And it is applied only BETWEEN TWO PARTS IN THE SAME CATEGORY —
  // a search crosses all six, and where a wire sits in the wire tile says
  // nothing about where it belongs beside a coupling.
  const FAMILY_ORDER = {
    wire: [/\bthhn\b/, /\bxhhw\b/, /\bmc\b/, /\bso[ow]*\b/, /\bvfd\b/, /\bbare\b/],
  };

  // familyRank(category, name) -> 0-based place in that category's order, or
  // one past the end for a family the order does not name. A category with no
  // order gives every name the same rank, so the comparison below falls
  // straight through to the alphabet the way it always did.
  function familyRank(category, name) {
    const order = FAMILY_ORDER[category];
    if (!order) return 0;
    const f = familyKey(name);
    for (let i = 0; i < order.length; i += 1) if (order[i].test(f)) return i;
    return order.length;
  }

  // matches(catalog, { category, query, includeRentals })
  //
  //   query empty     — the parts in `category`
  //   query non-empty — every category, name containing the query, because
  //                     typing "3/4" should find the hubs as well as the EMT
  //
  // Hidden parts are never offered: hidden is a soft delete, so a part he
  // stopped carrying stays in the file (old bids reference it by id and must
  // keep validating) without being in his way.
  //
  // Order: most-used first, then family, then size, then alphabetical — with
  // the category's own family order (familyRank, above) taking the first word
  // on family where it has one. His own history still wins — the part he
  // reaches for forty times a month is at the top wherever the alphabet would
  // have put it — and everything under it is
  // in the order the parts sit on the rack: all the EMT in 1/2", 3/4", 1",
  // 1-1/4", 1-1/2", 2", then all the PVC the same way, and wire from #14 up to
  // 4/0. A family that has sizes comes before one that has none, so the pipe
  // and the breakers sit above the odds and ends; alphabetical is the last
  // word, for two names inside one family.
  //
  // Matching is on normalized names both sides, so a curly quote off the iOS
  // keyboard finds the straight one in the file, and "1 in" finds 1".
  function matches(catalog, opts) {
    const list = Array.isArray(catalog) ? catalog : [];
    const o = opts || {};
    const query = expandUnits(normalizeName(typeof o.query === 'string' ? o.query : ''));
    const includeRentals = o.includeRentals === true;

    const out = list.filter((p) => {
      if (!p || p.hidden !== false) return false;
      if (!includeRentals && p.category === RENTALS) return false;
      const name = typeof p.name === 'string' ? p.name : '';
      if (query) return normalizeName(name).indexOf(query) !== -1;
      return p.category === o.category;
    });

    return out.sort((a, b) => {
      const uses = (b.uses || 0) - (a.uses || 0);
      if (uses) return uses;
      // A sizeless name still sorts after every name that has a size, the way
      // it always did. The rule moved up a level, from the part to the family
      // it belongs to, and lands in the same place: every member of a family
      // is sized, or none of them is.
      const ka = sizeKey(a.name);
      const kb = sizeKey(b.name);
      if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
      // The category's own opinion about its families, where it has one, and
      // only between two parts that are in the same category.
      if (a.category === b.category) {
        const ra = familyRank(a.category, a.name);
        const rb = familyRank(b.category, b.name);
        if (ra !== rb) return ra - rb;
      }
      // Codepoint order on the normalized family, not localeCompare: the
      // collator ignores the dots in "S.S. conduit" and files it under "ss",
      // which is not where he would look for it.
      const fa = familyKey(a.name);
      const fb = familyKey(b.name);
      if (fa !== fb) return fa < fb ? -1 : 1;
      if (ka !== kb) return ka < kb ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  // -------------------------------------------------------------------------
  // THE SAME PART, SPELLED HIS OWN WAY
  // -------------------------------------------------------------------------
  // "Add the standard parts" adds the names he is missing and touches nothing
  // he already has. On a phone that has been in use, that leaves PAIRS: his
  // own '3/4" hubs' and the standard '3/4" hub' now sit one row apart in the
  // picker, and he has to remember which of the two he has been tapping.
  //
  // nearDuplicates finds them, and finds only the ones that are the same words
  // said differently. Three things are forgiven and nothing else is:
  //
  //   the plural  — 'hubs' is 'hub'
  //   the quotes  — 3/4" and 3/4 are one size
  //   the order   — 'LB 3/4"' and '3/4" LB' are one fitting
  //
  // AND THE FOURTH: the fitting he never wrote the material on.
  //
  // His own list says '3/4" connectors' and '3/4" couplings', because for
  // twenty years there was one of each in the van. The standard list splits
  // them by what they fit — '3/4" EMT connector (setscrew)' against the
  // liquidtight one, '3/4" EMT coupling' against the rigid — so his name is
  // now SHORTER than the name that replaced it, and nothing above catches it.
  // Left alone it is the worst kind of pair: two rows that look unrelated,
  // one of which he has been tapping for years.
  //
  // So a legacy name is offered against a standard one when every word of his
  // is in it AND the noun on the end is a fitting: a connector, a coupling, a
  // hub, an LB, a strap. That last clause is the whole guard. '3/4" rigid' and
  // '1" EMT' are subsets of longer standard names too, but they end in a
  // MATERIAL, not a fitting: they are the pipe itself, they are their own part,
  // and folding them into a coupling would take the conduit off his walk.
  //
  // A one-word name is never a spelling of a longer one either: 'hubs' alone
  // says nothing about what size, and picking one would be inventing a part.
  //
  // When his one name covers several standard ones, he is shown the EMT: it is
  // what he runs most, so it is the likelier of the two to be the part behind
  // the old row, and the answer is his either way.
  //
  // Pure, and it decides nothing. It hands back the rows and the standard name
  // each one looks like, and Settings asks him before anything is hidden.
  const FITTING_NOUNS = new Set(['connector', 'coupling', 'hub', 'lb', 'strap',
    'box', 'elbow', 'bushing', 'locknut', 'clamp', 'nipple']);

  // 'hubs' is 'hub' and 'boxes' is 'box'. The bare -s rule made 'boxes' into
  // 'boxe', which is not a word and never matched anything.
  function singular(w) {
    if (/(?:x|s|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    return w.replace(/s$/, '');
  }

  function dupWords(name) {
    return normalizeName(name)
      .replace(/["']/g, '')
      .split(' ')
      .filter(Boolean)
      .map(singular);
  }

  function dupKey(name) { return dupWords(name).slice().sort().join(' '); }

  function nearDuplicates(list, standardNames) {
    const rows = Array.isArray(list) ? list : [];
    const std = Array.isArray(standardNames) ? standardNames : [];
    const exact = new Set(std.map(normalizeName));
    const byKey = new Map();
    std.forEach((n) => { const k = dupKey(n); if (!byKey.has(k)) byKey.set(k, n); });
    // Each standard name as a set of its words, once, so the subset rule below
    // is a scan of the library and not a scan per word per row.
    const stdWords = std.map((n) => ({ name: n, set: new Set(dupWords(n)) }));

    // Every standard name his words all appear in, EMT first.
    function covering(words) {
      const hits = stdWords.filter((e) => words.every((w) => e.set.has(w)));
      if (!hits.length) return null;
      const emt = hits.find((e) => e.set.has('emt'));
      return (emt || hits[0]).name;
    }

    const out = [];
    rows.forEach((item) => {
      const name = typeof item === 'string' ? item
        : (item && typeof item.name === 'string' ? item.name : '');
      if (!name) return;
      // Already put away, or already spelled the standard way: nothing to ask.
      if (item && item.hidden === true) return;
      if (exact.has(normalizeName(name))) return;
      let standard = byKey.get(dupKey(name));
      if (!standard) {
        const words = dupWords(name);
        if (words.length < 2) return;
        if (!FITTING_NOUNS.has(words[words.length - 1])) return;
        standard = covering(words);
      }
      if (!standard) return;
      out.push({ item, name, standard });
    });
    return out;
  }

  // fitWithin(w, h, maxEdge) -> { w, h, scale }
  //
  // The box a photo has to fit inside, preserving its shape. Never upscales: a
  // small photo is left exactly as it is rather than being blown up into a
  // bigger file that holds no more detail. Returns integers, because canvas
  // dimensions are pixels. Anything that isn't a positive, finite size comes
  // back as zeros, which the caller reads as "this file is not an image".
  function fitWithin(w, h, maxEdge) {
    const ok = (n) => typeof n === 'number' && isFinite(n) && n > 0;
    if (!ok(w) || !ok(h) || !ok(maxEdge)) return { w: 0, h: 0, scale: 0 };
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    return {
      w: Math.max(1, Math.round(w * scale)),
      h: Math.max(1, Math.round(h * scale)),
      scale,
    };
  }

  return { matches, straighten, normalizeName, sizeKey, familyKey, familyRank,
    nearDuplicates, fitWithin, RENTALS };
});
