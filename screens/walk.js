'use strict';

// screens/walk.js — the walk itself. This is the screen the app exists for:
// the owner is standing in a dairy plant with the phone in one hand, and every
// number that ends up on the proposal starts here.
//
// One registered screen, three views, and two overlays of its own:
//
//   areas  — the list of areas, the misc line, the did-you-forget card, and
//            the way on to Labor
//   area   — one area: its items, its photos, and the button that adds more
//   add    — picking a part: six category tiles, then a list (searchable
//            across every category), then quantity and cost
//
// The area and add views are views, not screens: the shell's Back button
// always means "leave the walk", and a local Back inside the screen walks the
// three views. Two navigations that look the same but land somewhere different
// is exactly the confusion this app is trying not to have.
//
// Money on this screen is COST — what the material costs him, not what it
// sells for. The sell price is the Price screen's job, and mixing the two on
// the glass is how a bid gets priced off the wrong number.
//
// Every mutation is snapshot -> mutate -> persistOr(revert), and nothing
// navigates after a refused save.
//
// Sections, in order:
//   VIEW STATE    — what the screen is showing, and the enter hook
//   AREA LIST     — the areas view, the misc line, the way on to Labor
//   AREA VIEW     — one area: items and photos
//   ADD ITEM      — tiles, catalog list, new part, quantity, cost
//   PHOTOS        — camera input, downscale, thumbnails, full-size viewer
//   PLACEHOLDERS  — rentals and owned equipment (Task 9 prices them)
//   FORGET LIST   — the did-you-forget checklist
//   REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

const WALK_CATEGORIES = [
  ['conduit', 'Conduit'],
  ['wire', 'Wire'],
  ['boxes', 'Boxes & fittings'],
  ['lighting', 'Lighting'],
  ['gear', 'Gear & parts'],
  ['rentals', 'Rentals/Equipment'],
];
const WALK_UNITS = ['ft', 'ea', 'roll', 'lot', 'day'];
const WALK_GENERAL_AREA = 'General';
const WALK_MISC_LABEL = 'Supports, anchors, and hardware';
const WALK_HIGHLIGHT_MS = 1000;
const WALK_MAX_EDGE = 1600;      // px on the long edge of a stored photo
const WALK_JPEG_QUALITY = 0.85;

let walkView = 'areas';          // 'areas' | 'area' | 'add'
let walkAreaId = null;
let walkForBidId = null;         // which bid the view state above belongs to
let walkAddCat = null;           // the category being browsed in the add view
let walkAddSearch = '';
let walkAddListEl = null;        // the live list, so typing in search redraws only it
let walkAddNew = null;           // { category, name } while the unit picker is up
let walkAddPending = null;       // { part, qty } waiting on the same-price answer
let walkItemMenu = null;         // the item object showing its action row
let walkSheet = null;            // { kind: 'rentEquip' | 'equip', from: 'add' | 'forget' }
let walkForgetRow = null;        // the forget-list row a placeholder flow is answering
let walkForgetAnswered = new Set();  // answered this session only, never persisted
let walkHighlightItem = null;    // the item flashed for a second after it was added
let walkPhotoOpenId = null;      // the photo showing full-size
let walkPhotoUrls = [];          // object URLs handed out by the last render
let walkRenderToken = 0;         // async thumbnail fills from an older render are dropped
let walkPhotoWired = false;
let walkPhotoBusy = false;       // one photo at a time; a double tap must not add two

function walkResetView() {
  walkView = 'areas';
  walkAreaId = null;
  walkForgetAnswered = new Set();
  walkClearTransient();
}

// The half-finished things: a sheet, an open photo, a part waiting on its
// price. None of them should survive leaving the screen and coming back.
function walkClearTransient() {
  walkAddCat = null;
  walkAddSearch = '';
  walkAddListEl = null;
  walkAddNew = null;
  walkAddPending = null;
  walkItemMenu = null;
  walkSheet = null;
  walkForgetRow = null;
  walkHighlightItem = null;
  walkPhotoOpenId = null;
}

// The screen's enter hook. show('walk', id) opens that bid; show('walk') — what
// the bid screen and the Back button do — keeps the bid we already had, and
// with it the area he was standing in. The view state is thrown away whenever
// the bid underneath it changes, so a second bid can never open onto the first
// one's area.
function enterWalk(bidId) {
  if (typeof bidId === 'string' && bidId) state.bidId = bidId;
  if (walkForBidId !== state.bidId) walkResetView();
  else walkClearTransient();
  walkForBidId = state.bidId;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function walkBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

function walkCurrentArea(bid) { return (bid.areas || []).find((a) => a.id === walkAreaId) || null; }

// One area's cost, through the same primitive that computes the whole bid's
// material cost — so the numbers on this screen always add up to the number on
// the Price screen, rather than being a second opinion that rounds differently.
function walkAreaCost(area) { return BidMath.materialCost({ areas: [area] }); }

function walkCatLabel(key) {
  const hit = WALK_CATEGORIES.find(([k]) => k === key);
  return hit ? hit[1] : key;
}

function walkPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function walkCatalogPart(it) {
  return it.catalogId ? (state.data.catalog.find((p) => p.id === it.catalogId) || null) : null;
}

// A two-line tappable line: name and money on top, the detail underneath.
// Pass no onTap for an inert one (the area-cost footer).
function walkRow(name, sub, value, onTap) {
  const node = document.createElement(onTap ? 'button' : 'div');
  node.className = 'walk-row';
  if (onTap) {
    node.type = 'button';
    node.addEventListener('click', onTap);
  }

  const text = document.createElement('div');
  text.className = 'walk-row-text';
  const n = document.createElement('div');
  n.className = 'walk-row-name';
  n.textContent = name;
  text.appendChild(n);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'walk-row-sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  node.appendChild(text);

  if (value !== null && value !== undefined && value !== '') {
    const v = document.createElement('div');
    v.className = 'walk-row-value';
    v.textContent = String(value);
    node.appendChild(v);
  }
  return node;
}

function walkCaption(text) {
  const p = document.createElement('p');
  p.className = 'walk-caption';
  p.textContent = text;
  return p;
}

// The local Back — the one that moves between this screen's own views. The
// shell's Back button, which leaves the walk entirely, is separate on purpose.
function walkBackLink(label, onTap) {
  return textButton('‹ ' + label, 'link-btn', onTap);
}

// ---------------------------------------------------------------------------
// AREA LIST
// ---------------------------------------------------------------------------

function renderWalkAreas(bid, host) {
  const head = document.createElement('div');
  head.className = 'walk-head';
  const title = document.createElement('div');
  title.className = 'walk-head-title';
  title.textContent = bid.title || 'No title yet';
  head.appendChild(title);
  const cust = document.createElement('div');
  cust.className = 'walk-head-cust';
  cust.textContent = bidCustomerName(bid, state.data);
  head.appendChild(cust);
  host.appendChild(head);

  const box = card('Areas');
  box.appendChild(walkCaption('At cost — what the material costs you, not the price.'));
  const areas = bid.areas || [];
  if (areas.length === 0) {
    box.appendChild(emptyNote('No areas yet — add the room you are standing in.'));
  } else {
    areas.forEach((area) => {
      const counts = walkPlural((area.items || []).length, 'item', 'items')
        + ' · ' + walkPlural((area.photoIds || []).length, 'photo', 'photos');
      box.appendChild(walkRow(area.name || 'Area', counts, BidMath.fmt(walkAreaCost(area)), () => {
        walkView = 'area';
        walkAreaId = area.id;
        walkItemMenu = null;
        render();
      }));
    });
  }
  host.appendChild(box);

  host.appendChild(textButton('+ Add area', 'btn btn-primary btn-block', () => walkAddArea(bid)));

  // --- The misc line ---
  // The handful of dollars nobody itemizes and everybody spends. One tap, one
  // number, and it is in the cost stack.
  const miscBox = card();
  const label = (bid.misc && bid.misc.label) || WALK_MISC_LABEL;
  miscBox.appendChild(row(label, BidMath.fmt(bid.misc.cents), () => {
    promptMoney(bid.misc.cents, {
      label,
      done: (cents) => {
        const prev = bid.misc.cents;
        // Clear means none of it, which is a real answer here, not a cancel.
        bid.misc.cents = cents === null ? 0 : cents;
        persistOr(() => { bid.misc.cents = prev; });
        render();
      },
    });
  }));
  host.appendChild(miscBox);

  const forget = buildForgetCard(bid);
  if (forget) host.appendChild(forget);

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('Next: Labor →', 'btn btn-block', () => show('labor', bid.id)));
  host.appendChild(nav);
}

function walkAddArea(bid) {
  promptText('', {
    label: 'Area name',
    placeholder: 'Where you are standing',
    done: (name) => {
      if (!name) return;
      const area = { id: Store.uid(), name, items: [], photoIds: [] };
      bid.areas.push(area);
      if (!persistOr(() => {
        const i = bid.areas.indexOf(area);
        if (i !== -1) bid.areas.splice(i, 1);
      })) { render(); return; }
      // He named the room because he is standing in it and about to count
      // things in it, so the new area opens rather than joining a list.
      walkView = 'area';
      walkAreaId = area.id;
      walkItemMenu = null;
      render();
    },
  });
}

// ---------------------------------------------------------------------------
// AREA VIEW
// ---------------------------------------------------------------------------

function renderWalkArea(bid, area, host) {
  host.appendChild(walkBackLink('All areas', () => {
    walkView = 'areas';
    walkItemMenu = null;
    render();
  }));

  const box = card();
  box.appendChild(row('Area', area.name || 'Area', () => {
    promptText(area.name, {
      label: 'Area name',
      placeholder: 'Where you are standing',
      done: (name) => {
        if (!name) return;
        const prev = area.name;
        area.name = name;
        persistOr(() => { area.name = prev; });
        render();
      },
    });
  }));

  const items = area.items || [];
  if (items.length === 0) {
    box.appendChild(emptyNote('Nothing counted here yet.'));
  } else {
    items.forEach((it) => {
      const line = walkRow(
        it.name,
        numText(it.qty) + ' ' + it.unit + ' · ' + BidMath.fmt(it.costCents) + ' each',
        BidMath.fmt(Math.round(it.qty * it.costCents)),
        () => { walkItemMenu = walkItemMenu === it ? null : it; render(); }
      );
      if (walkHighlightItem === it) line.classList.add('walk-row-new');
      box.appendChild(line);
      if (walkItemMenu === it) box.appendChild(buildItemActions(area, it));
    });
    box.appendChild(walkRow('Area cost', null, BidMath.fmt(walkAreaCost(area)), null));
  }
  host.appendChild(box);

  host.appendChild(buildPhotoCard(area));

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('+ Add item', 'btn btn-primary btn-block', () => {
    walkView = 'add';
    walkAddCat = null;
    walkAddSearch = '';
    walkItemMenu = null;
    render();
  }));
  host.appendChild(nav);
}

function buildItemActions(area, it) {
  const wrap = document.createElement('div');
  wrap.className = 'walk-item-actions';

  wrap.appendChild(textButton('Edit qty', 'btn', () => {
    promptNumber(it.qty, {
      label: 'How many ' + it.unit + '?',
      allowDecimal: true,
      done: (v) => {
        if (v === null) return;
        if (!(v > 0)) { showBanner('A count has to be more than zero'); render(); return; }
        const prev = it.qty;
        it.qty = v;
        persistOr(() => { it.qty = prev; });
        walkItemMenu = null;
        render();
      },
    });
  }));

  wrap.appendChild(textButton('Edit cost', 'btn', () => {
    promptMoney(it.costCents, {
      label: 'Cost each (' + it.unit + ')',
      done: (cents) => {
        const part = walkCatalogPart(it);
        const prev = it.costCents;
        const prevLast = part ? part.lastCostCents : null;
        it.costCents = cents === null ? 0 : cents;
        // The catalog remembers the last price he actually paid, so correcting
        // a fat-fingered cost here also corrects what the next bid offers him.
        if (part) part.lastCostCents = it.costCents;
        persistOr(() => {
          it.costCents = prev;
          if (part) part.lastCostCents = prevLast;
        });
        walkItemMenu = null;
        render();
      },
    });
  }));

  wrap.appendChild(textButton('Delete', 'btn btn-danger-outline', async () => {
    const ok = await confirmPanel('Delete ' + it.name + '?', { ok: 'Delete', danger: true });
    if (!ok) { render(); return; }
    const i = area.items.indexOf(it);
    if (i !== -1) {
      area.items.splice(i, 1);
      persistOr(() => { area.items.splice(i, 0, it); });
    }
    walkItemMenu = null;
    render();
  }));

  return wrap;
}

// ---------------------------------------------------------------------------
// ADD ITEM
// ---------------------------------------------------------------------------
// Six tiles, then a list, then two numbers. The hybrid: the catalog is there
// so he never types "3/4 EMT" again, and + New part is there so the one thing
// the catalog has never heard of doesn't stop the walk.

function renderWalkAdd(bid, area, host) {
  // Back walks the flow backwards one step at a time: price answer or unit
  // picker -> the list -> the tiles -> the area.
  host.appendChild(walkBackLink('Back', () => {
    if (walkAddPending || walkAddNew) { walkAddPending = null; walkAddNew = null; }
    else if (walkAddCat) { walkAddCat = null; walkAddSearch = ''; }
    else walkView = 'area';
    render();
  }));

  const head = document.createElement('div');
  head.className = 'walk-head';
  const title = document.createElement('div');
  title.className = 'walk-head-title';
  title.textContent = 'Add to ' + (area.name || 'this area');
  head.appendChild(title);
  host.appendChild(head);

  if (walkAddPending) { host.appendChild(buildPriceAnswer(bid, area)); return; }
  if (walkAddNew) { host.appendChild(buildUnitPicker(bid, area)); return; }
  if (!walkAddCat) { host.appendChild(buildCategoryTiles()); return; }

  // --- The catalog list, with the escape hatch on top ---
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'walk-search';
  search.placeholder = 'Search all parts';
  search.setAttribute('aria-label', 'Search all parts');
  search.autocomplete = 'off';
  search.value = walkAddSearch;
  // Redraws only the list: rebuilding the input under a typing thumb would
  // drop focus and close the keyboard mid-word.
  search.addEventListener('input', () => {
    walkAddSearch = search.value;
    if (walkAddListEl && walkAddListEl.isConnected) buildCatalogList(bid, area, walkAddListEl);
    else render();
  });
  host.appendChild(search);

  walkAddListEl = card();
  buildCatalogList(bid, area, walkAddListEl);
  host.appendChild(walkAddListEl);
}

function buildCategoryTiles() {
  const grid = document.createElement('div');
  grid.className = 'walk-tiles';
  WALK_CATEGORIES.forEach(([key, label]) => {
    grid.appendChild(textButton(label, 'walk-tile', () => {
      // Rentals and owned equipment are not material lines — they are priced
      // per day on the Costs & price screen (Task 9). All this tile does is
      // get the line onto the bid before he forgets it exists.
      if (key === 'rentals') {
        walkForgetRow = null;
        walkSheet = { kind: 'rentEquip', from: 'add' };
      } else {
        walkAddCat = key;
        walkAddSearch = '';
      }
      render();
    }));
  });
  return grid;
}

// hidden === false is a soft delete: a part he stopped carrying stays in the
// file so old bids that reference it keep validating, but it is not offered.
function walkCatalogMatches() {
  const needle = walkAddSearch.trim().toLowerCase();
  const all = state.data.catalog.filter((p) => p.hidden === false);
  const list = needle
    ? all.filter((p) => p.name.toLowerCase().indexOf(needle) !== -1)
    : all.filter((p) => p.category === walkAddCat);
  // What he reaches for most, first — the order is earned from his own history
  // rather than inherited from whatever order the seed list happened to be in.
  return list.slice().sort((a, b) => (b.uses - a.uses) || a.name.localeCompare(b.name));
}

function buildCatalogList(bid, area, box) {
  box.textContent = '';
  const searching = walkAddSearch.trim() !== '';

  const h = document.createElement('h3');
  h.className = 'card-title';
  h.textContent = searching ? 'All parts' : walkCatLabel(walkAddCat);
  box.appendChild(h);

  const list = walkCatalogMatches();
  if (list.length === 0) {
    box.appendChild(emptyNote(searching ? 'Nothing matches that.' : 'Nothing in here yet.'));
  } else {
    list.forEach((p) => {
      // Search crosses categories on purpose — typing "3/4" should find the
      // hubs as well as the EMT — so each row has to say which drawer it came
      // out of, or two identical-looking names are indistinguishable.
      const sub = searching ? walkCatLabel(p.category) : '';
      const value = p.lastCostCents === null
        ? p.unit
        : BidMath.fmt(p.lastCostCents) + ' / ' + p.unit;
      box.appendChild(walkRow(p.name, sub, value, () => walkPickPart(bid, area, p)));
    });
  }

  box.appendChild(walkRow('+ New part', 'Something not on the list', null, () => {
    promptText('', {
      label: 'New part',
      placeholder: 'What it is',
      done: (name) => {
        if (!name) { showBanner('A new part needs a name'); return; }
        // A part invented while searching across everything has no category to
        // belong to; gear is the drawer for anything that isn't the other five.
        walkAddNew = { category: searching ? 'gear' : walkAddCat, name };
        render();
      },
    });
  }));
}

function buildUnitPicker(bid, area) {
  const box = card('How is ' + walkAddNew.name + ' counted?');
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  WALK_UNITS.forEach((unit) => {
    nav.appendChild(textButton(unit, 'btn btn-block', () => walkCreatePart(bid, area, unit)));
  });
  box.appendChild(nav);
  return box;
}

function walkCreatePart(bid, area, unit) {
  const { category, name } = walkAddNew;
  const part = Store.addCatalogItem(state.data, { category, name, unit });
  if (!part) { showBanner('A new part needs a name'); walkAddNew = null; render(); return; }
  // The catalog entry is saved on its own: if the quantity keypad is cancelled
  // a moment from now, a part that is on screen must already be on disk rather
  // than living in memory until some later save happens to carry it along.
  if (!persistOr(() => {
    const i = state.data.catalog.indexOf(part);
    if (i !== -1) state.data.catalog.splice(i, 1);
  })) { render(); return; }
  walkAddNew = null;
  walkPickPart(bid, area, part);
}

// Quantity, then price. A part he has bought before offers the price he paid
// last time as one button, because typing the same $3.40 for the fortieth
// length of EMT is the kind of friction that gets an app put down.
function walkPickPart(bid, area, part) {
  promptNumber(null, {
    label: 'How many ' + (part.unit || 'ea') + '?',
    allowDecimal: true,
    done: (v) => {
      if (v === null) return;
      if (!(v > 0)) { showBanner('A count has to be more than zero'); render(); return; }
      if (typeof part.lastCostCents === 'number') {
        walkAddPending = { part, qty: v };
        render();
        return;
      }
      walkAskCost(bid, area, part, v);
    },
  });
}

function buildPriceAnswer(bid, area) {
  const { part, qty } = walkAddPending;
  const box = card();
  box.appendChild(walkRow(part.name, numText(qty) + ' ' + part.unit, null, null));

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton(
    'Same price (' + BidMath.fmt(part.lastCostCents) + ')',
    'btn btn-primary btn-block',
    () => walkCommitItem(bid, area, part, qty, part.lastCostCents)
  ));
  nav.appendChild(textButton('Different price', 'btn btn-block', () => {
    walkAddPending = null;
    walkAskCost(bid, area, part, qty);
  }));
  box.appendChild(nav);
  return box;
}

function walkAskCost(bid, area, part, qty) {
  promptMoney(part.lastCostCents, {
    label: 'Cost each (' + (part.unit || 'ea') + ')',
    done: (cents) => {
      // Clear on the cost keypad means "I don't know yet". The count he just
      // walked off is worth more than the price he hasn't looked up, so the
      // line goes on at zero and shows on the bid until it has been priced.
      const zero = cents === null;
      if (walkCommitItem(bid, area, part, qty, zero ? 0 : cents) && zero) {
        showBanner('Added at $0 — put a price on it when you know it');
      }
    },
  });
}

function walkCommitItem(bid, area, part, qty, costCents) {
  const item = { catalogId: part.id, name: part.name, unit: part.unit, qty, costCents, priceCents: null };
  const prevUses = part.uses;
  const prevCost = part.lastCostCents;
  area.items.push(item);
  // One mutation, one save: the line and the catalog's memory of the price go
  // to disk together or not at all.
  Store.recordCatalogUse(state.data, part.id, costCents);
  if (!persistOr(() => {
    const i = area.items.indexOf(item);
    if (i !== -1) area.items.splice(i, 1);
    part.uses = prevUses;
    part.lastCostCents = prevCost;
  })) {
    // Stay in the add view: nothing was saved, so nothing is behind him.
    walkAddPending = null;
    render();
    return false;
  }

  walkAddPending = null;
  walkAddCat = null;
  walkAddSearch = '';
  walkView = 'area';
  walkHighlightItem = item;
  render();
  setTimeout(() => {
    if (walkHighlightItem !== item) return;
    walkHighlightItem = null;
    if (state.screen === 'walk') render();
  }, WALK_HIGHLIGHT_MS);
  return true;
}

// ---------------------------------------------------------------------------
// PHOTOS
// ---------------------------------------------------------------------------

function buildPhotoCard(area) {
  const box = card('Photos');
  const ids = area.photoIds || [];
  if (ids.length === 0) {
    box.appendChild(emptyNote('No photos of this area yet.'));
  } else {
    const strip = document.createElement('div');
    strip.className = 'walk-thumbs';
    const token = walkRenderToken;
    ids.forEach((id) => strip.appendChild(walkThumb(id, token)));
    box.appendChild(strip);
  }
  const bar = document.createElement('div');
  bar.className = 'bid-nav';
  bar.appendChild(textButton('+ Photo', 'btn btn-block', () => {
    const input = el('walkPhotoInput');
    if (input) input.click();
  }));
  box.appendChild(bar);
  return box;
}

function walkThumb(id, token) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'walk-thumb';
  btn.setAttribute('aria-label', 'Open photo');
  const img = document.createElement('img');
  img.alt = '';
  btn.appendChild(img);
  btn.addEventListener('click', () => { walkPhotoOpenId = id; render(); });
  // A photo that isn't there any more (evicted by iOS, IndexedDB blocked)
  // leaves an empty tile rather than taking the screen down with it.
  Photos.get(id).then((blob) => {
    if (token !== walkRenderToken || !blob) return;
    const url = URL.createObjectURL(blob);
    walkPhotoUrls.push(url);
    img.src = url;
  });
  return btn;
}

function buildPhotoView(area, id) {
  const wrap = document.createElement('div');
  wrap.className = 'walk-photo-view';
  const img = document.createElement('img');
  img.alt = 'Walkthrough photo';
  wrap.appendChild(img);

  const token = walkRenderToken;
  Photos.get(id).then((blob) => {
    if (token !== walkRenderToken || !blob) return;
    const url = URL.createObjectURL(blob);
    walkPhotoUrls.push(url);
    img.src = url;
  });

  const actions = document.createElement('div');
  actions.className = 'walk-photo-actions';
  actions.appendChild(textButton('Close', 'btn', () => { walkPhotoOpenId = null; render(); }));
  actions.appendChild(textButton('Delete', 'btn btn-danger', () => walkDeletePhoto(area, id)));
  wrap.appendChild(actions);
  return wrap;
}

async function walkDeletePhoto(area, id) {
  const ok = await confirmPanel('Delete this photo?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }

  const i = area.photoIds.indexOf(id);
  if (i === -1) { walkPhotoOpenId = null; render(); return; }
  area.photoIds.splice(i, 1);
  if (!persistOr(() => { area.photoIds.splice(i, 0, id); })) { render(); return; }

  walkPhotoOpenId = null;
  render();
  // The bid document is the truth, so it is written first. If the blob itself
  // refuses to go it is left behind: a file nothing points at is invisible,
  // while an id pointing at nothing is a grey tile he could never clear.
  Photos.del(id);
}

// One listener for the life of the app: #walkContent is rebuilt on every
// render, so a listener added in there would stack up one copy per render.
function walkWirePhotoInput() {
  if (walkPhotoWired) return;
  const input = el('walkPhotoInput');
  if (!input) return;
  walkPhotoWired = true;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    // Cleared before the work starts, so photographing the same thing twice in
    // a row still fires a change event the second time.
    input.value = '';
    if (file) walkAddPhoto(file);
  });
}

async function walkAddPhoto(file) {
  if (walkPhotoBusy) return;
  const bid = walkBid();
  const area = bid && walkCurrentArea(bid);
  if (!area) return;

  walkPhotoBusy = true;
  try {
    const blob = await walkShrink(file);
    if (!blob) { showBanner("Couldn't read that photo", 'danger'); return; }

    const id = Store.uid();
    // The blob goes first: an id in the bid with no file behind it is a
    // permanently grey tile, and IndexedDB is much the likelier half to refuse
    // (a full phone) than localStorage is.
    const stored = await Photos.put(id, blob, 'photo');
    if (!stored) { showBanner("Photo didn't save (storage full?)", 'danger'); return; }

    area.photoIds.push(id);
    if (!persistOr(() => {
      const i = area.photoIds.indexOf(id);
      if (i !== -1) area.photoIds.splice(i, 1);
      Photos.del(id);
    })) { render(); return; }
    render();
  } finally {
    walkPhotoBusy = false;
  }
}

// A phone camera hands back 3-12 megapixels. Storing that is seconds of
// writing per shot and a full phone by the third bid; 1600 px on the long edge
// is still enough to read a nameplate off. iOS returns JPEG here even on a
// HEIC phone because of accept="image/*", but a file that will not decode at
// all is answered with a banner rather than a silent nothing.
function walkLoadImage(file) {
  return new Promise((resolve) => {
    let url;
    try { url = URL.createObjectURL(file); } catch (e) { resolve(null); return; }
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function walkShrink(file) {
  let src = null;
  if (typeof createImageBitmap === 'function') {
    try { src = await createImageBitmap(file); } catch (e) { src = null; }
  }
  if (!src) src = await walkLoadImage(file);
  if (!src) return null;

  const w0 = src.naturalWidth || src.width;
  const h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) return null;

  const scale = Math.min(1, WALK_MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(src, 0, 0, w, h);
  } catch (e) {
    return null;
  }
  if (typeof src.close === 'function') src.close();

  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b || null), 'image/jpeg', WALK_JPEG_QUALITY); }
    catch (e) { resolve(null); }
  });
}

// Object URLs are held open until they are revoked, and a walk with forty
// photos re-renders a lot. Everything the last render handed out goes back
// before the next one hands out any more.
function walkReleasePhotoUrls() {
  walkPhotoUrls.forEach((url) => {
    try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
  });
  walkPhotoUrls = [];
}

// ---------------------------------------------------------------------------
// PLACEHOLDERS (rentals and owned equipment)
// ---------------------------------------------------------------------------
// Task 9 owns what a rental or a piece of his own equipment costs per day.
// What the walk owns is remembering it exists: standing under the high bays is
// when he knows he needs a lift, and the Costs & price screen is where the
// number goes on it.

function buildWalkSheet(bid) {
  const wrap = document.createElement('div');
  wrap.className = 'walk-sheet';

  if (walkSheet.kind === 'equip') {
    const box = card('Which piece of equipment?');
    const own = state.data.settings.equipment.filter((e) => e.hidden === false);
    if (own.length === 0) {
      box.appendChild(emptyNote('No equipment in Settings yet.'));
    } else {
      const chips = document.createElement('div');
      chips.className = 'walk-thumbs'; // the same wrap-and-gap the thumbnails use
      own.forEach((e) => {
        const c = chip(e.name, false, () => walkAddEquipment(bid, e));
        c.style.width = 'auto';
        chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    const nav = document.createElement('div');
    nav.className = 'bid-nav';
    nav.appendChild(textButton('Cancel', 'btn btn-block', walkCloseSheet));
    box.appendChild(nav);
    wrap.appendChild(box);
    return wrap;
  }

  const box = card('Rented, or your own?');
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('Rental', 'btn btn-block', () => walkAddRental(bid, '')));
  nav.appendChild(textButton('Owned equipment', 'btn btn-block', () => {
    walkSheet = { kind: 'equip', from: walkSheet.from };
    render();
  }));
  nav.appendChild(textButton('Cancel', 'btn btn-block', walkCloseSheet));
  box.appendChild(nav);
  wrap.appendChild(box);
  return wrap;
}

function walkCloseSheet() {
  walkSheet = null;
  walkForgetRow = null;
  render();
}

function walkAddRental(bid, prefill) {
  promptText(prefill || '', {
    label: 'Rental',
    placeholder: 'What you are renting',
    done: (name) => {
      if (!name) return;
      const line = { name, days: 1, cents: 0, markup: false };
      bid.rentals.push(line);
      if (!persistOr(() => {
        const i = bid.rentals.indexOf(line);
        if (i !== -1) bid.rentals.splice(i, 1);
      })) { render(); return; }
      walkAfterPlaceholder();
    },
  });
}

function walkAddEquipment(bid, equip) {
  const line = { equipmentId: equip.id, name: equip.name, days: 1, dayCents: 0 };
  bid.equipment.push(line);
  if (!persistOr(() => {
    const i = bid.equipment.indexOf(line);
    if (i !== -1) bid.equipment.splice(i, 1);
  })) { render(); return; }
  walkAfterPlaceholder();
}

function walkAfterPlaceholder() {
  const from = walkSheet ? walkSheet.from : 'forget';
  if (walkForgetRow) walkForgetAnswered.add(walkForgetRow);
  walkForgetRow = null;
  walkSheet = null;
  // Coming out of the add-item flow, the area he was working in is where he
  // belongs — the rental line itself does not live in an area.
  if (from === 'add') {
    walkView = 'area';
    walkAddCat = null;
    walkAddSearch = '';
  }
  showBanner('Added — price it on the Costs & price screen.', 'ok');
  render();
}

// ---------------------------------------------------------------------------
// FORGET LIST
// ---------------------------------------------------------------------------
// The things that are invisible on a walk and expensive on a job. The answers
// are deliberately not saved: it is a checklist for this walk, and a bid opened
// again next week deserves to be asked again.

function buildForgetCard(bid) {
  const list = state.data.settings.forgetList || [];
  if (list.length === 0) return null;

  const box = card('Did you forget?');
  list.forEach((name) => {
    const line = document.createElement('div');
    line.className = 'walk-forget';

    const label = document.createElement('span');
    label.className = 'walk-forget-label';
    label.textContent = name;
    line.appendChild(label);

    if (walkForgetAnswered.has(name)) {
      const tick = document.createElement('span');
      tick.className = 'walk-forget-tick';
      tick.setAttribute('aria-label', 'Answered');
      tick.textContent = '✓';
      line.appendChild(tick);
    } else {
      const acts = document.createElement('div');
      acts.className = 'walk-forget-actions';
      acts.appendChild(textButton('No', 'btn', () => {
        walkForgetAnswered.add(name);
        render();
      }));
      acts.appendChild(textButton('Add it', 'btn btn-primary', () => walkForgetAdd(bid, name)));
      line.appendChild(acts);
    }

    box.appendChild(line);
  });
  return box;
}

function walkForgetAdd(bid, name) {
  const key = name.trim().toLowerCase();

  // Two of the rows are not material at all, so they go where their money
  // actually gets priced.
  if (key === 'lift rental') {
    walkSheet = null;
    walkForgetRow = name;
    walkAddRental(bid, name);
    return;
  }
  if (key === 'equipment') {
    walkForgetRow = name;
    walkSheet = { kind: 'equip', from: 'forget' };
    render();
    return;
  }

  // Everything else becomes a zero-cost line in an area called General, so it
  // is visible on the bid — and on the Price screen — until it has a number.
  const prevAreaCount = bid.areas.length;
  let area = bid.areas.find((a) => (a.name || '').trim().toLowerCase() === WALK_GENERAL_AREA.toLowerCase());
  const created = !area;
  if (!area) {
    area = { id: Store.uid(), name: WALK_GENERAL_AREA, items: [], photoIds: [] };
    bid.areas.push(area);
  }
  const item = { catalogId: null, name, unit: 'lot', qty: 1, costCents: 0, priceCents: null };
  area.items.push(item);

  if (!persistOr(() => {
    const i = area.items.indexOf(item);
    if (i !== -1) area.items.splice(i, 1);
    if (created) bid.areas.length = prevAreaCount;
  })) { render(); return; }

  walkForgetAnswered.add(name);
  showBanner(name + ' added to General at $0 — price it on the walk', 'ok');
  render();
}

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------

function renderWalk() {
  const host = el('walkContent');
  walkReleasePhotoUrls();
  walkRenderToken += 1;
  host.textContent = '';
  walkWirePhotoInput();

  const bid = walkBid();
  if (!bid) {
    host.appendChild(emptyNote("That bid isn't here anymore. Tap Back to return to your bids."));
    return;
  }

  // An area can go away underneath a view (a stale id after an import), and an
  // empty area view with live buttons on it is worse than the list.
  let area = null;
  if (walkView === 'area' || walkView === 'add') {
    area = walkCurrentArea(bid);
    if (!area) { walkView = 'areas'; walkAreaId = null; }
  }

  if (walkView === 'add') renderWalkAdd(bid, area, host);
  else if (walkView === 'area') renderWalkArea(bid, area, host);
  else renderWalkAreas(bid, host);

  if (walkSheet) host.appendChild(buildWalkSheet(bid));
  if (walkPhotoOpenId && area) host.appendChild(buildPhotoView(area, walkPhotoOpenId));
}

registerScreen('walk', { id: 'screen-walk', title: 'Walkthrough', back: 'bid', tab: 'bids', enter: enterWalk, render: renderWalk });
