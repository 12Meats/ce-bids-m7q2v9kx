'use strict';

// screens/settings.js — everything the rest of the app reads and nothing it
// writes for him: who the company is, who works for him, what his numbers are,
// what his tools bill at, the three lists that fill in his blanks, the clause
// library, the parts catalog, the bid counter, and the PIN.
//
// The screen is a stack of cards and every card is rows: label on the left,
// what it is now on the right, the whole line the tap target. One number per
// panel, no dropdowns, no native pickers.
//
// THE TWO RULES THIS SCREEN LIVES BY
//
// 1. HOW FAR DOES IT REACH? SETTINGS NEVER CHANGE AN EXISTING BID. Every
//    number on this screen that feeds a price is a default a NEW bid takes a
//    copy of, and that is now the whole list: the five that used to be read
//    live off Settings are snapshotted onto the bid at Store.newBid and read
//    back by BidMath.bidSetting. The reach is still spelled out on every row,
//    but there is only one reach left, so no row asks a question first.
//    Verified against the code, not against intuition:
//
//      Hours per day, burden, consumables, overhead, truck & gas, a crew wage
//                       — copied onto the bid (bid.pricing and
//                         bid.labor.wageCents) the day it is written, and
//                         costStack reads the bid's copy. Changing one here
//                         changes what the NEXT bid starts at. Changing one on
//                         a bid he already has is done on that bid's own
//                         screens: hours per day on Labor, the other four on
//                         Costs & price, with "Use today's Settings on this
//                         bid" there for a draft he wants brought forward.
//      Labor rate, rate floor, default margin, material markup, both
//      cushions, validity days
//                       — copied onto a bid by Store.newBid (markup, margin,
//                         cushion and the rate live in bid.pricing; validity
//                         lives on the bid). BidMath.resolveMarkup only falls
//                         back to settings for a bid that has no markup of its
//                         own, and Store's validator does not permit one. So
//                         these are NEW BIDS ONLY, every one of them. The
//                         floor is not even that: it only decides when the
//                         price screen puts a warning under the rate.
//      Equipment %, a tool's cost new
//                       — read when a tool is PICKED (ui.js equipmentDayCents)
//                         and written onto the bid line as dayCents. costStack
//                         never sees the percentage. So they set the rate the
//                         picker will offer next time, and no bid that already
//                         carries the tool moves a cent.
//      Tax line, plain black style
//                       — DocModel and DocGen read them live, so they change
//                         what EVERY proposal says and looks like the next
//                         time one is printed, sent bids included. No number
//                         moves; the paper does.
//
// 2. NOTHING IS EVER DELETED that a bid could be pointing at. Crew, equipment,
//    clauses and catalog parts are HIDDEN — hidden: true — so an old bid keeps
//    validating forever and Store.check never has a reason to refuse a save.
//    "Show hidden" brings them back into view with an Unhide next to them.
//    Only the two lists of plain strings (did-you-forget, note phrases) are
//    really removable, because nothing references a string by id.
//
// Sections, in order:
//   VIEW STATE  — transient flags, the enter hook, the small builders
//   COMPANY     — what prints at the top of the paper
//   CREW        — his men and their wages
//   RATES       — the numbers, each with the reach spelled out
//   EQUIPMENT   — his own tools and what a day of one bills at
//   LISTS       — did-you-forget, note phrases
//   TERMS       — the clause library
//   CATALOG     — the parts list, by category
//   COUNTER     — the next bid number
//   LOCK        — the PIN
//   ELSEWHERE   — Reports
//   BACKUP      — sending it off, getting it back, and how stale it is
//   RENDER

// ---------------------------------------------------------------------------
// VIEW STATE
// ---------------------------------------------------------------------------

const SET_PCT_KEYS = 5;          // "100.0" — the decimal point counts as a key
const SET_MAX_PCT = 100;
const SET_HPD_MIN = 1;
const SET_HPD_MAX = 16;
const SET_VALIDITY_MIN = 1;
const SET_VALIDITY_MAX = 365;
const SET_NUMBER_MAX = 99999;

// Which one row has its buttons open, as 'kind:id'. One at a time: a screen
// this long with four sets of buttons showing is a screen he has to read
// instead of use.
let settingsMenu = null;

// Per list, because they are four different questions. Only offered when
// there is actually something hidden to show.
let settingsShowHidden = { crew: false, equipment: false, clauses: false, catalog: false };

let settingsCategory = 'conduit';   // which parts category the catalog card is showing
let settingsGroupOpen = null;       // which clause group is expanded
let settingsAddGroup = false;       // the + Clause group picker is up

// Coming back to Settings is coming back to the top of it. Everything the
// last visit opened or unfolded is closed again, "Show hidden" included: four
// lists quietly showing put-away men and tools is not the screen he thinks he
// is looking at. The one thing that stays is settingsCategory — the parts
// card is a filing cabinet, and the drawer he was last in is the drawer he
// wants next time.
function enterSettings() {
  settingsMenu = null;
  settingsAddGroup = false;
  settingsGroupOpen = null;
  settingsShowHidden = { crew: false, equipment: false, clauses: false, catalog: false };
  // The backup card's blobs have to be in memory before its buttons are drawn,
  // never read inside the tap that presses one — see the BACKUP header for why.
  settingsResetBackup();
  settingsLoadBackupPdfs();
}

function setS() { return state.data.settings; }

function settingsMenuOpen(key) { return settingsMenu === key; }

function settingsToggleMenu(key) {
  settingsMenu = settingsMenu === key ? null : key;
  render();
}

// Appends a tap-to-edit row and, when there is one, the line of his own words
// underneath it. Appending rather than returning a wrapper on purpose:
// .row:last-child drops its bottom border, and a wrapper per row would make
// every single row a last child and take every separator off the card.
// Non-null while the Rates card is being built. Every row inside it opens a
// keypad, and every row inside it used to carry its own grey line of
// explanation - thirteen of them down one card, which is thirteen lines he
// scrolls past to reach a number he wanted to change. While this is an array
// the explanations are collected into it instead, and the card ends with one
// "What's this?" holding all of them.
let settingsRateNotes = null;

// Appends a tap-to-edit row and, when there is one, the line of his own words
// underneath it. Appending rather than returning a wrapper on purpose:
// .row:last-child drops its bottom border, and a wrapper per row would make
// every single row a last child and take every separator off the card.
function settingRow(box, label, valueText, onTap, captionText, opts) {
  const line = row(label, valueText, onTap, opts || (settingsRateNotes ? { keypad: true } : null));
  box.appendChild(line);
  if (captionText) {
    if (settingsRateNotes) settingsRateNotes.push(label + ': ' + captionText);
    else box.appendChild(caption(captionText));
  }
  return line;
}

// The strip of buttons that opens under a row he tapped, in the one shape
// every inline menu in this app now wears: inside the card, indented past the
// row, tied to it by the accent edge, and with 16px of clear space before the
// next row instead of a Cancel button touching it.
function settingActions(parentEl, buttons, opts) {
  const o = opts || {};
  return attachedStrip(parentEl, buttons.map(([label, cls, onTap]) => ({ label, cls, onTap })), {
    label: o.label,
    content: o.content,
    cancel: () => { settingsMenu = null; render(); },
  });
}

// A 44px square: ▲ ▼ ✕. Small only in width — never in height, and never in
// what happens when it is pressed.
function settingMiniButton(glyph, label, disabled, onTap) {
  const btn = textButton(glyph, 'set-mini' + (label === 'Remove' ? ' set-mini-danger' : ''), disabled ? null : onTap);
  btn.setAttribute('aria-label', label);
  btn.disabled = !!disabled;
  return btn;
}

// "Show hidden" only exists when something is hidden. A toggle for an empty
// set is a control that does nothing, which is worse than no control.
function settingHiddenToggle(box, key, hiddenCount) {
  if (hiddenCount === 0) return;
  box.appendChild(textButton(
    (settingsShowHidden[key] ? 'Hide hidden' : 'Show hidden') + ' (' + hiddenCount + ')',
    'link-btn',
    () => { settingsShowHidden[key] = !settingsShowHidden[key]; settingsMenu = null; render(); }
  ));
}

// Hide/Unhide, written once for all four lists that have one — crew,
// equipment, clauses, catalog parts. Nothing is ever spliced (see rule 2 at
// the top), so this is the only delete on the screen and it is the same four
// lines everywhere: flip the flag, close the strip, save, and on a refused
// save put BOTH back — the flag and the strip. A refusal that also swallowed
// the buttons would leave him looking at a row he just told to hide, with
// nothing on screen to try again with.
// Hide is REVERSIBLE - it takes a name off new bids and leaves it on the ones
// it is already on - so it is a neutral outlined button. It used to be red,
// which put it beside Delete wearing the same colour and made the safe answer
// look like the dangerous one.
function settingsHideAction(entry, list) {
  return [entry.hidden ? 'Unhide' : 'Hide', '', () => {
    // Unhiding onto a name that is already on the list makes two rows he
    // cannot tell apart — and worse, two rows the WALK cannot tell apart: he
    // put "Bender" away, typed "Bender" again as a new tool, and unhiding the
    // old one hands the picker the same word twice with different money
    // behind it. The list stays as it is and says which name is in the way.
    if (entry.hidden) {
      const clash = settingsVisibleNamesake(entry, list);
      if (clash) { showBanner('There is already a visible ' + clash + '.'); return; }
    }
    const prevHidden = entry.hidden;
    const prevMenu = settingsMenu;
    entry.hidden = !prevHidden;
    settingsMenu = null;
    settingsSaveAndRender(() => { entry.hidden = prevHidden; settingsMenu = prevMenu; });
  }];
}

// The name of a SHOWN entry that this hidden one would collide with, or null.
// One function for all four lists, so crew, equipment, clauses and catalog
// answer the question the same way: a man, a tool, a part and a clause are all
// picked off a list by their name, and only the name.
//
// Case-insensitive and blind to the spaces either side, the same comparison
// Store.findEquipmentByName makes — "bender" and "Bender " are one name in his
// head. Two rows only collide inside the same drawer, which is what category
// and group are: he picks a part one category at a time and a clause one group
// at a time, so "Coupling" in Fittings and "Coupling" in Strut are two rows he
// never sees side by side. Crew and equipment have neither field, so both
// sides read undefined and the drawer check is a no-op.
function settingsEntryName(entry) {
  return String((entry && (entry.name != null ? entry.name : entry.title)) || '').trim();
}

function settingsVisibleNamesake(entry, list) {
  const key = settingsEntryName(entry).toLowerCase();
  if (!key || !Array.isArray(list)) return null;
  const hit = list.find((x) => x !== entry
    && !x.hidden
    && x.category === entry.category
    && x.group === entry.group
    && settingsEntryName(x).toLowerCase() === key);
  return hit ? settingsEntryName(hit) : null;
}

// --- Hide, or really delete -------------------------------------------------
// Hiding is the soft delete every list on this screen used to have, and it is
// there for one reason: an old bid holds ids, and a bid holding an id nothing
// answers is a bid validateImport refuses — the whole file, not just that bid.
//
// But most of what he puts away is not on any bid at all: a tool he bought and
// never billed, a clause he wrote and never ticked, a part he added by
// mistake. Hiding those leaves a list that only ever grows, with no way to
// take anything out of it. So each row asks Store first:
//
//   nothing points at it   — Hide AND Delete, and Delete really splices it out
//   something points at it — Hide only, and the caption says how many bids
//
// Hide is on both sides of that line. A tool he put away by mistake must not be
// reachable only through deleting it, and a tool he wants out of the picker
// until spring must not have to be deleted to get there.
function settingsInUseText(uses) {
  return 'On ' + uses + ' bid' + (uses === 1 ? '' : 's') + ', so it can be hidden but not deleted.';
}

function settingsDeleteAction(list, entry, what) {
  return ['Delete', 'btn-danger-outline', async () => {
    // "Not on any bid" rather than "nothing uses it": one sentence covers a
    // man, a tool, a part and a clause without calling any of them "it".
    const ok = await confirmPanel('Delete ' + what + '? Not on any bid. This can\'t be undone.',
      { ok: 'Delete', danger: true });
    if (!ok) { render(); return; }
    // Asked again after the question: a bid made while the panel was open
    // could be the one that now names this id, and the save would be refused
    // with the entry already gone from the list on screen.
    const i = list.indexOf(entry);
    if (i === -1) { render(); return; }
    const prevMenu = settingsMenu;
    list.splice(i, 1);
    settingsMenu = null;
    settingsSaveAndRender(() => { list.splice(i, 0, entry); settingsMenu = prevMenu; });
  }];
}

// Appends the row's action strip and, when it is one of the rows that cannot
// be deleted, the sentence saying why. buttons are the row's own edits; the
// remove action is decided here so all four lists decide it the same way.
function settingsRemoveActions(box, parentEl, buttons, entry, uses, list, what, content) {
  // Hide is on EVERY row. It used to disappear the moment nothing pointed at
  // an entry, which left one button on that row and it was the irreversible
  // one: a tool he wanted out of the picker for the season had Delete as the
  // only way to do it. Hiding is never the wrong answer, so it is never the
  // missing one; Delete just joins it when there is really nothing to lose.
  buttons.push(settingsHideAction(entry, list));
  if (uses === 0) buttons.push(settingsDeleteAction(list, entry, what));
  const strip = settingActions(parentEl, buttons, { content });
  if (!strip.parentNode) box.appendChild(strip);
  if (uses > 0) box.appendChild(caption(settingsInUseText(uses)));
}

// --- Nothing here reaches backwards any more --------------------------------
// Hours per day, payroll burden, consumables, the truck day rate, overhead and
// the crew's wages used to move every bid in the file, sent ones included, so
// each one asked a question before it would move. Every one of them is now
// copied onto a bid the day it is written and read off the bid forever after
// (Store.newBid, BidMath.bidSetting), so Settings decides what the NEXT bid
// starts at and nothing else. The questions are gone with the reach; the
// captions say "New bids only" instead.

// --- Typing a number --------------------------------------------------------

// A percentage. Out of range never touches the settings, and since nothing was
// written there is nothing to re-render: the row he tapped is still on the
// glass and is the thing that gets shaken.
function settingsPromptPct(current, label, node, apply) {
  promptNumber(current, {
    label,
    allowDecimal: true,
    maxDecimals: 1,
    maxChars: SET_PCT_KEYS,
    wasText: 'was ' + pctText(current),
    done: (v) => {
      if (v === null) return;
      if (v > SET_MAX_PCT) {
        showBanner('A percentage here is between 0 and ' + SET_MAX_PCT);
        shake(node);
        return;
      }
      apply(v);
    },
  });
}

// A whole number in a range. Clear means "leave it alone": there is no such
// thing as a settings screen with no hours in a day.
function settingsPromptWhole(current, label, node, min, max, refusal, apply) {
  promptNumber(current, {
    label,
    maxChars: String(max).length,
    done: (v) => {
      if (v === null) return;
      const n = Math.round(v);
      if (n < min || n > max) {
        showBanner(refusal);
        shake(node);
        return;
      }
      apply(n);
    },
  });
}

// Every string on this screen goes through here so the shape is one shape:
// Cancel changes nothing, and an empty answer is only refused where a blank
// would print blank on a customer's paper.
//
// opts is { required, multiline } — two separate questions, and they are kept
// separate because the clause wording is BOTH. Folding them into one argument
// is how a blanked clause used to reach the paper as a bare heading: the
// wording asked for a big box and silently gave up its empty check to get it.
function settingsPromptText(current, label, placeholder, node, opts, apply) {
  const o = opts || {};
  promptText(current, {
    label,
    placeholder,
    multiline: !!o.multiline,
    done: (text) => {
      if (o.required && !text) {
        showBanner(label + ' cannot be empty');
        shake(node);
        return;
      }
      apply(text);
    },
  });
}

// ---------------------------------------------------------------------------
// COMPANY
// ---------------------------------------------------------------------------
// What prints across the top of every proposal, and the signature at the
// bottom. None of it touches a number, so none of it asks a question first.

const SETTINGS_COMPANY_FIELDS = [
  ['name', 'Company', 'Cantu Electric LLC', true],
  ['person', 'Your name', 'Andy Cantu', false],
  ['phone', 'Phone', '(480) 555-0100', false],
  ['email', 'Email', 'you@example.com', false],
  ['address', 'Address', 'Street, city, state, zip', false],
  ['roc', 'License', 'AZ ROC #000000', false],
  ['tagline', 'Tagline', 'Licensed, bonded, and insured', false],
  ['signName', 'Signs as', 'Andy Cantu', false],
];

function buildSetCompany() {
  const co = setS().company;
  const box = card('Company');

  SETTINGS_COMPANY_FIELDS.forEach(([key, label, placeholder, required]) => {
    const line = settingRow(box, label, co[key], () => {
      settingsPromptText(co[key], label, placeholder, line, { required }, (text) => {
        const prev = co[key];
        co[key] = text;
        settingsSaveAndRender(() => { co[key] = prev; });
      });
    });
  });

  // The same far-reach question the tax line asks, for the same reason: this
  // is not a setting that only touches new bids. A proposal is re-printed off
  // whatever the settings say TODAY, so flipping this restyles the PDF for a
  // bid that went out in March. The caption already said so and the toggle
  // still changed on one tap; now the tap has to be meant.
  box.appendChild(fieldLabel('Proposal style'));
  box.appendChild(toggleRow([[false, 'Blue & logo'], [true, 'Plain black']], co.plainStyle, async (v) => {
    if (v === co.plainStyle) return;
    const ok = await confirmPanel('Change how the proposal looks? This changes every proposal you print '
      + 'from now on, including ones already sent.');
    // Cancel leaves the setting alone, and the re-render puts the toggle back
    // on the side it was already on.
    if (!ok) { render(); return; }
    const prev = co.plainStyle;
    co.plainStyle = v;
    settingsSaveAndRender(() => { co.plainStyle = prev; });
  }));
  box.appendChild(caption('How the PDF looks. Changes every proposal you print from now on, '
    + 'including ones you already sent.'));

  return box;
}

// ---------------------------------------------------------------------------
// CREW
// ---------------------------------------------------------------------------
// A wage is NEW BIDS ONLY. What a man is paid is stamped onto a bid the first
// time he lands on it (Store.newBid, Store.noteCrewWage) and costStack reads
// that stamp, so a raise typed here is what the next bid pays him and every
// bid he is already on keeps the wage it was figured at. Hiding him reaches no
// further: the id stays in the file, an old bid keeps him and keeps
// validating, and Store.newBid simply stops seeding him onto new ones.

function buildSetCrew() {
  const s = setS();
  const box = card('Crew');
  const hidden = s.crew.filter((c) => c.hidden);
  const list = s.crew.filter((c) => !c.hidden || settingsShowHidden.crew);

  if (list.length === 0) {
    box.appendChild(emptyNote('Nobody on the crew yet.'));
  } else {
    list.forEach((c) => buildSetCrewRow(box, c));
  }

  box.appendChild(textButton('+ Worker', 'btn btn-block mt-3', settingsAddCrew));
  settingHiddenToggle(box, 'crew', hidden.length);
  box.appendChild(caption('Hiding somebody keeps him on the bids he is already on. '
    + 'He just stops showing up on new ones. A raise is new bids only: a bid he is already on keeps '
    + 'the wage he went on it at.'));
  return box;
}

function buildSetCrewRow(box, c) {
  const key = 'crew:' + c.id;
  const line = settingRow(box, c.name || 'Worker', moneyText(c.wageCents) + '/hr',
    () => settingsToggleMenu(key));
  if (c.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  settingsRemoveActions(box, line, [
    ['Name', '', () => {
      settingsPromptText(c.name, 'Name', 'Shawn', line, { required: true }, (text) => {
        const prev = c.name;
        c.name = text;
        settingsSaveAndRender(() => { c.name = prev; });
      });
    }],
    ['Wage', '', () => settingsEditWage(c)],
  ], c, Store.crewInUse(state.data, c.id), setS().crew, c.name || 'this worker');
}

// Changing a wage, after the question about how far it reaches has been
// answered. Its own function because a typed 0 asks again, and asking again
// must not re-ask the confirm — he already said yes to changing the wage; what
// he has not done yet is name one.
//
// Zero is not a wage. costStack multiplies it by every hour of every bid he
// goes on from here, so a man at $0.00/hr works for free on paper and quietly
// eats the margin — the same reason + Worker refuses one. Clear is different and is
// left alone: on a man who already has a wage, "clear" is "leave it as it is",
// the way it is everywhere else on this screen.
// again: the keypad has just come back because a zero was typed, and the
// reason is in the label. Not a banner: the keypad panel covers the banner
// area, so the only feedback he can see is the one line above the digits.
function settingsEditWage(c, again) {
  promptMoney(c.wageCents, {
    label: (c.name || 'Worker') + ', paid an hour on new bids' + (again ? '. Enter more than $0' : ''),
    done: (cents) => {
      if (cents === null) return;
      if (!(cents > 0)) {
        settingsEditWage(c, true);
        return;
      }
      const prev = c.wageCents;
      c.wageCents = cents;
      settingsSaveAndRender(() => { c.wageCents = prev; });
    },
  });
}

function settingsAddCrew() {
  promptText('', {
    label: 'Name',
    placeholder: 'Shawn',
    done: (name) => {
      if (!name) return;
      settingsAskWage(name);
    },
  });
}

// The wage half of + Worker. A wage is the one thing a man on the crew cannot
// be missing: costStack multiplies it by every hour on every bid he is on, so
// a man with no wage is a man who works for free on paper and quietly eats the
// margin. Clear and zero both come back here with the question again — the
// same thing the price screen does with a day count that cannot be zero —
// rather than being written down as $0.00/hr. Cancel still cancels: the panel
// closes, nothing was pushed, and there is no half-built man in the file.
//
// Why the question comes back with the reason in its own label and not on a
// banner: the keypad panel sits over the banner area, so a banner fired while
// it is open is a banner nobody ever sees.
function settingsAskWage(name, again) {
  promptMoney(null, {
    label: name + ', paid an hour' + (again ? '. Enter more than $0' : ''),
    done: (cents) => {
      if (cents === null || !(cents > 0)) {
        settingsAskWage(name, true);
        return;
      }
      const person = { id: Store.uid(), name, wageCents: cents, hidden: false };
      const s = setS();
      s.crew.push(person);
      settingsSaveAndRender(() => {
        const i = s.crew.indexOf(person);
        if (i !== -1) s.crew.splice(i, 1);
      });
    },
  });
}

// ---------------------------------------------------------------------------
// RATES
// ---------------------------------------------------------------------------
// Every row here carries its reach in its caption, in his words, and since the
// snapshot rule landed there is only one reach left to carry: NEW BIDS ONLY.
// Nothing on this card moves a bid that already exists. See the header comment
// for how each claim was checked against costStack and Store.newBid.

function buildSetRates() {
  const s = setS();
  const box = card('Rates & percentages');
  settingsRateNotes = [];

  const hpd = settingRow(box, 'Hours per day', numText(s.hoursPerDay) + (s.hoursPerDay === 1 ? ' hour' : ' hours'),
    () => {
      settingsPromptWhole(s.hoursPerDay, 'Hours in a work day', hpd, SET_HPD_MIN, SET_HPD_MAX,
        'A work day is between ' + SET_HPD_MIN + ' and ' + SET_HPD_MAX + ' whole hours',
        (v) => {
          const prev = s.hoursPerDay;
          s.hoursPerDay = v;
          settingsSaveAndRender(() => { s.hoursPerDay = prev; });
        });
    },
    'How long a work day is. Days times this is hours. New bids only. A bid you already have keeps its own, '
    + 'and the Labor screen changes it.');

  settingsPctRow(box, s, 'burdenPct', 'Payroll burden',
    'Taxes, workers comp, and insurance on top of a wage. New bids only. Change a bid you already have on its '
    + 'Costs & price screen.');

  settingRow(box, 'Labor rate', moneyText(s.rateCents) + '/hr', () => {
    promptMoney(s.rateCents, {
      label: 'Labor rate an hour, new bids',
      done: (cents) => {
        if (cents === null) return;
        const prev = s.rateCents;
        s.rateCents = cents;
        settingsSaveAndRender(() => { s.rateCents = prev; });
      },
    });
  }, 'What an hour sells for. New bids start here. Bids you already have keep their own rate.');

  settingRow(box, 'Rate floor', moneyText(s.floorCents) + '/hr', () => {
    promptMoney(s.floorCents, {
      label: 'The lowest rate worth working for',
      done: (cents) => {
        if (cents === null) return;
        const prev = s.floorCents;
        s.floorCents = cents;
        settingsSaveAndRender(() => { s.floorCents = prev; });
      },
    });
  }, 'The lowest rate worth working for. Any bid under it gets a red line on its price screen. No price moves.');

  settingsPctRow(box, s, 'marginPct', 'Default margin',
    'What a new bid aims for. New bids only.');

  settingsPctRow(box, s, 'markupPct', 'Material markup',
    'What you add to what the material cost you. New bids only.');

  settingsPctRow(box, s, 'consumablesPct', 'Consumables',
    'Tape, wire nuts, straps, bits, blades. A share of material cost. New bids only.');

  settingRow(box, 'Truck & gas', moneyText(s.truckDayCents) + '/day', () => {
    promptMoney(s.truckDayCents, {
      label: 'Truck and gas a day, new bids',
      done: (cents) => {
        if (cents === null) return;
        const prev = s.truckDayCents;
        s.truckDayCents = cents;
        settingsSaveAndRender(() => { s.truckDayCents = prev; });
      },
    });
  }, 'What the truck costs you for a day on the job. New bids only.');

  settingsPctRow(box, s, 'overheadPct', 'Overhead',
    'Insurance, shop, phones, Jack, spread over every job. New bids only.');

  settingsCushionRow(box, s, 'service', 'Cushion, service call',
    'Extra hours you quote on a service call and hope not to work. New bids only.');
  settingsCushionRow(box, s, 'project', 'Cushion, project',
    'Extra hours you quote on a project and hope not to work. New bids only.');

  settingsPctRow(box, s, 'equipmentPct', 'Equipment',
    'A day of your own tool, as a share of what it cost new. Sets the rate the picker offers next time. '
    + 'Tools already on a bid keep the rate they went on at.');

  const val = settingRow(box, 'Price good for', s.validityDays + (s.validityDays === 1 ? ' day' : ' days'), () => {
    settingsPromptWhole(s.validityDays, 'Days a new bid holds its price', val,
      SET_VALIDITY_MIN, SET_VALIDITY_MAX,
      'Days must be between ' + SET_VALIDITY_MIN + ' and ' + SET_VALIDITY_MAX,
      (v) => {
        const prev = s.validityDays;
        s.validityDays = v;
        settingsSaveAndRender(() => { s.validityDays = prev; });
      });
  }, 'How long a new bid says the price holds. New bids only.');

  box.appendChild(fieldLabel('Sales tax on materials'));
  box.appendChild(toggleRow([['included', 'In the price'], ['added', 'Added later']], s.taxMode, async (v) => {
    if (v === s.taxMode) return;
    const ok = await confirmPanel('Change what the paper says about tax? This changes the tax line on EVERY '
      + 'proposal, including ones already sent, the next time one is printed.');
    if (!ok) { render(); return; }
    const prev = s.taxMode;
    s.taxMode = v;
    settingsSaveAndRender(() => { s.taxMode = prev; });
  }));
  box.appendChild(caption('One sentence on the proposal. It does not change a price either way.'));

  // The card's thirteen explanations, folded. Each row still says what it is
  // and what it is set to; what it MEANS is one tap away instead of a grey
  // line between every pair of numbers.
  const notes = settingsRateNotes;
  settingsRateNotes = null;
  box.appendChild(whatsThis(notes, 'What these mean'));

  return box;
}

// The seven plain percentages. Every one of them is copied onto a new bid and
// reaches no further, so none of them asks anything first.
function settingsPctRow(box, s, key, label, captionText) {
  const line = settingRow(box, label, pctText(s[key]), () => {
    settingsPromptPct(s[key], label + ' %', line, (v) => {
      const prev = s[key];
      s[key] = v;
      settingsSaveAndRender(() => { s[key] = prev; });
    });
  }, captionText);
  return line;
}

// The two cushions live one level down, in cushionPct, and are otherwise the
// same row. Both are copied onto a new bid by job type, so neither asks.
function settingsCushionRow(box, s, jobType, label, captionText) {
  const line = settingRow(box, label, pctText(s.cushionPct[jobType]), () => {
    settingsPromptPct(s.cushionPct[jobType], label + ' %', line, (v) => {
      const prev = s.cushionPct[jobType];
      s.cushionPct[jobType] = v;
      settingsSaveAndRender(() => { s.cushionPct[jobType] = prev; });
    });
  }, captionText);
  return line;
}

// ---------------------------------------------------------------------------
// EQUIPMENT
// ---------------------------------------------------------------------------
// His own tools. A day of one bills at equipment % of what it cost new,
// rounded to the nearest $5 with a $5 minimum, unless he has typed an
// override — worked out by ui.js equipmentDayCents so the picker on the price
// screen, the walk, and this list all quote the same tool at the same number.
//
// Nothing here moves a bid: the rate is copied onto the bid line the moment
// the tool is picked, so a cost typed today changes what the picker offers
// tomorrow and leaves every existing bid exactly where it is.

function buildSetEquipment() {
  const s = setS();
  const box = card('Equipment');
  const hidden = s.equipment.filter((e) => e.hidden);
  const list = s.equipment.filter((e) => !e.hidden || settingsShowHidden.equipment);

  if (list.length === 0) {
    box.appendChild(emptyNote('No equipment yet.'));
  } else {
    list.forEach((e) => buildSetEquipmentRow(box, e, s.equipmentPct));
  }

  box.appendChild(textButton('+ Tool', 'btn btn-block mt-3', settingsAddTool));
  settingHiddenToggle(box, 'equipment', hidden.length);
  box.appendChild(caption('A day of a tool bills at ' + pctText(s.equipmentPct)
    + ' of what it cost new, to the nearest $5, never under $5, unless you set your own rate.'));
  return box;
}

function buildSetEquipmentRow(box, e, equipmentPct) {
  const key = 'equip:' + e.id;
  const rate = equipmentDayCents(e, equipmentPct);
  const valueText = (e.costCents == null ? 'no cost yet' : moneyText(e.costCents))
    + ' · ' + (rate == null ? 'no rate' : moneyText(rate) + '/day');

  const line = settingRow(box, e.name || 'Tool', valueText, () => settingsToggleMenu(key));
  if (e.hidden) line.classList.add('set-hidden');
  if (e.overrideDayCents != null) {
    const tag = document.createElement('em');
    tag.className = 'set-override';
    tag.textContent = 'override';
    (line.querySelector('.row-value') || line).appendChild(tag);
  }

  if (!settingsMenuOpen(key)) return;

  const buttons = [
    ['Name', '', () => {
      settingsPromptText(e.name, 'Name', 'Threader', line, { required: true }, (text) => {
        const prev = e.name;
        e.name = text;
        settingsSaveAndRender(() => { e.name = prev; });
      });
    }],
    ['Cost new', '', () => {
      promptMoney(e.costCents, {
        label: (e.name || 'Tool') + ', what it cost new',
        done: (cents) => {
          const prev = e.costCents;
          e.costCents = cents;   // Clear means "I don't know", which is a real answer
          settingsSaveAndRender(() => { e.costCents = prev; });
        },
      });
    }],
    [e.overrideDayCents == null ? 'Set day rate' : 'Change day rate', '', () => {
      promptMoney(e.overrideDayCents, {
        label: (e.name || 'Tool') + ', your own day rate',
        done: (cents) => {
          const prev = e.overrideDayCents;
          e.overrideDayCents = cents;   // Clear here is the same as clearing the override
          settingsSaveAndRender(() => { e.overrideDayCents = prev; });
        },
      });
    }],
  ];

  if (e.overrideDayCents != null) {
    buttons.push(['Clear day rate', '', () => {
      const prev = e.overrideDayCents;
      e.overrideDayCents = null;
      settingsSaveAndRender(() => { e.overrideDayCents = prev; });
    }]);
  }

  settingsRemoveActions(box, line, buttons, e, Store.equipmentInUse(state.data, e.id),
    setS().equipment, e.name || 'this tool');
}

// Name, then what it cost new, then one push and one save — the entry is
// built whole before anything is written, so a Cancel at the money panel
// leaves nothing behind. The shape of the entry is Store.newTool's, shared
// with the price screen's + Tool so the two doors into this list cannot drift.
// A second tap while either panel is up is dropped by the panels themselves
// (app.js anyPanelOpen), so a fat double-tap adds one tool, not two.
function settingsAddTool() {
  promptText('', {
    label: 'Tool',
    placeholder: 'Threader',
    done: (name) => {
      if (!name) return;
      settingsAskToolCost(name);
    },
  });
}

// The cost half of + Tool. A new tool has to arrive with a cost: the day rate
// is a share of it, so a tool with none has no rate and the picker on the
// price screen cannot quote it. Clear and zero come back with the question
// again rather than filing a tool nobody can use; Cancel closes the panel and
// nothing is written. (A tool already on the list may go back to "no cost
// yet" — that is what Cost new's Clear is for, and it is still a real answer
// there.)
function settingsAskToolCost(name, again) {
  promptMoney(null, {
    label: name + ', what it cost new' + (again ? '. Enter more than $0' : ''),
    done: (cents) => {
      if (cents === null || !(cents > 0)) {
        settingsAskToolCost(name, true);
        return;
      }
      // Store.newTool only ever refuses a blank name or a cost that isn't a
      // whole number above zero. Both are guarded — the name by the caller,
      // the cost one line up — so there is no null to check for here.
      const tool = Store.newTool(state.data, name, cents);
      const s = setS();
      settingsSaveAndRender(() => {
        const i = s.equipment.indexOf(tool);
        if (i !== -1) s.equipment.splice(i, 1);
      });
    },
  });
}

// ---------------------------------------------------------------------------
// LISTS
// ---------------------------------------------------------------------------
// Two lists of plain strings. Nothing references a string by id, so these are
// the only two lists on this screen where Remove really removes.
//
// The did-you-forget list is read top to bottom on the walk, so its ORDER is
// the point: the thing he forgets most often belongs at the top. ▲▼ rather
// than a drag, because a drag on a phone is a gesture he has to already know
// about, and this list is six items long.

function settingsListRow(box, text, buttons) {
  const line = document.createElement('div');
  line.className = 'set-list-row';
  const span = document.createElement('span');
  span.className = 'set-list-text';
  span.textContent = text;
  line.appendChild(span);
  const group = document.createElement('div');
  group.className = 'set-list-btns';
  buttons.forEach((b) => group.appendChild(b));
  line.appendChild(group);
  box.appendChild(line);
  return line;
}

// One move, one save, one undo — written once because the two arrows are the
// same operation in opposite directions.
function settingsMoveString(listName, i, delta) {
  const s = setS();
  const list = s[listName];
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  const moved = list.splice(i, 1)[0];
  list.splice(j, 0, moved);
  settingsSaveAndRender(() => {
    const back = list.splice(j, 1)[0];
    list.splice(i, 0, back);
  });
}

async function settingsRemoveString(listName, i, what) {
  const s = setS();
  const list = s[listName];
  const text = list[i];
  const ok = await confirmPanel('Take "' + text + '" off the ' + what + '?', { ok: 'Remove', danger: true });
  if (!ok) { render(); return; }
  list.splice(i, 1);
  settingsSaveAndRender(() => { list.splice(i, 0, text); });
}

function settingsAddString(listName, label, placeholder, multiline) {
  promptText('', {
    label,
    placeholder,
    multiline: !!multiline,
    done: (text) => {
      if (!text) return;
      const s = setS();
      if (s[listName].indexOf(text) !== -1) { showBanner('That one is already on the list'); return; }
      s[listName].push(text);
      settingsSaveAndRender(() => {
        const i = s[listName].indexOf(text);
        if (i !== -1) s[listName].splice(i, 1);
      });
    },
  });
}

function buildSetForget() {
  const s = setS();
  const box = card('Did you forget');
  if (s.forgetList.length === 0) {
    box.appendChild(emptyNote('Nothing on the list.'));
  } else {
    s.forgetList.forEach((text, i) => {
      settingsListRow(box, text, [
        settingMiniButton('▲', 'Move up', i === 0, () => settingsMoveString('forgetList', i, -1)),
        settingMiniButton('▼', 'Move down', i === s.forgetList.length - 1, () => settingsMoveString('forgetList', i, 1)),
        settingMiniButton('✕', 'Remove', false, () => settingsRemoveString('forgetList', i, 'list')),
      ]);
    });
  }
  box.appendChild(textButton('+ Item', 'btn btn-block mt-3',
    () => settingsAddString('forgetList', 'Did you forget', 'Permits', false)));
  box.appendChild(caption('The walk asks you about these, in this order. Put what you forget most at the top.'));
  return box;
}

function buildSetNotePhrases() {
  const s = setS();
  const box = card('Note phrases');
  if (s.notePhrases.length === 0) {
    box.appendChild(emptyNote('No phrases saved.'));
  } else {
    s.notePhrases.forEach((text, i) => {
      settingsListRow(box, text, [
        settingMiniButton('✕', 'Remove', false, () => settingsRemoveString('notePhrases', i, 'phrases')),
      ]);
    });
  }
  box.appendChild(textButton('+ Phrase', 'btn btn-block mt-3',
    () => settingsAddString('notePhrases', 'Note or exclusion', 'Does not include...', false)));
  box.appendChild(caption('One tap each on the proposal screen. Taking one off here leaves it on the bids that already print it.'));
  return box;
}

// ---------------------------------------------------------------------------
// TERMS
// ---------------------------------------------------------------------------
// The clause library, grouped the way the proposal screen groups it. Groups
// are collapsed until he opens one: twenty-six clauses laid flat is a wall,
// and he comes here to change one of them, not to read all of them.
//
// Hidden is the only kind of delete: DocModel drops a hidden clause off the
// paper even when a bid still names its id, and un-hiding brings it back
// still ticked. Splicing it would break every bid that chose it.

function buildSetTerms() {
  const s = setS();
  const box = card('Terms library');

  if (settingsAddGroup) {
    box.appendChild(fieldLabel('Which group?'));
    const chips = document.createElement('div');
    chips.className = 'set-chips';
    CLAUSE_GROUPS.forEach(([key, label]) => {
      chips.appendChild(chip(label, false, () => settingsAddClause(key)));
    });
    box.appendChild(chips);
    box.appendChild(textButton('Cancel', 'btn btn-block', () => { settingsAddGroup = false; render(); }));
    return box;
  }

  const hidden = s.clauses.filter((c) => c.hidden);
  const named = new Set(CLAUSE_GROUPS.map(([k]) => k));
  const visible = (list) => list.filter((c) => !c.hidden || settingsShowHidden.clauses);

  CLAUSE_GROUPS.forEach(([key, label]) => {
    const group = visible(s.clauses.filter((c) => c.group === key));
    if (group.length) buildSetClauseGroup(box, key, label, group);
  });
  const other = visible(s.clauses.filter((c) => !named.has(c.group)));
  if (other.length) buildSetClauseGroup(box, 'other', 'Other', other);

  box.appendChild(textButton('+ Clause', 'btn btn-block mt-3', () => { settingsAddGroup = true; render(); }));
  settingHiddenToggle(box, 'clauses', hidden.length);
  box.appendChild(caption('A hidden clause comes off every proposal, even bids that already picked it. '
    + 'Unhide it and it is back on them.'));
  return box;
}

function buildSetClauseGroup(box, key, label, group) {
  const open = settingsGroupOpen === key;
  const head = textButton('', 'set-group', () => {
    settingsGroupOpen = open ? null : key;
    settingsMenu = null;
    render();
  });
  const name = document.createElement('span');
  name.textContent = (open ? '▾ ' : '▸ ') + label;
  head.appendChild(name);
  const count = document.createElement('span');
  count.className = 'set-group-count';
  count.textContent = group.length + (group.length === 1 ? ' clause' : ' clauses');
  head.appendChild(count);
  box.appendChild(head);

  if (!open) return;
  group.forEach((c) => buildSetClauseRow(box, c));
}

function buildSetClauseRow(box, c) {
  const key = 'clause:' + c.id;
  const line = settingRow(box, c.title || 'Clause', c.hidden ? 'Hidden' : 'Shown',
    () => settingsToggleMenu(key));
  if (c.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  const wording = caption(c.text);
  box.appendChild(wording);
  settingsRemoveActions(box, wording, [
    ['Title', '', () => {
      settingsPromptText(c.title, 'Clause title', 'Payment', line, { required: true }, (text) => {
        const prev = c.title;
        c.title = text;
        settingsSaveAndRender(() => { c.title = prev; });
      });
    }],
    ['Wording', '', () => {
      settingsPromptText(c.text, 'Clause wording', '', line, { required: true, multiline: true }, (text) => {
        const prev = c.text;
        c.text = text;
        settingsSaveAndRender(() => { c.text = prev; });
      });
    }],
  ], c, Store.clauseInUse(state.data, c.id), setS().clauses, c.title || 'this clause');
}

function settingsAddClause(group) {
  settingsAddGroup = false;
  promptText('', {
    label: 'Clause title',
    placeholder: 'Payment',
    done: (title) => {
      if (!title) { render(); return; }
      promptText('', {
        label: 'Clause wording',
        placeholder: 'What it says on the paper',
        multiline: true,
        done: (text) => {
          if (!text) { render(); return; }
          const clause = { id: Store.uid(), group, title, text, hidden: false };
          const s = setS();
          s.clauses.push(clause);
          settingsGroupOpen = group;
          settingsSaveAndRender(() => {
            const i = s.clauses.indexOf(clause);
            if (i !== -1) s.clauses.splice(i, 1);
          });
        },
      });
    },
  });
}

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------
// The parts list, one category at a time — sixty parts on one screen is a
// scroll, six buttons and twelve parts is a list. Order inside a category is
// Catalog.matches's: most-used first, then alphabetical, so the order comes
// off his own history rather than off the order the seed list was typed in.
//
// Hiding is the delete here too: an item on an old bid points at a catalog id,
// and Store's validator wants that id to still exist.

function buildSetCatalog() {
  const d = state.data;
  const box = card('Parts catalog');

  const chips = document.createElement('div');
  chips.className = 'set-chips';
  CATALOG_CATEGORIES.forEach(([key, label]) => {
    chips.appendChild(chip(label, settingsCategory === key, () => {
      settingsCategory = key;
      settingsMenu = null;
      render();
    }));
  });
  box.appendChild(chips);

  // The visible parts come back in Catalog.matches's order, which is the order
  // the walk offers them in; the hidden ones are tacked on the end by name,
  // because a put-away part has no use count worth ranking on.
  const shown = Catalog.matches(d.catalog, { category: settingsCategory, includeRentals: true });
  const hidden = d.catalog
    .filter((p) => p.category === settingsCategory && p.hidden)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const list = settingsShowHidden.catalog ? shown.concat(hidden) : shown;

  if (list.length === 0) {
    box.appendChild(emptyNote('Nothing in ' + catalogCategoryLabel(settingsCategory) + '.'));
  } else {
    list.forEach((p) => buildSetCatalogRow(box, p));
  }

  settingHiddenToggle(box, 'catalog', hidden.length);
  box.appendChild(caption('New parts get added from the walk. Hide takes it off the walk. '
    + 'Delete is only offered when no bid uses it.'));
  return box;
}

function buildSetCatalogRow(box, p) {
  const key = 'part:' + p.id;
  const line = settingRow(box, p.name || 'Part', p.unit || '—', () => settingsToggleMenu(key));
  if (p.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  // The unit chips ride inside the strip rather than sitting loose above it:
  // they are part of the same answer to "what about this part?".
  const units = document.createElement('div');
  units.className = 'set-chips';
  CATALOG_UNITS.forEach((unit) => {
    units.appendChild(chip(unit, p.unit === unit, () => {
      if (p.unit === unit) return;
      const prev = p.unit;
      p.unit = unit;
      settingsSaveAndRender(() => { p.unit = prev; });
    }));
  });

  settingsRemoveActions(box, line, [
    ['Rename', '', () => {
      settingsPromptText(p.name, 'Part name', '3/4" EMT', line, { required: true }, (text) => {
        const prev = p.name;
        // Same rule as adding one: what the iOS keyboard turned into a curly
        // quote is stored straight, or the search for 1" EMT stops finding it.
        p.name = Catalog.straighten(text);
        settingsSaveAndRender(() => { p.name = prev; });
      });
    }],
  ], p, Store.catalogInUse(state.data, p.id), state.data.catalog, p.name || 'this part', units);
}

// ---------------------------------------------------------------------------
// COUNTER
// ---------------------------------------------------------------------------
// The number the NEXT bid will take. Two bids with the same number on two
// pieces of paper in the same customer's hands is the failure this warns
// about, so it checks the number that is actually about to be used — not the
// one he just typed and not the one after it.

function buildSetCounter() {
  const s = setS();
  const box = card('Bid numbers');

  const line = settingRow(box, 'Next bid number', '#' + s.nextNumber, () => {
    settingsPromptWhole(s.nextNumber, 'The next bid number', line, 1, SET_NUMBER_MAX,
      'A bid number is between 1 and ' + SET_NUMBER_MAX,
      (v) => {
        const prev = s.nextNumber;
        s.nextNumber = v;
        settingsSaveAndRender(() => { s.nextNumber = prev; });
      });
  }, 'The number the next new bid gets. Set this to your real next invoice number the first day '
     + 'you use the app. It counts up on its own after that.');

  if (Store.numberInUse(state.data, s.nextNumber)) {
    box.appendChild(inlineWarn('Bid #' + s.nextNumber + ' already exists. The next new bid would '
      + 'carry the same number as one you have already written.'));
  }

  return box;
}

// ---------------------------------------------------------------------------
// LOCK
// ---------------------------------------------------------------------------
// Changing the PIN happens on the lock screen itself (app.js startPinChange),
// not in a fourth panel: one keypad, one set of dots, and 0412 stays 0412
// instead of becoming the number 412 on the way through a number pad.
//
// Removing it is honest about what it does. There is no unlocked app: with no
// PIN on file the lock screen asks him to pick one. So "Remove" means "ask me
// for a new one next time", and the caption says that rather than promising an
// app that opens straight to the bids list.

function buildSetLock() {
  const box = card('PIN');
  box.appendChild(row('Current', state.data.pin === null ? 'Not set yet' : '••••'));
  box.appendChild(textButton('Change PIN', 'btn btn-block mt-3', startPinChange));

  if (state.data.pin !== null) {
    box.appendChild(textButton('Forget this PIN', 'btn btn-danger-outline btn-block mt-3', async () => {
      const ok = await confirmPanel('Forget this PIN? The next time you open the app it will ask you '
        + 'to pick a new one.', { ok: 'Forget', danger: true });
      if (!ok) { render(); return; }
      const prev = state.data.pin;
      state.data.pin = null;
      settingsSaveAndRender(() => { state.data.pin = prev; });
    }));
  }

  box.appendChild(caption('Four digits. There is no way to look it up, so pick one you will not lose.'));
  return box;
}

// ---------------------------------------------------------------------------
// ELSEWHERE
// ---------------------------------------------------------------------------

function buildSetReports() {
  const box = card('Reports');
  box.appendChild(textButton('Open reports', 'btn btn-block', () => show('reports')));
  box.appendChild(caption('Win rate, job history, and what the jobs really cost.'));
  return box;
}

// ---------------------------------------------------------------------------
// BACKUP
// ---------------------------------------------------------------------------
// This app is the only place the bids live. His wife used to file them; she is
// out, and there is no server behind this — so the backup is not a nicety, it
// is the reason a dropped phone is a bad week instead of a lost year.
//
// A web app on iOS cannot save a file or send an email on its own. There is no
// way around that and no point pretending otherwise, so the two human steps
// are made unavoidable and visible instead: the app copies Adrian's address to
// the clipboard, says so, and opens the share sheet with the file already in
// it. He picks Mail and pastes. Two taps he can see, rather than a promise the
// browser cannot keep.
//
// What goes:
//   the JSON  — the whole document, every bid, every setting. THIS is the
//               backup; everything below is a convenience.
//   the PDFs  — every proposal made since the last backup, so the paper the
//               customer is holding has an off-phone copy too.
//   photos    — NOT in the routine backup. A walk of a dairy plant is tens of
//               megabytes and would make the one thing he has to do every two
//               weeks the one thing that fails. They go on their own, one bid
//               at a time, from their own button.
//
// THE RULE THIS CARD LIVES BY: navigator.share only works inside a live tap,
// and an await that crosses a task boundary spends it — Chrome then neither
// resolves nor rejects, which on screen is a button that never comes back. So
// every blob is already in memory before its button is drawn (the same thing
// the proposal screen does with Previous PDFs), the clipboard write is fired
// and NOT awaited, and each handler awaits exactly one share.

const SET_BACKUP_STALE_DAYS = 14;   // the home screen's band uses the same number
const SET_BACKUP_PDF_MAX = 25;      // how many new PDFs one share sheet is asked to carry
const SET_BACKUP_TITLE = 'CE Bids backup';

let settingsBackupBusy = false;
let settingsBackupPdfs = [];         // { id, bidId, at, blob } still pending, oldest first
let settingsBackupPdfExtra = 0;      // how many more there were than the cap allows
let settingsBackupQueue = null;      // { id, at, file } still to be offered one at a time
let settingsBackupQueueThrough = null; // where pdfsSentThroughMs lands once that queue is empty
let settingsBackupSentThrough = null; // where pdfsSentThroughMs lands if this whole set leaves
let settingsBackupPdfTotal = 0;      // how many are pending in all, the ones over the cap included
let settingsBackupPdfSkipped = 0;    // selected, but the blob was gone, so nothing to send
// The IndexedDB read has come back (either way), and whether it came back
// empty-handed. Send stays DISABLED until it has: a watermark computed from a
// list that has not loaded is a watermark over PDFs nobody looked at, and
// those PDFs would be stranded for good.
let settingsBackupPdfsReady = false;
let settingsBackupPdfsFailed = false;
let settingsBackupPhotoPick = false; // the bid chips are showing
let settingsBackupPhotos = null;     // { bidId, label, files } once its blobs are in memory
// Two counters, not one: the PDF load and a photo load run against different
// buttons and must not be able to cancel each other. Tapping Export photos
// while the PDFs were still coming in used to leave Send backup saying there
// were none.
let settingsBackupPdfToken = 0;
let settingsBackupPhotoToken = 0;

function settingsResetBackup() {
  settingsBackupBusy = false;
  settingsBackupPdfs = [];
  settingsBackupPdfExtra = 0;
  settingsBackupPdfTotal = 0;
  settingsBackupPdfSkipped = 0;
  settingsBackupPdfsReady = false;
  settingsBackupPdfsFailed = false;
  // Dropping a half-drained queue loses nothing. A PDF that never went is
  // still pending, because pdfsSentThroughMs only ever moves up to a PDF that
  // actually left the phone. Coming back to this screen offers it again.
  settingsBackupQueue = null;
  settingsBackupQueueThrough = null;
  settingsBackupSentThrough = null;
  settingsBackupPhotoPick = false;
  settingsBackupPhotos = null;
  settingsBackupPdfToken += 1;
  settingsBackupPhotoToken += 1;
}

// --- What is pending --------------------------------------------------------

// The bytes, in memory, before the Send button is drawn. WHICH ones, and where
// the watermark lands afterwards, is backupSelection's decision (ui.js,
// tested): the OLDEST capful of what is pending, so that repeated backups
// drain a backlog instead of stranding everything behind the cap. A share
// sheet handed two hundred files is a share sheet that does not open, and the
// JSON — the actual backup — has every bid in it either way.
//
// Until this resolves the Send button is disabled. It has to be: sending off
// an empty list would call every PDF sent that nobody read, and sending off a
// HALF-read one would move the watermark past files that were never in hand.
function settingsLoadBackupPdfs() {
  const token = ++settingsBackupPdfToken;
  settingsBackupPdfsReady = false;
  settingsBackupPdfsFailed = false;
  const through = setS().pdfsSentThroughMs;
  const failed = () => {
    if (token !== settingsBackupPdfToken) return;
    // The JSON is the backup and it does not need IndexedDB, so the button
    // comes back — with nothing riding along, and a line saying so.
    settingsBackupPdfs = [];
    settingsBackupPdfExtra = 0;
    settingsBackupPdfTotal = 0;
    settingsBackupPdfSkipped = 0;
    // The read itself failed, so nothing is known about what is pending and
    // nothing may be called sent. Null keeps the watermark where it is.
    settingsBackupSentThrough = null;
    settingsBackupPdfsReady = true;
    settingsBackupPdfsFailed = true;
    if (state.screen === 'settings') render();
  };
  return Photos.list('pdf').then((ids) => {
    if (token !== settingsBackupPdfToken) return;
    const entries = (ids || []).map(bidPdfParse).filter(Boolean);
    const sel = backupSelection(entries, through, SET_BACKUP_PDF_MAX);
    const take = sel.send.map((x) => ({ id: x.id, bidId: x.bidId, at: x.at, blob: null }));
    return Promise.all(take.map((e) => Photos.get(e.id).then((b) => { e.blob = b; }, () => { e.blob = null; })))
      .then(() => {
        if (token !== settingsBackupPdfToken) return;
        // A PDF whose blob has been evicted is not a PDF that can be sent, and
        // every count on the card is taken AFTER that filter, so the card never
        // offers a file it is not holding.
        settingsBackupPdfs = take.filter((e) => e.blob);
        settingsBackupPdfSkipped = take.length - settingsBackupPdfs.length;
        // The cap warning counts the SELECTION, not what survived the filter.
        // Taken off the readable ones it could say "there are 15 new PDFs, only
        // the oldest 25 go" — a sentence that argues with itself and with the
        // button. The skipped line below the button explains the difference.
        settingsBackupPdfExtra = sel.truncated;
        settingsBackupPdfTotal = sel.send.length + sel.truncated;
        // An evicted PDF is gone for good; letting it hold the watermark back
        // would strand every newer one behind it forever — a capful of
        // unreadable PDFs used to leave this null, and the readable ones behind
        // them could then never leave. So the watermark is the selection's own,
        // the newest one SELECTED, readable or not.
        settingsBackupSentThrough = sel.nextSentThroughMs;
        settingsBackupPdfsReady = true;
        if (state.screen === 'settings') render();
      }, failed);
  }, failed);
}

// --- Files ------------------------------------------------------------------

function settingsBackupJsonName() { return 'ce-bids-backup-' + Store.todayISO() + '.json'; }

function settingsBackupJsonFile() {
  return new File([JSON.stringify(state.data)], settingsBackupJsonName(), { type: 'application/json' });
}

// The proposal's own file name with the millisecond it was made on the end, so
// three revisions of one bid arrive as three files rather than one that
// overwrote the other two.
function settingsBackupPdfName(entry) {
  const bid = state.data.bids.find((b) => b.id === entry.bidId);
  let base = 'proposal';
  if (bid) {
    try { base = String(DocModel.fileName(bid, state.data)).replace(/\.pdf$/i, ''); }
    catch (err) { base = 'bid-' + bid.number; }
  }
  return base + '-' + entry.at + '.pdf';
}

// Each file paired with the id it came from and the moment it was archived.
// The queue needs both: the id to say which PDF it just got rid of, and the
// stamp to move the watermark to as each one actually leaves.
function settingsBackupPdfItems() {
  return settingsBackupPdfs.map((e) => ({
    id: e.id,
    at: e.at,
    file: new File([e.blob], settingsBackupPdfName(e), { type: 'application/pdf' }),
  }));
}

// --- Sharing ----------------------------------------------------------------

// One share, and nothing awaited in front of it. 'unsupported' means the
// browser would not take these files at all; whether it WILL is decided with
// canShare BEFORE the await, never after it.
function settingsShareFiles(files) {
  return navigator.share({ files, title: SET_BACKUP_TITLE }).then(
    () => 'shared',
    (err) => ((err && err.name === 'AbortError') ? 'cancelled' : 'unsupported')
  );
}

function settingsCanShareFiles(files) {
  try { return !!(navigator.canShare && navigator.canShare({ files })); }
  catch (err) { return false; }
}

// The desktop end of the same job: no share sheet, so the file goes to the
// downloads folder and he attaches it himself.
function settingsDownloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Fired, never awaited: awaiting the clipboard would spend the tap the share
// sheet needs. The banner is the whole point of the step — it is what tells
// him there is something in the clipboard worth pasting.
function settingsCopyBackupEmail() {
  const email = setS().backupEmail;
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showBanner('Send it to ' + email);
    return;
  }
  navigator.clipboard.writeText(email).then(
    () => showBanner("Adrian's email copied. Paste it in the To field.", 'ok'),
    () => showBanner('Send it to ' + email)
  );
}

// --- Send backup ------------------------------------------------------------

async function settingsSendBackup() {
  if (settingsBackupBusy) return;
  // The button is disabled until the list is in, so this is a belt on top of
  // braces. It is still here because the cost of being wrong is a watermark
  // over PDFs that were never read.
  if (!settingsBackupPdfsReady) return;

  const jsonFile = settingsBackupJsonFile();
  const items = settingsBackupPdfItems();
  // Read with the items, before any await. It is the stamp THESE files are
  // about to be marked with, and a reload finishing mid-share can put another
  // selection in that variable while the share sheet is still open.
  const sentThrough = settingsBackupSentThrough;
  const pdfFiles = items.map((it) => it.file);
  const all = pdfFiles.length ? [jsonFile].concat(pdfFiles) : [jsonFile];

  // Everything that decides WHICH share happens is settled here, synchronously,
  // because after the first await there is no activation left to start a second
  // one with.
  const canAll = settingsCanShareFiles(all);
  const canJson = canAll ? true : settingsCanShareFiles([jsonFile]);

  settingsCopyBackupEmail();
  settingsBackupBusy = true;
  render();

  // Nothing is coming behind this send for the selected set, so the watermark
  // can move now. True when the whole set went at once, and true when there
  // was no file to queue at all: a selection that was ALL evicted blobs has to
  // be stepped over here or it never gets stepped over anywhere, and the
  // readable PDFs newer than it stay stuck behind it for good.
  let pdfsSettled = false;
  const queueUp = () => {
    if (items.length) {
      settingsBackupQueue = items.slice();
      settingsBackupQueueThrough = sentThrough;
    } else {
      pdfsSettled = true;
    }
  };

  let result;
  if (canAll) {
    result = await settingsShareFiles(all);
    pdfsSettled = result === 'shared';
  } else if (canJson) {
    // iOS takes a whole set; some browsers take exactly one file. The backup
    // itself goes now and the PDFs queue up behind their own button.
    result = await settingsShareFiles([jsonFile]);
    if (result === 'shared') queueUp();
  } else {
    settingsDownloadFile(jsonFile);
    queueUp();
    result = 'downloaded';
  }

  settingsBackupBusy = false;

  const dropQueue = () => { settingsBackupQueue = null; settingsBackupQueueThrough = null; };
  if (result === 'cancelled') { dropQueue(); render(); return; }
  if (result === 'unsupported') {
    dropQueue();
    showBanner("Couldn't open the share sheet. Nothing was sent", 'danger');
    render();
    return;
  }

  // ONLY here, and only for the JSON. A sheet he backed out of is not a
  // backup, and a date that says otherwise turns the home screen's warning off
  // for two weeks.
  //
  // The JSON is the backup: every bid, every setting, the whole document. So
  // the moment it leaves the phone, the nag is answered — today's date, PDFs
  // or no PDFs, queue still draining or not. That the PDFs come behind it one
  // share sheet at a time is a convenience, not the backup.
  //
  // The watermark is the other question and it moves on its own terms: only
  // when the PDFs THEMSELVES are settled, which on this path means the browser
  // took the whole set at once, or there was nothing to hand it. A queue has
  // not gone anywhere yet, so it moves the watermark as it drains, in
  // settingsSendQueuedPdf.
  const prevAt = setS().lastBackupAt;
  const prevThrough = setS().pdfsSentThroughMs;
  setS().lastBackupAt = Store.todayISO();
  if (pdfsSettled && sentThrough !== null && sentThrough !== undefined) {
    setS().pdfsSentThroughMs = sentThrough;
  }
  if (!settingsSaveAndRender(() => {
    setS().lastBackupAt = prevAt;
    setS().pdfsSentThroughMs = prevThrough;
  })) return;
  // A live queue is holding this set and its own button is the only one on the
  // card now. Re-reading the list under it would put the card back into its
  // disabled "Loading PDFs…" state for no reason; the queue asks again itself
  // once it drains.
  if (!settingsBackupQueue || !settingsBackupQueue.length) settingsLoadBackupPdfs();
  showBanner(result === 'downloaded' ? 'Backup downloaded' : 'Backup sent', 'ok');
}

// The queue, one tap per file. No await in front of the share, so each tap
// keeps its own activation.
//
// The watermark moves here, once per file that really left. Every file but the
// last moves it to its own stamp, which is safe because the queue is
// oldest-first and only ever advances on a send that went through: by the time
// this file lands, every older pending PDF has already landed too. Cancel one
// and the queue stops where it is, so the watermark stops with it and the rest
// stay pending. The LAST file out is the exception — it carries the whole
// selection's stamp, for the reason spelled out where it happens below.
function settingsSendQueuedPdf() {
  if (!settingsBackupQueue || !settingsBackupQueue.length) return;
  const item = settingsBackupQueue[0];
  const file = item.file;
  const done = () => {
    settingsBackupQueue.shift();
    const drained = settingsBackupQueue.length === 0;
    // The last file out carries the whole selection's stamp, not just its own.
    // A PDF that was selected but whose blob had been evicted never made it
    // into this queue and never will: it is gone, and stopping the watermark
    // below it would strand every readable PDF above it forever.
    let stamp = item.at;
    if (drained && typeof settingsBackupQueueThrough === 'number'
        && settingsBackupQueueThrough > stamp) {
      stamp = settingsBackupQueueThrough;
    }
    const prev = setS().pdfsSentThroughMs;
    if (typeof stamp === 'number' && (prev === null || prev === undefined || stamp > prev)) {
      setS().pdfsSentThroughMs = stamp;
      // A refused save banners itself, inside persist(): "Couldn't save —
      // nothing changed", in red. Checked because it matters here — the file
      // left the phone but the watermark did not move, so it will be offered
      // again — and the banner is the only thing that says so. Nothing on this
      // card opens a panel, so there is nothing covering the banner area.
      persistOr(() => { setS().pdfsSentThroughMs = prev; });
    }
    if (drained) {
      settingsBackupQueue = null;
      settingsBackupQueueThrough = null;
      // Drained. Ask again what is pending, so the Send button stops counting
      // the ones that just went.
      settingsLoadBackupPdfs();
    }
    render();
  };
  if (!settingsCanShareFiles([file])) { settingsDownloadFile(file); done(); return; }
  settingsShareFiles([file]).then((result) => {
    if (result === 'cancelled') { render(); return; }
    if (result === 'unsupported') { showBanner("Couldn't open the share sheet", 'danger'); render(); return; }
    done();
  });
}

// --- Export photos ----------------------------------------------------------

function settingsBidsWithPhotos() {
  return state.data.bids.filter((b) => bidPhotoIds(b).length > 0);
}

function settingsBidLabel(bid) {
  return bidCustomerName(bid, state.data) + ' · #' + bid.number;
}

// Two taps on purpose. Reading a walk's worth of photos out of IndexedDB takes
// long enough to spend a tap, so the pick loads them and the SEND button — the
// one that has to keep its activation — is only drawn once they are in hand.
function settingsLoadPhotos(bid) {
  const token = ++settingsBackupPhotoToken;
  const ids = bidPhotoIds(bid);
  const label = settingsBidLabel(bid);
  settingsBackupPhotos = { bidId: bid.id, label, files: null };
  settingsBackupPhotoPick = false;
  render();
  Promise.all(ids.map((id) => Photos.get(id))).then((blobs) => {
    if (token !== settingsBackupPhotoToken) return;
    const files = [];
    blobs.forEach((b, i) => {
      if (!b) return;   // evicted by iOS; the ones that are still here still go
      const type = b.type || 'image/jpeg';
      const ext = type.indexOf('png') !== -1 ? 'png' : 'jpg';
      files.push(new File([b], 'bid-' + bid.number + '-photo-' + (i + 1) + '.' + ext, { type }));
    });
    settingsBackupPhotos = { bidId: bid.id, label, files };
    if (state.screen === 'settings') render();
  });
}

function settingsSendPhotos() {
  const held = settingsBackupPhotos;
  if (!held || !held.files || !held.files.length) return;
  const files = held.files;
  const after = (result) => {
    if (result === 'cancelled') { render(); return; }
    if (result === 'unsupported') { showBanner("Couldn't open the share sheet", 'danger'); render(); return; }
    settingsBackupPhotos = null;
    showBanner(result === 'downloaded' ? 'Photos downloaded' : 'Photos sent', 'ok');
    render();
  };
  if (!settingsCanShareFiles(files)) {
    files.forEach(settingsDownloadFile);
    after('downloaded');
    return;
  }
  settingsShareFiles(files).then(after);
}

// --- Restore ----------------------------------------------------------------

// Store.validateImport is the ONE gate: it parses (in its own try/catch, so a
// truncated file comes back null rather than throwing), runs the migrations for
// an older version, and then checks every level of the shape. Anything it will
// not vouch for never gets near the disk.
function settingsRestoreFrom(file) {
  const read = file && typeof file.text === 'function' ? file.text() : Promise.reject(new Error('no text()'));
  read.then((text) => {
    const data = Store.validateImport(text);
    if (!data) {
      showBanner("That file isn't a CE Bids backup", 'danger');
      render();
      return;
    }
    // The NAME first. lastBackupAt inside the file is written after the file
    // is built, so it carries the date of the backup BEFORE this one: a file
    // named for September said it was from August, which is exactly the
    // question this sentence exists to answer. The name is only wrong if
    // somebody renamed the file, and then the date inside is the next best
    // thing there is.
    const when = backupDateFromName(file.name) || data.settings.lastBackupAt;
    const theirs = data.bids.length;
    const mine = state.data.bids.length;
    return confirmPanel(
      'Replace everything on this phone with the backup from '
      + (when ? fmtDate(when) : 'an unknown date') + '? '
      + 'The backup has ' + theirs + (theirs === 1 ? ' bid' : ' bids') + '. '
      + 'This phone has ' + mine + (mine === 1 ? ' bid' : ' bids') + '. '
      // The PIN rides along in the file, so the phone he unlocks tomorrow
      // wants the PIN that was set when the backup was made. Said here, while
      // he can still say no, rather than at a lock screen that will not open.
      + (data.pin != null ? "The PIN from that backup replaces this phone's PIN. " : '')
      + "This can't be undone.",
      { ok: 'Replace', danger: true }
    ).then((ok) => {
      if (!ok) { render(); return; }
      // The restored phone has a backup — the one in his hand. So the date
      // the home band reads comes out of restoredBackupDate rather than off
      // the file raw, which can be null and turn the band red on a phone that
      // was just restored. pdfsSentThroughMs is left exactly as the file has
      // it: the PDFs that already went stay gone.
      data.settings.lastBackupAt = restoredBackupDate(data, file.name, Store.todayISO());
      // Straight to disk and then a reload, rather than swapping state.data
      // under a screen that is still holding pieces of the old document. The
      // app comes back the way it comes back every morning: off the file, at
      // the lock screen, asking for the PIN that is in the backup.
      if (!Store.save(data)) {
        showBanner("Couldn't save the backup. Nothing changed", 'danger');
        render();
        return;
      }
      location.reload();
    });
  }, () => {
    showBanner("Couldn't read that file", 'danger');
    render();
  });
}

// --- The card ---------------------------------------------------------------

function settingsAgeWords(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

function settingsBackupAgeLine() {
  const s = setS();
  const p = document.createElement('p');
  p.className = 'caption';
  const age = daysSince(s.lastBackupAt);
  if (!s.lastBackupAt || age === null) {
    p.textContent = 'No backup yet';
    p.classList.add('caption-danger');
    return p;
  }
  p.textContent = 'Last backup: ' + fmtDate(s.lastBackupAt) + ' (' + settingsAgeWords(age) + ')';
  if (age > SET_BACKUP_STALE_DAYS) p.classList.add('caption-danger');
  return p;
}

function buildSetBackup() {
  const s = setS();
  const box = card('Backup');
  box.appendChild(settingsBackupAgeLine());

  // A live queue is already holding those PDFs and offering them one at a
  // time on its own button. Drawing Send backup beside it offers the same
  // files twice — and taking that offer used to rebuild the queue from the
  // pending list and send a second copy of the JSON with them. So while the
  // queue has anything in it, that is the only button on the card.
  const queued = !!(settingsBackupQueue && settingsBackupQueue.length);

  if (!queued) {
    // Three states, one button. While the PDFs are still coming out of
    // IndexedDB it is disabled and says so: tapping through the wait used to
    // send the JSON alone and then mark the PDFs sent anyway, which stranded
    // every one of them.
    const loading = !settingsBackupPdfsReady;
    const pdfCount = settingsBackupPdfs.length;
    let sendLabel;
    if (settingsBackupBusy) sendLabel = 'Opening…';
    else if (loading) sendLabel = 'Loading PDFs…';
    else sendLabel = 'Send a backup to Adrian';
    const sendBtn = textButton(sendLabel, 'btn btn-primary btn-block', settingsSendBackup);
    if (settingsBackupBusy || loading) {
      sendBtn.disabled = true;
      sendBtn.setAttribute('aria-busy', 'true');
    }
    box.appendChild(sendBtn);
    // The button says what it DOES; the count of saved PDFs riding along is a
    // fact about this particular send, so it goes underneath it. "Send backup
    // + 1 PDF" made the PDF look like the point.
    if (!settingsBackupBusy && !loading && pdfCount) {
      box.appendChild(caption(pdfCount === 1
        ? 'Takes 1 saved PDF with it.'
        : 'Takes ' + pdfCount + ' saved PDFs with it.'));
    }
  }

  if (settingsBackupPdfsFailed) {
    box.appendChild(caption("Couldn't read the saved PDFs. The backup file still goes."));
  }

  // A PDF the phone threw away is not an error and not something he can do
  // anything about, but it must not vanish without a word: the count on the
  // button is smaller than the count in the warning, and this is why.
  if (settingsBackupPdfSkipped > 0) {
    const k = settingsBackupPdfSkipped;
    box.appendChild(caption(k === 1
      ? '1 saved PDF could not be read and was skipped.'
      : k + ' saved PDFs could not be read and were skipped.'));
  }

  if (settingsBackupPdfExtra > 0) {
    box.appendChild(inlineWarn('There are ' + settingsBackupPdfTotal + ' new PDFs. Only the '
      + 'oldest ' + SET_BACKUP_PDF_MAX + ' go this time. Send another backup to get the rest. '
      + 'The backup file itself always has every bid.'));
  }

  if (queued) {
    const n = settingsBackupQueue.length;
    box.appendChild(textButton('Share PDFs (' + n + ')', 'btn btn-primary btn-block', settingsSendQueuedPdf));
    box.appendChild(caption('This browser takes one file at a time. One tap each.'));
    box.appendChild(caption('Finish sending these PDFs first, or leave Settings to start over.'));
  }

  // --- Where it goes
  const emailRow = settingRow(box, 'Send it to', s.backupEmail, () => {
    settingsPromptText(s.backupEmail, 'Backup email', 'name@example.com', emailRow, { required: true }, (text) => {
      if (!isEmailAddress(text)) {
        showBanner("That doesn't look like an email address.", 'danger');
        shake(emailRow);
        return;
      }
      const prev = s.backupEmail;
      s.backupEmail = text;
      settingsSaveAndRender(() => { s.backupEmail = prev; });
    });
  }, null);
  // The address goes under the label, not beside it: it is the longest value in
  // Settings and the only one that pushed its own label onto two lines.
  emailRow.classList.add('row-stack');

  // --- Photos, on their own
  buildSetBackupPhotos(box);

  // --- Restore
  // The one native input in the app. There is no other way to let somebody
  // pick a file off their own phone, so it is hidden behind a button that
  // looks like every other button on this screen.
  // No accept filter on purpose. iOS Files hands back a JSON that arrived as a
  // mail attachment as public.data, and an accept list greys out the one file
  // he is trying to pick. Store.validateImport is the real gate, and it says
  // no on a banner to anything that is not one of ours.
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.id = 'backupFile';
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const f = picker.files && picker.files[0];
    if (f) settingsRestoreFrom(f);
  });
  box.appendChild(picker);
  box.appendChild(textButton('Restore from backup', 'btn btn-danger-outline btn-block mt-3', () => picker.click()));

  // One caption on this card is the date at the top of it - the answer to the
  // only question he opens it with. The rest of the explaining folds.
  box.appendChild(whatsThis([
    'Send a backup: everything on this phone goes to whoever is named above. Do it every couple of weeks, or after a big bid.',
    'Send it to: whoever keeps the copy that is not on this phone.',
    'Restore from backup: pick a backup file. Everything on this phone is replaced by what is in it.',
  ], 'What this card does'));

  return box;
}

function buildSetBackupPhotos(box) {
  const held = settingsBackupPhotos;
  if (held) {
    if (held.files === null) {
      box.appendChild(row('Photos for ' + held.label, 'Getting them…'));
      return;
    }
    if (held.files.length === 0) {
      box.appendChild(inlineWarn('None of those photos are on this phone any more.'));
      box.appendChild(textButton('Cancel', 'btn btn-block mt-3', () => { settingsBackupPhotos = null; render(); }));
      return;
    }
    const n = held.files.length;
    box.appendChild(textButton('Send ' + n + (n === 1 ? ' photo' : ' photos') + ' · ' + held.label,
      'btn btn-block mt-3', settingsSendPhotos));
    box.appendChild(textButton('Cancel', 'btn btn-block', () => { settingsBackupPhotos = null; render(); }));
    return;
  }

  const withPhotos = settingsBidsWithPhotos();
  if (withPhotos.length === 0) return;   // nothing to export, so no button to press

  if (!settingsBackupPhotoPick) {
    box.appendChild(textButton('Export photos', 'btn btn-block mt-3',
      () => { settingsBackupPhotoPick = true; render(); }));
    box.appendChild(caption('Photos are too big to go with every backup. Send one job at a time.'));
    return;
  }

  box.appendChild(fieldLabel('Which job?'));
  const chips = document.createElement('div');
  chips.className = 'set-chips';
  withPhotos.forEach((b) => {
    const n = bidPhotoIds(b).length;
    chips.appendChild(chip(settingsBidLabel(b) + ' · ' + n + (n === 1 ? ' photo' : ' photos'),
      false, () => settingsLoadPhotos(b)));
  });
  box.appendChild(chips);
  box.appendChild(textButton('Cancel', 'btn btn-block', () => { settingsBackupPhotoPick = false; render(); }));
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

// Every mutation on this screen ends the same way: save, put it back if the
// save is refused, and redraw either way — the row has to show what is on
// disk, not what he typed. persist() has already said why on a banner.
function settingsSaveAndRender(revert) {
  const ok = persistOr(revert);
  render();
  return ok;
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

// Card order is how often he touches it, not how the file is organized. Crew,
// rates and equipment change with the week; the company address and the PIN
// were typed once and are not worth a scroll past every time. The sections in
// the file itself stay in their old order so the diff stays readable.
//
// The chip is what the jump strip calls that card, and a card with none is one
// the strip does not name — the note phrases ride under Lists with the
// did-you-forget rows, and Reports is a door to another screen rather than a
// place he is looking for. Ten chips is already a full strip.
const SETTINGS_CARDS = [
  ['set-crew', 'Crew', () => buildSetCrew()],
  ['set-rates', 'Rates', () => buildSetRates()],
  // The parts catalog is the card he came here for — it is the one the strip
  // was built for in the first place — and eighth in a sideways-scrolling row
  // is off the right edge on a 375px phone, which is the same "scroll and
  // hunt" the strip was meant to end. Third, where his thumb already is.
  ['set-catalog', 'Catalog', () => buildSetCatalog()],
  ['set-equipment', 'Equipment', () => buildSetEquipment()],
  ['set-counter', 'Numbers', () => buildSetCounter()],
  ['set-forget', 'Lists', () => buildSetForget()],
  ['set-notes', null, () => buildSetNotePhrases()],
  ['set-terms', 'Terms', () => buildSetTerms()],
  ['set-company', 'Company', () => buildSetCompany()],
  ['set-lock', 'PIN', () => buildSetLock()],
  ['set-reports', null, () => buildSetReports()],
  ['set-backup', 'Backup', () => buildSetBackup()],
];

// Nine screens of settings with no index: he scrolled for the parts catalog
// every time. The strip is one horizontal row of chips at the top, and each
// one takes him to its card. The cards carry scroll-margin-top in the CSS so
// the sticky header does not land on top of the title he just jumped to.
function buildSetJump() {
  // The strip scrolls sideways, and a row of chips that ends flush with the
  // screen edge looks like a row that ENDS. The fade is a CSS overlay on the
  // wrapper — the chips run under it and the last one is visibly cut, which is
  // the only thing that says there is more of it to the right.
  const outer = document.createElement('div');
  outer.className = 'set-jump-wrap';

  const wrap = document.createElement('div');
  wrap.className = 'set-jump';
  wrap.setAttribute('aria-label', 'Jump to a section');
  SETTINGS_CARDS.forEach(([id, label]) => {
    if (!label) return;
    wrap.appendChild(chip(label, false, () => {
      const target = el(id);
      if (!target) return;
      try { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch (e) { target.scrollIntoView(); }   // no options object in an old browser
    }));
  });
  outer.appendChild(wrap);

  // The fade is the affordance: a chip visibly cut off says there is more of
  // this strip to the right. On a wide phone the strip fits, nothing is cut
  // off, and the fade was greying out the last chip for no reason. Measured
  // after the frame this render is built in, because a strip that is not laid
  // out yet has no widths to compare.
  const measure = () => {
    try { outer.classList.toggle('set-jump-over', wrap.scrollWidth > wrap.clientWidth + 1); }
    catch (e) { /* no layout in this environment */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
  else measure();

  return outer;
}

// "CE Bids · v1 · built Sep 5, 2026". The version is the cache the phone is
// actually being served by (APP_VERSION, held to sw.js's CACHE by
// tests/sw.test.js); the date is APP_BUILT beside it. index.html is served
// cache-first, so a deploy that forgets to bump CACHE leaves him on old code
// with no symptom at all — this line is the symptom, and the DATE is the half
// he can check against the day he was told to update.
function settingsVersionText() {
  return 'CE Bids · ' + String(APP_VERSION).replace(/^bids-/, '') + ' · built ' + fmtDate(APP_BUILT);
}

function renderSettings() {
  const host = el('settingsContent');
  host.textContent = '';

  // The cards are built first and appended after the strip, so the strip can
  // be at the top of the screen while the ids it points at come from the one
  // list that decides both.
  const cards = SETTINGS_CARDS.map(([id, label, build]) => {
    const node = build();
    node.id = id;
    return node;
  });
  host.appendChild(buildSetJump());
  cards.forEach((node) => host.appendChild(node));

  const version = caption(settingsVersionText());
  version.className = 'caption app-version';
  host.appendChild(version);
}

registerScreen('settings', {
  id: 'screen-settings', title: 'Settings', back: null, tab: 'settings',
  enter: enterSettings, render: renderSettings,
});
