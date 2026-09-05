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
  // An inch mark is REQUIRED for the fraction forms: "10/4 SO cord" is a cable
  // configuration, not two and a half inches of anything.
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
  // Order: most-used first, then family, then size, then alphabetical. His own
  // history still wins — the part he reaches for forty times a month is at the
  // top wherever the alphabet would have put it — and everything under it is
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
  // The words themselves have to match. '3/4" connector' is NOT offered
  // against '3/4" EMT connector (setscrew)': that is a different fitting on
  // the same size of pipe, and hiding it on a guess would take a part he uses
  // off his own walk.
  //
  // Pure, and it decides nothing. It hands back the rows and the standard name
  // each one looks like, and Settings asks him before anything is hidden.
  function dupKey(name) {
    return normalizeName(name)
      .replace(/["']/g, '')
      .split(' ')
      .filter(Boolean)
      .map((w) => w.replace(/s$/, ''))
      .sort()
      .join(' ');
  }

  function nearDuplicates(list, standardNames) {
    const rows = Array.isArray(list) ? list : [];
    const std = Array.isArray(standardNames) ? standardNames : [];
    const exact = new Set(std.map(normalizeName));
    const byKey = new Map();
    std.forEach((n) => { const k = dupKey(n); if (!byKey.has(k)) byKey.set(k, n); });

    const out = [];
    rows.forEach((item) => {
      const name = typeof item === 'string' ? item
        : (item && typeof item.name === 'string' ? item.name : '');
      if (!name) return;
      // Already put away, or already spelled the standard way: nothing to ask.
      if (item && item.hidden === true) return;
      if (exact.has(normalizeName(name))) return;
      const standard = byKey.get(dupKey(name));
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

  return { matches, straighten, normalizeName, sizeKey, familyKey, nearDuplicates, fitWithin, RENTALS };
});
