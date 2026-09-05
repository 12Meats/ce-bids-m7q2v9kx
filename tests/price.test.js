'use strict';

// tests/price.test.js — bringing an old bid onto today's Settings.
//
// A bid is figured once and never re-figured behind him: every number that
// feeds a price is copied onto the bid the day it is written. The exception is
// the one this file is about, and it is the only place in the app where a
// deliberate tap changes what a bid costs, so the sentence it shows and the
// fields it writes are both asserted here.
//
// The bug: a bid written before the snapshot rule carries NONE of the five
// cost fields and no wage map at all. It reads Settings for every one of them
// and keeps reading Settings forever, so raising the truck rate next month
// silently re-prices a quote he sent in August. Nothing on that bid DIFFERED
// from Settings, so the old rule never offered him the button — the one bid
// that most needed pinning down was the one bid that could not be.
//
// screens/price.js is browser code loaded as globals, so it runs in a VM with
// the handful of globals it touches, the same trick proposal.test.js and
// reports.test.js use.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../dates.js');

const state = { data: null, bidId: null };
let saved = true;                 // what persistOr is told the disk did
let answer = true;                // what he taps on the confirm
let confirmText = null;           // what the confirm asked him
let banner = null;

const sandbox = {
  console,
  document: undefined,
  state,
  Store: S,
  BidMath: B,
  Dates: D,
  Catalog: require('../catalog.js'),
  DocModel: require('../docmodel.js'),
  registerScreen: () => {},
  render: () => {},
  persistOr: (revert) => { if (!saved) { revert(); return false; } return true; },
  showBanner: (text) => { banner = text; },
  confirmPanel: async (text) => { confirmText = text; return answer; },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
// ui.js first: moneyText, numText and pctText are the vocabulary the confirm
// is written in, and testing against a stub of them would test the stub.
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'price.js'), 'utf8'), sandbox,
  { filename: 'price.js' });

const { priceSettingsMoves, priceUseSettings, priceUseSettingsText, priceBidCrewIds } = sandbox;

function fixture() {
  const d = S.emptyData();
  state.data = d;
  const bid = S.newBid(d, { customerName: 'UDA', title: 'Cooler room', jobType: 'project' });
  bid.labor.days = 2;
  d.bids.push(bid);
  state.bidId = bid.id;
  saved = true; answer = true; confirmText = null; banner = null;
  return { d, bid };
}

// A bid off his phone before any of this existed: no snapshot fields, no wage
// map. This is fixture v2's #3055, in the shape that matters.
function legacy() {
  const { d, bid } = fixture();
  bid.pricing = { marginPct: 25, rateCents: 8500, cushionPct: 15, markupPct: 18 };
  delete bid.labor.wageCents;
  return { d, bid };
}

const moveKeys = (bid, d) => Array.from(priceSettingsMoves(bid, d.settings), (m) => m.kind + ':' + m.key);

// ---------------------------------------------------------------------------
// What the link is offered for
// ---------------------------------------------------------------------------

test('a bid already on today Settings is offered nothing', () => {
  const { d, bid } = fixture();
  assert.deepStrictEqual(moveKeys(bid, d), []);
});

test('a legacy bid with no snapshot at all is offered every field and every wage', () => {
  const { d, bid } = legacy();
  assert.deepStrictEqual(moveKeys(bid, d),
    ['freeze:hoursPerDay', 'freeze:burdenPct', 'freeze:consumablesPct', 'freeze:truckDayCents',
      'freeze:overheadPct', 'freeze:c1', 'freeze:c2']);
});

test('an absent field is offered even when Settings says the very same number', () => {
  const { d, bid } = fixture();
  delete bid.pricing.overheadPct;
  assert.deepStrictEqual(moveKeys(bid, d), ['freeze:overheadPct']);
  // It prices identically either way today. What it does not do is stay that
  // way, and that is what the link is for.
  assert.strictEqual(B.bidSetting(bid, d.settings, 'overheadPct'), d.settings.overheadPct);
});

test('a field that differs is named with its old value and its new one', () => {
  const { d, bid } = fixture();
  bid.pricing.burdenPct = 20;
  bid.pricing.truckDayCents = 8000;
  const moves = priceSettingsMoves(bid, d.settings);
  assert.deepStrictEqual(Array.from(moves, (m) => m.text),
    ['Burden 20% to 25%', 'Truck & gas $80.00 to $95.00']);
});

test('a wage that moved is named man by man, and one Settings has forgotten is left alone', () => {
  const { d, bid } = fixture();
  d.settings.crew[0].wageCents = 3400;
  d.settings.crew.splice(1, 1);               // George has left the shop
  const moves = priceSettingsMoves(bid, d.settings);
  assert.deepStrictEqual(Array.from(moves, (m) => m.text),
    ['Shawn $32.00 to $34.00 an hour']);
});

// ---------------------------------------------------------------------------
// Every crew id the bid pays
// ---------------------------------------------------------------------------

test('priceBidCrewIds walks the labor line, its tasks and every change order', () => {
  const { d, bid } = fixture();
  d.settings.crew.push({ id: 'c3', name: 'Ruben', wageCents: 2800, hidden: false });
  d.settings.crew.push({ id: 'c4', name: 'Manny', wageCents: 2600, hidden: false });
  bid.labor.tasks = [{ name: 'Rough-in', crewIds: ['c1', 'c3'], days: 1 }];
  bid.job = S.newJob();
  bid.job.changeOrders.push({ id: 'co1', name: 'Extra pad', areas: [], labor: { crewIds: ['c4'], days: 1, tasks: null } });
  assert.deepStrictEqual(Array.from(priceBidCrewIds(bid)).sort(), ['c1', 'c2', 'c3', 'c4']);
});

// ---------------------------------------------------------------------------
// The sentence
// ---------------------------------------------------------------------------

test('the confirm lists what moves, and says what freezing is when it is filling blanks', () => {
  assert.strictEqual(priceUseSettingsText([{ kind: 'pricing', key: 'burdenPct', text: 'Burden 20% to 25%' }]),
    "Use today's Settings on this bid? Burden 20% to 25%.");
  assert.strictEqual(priceUseSettingsText([
    { kind: 'pricing', key: 'burdenPct', text: 'Burden 20% to 25%' },
    { kind: 'freeze', key: 'overheadPct' },
  ]), "Use today's Settings on this bid? Burden 20% to 25%, and freezes this bid at today's Settings.");
  assert.strictEqual(priceUseSettingsText([{ kind: 'freeze', key: 'overheadPct' }]),
    "Use today's Settings on this bid? Nothing moves, and freezes this bid at today's Settings.");
});

// ---------------------------------------------------------------------------
// What the tap writes
// ---------------------------------------------------------------------------

test('using Settings on a legacy bid writes all five fields and a wage for every man on it', async () => {
  const { d, bid } = legacy();
  d.settings.crew.push({ id: 'c3', name: 'Ruben', wageCents: 2800, hidden: false });
  bid.labor.tasks = [{ name: 'Rough-in', crewIds: ['c1', 'c3'], days: 1 }];
  bid.job = S.newJob();
  bid.job.changeOrders.push({ id: 'co1', name: 'Extra pad', areas: [], labor: { crewIds: ['c2'], days: 1, tasks: null } });

  await priceUseSettings(bid, priceSettingsMoves(bid, d.settings));

  assert.match(confirmText, /freezes this bid at today's Settings\.$/);
  B.SNAPSHOT_KEYS.forEach((key) => {
    assert.strictEqual(bid.pricing[key], d.settings[key], key + ' was not written');
  });
  assert.deepStrictEqual(Object.assign({}, bid.labor.wageCents), { c1: 3200, c2: 3000, c3: 2800 });
  assert.strictEqual(banner, 'This bid is on your Settings numbers now');
  // And it is frozen: nothing is offered a second time.
  assert.deepStrictEqual(moveKeys(bid, d), []);
  // A raise tomorrow now leaves it alone, which is the whole point.
  d.settings.burdenPct = 40;
  assert.strictEqual(B.bidSetting(bid, d.settings, 'burdenPct'), 25);
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('a refused save puts the bid back exactly as it was, wage map included', async () => {
  const { d, bid } = legacy();
  const before = JSON.stringify(bid);
  saved = false;
  await priceUseSettings(bid, priceSettingsMoves(bid, d.settings));
  assert.strictEqual(JSON.stringify(bid), before, 'a refused save may not leave half a snapshot');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(bid.labor, 'wageCents'), false);
});

test('saying no writes nothing', async () => {
  const { d, bid } = legacy();
  answer = false;
  await priceUseSettings(bid, priceSettingsMoves(bid, d.settings));
  assert.strictEqual(bid.pricing.overheadPct, undefined);
  assert.strictEqual(banner, null);
});
