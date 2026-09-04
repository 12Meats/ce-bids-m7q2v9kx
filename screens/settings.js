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
// 1. HOW FAR DOES IT REACH? A settings value is either a default a NEW bid
//    takes a copy of, or a live number every bid in the file is figured
//    against. The difference is invisible on the glass, so it is spelled out
//    on every single row, and the ones that reach backwards ask before they
//    change. Verified against the code, not against intuition:
//
//      Hours per day    — costStack reads it live. It moves real hours, bid
//                         hours, and therefore the PRICE of every bid.
//      Burden, consumables, overhead, truck & gas, a crew wage
//                       — costStack reads all of them live. They move what
//                         every bid COSTS and so what margin it is really
//                         running at. Prices don't move: a price is
//                         fixedPrice + the rate stored on that bid × bid
//                         hours, and none of that is in here.
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
//   ELSEWHERE   — Reports, and the Backup placeholder
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

function enterSettings() {
  settingsMenu = null;
  settingsAddGroup = false;
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
function settingRow(box, label, valueText, onTap, captionText) {
  const line = row(label, valueText, onTap);
  box.appendChild(line);
  if (captionText) box.appendChild(caption(captionText));
  return line;
}

// The strip of buttons that opens under a row he tapped. Wrapping in flex so
// two or four of them share the width instead of stacking four deep.
function settingActions(buttons) {
  const wrap = document.createElement('div');
  wrap.className = 'set-actions';
  buttons.forEach(([label, cls, onTap]) => wrap.appendChild(textButton(label, 'btn ' + cls, onTap)));
  return wrap;
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

// --- The two questions that reach backwards ---------------------------------
// Asked EVERY time, not once a session: the second change of the day reaches
// exactly as far as the first one did. The wording is price.js's and labor.js's
// word for word, because it is the same fact and he should not have to work
// out whether two differently worded warnings mean two different things.

function settingsConfirmCost(what) {
  return confirmPanel('Change ' + what + '? This re-figures the cost and margin on EVERY bid, '
    + 'including ones already sent. Their prices stay where you set them.');
}

function settingsConfirmHours() {
  return confirmPanel(
    'Change hours per day? This re-figures the hours and price on EVERY bid, including ones already sent.'
  );
}

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
function settingsPromptText(current, label, placeholder, node, required, apply) {
  promptText(current, {
    label,
    placeholder,
    multiline: required === 'multiline',
    done: (text) => {
      if (required === true && !text) {
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
      settingsPromptText(co[key], label, placeholder, line, required, (text) => {
        const prev = co[key];
        co[key] = text;
        settingsSaveAndRender(() => { co[key] = prev; });
      });
    });
  });

  box.appendChild(fieldLabel('Proposal style'));
  box.appendChild(toggleRow([[false, 'Blue & logo'], [true, 'Plain black']], co.plainStyle, (v) => {
    if (v === co.plainStyle) return;
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
// A wage is a live number: costStack looks his men up by id every time it
// figures a bid, so changing one re-figures every bid that man is on. Hiding
// him does not: the id stays in the file, an old bid keeps him and keeps
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
    + 'He just stops showing up on new ones.'));
  return box;
}

function buildSetCrewRow(box, c) {
  const key = 'crew:' + c.id;
  const line = settingRow(box, c.name || 'Worker', moneyText(c.wageCents) + '/hr',
    () => settingsToggleMenu(key));
  if (c.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  box.appendChild(settingActions([
    ['Name', '', () => {
      settingsPromptText(c.name, 'Name', 'Shawn', line, true, (text) => {
        const prev = c.name;
        c.name = text;
        settingsSaveAndRender(() => { c.name = prev; });
      });
    }],
    ['Wage', '', async () => {
      const ok = await settingsConfirmCost('what ' + (c.name || 'he') + ' is paid');
      if (!ok) { render(); return; }
      promptMoney(c.wageCents, {
        label: (c.name || 'Worker') + ' — paid an hour',
        done: (cents) => {
          if (cents === null) return;
          const prev = c.wageCents;
          c.wageCents = cents;
          settingsSaveAndRender(() => { c.wageCents = prev; });
        },
      });
    }],
    [c.hidden ? 'Unhide' : 'Hide', c.hidden ? '' : 'btn-danger-outline', () => {
      const prev = c.hidden;
      c.hidden = !prev;
      settingsMenu = null;
      settingsSaveAndRender(() => { c.hidden = prev; });
    }],
  ]));
}

function settingsAddCrew() {
  promptText('', {
    label: 'Name',
    placeholder: 'Shawn',
    done: (name) => {
      if (!name) return;
      promptMoney(null, {
        label: name + ' — paid an hour',
        done: (cents) => {
          const person = { id: Store.uid(), name, wageCents: cents === null ? 0 : cents, hidden: false };
          const s = setS();
          s.crew.push(person);
          settingsSaveAndRender(() => {
            const i = s.crew.indexOf(person);
            if (i !== -1) s.crew.splice(i, 1);
          });
        },
      });
    },
  });
}

// ---------------------------------------------------------------------------
// RATES
// ---------------------------------------------------------------------------
// Every row here carries its reach in its caption, in his words, and the five
// that reach backwards ask before they move. See the header comment for how
// each claim was checked against costStack and Store.newBid.

function buildSetRates() {
  const s = setS();
  const box = card('Rates & percentages');

  const hpd = settingRow(box, 'Hours per day', numText(s.hoursPerDay) + (s.hoursPerDay === 1 ? ' hour' : ' hours'),
    async () => {
      const ok = await settingsConfirmHours();
      if (!ok) { render(); return; }
      settingsPromptWhole(s.hoursPerDay, 'Hours in a work day', hpd, SET_HPD_MIN, SET_HPD_MAX,
        'A work day is between ' + SET_HPD_MIN + ' and ' + SET_HPD_MAX + ' whole hours',
        (v) => {
          const prev = s.hoursPerDay;
          s.hoursPerDay = v;
          settingsSaveAndRender(() => { s.hoursPerDay = prev; });
        });
    },
    'How long a work day is. Days times this is hours. Changes the hours and the price on every bid, sent ones too.');

  settingsPctRow(box, s, 'burdenPct', 'Payroll burden', 'payroll burden',
    'Taxes, workers comp, and insurance on top of a wage. Changes what every bid costs, sent ones too. Prices stay.');

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

  settingsPctRow(box, s, 'marginPct', 'Default margin', null,
    'What a new bid aims for. New bids only.');

  settingsPctRow(box, s, 'markupPct', 'Material markup', null,
    'What you add to what the material cost you. New bids only.');

  settingsPctRow(box, s, 'consumablesPct', 'Consumables', 'consumables',
    'Tape, wire nuts, straps, bits, blades. A share of material cost. Changes what every bid costs, sent ones too. Prices stay.');

  settingRow(box, 'Truck & gas', moneyText(s.truckDayCents) + '/day', async () => {
    const ok = await settingsConfirmCost('the truck day rate');
    if (!ok) { render(); return; }
    promptMoney(s.truckDayCents, {
      label: 'Truck and gas a day, every bid',
      done: (cents) => {
        if (cents === null) return;
        const prev = s.truckDayCents;
        s.truckDayCents = cents;
        settingsSaveAndRender(() => { s.truckDayCents = prev; });
      },
    });
  }, 'What the truck costs you for a day on the job. Changes what every bid costs, sent ones too. Prices stay.');

  settingsPctRow(box, s, 'overheadPct', 'Overhead', 'overhead',
    'Insurance, shop, phones, Jack, spread over every job. Changes what every bid costs, sent ones too. Prices stay.');

  settingsCushionRow(box, s, 'service', 'Cushion, service call',
    'Extra hours you quote on a service call and hope not to work. New bids only.');
  settingsCushionRow(box, s, 'project', 'Cushion, project',
    'Extra hours you quote on a project and hope not to work. New bids only.');

  settingsPctRow(box, s, 'equipmentPct', 'Equipment', null,
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

  return box;
}

// The seven plain percentages. confirmWhat is what the far-reach question
// calls this number, or null for the ones a new bid takes a copy of.
function settingsPctRow(box, s, key, label, confirmWhat, captionText) {
  const line = settingRow(box, label, pctText(s[key]), async () => {
    if (confirmWhat) {
      const ok = await settingsConfirmCost(confirmWhat);
      if (!ok) { render(); return; }
    }
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
// rounded to the nearest $5, unless he has typed an override — worked out by
// ui.js equipmentDayCents so the picker on the price screen, the walk, and
// this list all quote the same tool at the same number.
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
    + ' of what it cost new, to the nearest $5, unless you set your own rate.'));
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
      settingsPromptText(e.name, 'Name', 'Threader', line, true, (text) => {
        const prev = e.name;
        e.name = text;
        settingsSaveAndRender(() => { e.name = prev; });
      });
    }],
    ['Cost new', '', () => {
      promptMoney(e.costCents, {
        label: (e.name || 'Tool') + ' — what it cost new',
        done: (cents) => {
          const prev = e.costCents;
          e.costCents = cents;   // Clear means "I don't know", which is a real answer
          settingsSaveAndRender(() => { e.costCents = prev; });
        },
      });
    }],
    [e.overrideDayCents == null ? 'Set day rate' : 'Change day rate', '', () => {
      promptMoney(e.overrideDayCents, {
        label: (e.name || 'Tool') + ' — your own day rate',
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

  buttons.push([e.hidden ? 'Unhide' : 'Hide', e.hidden ? '' : 'btn-danger-outline', () => {
    const prev = e.hidden;
    e.hidden = !prev;
    settingsMenu = null;
    settingsSaveAndRender(() => { e.hidden = prev; });
  }]);

  box.appendChild(settingActions(buttons));
}

function settingsAddTool() {
  promptText('', {
    label: 'Tool',
    placeholder: 'Threader',
    done: (name) => {
      if (!name) return;
      promptMoney(null, {
        label: name + ' — what it cost new',
        done: (cents) => {
          const tool = { id: Store.uid(), name, costCents: cents, overrideDayCents: null, hidden: false };
          const s = setS();
          s.equipment.push(tool);
          settingsSaveAndRender(() => {
            const i = s.equipment.indexOf(tool);
            if (i !== -1) s.equipment.splice(i, 1);
          });
        },
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

  box.appendChild(caption(c.text));
  box.appendChild(settingActions([
    ['Title', '', () => {
      settingsPromptText(c.title, 'Clause title', 'Payment', line, true, (text) => {
        const prev = c.title;
        c.title = text;
        settingsSaveAndRender(() => { c.title = prev; });
      });
    }],
    ['Wording', '', () => {
      settingsPromptText(c.text, 'Clause wording', '', line, 'multiline', (text) => {
        const prev = c.text;
        c.text = text;
        settingsSaveAndRender(() => { c.text = prev; });
      });
    }],
    [c.hidden ? 'Unhide' : 'Hide', c.hidden ? '' : 'btn-danger-outline', () => {
      const prev = c.hidden;
      c.hidden = !prev;
      settingsMenu = null;
      settingsSaveAndRender(() => { c.hidden = prev; });
    }],
  ]));
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
  box.appendChild(caption('New parts get added from the walk. Hiding one takes it off the walk '
    + 'and leaves it on the bids that already use it.'));
  return box;
}

function buildSetCatalogRow(box, p) {
  const key = 'part:' + p.id;
  const line = settingRow(box, p.name || 'Part', p.unit || '—', () => settingsToggleMenu(key));
  if (p.hidden) line.classList.add('set-hidden');

  if (!settingsMenuOpen(key)) return;

  box.appendChild(fieldLabel('How it is counted'));
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
  box.appendChild(units);

  box.appendChild(settingActions([
    ['Rename', '', () => {
      settingsPromptText(p.name, 'Part name', '3/4" EMT', line, true, (text) => {
        const prev = p.name;
        p.name = text;
        settingsSaveAndRender(() => { p.name = prev; });
      });
    }],
    [p.hidden ? 'Unhide' : 'Hide', p.hidden ? '' : 'btn-danger-outline', () => {
      const prev = p.hidden;
      p.hidden = !prev;
      settingsMenu = null;
      settingsSaveAndRender(() => { p.hidden = prev; });
    }],
  ]));
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
  }, 'The number the next new bid gets. It counts up on its own after that.');

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
  box.appendChild(row('PIN', state.data.pin === null ? 'Not set yet' : '••••'));
  box.appendChild(textButton('Change PIN', 'btn btn-block mt-3', startPinChange));

  if (state.data.pin !== null) {
    box.appendChild(textButton('Remove PIN', 'btn btn-danger-outline btn-block mt-3', async () => {
      const ok = await confirmPanel('Remove the PIN? The next time you open the app it will ask you '
        + 'to pick a new one.', { ok: 'Remove', danger: true });
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

function buildSetBackup() {
  const box = card('Backup');
  box.appendChild(caption('Coming in the next update.'));
  return box;
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

function renderSettings() {
  const host = el('settingsContent');
  host.textContent = '';

  host.appendChild(buildSetCompany());
  host.appendChild(buildSetCrew());
  host.appendChild(buildSetRates());
  host.appendChild(buildSetEquipment());
  host.appendChild(buildSetForget());
  host.appendChild(buildSetNotePhrases());
  host.appendChild(buildSetTerms());
  host.appendChild(buildSetCatalog());
  host.appendChild(buildSetCounter());
  host.appendChild(buildSetLock());
  host.appendChild(buildSetReports());
  host.appendChild(buildSetBackup());
}

registerScreen('settings', {
  id: 'screen-settings', title: 'Settings', back: null, tab: 'settings',
  enter: enterSettings, render: renderSettings,
});
