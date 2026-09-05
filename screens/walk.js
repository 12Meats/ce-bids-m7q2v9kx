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
// The area and add views are views, not screens — but there is only ONE Back
// on the glass now. The header's button walks them one step at a time through
// backStep() and only leaves the walk from the top, and each step deeper is a
// history entry, so the phone's back gesture does exactly the same thing. Two
// Back buttons 40 px apart with different destinations is what this screen had
// before, and it is exactly the confusion this app is trying not to have.
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

// What a rental row on the walk says, and what the banner says the moment one
// is added. One sentence, one destination, said the same way twice — the
// banner used to point at a screen and the area then showed nothing.
const WALK_RENTAL_SUB = 'rental · priced on Costs & price';
const WALK_HIGHLIGHT_MS = 1000;
const WALK_MAX_EDGE = 1600;      // px on the long edge of a stored photo
const WALK_JPEG_QUALITY = 0.85;

let walkView = 'areas';          // 'areas' | 'area' | 'add'
let walkAreaId = null;
// Which change order the screen is editing, or null for the bid itself. A
// change order has exactly the two things this screen already edits — areas
// and items — so it is this screen pointed at a different list, not a second
// copy of this file living in job.js.
let walkCoId = null;
let walkForTargetId = null;      // which bid (and change order) the view state above belongs to
let walkAddCat = null;           // the category being browsed in the add view
let walkAddSearch = '';
let walkAddListEl = null;        // the live list, so typing in search redraws only it
let walkAddNew = null;           // { category, name } while the unit picker is up
let walkAddPending = null;       // { part, qty } waiting on the same-price answer
let walkItemMenu = null;         // the item object showing its action row
let walkSheet = null;            // { kind: 'rentEquip' | 'equip', from: 'add' | 'forget' }
let walkForgetRow = null;        // the forget-list row a placeholder flow is answering
let walkForgetPick = null;       // the forget-list row showing its "Which area?" chips
let walkForgetOpen = false;      // the answered rows, unfolded from their one line
let walkHighlightItem = null;    // the item flashed for a second after it was added
let walkPhotoOpenId = null;      // the photo showing full-size
let walkPhotoUrls = [];          // object URLs handed out by the last render
let walkRenderToken = 0;         // async thumbnail fills from an older render are dropped
let walkPhotoWired = false;
let walkPhotoBusy = false;       // a photo is being shrunk and written right now
let walkPhotoQueue = [];         // the ones behind it, in the order they were taken

function walkResetView() {
  walkView = 'areas';
  walkAreaId = null;
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
  walkForgetPick = null;
  walkForgetOpen = false;
  walkHighlightItem = null;
  walkPhotoOpenId = null;
}

// The screen's enter hook. show('walk', id) opens that bid's own walk;
// show('walk', { bidId, changeOrderId }) opens one change order inside that
// bid's job; show('walk', { bidId, areaId }) opens straight into one area;
// show('walk') — the Back button — keeps whichever we already had, and with it
// the area he was standing in. The view state is thrown away whenever the
// thing underneath it changes, so a second bid can never open onto the first
// one's area, and a change order never onto the bid's.
function enterWalk(arg) {
  if (arg !== undefined) {
    const t = navTarget(arg);
    if (t.bidId) state.bidId = t.bidId;
    // navTarget answers null for a plain id, so naming a bid clears the change
    // order rather than leaving it standing over the top of it.
    walkCoId = t.changeOrderId;
  }
  // The belt to that brace. With no argument this screen keeps whatever it had,
  // which is right for a Back off a tab and wrong the moment the bid underneath
  // has moved: a change order id from the last bid resolves to nothing on this
  // one, and the screen opens on "That change order isn't here anymore." A
  // change order that is not on the bid we are standing in is not a change
  // order we are editing.
  if (walkCoId && !walkChangeOrder(walkBid())) walkCoId = null;

  const target = state.bidId + '|' + (walkCoId || '');
  if (walkForTargetId !== target) walkResetView();
  else walkClearTransient();
  walkForTargetId = target;

  // An area named in the argument, after the reset above so it survives it.
  // This is how the blocked banner lands him in the room the $0 item is in
  // instead of on the list of rooms. An id that is not on what we are editing
  // is ignored rather than opening an area view onto nothing.
  const areaId = arg && typeof arg === 'object' && typeof arg.areaId === 'string' && arg.areaId
    ? arg.areaId
    : null;
  if (areaId) {
    const bid = walkBid();
    const edit = walkChangeOrder(bid) || bid;
    if (edit && (edit.areas || []).some((a) => a && a.id === areaId)) {
      walkView = 'area';
      walkAreaId = areaId;
    }
  }
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function walkBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

// The change order being edited, or null when the walk is on the bid itself.
function walkChangeOrder(bid) {
  if (!walkCoId || !bid) return null;
  return ((bid.job && bid.job.changeOrders) || []).find((c) => c.id === walkCoId) || null;
}

// Whatever owns the areas this screen is editing: the bid, or a change order.
// Everything below reads areas off `edit` and everything else — the customer
// name, the catalog, the rentals — off the bid, so the two are never confused.
function walkCurrentArea(edit) { return (edit.areas || []).find((a) => a.id === walkAreaId) || null; }

// One area's cost, through the same primitive that computes the whole bid's
// material cost — so the numbers on this screen always add up to the number on
// the Price screen, rather than being a second opinion that rounds differently.
function walkAreaCost(area) { return BidMath.materialCost({ areas: [area] }); }


function walkPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

// The rentals added from THIS area's add flow. rental.areaId is optional and
// new: a rental from an older bid (or one named on the Costs & price screen,
// where there is no area) has none, and shows only where it always has — on
// the price screen. Nothing here writes to it except walkAddRental.
function walkAreaRentals(bid, area) {
  if (!area) return [];
  return (bid.rentals || []).filter((x) => x && x.areaId === area.id);
}

function walkCatalogPart(it) {
  return it.catalogId ? (state.data.catalog.find((p) => p.id === it.catalogId) || null) : null;
}

// A two-line tappable line: name and money on top, the detail underneath.
// Pass no onTap for an inert one (the area-cost footer), which then wears
// .flat: no chevron, no press state, nothing to aim at. opts.keypad says the
// tap opens a number panel, so the value goes navy instead of taking a ›.
function walkRow(name, sub, value, onTap, opts) {
  const node = document.createElement(onTap ? 'button' : 'div');
  node.className = 'walk-row' + tapClasses(onTap, opts);
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
  if (onTap && !(opts && opts.keypad)) node.appendChild(chevron());
  return node;
}

// ---------------------------------------------------------------------------
// AREA LIST
// ---------------------------------------------------------------------------

function renderWalkAreas(bid, edit, host) {
  const co = edit === bid ? null : edit;

  // The step strip only belongs to the bid's own four screens. A change order
  // has a walk and a labor screen and nothing else, and a strip offering Price
  // and Proposal from inside one would jump him out of it.
  if (!co) host.appendChild(stepStrip(bid, state.data.settings, 'walk'));

  host.appendChild(screenHead(
    co ? ('Change order: ' + (co.name || 'Change order')) : (bid.title || 'No title yet'),
    co ? (bid.title || bidCustomerName(bid, state.data)) : bidCustomerName(bid, state.data)
  ));

  const areas = edit.areas || [];

  // The one number this screen produces: what he has counted, at cost, with
  // the rooms it came out of underneath it.
  host.appendChild(bigNumber(
    BidMath.fmt(BidMath.materialCost({ areas })),
    walkPlural(areas.length, 'area', 'areas') + ' · at cost, not the price'
  ));

  // ONE SECTION, not a heading and then some loose cards and then a button
  // touching the next card. The heading names what the cards under it are, the
  // count says how many, and "+ Area" is the last row of the same group — so
  // the 12px that used to be missing between it and "Supports, anchors and
  // hardware" now sits under the whole section, where a card gap belongs.
  const section = document.createElement('div');
  section.className = 'walk-areas';
  // "Areas" alone reads as a label for an empty list; "Areas · 3" is a fact
  // about the walk. A count of nothing is not worth printing.
  section.appendChild(groupHeading(areas.length ? 'Areas · ' + areas.length : 'Areas'));

  if (areas.length === 0) {
    const box = card();
    // On a change order the empty state must not read as an instruction. Half
    // of them are pure labor ("they want the panel moved eight feet") and have
    // no parts to count at all, so this says both ways out: count something, or
    // go straight to Labor, which the pinned button now allows.
    box.appendChild(emptyNote(co
      ? 'Tap + Area if there are parts to count. A change order can be labor only, so Next: Labor is fine with nothing here.'
      : 'Tap + Area and name the first room.'));
    section.appendChild(box);
  } else {
    // One card per area, not rows inside a shared one: this is the list he
    // taps into forty times a walk, and it has to read as a row of doors.
    areas.forEach((area) => {
      // A change order's areas carry no photos (the camera is hidden there),
      // so a "0 photos" count would be a fact about nothing.
      const counts = walkPlural((area.items || []).length, 'item', 'items')
        + (co ? '' : ' · ' + walkPlural((area.photoIds || []).length, 'photo', 'photos'));
      section.appendChild(tapCard({
        // The tag is what makes one area read as one area OF the job rather
        // than as the job: the name on the card is his ("Cheese vat room"),
        // and nothing else on the screen said what kind of thing it was.
        tag: 'Area',
        title: area.name || 'Area',
        sub: counts,
        // What he wrote himself while standing in the room, one line of it. It
        // never reaches the customer's paper, so this card is the only place
        // it can remind him it is there.
        note: areaNoteLine(area.notes),
        value: BidMath.fmt(walkAreaCost(area)),
        onTap: () => {
          // A step deeper, so it gets a history entry: the phone's back gesture
          // and this screen's own Back are one action now (see app.js navPush).
          navPush();
          walkView = 'area';
          walkAreaId = area.id;
          walkItemMenu = null;
          render();
        },
      }));
    });
  }

  // Filled on the bid's own walk, where it is the only thing worth doing until
  // there is a room on the list (the pinned Next below is greyed until then).
  // Outlined on a change order, where the pinned "Next: Labor" is never greyed
  // and is therefore the one filled navy button on the screen: a change order
  // can be labor only, so "+ Area" there is a real second choice, not the way
  // forward. Two filled blocks would be two ways forward, which is one too many.
  section.appendChild(textButton('+ Area', 'btn ' + (co ? 'btn-outline' : 'btn-primary') + ' btn-block',
    () => walkAddArea(edit)));
  host.appendChild(section);

  // A change order is areas and labor and nothing else. The misc line, the
  // did-you-forget list and the rental placeholders all belong to the bid,
  // where they are already priced — charging them a second time on the change
  // order is the one mistake a change order must never make.
  if (co) {
    // Never disabled, unlike the bid's own walk below. Half the change orders
    // he writes are pure labor — "they want the panel moved eight feet" — with
    // not one part on them, and a greyed Next on that walk is a dead end with
    // no other way out of the screen. The empty-bid reasoning does not carry
    // over: the bid already exists, this is an addition to it, and Labor is
    // where the addition gets its money.
    pinnedBar(host, 'Next: Labor', () => show('labor', { bidId: bid.id, changeOrderId: co.id }));
    return;
  }

  // --- The misc line ---
  // The handful of dollars nobody itemizes and everybody spends. One tap, one
  // number, and it is in the cost stack.
  const miscBox = card();
  const label = bid.misc.label || MISC_LABEL;
  const miscRow = row(label, BidMath.fmt(bid.misc.cents), () => {
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
  }, { keypad: true });
  miscBox.appendChild(miscRow);
  // A nudge, not a gate: a misc of $0 never reaches the customer's page (the
  // document only prints the row when it has money in it), so it is amber here
  // and is not one of the lines that blocks a PDF.
  //
  // And not on an empty bid. Before he has counted anything, every number on
  // the screen is zero and this one is not news — a warning that is on the
  // glass from the first second is a warning he stops reading by the third
  // bid. It appears once there is something on the bid to be missing hardware
  // for.
  const counted = (bid.areas || []).some((a) => (a.items || []).length > 0);
  if (counted && !(bid.misc.cents > 0)) miscBox.appendChild(unpricedWarn());
  host.appendChild(miscBox);

  const forget = buildForgetCard(bid);
  if (forget) host.appendChild(forget);

  // Greyed, not gone, on a walk with no rooms on it yet. A filled navy button
  // saying "Next" over an empty screen is the app telling him to move on from
  // work he has not started, and it is the loudest thing on the glass — louder
  // than "Tap + Area and name the first room", which is the only thing here
  // worth doing. Disabled, the empty-state line is the only call to action, and
  // one filled button per view is finally true.
  pinnedBar(host, 'Next: Labor', () => show('labor', bid.id), { disabled: areas.length === 0 });
}

function walkAddArea(edit) {
  promptText('', {
    label: 'Area name',
    placeholder: 'Where you are standing',
    done: (name) => {
      if (!name) return;
      const area = { id: Store.uid(), name, items: [], photoIds: [] };
      edit.areas.push(area);
      if (!persistOr(() => {
        const i = edit.areas.indexOf(area);
        if (i !== -1) edit.areas.splice(i, 1);
      })) { render(); return; }
      // He named the room because he is standing in it and about to count
      // things in it, so the new area opens rather than joining a list.
      navPush();
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

function renderWalkArea(bid, edit, area, host) {
  const co = edit === bid ? null : edit;
  // No inline Back any more: the header's Back button goes exactly one step
  // now, so two "‹ Back" buttons 40 px apart with different destinations is a
  // confusion this screen no longer has.
  // The room's name is the subject of this whole screen, not a label sitting
  // on the left of a row, so it goes over the top of it and centered - and
  // Rename underneath, where it is a small deliberate act rather than
  // something a thumb finds by aiming at the title.
  const head = screenHead(area.name || 'Area', null, { center: true });
  head.appendChild(textButton('Rename', 'link-btn link-btn-inline screen-head-action', () => {
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
  host.appendChild(head);

  const box = card();
  const items = area.items || [];
  if (items.length === 0) {
    box.appendChild(emptyNote('Tap + Item to add conduit, wire, boxes, or parts.'));
  } else {
    // What the line will PRINT at, which is what decides whether it is still
    // unpriced — an "Anything missing?" row lands here at $0 and has to say so
    // until he puts a number on it.
    const markup = BidMath.resolveMarkup(bid, state.data.settings);
    // One sentence per card, then a mark. See unpricedWarns in ui.js.
    const warn = unpricedWarns();
    items.forEach((it) => {
      const line = walkRow(
        it.name,
        itemCountText(it.qty, it.unit, it.costCents),
        BidMath.fmt(Math.round(it.qty * it.costCents)),
        () => { walkItemMenu = walkItemMenu === it ? null : it; render(); }
      );
      if (walkHighlightItem === it) line.classList.add('walk-row-new');
      box.appendChild(line);
      if (!(BidMath.itemPrice(it, markup).cents > 0)) box.appendChild(warn());
      // Inside this card, under the row that was tapped, indented - not
      // appended after the whole card, where the answer to "what about this
      // line?" used to appear under a heading belonging to something else.
      if (walkItemMenu === it) buildItemActions(box, line, area, it);
    });
  }

  // A lift he added standing in this room used to vanish: rentals are not
  // material lines and live on the bid, so the area he added it from showed
  // nothing at all and a banner sent him to a screen he was not on. It shows
  // here, as what it is — a line somebody else prices.
  //
  // ABOVE the area cost, not under it. Area cost is the total of the material
  // lines over it, and a row printed beneath a total reads as part of it: a
  // $0 lift under "Area cost $412.00" says the lift is in the 412, and it is
  // not — it is priced by the day on Costs & price.
  walkAreaRentals(bid, area).forEach((x) => {
    box.appendChild(walkRow(x.name || 'Rental', WALK_RENTAL_SUB, null, null));
  });
  if (items.length > 0) {
    box.appendChild(walkRow('Area cost', null, BidMath.fmt(walkAreaCost(area)), null));
  }
  host.appendChild(box);

  // Photos are a walk thing: he is standing in the room with the phone up. A
  // change order is written after the fact, so the camera stays off it.
  if (!co) host.appendChild(buildPhotoCard(area));

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('+ Item', 'btn btn-primary btn-block', () => {
    navPush();
    walkView = 'add';
    walkAddCat = null;
    walkAddSearch = '';
    walkItemMenu = null;
    render();
  }));
  // The destructive one goes last, where a thumb reaching for + Item never
  // lands on it by accident.
  nav.appendChild(textButton('Delete this area', 'btn btn-danger-outline btn-block',
    () => walkDeleteArea(edit, area)));
  host.appendChild(nav);

  // Done, not "+ Item": the pinned bar is the way OUT of the room, and the way
  // further in is the button in the flow above it.
  // Same rule as the areas list: nothing counted in this room yet, so there is
  // nothing to be done with, and "Tap + Item" is the only thing to do. The
  // header's Back still leaves the room.
  pinnedBar(host, 'Done', () => { walkView = 'areas'; walkItemMenu = null; render(); },
    { disabled: items.length === 0 });
}

async function walkDeleteArea(edit, area) {
  const items = (area.items || []).length;
  const photos = (area.photoIds || []).length;
  const carrying = (items || photos)
    ? ' It has ' + walkPlural(items, 'item', 'items') + ' and ' + walkPlural(photos, 'photo', 'photos') + '.'
    : '';
  const ok = await confirmPanel(
    'Delete ' + (area.name || 'this area') + '?' + carrying + " This can't be undone.",
    { ok: 'Delete', danger: true }
  );
  if (!ok) { render(); return; }

  const i = edit.areas.indexOf(area);
  if (i !== -1) {
    // The bid document is the truth, so it is written first — the same order,
    // and for the same reason, as deleting a single photo. If the blobs then
    // refuse to go they are left behind: a file nothing points at is invisible,
    // where an area put back by a refused save while its photos were already
    // deleted would be a row of grey tiles he could never clear.
    const orphans = (area.photoIds || []).slice();
    edit.areas.splice(i, 1);
    if (!persistOr(() => { edit.areas.splice(i, 0, area); })) { render(); return; }
    Photos.delMany(orphans);
  }
  walkView = 'areas';
  walkAreaId = null;
  walkItemMenu = null;
  render();
}

function buildItemActions(box, lineEl, area, it) {
  const strip = attachedStrip(lineEl, [
    { label: 'Quantity', onTap: () => {
      promptNumber(it.qty, {
        label: partQtyLabel(it.name, it.unit),
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
    } },
    { label: 'Cost', onTap: () => {
      promptMoney(it.costCents, {
        label: partCostLabel(it.name, it.unit),
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
    } },
    { label: 'Delete', cls: 'btn-danger-outline', onTap: async () => {
      const ok = await confirmPanel('Delete ' + it.name + '?', { ok: 'Delete', danger: true });
      if (!ok) { render(); return; }
      const i = area.items.indexOf(it);
      if (i !== -1) {
        area.items.splice(i, 1);
        persistOr(() => { area.items.splice(i, 0, it); });
      }
      walkItemMenu = null;
      render();
    } },
  ], { cancel: () => { walkItemMenu = null; render(); } });
  // The row is already in the card, so attachedStrip has placed it. This is the
  // belt-and-braces path for a caller that built the row off-screen.
  if (!strip.parentNode) box.appendChild(strip);
}

// ---------------------------------------------------------------------------
// ADD ITEM
// ---------------------------------------------------------------------------
// Six tiles, then a list, then two numbers. The hybrid: the catalog is there
// so he never types "3/4 EMT" again, and + New part is there so the one thing
// the catalog has never heard of doesn't stop the walk.

function renderWalkAdd(bid, edit, area, host) {
  const co = edit === bid ? null : edit;

  host.appendChild(screenHead('Add to ' + (area.name || 'this area'), null, { center: true }));

  if (walkAddPending) { host.appendChild(buildPriceAnswer(bid, area)); return; }
  if (walkAddNew) { host.appendChild(buildUnitPicker(bid, area)); return; }

  // What he has counted in this room so far, and what it costs him. He adds
  // eight things in a row without leaving this screen, so the running total is
  // the only way he can tell that any of it landed.
  host.appendChild(walkTallyStrip(area));

  // The search is ABOVE the tiles and searches everything: knowing the name of
  // the part is not the same as knowing which of six drawers this app filed it
  // under, and he knows the name. Redraws only the list below it — rebuilding
  // the input under a typing thumb would drop focus and close the keyboard.
  host.appendChild(searchInput({
    className: 'walk-search',
    placeholder: 'Search all parts',
    label: 'Search all parts',
    value: walkAddSearch,
    onInput: (value) => {
      // The first character is the step from the tiles into a list; the rest
      // are typing. One entry, so one Back puts the tiles back.
      if (walkAddSearch.trim() === '' && value.trim() !== '') navPush();
      walkAddSearch = value;
      if (walkAddListEl && walkAddListEl.isConnected) buildWalkAddBody(bid, area, walkAddListEl, !!co);
      else render();
    },
  }));

  walkAddListEl = document.createElement('div');
  buildWalkAddBody(bid, area, walkAddListEl, !!co);
  host.appendChild(walkAddListEl);

  // The way out of the add flow that is not Back: he is done counting in this
  // room, rather than one step up the list. Pinned, because it is eleven rows
  // down a parts list by the time he wants it.
  pinnedBar(host, 'Done', () => {
    walkView = 'area';
    walkAddCat = null;
    walkAddSearch = '';
    render();
  });
}

// Tiles, or a list. A search beats a category — typing crosses all six drawers,
// which is what Catalog.matches does with a query — and clearing it puts the
// tiles back exactly where they were.
function buildWalkAddBody(bid, area, host, onChangeOrder) {
  host.textContent = '';
  if (walkAddSearch.trim() === '' && !walkAddCat) {
    host.appendChild(buildCategoryTiles(onChangeOrder));
    return;
  }
  const box = card();
  buildCatalogList(bid, area, box, onChangeOrder);
  host.appendChild(box);
}

// "3 items · $412.00" — the area's own running total, at cost. The arithmetic
// is areaTallyText in ui.js, where it is pure and tested; this only decides
// whether it flashes, which it does for a second after something is added.
function walkTallyStrip(area) {
  const strip = document.createElement('div');
  strip.className = 'walk-tally';
  strip.textContent = areaTallyText(area);
  if (walkHighlightItem) strip.classList.add('walk-row-new');
  return strip;
}

// onChangeOrder drops the rentals tile: a rental line lives on the bid's own
// rentals list, which a change order does not have and must not borrow.
function buildCategoryTiles(onChangeOrder) {
  const grid = document.createElement('div');
  grid.className = 'walk-tiles';
  CATALOG_CATEGORIES.filter(([key]) => !(onChangeOrder && key === 'rentals')).forEach(([key, label]) => {
    grid.appendChild(textButton(label, 'walk-tile', () => {
      // Rentals and owned equipment are not material lines — they are priced
      // per day on the Costs & price screen (Task 9). All this tile does is
      // get the line onto the bid before he forgets it exists.
      navPush();
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

// Which parts to offer and in what order is a rule, not a rendering decision,
// so it lives in catalog.js where it is pure and tested: hidden ones excluded,
// rentals kept out of the material lists, search crossing categories, most-used
// first. This screen only decides what to do with what comes back.
function walkCatalogMatches(onChangeOrder) {
  const searching = walkAddSearch.trim() !== '';
  return Catalog.matches(state.data.catalog, {
    category: walkAddCat,
    query: walkAddSearch,
    // A search crosses the drawers, and rentals are one of the drawers. He
    // types "scissor lift" because a scissor lift is the thing he needs; a
    // search that hides it offered him "+ New part" instead, and the lift went
    // on the bid as a gear line at material markup. Only a search reaches
    // them — the browsing lists still keep rentals out, because they are not
    // material — and a change order never does: it has no rentals list of its
    // own and must not borrow the bid's.
    includeRentals: searching && !onChangeOrder,
  });
}

function buildCatalogList(bid, area, box, onChangeOrder) {
  box.textContent = '';
  const searching = walkAddSearch.trim() !== '';

  const h = document.createElement('h3');
  h.className = 'card-title';
  h.textContent = searching ? 'All parts' : catalogCategoryLabel(walkAddCat);
  box.appendChild(h);

  const list = walkCatalogMatches(onChangeOrder);
  if (list.length === 0) {
    box.appendChild(emptyNote(searching ? 'Nothing matches that.' : 'Nothing in here yet.'));
  } else {
    list.forEach((p) => {
      // Search crosses categories on purpose — typing "3/4" should find the
      // hubs as well as the EMT — so each row has to say which drawer it came
      // out of, or two identical-looking names are indistinguishable.
      const sub = searching ? catalogCategoryLabel(p.category) : '';
      const value = p.lastCostCents === null
        ? p.unit
        : BidMath.fmt(p.lastCostCents) + ' / ' + p.unit;
      box.appendChild(walkRow(p.name, sub, value, () => walkPickPart(bid, area, p), { keypad: true }));
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
  CATALOG_UNITS.forEach((unit) => {
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
  // The catalog carries a rentals category, and a lift is not a material line:
  // priced as one it would take material markup and be counted in the material
  // total. It goes where rentals go, whatever list he found it in.
  if (part.category === 'rentals') {
    walkAddRental(bid, part.name, 'add', null);
    return;
  }
  promptNumber(null, {
    label: partQtyLabel(part.name, part.unit || 'ea'),
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
  box.appendChild(walkRow(part.name, itemCountText(qty, part.unit, part.lastCostCents), null, null));

  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton(
    'Same price (' + BidMath.fmt(part.lastCostCents) + ')',
    'btn btn-primary btn-block',
    () => walkCommitItem(bid, area, part, qty, part.lastCostCents)
  ));
  // The pending state is NOT cleared here: walkCommitItem owns clearing it. If
  // he cancels the cost keypad, this view is still what is on the glass and
  // Back still walks one step, rather than the screen and the state disagreeing.
  nav.appendChild(textButton('Different price', 'btn btn-block', () => {
    walkAskCost(bid, area, part, qty);
  }));
  box.appendChild(nav);
  return box;
}

function walkAskCost(bid, area, part, qty) {
  promptMoney(part.lastCostCents, {
    label: partCostLabel(part.name, part.unit || 'ea'),
    done: (cents) => {
      // Clear on the cost keypad means "I don't know yet". The count he just
      // walked off is worth more than the price he hasn't looked up, so the
      // line goes on at zero and shows on the bid until it has been priced.
      const zero = cents === null;
      if (walkCommitItem(bid, area, part, qty, zero ? 0 : cents) && zero) {
        showBanner('Added at $0. Put a price on it when you know it');
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

  // He stays in the list he was looking at. Eight items used to be eight round
  // trips out to the area and back in through the tiles; the running strip at
  // the top is what says the last one landed, and Done is the way out.
  walkAddPending = null;
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
    ids.forEach((id, i) => strip.appendChild(walkThumb(id, token, i + 1, ids.length)));
    box.appendChild(strip);
  }

  // Shrinking a 12-megapixel photo takes long enough to be a moment of doubt,
  // and the button has to answer "did that work?" rather than sit there looking
  // ready. Anything he takes while it is working is queued, never dropped, and
  // the count says so.
  const bar = document.createElement('div');
  bar.className = 'bid-nav';
  const waiting = walkPhotoQueue.length;
  const photoBtn = textButton(
    walkPhotoBusy ? ('Saving photo…' + (waiting ? ' (' + (waiting + 1) + ')' : '')) : '+ Photo',
    'btn btn-block',
    () => {
      const input = el('walkPhotoInput');
      if (input) input.click();
    }
  );
  if (walkPhotoBusy) {
    photoBtn.disabled = true;
    photoBtn.setAttribute('aria-busy', 'true');
  }
  bar.appendChild(photoBtn);
  box.appendChild(bar);
  return box;
}

function walkThumb(id, token, n, total) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'walk-thumb';
  btn.setAttribute('aria-label', 'Open photo ' + n + ' of ' + total);
  const img = document.createElement('img');
  img.alt = '';
  btn.appendChild(img);
  btn.addEventListener('click', () => { navPush(); walkPhotoOpenId = id; render(); });
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
    const files = input.files ? Array.prototype.slice.call(input.files) : [];
    // Cleared before the work starts, so photographing the same thing twice in
    // a row still fires a change event the second time.
    input.value = '';
    const bid = walkBid();
    const area = bid && walkCurrentArea(bid);
    if (!area) return;
    // The bid AND the area are pinned now rather than read later: the queue is
    // drained asynchronously, and by the time it gets there he may have walked
    // into the next room — or backed out to a different bid entirely.
    files.forEach((file) => walkQueuePhoto(file, bid.id, area.id));
  });
}

function walkQueuePhoto(file, bidId, areaId) {
  walkPhotoQueue.push({ file, bidId, areaId });
  // A second photo taken while the first is still compressing used to be
  // dropped on the floor without a word. Now it waits its turn.
  if (walkPhotoBusy) { render(); return; }
  walkDrainPhotos();
}

async function walkDrainPhotos() {
  if (walkPhotoBusy) return;
  walkPhotoBusy = true;
  try {
    while (walkPhotoQueue.length) {
      // Shift FIRST, then draw: the queue is what is still WAITING, and the
      // button counts it plus the one in hand. Rendering before the shift
      // counted the photo being compressed twice, so one photo came up as
      // "Saving photo… (2)". The render still happens before the await, so
      // the button answers the tap as immediately as it did.
      const next = walkPhotoQueue.shift();
      render();
      await walkStorePhoto(next.file, next.bidId, next.areaId);
    }
  } finally {
    walkPhotoBusy = false;
    render();
  }
}

async function walkStorePhoto(file, bidId, areaId) {
  const blob = await walkShrink(file);
  if (!blob) { showBanner("Couldn't read that photo", 'danger'); return; }

  const id = Store.uid();
  // The blob goes first: an id in the bid with no file behind it is a
  // permanently grey tile, and IndexedDB is much the likelier half to refuse
  // (a full phone) than localStorage is.
  const stored = await Photos.put(id, blob, 'photo');
  if (!stored) { showBanner("Photo didn't save (storage full?)", 'danger'); return; }

  // Resolved here, not before the work: shrinking a photo takes long enough for
  // the area to be deleted, or a different bid opened, while this one was still
  // in the queue. The bid it was taken for, by id — never whatever is on screen
  // now. A photo that has nowhere to go is said out loud rather than dropped in
  // silence (he took it for a reason), and the blob is taken back out so it is
  // not left behind with nothing pointing at it.
  const bid = state.data.bids.find((b) => b.id === bidId);
  const area = bid && (bid.areas || []).find((a) => a.id === areaId);
  if (!area) {
    showBanner("Photo couldn't be filed (area was removed)", 'danger');
    Photos.del(id);
    return;
  }

  area.photoIds.push(id);
  if (!persistOr(() => {
    const i = area.photoIds.indexOf(id);
    if (i !== -1) area.photoIds.splice(i, 1);
    Photos.del(id);
  })) { render(); return; }
  render();
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
    // A phone writes which way up it was held into EXIF rather than rotating
    // the pixels, and a canvas only ever sees the pixels. Asking for the
    // orientation to be applied is the difference between a readable nameplate
    // and one lying on its side; older browsers throw on the options argument,
    // so the bare call is still there behind it.
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
    if (!src) { try { src = await createImageBitmap(file); } catch (e) { src = null; } }
  }
  if (!src) src = await walkLoadImage(file);
  if (!src) return null;

  // An ImageBitmap holds decoded pixels — tens of megabytes for a phone photo —
  // until it is closed, so every way out of here goes past the finally.
  try {
    const w0 = src.naturalWidth || src.width;
    const h0 = src.naturalHeight || src.height;
    // Zeros come back for anything that isn't a real size — a file that
    // decoded into nothing is not a photo.
    const fit = Catalog.fitWithin(w0, h0, WALK_MAX_EDGE);
    if (!fit.w || !fit.h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = fit.w;
    canvas.height = fit.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(src, 0, 0, fit.w, fit.h);
    } catch (e) {
      return null;
    }

    return await new Promise((resolve) => {
      try { canvas.toBlob((b) => resolve(b || null), 'image/jpeg', WALK_JPEG_QUALITY); }
      catch (e) { resolve(null); }
    });
  } finally {
    if (typeof src.close === 'function') src.close();
  }
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
// The Costs & price screen owns what a rental or a piece of his own equipment
// costs per day. What the walk owns is remembering it exists: standing under
// the high bays is when he knows he needs a lift, and the number goes on it two
// screens later. The naming step and the tool picker are shared with that
// screen (promptRentalName / equipmentPickerCard in ui.js) so there is one way
// to name a rental in this app, not one per screen.

function buildWalkSheet(bid) {
  const wrap = document.createElement('div');
  wrap.className = 'walk-sheet';

  // Read now, not in the callbacks: the sheet is torn down before they run.
  const from = walkSheet.from;
  const forgetRow = walkForgetRow;

  if (walkSheet.kind === 'equip') {
    // The same picker the price screen puts up, from ui.js: one list, one
    // order, one place a tool's day rate is worked out. What the walk does
    // with the pick — a $0 placeholder line — is the part that is its own.
    const settings = state.data.settings;
    const box = equipmentPickerCard('Which piece of equipment?', settings.equipment, settings.equipmentPct,
      (e) => walkAddEquipment(bid, e, from, forgetRow));
    box.appendChild(textButton('Cancel', 'link-btn sheet-cancel', walkCloseSheet));
    wrap.appendChild(box);
    return wrap;
  }

  const box = card('Rented, or your own?');
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  nav.appendChild(textButton('Rental', 'btn btn-block', () => walkAddRental(bid, '', from, forgetRow)));
  nav.appendChild(textButton('Owned equipment', 'btn btn-block', () => {
    // A step deeper inside the sheet is still a step: it pushes, and Back
    // brings the "Rented, or your own?" question back rather than closing the
    // whole sheet and losing the answer he had already given.
    navPush();
    walkSheet = { kind: 'equip', from, back: 'rentEquip' };
    render();
  }));
  box.appendChild(nav);
  box.appendChild(textButton('Cancel', 'link-btn sheet-cancel', walkCloseSheet));
  wrap.appendChild(box);
  return wrap;
}

function walkCloseSheet() {
  walkSheet = null;
  walkForgetRow = null;
  render();
}

// ---------------------------------------------------------------------------
// The did-you-forget answers, on the bid
// ---------------------------------------------------------------------------
// bid.forgetAnswers is an optional map of row name -> 'no' | 'added'. A row
// with no key is unanswered. The field is optional because a backup written
// before it existed has to restore, so every read goes through here rather
// than touching bid.forgetAnswers directly.

// What this row becomes when he taps "Add it", by NAME: the card and the
// answers work in names, so the row object is looked back up here. A name that
// is no longer on the list (he renamed it since answering) reads off its own
// words through Store.forgetKind, which is what a hand-typed row does anyway.
function walkForgetKind(name) {
  const list = state.data.settings.forgetList || [];
  const row = list.find((r) => Store.forgetName(r) === name);
  return Store.forgetKind(row === undefined ? name : row);
}

function walkForgetAnswerOf(bid, name) {
  const a = bid.forgetAnswers;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined;
  return a[name];
}

// Writes an answer and hands back the undo, WITHOUT saving: the caller folds
// this into the one persistOr that also carries whatever was added to the bid,
// so an answer of 'added' and the line it is about reach the disk together or
// not at all.
function walkForgetMark(bid, name, value) {
  const hadField = !!bid.forgetAnswers && typeof bid.forgetAnswers === 'object' && !Array.isArray(bid.forgetAnswers);
  if (!hadField) bid.forgetAnswers = {};
  const map = bid.forgetAnswers;
  const had = Object.prototype.hasOwnProperty.call(map, name);
  const prev = map[name];
  map[name] = value;
  return () => {
    if (!hadField) { delete bid.forgetAnswers; return; }
    if (had) map[name] = prev;
    else delete map[name];
  };
}

// from and forgetRow travel as arguments rather than as module state, because
// promptText's Cancel calls nothing at all: state set on the way in would have
// no way to be cleared on the way out, and would still be sitting there the
// next time something read it.
function walkAddRental(bid, prefill, from, forgetRow) {
  // Which room he was standing in when he said he needed a lift. Optional and
  // display-only: the area list uses it to show the line he just added instead
  // of swallowing it. A rental named anywhere else simply has none.
  const areaId = (from === 'add' && walkAreaId) ? walkAreaId : null;
  promptRentalName(state.data.catalog, prefill, (name) => {
    const line = { name, days: 1, cents: 0, markup: false };
    if (areaId) line.areaId = areaId;
    bid.rentals.push(line);
    // The checklist row is answered by the same save that carries the line.
    // Cancel out of the name panel and this never runs, which is the point:
    // a row is only 'added' once something really was.
    const undoAnswer = forgetRow ? walkForgetMark(bid, forgetRow, 'added') : null;
    if (!persistOr(() => {
      const i = bid.rentals.indexOf(line);
      if (i !== -1) bid.rentals.splice(i, 1);
      if (undoAnswer) undoAnswer();
    })) { render(); return; }
    walkAfterPlaceholder(from, forgetRow, name + ' · ' + WALK_RENTAL_SUB + '.');
  });
}

// His own tools carry their day rate with them, so the line the walk leaves is
// a priced one: a threader at $50 a day, one day, and the days are what the
// Costs & price screen is for. The rate comes out of Settings the same way the
// price screen's picker reads it, which is why a tool with no cost on it yet is
// asked about HERE rather than quietly added at $0 — a $0 equipment line is a
// day of his own gear given away, and it looks exactly like a priced one.
function walkAddEquipment(bid, equip, from, forgetRow) {
  // The same rule the Costs & price picker follows: one line per tool. Days is
  // the quantity, and a second "Bender" row bills the tool twice. Answering the
  // checklist row is still right — the bid does cover it — so the row is marked
  // added the way walkForgetAdd marks one it found already there.
  if (Store.bidEquipmentLine(bid, equip.id)) {
    if (forgetRow) persistOr(walkForgetMark(bid, forgetRow, 'added'));
    walkAfterPlaceholder(from, forgetRow, (equip.name || 'That tool') + ' is already on the bid.');
    return;
  }

  const settings = state.data.settings;
  const rate = equipmentDayCents(equip, settings.equipmentPct);
  if (rate != null) { walkPushEquipment(bid, equip, rate, from, forgetRow); return; }

  promptMoney(null, {
    label: 'What does a ' + (equip.name || 'tool') + ' cost new?',
    done: (cents) => {
      if (cents === null || !(cents > 0)) return;
      const prev = equip.costCents;
      equip.costCents = cents;
      // The Settings write lands on its own: the cost of a tool is true whether
      // or not the line that asked for it makes it onto the bid, and a refused
      // save here must not leave Settings holding a number the disk never took.
      if (!persistOr(() => { equip.costCents = prev; })) { render(); return; }
      const made = equipmentDayCents(equip, settings.equipmentPct);
      walkPushEquipment(bid, equip, made == null ? 0 : made, from, forgetRow);
    },
  });
}

function walkPushEquipment(bid, equip, dayCents, from, forgetRow) {
  const line = { equipmentId: equip.id, name: equip.name, days: 1, dayCents };
  bid.equipment.push(line);
  const undoAnswer = forgetRow ? walkForgetMark(bid, forgetRow, 'added') : null;
  if (!persistOr(() => {
    const i = bid.equipment.indexOf(line);
    if (i !== -1) bid.equipment.splice(i, 1);
    if (undoAnswer) undoAnswer();
  })) { render(); return; }
  walkAfterPlaceholder(from, forgetRow,
    'Added at ' + moneyText(dayCents) + ' a day. Set the days on the Costs & price screen.');
}

function walkAfterPlaceholder(from, forgetRow, message) {
  walkForgetRow = null;
  walkForgetPick = null;
  walkSheet = null;
  // Coming out of the add-item flow, the area he was working in is where he
  // belongs — the rental line itself does not live in an area.
  if (from === 'add') {
    walkView = 'area';
    walkAddCat = null;
    walkAddSearch = '';
  }
  showBanner(message || 'Added. Price it on the Costs & price screen.', 'ok');
  render();
}

// ---------------------------------------------------------------------------
// FORGET LIST
// ---------------------------------------------------------------------------
// The things that are invisible on a walk and expensive on a job. The answers
// live on the bid (bid.forgetAnswers), not in a Set that dies with the screen:
// he answers seven rows standing in a plant, puts the phone away, and opening
// the bid again to find seven questions waiting is how the checklist stops
// meaning anything. Every answer is undoable — the ✓ is a button that puts the
// question back — because "No" said by a thumb is not a decision he should
// have to live with.

// One row of the checklist, question or answer. Both shapes are built here so
// the answered ones look like the same row folded, not like a different list.
function buildForgetRow(box, bid, name, answered) {
  const line = document.createElement('div');
  line.className = 'walk-forget';

  const label = document.createElement('span');
  label.className = 'walk-forget-label';
  label.textContent = name;
  line.appendChild(label);

  if (answered) {
    // A real button, not a glyph: the answer is a thing he can change, and
    // the only way he finds that out is if it takes a tap.
    const tick = textButton('✓ Answered', 'btn walk-forget-tick', () => walkForgetUnanswer(bid, name));
    tick.setAttribute('aria-label', 'Answered · tap to ask again');
    tick.title = 'Answered · tap to ask again';
    line.appendChild(tick);
  } else {
    // The same two-button shape every inline menu in this app wears — the
    // attached strip's own class, so these rows and the "Which area?" strip
    // that opens under them are visibly one thing rather than two.
    //
    // Both outlined. The pinned "Next: Labor" is the one filled navy button on
    // this screen, and a checklist of seven rows with a filled button on every
    // one of them is seven primary actions, which is none.
    const acts = document.createElement('div');
    acts.className = 'attached-strip-btns walk-forget-acts';
    acts.appendChild(textButton('Not this job', 'btn btn-outline', () => {
      const undo = walkForgetMark(bid, name, 'no');
      persistOr(undo);
      walkForgetPick = null;
      render();
    }));
    acts.appendChild(textButton('Add it', 'btn btn-outline', () => walkForgetAdd(bid, name)));
    line.appendChild(acts);
  }

  box.appendChild(line);

  // "Which area?" - only up while this row is asking it, and attached to the
  // row that asked in the one shape every inline menu in this app now wears.
  if (walkForgetPick === name) buildForgetAreaPicker(box, line, bid, name);
}

// The questions still open, then everything he has already answered folded
// into ONE line at the bottom. Seven checkmarks filled half the walk and
// pushed the two rows he had not answered yet off the screen — the card is a
// list of what is left, and the answers are the receipt underneath it.
//
// The fold is a button, and its own label says so. Tapping it opens the rows,
// each still tappable, so undoing an answer is two taps rather than hidden.
function buildForgetCard(bid) {
  // The rows carry a kind now ({ name, kind }), and a row he typed in Settings
  // is still a plain string. Everything on this screen works in NAMES, because
  // that is what bid.forgetAnswers is keyed by and what he reads on the glass.
  const list = (state.data.settings.forgetList || []).map((row) => Store.forgetName(row)).filter(Boolean);
  if (list.length === 0) return null;

  const box = card('Anything missing?');
  const answered = list.filter((name) => {
    const a = walkForgetAnswerOf(bid, name);
    return a === 'no' || a === 'added';
  });
  const open = list.filter((name) => answered.indexOf(name) === -1);

  if (open.length === 0 && answered.length) box.appendChild(emptyNote('All answered.'));
  open.forEach((name) => buildForgetRow(box, bid, name, false));

  if (answered.length === 0) return box;

  box.appendChild(textButton(
    'Answered: ' + answered.join(', ') + (walkForgetOpen ? ' · tap to fold up' : ' · tap to change'),
    'link-btn walk-forget-fold',
    () => { walkForgetOpen = !walkForgetOpen; walkForgetPick = null; render(); }
  ));
  if (walkForgetOpen) answered.forEach((name) => buildForgetRow(box, bid, name, true));
  return box;
}

// The chips he picks an area with when the bid has more than one. Attached
// under the row that asked, so the question and the answer are in one place.
function buildForgetAreaPicker(box, lineEl, bid, name) {
  const chips = document.createElement('div');
  chips.className = 'equip-chips';
  (bid.areas || []).forEach((area) => {
    chips.appendChild(chip(area.name || 'Area', false, () => walkForgetAddToArea(bid, name, area)));
  });

  const strip = attachedStrip(lineEl, [], {
    label: 'Which area?',
    content: chips,
    cancel: () => {
      // Backing out leaves the row unanswered, which is the truth: he has not
      // said no to permits, he has said not now.
      walkForgetPick = null;
      render();
    },
  });
  if (!strip.parentNode) box.appendChild(strip);
}

function walkForgetUnanswer(bid, name) {
  const map = bid.forgetAnswers;
  if (!map || typeof map !== 'object' || Array.isArray(map)) { render(); return; }
  if (!Object.prototype.hasOwnProperty.call(map, name)) { render(); return; }
  const prev = map[name];
  delete map[name];
  persistOr(() => { map[name] = prev; });
  walkForgetPick = null;
  render();
}

// Is this row's line already sitting on the bid? The ✓ puts the question back
// but does NOT take the line away — undoing an answer is not undoing an item —
// so "Add it" a second time used to push a second identical one, and he found
// two lift rentals on the proposal with no memory of adding either.
function walkForgetHasLine(bid, name) {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  const same = (n) => String(n == null ? '' : n).trim().toLowerCase() === key;
  return (bid.areas || []).some((a) => (a.items || []).some((it) => same(it.name)))
    || (bid.rentals || []).some((x) => same(x.name))
    || (bid.equipment || []).some((x) => same(x.name));
}

function walkForgetAdd(bid, name) {
  const key = name.trim().toLowerCase();

  // Already there. Answer the row rather than adding a twin: the checklist is
  // asking whether the bid covers this, and it does.
  if (walkForgetHasLine(bid, name)) {
    persistOr(walkForgetMark(bid, name, 'added'));
    walkForgetPick = null;
    showBanner(name + ' is already on the bid.');
    render();
    return;
  }

  // WHERE THE MONEY FOR THIS ROW ACTUALLY GETS PRICED. Some of these rows are
  // not material at all, and the row itself says which: the seeded list carries
  // a kind ('rental' or 'item') per row, so "Shutdown windows / after-hours"
  // reaches the rental side without anybody having to read the words and
  // guess. A row he typed in Settings has no kind, and Store.forgetKind falls
  // back to the old rule for it — anything saying rental or lift is a rental,
  // his own gear is the tool picker, everything else is a line in an area.
  if (walkForgetKind(name) === 'rental') {
    // One kind, two doors: his OWN tools are picked out of the equipment list
    // (they have a cost and a derived day rate already), and everything else
    // is named on the rental prompt.
    if (key.indexOf('equipment') !== -1 || key.indexOf('owned tool') !== -1) {
      // The sheet is a step deeper, so it pushes — without this the swipe that
      // closes it spent an entry belonging to the area list underneath, and the
      // next one after that took him out of the app.
      navPush();
      walkForgetRow = name;
      walkForgetPick = null;
      walkSheet = { kind: 'equip', from: 'forget' };
      render();
      return;
    }
    walkSheet = null;
    walkForgetRow = null;
    walkForgetPick = null;
    walkAddRental(bid, name, 'forget', name);
    return;
  }

  // Everything else becomes a line in one of HIS areas, priced on the way in.
  // It used to
  // invent an area called "General", which put a room on the bid that he never
  // walked and that the proposal then printed. The bid's own areas are the only
  // places work belongs:
  //
  //   one area   — it goes there, no question asked
  //   several    — he says which, on chips under the row
  //   none       — there is nowhere to put it yet, so say so and add nothing
  const areas = bid.areas || [];
  if (areas.length === 0) {
    showBanner('Add an area first, then tap Add it.');
    walkForgetPick = null;
    render();
    return;
  }
  if (areas.length === 1) { walkForgetAddToArea(bid, name, areas[0]); return; }
  walkForgetPick = name;
  render();
}

// The area is settled; the price is the same tap chain. "Where does the number
// get added when clicking Add it" was the question, and the honest answer used
// to be "on the item, in the area, one tap away, and nothing says so." Now the
// keypad comes up with the row's own name on it, and the item lands priced.
//
// Clear is a real answer here, the same as it is on the misc line: he does not
// know what the permits cost yet, so the line lands at $0 and wears the amber
// flag until he does. Cancel is not an answer at all — nothing is added and the
// row stays open, which is what backing out of the "Which area?" chips does too.
function walkForgetAddToArea(bid, name, area) {
  // The chips have done their job; taking them down before the keypad opens
  // means the answer to "which area?" is not still sitting on the glass
  // underneath a panel asking something else.
  walkForgetPick = null;
  render();
  promptMoney(0, {
    label: name + ', how much?',
    caption: 'Clear if you do not know yet.',
    done: (cents) => walkForgetCommitItem(bid, name, area, cents === null ? 0 : cents),
  });
}

// The item and the answer reach the disk together or not at all: the row is
// only 'added' once the line it is about really was saved.
function walkForgetCommitItem(bid, name, area, costCents) {
  const item = { catalogId: null, name, unit: 'lot', qty: 1, costCents, priceCents: null };
  area.items.push(item);
  const undoAnswer = walkForgetMark(bid, name, 'added');

  if (!persistOr(() => {
    const i = area.items.indexOf(item);
    if (i !== -1) area.items.splice(i, 1);
    undoAnswer();
  })) { render(); return; }

  walkForgetPick = null;
  // His words, from the wording table: the area is the one he just picked (or
  // the only one there is), so naming it again is noise in front of the thing
  // he has to do.
  showBanner(costCents > 0
    ? name + ' added at ' + moneyText(costCents) + '.'
    : name + ' added. Tap it to put a price on it.', 'ok');
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

  // A change order can be deleted on the job screen while its walk is one Back
  // tap away. Say so, rather than showing live buttons that would write onto
  // an object nothing points at any more.
  const co = walkChangeOrder(bid);
  if (walkCoId && !co) {
    host.appendChild(emptyNote("That change order isn't here anymore. Tap Back to return to the job."));
    return;
  }
  const edit = co || bid;

  // An area can go away underneath a view (a stale id after an import), and an
  // empty area view with live buttons on it is worse than the list.
  let area = null;
  if (walkView === 'area' || walkView === 'add') {
    area = walkCurrentArea(edit);
    if (!area) { walkView = 'areas'; walkAreaId = null; }
  }

  if (walkView === 'add') renderWalkAdd(bid, edit, area, host);
  else if (walkView === 'area') renderWalkArea(bid, edit, area, host);
  else renderWalkAreas(bid, edit, host);

  if (walkSheet) host.appendChild(buildWalkSheet(bid));
  if (walkPhotoOpenId && area) host.appendChild(buildPhotoView(area, walkPhotoOpenId));
}

// ONE step back, which on this screen is one of six: an open photo, a sheet,
// the price answer or the unit picker, the category list, the tiles, the area.
// Only when all of those are behind him does Back leave the walk — the header
// used to throw him straight out to the bid hub from four levels in, which is
// why the screen grew a second Back button of its own.
//
// peek: answer without moving. The shell asks before it draws the button, so
// it can say "‹ Bid" only where Back really goes to the bid.
function walkBackStep(peek) {
  if (walkPhotoOpenId) { if (!peek) { walkPhotoOpenId = null; render(); } return true; }
  if (walkSheet) {
    // The equipment picker reached from "Rented, or your own?" pushed an entry
    // of its own, so one Back spends it going back up to that question; the
    // next one closes the sheet. Every other sheet is one step and closes.
    if (walkSheet.back) {
      if (!peek) { walkSheet = { kind: walkSheet.back, from: walkSheet.from }; render(); }
      return true;
    }
    if (!peek) walkCloseSheet();
    return true;
  }
  if (walkView === 'add') {
    if (walkAddPending || walkAddNew) {
      if (!peek) { walkAddPending = null; walkAddNew = null; render(); }
      return true;
    }
    // A search and a category are the same step out of the tiles, and both go
    // back to them rather than all the way out of the add flow.
    if (walkAddCat || walkAddSearch.trim() !== '') {
      if (!peek) { walkAddCat = null; walkAddSearch = ''; render(); }
      return true;
    }
    if (!peek) { walkView = 'area'; render(); }
    return true;
  }
  if (walkView === 'area') {
    if (!peek) { walkView = 'areas'; walkItemMenu = null; render(); }
    return true;
  }
  return false;
}

// leave(): the last render before a navigation never gets a next render to
// take its object URLs back, so the shell asks for them on the way out. The
// token is bumped FIRST, which is what cancels the thumbnail fills still in
// flight: one resolving after the release would hand out one more URL, with no
// render left to revoke it.
function walkLeave() {
  walkRenderToken += 1;
  walkReleasePhotoUrls();
}

// title and back are functions because this is two screens wearing one file:
// the bid's own walk, and one change order's. The shell reads both after
// enter() has settled which of the two it is looking at.
registerScreen('walk', {
  id: 'screen-walk', tab: 'bids',
  title: () => {
    const co = walkChangeOrder(walkBid());
    return co ? 'Change order: ' + (co.name || 'Change order') : 'Walkthrough';
  },
  back: () => (walkCoId ? 'job' : 'bid'),
  backStep: walkBackStep,
  enter: enterWalk, leave: walkLeave, render: renderWalk,
});
