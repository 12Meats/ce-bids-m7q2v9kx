'use strict';

// screens/price.js — what the job costs him, and what he sells it for.
//
// This is the screen that decides the number on the customer's proposal, so
// the rule the whole file is built around is: NOTHING here does pricing
// arithmetic. Every figure on the glass is a value handed back by BidMath —
// costStack for the cost side, solve() for the three handles, itemPrice /
// rentalPrice / equipmentLine for the per-line money. The one subtraction in
// the file is payroll burden (laborCost − wageCents), which is two stack
// fields and is commented where it happens. A second opinion about a price is
// how a bid goes out wrong.
//
// Four cards, in the order he reads them:
//
//   Rentals / Equipment — the last costs that aren't material or labor. The
//                         walk leaves $0 placeholders here ("I need a lift");
//                         this is where the lift gets a number.
//   What this job costs you — the cost stack, his eyes only. Every percentage
//                         in it is tappable, because the moment he disagrees
//                         with a number is the moment he is looking at it.
//   Your price          — margin, labor rate, and bid price. Three ways of
//                         saying the same thing: move one and the other two
//                         follow, because BidMath.solve is asked which triple
//                         they now make, and the answer is what goes on screen.
//   The readouts        — the floor, his usual rate, and what a part prints
//                         at. Four sentences, no controls.
//
// The percentages split two ways, and the screen never blurs them:
//
//   THIS BID   — material markup and the hours cushion. They live on the bid;
//                editing one changes this job and nothing else, and the keypad
//                label says "this bid".
//   SETTINGS   — payroll burden, consumables, overhead, and the truck day
//                rate. They re-figure what EVERY bid in the file COSTS, and so
//                what margin each one is really running at — including bids
//                already sitting in a customer's inbox. Their prices don't
//                move (a price is built from the rate stored on that bid), and
//                the confirmation says exactly that. Each one asks every single
//                time, not once a session.
//
// Every mutation is snapshot -> mutate -> persistOr(revert), and nothing
// navigates after a refused save.
//
// Sections, in order:
//   VIEW STATE  — the enter hook, the transient flags, small builders
//   RENTALS     — the rental lines and adding one
//   EQUIPMENT   — his own tools: the picker, the day rate, the lines
//   COST STACK  — what the job costs him, row by row, down to true cost
//   HANDLES     — margin / rate / price, all three through solve()
//   READOUTS    — the floor, his usual rate, and what a part prints at
//   REGISTER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

const PRICE_MARGIN_PILLS = [15, 20, 25, 30];
const PRICE_MAX_PCT = 100;
// Keys a percentage may take, decimal point included — "100.0" is five.
const PRICE_PCT_KEYS = 5;
// Keys a day count may take: "365.25" is six.
const PRICE_DAY_KEYS = 6;
// A year on one line. Not a real limit on the work, a limit on the typo.
const PRICE_MAX_DAYS = 365;
const PRICE_TOP_ITEMS = 3;

let priceMenu = null;      // the rental/equipment line showing its actions
let pricePicker = false;   // true while the tool picker is up
let priceHoursMenu = false; // the hours line showing cushion / bid hours
// What BidMath made of the price he typed:
//   { kind: 'rounded' | 'floored' | 'no-labor', priceCents, fixedPrice }
// Three different pieces of news, and they must not wear each other's words.
// The kind is solve()'s `why` (minus 'exact', which has nothing to say); this
// screen only picks the sentence.
let priceWhy = null;

function priceClearTransient() {
  priceMenu = null;
  pricePicker = false;
  priceHoursMenu = false;
  priceWhy = null;
}

// The screen's enter hook. show('price', id) opens that bid; show('price') —
// what the Back button and the tab bar do — keeps the bid we already had. None
// of the three flags above should survive a navigation: a half-open tool
// picker, a Delete row on a line, and a note explaining a price he typed a
// screen ago are all answers to a question he has stopped asking.
function enterPrice(bidId) {
  if (typeof bidId === 'string' && bidId) state.bidId = bidId;
  priceClearTransient();
}

function priceBid() { return state.data.bids.find((b) => b.id === state.bidId) || null; }

function priceSettings() { return state.data.settings; }

function pricePlural(n, one, many) { return numText(n) + ' ' + (n === 1 ? one : many); }

// Every save on this screen except a handle edit goes through here, so the
// rounding note can't outlive the price it was explaining: it belongs to one
// typed number, and leaving it under a figure that has since moved would be a
// sentence about nothing.
function priceSave(revert) {
  priceWhy = null;
  return persistOr(revert);
}

// The question every Settings value on this screen has to ask. EVERY time, not
// once a session: the second change of the day reaches exactly as far as the
// first one did.
//
// The wording is deliberate, and it is NOT the labor screen's. Hours per day
// changes bid hours, so it moves the PRICE of every bid in the file. These
// four — burden, consumables, overhead, the truck day rate — are cost-side
// only: a bid's price is fixedPrice + its own stored rate × bid hours, and
// none of that moves. What moves is what the job costs him, and therefore what
// margin every bid in the file is really running at. Verified against a second
// bid on the screen: overhead 10% → 20% left its price at $1,240.00 and took
// its margin from 17.5% to 10%. Saying "this changes every price" would send
// him hunting for a change that isn't there; saying nothing would hide one
// that is.
function priceConfirmSettings(what) {
  return confirmPanel('Change ' + what + '? This re-figures the cost and margin on EVERY bid, '
    + 'including ones already sent. Their prices stay where you set them.');
}

// A percentage he types. Out-of-range values never touch the bid — and since
// nothing was written there is nothing to re-render, so the row he tapped is
// still on the glass and is the thing that gets shaken.
//
// PRICE_PCT_KEYS, not 3: the keypad's digit cap counts the decimal point as a
// character, so a cap of 3 lets him type "22." and then swallows the 5. Five
// is "100.0" — every percentage this app will accept, and the ones it won't
// are refused by the range check below, where the refusal can say why.
function pricePromptPct(current, label, node, apply) {
  promptNumber(current, {
    label,
    allowDecimal: true,
    maxDecimals: 1,
    maxChars: PRICE_PCT_KEYS,
    // The panel's own "was 22.5" drops the sign that makes it a percentage,
    // and would print a solved margin's raw float when the current value is
    // one (24.99871…). pctText is what the row itself says.
    wasText: 'was ' + pctText(current),
    done: (v) => {
      if (v === null) return;
      if (v > PRICE_MAX_PCT) {
        showBanner('A percentage here is between 0 and ' + PRICE_MAX_PCT);
        shake(node);
        return;
      }
      apply(v);
    },
  });
}

// Every day count on this screen — a rental's, a tool's, and the two asked
// while one is being added — comes through here. It was three copies of the
// same two guards, which is three places for them to drift apart.
//
// node is what to shake, when there is something on the glass to shake: the
// chip he tapped. Mid-flow there is nothing yet (the line does not exist until
// the last panel closes), so the banner carries the refusal on its own.
//
// A refused number RE-OPENS the same prompt rather than returning. Mid-flow
// there is nothing behind the panel to go back to: the "+ Rental" flow has
// already taken the name, and dropping out here would throw that name away and
// make him start over for a mistyped day count. The banner says what was
// wrong and the keypad is waiting underneath it. Cancel is still how he
// leaves — this only re-asks the question he answered badly.
//
// Safe to call from inside done(): keypadDone/keypadClear close the panel
// before they call it, so anyPanelOpen() is false by the time we ask again.
function pricePromptDays(current, label, node, apply) {
  const refuse = (message) => {
    showBanner(message);
    if (node) shake(node);
    pricePromptDays(current, label, node, apply);
  };
  promptNumber(current, {
    label,
    allowDecimal: true,
    // Quarter and half days are real; a third decimal is a fat-fingered tap,
    // and refusing it at the key beats rounding it away afterwards.
    maxDecimals: 2,
    maxChars: PRICE_DAY_KEYS,
    done: (v) => {
      if (v === null) return;
      if (!(v > 0)) { refuse('A day count has to be more than zero'); return; }
      if (v > PRICE_MAX_DAYS) {
        refuse('That is more than a year — check the number of days');
        return;
      }
      apply(v);
    },
  });
}

// A fact shaped like a chip so it sits in the same row — a span, not a
// disabled button: there is nothing here to press, and a control that refuses
// every tap is a worse answer than something that never looked like one.
function priceFactChip(text, extraClass) {
  const node = document.createElement('span');
  node.className = 'chip chip-fact' + (extraClass ? ' ' + extraClass : '');
  node.textContent = text;
  return node;
}

// A line on this screen is a name and its money, with the facts underneath and
// its controls in the strip a tap on the line opens. The name/money block is a
// button only when tapping it means something.
function priceLine(name, valueText, onTapMain) {
  const wrap = document.createElement('div');
  wrap.className = 'price-line';

  const main = document.createElement(onTapMain ? 'button' : 'div');
  main.className = 'price-line-main' + tapClasses(onTapMain, null);
  if (onTapMain) {
    main.type = 'button';
    main.addEventListener('click', onTapMain);
  }
  const n = document.createElement('span');
  n.className = 'price-line-name';
  n.textContent = name;
  main.appendChild(n);
  const v = document.createElement('span');
  v.className = 'price-line-value';
  v.textContent = valueText;
  main.appendChild(v);
  if (onTapMain) main.appendChild(chevron());
  wrap.appendChild(main);

  const sub = document.createElement('div');
  sub.className = 'price-line-sub';
  wrap.appendChild(sub);
  wrap.sub = sub;   // where the caller hangs the chips
  return wrap;
}

// A row that reaches past this bid says so in words, not only in color: the
// accent on the value is a hint, and a hint is not a warning.
function priceAllBidsTag(line) {
  const tag = document.createElement('span');
  tag.className = 'price-tag';
  tag.textContent = 'all bids';
  (line.querySelector('.row-label') || line).appendChild(tag);
  return line;
}

// The strip that opens under a line he tapped: [label, class, onTap] each,
// through the app-wide attachedStrip so the rental's four buttons, the
// equipment line's three and the Settings rows all sit in one shape. close is
// what Cancel does - every strip on this screen closes by clearing the flag
// that opened it.
function priceActions(buttons, close) {
  return attachedStrip(null, buttons.map(([label, cls, onTap]) => ({ label, cls, onTap })), { cancel: close });
}

// Every strip on this screen is opened by one of two flags and closed the same
// way, so there is one function for it rather than four closures that could
// each forget one of the two.
function priceCloseMenu() { priceMenu = null; priceHoursMenu = false; render(); }

// ---------------------------------------------------------------------------
// RENTALS
// ---------------------------------------------------------------------------
// What he pays somebody else for. The walk can leave one here at $0 — it
// remembers the lift exists, this screen decides what it costs — so a $0 line
// says so out loud rather than quietly pricing a lift at nothing.
//
// "Marked up" is per line because it is per line in real life: a lift he
// arranges and babysits carries his markup, a dumpster the customer would have
// rented himself usually doesn't. The marked-up figure comes from
// BidMath.rentalPrice at the bid's own markup — the same call the document
// prints from, so the two can never disagree.

function buildRentals(bid, markup) {
  const box = card('Rentals');
  const list = bid.rentals || [];

  if (list.length === 0) {
    box.appendChild(emptyNote('No rentals on this bid.'));
  } else {
    list.forEach((x) => box.appendChild(buildRentalLine(bid, x, markup)));
  }

  box.appendChild(textButton('+ Rental', 'btn btn-block mt-3', () => priceAddRental(bid)));
  return box;
}

// The rental's cents field is the TOTAL for the whole hire, not a day rate
// (Adrian's call, 9/05: it is what his paper bids say — "Lift rental · 1 week ·
// $501"). The line used to read "Scissor lift  $285.00" with an "8 days" chip
// under it, which reads as $285 a day; the word "total" on the value is what
// stops that, and the prompt below asks the question the same way.
function rentalTotalLabel(name) {
  return 'What will the ' + (name || 'rental') + ' cost in total?';
}
function rentalTotalCaption(days) {
  return 'For all ' + pricePlural(days, 'day', 'days') + ', what the rental house charges.';
}

// ONE tap rule on this screen: tapping a line opens that line's strip, and
// everything the line can do is in the strip. The rental used to be the
// exception — its line went straight to the money panel, its days were a chip,
// and its Delete hid behind a ⋯ — so the same gesture meant three different
// things depending on which row his thumb landed on. Now it reads and works
// exactly like the equipment line above it: facts underneath, controls in the
// strip.
function buildRentalLine(bid, x, markup) {
  const line = priceLine(x.name || 'Rental', moneyText(x.cents) + ' total', () => {
    priceMenu = priceMenu === x ? null : x;
    render();
  });

  line.sub.appendChild(priceFactChip(pricePlural(x.days, 'day', 'days'), 'chip-flat'));

  // Only worth saying when the two numbers differ — an un-marked-up rental
  // prints at exactly what it cost, and a line repeating itself is noise. Not
  // while the menu is open either: the markup button down there carries the
  // same sentence, and saying it twice on one line is one of them being wrong.
  const prints = BidMath.rentalPrice(x, markup);
  if (prints !== x.cents && priceMenu !== x) line.appendChild(caption('Prints at ' + moneyText(prints)));

  if (!(prints > 0)) line.appendChild(unpricedWarn());

  if (priceMenu === x) {
    // Days, the money, the markup and the way off the bid — everything this
    // line can be asked. "Marked up" used to be a chip up on the line, which
    // said whether the switch was on and never what it did; here it is a plain
    // two-state button with the answer beside it, so turning it on changes the
    // sentence under it to the number that goes on the paper.
    line.appendChild(priceActions([
      ['Days', '', () => pricePromptDays(x.days, (x.name || 'Rental') + ', how many days?', line, (v) => {
        const prev = x.days;
        x.days = v;
        priceSave(() => { x.days = prev; });
        render();
      })],
      ['Total cost', '', () => {
        promptMoney(x.cents, {
          label: rentalTotalLabel(x.name),
          caption: rentalTotalCaption(x.days),
          done: (cents) => {
            const prev = x.cents;
            // Clear means none of it, which is a real answer here, not a cancel.
            x.cents = cents === null ? 0 : cents;
            priceSave(() => { x.cents = prev; });
            render();
          },
        });
      }],
      [x.markup ? 'Markup on' : 'Markup off', x.markup ? 'btn-on' : '', () => {
        const prev = x.markup;
        x.markup = !prev;
        priceSave(() => { x.markup = prev; });
        render();
      }],
      ['Delete rental', 'btn-danger-outline', () => priceDeleteRental(bid, x)],
    ], priceCloseMenu));
    line.appendChild(caption('Prints at ' + moneyText(prints)));
  }
  return line;
}

// Name, then days, then dollars — one question per panel, in the order he
// would say them out loud. The naming step is the walk's step, from ui.js, so
// the chips he gets here are the chips he got standing in the plant.
function priceAddRental(bid) {
  promptRentalName(state.data.catalog, '', (name) => {
    pricePromptDays(1, name + ', how many days?', null, (days) => {
      promptMoney(null, {
        label: rentalTotalLabel(name),
        caption: rentalTotalCaption(days),
        done: (cents) => {
          const rental = { name, days, cents: cents === null ? 0 : cents, markup: false };
          bid.rentals.push(rental);
          priceSave(() => {
            const i = bid.rentals.indexOf(rental);
            if (i !== -1) bid.rentals.splice(i, 1);
          });
          render();
        },
      });
    });
  });
}

async function priceDeleteRental(bid, x) {
  const ok = await confirmPanel('Delete ' + (x.name || 'this rental') + '?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  const i = bid.rentals.indexOf(x);
  if (i !== -1) {
    bid.rentals.splice(i, 1);
    priceSave(() => { bid.rentals.splice(i, 0, x); });
  }
  priceMenu = null;
  render();
}

// ---------------------------------------------------------------------------
// EQUIPMENT
// ---------------------------------------------------------------------------
// His own tools. He already owns the threader; billing a day of it is how it
// pays for the next one. The day rate is equipmentPct of what the tool cost
// new, rounded to the nearest $5 with a $5 minimum (BidMath.equipmentDayRate)
// unless Settings carries an override — worked out in ui.js so the walk's
// picker and this one quote the same tool at the same number.
//
// A tool with no cost on it has no rate, and a rate of nothing is a day billed
// at $0. So the cost is asked for the first time it is needed and kept in
// Settings. That IS a Settings edit, but a one-time fill with nothing to
// re-figure — no bid anywhere changes price because a tool that had no rate
// now has one — so it does not get the every-change confirmation the
// percentages get.

function buildEquipment(bid) {
  const s = priceSettings();
  const box = card('Equipment');
  const list = bid.equipment || [];
  if (list.length === 0) {
    box.appendChild(emptyNote('None of your own equipment on this bid.'));
  } else {
    list.forEach((x) => box.appendChild(buildEquipmentLine(bid, x)));
  }

  // The picker used to REPLACE this whole card, so tapping + Equipment made
  // the list of equipment on the bid disappear and a different card take its
  // place. Now it hangs off the button that opened it, inside the card the
  // tool is about to join.
  const add = textButton('+ Equipment', 'btn btn-block mt-3', () => { pricePicker = true; render(); });
  box.appendChild(add);

  if (pricePicker) {
    const chips = document.createElement('div');
    chips.className = 'equip-chips';
    const visible = (s.equipment || []).filter((e) => e.hidden === false);
    if (visible.length === 0) {
      chips.appendChild(emptyNote('No equipment in Settings yet.'));
    } else {
      visible.forEach((e) => {
        const rate = equipmentDayCents(e, s.equipmentPct);
        chips.appendChild(chip(
          rate == null ? e.name + ' · no cost yet' : e.name + ' · ' + moneyText(rate) + '/day',
          false,
          () => pricePickEquipment(bid, e)
        ));
      });
    }
    attachedStrip(add, [
      { label: '+ New tool', onTap: () => priceNewTool(bid) },
    ], {
      label: 'Which piece of equipment?',
      content: chips,
      cancel: () => { pricePicker = false; render(); },
    });
  }
  return box;
}

// A tool ON this bid. Three things can be wrong with the line and none of them
// had a door before: the days, what a day of it is worth ON THIS JOB, and the
// fact that it should not be on the bid at all. So the whole line opens a strip
// with those three, and the chips underneath go back to being what they say
// they are — facts, not half-controls.
function buildEquipmentLine(bid, x) {
  const line = priceLine(x.name || 'Equipment', moneyText(BidMath.equipmentLine(x)), () => {
    priceMenu = priceMenu === x ? null : x;
    render();
  });

  line.sub.appendChild(priceFactChip(pricePlural(x.days, 'day', 'days'), 'chip-flat'));

  if (x.dayCents > 0) {
    line.sub.appendChild(priceFactChip(moneyText(x.dayCents) + '/day', 'chip-flat'));
  } else {
    line.sub.appendChild(buildEquipmentRateChip(x));
  }

  // The same amber a $0 rental gets. The chip above says how to fix it; this
  // says what is wrong, in the words every other unpriced line on this bid
  // uses, so one glance down the screen finds all of them.
  if (!(BidMath.equipmentLine(x) > 0)) line.appendChild(unpricedWarn());

  if (priceMenu === x) {
    line.appendChild(priceActions([
      ['Days', '', () => pricePromptDays(x.days, (x.name || 'Equipment') + ', how many days?', line, (v) => {
        const prev = x.days;
        x.days = v;
        priceSave(() => { x.days = prev; });
        render();
      })],
      ['Day rate, this bid', '', () => priceEquipmentDayRate(x)],
      ['Remove', 'btn-danger-outline', () => priceDeleteEquipment(bid, x)],
    ], priceCloseMenu));
  }
  return line;
}

// What a day of his own tool is worth ON THIS BID. It writes the LINE's
// dayCents and nothing else: the tool in Settings keeps the rate every other
// bid quotes it at. A job where the threader is the only reason he is there
// can carry more of it than the job where it came along, and neither answer
// should reach back through the file and change the other.
function priceEquipmentDayRate(x) {
  promptMoney(x.dayCents, {
    label: (x.name || 'Equipment') + ', a day on this bid',
    caption: "Only this bid. The tool's rate in Settings stays.",
    done: (cents) => {
      // Clear means none of it, which is a real answer: a tool that rode along
      // and is not being billed. The amber line then says so.
      const prev = x.dayCents;
      x.dayCents = cents === null ? 0 : cents;
      priceSave(() => { x.dayCents = prev; });
      render();
    },
  });
}

// A line carrying dayCents 0 — an older bid, or a tool whose cost never got
// answered — recorded that the threader is going on this job without saying
// what a day of it is worth. (The walk no longer makes one: it asks for the
// cost and writes the rate onto the line, the same as the picker here.) Two
// ways that gets fixed, both one tap, and both yellow so an unpriced line
// can't be mistaken for a priced one:
//
//   the tool has a rate      — apply it
//   the tool has no cost yet — ask what it cost new, then apply what that makes
//
// There is no third branch for a line with no tool behind it: Store.save
// refuses the whole document over an equipmentId Settings doesn't have, so
// such a line can never be loaded, and nothing in the app writes the null the
// validator does allow. The guard below is a statement of that, not a feature
// — it says what is wrong instead of offering to price a tool that isn't there.
function buildEquipmentRateChip(x) {
  const s = priceSettings();
  const tool = x.equipmentId ? s.equipment.find((e) => e.id === x.equipmentId) : null;
  if (!tool) return priceFactChip('no tool on this line', 'chip-warn');

  const rate = equipmentDayCents(tool, s.equipmentPct);

  if (rate > 0) {
    const c = chip('tap to apply ' + moneyText(rate) + '/day', false, () => {
      const prev = x.dayCents;
      x.dayCents = rate;
      priceSave(() => { x.dayCents = prev; });
      render();
    });
    c.classList.add('chip-warn');
    return c;
  }

  const c = chip('tap to set a day rate', false, () => {
    promptMoney(tool.costCents, {
      label: 'What does a ' + (tool.name || x.name) + ' cost new?',
      done: (cents) => {
        if (cents === null || !(cents > 0)) return;
        const prevCost = tool.costCents;
        const prevDay = x.dayCents;
        tool.costCents = cents;
        const made = equipmentDayCents(tool, s.equipmentPct);
        x.dayCents = made == null ? 0 : made;
        // One save for both halves: the tool's cost and the line's rate are
        // one answer to one question, and half of it landing on disk would
        // leave a tool priced and a line still at $0.
        priceSave(() => { tool.costCents = prevCost; x.dayCents = prevDay; });
        render();
      },
    });
  });
  c.classList.add('chip-warn');
  return c;
}

// Picking a tool that has never been priced asks what it cost new FIRST: the
// day rate is worked out from that, and there is no honest way to ask "how
// many days" before there is a number the days multiply.
function pricePickEquipment(bid, equip) {
  const s = priceSettings();
  const rate = equipmentDayCents(equip, s.equipmentPct);
  if (rate != null) { priceEquipmentDays(bid, equip, rate); return; }

  promptMoney(null, {
    label: 'What does a ' + (equip.name || 'tool') + ' cost new?',
    done: (cents) => {
      if (cents === null || !(cents > 0)) return;
      const prev = equip.costCents;
      equip.costCents = cents;
      if (!priceSave(() => { equip.costCents = prev; })) { render(); return; }
      const made = equipmentDayCents(equip, s.equipmentPct);
      priceEquipmentDays(bid, equip, made == null ? 0 : made);
    },
  });
}

function priceEquipmentDays(bid, equip, dayCents) {
  const label = (equip.name || 'Equipment') + ' at ' + moneyText(dayCents) + ' a day, how many days?';
  pricePromptDays(1, label, null, (days) => {
    const eq = { equipmentId: equip.id, name: equip.name, days, dayCents };
    bid.equipment.push(eq);
    if (!priceSave(() => {
      const i = bid.equipment.indexOf(eq);
      if (i !== -1) bid.equipment.splice(i, 1);
    })) { render(); return; }
    pricePicker = false;
    render();
  });
}

// A tool he owns that Settings has never heard of. Name and what it cost new,
// straight into Settings — additive, so nothing already priced moves and there
// is nothing to warn him about — and then on into the same days question a
// picked tool gets.
function priceNewTool(bid) {
  promptText('', {
    label: 'New tool',
    placeholder: 'What it is',
    done: (name) => {
      if (!name) return;
      // He typed the name of a tool the list already has. That is how five
      // Benders got in here: the picker was a wall of chips, the one he wanted
      // was below the fold, and + New tool was easier than looking. So the
      // list is asked first, and a name it already knows offers the one thing
      // he was probably really after — the cost, which is the number that was
      // wrong or missing on the old one.
      const twin = Store.findEquipmentByName(state.data, name);
      if (twin) { priceExistingTool(bid, twin); return; }
      promptMoney(null, {
        label: 'What does a ' + name + ' cost new?',
        done: (cents) => {
          if (cents === null || !(cents > 0)) return;
          const s = priceSettings();
          // Store.newTool builds it whole and pushes it — the same entry the
          // Settings screen's + Tool makes, so the two doors cannot drift. It
          // only ever refuses a blank name or a cost that isn't a whole number
          // above zero, and both are already guarded two lines up, so there is
          // no null to check for here.
          const tool = Store.newTool(state.data, name, cents);
          if (!priceSave(() => {
            const i = s.equipment.indexOf(tool);
            if (i !== -1) s.equipment.splice(i, 1);
          })) { render(); return; }
          pricePickEquipment(bid, tool);
        },
      });
    },
  });
}

// + New tool, when the name is already in the list. Both answers put the tool
// on this bid — he asked for it, and refusing to add it would leave him with
// nothing to show for the two panels he just filled in. The question is only
// whether the number Settings holds is still right:
//
//   Update it        — the cost he has in his hand now, written to the tool,
//                      which re-figures its day rate everywhere it is offered.
//   Use it as it is  — straight on to the days question, the same as picking
//                      it out of the list.
async function priceExistingTool(bid, tool) {
  const name = tool.name || 'That tool';
  const has = tool.costCents != null;
  const update = await confirmPanel(
    name + ' already exists' + (has ? ' at ' + moneyText(tool.costCents) : ' with no cost on it') + '. Update its cost?',
    { ok: 'Update it', cancel: 'Use it as it is' }
  );
  if (!update) { pricePickEquipment(bid, tool); return; }

  promptMoney(tool.costCents, {
    label: 'What does a ' + name + ' cost new?',
    done: (cents) => {
      if (cents === null || !(cents > 0)) { pricePickEquipment(bid, tool); return; }
      const prev = tool.costCents;
      tool.costCents = cents;
      if (!priceSave(() => { tool.costCents = prev; })) { render(); return; }
      pricePickEquipment(bid, tool);
    },
  });
}

async function priceDeleteEquipment(bid, x) {
  const ok = await confirmPanel('Take ' + (x.name || 'this equipment') + ' off this bid?', { ok: 'Delete', danger: true });
  if (!ok) { render(); return; }
  const i = bid.equipment.indexOf(x);
  if (i !== -1) {
    bid.equipment.splice(i, 1);
    priceSave(() => { bid.equipment.splice(i, 0, x); });
  }
  priceMenu = null;
  render();
}

// ---------------------------------------------------------------------------
// COST STACK
// ---------------------------------------------------------------------------
// His eyes only: this card is never printed and never shown to a customer. It
// is the whole reason the app exists — the things that get left out of a
// napkin number are all in here, each one named, each one his to argue with.
//
// Every row is a field off ONE costStack call, taken at the top of the render
// so that no two rows can be reading different versions of the same bid.

// The hours he is putting on the paper, typed as hours. The cushion is then
// whatever percentage makes those hours (BidMath.cushionForBidHours), so the
// number he typed is the number the row comes back reading — the percentage is
// the app's arithmetic, not his.
//
// Fewer hours than the job really takes is allowed. He knows what a job is
// worth to him better than a cost stack does, and there are weeks where the
// answer is to eat some of it to get the work. The red line under the row says
// which way round the two numbers are, and that is the whole of the app's
// opinion about it.
//
// With no labor on the bid there is nothing to divide by — every cushion makes
// zero hours — so the question is refused rather than answered with a
// percentage that does nothing.
function priceBidHours(bid, stack, node) {
  promptNumber(stack.bidHours, {
    label: 'Bid hours',
    // "9999" hours is four years of one man. A fifth digit is a typo.
    maxChars: 5,
    wasText: 'was ' + pricePlural(stack.bidHours, 'hr', 'hrs'),
    caption: 'You figured ' + pricePlural(stack.realHours, 'hr', 'hrs') + ' of real work.',
    done: (v) => {
      if (v === null) return;
      if (!(stack.realHours > 0)) {
        showBanner('Add labor first — there are no hours to put a number on');
        shake(node);
        return;
      }
      if (!Number.isInteger(v) || v < 1) {
        showBanner('Bid hours are whole hours, 1 or more');
        shake(node);
        return;
      }
      const prev = bid.pricing.cushionPct;
      bid.pricing.cushionPct = BidMath.cushionForBidHours(stack.realHours, v);
      priceSave(() => { bid.pricing.cushionPct = prev; });
      render();
    },
  });
}

function priceSettingsPctRow(label, value, current, keypadLabel, what, apply) {
  const line = row(label, value, async () => {
    const ok = await priceConfirmSettings(what);
    if (!ok) return;
    pricePromptPct(current, keypadLabel, line, apply);
  }, { keypad: true });
  line.classList.add('price-settings-row');
  return priceAllBidsTag(line);
}

function buildCostStack(bid, stack, markup) {
  const s = priceSettings();
  const box = card('What this job costs you');
  box.classList.add('price-stack');

  box.appendChild(row('Materials (at cost)', moneyText(stack.materialCost)));

  const mk = row('Materials markup ' + pctText(markup), '→ ' + moneyText(stack.materialPrice), () => {
    pricePromptPct(markup, 'Material markup %, this bid', mk, (v) => {
      const prev = bid.pricing.markupPct;
      bid.pricing.markupPct = v;
      priceSave(() => { bid.pricing.markupPct = prev; });
      render();
    });
  }, { keypad: true });
  box.appendChild(mk);

  box.appendChild(row('Labor ' + pricePlural(stack.realHours, 'hr', 'hrs') + ' at wages', moneyText(stack.wageCents)));

  // A task with days on it and nobody on it is worth no hours and yet its days
  // are inside the truck line three rows down, so the stack he is reading has
  // a cost in it with no labor behind it. The Labor screen flags the card; this
  // flags the number, in the same words, because this is the screen where the
  // missing hours turn into a price.
  const crewless = BidMath.crewlessTasks(bid.labor);
  if (crewless.length) box.appendChild(inlineWarn(crewlessTaskWarnText(crewless)));

  // The one subtraction in this file. Burden is not a costStack field — what
  // the stack exposes is wages before it and labor cost after it — so the
  // difference between those two IS the burden, read off the stack rather than
  // recomputed from the bid. Nothing else here does arithmetic on cents.
  box.appendChild(priceSettingsPctRow(
    '+ payroll burden ' + pctText(s.burdenPct), moneyText(stack.laborCost - stack.wageCents),
    s.burdenPct, 'Payroll burden %, every bid', 'payroll burden',
    (v) => {
      const prev = s.burdenPct;
      s.burdenPct = v;
      priceSave(() => { s.burdenPct = prev; });
      render();
    }
  ));

  const truckDays = BidMath.truckDays(bid);
  const truck = row('Truck & gas ' + pricePlural(truckDays, 'day', 'days'), moneyText(stack.truck), async () => {
    const ok = await priceConfirmSettings('the truck day rate');
    if (!ok) return;
    promptMoney(s.truckDayCents, {
      label: 'Truck and gas a day, every bid',
      done: (cents) => {
        if (cents === null) return;
        const prev = s.truckDayCents;
        s.truckDayCents = cents;
        priceSave(() => { s.truckDayCents = prev; });
        render();
      },
    });
  }, { keypad: true });
  truck.classList.add('price-settings-row');
  box.appendChild(priceAllBidsTag(truck));

  box.appendChild(priceSettingsPctRow(
    'Consumables ' + pctText(s.consumablesPct), moneyText(stack.consumables),
    s.consumablesPct, 'Consumables %, every bid', 'consumables',
    (v) => {
      const prev = s.consumablesPct;
      s.consumablesPct = v;
      priceSave(() => { s.consumablesPct = prev; });
      render();
    }
  ));

  box.appendChild(row('Rentals', moneyText(stack.rentalsCost)));
  box.appendChild(row('Equipment', moneyText(stack.equipmentCost)));

  // ONE name for this line. The walk called it "Supports, anchors, and
  // hardware" and this screen called the same number "Misc hardware", which is
  // how one line reads as two things and the row on this side reads as dead —
  // it was, and now it is the same keypad the walk opens. The label is the
  // bid's own, because it is his to edit.
  const miscLabel = (bid.misc && bid.misc.label) || MISC_LABEL;
  box.appendChild(row(miscLabel, moneyText(stack.misc), () => {
    promptMoney(bid.misc.cents, {
      label: miscLabel,
      done: (cents) => {
        const prev = bid.misc.cents;
        // Clear means none of it, which is a real answer here, not a cancel —
        // the same rule the walk's copy of this keypad follows.
        bid.misc.cents = cents === null ? 0 : cents;
        priceSave(() => { bid.misc.cents = prev; });
        render();
      },
    });
  }, { keypad: true }));

  // No cents on this row on purpose: the cushion does not cost him anything,
  // it quotes hours he hopes not to work. Its money shows up in the price
  // above, through bid hours.
  //
  // Two ways in, because he thinks about it both ways. Some days the answer is
  // "put fifteen percent on it"; some days it is "I am bidding this at forty
  // hours" and the percentage is arithmetic he should not have to do. The
  // second one back-solves through BidMath.cushionForBidHours and can go
  // negative — see the red line below.
  const cushionPct = bid.pricing.cushionPct != null ? bid.pricing.cushionPct : 0;
  const cushion = row('Hours cushion ' + pctText(cushionPct),
    numText(stack.bidHours) + ' bid hrs', () => {
      priceHoursMenu = !priceHoursMenu;
      render();
    });
  box.appendChild(cushion);

  if (priceHoursMenu) {
    // Attached to the row that opened it, inside this card, indented past it.
    attachedStrip(cushion, [
      { label: 'Cushion for this bid', onTap: () => {
        pricePromptPct(cushionPct, 'Hours cushion %, this bid', cushion, (v) => {
          const prev = bid.pricing.cushionPct;
          bid.pricing.cushionPct = v;
          priceSave(() => { bid.pricing.cushionPct = prev; });
          render();
        });
      } },
      { label: 'Bid hours', onTap: () => priceBidHours(bid, stack, cushion) },
    ], { cancel: priceCloseMenu });
  }

  // A cushion below zero is not hours he hopes not to work, it is hours he is
  // taking off the job, and the usual sentence would be describing the
  // opposite of what the row says.
  box.appendChild(caption((cushionPct < 0
    ? 'Hours you are taking off the job. You figured '
    : 'Hours you quote but hope not to work. You figured ')
    + pricePlural(stack.realHours, 'hr', 'hrs') + '. This bid only.'));

  // Not a warning about a mistake — he may well have meant it, and the app
  // does not argue with him about his own price. It is the sentence that makes
  // sure he knows which way round the two numbers are.
  if (stack.bidHours < stack.realHours) {
    box.appendChild(priceNote("You'd be selling " + numText(stack.bidHours)
      + ' hours for work you figured at ' + numText(stack.realHours) + '.', true));
  }

  box.appendChild(priceSettingsPctRow(
    'Overhead ' + pctText(s.overheadPct), moneyText(stack.overhead),
    s.overheadPct, 'Overhead %, every bid', 'overhead',
    (v) => {
      const prev = s.overheadPct;
      s.overheadPct = v;
      priceSave(() => { s.overheadPct = prev; });
      render();
    }
  ));

  const total = row('True cost', moneyText(stack.trueCost));
  total.classList.add('price-truecost');
  box.appendChild(total);

  // The two sentences that only ever explain. They were captions under their
  // own rows, which put four grey lines through the middle of the one card on
  // this screen he actually reads down.
  box.appendChild(whatsThis('Materials markup is what the materials sell for, on this bid only. '
    + 'Truck and gas is ' + moneyText(s.truckDayCents) + ' a day, and the days come from the Labor screen. '
    + 'Payroll burden, consumables and overhead are Settings: they change what every bid costs you, '
    + 'never what a sent bid is priced at.'));

  return box;
}

// ---------------------------------------------------------------------------
// HANDLES
// ---------------------------------------------------------------------------
// Three handles on one number. Margin, the labor rate, and the price he is
// going to say out loud are the same fact said three ways, and moving any one
// of them is a question for BidMath.solve: given this stack, what triple does
// that make? Whatever comes back is what goes on the bid AND what goes on the
// glass — the typed number is never echoed. A price typed as $13,000 can come
// back $12,999.78, because the price is re-derived from a rate rounded DOWN to
// whole cents an hour, and the screen says so rather than pretending. Down and
// never up: the number he reads off the glass is never more than the number he
// typed.
//
// With no labor on the bid there are no hours for a rate to multiply. solve()
// guards the division, but a handle that silently does nothing is worse than
// one that is plainly off, so all three go dim and the caption says what to do.

function priceApply(bid, handle, value) {
  const stack = BidMath.costStack(bid, priceSettings());
  const out = BidMath.solve(stack, handle, value);

  const prevRate = bid.pricing.rateCents;
  const prevMargin = bid.pricing.marginPct;
  bid.pricing.rateCents = out.rateCents;
  // bid.pricing.marginPct is a SNAPSHOT of the margin at this handle move, not
  // a live figure: any cost-side edit afterwards (a rental, overhead, another
  // hour of labor) moves the real margin and leaves this number where it was.
  // The live margin is always BidMath.solve(stack, 'rate', rateCents).marginPct
  // — which is what this screen displays. Reports must compute it the same way
  // and never read this field.
  bid.pricing.marginPct = out.marginPct;

  if (!persistOr(() => { bid.pricing.rateCents = prevRate; bid.pricing.marginPct = prevMargin; })) {
    priceWhy = null;
    render();
    return;
  }

  // Which of the three sentences below to show, if any. The classification is
  // solve()'s — see the `why` block in bidmath. This screen used to decide it
  // here off out.rateCents alone, which got two cases wrong: a price a nickel
  // ABOVE the materials total was called a refusal to quote at a loss, and a
  // price typed at exactly the materials total showed $0.00/hr and said
  // nothing at all about why.
  //
  // 'exact' is the fourth answer and it prints nothing: the number on screen
  // is the number he typed, and a sentence saying so is noise.
  priceWhy = (handle === 'price' && out.why && out.why !== 'exact')
    ? { kind: out.why, priceCents: out.priceCents, fixedPrice: stack.fixedPrice }
    : null;
  render();
}

function buildHandles(bid, stack, solved) {
  const off = stack.bidHours === 0;
  const box = card('Your price');
  box.classList.add('price-handles');

  const margin = row('Margin', pctText(solved.marginPct), off ? null : () => {
    promptNumber(solved.marginPct, {
      label: 'Margin %',
      allowDecimal: true,
      maxDecimals: 1,
      maxChars: PRICE_PCT_KEYS,
      wasText: 'was ' + pctText(solved.marginPct),
      done: (v) => {
        if (v === null) return;
        // solve() clamps at 99.9% rather than dividing by zero. Say so, then
        // show what it made of it — the number on screen is always solve's.
        if (v >= PRICE_MAX_PCT) showBanner('Margin has to be under 100% — using 99.9%');
        priceApply(bid, 'margin', v);
      },
    });
  }, { keypad: true });
  if (off) margin.classList.add('price-row-off');
  box.appendChild(margin);

  const pills = document.createElement('div');
  pills.className = 'price-pills';
  PRICE_MARGIN_PILLS.forEach((p) => {
    const c = chip(pctText(p), pctText(solved.marginPct) === pctText(p), () => priceApply(bid, 'margin', p));
    c.disabled = off;
    pills.appendChild(c);
  });
  box.appendChild(pills);

  const rate = row('Labor rate', moneyText(solved.rateCents) + '/hr', off ? null : () => {
    promptMoney(solved.rateCents, {
      label: 'Labor rate an hour',
      done: (cents) => { if (cents !== null) priceApply(bid, 'rate', cents); },
    });
  }, { keypad: true });
  if (off) rate.classList.add('price-row-off');
  box.appendChild(rate);

  // The one number this screen exists to produce. Margin and the labor rate
  // are two other ways of saying it and step down to body size, so a glance
  // lands on the figure he says out loud.
  const price = row('Bid price', moneyText(solved.priceCents), off ? null : () => {
    promptMoney(solved.priceCents, {
      label: 'What you are bidding',
      done: (cents) => { if (cents !== null) priceApply(bid, 'price', cents); },
    });
  }, { keypad: true });
  price.classList.add('row-big');
  if (off) price.classList.add('price-row-off');
  box.appendChild(price);

  if (off) {
    box.appendChild(caption('Add labor first — the handles need hours to work with.'));
  } else if (priceWhy && priceWhy.kind === 'floored') {
    const note = inlineWarn('Your materials, rentals, and equipment alone come to '
      + moneyText(priceWhy.fixedPrice)
      + '. A price under that means paying to work, so the labor rate is $0/hr.');
    box.appendChild(note);
  } else if (priceWhy && priceWhy.kind === 'no-labor') {
    // Not amber. The price he typed fits, it just has no room in it for hours,
    // which is a real way to bid parts. A warning here would cry wolf.
    box.appendChild(caption('That leaves nothing for labor over your '
      + moneyText(priceWhy.fixedPrice)
      + ' of materials, rentals, and equipment, so the rate is $0/hr.'));
  } else if (priceWhy) {
    box.appendChild(caption('Closest price at whole cents per hour: ' + moneyText(priceWhy.priceCents) + '.'));
  }

  return box;
}

// ---------------------------------------------------------------------------
// READOUTS
// ---------------------------------------------------------------------------
// The four sentences that tell him whether the number above is one he should
// say out loud. None of them is a control; all of them are read off values
// BidMath handed back.

function priceNote(text, bad) {
  const p = document.createElement('p');
  p.className = 'price-note' + (bad ? ' price-note-bad' : '');
  p.textContent = text;
  return p;
}

// The three material lines with the most money in them. Sorted by comparison,
// not by subtraction, so there is no arithmetic on cents anywhere in here —
// each line's cost comes back from BidMath.materialCost given that one item,
// which is the same rounding rule the whole material total is built on.
function priceTopItems(bid) {
  const rows = (bid.areas || []).flatMap((a) => (a.items || []).map((it) => ({
    it, cost: BidMath.materialCost({ areas: [{ items: [it] }] }),
  })));
  rows.sort((a, b) => (a.cost < b.cost ? 1 : a.cost > b.cost ? -1 : 0));
  return rows.slice(0, PRICE_TOP_ITEMS);
}

function buildReadouts(bid, stack, solved, markup) {
  const s = priceSettings();
  const box = card();
  box.classList.add('price-readout');

  if (BidMath.belowFloor(solved.rateCents, s.floorCents)) {
    box.appendChild(priceNote('Implied labor rate ' + moneyText(solved.rateCents) + '/hr — below your '
      + moneyText(s.floorCents) + ' floor.', true));
  } else {
    box.appendChild(priceNote('Implied labor rate ' + moneyText(solved.rateCents) + '/hr, at or above your '
      + moneyText(s.floorCents) + ' floor.'));
  }

  // The labor line the customer will actually read, in the customer's own
  // arithmetic. bidLaborCents is bid hours × this bid's rate — the same
  // multiplication the document prints, asked of BidMath rather than redone.
  const at = BidMath.atYourRate(stack, s.rateCents, solved.rateCents);
  box.appendChild(priceNote('Labor on the bid: ' + pricePlural(stack.bidHours, 'hr', 'hrs') + ' × '
    + moneyText(solved.rateCents) + ' = ' + moneyText(at.bidLaborCents) + '.'));
  box.appendChild(whatsThis('At your ' + moneyText(s.rateCents) + ' rate this labor would be '
    + moneyText(at.atRateCents) + '. This bid has ' + moneyText(at.bidLaborCents) + '.',
  'Against your usual rate'));

  const top = priceTopItems(bid);
  if (top.length) {
    box.appendChild(caption('What your biggest material lines print at, each:'));
    top.forEach(({ it }) => {
      box.appendChild(row(it.name, moneyText(it.costCents) + ' → ' + moneyText(BidMath.itemPrice(it, markup).unit)));
    });
  }

  return box;
}

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------

function renderPrice() {
  const host = el('priceContent');
  host.textContent = '';

  const bid = priceBid();
  if (!bid) {
    host.appendChild(emptyNote("That bid isn't here anymore. Tap Back to return to your bids."));
    return;
  }

  host.appendChild(stepStrip(bid, state.data.settings, 'price'));
  host.appendChild(screenHead(bid.title || 'No title yet', bidCustomerName(bid, state.data)));

  // ONE reading of the bid, handed to every card. Two costStack calls in one
  // render could straddle a mutation and put two different jobs on the screen
  // at once. solve() by the bid's own rate is the authoritative triple: the
  // margin and the price on the glass are what that rate makes, never what was
  // last typed and never what happens to be stored on the bid.
  const settings = priceSettings();
  const stack = BidMath.costStack(bid, settings);
  const solved = BidMath.solve(stack, 'rate', bid.pricing.rateCents);
  const markup = BidMath.resolveMarkup(bid, settings);

  // A crew id Settings no longer has bills at $0 AND makes Store.save refuse
  // the whole document — so every edit on this screen is bouncing off the disk
  // until it is cleared, and the fix lives one screen back.
  if (stack.unknownCrewIds.length) {
    host.appendChild(inlineWarn('Crew member no longer in Settings: ' + stack.unknownCrewIds.join(', ')
      + '. Nothing on this bid will save until this is fixed on the Labor screen.'));
    const fix = document.createElement('div');
    fix.className = 'bid-nav';
    fix.appendChild(textButton('Go to Labor', 'btn btn-block', () => show('labor', bid.id)));
    host.appendChild(fix);
  }

  host.appendChild(buildRentals(bid, markup));
  host.appendChild(buildEquipment(bid));
  host.appendChild(buildCostStack(bid, stack, markup));
  host.appendChild(buildHandles(bid, stack, solved));
  host.appendChild(buildReadouts(bid, stack, solved, markup));

  pinnedBar(host, 'Next: Proposal', () => show('proposal', bid.id));
}

registerScreen('price', {
  id: 'screen-price', title: 'Costs & price', back: 'bid', tab: 'bids',
  enter: enterPrice, render: renderPrice,
});
