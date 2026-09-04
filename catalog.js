// catalog.js — two decisions the walk screen kept making by hand, as pure
// functions. UMD so node:test and the browser both load it. No DOM, no
// storage, no app state: everything comes in as arguments, so the same inputs
// always give the same answer and both rules can be tested without a browser.
//
//   matches()   — which parts to offer him, and in what order
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
  // Order: most-used first, then alphabetical. The list earns its order from
  // his own history rather than inheriting whatever order the seed list
  // happened to be written in.
  function matches(catalog, opts) {
    const list = Array.isArray(catalog) ? catalog : [];
    const o = opts || {};
    const query = typeof o.query === 'string' ? o.query.trim().toLowerCase() : '';
    const includeRentals = o.includeRentals === true;

    const out = list.filter((p) => {
      if (!p || p.hidden !== false) return false;
      if (!includeRentals && p.category === RENTALS) return false;
      const name = typeof p.name === 'string' ? p.name : '';
      if (query) return name.toLowerCase().indexOf(query) !== -1;
      return p.category === o.category;
    });

    return out.sort((a, b) => {
      const uses = (b.uses || 0) - (a.uses || 0);
      if (uses) return uses;
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

  return { matches, fitWithin, RENTALS };
});
