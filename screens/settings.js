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
let settingsShowHidden = { crew: false, equipment: false, clauses: false, catalog: false, customers: false };

// The three libraries are their own screens now (see LIBRARIES), so this is
// their view state rather than Settings'.
let settingsCustomer = null;        // which customer's card is open; null = the list
let settingsCategory = null;        // which parts category the catalog screen is in; null = the tiles
let settingsCatalogSearch = '';     // what he has typed into the parts search
let settingsCatalogListEl = null;   // the part of the catalog screen the search redraws
let settingsNewPart = null;         // { name, category } while + New part is being answered
let settingsCatalogSource = 'all';  // 'all' | 'typed' | 'qed': which parts the list is showing
let settingsBelongsWith = null;     // the id of the part whose "Belongs with" question is up
let settingsGroupOpen = null;       // which clause group is expanded
let settingsAddGroup = false;       // the + Clause group picker is up
// The two plain-string lists, folded. See SETTINGS_LIST_FOLD.
let settingsListOpen = { forgetList: false, notePhrases: false };

// Coming back to Settings is coming back to the top of it. Everything the
// last visit opened or unfolded is closed again, "Show hidden" included: four
// lists quietly showing put-away men and tools is not the screen he thinks he
// is looking at. The three libraries reset themselves on the way into their
// own screens.
function enterSettings() {
  settingsMenu = null;
  settingsAddGroup = false;
  settingsGroupOpen = null;
  settingsShowHidden = { crew: false, equipment: false, clauses: false, catalog: false };
  settingsListOpen = { forgetList: false, notePhrases: false };
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
// The third slot in a tuple is a class name, except for two words that are
// shapes rather than classes: 'quiet' is the muted text link every Delete on
// every screen now wears, last in the strip; 'link' is the navy one, for a
// side trip out of the strip that is neither an edit nor a delete.
function settingActions(parentEl, buttons, opts) {
  const o = opts || {};
  return attachedStrip(parentEl, buttons.map(([label, cls, onTap]) => {
    if (cls === 'quiet') return { label, onTap, quiet: true };
    if (cls === 'link') return { label, onTap, link: true };
    return { label, cls, onTap };
  }), {
    label: o.label,
    content: o.content,
    cancel: () => { settingsMenu = null; render(); },
  });
}

// A 44px square: ▲ ▼ ✕. Small only in width — never in height, and never in
// what happens when it is pressed.
// Nothing on a screen is red, the ✕ on a list row included: it used to be the
// one red thing on a card of grey arrows, which pointed the eye at the only
// control there that takes something away.
function settingMiniButton(glyph, label, disabled, onTap) {
  const btn = textButton(glyph, 'set-mini', disabled ? null : onTap);
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

// Muted text, last in the strip, and the red is left to the confirm panel it
// opens. See .link-btn-quiet: an outlined red Delete beside Rename was the
// loudest thing in the strip and sat under the same thumb as the edits.
function settingsDeleteAction(list, entry, what) {
  return ['Delete', 'quiet', async () => {
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
// opts is { required, multiline, caption } — required and multiline are two
// separate questions, and they are kept separate because the clause wording is
// BOTH. Folding them into one argument is how a blanked clause used to reach
// the paper as a bare heading: the wording asked for a big box and silently
// gave up its empty check to get it. caption is the one line of help that has
// to be on screen WHILE he is typing rather than under the row he tapped.
function settingsPromptText(current, label, placeholder, node, opts, apply) {
  const o = opts || {};
  promptText(current, {
    label,
    placeholder,
    caption: o.caption,
    multiline: !!o.multiline,
    // The one field on this screen the FILE puts a cap on: a customer's
    // address is 200 characters on disk, and a paste out of an email that got
    // written anyway would make a customer validateImport refuses.
    maxLength: o.maxLength,
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
// COMPANY — its own screen
// ---------------------------------------------------------------------------
// What prints across the top of every proposal, the signature at the bottom,
// how the paper looks, what it says about tax, and where "Check price" goes.
// None of it touches a number, so none of it asks a question first.
//
// Eleven rows he typed once, on the day the app was installed, sitting between
// two lists he edits every month. It is a door on the index now, for the same
// reason the three libraries got theirs.

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

  // Tax sits here rather than with the rates because it is not a rate: it
  // changes one SENTENCE on the paper and not one cent of the money. Beside
  // twelve numbers that all reach a price, it read as a thirteenth.
  const s = setS();
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

  // WHERE "CHECK PRICE" GOES. He asked where material prices come from; the
  // real answer is his supply house's own app, which knows his price and which
  // nothing public does. So this is a shortcut and nothing more: the part's
  // name dropped into whatever search he already uses. Optional on the
  // document (an older backup has no such field), so the row falls back to the
  // default rather than showing a blank.
  const priceRow = settingRow(box, 'Supply house search',
    settingsPriceSearchValue(co),
    () => settingsEditPriceSearch(priceRow),
    'Where "Check price" on a part sends you. It opens in another tab.');

  // THE WAY BACK. A link pasted wrong, or a supply house he stopped using,
  // used to leave him retyping a search URL out of memory to undo it. Quiet,
  // and only on the card when there is something to undo.
  if (!settingsPriceSearchIsDefault(co)) {
    box.appendChild(textButton('Use QED', 'link-btn link-btn-quiet', () => {
      const prev = co.priceSearchUrl;
      co.priceSearchUrl = PRICE_SEARCH_DEFAULT;
      settingsSaveAndRender(() => {
        if (prev === undefined) delete co.priceSearchUrl; else co.priceSearchUrl = prev;
      });
    }));
  }

  return box;
}

// Both of ui.js's answers, because a phone that has been running since v3 is
// holding the Google Shopping string it was seeded with and never chose: the
// row would say "Your own link" about it, and the way back to QED would never
// appear. priceSearchIsDefault owns that rule; this only asks it.
function settingsPriceSearchIsDefault(co) {
  return priceSearchIsDefault(co && co.priceSearchUrl);
}

// The row names the supply house rather than the URL: he knows where he buys,
// and the whole link on a 375px row is a line of characters he cannot read.
function settingsPriceSearchValue(co) {
  return settingsPriceSearchIsDefault(co) ? 'QED' : 'Your own link';
}

// A TEMPLATE THAT IS NOT A LINK IS NOT SAVED.
//
// This string is handed to window.open. Anything he can paste off a phone that
// is not http(s) — a bare "supplyhouse.com", a stray "javascript:", the search
// TERM instead of the search page — either opens nothing at all or opens
// something this app has no business opening, and either way the failure turns
// up days later as a part row that quietly does nothing when it is tapped. So
// the prompt refuses it and comes straight back with the reason in its own
// LABEL: the text panel sits over the banner area, so a banner fired from in
// here is a banner nobody ever sees. Same shape as settingsAskWage.
//
// priceSearchUrl() still falls back when {q} is missing — a link without one
// gets the part name put on the end — so a missing placeholder is a shrug and
// not a refusal. It is the scheme, and only the scheme, that is a hard no.
function settingsEditPriceSearch(node, again) {
  const co = setS().company;
  settingsPromptText(co.priceSearchUrl || PRICE_SEARCH_DEFAULT,
    'Supply house search' + (again ? '. It has to start with https://' : ''),
    PRICE_SEARCH_DEFAULT, node, {
      required: true,
      // The one line that has to be in front of him while he is typing it:
      // a link pasted off his phone is a link with a search already on the
      // end of it, and {q} is the only thing this app needs him to know.
      caption: 'Put {q} where the part name goes. Ask Adrian for your supply house\'s link.',
    }, (text) => {
      if (!/^https?:\/\//i.test(text)) { settingsEditPriceSearch(node, true); return; }
      const prev = co.priceSearchUrl;
      co.priceSearchUrl = text;
      settingsSaveAndRender(() => {
        if (prev === undefined) delete co.priceSearchUrl; else co.priceSearchUrl = prev;
      });
    });
}

// Coming into the Company screen is coming into it clean, the way Settings
// itself does: nothing this screen opens survives a trip out of it.
function enterSettingsCompany() { settingsMenu = null; }

function renderSettingsCompany() {
  const host = el('settingsCompanyContent');
  host.textContent = '';
  host.appendChild(buildSetCompany());
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

function enterSettingsCrew() {
  settingsMenu = null;
  settingsShowHidden.crew = false;
}

function renderSettingsCrew() {
  const host = el('settingsCrewContent');
  host.textContent = '';
  host.appendChild(buildSetCrew());
}

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
    () => settingsToggleMenu(key), null, { strip: true });
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

// WHAT THE KEYPAD IS ASKING FOR, in the shape a name and a number go together
// in. "Ruben, paid an hour" reads as a note about Ruben with the number added
// afterwards; what the digits are is Ruben's pay, so the name owns it. The
// same for a customer and the rate they are billed at.
//
// reach is the half that says how far a new wage carries, and again is the
// reason the panel came back: a typed $0, which is not a wage.
function settingsWageLabel(name, reach, again) {
  return (name || 'Worker') + "'s pay an hour" + (reach ? ' on new bids' : '')
    + (again ? '. Enter more than $0' : '');
}
function settingsRateLabel(name) {
  return (name || 'This customer') + "'s rate an hour";
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
  // A wage of $0 is the one answer this prompt refuses, so it is not a value
  // Done can hand back: offered as the prior it would re-ask the same question
  // on every empty Done, forever. A man with no wage on him opens a panel with
  // no prior, which is honest — $0 an hour is not a wage he set.
  const has = typeof c.wageCents === 'number' && c.wageCents > 0;
  promptMoney(has ? c.wageCents : null, {
    label: settingsWageLabel(c.name, true, again),
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
    label: settingsWageLabel(name, false, again),
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
// RATES — its own screen
// ---------------------------------------------------------------------------
// Every row here carries its reach in its caption, in his words, and since the
// snapshot rule landed there is only one reach left to carry: NEW BIDS ONLY.
// Nothing on this card moves a bid that already exists. See the header comment
// for how each claim was checked against costStack and Store.newBid.
//
// Thirteen numbers is a screen, not a card. Sitting on the index it was the
// single longest thing on it and the one he scrolled past most, because the
// number he comes here to change is one of thirteen and he had to read all of
// them on the way to anything else. A door with the labour rate written on it
// answers the only question he asks before opening it.

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
    'What you add on top of what a part bills at: its list price when the line has one, what it cost you when it does not. New bids only.');

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

  // The card's explanations, folded. Each row still says what it is
  // and what it is set to; what it MEANS is one tap away instead of a grey
  // line between every pair of numbers.
  const notes = settingsRateNotes;
  settingsRateNotes = null;
  box.appendChild(whatsThis(notes, 'What these mean'));

  return box;
}

// Coming into Rates is coming into it clean, the way Settings itself does.
function enterSettingsRates() { settingsMenu = null; }

function renderSettingsRates() {
  const host = el('settingsRatesContent');
  host.textContent = '';
  host.appendChild(buildSetRates());
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

function enterSettingsEquipment() {
  settingsMenu = null;
  settingsShowHidden.equipment = false;
}

function renderSettingsEquipment() {
  const host = el('settingsEquipmentContent');
  host.textContent = '';
  host.appendChild(buildSetEquipment());
}

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
  settingsStandardButton(box, 'Add the standard tools', 'tools',
    (d) => Store.addStandardEquipment(d), s.equipment, (before) => { setS().equipment = before; },
    () => settingsOfferNearDuplicates('tools', setS().equipment, Store.standardEquipmentNames()));
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

  const line = settingRow(box, e.name || 'Tool', valueText,
    () => settingsToggleMenu(key), null, { strip: true });
  if (e.hidden) line.classList.add('set-hidden');
  if (e.overrideDayCents != null) {
    const tag = document.createElement('em');
    tag.className = 'set-override';
    tag.textContent = 'override';
    (line.querySelector('.row-value') || line).appendChild(tag);
  }

  if (!settingsMenuOpen(key)) return;

  // The money first: what it cost new is the number the day rate is a share
  // of, and the day rate is the number that reaches a bid. Renaming a tool is
  // the rarest thing on this list, so it sits under both of them.
  const buttons = [
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

  buttons.push(['Rename', '', () => {
    settingsPromptText(e.name, 'Name', 'Threader', line, { required: true }, (text) => {
      const prev = e.name;
      e.name = text;
      settingsSaveAndRender(() => { e.name = prev; });
    });
  }]);

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

// HOW MANY OF A LIST THE INDEX SHOWS BEFORE IT FOLDS.
//
// Both of these lists tripled in v2.1 — nineteen did-you-forget rows and
// fourteen note phrases — and laid flat they are 2,800px of a 6,500px screen,
// which is nearly half of Settings spent on two lists he edits twice a year.
// THREE, not six. Settings is an index now, and an index is a list of doors:
// three rows is enough to say what KIND of thing is behind this one, which is
// all a row on an index has to do. "Show all 19" is one tap away, and the walk
// still reads the whole list top to bottom either way.
const SETTINGS_LIST_FOLD = 3;

// EVERYTHING THE CARD HAS TO SAY ABOUT ITSELF IS BEHIND THE SAME TAP. Folded,
// a list card is a heading, three rows, "Show all 19" and the way to add one:
// that is a door with a sample of what is behind it, which is all a card on an
// index owes. The caption explaining how the walk reads the list, and the
// button that puts the standard rows back, are answers to questions he only
// has once he is looking at the whole list — so they open with it. A list
// short enough not to fold has no "Show all" to open, so it keeps them.
function settingsListWideOpen(total, listName) {
  return total <= SETTINGS_LIST_FOLD || settingsListOpen[listName];
}

function settingsListFoldToggle(box, listName, total) {
  if (total <= SETTINGS_LIST_FOLD) return;
  const open = settingsListOpen[listName];
  box.appendChild(textButton(open ? 'Show fewer' : 'Show all ' + total, 'link-btn',
    () => { settingsListOpen[listName] = !open; render(); }));
}

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

// A did-you-forget row is either a plain string or { name, kind }; a note
// phrase is always a string. Both lists are read through here so this screen
// never has to know which shape it is holding.
function settingsListText(entry) { return Store.forgetName(entry) || String(entry == null ? '' : entry); }

async function settingsRemoveString(listName, i, what) {
  const s = setS();
  const list = s[listName];
  const entry = list[i];
  const ok = await confirmPanel('Take "' + settingsListText(entry) + '" off the ' + what + '?',
    { ok: 'Remove', danger: true });
  if (!ok) { render(); return; }
  list.splice(i, 1);
  settingsSaveAndRender(() => { list.splice(i, 0, entry); });
}

// A row he types is a plain string, and it stays one: the kind on a seeded row
// is a shortcut, not a shape the list has to be in. Store.forgetKind reads a
// hand-typed row off its own words, which is the rule the walk followed before
// kinds existed at all.
function settingsAddString(listName, label, placeholder, multiline) {
  promptText('', {
    label,
    placeholder,
    multiline: !!multiline,
    done: (text) => {
      if (!text) return;
      const s = setS();
      const key = text.trim().toLowerCase();
      if (s[listName].some((e) => settingsListText(e).trim().toLowerCase() === key)) {
        showBanner('That one is already on the list');
        return;
      }
      s[listName].push(text);
      settingsSaveAndRender(() => {
        const i = s[listName].indexOf(text);
        if (i !== -1) s[listName].splice(i, 1);
      });
    },
  });
}

// "ADD THE STANDARD ..." — the four libraries that grow.
//
// A seed only runs on a fresh install, so a phone that has been in use since
// v2 has the short lists and no way to catch up. These add the names it is
// missing and nothing else: nothing is renamed, nothing is re-costed, and a
// part he hid on purpose is not quietly re-added under him. The count goes in
// the banner, because "Added" alone does not say whether anything happened.
//
// take() is handed the whole list back for the undo: these push many rows at
// once, and a refused save has to put the list back the way it was rather than
// unpick it row by row.
async function settingsAddStandard(what, apply, list, restore, after) {
  const before = list.slice();
  const added = apply(state.data);
  if (added === 0) {
    showBanner('You already have all the standard ' + what);
  } else {
    if (!persistOr(() => restore(before))) { render(); return; }
    showBanner('Added ' + added + ' ' + (added === 1 ? what.replace(/s$/, '') : what), 'ok');
  }
  // The second half of the job, and it runs on both paths: a tap that added
  // nothing is exactly the tap where his own spellings are already sitting
  // beside the standard ones.
  if (after) { await after(); return; }
  render();
}

// AFTER THE ADD, THE PAIRS.
//
// Adding the standard names touches nothing he has, which is the right rule
// and leaves the wrong list: his '3/4" hubs' and the standard '3/4" hub' now
// sit one row apart in the picker, and he has to remember which of the two he
// has been tapping. Catalog.nearDuplicates finds the ones that are the same
// words said differently, and this asks about them ONCE, in the plainest
// sentence there is, with an example so he can see what it means before he
// answers.
//
// HIDE, NEVER DELETE. His spellings are on old bids, and the app has one kind
// of delete for anything a bid points at.
async function settingsOfferNearDuplicates(what, rows, standardNames) {
  const dups = Catalog.nearDuplicates(rows, standardNames);
  if (!dups.length) { render(); return; }
  const first = dups[0];
  const ok = await confirmPanel(dups.length + ' of your ' + what + ' look like standard ones under a '
    + 'different name (' + first.name + ' → ' + first.standard + '). Hide the older spellings?',
    { ok: 'Hide them' });
  if (!ok) { render(); return; }
  dups.forEach((x) => { x.item.hidden = true; });
  if (!persistOr(() => { dups.forEach((x) => { x.item.hidden = false; }); })) { render(); return; }
  showBanner('Hid ' + dups.length + ' older ' + (dups.length === 1 ? 'spelling' : 'spellings'), 'ok');
  render();
}

function settingsStandardButton(box, label, what, apply, list, restore, after) {
  box.appendChild(textButton(label, 'link-btn',
    () => settingsAddStandard(what, apply, list, restore, after)));
}

function buildSetForget() {
  const s = setS();
  const box = card('Anything missing');
  if (s.forgetList.length === 0) {
    box.appendChild(emptyNote('Nothing on the list.'));
  } else {
    const shown = settingsListOpen.forgetList ? s.forgetList.length : SETTINGS_LIST_FOLD;
    s.forgetList.slice(0, shown).forEach((entry, i) => {
      settingsListRow(box, settingsListText(entry), [
        settingMiniButton('▲', 'Move up', i === 0, () => settingsMoveString('forgetList', i, -1)),
        settingMiniButton('▼', 'Move down', i === s.forgetList.length - 1, () => settingsMoveString('forgetList', i, 1)),
        settingMiniButton('✕', 'Remove', false, () => settingsRemoveString('forgetList', i, 'list')),
      ]);
    });
    settingsListFoldToggle(box, 'forgetList', s.forgetList.length);
  }
  box.appendChild(textButton('+ Item', 'btn btn-block mt-3',
    () => settingsAddString('forgetList', 'Anything missing', 'Permits', false)));
  if (settingsListWideOpen(s.forgetList.length, 'forgetList')) {
    settingsStandardButton(box, 'Add the standard list', 'rows',
      (d) => Store.addStandardForget(d), s.forgetList, (before) => { setS().forgetList = before; });
    box.appendChild(caption('The walk asks you about these, in this order. Put what you forget most at the top.'));
  }
  return box;
}

function buildSetNotePhrases() {
  const s = setS();
  const box = card('Note phrases');
  if (s.notePhrases.length === 0) {
    box.appendChild(emptyNote('No phrases saved.'));
  } else {
    const shown = settingsListOpen.notePhrases ? s.notePhrases.length : SETTINGS_LIST_FOLD;
    s.notePhrases.slice(0, shown).forEach((text, i) => {
      settingsListRow(box, settingsListText(text), [
        settingMiniButton('✕', 'Remove', false, () => settingsRemoveString('notePhrases', i, 'phrases')),
      ]);
    });
    settingsListFoldToggle(box, 'notePhrases', s.notePhrases.length);
  }
  box.appendChild(textButton('+ Phrase', 'btn btn-block mt-3',
    () => settingsAddString('notePhrases', 'Note or exclusion', 'Does not include...', false)));
  if (settingsListWideOpen(s.notePhrases.length, 'notePhrases')) {
    settingsStandardButton(box, 'Add the standard notes', 'phrases',
      (d) => Store.addStandardNotes(d), s.notePhrases, (before) => { setS().notePhrases = before; });
    box.appendChild(caption('One tap each on the proposal screen. Taking one off here leaves it on the bids that already print it.'));
  }
  return box;
}

// ---------------------------------------------------------------------------
// TERMS
// ---------------------------------------------------------------------------
// The clause library, grouped the way the proposal screen groups it. Groups
// are collapsed until he opens one: twenty-six clauses laid flat is a wall,
// and he comes here to change one of them, not to read all of them.
//
// Hidden is the only kind of delete: splicing a clause out would break every
// bid that chose it. Hidden means "not offered on new bids" and nothing more
// — DocModel still prints a hidden clause on a bid that NAMES it, so retiring
// one here never goes back and shortens paper that is already out.

function enterSettingsTerms() {
  settingsMenu = null;
  settingsGroupOpen = null;
  settingsAddGroup = false;
  settingsShowHidden.clauses = false;
}

function renderSettingsTerms() {
  const host = el('settingsTermsContent');
  host.textContent = '';
  host.appendChild(buildSetTerms());
}

function buildSetTerms() {
  const s = setS();
  const box = card('Clauses');

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
  box.appendChild(textButton('Reset to the standard library', 'link-btn', settingsResetClauses));
  settingHiddenToggle(box, 'clauses', hidden.length);
  box.appendChild(caption('Hiding a clause takes it off the list new bids are offered. '
    + 'A bid that already picked it keeps printing it, until you untick it there.'));
  return box;
}

// THE ONE LIBRARY THAT IS REPLACED RATHER THAN ADDED TO.
//
// The other four grow: a part he does not have is a part he might want. Terms
// are the opposite. The clauses seeded before v2.1 were subcontract language
// off one job, and keeping them beside the eight new ones would put both sets
// on the same phone under the same heading, which is how the wrong paragraph
// ends up on a customer's proposal.
//
// So the old ones go, except any a bid still names: those are hidden, which is
// the only delete this app allows for something a bid points at. Hidden takes
// a clause off the list NEW bids are offered and leaves sent paper alone, and
// the sentence has to say exactly that. It used to say the clauses were
// "hidden instead of removed", which he read as a delete he was being let off
// lightly on, when in fact the bids that named them lose nothing at all.
async function settingsResetClauses() {
  const s = setS();
  const inUse = s.clauses.filter((c) => Store.clauseInUse(state.data, c.id) > 0).length;
  const ok = await confirmPanel('Replace your terms library with the standard one? '
    + 'You have ' + s.clauses.length + ' clause' + (s.clauses.length === 1 ? '' : 's') + '. '
    + (inUse === 0
      ? 'None of them are on a bid, so they are all replaced.'
      : inUse + ' of them ' + (inUse === 1 ? 'is' : 'are') + ' on a bid. '
        + 'Clauses no bid uses are replaced. Clauses already on a bid are kept for that bid '
        + 'and hidden from new ones.'),
    { ok: 'Replace them', danger: true });
  if (!ok) { render(); return; }
  const before = s.clauses;
  const out = Store.resetClauseLibrary(state.data);
  if (!persistOr(() => { setS().clauses = before; })) { render(); return; }
  settingsGroupOpen = null;
  settingsMenu = null;
  showBanner('Standard library in. ' + out.added + ' clauses'
    + (out.hidden ? ', ' + out.hidden + ' of yours hidden' : ''), 'ok');
  render();
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
  // "(12)", not "12 clauses". Five group headers down one screen, each saying
  // the word clause again, is five words he reads to find one number.
  count.textContent = '(' + group.length + ')';
  head.appendChild(count);
  box.appendChild(head);

  if (!open) return;
  group.forEach((c) => buildSetClauseRow(box, c));
}

function buildSetClauseRow(box, c) {
  const key = 'clause:' + c.id;
  const line = settingRow(box, c.title || 'Clause', c.hidden ? 'Hidden' : 'Shown',
    () => settingsToggleMenu(key), null, { strip: true });
  if (c.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  const wording = caption(c.text);
  box.appendChild(wording);
  settingsRemoveActions(box, wording, [
    ['Edit title', '', () => {
      settingsPromptText(c.title, 'Clause title', 'Payment', line, { required: true }, (text) => {
        const prev = c.title;
        c.title = text;
        settingsSaveAndRender(() => { c.title = prev; });
      });
    }],
    ['Edit wording', '', () => {
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
// CATALOG — its own screen
// ---------------------------------------------------------------------------
// Two hundred parts is not a card on a settings page. It is the same problem
// the walk solved standing in a plant, so it gets the same answer, right down
// to the shape of it: the search box on top, six tiles under it, and a list
// once he has picked one of them. Anything he can do to a part is in the strip
// that opens under its row.
//
// Hiding is the delete here: an item on an old bid points at a catalog id, and
// Store's validator wants that id to still exist. Delete only turns up on a
// part no bid has ever named.

function enterSettingsCatalog() {
  settingsMenu = null;
  settingsCategory = null;
  settingsCatalogSearch = '';
  settingsCatalogListEl = null;
  settingsNewPart = null;
  settingsShowHidden.catalog = false;
  // The filter is remembered while he is in here and forgotten on the way out.
  // A phone he picks up tomorrow showing only the QED parts, with no memory of
  // having asked for that, is a catalog that has lost half his parts.
  settingsCatalogSource = 'all';
  settingsBelongsWith = null;
}

// One step inside this screen before it gives up and goes back to Settings —
// the same rule the walk's add flow follows, so the back gesture and the Back
// button both put the tiles back instead of leaving the catalog altogether.
function settingsCatalogBackStep(peek) {
  if (settingsNewPart) {
    if (!peek) { settingsNewPart = null; render(); }
    return true;
  }
  // "Belongs with" is a question standing where the list was, so Back answers
  // it with "never mind" before it answers anything else.
  if (settingsBelongsWith) {
    if (!peek) { settingsBelongsWith = null; render(); }
    return true;
  }
  // ONE BACK IS ONE STEP. Opening a drawer pushes a history entry and so does
  // starting a search inside it, so a back that undid both spent two entries
  // on one screen change and the NEXT press had nothing left to do — it looked
  // swallowed. Search first, because it is the thing he did last.
  if (settingsCatalogSearch.trim() !== '') {
    if (!peek) {
      settingsCatalogSearch = '';
      settingsMenu = null;
      render();
    }
    return true;
  }
  if (settingsCategory) {
    if (!peek) {
      settingsCategory = null;
      settingsMenu = null;
      render();
    }
    return true;
  }
  return false;
}

function renderSettingsCatalog() {
  const host = el('settingsCatalogContent');
  host.textContent = '';

  // One question at a time: while a new part is being named there is nothing
  // else on the glass to tap.
  if (settingsNewPart) { host.appendChild(buildSetNewPart()); return; }
  // Same for "Belongs with": the search box above a list of parts he is being
  // asked to pick ONE of would be two lists of parts on one screen. A part
  // that went away under him (a restore, a delete elsewhere) takes its own
  // question down with it rather than leaving a card about nothing.
  if (settingsBelongsWith && !state.data.catalog.some((x) => x.id === settingsBelongsWith)) settingsBelongsWith = null;
  if (settingsBelongsWith) { host.appendChild(buildSetBelongsWith()); return; }

  // Above the tiles and searching everything, for the reason it is above them
  // on the walk: he knows the name of the part, not which of six drawers this
  // app filed it under. Only the list below is redrawn as he types — rebuilding
  // the input under a typing thumb drops focus and closes the keyboard.
  host.appendChild(searchInput({
    className: 'walk-search',
    placeholder: 'Search all parts',
    label: 'Search all parts',
    value: settingsCatalogSearch,
    onInput: (value) => {
      if (settingsCatalogSearch.trim() === '' && value.trim() !== '') navPush();
      settingsCatalogSearch = value;
      settingsMenu = null;
      if (settingsCatalogListEl && settingsCatalogListEl.isConnected) {
        // A row strip can be open while he starts typing, and this path skips
        // render() — which is where stripsCleared() normally runs. Left set,
        // the shell still thinks a strip is on the glass and spends his next
        // back gesture closing one that is not there.
        stripsCleared();
        buildSetCatalogBody(settingsCatalogListEl);
      } else render();
    },
  }));

  settingsCatalogListEl = document.createElement('div');
  buildSetCatalogBody(settingsCatalogListEl);
  host.appendChild(settingsCatalogListEl);
}

// Tiles, or a list, and then the three things he can do to the whole catalog.
// A search beats a category, the way it does on the walk: typing crosses all
// six drawers, and clearing it puts the tiles back exactly where they were.
function buildSetCatalogBody(host) {
  host.textContent = '';
  const d = state.data;
  const searching = settingsCatalogSearch.trim() !== '';

  if (!searching && !settingsCategory) {
    host.appendChild(buildSetCatalogTiles());
    host.appendChild(buildSetCatalogTools(d.catalog.filter((x) => x.hidden).length));
    return;
  }

  const box = card(searching ? 'All parts' : catalogCategoryLabel(settingsCategory));
  // Typed by hand, or From QED. Three hundred parts arrive in one tap, and
  // this is how he tells them from the ones that are his: it is what lets him
  // weed the imported ones he never reaches for without ever going near the
  // rows he typed himself.
  box.appendChild(buildSetCatalogFilter());
  // The visible parts come back in Catalog.matches's order, which is the order
  // the walk offers them in; the hidden ones are tacked on the end by name,
  // because a put-away part has no use count worth ranking on.
  //
  // includeVariants, unlike the walk: this is where he renames a part, puts one
  // away or says which generic it belongs with, and a part he cannot see is a
  // part he cannot do any of that to.
  const shown = settingsCatalogSourceFilter(Catalog.matches(d.catalog, {
    category: settingsCategory,
    query: settingsCatalogSearch,
    includeRentals: true,
    includeVariants: true,
  }), settingsCatalogSource);
  const hidden = settingsCatalogSourceFilter(settingsCatalogHidden(d.catalog, searching), settingsCatalogSource);
  const list = settingsShowHidden.catalog ? shown.concat(hidden) : shown;

  // One pass for the whole list rather than one per row.
  const counts = pickerVariantCounts(d.catalog);

  if (list.length === 0) {
    box.appendChild(emptyNote(searching
      ? 'Nothing matches that.'
      : 'Nothing in ' + catalogCategoryLabel(settingsCategory) + '.'));
  } else {
    list.forEach((x) => buildSetCatalogRow(box, x, searching, counts.get(x.id) || 0));
  }
  host.appendChild(box);
  host.appendChild(buildSetCatalogTools(hidden.length));
}

// All / Typed by hand / From QED. Chips rather than a row that opens something:
// there are three answers, they are short, and he switches between them.
const SET_CATALOG_SOURCES = [['all', 'All'], ['typed', 'Typed by hand'], ['qed', 'From QED']];

function buildSetCatalogFilter() {
  const chips = document.createElement('div');
  chips.className = 'set-chips';
  SET_CATALOG_SOURCES.forEach(([key, label]) => {
    chips.appendChild(chip(label, settingsCatalogSource === key, () => {
      if (settingsCatalogSource === key) return;
      settingsCatalogSource = key;
      settingsMenu = null;
      render();
    }));
  });
  return chips;
}

// Pure, and the whole rule: a part he typed carries no source at all, which is
// what makes "Typed by hand" mean something. Anything this does not understand
// shows him everything rather than an empty screen.
function settingsCatalogSourceFilter(list, mode) {
  const rows = Array.isArray(list) ? list : [];
  if (mode === 'typed') return rows.filter((p) => !p.source);
  if (mode === 'qed') return rows.filter((p) => p.source && p.source.kind === 'qed');
  return rows;
}

// WHICH PART IS THIS AN OPTION OF? The unhidden parts in the same drawer that
// are not already options of something else, and never the part itself. A
// two-deep chain would be a chooser that opens a chooser, and a man on a
// ladder has one tap in him for this.
function settingsBelongsWithOptions(catalog, p) {
  const rows = Array.isArray(catalog) ? catalog : [];
  if (!p) return [];
  return rows.filter((q) => q && q !== p && q.id !== p.id && !q.hidden
    && q.category === p.category
    && !(typeof q.variantOf === 'string' && q.variantOf !== ''));
}

function buildSetBelongsWith() {
  const p = state.data.catalog.find((x) => x.id === settingsBelongsWith);
  const box = card('What is ' + (p.name || 'this part') + ' an option of?');
  const list = settingsBelongsWithOptions(state.data.catalog, p);
  const counts = pickerVariantCounts(state.data.catalog);
  // "None" first, because it is the answer every part starts with and the one
  // he comes back here to give.
  box.appendChild(lineRow('None', 'It stands on its own', settingsBelongsWithNow(p, null),
    () => settingsSetBelongsWith(p, null), { keypad: true }));
  list.forEach((g) => {
    // How many options each one already carries: they are all out of the same
    // drawer, so naming the drawer on every row would say nothing, and what he
    // wants to know is which of them is already the row that holds the others.
    const has = counts.get(g.id) || 0;
    box.appendChild(lineRow(g.name, has ? pickerOptionsTag(has) : '', settingsBelongsWithNow(p, g.id),
      () => settingsSetBelongsWith(p, g.id), { keypad: true }));
  });
  if (!list.length) {
    box.appendChild(emptyNote('Nothing else in ' + catalogCategoryLabel(p.category) + ' to put it under.'));
  }
  box.appendChild(textButton('Cancel', 'btn btn-block mt-3', () => { settingsBelongsWith = null; render(); }));
  box.appendChild(caption('An option rides under the part it belongs with: the walk shows the one row, '
    + 'and tapping it offers the options. Nothing is renamed and nothing is put away.'));
  return box;
}

// The row he is already on says so, rather than the list looking like a set of
// choices none of which has been made.
function settingsBelongsWithNow(p, id) {
  const now = typeof p.variantOf === 'string' && p.variantOf !== '' ? p.variantOf : null;
  return now === id ? 'Now' : null;
}

function settingsSetBelongsWith(p, id) {
  const had = Object.prototype.hasOwnProperty.call(p, 'variantOf');
  const prev = p.variantOf;
  if (id === null) delete p.variantOf; else p.variantOf = id;
  settingsBelongsWith = null;
  settingsMenu = null;
  // An exact restore, and it DELETES the key when the key was not there: a
  // refused save must leave the part exactly as it was, and an undefined
  // variantOf sitting on it is not the same thing as no variantOf at all.
  settingsSaveAndRender(() => {
    if (had) p.variantOf = prev; else delete p.variantOf;
  });
}

// The put-away parts that belong on THIS view, so "Show hidden (3)" counts the
// three he is looking at rather than the forty in the whole file.
function settingsCatalogHidden(catalog, searching) {
  const q = Catalog.normalizeName(settingsCatalogSearch);
  return catalog
    .filter((x) => x.hidden && (searching
      ? Catalog.normalizeName(x.name || '').indexOf(q) !== -1
      : x.category === settingsCategory))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// The walk's tiles, in the walk's grid. Same six words in the same two columns
// in the same order, because the drawer he reaches for in a plant has to be
// the drawer he reaches for here.
function buildSetCatalogTiles() {
  const grid = document.createElement('div');
  grid.className = 'walk-tiles';
  CATALOG_CATEGORIES.forEach(([key, label]) => {
    grid.appendChild(textButton(label, 'walk-tile', () => {
      navPush();
      settingsCategory = key;
      settingsCatalogSearch = '';
      settingsMenu = null;
      render();
    }));
  });
  return grid;
}

// Under whatever is on the glass, the three things that are about the catalog
// rather than about one part in it.
function buildSetCatalogTools(hiddenCount) {
  const box = card();
  box.appendChild(textButton('+ New part', 'btn btn-block', settingsAddPart));
  settingsStandardButton(box, 'Add the standard parts', 'parts',
    (dd) => Store.addStandardCatalog(dd), state.data.catalog,
    (before) => { state.data.catalog = before; },
    () => settingsOfferNearDuplicates('parts', state.data.catalog, Store.standardCatalogNames()));

  // Importing the price file used to live here, under the parts it changes.
  // It moved to Settings > Backup in v3.1: it is a FILE Adrian sends him, and
  // the one place on this phone he already knows to go for a file somebody
  // sent him is the card that takes a backup.
  settingHiddenToggle(box, 'catalog', hiddenCount);
  box.appendChild(caption('New parts get added from the walk too. Hide takes one off the walk. '
    + 'Delete is only offered when no bid uses it. "Add the standard parts" adds the ones you are '
    + 'missing and leaves everything you have alone.'));
  return box;
}

// The price file's own button, built here beside the code that reads the file
// and appended by the Backup card. The second native input in the app, for the
// same reason as the backup picker: there is no other way to hand the phone a
// file. No accept filter, for the same reason too (iOS Files calls a mailed
// JSON public.data). PriceFile.parse is the gate.
function buildSetImportPrices(box) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.id = 'priceFile';
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const f = picker.files && picker.files[0];
    // The value goes back to empty before the file is read, because a native
    // file input fires change only when the value CHANGES. Adrian re-runs the
    // script and sends the file again under the same name, and without this
    // the second pick of it is silent: the button does nothing and he has no
    // way to tell whether the prices moved.
    picker.value = '';
    if (f) settingsImportPrices(f);
  });
  box.appendChild(picker);
  box.appendChild(textButton('Import parts and prices', 'btn btn-block mt-3', () => picker.click()));
  box.appendChild(caption('Reads the price file Adrian makes. It updates the prices on the parts it '
    + 'finds and adds the ones it cannot find, as options under the parts you already have. '
    + 'It says what it will do before it does it.'));
}

// The primary button on the confirm: the last thing he reads before three
// hundred parts land on his phone, so it says BOTH halves of what is about to
// happen. Zero is a real number here and is said out loud ("Update 0 prices,
// add 320 parts"): the first import of a fresh phone matches nothing and
// creates everything, and a button that hid that half would be a button that
// undersold the change.
function settingsImportButton(matched, creatable) {
  const prices = 'Update ' + matched + (matched === 1 ? ' price' : ' prices');
  if (!creatable) return prices;
  return prices + ', add ' + creatable + (creatable === 1 ? ' part' : ' parts');
}

// The question over that button. With nothing to create it is the sentence it
// has always been; with parts about to appear the button spells out the deal
// and the question only has to ask.
function settingsImportQuestion(creatable) {
  return creatable ? 'Go ahead?' : 'Update the bill-at prices?';
}

// And what the banner says afterwards. Each half only when there is a half to
// say. The prices that were already right are still counted, because "nothing
// moved" is a real answer to an import and has to read like one rather than
// like a button that did nothing.
function settingsImportBanner(changed, unchanged, added) {
  const bits = [];
  if (changed) bits.push('Updated ' + changed + (changed === 1 ? ' price' : ' prices'));
  if (added) bits.push((bits.length ? 'added ' : 'Added ') + added + (added === 1 ? ' part' : ' parts'));
  const done = bits.length ? bits.join(' and ') + '.' : '';
  const right = unchanged
    ? (unchanged === 1 ? 'One price was' : unchanged + ' prices were') + ' already right.'
    : '';
  if (done && right) return done + ' ' + right;
  if (done) return done;
  if (right) return right + ' Nothing changed.';
  return 'Nothing changed.';
}

// IMPORT PARTS AND PRICES. Read the file, work out what it would do to his
// catalog, say so, and only then write. The confirm carries the whole summary
// because it is the one moment he can still say no: how many parts are about
// to appear and what a handful of them are called, what moved a lot, what was
// skipped and why. Cost is never written (his own number), and no bid is
// touched (bids are history; the catalog is memory).
//
// NOTHING EXISTING IS EVER RENAMED, HIDDEN OR REMOVED HERE. The import only
// ever writes a price onto a part it found and pushes parts it did not find;
// a part he typed years ago is left exactly as it is, whatever the file says.
function settingsImportPrices(file) {
  const read = file && typeof file.text === 'function' ? file.text() : Promise.reject(new Error('no text()'));
  read.then((text) => {
    const parsed = PriceFile.parse(text);
    if (parsed.error) { showBanner(parsed.error, 'danger'); render(); return; }
    const m = PriceFile.plan(parsed.rows, state.data.catalog);
    const summary = PriceFile.summaryText(m);
    // Nothing to update AND nothing to create: there is no question to ask, so
    // the summary is simply said and the screen stays where it is.
    if (!m.matched.length && !m.creatable.length) { showBanner(summary); render(); return; }
    // confirmPanel refuses to open over another open panel; asking anyway
    // would look like the button did nothing, so say why instead.
    if (anyPanelOpen()) { showBanner('Finish what you were doing, then try the import again.'); render(); return; }
    return confirmPanel(summary + ' ' + settingsImportQuestion(m.creatable.length),
      { ok: settingsImportButton(m.matched.length, m.creatable.length) }).then((ok) => {
      if (!ok) { render(); return; }
      // What apply is about to touch, remembered first by the module itself
      // (PriceFile.snapshot), so a refused save puts every part back exactly
      // as it was. The parts that get PUSHED are undone the other way, by id,
      // because splicing by index would be wrong the moment anything else on
      // this phone touched the catalog in between.
      const snap = PriceFile.snapshot(m.matched);
      let added = [];
      const undo = () => {
        PriceFile.restore(snap);
        if (!added.length) return;
        const ids = new Set(added.map((p) => p.id));
        for (let i = state.data.catalog.length - 1; i >= 0; i -= 1) {
          if (ids.has(state.data.catalog[i].id)) state.data.catalog.splice(i, 1);
        }
      };
      // This leg has its own try/catch, separate from the outer .catch below:
      // the outer one means "the file would not read", which is never true
      // here (parse and plan already ran clean). A throw in apply or the
      // write is a WRITE failure on a file that read fine, so it gets its
      // own banner and its own restore, rather than being told to Adrian as
      // if his file were the problem.
      try {
        const out = PriceFile.apply(m.matched, parsed.checkedISO);
        added = PriceFile.newParts(m.creatable, parsed.checkedISO, Store.uid);
        added.forEach((p) => state.data.catalog.push(p));
        // ONE save for both halves. Two saves would leave a phone that took
        // the prices and refused the parts, which is a catalog nobody asked
        // for and no screen would explain.
        if (!persistOr(undo)) { render(); return; }
        showBanner(settingsImportBanner(out.changed, out.unchanged, added.length), 'ok');
      } catch (e) {
        undo();
        showBanner('Nothing was changed. Try the import again.', 'danger');
      }
      render();
    });
  }).catch(() => {
    // Only the read/parse leg lands here: file.text() rejecting, or a stale
    // cache read without PriceFile loaded. The apply leg above never falls
    // through to this catch, so this banner is never said about a file that
    // read fine.
    showBanner("Couldn't read that file", 'danger');
    render();
  });
}

// searching: the row says which drawer it came out of. A search crosses all
// six on purpose, and two identical-looking names out of two categories are
// otherwise the same row written twice.
function buildSetCatalogRow(box, p, searching, options) {
  const key = 'part:' + p.id;
  const unit = p.unit || '—';
  // The unit stays in the value slot, where every other row in this app puts
  // its answer, and the drawer goes on the walk's muted sub-line under the
  // name. "Fittings · ea" in one slot made the row say two different kinds of
  // thing in the same breath, and the one he was reading for — how it is
  // counted — was the half at the end.
  const line = settingRow(box, p.name || 'Part', unit,
    () => settingsToggleMenu(key), null,
    { strip: true, sub: settingsCatalogSub(p, searching, options) });
  if (p.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  // The unit chips ride inside the strip rather than sitting loose above it:
  // they are part of the same answer to "what about this part?".
  const units = document.createElement('div');
  units.className = 'set-chips';
  CATALOG_UNITS.forEach((u) => {
    units.appendChild(chip(u, p.unit === u, () => {
      if (p.unit === u) return;
      const prev = p.unit;
      p.unit = u;
      settingsSaveAndRender(() => { p.unit = prev; });
    }));
  });

  const actions = [
    ['Rename', '', () => {
      settingsPromptText(p.name, 'Part name', '3/4" EMT', line, { required: true }, (text) => {
        const prev = p.name;
        // Same rule as adding one: what the iOS keyboard turned into a curly
        // quote is stored straight, or the search for 1" EMT stops finding it.
        p.name = Catalog.straighten(text);
        settingsSaveAndRender(() => { p.name = prev; });
      });
    }],
    // QED's number for this part. Typed once, off a receipt or the product
    // page, and from then on a price file finds the part by it. Clear takes
    // it off. Nothing about the price moves here; that is the import's job.
    ['QED part #', '', () => {
      settingsPromptText(p.sku || '', 'QED part number for ' + (p.name || 'this part'), '3302434', line,
        { caption: 'On the receipt, or under the product on qedelectric.com. Leave it blank to take it off.' },
        (text) => {
          const prev = p.sku;
          const next = (text || '').replace(/\s+/g, '');
          if (next !== '') {
            const clash = state.data.catalog.find((q) => q !== p && q.sku === next);
            if (clash) { showBanner('That number is already on ' + (clash.name || 'another part') + '.'); render(); return; }
          }
          p.sku = next === '' ? null : next;
          settingsSaveAndRender(() => { p.sku = prev; });
        });
    }],
  ];

  // WHICH GENERIC THIS PART RIDES UNDER. Offered on every part except one that
  // already has options of its own: a generic that became an option of
  // something else would be a chooser inside a chooser. This is the door his
  // own hand-typed part goes through to become one of the choices, and the
  // door back out of it.
  if (!(options > 0)) {
    actions.push(['Belongs with', '', () => { navPush(); settingsBelongsWith = p.id; render(); }]);
  }
  // Neither an edit nor a delete, so neither a button in the grid nor the
  // muted line at the bottom: a navy link of its own, which opens the search
  // in another tab and leaves this screen exactly where it was.
  actions.push(['Check price', 'link', () => openPriceSearch(setS(), p.sku || p.name)]);

  settingsRemoveActions(box, line, actions, p, Store.catalogInUse(state.data, p.id),
    state.data.catalog, p.name || 'this part', units);
}

// The muted line under a part's name: the drawer when he is searching across
// all of them, and the supplier's handle when the part has one. "QED 3302434 ·
// $39.08 list, Sep 8, 2026" says the import reached this part and when.
function settingsCatalogSub(p, searching, options) {
  const bits = [];
  if (searching) bits.push(catalogCategoryLabel(p.category));
  if (p.sku) bits.push('QED ' + p.sku);
  if (Number.isInteger(p.lastListCents) && p.priceCheckedISO) {
    bits.push(moneyText(p.lastListCents) + ' list, ' + fmtDate(p.priceCheckedISO));
  }
  // Where the ROW came from, which is not the same fact as the part number
  // above it: he can type a QED number onto a part of his own, and that part
  // is still one he typed. This is what the filter chips are filtering on.
  const from = Catalog.sourceLabel(p);
  if (from) bits.push(from);
  // Last, because it is about what is BEHIND the row rather than about the
  // part on it.
  if (options > 0) bits.push(pickerOptionsTag(options));
  return bits.length ? bits.join(' · ') : null;
}

// + NEW PART: the name, then the drawer, then how it is counted. Three panels
// rather than one, because each answer is a different KIND of answer and a
// phone has room for one question at a time. Nothing is written until the unit
// is picked, so backing out at any step leaves nothing behind.
function settingsAddPart() {
  promptText('', {
    label: 'New part',
    placeholder: '3/4" EMT',
    done: (name) => {
      if (!name) { showBanner('A new part needs a name'); return; }
      navPush();
      // The drawer he is standing in is OFFERED as the answer, not taken as
      // one: he opens Fittings, finds the coupling missing and adds it, but he
      // might just as well be adding the box it goes on.
      settingsNewPart = { name: Catalog.straighten(name), category: null, from: settingsCategory };
      render();
    },
  });
}

function buildSetNewPart() {
  const np = settingsNewPart;

  if (!np.category) {
    const box = card('Where does ' + np.name + ' go?');
    const chips = document.createElement('div');
    chips.className = 'set-chips';
    CATALOG_CATEGORIES.forEach(([key, label]) => {
      chips.appendChild(chip(label, key === np.from, () => {
        np.category = key;
        render();
      }));
    });
    box.appendChild(chips);
    box.appendChild(textButton('Cancel', 'btn btn-block', () => { settingsNewPart = null; render(); }));
    return box;
  }

  const box = card('How is ' + np.name + ' counted?');
  const nav = document.createElement('div');
  nav.className = 'bid-nav';
  CATALOG_UNITS.forEach((u) => {
    nav.appendChild(textButton(u, 'btn btn-block', () => settingsCreatePart(u)));
  });
  box.appendChild(nav);
  box.appendChild(textButton('Cancel', 'btn btn-block mt-3', () => { settingsNewPart = null; render(); }));
  return box;
}

function settingsCreatePart(unit) {
  const { name, category } = settingsNewPart;
  const part = Store.addCatalogItem(state.data, { category, name, unit });
  if (!part) { showBanner('A new part needs a name'); settingsNewPart = null; render(); return; }
  if (!persistOr(() => {
    const i = state.data.catalog.indexOf(part);
    if (i !== -1) state.data.catalog.splice(i, 1);
  })) { render(); return; }
  // He lands in the drawer he just filed it in, with the search cleared, so
  // the part he typed is on the glass in front of him.
  settingsNewPart = null;
  settingsCategory = category;
  settingsCatalogSearch = '';
  settingsMenu = null;
  showBanner('Added ' + part.name, 'ok');
  render();
}

// ---------------------------------------------------------------------------
// INVOICES — its own screen
// ---------------------------------------------------------------------------
// Two answers, and he sets both on the first morning: the number his next
// invoice takes, and what the Terms cell says. Everything else about an
// invoice is decided on the invoice, because a setting that reached backwards
// would rewrite paper the customer is already holding.

// Six digits, not five. His real invoices are numbered 166818 and up, which is
// the whole reason this row exists, and the bid counter's five-digit cap would
// have refused the only number he was ever going to type into it.
const SET_INVOICE_NUMBER_MAX = 999999;

// The one refusal this screen makes rather than warns about. A bid number that
// collides is two pieces of paper with one number on them, which is bad; an
// invoice number that collides is a second invoice claiming a number the
// customer has already paid against, and the app has no voiding to get out of
// it. Pure, and tested: it is the only rule on this screen.
function settingsInvoiceNumberRefusal(d, n) {
  if (!Store.invoiceNumberInUse(d, n)) return null;
  return 'Invoice #' + n + ' is already on an invoice. Numbers are never reused.';
}

function enterSettingsInvoices() { settingsMenu = null; }

function renderSettingsInvoices() {
  const host = el('settingsInvoicesContent');
  host.textContent = '';
  host.appendChild(buildSetInvoices());
}

function buildSetInvoices() {
  const s = setS();
  const box = card('Invoices');
  // The seed is what is stored; next is what the counter will hand out, which
  // is the seed raised past anything already on the file. The row shows NEXT,
  // because the row is answering "what number does my next invoice get?" and
  // the stored seed is only the app's own bookkeeping.
  const seed = Number.isInteger(s.nextInvoiceNumber) ? s.nextInvoiceNumber : 1;
  const next = Store.effectiveNextInvoiceNumber(state.data);

  const line = settingRow(box, 'Next invoice number', '#' + next, () => {
    settingsPromptWhole(next, 'The next invoice number', line, 1, SET_INVOICE_NUMBER_MAX,
      'An invoice number is between 1 and ' + SET_INVOICE_NUMBER_MAX,
      (v) => {
        const refusal = settingsInvoiceNumberRefusal(state.data, v);
        if (refusal) { showBanner(refusal); shake(line); return; }
        const prev = s.nextInvoiceNumber;
        s.nextInvoiceNumber = v;
        settingsSaveAndRender(() => { s.nextInvoiceNumber = prev; });
      });
  }, 'Set this to your real next number the first day. It only goes up.');

  // Standing, and only ever on screen when it is true — the way the bid
  // counter's warning is. Typing a taken number is refused outright, so the
  // only way to be looking at this is a file restored onto a phone whose
  // counter had already run past the seed. It says what will happen rather
  // than what is wrong: the number he gets is already decided, and the row
  // above is already showing it.
  if (next !== seed) {
    box.appendChild(inlineWarn('#' + seed + ' is taken or behind. Your next invoice will be #'
      + next + '. Numbers only go up.'));
  }

  const terms = settingRow(box, 'Default terms', s.invoiceTerms || 'Upon receipt', () => {
    settingsPromptText(s.invoiceTerms || '', 'Default terms', 'Upon receipt', terms, { required: true }, (text) => {
      const prev = s.invoiceTerms;
      s.invoiceTerms = text;
      settingsSaveAndRender(() => { s.invoiceTerms = prev; });
    });
  }, 'Prints in the Terms cell. Upon receipt is what your invoices say.');

  box.appendChild(whatsThis([
    'Next invoice number: the number the next invoice gets, whether it comes off Bill these or off '
      + 'a won bid. It counts up on its own, and a number that has already been used is refused: '
      + 'numbers are never reused, and there is no voiding an invoice in this app. A number that '
      + 'sits below one you have already used is raised to the next free one, so what this row '
      + 'says is always the number you will get.',
    'Default terms: what a NEW invoice starts with. An invoice already written keeps the terms it '
      + 'went out with, and a customer with terms of their own beats this one.',
  ]));
  return box;
}

// ---------------------------------------------------------------------------
// CUSTOMERS — its own screen
// ---------------------------------------------------------------------------
// A customer used to be a name on a bid and nothing else. An invoice needs
// more: who it is addressed to, where it is posted, the rate THIS customer is
// billed at, and the purchase order number they want on the paper. All of it
// is snapshotted onto an invoice the day it is drafted, so nothing typed here
// can move an invoice that already exists.
//
// The list opens one customer at a time rather than opening a strip on the
// row: nine fields is a card, not four buttons.

function enterSettingsCustomers() {
  settingsMenu = null;
  settingsCustomer = null;
  settingsShowHidden.customers = false;
}

// One step inside this screen before it gives up and goes back to Settings:
// the open customer closes first, the way a catalog drawer does, so the back
// gesture and the Back button both land on the list.
function settingsCustomersBackStep(peek) {
  if (settingsCustomer) {
    if (!peek) { settingsCustomer = null; settingsMenu = null; render(); }
    return true;
  }
  return false;
}

function settingsCustomerOpen() {
  return settingsCustomer
    ? ((state.data.customers || []).find((c) => c.id === settingsCustomer) || null)
    : null;
}

function renderSettingsCustomers() {
  const host = el('settingsCustomersContent');
  host.textContent = '';
  const c = settingsCustomerOpen();
  if (!c) { host.appendChild(buildSetCustomers()); return; }
  buildSetCustomerCard(host, c);
}

// What the row says on the right: the rate this customer is billed at, which
// is the one thing on the card that changes what an invoice comes to.
function settingsCustomerValue(c) {
  // "Settings rate" in the same words as the caption under the row it opens
  // ("Blank bills at your Settings rate"), so the value and the explanation of
  // it are not two different names for one thing.
  return c.rateCents == null ? 'Settings rate' : moneyText(c.rateCents) + '/hr';
}

function buildSetCustomers() {
  const d = state.data;
  const box = card('Customers');
  const hidden = (d.customers || []).filter((c) => c.hidden);
  const list = (d.customers || []).filter((c) => !c.hidden || settingsShowHidden.customers)
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (list.length === 0) {
    box.appendChild(emptyNote('Nobody yet. A customer is made on a bid or at the truck.'));
  } else {
    list.forEach((c) => {
      const line = row(c.name || 'Customer', settingsCustomerValue(c), () => {
        navPush();
        settingsCustomer = c.id;
        settingsMenu = null;
        render();
      });
      if (c.hidden) line.classList.add('set-hidden');
      box.appendChild(line);
    });
  }

  settingHiddenToggle(box, 'customers', hidden.length);
  box.appendChild(caption('What each one is billed at, what prints in Bill To, and which of their '
    + 'jobs are still open. Nothing here changes an invoice you have already written.'));
  return box;
}

// The plain strings, in the order they are read on the paper. Every one of
// them is optional except the name: a customer with no contact and no address
// still bills, and Bill To simply leaves the line out.
const SETTINGS_CUSTOMER_FIELDS = [
  ['name', 'Name', 'UDA', true],
  ['contact', 'Contact', 'Kellen', false],
  ['phone', 'Phone', '480 555 0134', false],
  ['email', 'Email', 'name@company.com', false],
  ['attn', 'Attn', 'Who the invoice is addressed to', false],
];

// EXACT restores, which for an optional key means putting the ABSENCE back.
// attn, address, po and terms are all keys a customer written before this
// release simply does not have, and `c[key] = undefined` is not the same
// document as no key at all: it survives a round trip through JSON as a
// missing key, but until the next save the object in memory carries a key the
// file does not, and every restore in this app is meant to leave the document
// exactly as it was found.
function settingsRestoreKey(c, key) {
  const had = Object.prototype.hasOwnProperty.call(c, key);
  const prev = c[key];
  return () => { if (had) c[key] = prev; else delete c[key]; };
}

function settingsCustomerField(box, c, key, label, placeholder, required) {
  const line = settingRow(box, label, c[key] ? String(c[key]) : 'None', () => {
    settingsPromptText(c[key] == null ? '' : String(c[key]), label, placeholder, line,
      { required }, (text) => {
        const undo = settingsRestoreKey(c, key);
        c[key] = text == null ? '' : String(text).trim();
        settingsSaveAndRender(undo);
      });
  });
  return line;
}

function buildSetCustomerCard(host, c) {
  const d = state.data;
  const box = card(c.name || 'Customer');
  SETTINGS_CUSTOMER_FIELDS.forEach(([key, label, placeholder, required]) => {
    settingsCustomerField(box, c, key, label, placeholder, required);
  });

  // Two lines of address on his own invoices, and the paper stacks them in the
  // order they are typed. Capped at what the file will take, so a paste out of
  // an email cannot make a customer the validator refuses.
  const addr = settingRow(box, 'Address', settingsAddressValue(c), () => {
    settingsPromptText(c.address == null ? '' : String(c.address), 'Address',
      '2008 S Hardy Drive\nTempe, AZ 85282', addr,
      { multiline: true, maxLength: Store.ADDRESS_MAX }, (text) => {
        const undo = settingsRestoreKey(c, 'address');
        c.address = text == null ? '' : String(text);
        settingsSaveAndRender(undo);
      });
  }, 'Prints under the name in Bill To, a line at a time.');

  const rate = settingRow(box, 'Hourly rate', settingsCustomerValue(c), () => {
    promptMoney(c.rateCents == null ? null : c.rateCents, {
      label: settingsRateLabel(c.name),
      done: (cents) => {
        const undo = settingsRestoreKey(c, 'rateCents');
        // Clear puts them back on the shop rate, which is what most of them
        // are on. The keypad answers null for Clear and a whole number of
        // cents otherwise, and null is exactly what "no rate of their own"
        // is on the file, so the answer goes straight on.
        c.rateCents = cents;
        settingsSaveAndRender(undo);
      },
    });
  }, 'Blank bills at your Settings rate.', { keypad: true });

  const po = settingRow(box, 'PO number', c.po ? String(c.po) : 'None', () => {
    settingsPromptText(c.po == null ? '' : String(c.po), 'PO number', '2526-4213', po, {}, (text) => {
      const undo = settingsRestoreKey(c, 'po');
      c.po = text == null ? '' : String(text).trim();
      settingsSaveAndRender(undo);
    });
  }, 'Leave blank when the customer does not use them.');

  const terms = settingRow(box, 'Terms', c.terms ? String(c.terms) : (setS().invoiceTerms || 'Upon receipt'), () => {
    settingsPromptText(c.terms == null ? '' : String(c.terms), 'Terms',
      setS().invoiceTerms || 'Upon receipt', terms, {}, (text) => {
        const undo = settingsRestoreKey(c, 'terms');
        c.terms = text == null ? '' : String(text).trim();
        settingsSaveAndRender(undo);
      });
  }, 'Blank uses the default under Settings, Invoices.');
  host.appendChild(box);

  buildSetCustomerProjects(host, c);
  buildSetCustomerRemove(host, c);
}

// One line on the row for a thing that is two lines on paper.
function settingsAddressValue(c) {
  const lines = String(c.address == null ? '' : c.address).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 'None';
  return lines.length === 1 ? lines[0] : lines[0] + ' +' + (lines.length - 1);
}

// The jobs the truck log still offers under this customer. Done is how a job
// leaves that list: the chips at the tailgate are only useful while they are
// short, and last spring's freezer job is not what he is standing on today.
function buildSetCustomerProjects(host, c) {
  const box = card('Open projects');
  const open = Store.openProjects(state.data, c.id);
  if (!open.length) {
    box.appendChild(emptyNote('No open jobs for this one.'));
  } else {
    open.forEach((p) => {
      settingsListRow(box, p.title, [
        textButton('Done', 'link-btn link-btn-quiet', () => settingsProjectDone(p)),
      ]);
    });
  }
  box.appendChild(caption('Done projects stop being offered on the log screen. The hours already '
    + 'logged against them do not move.'));
  host.appendChild(box);
}

function settingsProjectDone(p) {
  const prev = p.done;
  p.done = true;
  settingsSaveAndRender(() => { p.done = prev; });
}

// What is pointing at this customer, in the counts the caption says out loud.
// Null when nothing is: that is the case where Delete is offered, and the
// sentence there is the confirm's, not this one's.
function settingsCustomerUseCaption(counts) {
  const parts = [];
  const add = (n, one, many) => { if (n > 0) parts.push(n + ' ' + (n === 1 ? one : many)); };
  add(counts.bids, 'bid', 'bids');
  add(counts.projects, 'project', 'projects');
  add(counts.logs, 'visit', 'visits');
  add(counts.invoices, 'invoice', 'invoices');
  if (!parts.length) return null;
  return 'On ' + parts.join(', ') + ', so it can be hidden but not deleted.';
}

// The same two answers every list on this screen has, decided the same way:
// hide is always there and is reversible, and delete only turns up when
// nothing at all points at the row — a customer on a bid, a project, a visit
// or an invoice cannot go without taking that record's name with it.
function buildSetCustomerRemove(host, c) {
  const d = state.data;
  const counts = Store.customerUseCounts(d, c.id);
  const uses = counts.bids + counts.projects + counts.logs + counts.invoices;
  const box = card();

  // The tuples the crew, equipment, clause and catalog rows are built from, so
  // the namesake guard on Unhide and the exact restore on Delete are the same
  // code here as everywhere else.
  const hide = settingsHideAction(c, d.customers);
  box.appendChild(textButton(hide[0], 'btn btn-block', hide[2]));
  if (uses === 0) {
    const del = settingsDeleteAction(d.customers, c, c.name || 'this customer');
    box.appendChild(textButton(del[0], 'link-btn link-btn-quiet', del[2]));
  }
  box.appendChild(caption(settingsCustomerUseCaption(counts)
    || 'Not on a bid, a job or an invoice, so this one can go for good.'));
  host.appendChild(box);
}

// ---------------------------------------------------------------------------
// COUNTER
// ---------------------------------------------------------------------------
// The number the NEXT bid will take. Two bids with the same number on two
// pieces of paper in the same customer's hands is the failure this warns
// about, so it checks the number that is actually about to be used — not the
// one he just typed and not the one after it.

function buildSetCounterRow(box) {
  const s = setS();

  const line = settingRow(box, 'Next bid number', '#' + s.nextNumber, () => {
    settingsPromptWhole(s.nextNumber, 'The next bid number', line, 1, SET_NUMBER_MAX,
      'A bid number is between 1 and ' + SET_NUMBER_MAX,
      (v) => {
        const prev = s.nextNumber;
        s.nextNumber = v;
        settingsSaveAndRender(() => { s.nextNumber = prev; });
      });
  });

  // The warning stays standing. Everything else on this card explains itself
  // once and then never again; this one is about two pieces of paper in one
  // customer's hands, and it is only ever on screen when it is true.
  if (Store.numberInUse(state.data, s.nextNumber)) {
    box.appendChild(inlineWarn('Bid #' + s.nextNumber + ' already exists. The next new bid would '
      + 'carry the same number as one you have already written.'));
  }
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

// The two answers the PIN row has, in the strip every other row with two
// answers wears. It opens no screen — changing a PIN happens on the lock screen
// itself and forgetting one is a confirm — so the row carries no chevron.
function buildSetPinActions(line) {
  const buttons = [['Change PIN', '', startPinChange]];

  if (state.data.pin !== null) {
    // Last in the strip and muted, like every other way of taking something
    // away in this app. It used to be an outlined red button directly under
    // Change PIN, which is one thumb-width from the button he actually wanted.
    buttons.push(['Forget this PIN', 'quiet', async () => {
      const ok = await confirmPanel('Forget this PIN? The next time you open the app it will ask you '
        + 'to pick a new one.', { ok: 'Forget', danger: true });
      if (!ok) { render(); return; }
      const prev = state.data.pin;
      state.data.pin = null;
      settingsMenu = null;
      settingsSaveAndRender(() => { state.data.pin = prev; });
    }]);
  }

  settingActions(line, buttons);
}

// ---------------------------------------------------------------------------
// THE DOORS ON THE INDEX
// ---------------------------------------------------------------------------
// Six screens reached from rows here: the three libraries that got big, the
// thirteen rates, the crew, and the company. All six used to be cards laid out
// flat on this screen, which is what turned Settings into a scroll he had to
// hunt down — the jump strip at the top was a patch over exactly that, and it
// went with them.
//
// A row, a screen. The value on the right is the answer to the only question
// he asks before tapping one: what is behind this, and is it still right.

function settingsCountText(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function buildSetDoors() {
  const s = setS();
  const box = card();

  // Crew leads them. A wage is new bids only since the snapshot rule landed, so
  // this stopped being a weekly card and became a door like the rest — but it
  // is still the one he is likeliest to open, and the men's names on the right
  // answer the only question he asks before tapping it.
  box.appendChild(row('Crew', settingsCrewSummary(s.crew), () => show('settings-crew')));

  // Customers next to Crew: they are the two lists of PEOPLE, and the one he
  // opens here is the one whose rate or PO number just changed.
  box.appendChild(row('Customers',
    settingsCountText(state.data.customers.filter((c) => !c.hidden).length, 'customer', 'customers'),
    () => show('settings-customers')));

  // Rates next: it is the only one of the five he opens to change a
  // number rather than to look something up, and the rate on the right is the
  // answer to "is this still what I am charging?" without opening anything.
  box.appendChild(row('Rates', moneyText(s.rateCents) + '/hr', () => show('settings-rates')));
  // The number the next invoice will carry, not the stored seed: the same
  // number the sub-screen's own row shows, from the same rule in storage.
  box.appendChild(row('Invoices', '#' + Store.effectiveNextInvoiceNumber(state.data),
    () => show('settings-invoices')));
  box.appendChild(row('Parts catalog',
    settingsCountText(state.data.catalog.filter((p) => !p.hidden).length, 'part', 'parts'),
    () => show('settings-catalog')));
  box.appendChild(row('Equipment',
    settingsCountText(s.equipment.filter((e) => !e.hidden).length, 'tool', 'tools'),
    () => show('settings-equipment')));
  box.appendChild(row('Terms library',
    settingsCountText(s.clauses.filter((c) => !c.hidden).length, 'clause', 'clauses'),
    () => show('settings-terms')));

  box.appendChild(caption('Who works for you, who you work for, your numbers, what an invoice '
    + 'starts at, the parts you count on a walk, the tools you own, and the terms that go on the '
    + 'back of a proposal.'));
  return box;
}

// "2 · Shawn, George" — the count first, because that is the number that has to
// be right before a bid is figured, then as many names as the line will hold.
// A crew of six would run past the row, so the names stop and say how many did
// not fit rather than pushing the value off the screen.
const SETTINGS_CREW_NAMES_MAX = 24;

function settingsCrewSummary(crew) {
  const list = crew.filter((c) => !c.hidden);
  if (!list.length) return 'Nobody yet';
  const names = [];
  let width = 0;
  for (const c of list) {
    const name = c.name || 'Worker';
    const cost = (names.length ? 2 : 0) + name.length;
    if (names.length && width + cost > SETTINGS_CREW_NAMES_MAX) break;
    names.push(name);
    width += cost;
  }
  const rest = list.length - names.length;
  return list.length + ' · ' + names.join(', ') + (rest ? ' +' + rest : '');
}

// THE FOUR SHORT ANSWERS, IN ONE CARD.
//
// The next bid number, who the paper is from, the four digits that open the
// app, and the reports. Four cards once, each with a heading of its own and a
// standing grey line of explanation under it — eight lines he reads on the
// first morning and scrolls past for the rest of the year, wrapped in four
// sets of card margins, around four rows of actual answer. They are four rows
// now, and the four sentences are behind the one "What's this?" at the bottom.
//
// The bid number comes down here from the top of the index with them. It is
// the one number on this screen he sets on day one and then never touches, and
// putting it above the two lists he edits every month said the opposite.
function buildSetMore() {
  const co = setS().company;
  const box = card();

  buildSetCounterRow(box);

  box.appendChild(row('Company', co.name, () => show('settings-company')));

  const pin = settingRow(box, 'PIN', state.data.pin === null ? 'Not set yet' : '••••',
    () => settingsToggleMenu('pin'), null, { strip: true });

  // What the reports have to work with. A phone with no bids on it has nothing
  // to report, and the row says so before he opens it.
  box.appendChild(row('Reports', settingsCountText(state.data.bids.length, 'bid', 'bids'),
    () => show('reports')));

  // After the Reports row is in, so the strip lands under the PIN row it
  // belongs to rather than at the bottom of the card.
  if (settingsMenuOpen('pin')) buildSetPinActions(pin);

  box.appendChild(whatsThis([
    'Next bid number: the number the next new bid gets. It starts at 1. Set this to your real '
      + 'next bid number the first day you use the app. It counts up on its own after that. '
      + 'Invoice numbers are their own counter, under Invoices.',
    'Company: what prints at the top of a proposal, how it looks, what it says about tax, '
      + 'and where "Check price" goes.',
    'PIN: four digits. There is no way to look it up, so pick one you will not lose.',
    'Reports: win rate, job history, and what the jobs really cost.',
  ]));
  return box;
}

// ---------------------------------------------------------------------------
// ELSEWHERE
// ---------------------------------------------------------------------------

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
const SET_BACKUP_TITLE = 'CE Billing backup';

let settingsBackupBusy = false;
let settingsBackupPdfs = [];         // { id, bidId|invoiceId, at, blob } still pending, oldest first
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
    // BOTH kinds of document, in ONE ordered list. A proposal and an invoice
    // are both paper that left this phone and both need to reach his computer;
    // two piles with two watermarks would be two things to remember to press,
    // and the older of the two would be the one he forgot. Exactly one of the
    // two parsers answers for any id (each refuses the other's prefix), so an
    // id that is neither is simply dropped.
    const entries = (ids || []).map((id) => bidPdfParse(id) || invoicePdfParse(id)).filter(Boolean);
    const sel = backupSelection(entries, through, SET_BACKUP_PDF_MAX);
    // The whole entry is carried, whichever kind it is: the name below needs
    // the bidId or the invoiceId it came with to find the document it belongs to.
    const take = sel.send.map((x) => Object.assign({}, x, { blob: null }));
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

// The document's own file name with the millisecond it was made on the end, so
// three revisions of one bid arrive as three files rather than one that
// overwrote the other two.
//
// An invoice is named by InvDoc the way a proposal is named by DocModel: the
// name he would recognize in a folder on his computer, "CE Invoice 166818 -
// UDA - UF Project", rather than the id it is stored under. Both are wrapped,
// because a document that cannot name itself must not take the whole backup
// down with it — the fallback still says which piece of paper it is.
function settingsBackupPdfName(entry) {
  const d = state.data;
  if (entry.invoiceId) {
    const inv = (d.invoices || []).find((x) => x.id === entry.invoiceId);
    let base = 'invoice';
    if (inv) {
      try { base = String(InvDoc.fileName(inv, d)).replace(/\.pdf$/i, ''); }
      catch (err) { base = 'invoice-' + (inv.number === null ? 'draft' : inv.number); }
    }
    return base + '-' + entry.at + '.pdf';
  }
  const bid = d.bids.find((b) => b.id === entry.bidId);
  let base = 'proposal';
  if (bid) {
    try { base = String(DocModel.fileName(bid, d)).replace(/\.pdf$/i, ''); }
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
      showBanner("That file isn't a CE Billing backup", 'danger');
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
    p.classList.add('caption-warn');
    return p;
  }
  p.textContent = 'Last backup: ' + fmtDate(s.lastBackupAt) + ' (' + settingsAgeWords(age) + ')';
  if (age > SET_BACKUP_STALE_DAYS) p.classList.add('caption-warn');
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
  // A real button, outlined and neutral. It is not red, because it is not
  // destructive from where he is standing: he taps it on the worst day this
  // app has, with a new phone in his hand and a year of bids to get back, and
  // a quiet grey line under the send button is not what a recovery looks
  // like. The confirm it opens is what asks about the replacing.
  box.appendChild(textButton('Restore from backup', 'btn btn-block mt-3', () => picker.click()));

  // --- The price file
  // Under Restore because it is the same errand: a file Adrian sent him, off
  // the phone and into the app. The plan called the row above it "Import
  // backup"; the button has always said Restore from backup, and it keeps its
  // own name.
  buildSetImportPrices(box);

  // One caption on this card is the date at the top of it - the answer to the
  // only question he opens it with. The rest of the explaining folds.
  box.appendChild(whatsThis([
    'Send a backup: everything on this phone goes to whoever is named above. Do it every couple of weeks, or after a big bid.',
    'Send it to: whoever keeps the copy that is not on this phone.',
    'Restore from backup: pick a backup file. Everything on this phone is replaced by what is in it.',
    'Import parts and prices: pick the price file Adrian makes. It updates what your parts bill at and leaves every bid you have written alone.',
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

// SETTINGS IS AN INDEX. It is a list of doors and the three things short enough
// to answer in place — the next bid number and the two plain lists, folded to
// three rows each with everything they can say about themselves folded in
// behind the same tap. Everything long is behind a row: the crew, the rates,
// the three libraries, the company. Laid flat this screen was six and a half
// thousand pixels, and the jump strip that used to sit over it was an index
// over an index. Both are gone.
//
// AND AN INDEX DOES NOT EXPLAIN ITSELF STANDING UP. Every door that used to
// carry a grey line of explanation under it now carries it behind a "What's
// this?", or behind the door itself — six sentences he reads once and then
// scrolls past forever were most of a screen. The one caption still standing
// is Backup's, because losing the bids is the one thing on this screen he
// cannot undo.
//
// Order is how often he touches it, not how the file is organized. The
// sections in the file itself stay in their old order so the diff stays
// readable.
const SETTINGS_CARDS = [
  ['set-doors', () => buildSetDoors()],
  ['set-forget', () => buildSetForget()],
  ['set-notes', () => buildSetNotePhrases()],
  ['set-more', () => buildSetMore()],
  ['set-backup', () => buildSetBackup()],
];

// "CE Billing · v3 · built Sep 9, 2026". The version is the cache the phone is
// actually being served by (APP_VERSION, held to sw.js's CACHE by
// tests/sw.test.js); the date is APP_BUILT beside it. index.html is served
// cache-first, so a deploy that forgets to bump CACHE leaves him on old code
// with no symptom at all — this line is the symptom, and the DATE is the half
// he can check against the day he was told to update.
function settingsVersionText() {
  // Both prefixes, because the app was called CE Bids for its first eleven
  // releases and a phone still on one of those caches reads its own version
  // out of its own app.js: the line has to strip whichever prefix it finds.
  return 'CE Billing · ' + String(APP_VERSION).replace(/^(bids|billing)-/, '') + ' · built ' + fmtDate(APP_BUILT);
}

function renderSettings() {
  const host = el('settingsContent');
  host.textContent = '';

  SETTINGS_CARDS.forEach(([id, build]) => {
    const node = build();
    node.id = id;
    host.appendChild(node);
  });

  // Still the last line on the index, and still the only way he can tell from
  // his phone which build is serving him.
  const version = caption(settingsVersionText());
  version.className = 'caption app-version';
  host.appendChild(version);
}

registerScreen('settings', {
  id: 'screen-settings', title: 'Settings', back: null, tab: 'settings',
  enter: enterSettings, render: renderSettings,
});

// The five screens the index's rows open. Each one is a screen in its own
// right — its own history entry, its own Back to Settings, the Settings tab
// still lit underneath — so the phone's back gesture and the button at the top
// do the same thing, and coming back lands on the index rather than on a card
// halfway down it.
registerScreen('settings-crew', {
  id: 'screen-settings-crew', title: 'Crew', back: 'settings', tab: 'settings',
  enter: enterSettingsCrew, render: renderSettingsCrew,
});

registerScreen('settings-rates', {
  id: 'screen-settings-rates', title: 'Rates', back: 'settings', tab: 'settings',
  enter: enterSettingsRates, render: renderSettingsRates,
});

registerScreen('settings-company', {
  id: 'screen-settings-company', title: 'Company', back: 'settings', tab: 'settings',
  enter: enterSettingsCompany, render: renderSettingsCompany,
});

registerScreen('settings-catalog', {
  id: 'screen-settings-catalog', title: 'Parts catalog', back: 'settings', tab: 'settings',
  enter: enterSettingsCatalog, backStep: settingsCatalogBackStep, render: renderSettingsCatalog,
});

registerScreen('settings-equipment', {
  id: 'screen-settings-equipment', title: 'Equipment', back: 'settings', tab: 'settings',
  enter: enterSettingsEquipment, render: renderSettingsEquipment,
});

registerScreen('settings-terms', {
  id: 'screen-settings-terms', title: 'Terms library', back: 'settings', tab: 'settings',
  enter: enterSettingsTerms, render: renderSettingsTerms,
});

registerScreen('settings-invoices', {
  id: 'screen-settings-invoices', title: 'Invoices', back: 'settings', tab: 'settings',
  enter: enterSettingsInvoices, render: renderSettingsInvoices,
});

registerScreen('settings-customers', {
  id: 'screen-settings-customers', title: 'Customers', back: 'settings', tab: 'settings',
  enter: enterSettingsCustomers, backStep: settingsCustomersBackStep, render: renderSettingsCustomers,
});
