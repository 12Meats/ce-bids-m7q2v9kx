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
  const SIZE_PATTERNS = [
    [/^#(\d+)\b/, (m) => 1000 - Number(m[1])],
    [/^(\d+)\/0\b/, (m) => 1000 + Number(m[1])],
    [/^(\d+)[-\s](\d+)\/(\d+)\s*"/, (m) => Number(m[1]) + Number(m[2]) / Number(m[3])],
    [/^(\d+)\/(\d+)\s*"/, (m) => Number(m[1]) / Number(m[2])],
    [/^(\d+(?:\.\d+)?)\s*"/, (m) => Number(m[1])],
  ];

  function sizeKey(name) {
    const s = expandUnits(normalizeName(name));
    for (const pair of SIZE_PATTERNS) {
      const m = s.match(pair[0]);
      if (m) {
        const v = pair[1](m);
        if (typeof v === 'number' && isFinite(v)) return v;
      }
    }
    return null;
  }

  // Ordering only: a part with no size in its name sorts after every part that
  // has one, rather than jumping to the front on a null.
  function sizeOrder(name) {
    const k = sizeKey(name);
    return k === null ? Infinity : k;
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
  // Order: most-used first, then by trade size, then alphabetical. His own
  // history still wins — the part he reaches for forty times a month is at the
  // top wherever the alphabet would have put it — and everything under it is
  // in the order the parts sit on the rack: 1/2", 3/4", 1", 1-1/4", and wire
  // from #14 up to 4/0. Alphabetical is the last word, for the names that have
  // no size in them at all.
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
      // Two sizeless names are equal here, not NaN apart: subtracting Infinity
      // from Infinity is what a comparator must never hand back.
      const sa = sizeOrder(a.name);
      const sb = sizeOrder(b.name);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
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

  return { matches, straighten, normalizeName, sizeKey, fitWithin, RENTALS };
});
