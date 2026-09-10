const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');

// A bid with content in every section (areas/items, labor+tasks, rentals,
// equipment, pricing, and a full job block) so the table-driven negative
// test below can mutate one field per section.
function buildFullData() {
  const d = S.emptyData(); d.settings.nextNumber = 100;
  const b = S.newBid(d, { customerName: 'UDA', title: 'Full', jobType: 'project' });
  b.areas.push({ id: 'a1', name: 'Area', items: [{ catalogId: null, name: 'Item', unit: 'ft', qty: 2, costCents: 100, priceCents: 150 }], photoIds: [] });
  b.rentals.push({ name: 'Lift', days: 1, cents: 1000, markup: true });
  b.equipment.push({ equipmentId: d.settings.equipment[0].id, name: d.settings.equipment[0].name, days: 1, dayCents: 500 });
  b.job = {
    weeks: [{ weekISO: '2026-09-07', hours: 40 }],
    surprises: [{ cents: 500, note: 'extra', at: '2026-09-08' }],
    changeOrders: [{ id: 'co1', name: 'CO1', areas: [{ id: 'coa1', name: 'CO area', items: [], photoIds: [] }],
      labor: { crewIds: [], days: 1, tasks: null }, priceCents: 10000 }],
    completedAt: null,
  };
  d.bids.push(b);
  return { d, b };
}

function makeStorageStub() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

test('emptyData has version 1, seeded settings, seeded catalog with null costs', () => {
  const d = S.emptyData();
  assert.strictEqual(d.version, 1);
  assert.strictEqual(d.settings.company.roc, 'AZ ROC #276507');
  assert.strictEqual(d.settings.rateCents, 8500);
  assert.strictEqual(d.settings.floorCents, 8500);
  // The exact count, not a range. A seed list that quietly loses a family
  // still passes "about two hundred", and losing a family is the whole bug
  // the size-complete list was written to fix.
  assert.strictEqual(d.catalog.length, 210);
  assert.ok(d.catalog.every((p) => p.lastCostCents === null && p.uses === 0));
  // The second price a part remembers. Null on a seed, like the first one.
  assert.ok(d.catalog.every((p) => p.lastListCents === null));
  // 15, not 18: he already bills the highest list price among his suppliers
  // for a part, so 15 on top of that is the fair number (Adrian, 9/06).
  assert.strictEqual(d.settings.markupPct, 15);
  assert.deepStrictEqual([...new Set(d.catalog.map((p) => p.category))].sort(),
    ['boxes', 'conduit', 'gear', 'lighting', 'rentals', 'wire']);
  assert.strictEqual(d.settings.equipment.length, 30);
  assert.strictEqual(d.settings.forgetList.length, 19);
  assert.strictEqual(d.settings.notePhrases.length, 14);
  // Eight on his own paper, and the subcontract language kept in its own group.
  assert.strictEqual(d.settings.clauses.length, 27);
  assert.strictEqual(d.settings.clauses.filter((c) => c.group === 'always').length, 8);
  assert.strictEqual(d.settings.clauses.filter((c) => c.group === 'gc').length, 12);
  // One, not a guess at where his paper book left off.
  assert.strictEqual(d.settings.nextNumber, 1);
});
test('a fresh install hands the first new bid #1 and counts up from there', () => {
  const d = S.emptyData();
  const first = S.newBid(d, { customerName: 'UDA', title: 'One', jobType: 'service' });
  const second = S.newBid(d, { customerName: 'UDA', title: 'Two', jobType: 'service' });
  assert.strictEqual(first.number, 1);
  assert.strictEqual(second.number, 2);
  assert.strictEqual(d.settings.nextNumber, 3);
});
test('jobIsEmpty: true for a job with nothing logged, false once anything is', () => {
  // No job block at all: a Won with nothing under it has nothing to lose.
  assert.strictEqual(S.jobIsEmpty(null), true);
  assert.strictEqual(S.jobIsEmpty(undefined), true);
  // The block a bid gets the moment it is Won.
  assert.strictEqual(S.jobIsEmpty(S.newJob()), true);

  // One entry of any kind is enough to make it not empty.
  const withWeek = S.newJob(); withWeek.weeks.push({ weekISO: '2026-09-07', hours: 40 });
  assert.strictEqual(S.jobIsEmpty(withWeek), false);

  const withSurprise = S.newJob(); withSurprise.surprises.push({ cents: 500, note: 'extra', at: '2026-09-08' });
  assert.strictEqual(S.jobIsEmpty(withSurprise), false);

  const withCO = S.newJob(); withCO.changeOrders.push(S.newChangeOrder(S.emptyData(), 'CO1'));
  assert.strictEqual(S.jobIsEmpty(withCO), false);

  // Finished counts as logged even when the job is otherwise bare.
  const done = S.newJob(); done.completedAt = '2026-09-30';
  assert.strictEqual(S.jobIsEmpty(done), false);

  // Zero hours is still a week he wrote down.
  const zeroWeek = S.newJob(); zeroWeek.weeks.push({ weekISO: '2026-09-07', hours: 0 });
  assert.strictEqual(S.jobIsEmpty(zeroWeek), false);

  // Not a job at all: refused rather than called bare.
  assert.strictEqual(S.jobIsEmpty('nope'), false);
  assert.strictEqual(S.jobIsEmpty(7), false);
});
test('validateImport: accepts emptyData round-trip; rejects garbage, wrong version, bad money', () => {
  const d = S.emptyData();
  assert.ok(S.validateImport(JSON.stringify(d)));
  assert.strictEqual(S.validateImport('not json'), null);
  assert.strictEqual(S.validateImport(JSON.stringify({ ...d, version: 2 })), null);
  const bad = JSON.parse(JSON.stringify(d)); bad.settings.rateCents = 65.5;
  assert.strictEqual(S.validateImport(JSON.stringify(bad)), null);
  const badPin = JSON.parse(JSON.stringify(d)); badPin.pin = '12';
  assert.strictEqual(S.validateImport(JSON.stringify(badPin)), null);
});
test('validateImport: bids must reference existing customers, catalog, crew; status enum enforced', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Test', jobType: 'service' });
  d.bids.push(b);
  assert.ok(S.validateImport(JSON.stringify(d)));
  const bad = JSON.parse(JSON.stringify(d)); bad.bids[0].status = 'maybe';
  assert.strictEqual(S.validateImport(JSON.stringify(bad)), null);
  const bad2 = JSON.parse(JSON.stringify(d)); bad2.bids[0].customerId = 'nope';
  assert.strictEqual(S.validateImport(JSON.stringify(bad2)), null);
  const bad3 = JSON.parse(JSON.stringify(d)); bad3.bids[0].labor.crewIds = ['ghost'];
  assert.strictEqual(S.validateImport(JSON.stringify(bad3)), null);
});
test('validateImport: clauseIds accepts null and [], rejects non-strings and unknown ids', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Test', jobType: 'project' });
  d.bids.push(b);
  // Both empties are legal: null is "not asked", [] is "he wants none".
  assert.ok(S.validateImport(JSON.stringify(d)));
  const none = JSON.parse(JSON.stringify(d)); none.bids[0].clauseIds = [];
  assert.ok(S.validateImport(JSON.stringify(none)));
  const some = JSON.parse(JSON.stringify(d)); some.bids[0].clauseIds = ['k01'];
  assert.ok(S.validateImport(JSON.stringify(some)));
  const num = JSON.parse(JSON.stringify(d)); num.bids[0].clauseIds = [7];
  assert.strictEqual(S.validateImport(JSON.stringify(num)), null);
  const nested = JSON.parse(JSON.stringify(d)); nested.bids[0].clauseIds = [['k01']];
  assert.strictEqual(S.validateImport(JSON.stringify(nested)), null);
  const ghost = JSON.parse(JSON.stringify(d)); ghost.bids[0].clauseIds = ['nope'];
  assert.strictEqual(S.validateImport(JSON.stringify(ghost)), null);
  const notList = JSON.parse(JSON.stringify(d)); notList.bids[0].clauseIds = 'k01';
  assert.strictEqual(S.validateImport(JSON.stringify(notList)), null);
});
test('newBid seeds the labor line from VISIBLE crew only', () => {
  const d = S.emptyData();
  assert.deepStrictEqual(S.newBid(d, { customerName: 'UDA', title: 'x', jobType: 'service' }).labor.crewIds,
    d.settings.crew.slice(0, 2).map((c) => c.id));
  // Retiring the first man must not put him on tomorrow's bids.
  d.settings.crew[0].hidden = true;
  assert.deepStrictEqual(S.newBid(d, { customerName: 'UDA', title: 'y', jobType: 'service' }).labor.crewIds,
    [d.settings.crew[1].id]);
});
test('newBid: takes the next number, increments the counter, creates the customer if new, copies pricing defaults', () => {
  const d = S.emptyData(); d.settings.nextNumber = 3052;
  const b = S.newBid(d, { customerName: 'UDA', title: 'Warehouse lights', jobType: 'service' });
  assert.strictEqual(b.number, 3052);
  assert.strictEqual(d.settings.nextNumber, 3053);
  assert.strictEqual(d.customers.length, 1);
  assert.strictEqual(b.customerId, d.customers[0].id);
  assert.strictEqual(b.pricing.cushionPct, 10);           // service
  assert.strictEqual(b.pricing.marginPct, 25);
  assert.strictEqual(b.misc.cents, 0);
  assert.strictEqual(b.status, 'draft');
  assert.strictEqual(b.scope, null);
  // null, not []: nobody has been asked about clauses yet. The proposal
  // screen seeds the Always group off exactly this, once.
  assert.strictEqual(b.clauseIds, null);
  const b2 = S.newBid(d, { customerName: 'uda', title: 'x', jobType: 'project' });
  assert.strictEqual(d.customers.length, 1);              // case-insensitive match
  assert.strictEqual(b2.pricing.cushionPct, 15);
});
// area.notes is the walk's own notebook: optional, so every bid written
// before the field still restores, and never printed, so nothing downstream
// has to strip it. The validator's job here is only to refuse a shape that
// would break a reader, not to require the field.
// The supply house search is the newest field on the document and the least
// important one on it: it decides where a link goes, and nothing else. So it
// is optional both ways round — a backup written before v2.1 has no such
// field, and a phone that has one must not be able to refuse the whole file
// over it.
test('validateImport: the supply house search is optional, and a string when present', () => {
  const d = S.emptyData();
  assert.strictEqual(d.settings.company.priceSearchUrl, 'https://www.google.com/search?tbm=shop&q={q}');
  assert.ok(S.validateImport(JSON.stringify(d)));

  const gone = JSON.parse(JSON.stringify(d));
  delete gone.settings.company.priceSearchUrl;
  assert.ok(S.validateImport(JSON.stringify(gone)), 'a v2 backup has no such field');

  const own = JSON.parse(JSON.stringify(d));
  own.settings.company.priceSearchUrl = 'https://supply.example.com/search?q={q}';
  assert.ok(S.validateImport(JSON.stringify(own)));

  const empty = JSON.parse(JSON.stringify(d));
  empty.settings.company.priceSearchUrl = '';
  assert.ok(S.validateImport(JSON.stringify(empty)));

  const bad = JSON.parse(JSON.stringify(d));
  bad.settings.company.priceSearchUrl = 42;
  assert.strictEqual(S.validateImport(JSON.stringify(bad)), null);
});

test('validateImport: area notes are optional, and a string when present', () => {
  const { d } = buildFullData();
  assert.ok(S.validateImport(JSON.stringify(d)));               // absent

  const withNote = JSON.parse(JSON.stringify(d));
  withNote.bids[0].areas[0].notes = 'Panel is behind the pallet racking.\nBring the 6 ft ladder.';
  withNote.bids[0].job.changeOrders[0].areas[0].notes = 'Moved eight feet, conduit stays.';
  assert.ok(S.validateImport(JSON.stringify(withNote)));        // a change order's areas too

  const empty = JSON.parse(JSON.stringify(d));
  empty.bids[0].areas[0].notes = '';
  assert.ok(S.validateImport(JSON.stringify(empty)));

  const bad = JSON.parse(JSON.stringify(d));
  bad.bids[0].areas[0].notes = 42;
  assert.strictEqual(S.validateImport(JSON.stringify(bad)), null);

  const badCo = JSON.parse(JSON.stringify(d));
  badCo.bids[0].job.changeOrders[0].areas[0].notes = { text: 'no' };
  assert.strictEqual(S.validateImport(JSON.stringify(badCo)), null);
});
// The walk's textarea stops at AREA_NOTES_MAX, so nothing the app writes can
// be longer. A hand-edited file can, and a field that has to preview on one
// row is not where a book belongs.
test('validateImport: an area note longer than the cap is refused', () => {
  const { d } = buildFullData();
  assert.strictEqual(typeof S.AREA_NOTES_MAX, 'number');

  const atCap = JSON.parse(JSON.stringify(d));
  atCap.bids[0].areas[0].notes = 'n'.repeat(S.AREA_NOTES_MAX);
  assert.ok(S.validateImport(JSON.stringify(atCap)));

  const overCap = JSON.parse(JSON.stringify(d));
  overCap.bids[0].areas[0].notes = 'n'.repeat(S.AREA_NOTES_MAX + 1);
  assert.strictEqual(S.validateImport(JSON.stringify(overCap)), null);

  const overCapCo = JSON.parse(JSON.stringify(d));
  overCapCo.bids[0].job.changeOrders[0].areas[0].notes = 'n'.repeat(S.AREA_NOTES_MAX + 1);
  assert.strictEqual(S.validateImport(JSON.stringify(overCapCo)), null);
});
test('duplicateBid: the area notes travel to the copy', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  b.areas.push({ id: 'a1', name: 'Mezz', items: [], photoIds: [], notes: 'Panel behind the racking.' });
  b.areas.push({ id: 'a2', name: 'Dock', items: [], photoIds: [] });
  d.bids.push(b);
  const c = S.duplicateBid(d, b.id, '2026-09-20');
  // The same building, walked again: what he wrote about the room is still
  // true, unlike the did-you-forget answers, which are about the job.
  assert.strictEqual(c.areas[0].notes, 'Panel behind the racking.');
  assert.strictEqual('notes' in c.areas[1], false);
});
test('duplicateBid: copies content, fresh number/date/status, no job data or sent flags', () => {
  const d = S.emptyData(); d.settings.nextNumber = 10;
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  b.areas.push({ id: 'a', name: 'Mezz', items: [{ catalogId: null, name: 'x', unit: 'ft', qty: 1, costCents: 100, priceCents: null }], photoIds: ['ph1'] });
  b.status = 'won'; b.sentAt = '2026-09-01'; b.job = { weeks: [{ weekISO: '2026-09-07', hours: 10 }], surprises: [], changeOrders: [], completedAt: null };
  d.bids.push(b);
  const c = S.duplicateBid(d, b.id, '2026-09-20');
  assert.strictEqual(c.number, 11);
  assert.strictEqual(c.status, 'draft');
  assert.strictEqual(c.sentAt, null);
  assert.strictEqual(c.job, null);
  assert.strictEqual(c.dateISO, '2026-09-20');
  assert.deepStrictEqual(c.areas[0].photoIds, []);        // photos are not copied
  assert.strictEqual(c.areas[0].items[0].costCents, 100);
  assert.notStrictEqual(c.id, b.id);
  // The answer copies with the bid: an untouched original stays unasked,
  // and a bid he ticked clauses on hands them to its duplicate.
  assert.strictEqual(c.clauseIds, null);
  b.clauseIds = ['k01'];
  assert.deepStrictEqual(S.duplicateBid(d, b.id, '2026-09-20').clauseIds, ['k01']);
});
// A walk rental remembers the room it was added from, and the copy re-ids
// every room. Left alone the copied rental still named the ORIGINAL's area:
// the room he added it in showed nothing, and the lift was only findable on
// the price screen — the exact bug the areaId was added to fix, reappearing on
// every duplicate.
test('duplicateBid: a walk rental follows its area to the copy', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  b.areas.push({ id: 'a1', name: 'Mezz', items: [], photoIds: [] });
  b.areas.push({ id: 'a2', name: 'Dock', items: [], photoIds: [] });
  b.rentals.push({ name: 'Scissor lift', days: 1, cents: 0, markup: false, areaId: 'a2' });
  b.rentals.push({ name: 'Dumpster', days: 2, cents: 0, markup: false });
  d.bids.push(b);

  const c = S.duplicateBid(d, b.id, '2026-09-20');
  assert.notStrictEqual(c.areas[1].id, 'a2');                 // the room is new
  assert.strictEqual(c.rentals[0].areaId, c.areas[1].id);     // and the lift is in it
  assert.strictEqual(c.rentals[0].areaId !== 'a2', true);
  assert.strictEqual('areaId' in c.rentals[1], false);        // an area-less one stays area-less
  // The original is untouched.
  assert.strictEqual(b.rentals[0].areaId, 'a2');
  assert.notStrictEqual(S.validateImport(JSON.stringify(d)), null);
});

// A rental pointing at an area that is not in the bid it was copied from has
// nothing to follow, so it loses the field rather than carrying a dead id that
// would show the line in whichever room happened to be given that id next.
test('duplicateBid: a rental with a dead areaId loses it', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  b.areas.push({ id: 'a1', name: 'Mezz', items: [], photoIds: [] });
  b.rentals.push({ name: 'Boom lift', days: 1, cents: 0, markup: false, areaId: 'gone' });
  d.bids.push(b);
  const c = S.duplicateBid(d, b.id, '2026-09-20');
  assert.strictEqual('areaId' in c.rentals[0], false);
});

// The did-you-forget answers go the way the job goes. A copy is a bid he has
// not walked yet: last month's "No, no permits" is an answer about a different
// building, and inheriting it hides the question on the one job where it costs.
test('duplicateBid: the did-you-forget answers do not travel to the copy', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  b.forgetAnswers = { Permits: 'no', 'Lift rental': 'added' };
  d.bids.push(b);
  const c = S.duplicateBid(d, b.id, '2026-09-20');
  assert.deepStrictEqual(c.forgetAnswers, {});
  // And the original keeps its own answers.
  assert.deepStrictEqual(b.forgetAnswers, { Permits: 'no', 'Lift rental': 'added' });
  // An empty map is a shape validateImport accepts, so the copy still saves.
  // duplicateBid already pushed it onto d.bids; pushing again is a duplicate id.
  assert.notStrictEqual(S.validateImport(JSON.stringify(d)), null);
});
test('recordCatalogUse: bumps uses and lastCost; addCatalogItem creates', () => {
  const d = S.emptyData();
  const p = S.addCatalogItem(d, { category: 'conduit', name: '1" rigid', unit: 'ft' });
  S.recordCatalogUse(d, p.id, 450);
  const got = d.catalog.find((x) => x.id === p.id);
  assert.strictEqual(got.uses, 1); assert.strictEqual(got.lastCostCents, 450);
});
test('mondayOf', () => {
  assert.strictEqual(S.mondayOf('2026-09-16'), '2026-09-14');   // Wed → Mon
  assert.strictEqual(S.mondayOf('2026-09-14'), '2026-09-14');
  assert.strictEqual(S.mondayOf('nope'), null);
});
test('validateImport: area id required and unique within a bid (and within a change order)', () => {
  const { d } = buildFullData();
  const base = JSON.stringify(d);
  const missing = JSON.parse(base); delete missing.bids[0].areas[0].id;
  assert.strictEqual(S.validateImport(JSON.stringify(missing)), null);
  const dup = JSON.parse(base); dup.bids[0].areas.push(JSON.parse(JSON.stringify(dup.bids[0].areas[0])));
  assert.strictEqual(S.validateImport(JSON.stringify(dup)), null);
  const dupCO = JSON.parse(base);
  dupCO.bids[0].job.changeOrders[0].areas.push(JSON.parse(JSON.stringify(dupCO.bids[0].job.changeOrders[0].areas[0])));
  assert.strictEqual(S.validateImport(JSON.stringify(dupCO)), null);
});
test('numberInUse: true when another bid holds the number, false against itself or an unused number', () => {
  const d = S.emptyData(); d.settings.nextNumber = 500;
  const b1 = S.newBid(d, { customerName: 'A', title: 'x', jobType: 'service' }); d.bids.push(b1);
  const b2 = S.newBid(d, { customerName: 'B', title: 'y', jobType: 'service' }); d.bids.push(b2);
  assert.strictEqual(S.numberInUse(d, b1.number, b2.id), true);
  assert.strictEqual(S.numberInUse(d, b1.number, b1.id), false);
  assert.strictEqual(S.numberInUse(d, 999999, null), false);
});
test('addCatalogItem: clamps category, coerces name/unit, rejects empty name', () => {
  const d = S.emptyData();
  const p = S.addCatalogItem(d, { category: 'not-a-category', name: 'Widget', unit: 'ea' });
  assert.strictEqual(p.category, 'gear');
  const empty = S.addCatalogItem(d, { category: 'conduit', name: '', unit: 'ft' });
  assert.strictEqual(empty, null);
});
test('addCatalogItem: a name typed on the phone is saved with straight quotes', () => {
  // iOS turns " into ” as he types it. Saved raw, the part he adds standing in
  // the plant is a part the search for 1" S.S. conduit never finds again.
  const d = S.emptyData();
  const p = S.addCatalogItem(d, { category: 'conduit', name: ' 1” S.S.  conduit ', unit: 'ft' });
  assert.strictEqual(p.name, '1" S.S. conduit');
  // Capitals are his and are left exactly as typed.
  assert.strictEqual(S.addCatalogItem(d, { category: 'gear', name: 'VFD ’24', unit: 'ea' }).name, "VFD '24");
  // Whitespace alone is still not a name.
  assert.strictEqual(S.addCatalogItem(d, { category: 'conduit', name: '   ', unit: 'ft' }), null);
});
test('newTool: builds a full equipment entry, pushes it, and the document still validates', () => {
  const d = S.emptyData();
  const before = d.settings.equipment.length;
  const t = S.newTool(d, '  Bender  ', 24999);
  assert.strictEqual(t.name, 'Bender');                   // trimmed
  assert.strictEqual(t.costCents, 24999);
  assert.strictEqual(t.overrideDayCents, null);
  assert.strictEqual(t.hidden, false);
  assert.ok(typeof t.id === 'string' && t.id !== '');
  assert.strictEqual(d.settings.equipment.length, before + 1);
  assert.strictEqual(d.settings.equipment[before], t);
  assert.strictEqual(S.check(d), true);
});
test('newTool: refuses an empty name or a cost that is not real money, and pushes nothing', () => {
  const d = S.emptyData();
  const before = d.settings.equipment.length;
  for (const [name, cost] of [['', 5000], ['   ', 5000], [null, 5000],
    ['Bender', null], ['Bender', 0], ['Bender', -100], ['Bender', 249.99], ['Bender', undefined]]) {
    assert.strictEqual(S.newTool(d, name, cost), null, String(name) + '/' + String(cost));
  }
  assert.strictEqual(d.settings.equipment.length, before);
});
// ---------------------------------------------------------------------------
// The did-you-forget answers
// ---------------------------------------------------------------------------

test('newBid starts with no did-you-forget answers, and the field validates', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'x', jobType: 'service' });
  assert.deepStrictEqual(b.forgetAnswers, {});
  d.bids.push(b);
  assert.strictEqual(S.check(d), true);
});

test('forgetAnswers accepts no/added, refuses anything else, and is optional', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'x', jobType: 'service' });
  d.bids.push(b);

  b.forgetAnswers = { Permits: 'no', 'Lift rental': 'added' };
  assert.strictEqual(S.check(d), true);

  // A key for a row he has since renamed in Settings is an answer to a
  // question he no longer asks, not a broken document.
  b.forgetAnswers = { 'A row that no longer exists': 'no' };
  assert.strictEqual(S.check(d), true);

  for (const bad of ['yes', true, 1, null, {}, ['no']]) {
    b.forgetAnswers = { Permits: bad };
    assert.strictEqual(S.check(d), false, 'accepted ' + JSON.stringify(bad));
  }
  b.forgetAnswers = [];
  assert.strictEqual(S.check(d), false);

  // Absent is the shape every backup written before this field has.
  delete b.forgetAnswers;
  assert.strictEqual(S.check(d), true);
  b.forgetAnswers = null;
  assert.strictEqual(S.check(d), true);
});

test('check: mirrors validateImport as a boolean', () => {
  const d = S.emptyData();
  assert.strictEqual(S.check(d), true);
  const bad = JSON.parse(JSON.stringify(d)); bad.settings.rateCents = 65.5;
  assert.strictEqual(S.check(bad), false);
});
// settings.pdfsSentThroughMs is the PDF watermark, and it is OPTIONAL on
// purpose: it shipped after the first backups did, and a file written before
// it existed has to restore without a document version bump. Absent reads the
// same as null — nothing has gone yet, so every PDF is pending.
test('validateImport: pdfsSentThroughMs absent (an old backup file) still restores', () => {
  const d = S.emptyData();
  delete d.settings.pdfsSentThroughMs;
  const back = S.validateImport(JSON.stringify(d));
  assert.notStrictEqual(back, null);
  assert.strictEqual(back.settings.pdfsSentThroughMs, undefined);
});
test('validateImport: pdfsSentThroughMs null is accepted', () => {
  const d = S.emptyData();
  assert.strictEqual(d.settings.pdfsSentThroughMs, null);
  assert.notStrictEqual(S.validateImport(JSON.stringify(d)), null);
});
test('validateImport: pdfsSentThroughMs takes an epoch stamp and refuses a non-integer one', () => {
  const d = S.emptyData();
  d.settings.pdfsSentThroughMs = 1757000000000;
  const back = S.validateImport(JSON.stringify(d));
  assert.strictEqual(back.settings.pdfsSentThroughMs, 1757000000000);
  [-1, 1.5, '1757000000000', true].forEach((v) => {
    const bad = S.emptyData();
    bad.settings.pdfsSentThroughMs = v;
    assert.strictEqual(S.validateImport(JSON.stringify(bad)), null, String(v));
  });
});
test('validateImport: table-driven negative mutations across every section reject', () => {
  const { d } = buildFullData();
  const base = JSON.stringify(d);
  const cases = [
    ['settings.burdenPct out of range', (dd) => { dd.settings.burdenPct = 150; }],
    ['settings.taxMode invalid enum', (dd) => { dd.settings.taxMode = 'weird'; }],
    ['catalog.uses negative', (dd) => { dd.catalog[0].uses = -1; }],
    ['catalog.hidden not boolean', (dd) => { dd.catalog[0].hidden = 'no'; }],
    ['customers.defaultDetail invalid enum', (dd) => { dd.customers[0].defaultDetail = 'bogus'; }],
    ['customers.email not string', (dd) => { dd.customers[0].email = 123; }],
    ['bids.validityDays negative', (dd) => { dd.bids[0].validityDays = -1; }],
    ['bids.dateISO bad format', (dd) => { dd.bids[0].dateISO = '09-01-2026'; }],
    ['areas duplicate id within bid', (dd) => { dd.bids[0].areas.push(JSON.parse(JSON.stringify(dd.bids[0].areas[0]))); }],
    ['items qty zero', (dd) => { dd.bids[0].areas[0].items[0].qty = 0; }],
    ['items catalogId unknown', (dd) => { dd.bids[0].areas[0].items[0].catalogId = 'ghost'; }],
    ['labor days negative', (dd) => { dd.bids[0].labor.days = -1; }],
    ['labor tasks unknown crewId', (dd) => { dd.bids[0].labor.tasks = [{ name: 'x', crewIds: ['ghost'], days: 1 }]; }],
    ['rentals markup not boolean', (dd) => { dd.bids[0].rentals[0].markup = 'yes'; }],
    ['rentals cents negative', (dd) => { dd.bids[0].rentals[0].cents = -5; }],
    ['equipment dayCents negative', (dd) => { dd.bids[0].equipment[0].dayCents = -1; }],
    ['equipment equipmentId unknown', (dd) => { dd.bids[0].equipment[0].equipmentId = 'ghost-equip'; }],
    ['pricing rateCents non-integer', (dd) => { dd.bids[0].pricing.rateCents = 65.5; }],
    ['pricing cushionPct not a number', (dd) => { dd.bids[0].pricing.cushionPct = 'nope'; }],
    ['job.weeks hours negative', (dd) => { dd.bids[0].job.weeks[0].hours = -1; }],
    ['job.weeks weekISO invalid', (dd) => { dd.bids[0].job.weeks[0].weekISO = 'nope'; }],
    ['job.surprises cents negative', (dd) => { dd.bids[0].job.surprises[0].cents = -1; }],
    ['job.surprises note not string', (dd) => { dd.bids[0].job.surprises[0].note = 5; }],
    ['job.changeOrders priceCents negative', (dd) => { dd.bids[0].job.changeOrders[0].priceCents = -1; }],
    ['job.changeOrders area id empty', (dd) => { dd.bids[0].job.changeOrders[0].areas[0].id = ''; }],
    ['job.changeOrders labor unknown crewId', (dd) => { dd.bids[0].job.changeOrders[0].labor.crewIds = ['ghost']; }],
    ['job.changeOrders duplicate id within a bid', (dd) => { dd.bids[0].job.changeOrders.push(JSON.parse(JSON.stringify(dd.bids[0].job.changeOrders[0]))); }],
    ['job.changeOrders id empty', (dd) => { dd.bids[0].job.changeOrders[0].id = ''; }],
  ];
  assert.ok(cases.length >= 15, 'expected at least 15 mutation cases');
  for (const [desc, mutate] of cases) {
    const dd = JSON.parse(base);
    mutate(dd);
    assert.strictEqual(S.validateImport(JSON.stringify(dd)), null, desc);
  }
});
test('save/load round-trip through a localStorage stub', () => {
  const stub = makeStorageStub();
  globalThis.localStorage = stub;
  try {
    const d = S.emptyData();
    assert.strictEqual(S.save(d), true);
    const loaded = S.load();
    assert.deepStrictEqual(loaded, d);
    assert.strictEqual(S.loadProblem(), null);
  } finally {
    delete globalThis.localStorage;
  }
});
test('save rejects an invalid document without writing', () => {
  const stub = makeStorageStub();
  globalThis.localStorage = stub;
  try {
    const d = S.emptyData();
    assert.strictEqual(S.save(d), true);
    const before = stub.getItem(S.KEY);
    const bad = JSON.parse(JSON.stringify(d)); bad.settings.rateCents = 65.5;
    assert.strictEqual(S.save(bad), false);
    assert.strictEqual(stub.getItem(S.KEY), before);
  } finally {
    delete globalThis.localStorage;
  }
});
test('load of corrupt text stashes the raw value and reports loadProblem "corrupt"', () => {
  const stub = makeStorageStub();
  globalThis.localStorage = stub;
  try {
    stub.setItem(S.KEY, 'not valid json {{{');
    const loaded = S.load();
    assert.strictEqual(loaded.version, 1);
    assert.deepStrictEqual(loaded.bids, []);
    assert.strictEqual(S.loadProblem(), 'corrupt');
    const stashKeys = [...stub._store.keys()].filter((k) => k.startsWith(S.KEY + '-corrupt-'));
    assert.strictEqual(stashKeys.length, 1);
    assert.strictEqual(stub.getItem(stashKeys[0]), 'not valid json {{{');
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------------------------------------------------------------------------
// WHAT IS STILL POINTED AT
// ---------------------------------------------------------------------------
// The four questions Settings asks before it offers a real Delete. Each one
// counts BIDS, not references: the caption says "On 2 bids", and a tool on
// three lines of one bid is still one bid.

test('equipmentInUse counts the bids whose lines point at a tool, and nothing else', () => {
  const { d } = buildFullData();
  const used = d.settings.equipment[0];
  const spare = d.settings.equipment[1];
  assert.strictEqual(S.equipmentInUse(d, used.id), 1);
  assert.strictEqual(S.equipmentInUse(d, spare.id), 0);
  assert.strictEqual(S.equipmentInUse(d, 'nobody'), 0);
});

test('equipmentInUse counts each bid once however many lines it has', () => {
  const { d, b } = buildFullData();
  const used = d.settings.equipment[0];
  b.equipment.push({ equipmentId: used.id, name: used.name, days: 2, dayCents: 500 });
  assert.strictEqual(S.equipmentInUse(d, used.id), 1);
});

test('crewInUse sees the bid line, a task, and a change order', () => {
  const d = S.emptyData();
  const [shawn, george] = d.settings.crew;
  const third = { id: 'c3', name: 'Ray', wageCents: 3000, hidden: false };
  const fourth = { id: 'c4', name: 'Nobody', wageCents: 3000, hidden: false };
  d.settings.crew.push(third, fourth);

  const b = S.newBid(d, { customerName: 'UDA', title: 'Crew', jobType: 'project' });
  b.labor = { crewIds: [shawn.id], days: 1, tasks: [{ name: 'T', crewIds: [george.id], days: 1 }] };
  b.job = S.newJob();
  b.job.changeOrders.push({ id: 'co1', name: 'CO', areas: [],
    labor: { crewIds: [third.id], days: 1, tasks: null } });
  d.bids.push(b);

  assert.strictEqual(S.crewInUse(d, shawn.id), 1);
  assert.strictEqual(S.crewInUse(d, george.id), 1, 'a crew id on a task counts');
  assert.strictEqual(S.crewInUse(d, third.id), 1, "a change order's crew counts");
  assert.strictEqual(S.crewInUse(d, fourth.id), 0);
});

test('catalogInUse sees an item in the bid and one in a change order area', () => {
  const d = S.emptyData();
  const part = d.catalog[0];
  const other = d.catalog[1];
  const spare = d.catalog[2];
  const item = (p) => ({ catalogId: p.id, name: p.name, unit: p.unit, qty: 1, costCents: 100, priceCents: null });

  const b = S.newBid(d, { customerName: 'UDA', title: 'Parts', jobType: 'service' });
  b.areas.push({ id: 'a1', name: 'Room', items: [item(part)], photoIds: [] });
  b.job = S.newJob();
  b.job.changeOrders.push({ id: 'co1', name: 'CO', areas: [{ id: 'coa1', name: 'Room', items: [item(other)], photoIds: [] }],
    labor: { crewIds: [], days: 0, tasks: null } });
  d.bids.push(b);

  assert.strictEqual(S.catalogInUse(d, part.id), 1);
  assert.strictEqual(S.catalogInUse(d, other.id), 1, "a change order's items count");
  assert.strictEqual(S.catalogInUse(d, spare.id), 0);
});

// A log entry and an invoice are both outside any bid, so the three delete
// guards have to see them too — validateImport now refuses a file whose
// crew/equipment/catalog ids do not resolve from d.logs and d.invoices, and
// these three counted zero from either array until now.
test('equipmentInUse and catalogInUse count logs and invoices; crewInUse counts only logs', () => {
  const d = S.emptyData();
  const tool = d.settings.equipment[0];
  const part = d.catalog[0];
  const crewId = d.settings.crew[0].id;
  const cust = S.findOrCreateCustomer(d, 'UDA');
  const proj = S.newProject(d, cust.id, 'Job', '2026-09-01');
  const log = S.newLogEntry(d, { customerId: cust.id, projectId: proj.id, dateISO: '2026-09-01', createdAt: 1 });
  log.crew.push({ crewId, hours: 4 });
  log.items.push({ catalogId: part.id, name: part.name, unit: part.unit, qty: 1, costCents: 100, priceCents: null });
  log.equipment.push({ equipmentId: tool.id, name: tool.name, days: 1, dayCents: 500 });

  const inv = {
    id: 'inv1', number: null, kind: 'tm', customerId: cust.id, projectTitle: 'Job', dateISO: null,
    serviceFrom: '2026-09-01', serviceTo: '2026-09-01', po: '', terms: 'Upon receipt', rateCents: 8500, markupPct: 15,
    labor: [], items: [], rentals: [], equipment: [{ equipmentId: tool.id, name: tool.name, days: 1, dayCents: 500 }],
    logIds: [], bidId: null, partCents: null, notes: [],
    status: 'draft', sentAt: null, savedToFilesAt: null, payments: [], createdAt: 1,
  };
  d.invoices.push(inv);
  assert.ok(S.check(d), 'the fixture itself is a valid file');

  // A tool on a log and on an invoice: both count.
  assert.strictEqual(S.equipmentInUse(d, tool.id), 2);
  // A catalog part on a log: counts.
  assert.strictEqual(S.catalogInUse(d, part.id), 1);
  // A crew member used only on a log entry: counts.
  assert.strictEqual(S.crewInUse(d, crewId), 1);

  // Invoices do NOT count toward crewInUse: an invoice's labor row carries
  // the man's name as a snapshot and survives him being deleted from Settings.
  inv.labor.push({ crewId, name: 'Whoever', loggedHours: 4, billedHours: 4 });
  assert.strictEqual(S.crewInUse(d, crewId), 1, 'the invoice labor row does not add to the count');

  // And that is exactly why the guard matters: splicing the crew member out
  // of settings.crew while a log still names him leaves a file that refuses
  // its own check.
  const idx = d.settings.crew.findIndex((c) => c.id === crewId);
  d.settings.crew.splice(idx, 1);
  assert.strictEqual(S.check(d), false, 'the log still names a crew id nothing answers');
});

test('clauseInUse counts the bids that name a clause, and null clauseIds names none', () => {
  const d = S.emptyData();
  const clause = d.settings.clauses[0];
  const b1 = S.newBid(d, { customerName: 'UDA', title: 'One', jobType: 'project' });
  const b2 = S.newBid(d, { customerName: 'Schreiber', title: 'Two', jobType: 'project' });
  b1.clauseIds = [clause.id];
  d.bids.push(b1, b2);
  assert.strictEqual(b2.clauseIds, null, 'a fresh bid has not been asked yet');
  assert.strictEqual(S.clauseInUse(d, clause.id), 1);
  assert.strictEqual(S.clauseInUse(d, d.settings.clauses[1].id), 0);
});

// ---------------------------------------------------------------------------
// A TOOL BY NAME
// ---------------------------------------------------------------------------

test('findEquipmentByName matches case and surrounding whitespace blind', () => {
  const d = S.emptyData();
  const bender = d.settings.equipment.find((e) => e.name === 'EMT bender');
  assert.strictEqual(S.findEquipmentByName(d, 'emt bender'), bender);
  assert.strictEqual(S.findEquipmentByName(d, '  EMT BENDER '), bender);
  assert.strictEqual(S.findEquipmentByName(d, 'EMT bender'), bender);
});

test('findEquipmentByName ignores hidden tools and anything blank', () => {
  const d = S.emptyData();
  const bender = d.settings.equipment.find((e) => e.name === 'EMT bender');
  bender.hidden = true;
  assert.strictEqual(S.findEquipmentByName(d, 'EMT bender'), null, 'a put-away tool is not offered, so it is not a duplicate');
  assert.strictEqual(S.findEquipmentByName(d, ''), null);
  assert.strictEqual(S.findEquipmentByName(d, '   '), null);
  assert.strictEqual(S.findEquipmentByName(d, null), null);
});

// ---------------------------------------------------------------------------
// THE SAME TOOL, TWICE
// ---------------------------------------------------------------------------
//
// He got five Benders in Settings before the name check existed. The same
// mistake has a second door: pick Bender out of the picker on a bid that
// already has Bender on it and the old code pushed a second line, which bills
// the tool twice and prints as two benders.

test('bidEquipmentLine finds the line a tool already has on this bid', () => {
  const d = S.emptyData();
  const bid = S.newBid(d, { customerName: 'UDA', title: 'Panel', jobType: 'service', dateISO: '2026-09-05' });
  const bender = d.settings.equipment.find((e) => e.name === 'EMT bender');
  const line = { equipmentId: bender.id, name: 'EMT bender', days: 2, dayCents: 4000 };
  bid.equipment.push(line);
  assert.strictEqual(S.bidEquipmentLine(bid, bender.id), line);
});

test('bidEquipmentLine says no when the tool is not on the bid, and never throws', () => {
  const d = S.emptyData();
  const bid = S.newBid(d, { customerName: 'UDA', title: 'Panel', jobType: 'service', dateISO: '2026-09-05' });
  const bender = d.settings.equipment.find((e) => e.name === 'EMT bender');
  const threader = d.settings.equipment.find((e) => e.name === 'Threader');
  bid.equipment.push({ equipmentId: threader.id, name: 'Threader', days: 1, dayCents: 1000 });
  assert.strictEqual(S.bidEquipmentLine(bid, bender.id), null);
  // A bid off an older backup can reach this with no equipment array at all,
  // and the callers ask before they know anything.
  assert.strictEqual(S.bidEquipmentLine({}, bender.id), null);
  assert.strictEqual(S.bidEquipmentLine(bid, null), null);
  assert.strictEqual(S.bidEquipmentLine(null, bender.id), null);
});

// ---------------------------------------------------------------------------
// A NEGATIVE CUSHION
// ---------------------------------------------------------------------------

test('a bid quoted at fewer hours than it really takes still validates', () => {
  const { d, b } = buildFullData();
  b.pricing.cushionPct = -16.7;
  assert.ok(S.validateImport(JSON.stringify(d)), 'a negative cushion is a decision, not corruption');
  b.pricing.cushionPct = 'nope';
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null);
});

// ---------------------------------------------------------------------------
// SETTINGS NEVER CHANGE AN EXISTING BID
// ---------------------------------------------------------------------------

test('newBid snapshots the five cost-side numbers and the crew wages', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Cooler', jobType: 'project' });
  assert.strictEqual(b.pricing.hoursPerDay, 8);
  assert.strictEqual(b.pricing.burdenPct, 25);
  assert.strictEqual(b.pricing.consumablesPct, 3);
  assert.strictEqual(b.pricing.truckDayCents, 9500);
  assert.strictEqual(b.pricing.overheadPct, 10);
  assert.deepStrictEqual(b.labor.wageCents, { c1: 3200, c2: 3000 });
});
test('two bids keep their own numbers, and a Settings edit moves neither', () => {
  const d = S.emptyData();
  const first = S.newBid(d, { customerName: 'UDA', title: 'One', jobType: 'service' });
  d.settings.hoursPerDay = 10;
  d.settings.burdenPct = 40;
  d.settings.crew[0].wageCents = 5000;
  const second = S.newBid(d, { customerName: 'UDA', title: 'Two', jobType: 'service' });
  assert.strictEqual(first.pricing.hoursPerDay, 8);
  assert.strictEqual(second.pricing.hoursPerDay, 10);
  assert.strictEqual(first.pricing.burdenPct, 25);
  assert.strictEqual(second.pricing.burdenPct, 40);
  assert.strictEqual(first.labor.wageCents.c1, 3200);
  assert.strictEqual(second.labor.wageCents.c1, 5000);
  // And the shop's numbers moving again reaches neither of them.
  d.settings.overheadPct = 99;
  assert.strictEqual(first.pricing.overheadPct, 10);
  assert.strictEqual(second.pricing.overheadPct, 10);
});
test('noteCrewWage stamps a man on his first line and never a second time', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'One', jobType: 'service' });
  const third = { id: 'c3', name: 'Tim', wageCents: 2800, hidden: false };
  d.settings.crew.push(third);
  const undo = S.noteCrewWage(b, 'c3', d.settings);
  assert.strictEqual(b.labor.wageCents.c3, 2800);
  // Already stamped: nothing to write, and nothing to undo.
  third.wageCents = 9900;
  assert.strictEqual(S.noteCrewWage(b, 'c3', d.settings), null);
  assert.strictEqual(b.labor.wageCents.c3, 2800);
  undo();
  assert.strictEqual('c3' in b.labor.wageCents, false);
  // A bid off an older backup has no map at all and keeps its Settings
  // fallback rather than growing one halfway.
  const old = { labor: { crewIds: [], days: 0, tasks: null } };
  assert.strictEqual(S.noteCrewWage(old, 'c1', d.settings), null);
});
test('duplicateBid keeps the source bid s snapshot', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Orig', jobType: 'service' });
  d.bids.push(b);
  d.settings.hoursPerDay = 12;
  d.settings.burdenPct = 44;
  d.settings.crew[0].wageCents = 6000;
  const c = S.duplicateBid(d, b.id, '2026-09-20');
  assert.strictEqual(c.pricing.hoursPerDay, 8);
  assert.strictEqual(c.pricing.burdenPct, 25);
  assert.strictEqual(c.labor.wageCents.c1, 3200);
});
test('the snapshot fields are optional, and a bad one is refused', () => {
  const { d, b } = buildFullData();
  delete b.pricing.hoursPerDay;
  delete b.pricing.burdenPct;
  delete b.labor.wageCents;
  assert.ok(S.validateImport(JSON.stringify(d)), 'a bid older than the rule still loads');
  b.pricing.hoursPerDay = 0;
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null, 'a day of no hours is not a day');
  b.pricing.hoursPerDay = 10;
  b.pricing.burdenPct = 140;
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null);
  b.pricing.burdenPct = 25;
  b.labor.wageCents = { c1: -1 };
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null);
  // A wage stamped for somebody no longer on the crew is a stale key, not a
  // broken file: refusing it would take the whole backup down.
  b.labor.wageCents = { ghost: 3300 };
  assert.ok(S.validateImport(JSON.stringify(d)));
});

// ---------------------------------------------------------------------------
// THE DID-YOU-FORGET ROWS AND THEIR KIND
// ---------------------------------------------------------------------------

test('the seeded checklist names its own kinds, and the ones he forgets most come first', () => {
  const d = S.emptyData();
  const names = d.settings.forgetList.map(S.forgetName);
  assert.deepStrictEqual(names.slice(0, 6), [
    'Lift rental', 'Temporary power / generators', 'Shutdown windows / after-hours',
    'Permits and inspection fees', 'Core drilling / concrete cutting', 'Disposal / dumpster',
  ]);
  const kind = (name) => S.forgetKind(d.settings.forgetList.find((r) => S.forgetName(r) === name));
  ['Lift rental', 'Scaffolding', 'Temporary power / generators',
    'Equipment (owned tools)', 'Disposal / dumpster'].forEach((n) => {
    assert.strictEqual(kind(n), 'rental', n + ' has to reach the rental side of the bid');
  });
  // After-hours money is a labor premium, not a rental. It used to open the
  // rental prompt, which asks for days and a day rate, and there is no such
  // thing as a day rate on a shutdown window.
  assert.strictEqual(kind('Shutdown windows / after-hours'), 'item');
  ['Permits and inspection fees', 'Trenching / backfill', 'Sub-contractor', 'Patch and paint',
    'Travel days / per diem'].forEach((n) => {
    assert.strictEqual(kind(n), 'item', n + ' is a line in one of his areas');
  });
});

test('a row he typed himself is a plain string and reads its kind off its own words', () => {
  assert.strictEqual(S.forgetName('Permits'), 'Permits');
  assert.strictEqual(S.forgetKind('Permits'), 'item');
  assert.strictEqual(S.forgetKind('Boom lift'), 'rental');
  assert.strictEqual(S.forgetKind('Scissor lift rental'), 'rental');
  assert.strictEqual(S.forgetKind('Equipment'), 'rental');
  // A row object always wins over its own words.
  assert.strictEqual(S.forgetKind({ name: 'Lift rental', kind: 'item' }), 'item');
  assert.strictEqual(S.forgetName({ name: 'Permits' }), 'Permits');
  assert.strictEqual(S.forgetName(null), '');
});

test('a settings file whose checklist is still plain strings loads', () => {
  const { d } = buildFullData();
  d.settings.forgetList = ['Lift rental', 'Permits', 'Trenching'];
  assert.ok(S.validateImport(JSON.stringify(d)), 'his phone holds strings and must keep loading');
  d.settings.forgetList = [{ name: 'Lift rental', kind: 'rental' }, 'Permits'];
  assert.ok(S.validateImport(JSON.stringify(d)), 'both shapes in one list is legal');
  d.settings.forgetList = [{ name: 'Lift rental', kind: 'boom' }];
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null, 'there are two kinds of row, not three');
  d.settings.forgetList = [{ kind: 'rental' }];
  assert.strictEqual(S.validateImport(JSON.stringify(d)), null, 'a row with no name is not a row');
});

test('the clause library is his own paper, with the subcontract text kept apart', () => {
  const d = S.emptyData();
  const always = d.settings.clauses.filter((c) => c.group === 'always');
  assert.deepStrictEqual(always.map((c) => c.title), ['Scope', 'Price and material', 'Payment',
    'Late payment', 'Changes and concealed conditions', 'Access and shutdowns', 'Warranty', 'Governing law']);
  // Drafts for his attorney, and they have to read like a contractor wrote
  // them: no em-dashes anywhere in the library, the way every other line of
  // copy in this app is written.
  d.settings.clauses.forEach((c) => {
    assert.strictEqual(c.text.indexOf('—'), -1, c.title + ' has an em-dash in it');
    assert.strictEqual(c.title.indexOf('—'), -1, c.title + ' has an em-dash in it');
  });
  // The Consolidated Co-Ops language is still here, word for word, in the one
  // group that is right for it.
  const gc = d.settings.clauses.filter((c) => c.group === 'gc');
  assert.ok(gc.some((c) => c.title === 'Liquidated damages'));
  assert.ok(gc.some((c) => c.text.indexOf('after receipt of the payment by the Owner') !== -1),
    'pay-when-paid belongs under a general contractor and nowhere else');
  assert.strictEqual(always.some((c) => c.text.indexOf('Owner') !== -1), false,
    'his own proposal talks to a customer, not to an Owner with a capital O');
});

// ---------------------------------------------------------------------------
// THE STANDARD LIBRARIES ON A PHONE THAT ALREADY HAS DATA
// ---------------------------------------------------------------------------

test('Add the standard parts adds only the names he is missing', () => {
  const d = S.emptyData();
  const full = d.catalog.length;
  // A phone off v2: a short list, one name spelled with different capitals,
  // and one part he put away on purpose.
  d.catalog = d.catalog.slice(0, 12);
  d.catalog[0].name = d.catalog[0].name.toUpperCase();
  d.catalog[1].hidden = true;
  const first = S.addStandardCatalog(d);
  assert.strictEqual(d.catalog.length, 12 + first);
  assert.strictEqual(d.catalog.length, full, 'the missing names, and only those');
  assert.strictEqual(S.addStandardCatalog(d), 0, 'a second tap adds nothing');
  assert.strictEqual(d.catalog.filter((p) => p.hidden).length, 1, 'a part he put away stays put away');
  assert.ok(d.catalog.every((p) => p.lastCostCents === null || p.lastCostCents === undefined
    || Number.isInteger(p.lastCostCents)));
  assert.ok(S.validateImport(JSON.stringify(d)));
});

// The standard names, handed out so Settings can ask about his own spellings
// without a second copy of what "standard" means living in a screen file.
test('the standard name lists are exactly what a fresh install ships', () => {
  const d = S.emptyData();
  assert.deepStrictEqual(S.standardCatalogNames(), d.catalog.map((p) => p.name));
  assert.deepStrictEqual(S.standardEquipmentNames(), d.settings.equipment.map((e) => e.name));
  // A copy, not the seed itself: nothing a caller does to it can reach the
  // list every fresh install is built from.
  S.standardCatalogNames().push('nope');
  assert.strictEqual(S.standardCatalogNames().length, d.catalog.length);
});

test('the standard tools, checklist and notes add missing names, case-blind', () => {
  const d = S.emptyData();
  d.settings.equipment = [{ id: 'e1', name: '  MEGGER ', costCents: 5000, overrideDayCents: null, hidden: false }];
  assert.strictEqual(S.addStandardEquipment(d), 29, 'the megger he already has is not added twice');
  assert.strictEqual(S.addStandardEquipment(d), 0);

  d.settings.forgetList = ['lift rental', 'Permits'];
  const rows = S.addStandardForget(d);
  assert.strictEqual(rows, 18);
  assert.strictEqual(d.settings.forgetList.length, 20, 'his own "Permits" row stays, alongside the standard one');
  assert.strictEqual(S.addStandardForget(d), 0);

  d.settings.notePhrases = ['Does not include lift rental.'];
  assert.strictEqual(S.addStandardNotes(d), 13);
  assert.strictEqual(S.addStandardNotes(d), 0);
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('Reset to the standard library replaces what is loose and hides what a bid names', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'Cooler', jobType: 'project' });
  const onTheBid = d.settings.clauses[0];
  b.clauseIds = [onTheBid.id];
  d.bids.push(b);
  const before = d.settings.clauses.length;

  const out = S.resetClauseLibrary(d);
  assert.strictEqual(out.hidden, 1);
  assert.strictEqual(out.removed, before - 1);
  assert.strictEqual(d.settings.clauses.length, out.added + 1);
  // The bid still names its clause, the clause is still in the file, and the
  // document simply stops printing it.
  const kept = d.settings.clauses.find((c) => c.id === onTheBid.id);
  assert.ok(kept, 'a clause a bid points at is never spliced out');
  assert.strictEqual(kept.hidden, true);
  assert.ok(S.validateImport(JSON.stringify(d)), 'the whole document still loads afterwards');
  // Fresh ids on the way in, so the standard set can never collide with an id
  // one of his own hidden clauses is still holding.
  const ids = d.settings.clauses.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(d.settings.clauses.filter((c) => c.group === 'always' && !c.hidden).length, 8);
});

// The two new prices on a line and the one on a part are OPTIONAL: absent and
// null both load, a whole number loads, anything else is refused. An old file
// with none of them is the common case and it has to keep loading unchanged.
test('validateImport: listCents, lotCents and lastListCents are optional, and refused when not whole cents', () => {
  const ok = (mutate) => {
    const { d } = buildFullData();
    mutate(d);
    return S.validateImport(JSON.stringify(d)) !== null;
  };
  const item = (d) => d.bids[0].areas[0].items[0];
  const part = (d) => d.catalog[0];

  assert.ok(ok(() => {}), 'a file with none of the new fields loads');
  assert.ok(ok((d) => { item(d).listCents = null; item(d).lotCents = null; }));
  assert.ok(ok((d) => { item(d).listCents = 1800; }));
  assert.ok(ok((d) => { item(d).lotCents = 21600; }));
  assert.ok(ok((d) => { item(d).lotCents = 0; }), 'a $0 lot is an unpriced line, and it saves');
  assert.ok(ok((d) => { part(d).lastListCents = null; }));
  assert.ok(ok((d) => { part(d).lastListCents = 1800; }));

  assert.ok(!ok((d) => { item(d).listCents = 18.5; }), 'fractional cents on the list');
  assert.ok(!ok((d) => { item(d).listCents = -1; }), 'a negative list');
  assert.ok(!ok((d) => { item(d).listCents = '1800'; }), 'a string list');
  assert.ok(!ok((d) => { item(d).lotCents = 216.0001; }), 'fractional cents on the lot');
  assert.ok(!ok((d) => { item(d).lotCents = -5; }), 'a negative lot');
  assert.ok(!ok((d) => { part(d).lastListCents = 'x'; }), 'a string on the part');
  assert.ok(!ok((d) => { part(d).lastListCents = -1; }), 'a negative on the part');
});

// The catalog's memory of the second price. undefined leaves it alone (a
// caller that never asked), null clears it (he took it off), a number sets it.
test('recordCatalogUse: a fourth argument remembers the list price; undefined leaves it alone', () => {
  const d = S.emptyData();
  const p = S.addCatalogItem(d, { category: 'wire', name: '#12 THHN, test', unit: 'ft' });
  assert.strictEqual(p.lastListCents, null, 'a new part has no list price yet');

  S.recordCatalogUse(d, p.id, 38);
  assert.strictEqual(p.lastCostCents, 38);
  assert.strictEqual(p.lastListCents, null, 'three arguments touch nothing');

  S.recordCatalogUse(d, p.id, 38, 40);
  assert.strictEqual(p.lastListCents, 40);
  assert.strictEqual(p.uses, 2);

  S.recordCatalogUse(d, p.id, 38, undefined);
  assert.strictEqual(p.lastListCents, 40, 'undefined is "I did not ask"');

  S.recordCatalogUse(d, p.id, 38, null);
  assert.strictEqual(p.lastListCents, null, 'null is "take it off"');

  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('addStandardCatalog: parts it adds carry lastListCents like the seeds do', () => {
  const d = S.emptyData();
  d.catalog.splice(0, 5);
  assert.ok(S.addStandardCatalog(d) >= 5);
  assert.ok(d.catalog.every((p) => p.lastListCents === null));
});

// A fresh file marks material up 15. A phone that already has Settings keeps
// its own number: nothing here migrates, and a bid written under 18 carries
// 18 on its snapshot forever.
test('newBid snapshots the 15% default, and a bid under 18 keeps 18', () => {
  const d = S.emptyData();
  const b = S.newBid(d, { customerName: 'UDA', title: 'x', jobType: 'service' });
  assert.strictEqual(b.pricing.markupPct, 15);
  d.settings.markupPct = 18;
  const c = S.newBid(d, { customerName: 'UDA', title: 'y', jobType: 'service' });
  assert.strictEqual(c.pricing.markupPct, 18);
  assert.strictEqual(b.pricing.markupPct, 15, 'the first bid did not move');
});

// The supplier's handle on a part: QED's part number, QED's name, and when a
// price file last touched it. All three OPTIONAL: absent, null, or a string.
// Anything else is refused, so a hand-edited file cannot put a number where a
// name goes and have the import match on it.
test('validateImport: sku, supplierName and priceCheckedISO on a part are optional strings', () => {
  const ok = (mutate) => {
    const { d } = buildFullData();
    mutate(d);
    return S.validateImport(JSON.stringify(d)) !== null;
  };
  const part = (d) => d.catalog[0];
  assert.ok(ok(() => {}), 'a file with none of them loads');
  assert.ok(ok((d) => { part(d).sku = null; part(d).supplierName = null; part(d).priceCheckedISO = null; }));
  assert.ok(ok((d) => { part(d).sku = '3302434'; }));
  assert.ok(ok((d) => { part(d).supplierName = 'Pass & Seymour 1597-TRWRW GFCI, White'; }));
  assert.ok(ok((d) => { part(d).priceCheckedISO = '2026-09-08'; }));
  assert.ok(!ok((d) => { part(d).sku = 3302434; }), 'a number is not a part number');
  assert.ok(!ok((d) => { part(d).supplierName = ['x']; }), 'an array is not a name');
  assert.ok(!ok((d) => { part(d).priceCheckedISO = '9/8/26'; }), 'a date that is not YYYY-MM-DD');
  assert.ok(!ok((d) => { part(d).priceCheckedISO = 20260908; }), 'a number is not a date');
  assert.ok(ok((d) => { part(d).supplierName = 'x'.repeat(120); }), 'a 120-character supplierName loads');
  assert.ok(!ok((d) => { part(d).supplierName = 'x'.repeat(121); }), 'a 121-character supplierName is refused');
});

test('seeds, addCatalogItem and addStandardCatalog carry the three fields as null', () => {
  const d = S.emptyData();
  assert.ok(d.catalog.every((p) => p.sku === null && p.supplierName === null && p.priceCheckedISO === null));
  const p = S.addCatalogItem(d, { category: 'gear', name: 'Test part', unit: 'ea' });
  assert.strictEqual(p.sku, null); assert.strictEqual(p.supplierName, null); assert.strictEqual(p.priceCheckedISO, null);
  d.catalog.splice(0, 3);
  S.addStandardCatalog(d);
  assert.ok(d.catalog.every((x) => 'sku' in x && 'supplierName' in x && 'priceCheckedISO' in x));
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('validateImport: supplierName on a line is an optional string, capped at 120', () => {
  const ok = (mutate) => { const { d } = buildFullData(); mutate(d); return S.validateImport(JSON.stringify(d)) !== null; };
  const item = (d) => d.bids[0].areas[0].items[0];
  assert.ok(ok((d) => { item(d).supplierName = 'Square D QO120 20A Single-Pole Breaker'; }));
  assert.ok(ok((d) => { item(d).supplierName = null; }));
  assert.ok(!ok((d) => { item(d).supplierName = 42; }), 'a number is not a name');
  assert.ok(ok((d) => { item(d).supplierName = 'x'.repeat(120); }), 'a 120-character supplierName loads');
  assert.ok(!ok((d) => { item(d).supplierName = 'x'.repeat(121); }), 'a 121-character supplierName is refused');
});

// ---------------------------------------------------------------------------
// INVOICES ON DISK
// ---------------------------------------------------------------------------
// Every key is optional: a v2.4 backup has none of them and loads; a v3 backup
// restores into v2.4 with the arrays ignored. The document version stays 1.

test('emptyData carries empty projects, logs and invoices, and the two invoice settings', () => {
  const d = S.emptyData();
  assert.deepStrictEqual(d.projects, []);
  assert.deepStrictEqual(d.logs, []);
  assert.deepStrictEqual(d.invoices, []);
  assert.strictEqual(d.settings.nextInvoiceNumber, 1);
  assert.strictEqual(d.settings.invoiceTerms, 'Upon receipt');
  assert.strictEqual(d.version, 1);
});

test('a file with none of the invoice keys still loads, and the arrays read as empty', () => {
  const { d } = buildFullData();
  delete d.projects; delete d.logs; delete d.invoices;
  delete d.settings.nextInvoiceNumber; delete d.settings.invoiceTerms;
  const back = S.validateImport(JSON.stringify(d));
  assert.ok(back, 'a pre-v3 file loads');
  assert.deepStrictEqual(back.projects || [], []);
  assert.deepStrictEqual(back.invoices || [], []);
});

function invoiceFixture() {
  const { d, b } = buildFullData();
  const cust = d.customers[0];
  cust.attn = 'Kellen'; cust.address = '2008 S Hardy Drive\nTempe, AZ 85282'; cust.rateCents = 8500; cust.po = '2526-4213';
  const proj = S.newProject(d, cust.id, 'UF Project', '2026-08-24');
  const crewId = d.settings.crew[0].id;
  const log = S.newLogEntry(d, { customerId: cust.id, projectId: proj.id, dateISO: '2026-08-24' });
  log.crew.push({ crewId, hours: 8 });
  log.items.push({ catalogId: null, name: '#12 wire', unit: 'ft', qty: 500, costCents: 38, priceCents: null, lotCents: 21600 });
  const inv = {
    id: 'inv1', number: 166818, kind: 'tm', customerId: cust.id, projectTitle: 'UF Project', dateISO: '2026-08-28',
    serviceFrom: '2026-08-24', serviceTo: '2026-08-24', po: '2526-4213', terms: 'Upon receipt', rateCents: 8500, markupPct: 15,
    labor: [{ crewId, name: 'Shawn', loggedHours: 8, billedHours: 8 }],
    items: [{ catalogId: null, name: '#12 wire', unit: 'ft', qty: 500, costCents: 38, priceCents: null, lotCents: 21600 }],
    rentals: [], equipment: [], logIds: [log.id], bidId: null, partCents: null, notes: [],
    status: 'sent', sentAt: '2026-08-28', savedToFilesAt: null, payments: [{ dateISO: '2026-09-15', cents: 50000 }], createdAt: 1,
  };
  log.invoiceId = inv.id;
  d.invoices.push(inv);
  return { d, b, cust, proj, log, inv, crewId };
}

test('validateImport accepts the invoice shapes and refuses the wrong ones', () => {
  const ok = (mutate) => { const f = invoiceFixture(); mutate(f); return S.validateImport(JSON.stringify(f.d)) !== null; };
  assert.ok(ok(() => {}), 'the fixture loads');
  // customers
  assert.ok(!ok((f) => { f.cust.rateCents = 85.5; }), 'a rate in fractional cents');
  assert.ok(!ok((f) => { f.cust.address = 'x'.repeat(201); }), 'an address longer than 200');
  assert.ok(!ok((f) => { f.cust.hidden = 'yes'; }), 'hidden must be a boolean');
  assert.ok(ok((f) => { f.cust.hidden = true; }));
  // projects
  assert.ok(!ok((f) => { f.proj.customerId = 'nobody'; }), 'a project needs a real customer');
  assert.ok(!ok((f) => { f.proj.title = ''; }), 'a project needs a title');
  assert.ok(!ok((f) => { f.proj.title = 'x'.repeat(81); }), 'a title over 80');
  assert.ok(!ok((f) => { f.d.projects.push({ ...f.proj }); }), 'duplicate project id');
  // logs
  assert.ok(!ok((f) => { f.log.crew[0].hours = 0; }), 'hours must be more than zero');
  assert.ok(!ok((f) => { f.log.crew[0].crewId = 'ghost'; }), 'a crew id must exist');
  assert.ok(!ok((f) => { f.log.projectId = 'nope'; }), 'a project id must exist');
  assert.ok(!ok((f) => { f.log.invoiceId = 'nope'; }), 'an invoice id must exist');
  assert.ok(ok((f) => { f.log.invoiceId = null; f.inv.logIds = []; }));
  assert.ok(!ok((f) => { f.log.items[0].costCents = -1; }), 'log items are area items');
  assert.ok(!ok((f) => { f.log.notes = 'x'.repeat(S.AREA_NOTES_MAX + 1); }), 'notes are capped like area notes');
  // invoices
  assert.ok(!ok((f) => { f.inv.number = 0; }), 'a number is 1 or more');
  assert.ok(ok((f) => { f.inv.number = null; f.inv.status = 'draft'; f.inv.sentAt = null; f.inv.dateISO = null; f.inv.payments = []; }), 'a draft has no number and no date');
  assert.ok(!ok((f) => { f.inv.kind = 'x'; }));
  assert.ok(!ok((f) => { f.inv.customerId = 'nobody'; }));
  assert.ok(!ok((f) => { f.inv.serviceFrom = '8/24/26'; }));
  assert.ok(!ok((f) => { f.inv.labor[0].billedHours = -1; }), 'billed hours are 0 or more');
  assert.ok(ok((f) => { f.inv.labor[0].billedHours = 0; }), 'zero billed hours is allowed (he chose not to bill it)');
  assert.ok(!ok((f) => { f.inv.payments[0].cents = 0; }), 'a payment is more than nothing');
  assert.ok(!ok((f) => { f.inv.logIds = ['ghost']; }), 'logIds must exist');
  assert.ok(!ok((f) => { f.inv.bidId = 'ghost'; }), 'bidId must exist when set');
  assert.ok(ok((f) => { f.inv.kind = 'project'; f.inv.bidId = f.b.id; f.inv.partCents = 100000; f.inv.logIds = []; f.log.invoiceId = null; }));
  assert.ok(!ok((f) => { f.inv.kind = 'project'; f.inv.bidId = f.b.id; f.inv.partCents = null; f.inv.logIds = []; f.log.invoiceId = null; }), 'a project invoice needs a part amount');
  assert.ok(!ok((f) => { f.inv.kind = 'project'; f.inv.bidId = f.b.id; f.inv.partCents = 100000; }), 'a project invoice carries no logIds');
  assert.ok(!ok((f) => { f.inv.partCents = 100000; }), 'a tm invoice carries no partCents');
  assert.ok(!ok((f) => { f.d.invoices.push({ ...f.inv }); }), 'duplicate invoice id');
  assert.ok(!ok((f) => { f.d.invoices.push({ ...f.inv, id: 'inv2', logIds: [] }); }), 'two invoices with the same number');
});

test('newProject, newLogEntry: the shapes the screens write', () => {
  const d = S.emptyData();
  const c = S.findOrCreateCustomer(d, 'UDA');
  const p = S.newProject(d, c.id, '  UF Project ', '2026-09-01');
  assert.deepStrictEqual(p, { id: p.id, customerId: c.id, title: 'UF Project', done: false, createdISO: '2026-09-01' });
  assert.strictEqual(d.projects[0], p);
  assert.strictEqual(S.newProject(d, c.id, '   ', '2026-09-01'), null, 'no title, no project');
  const e = S.newLogEntry(d, { customerId: c.id, projectId: p.id, dateISO: '2026-09-02' });
  assert.deepStrictEqual(Object.keys(e).sort(), ['createdAt', 'crew', 'customerId', 'dateISO', 'equipment', 'id', 'invoiceId', 'items', 'notes', 'projectId', 'rentals'].sort());
  assert.strictEqual(e.invoiceId, null);
  assert.strictEqual(d.logs[0], e);
  assert.ok(S.validateImport(JSON.stringify(d)));
});

test('takeInvoiceNumber hands out the next number and advances the counter; bids keep their own', () => {
  const d = S.emptyData();
  d.settings.nextInvoiceNumber = 166818;
  assert.strictEqual(S.takeInvoiceNumber(d), 166818);
  assert.strictEqual(S.takeInvoiceNumber(d), 166819);
  assert.strictEqual(d.settings.nextInvoiceNumber, 166820);
  assert.strictEqual(d.settings.nextNumber, 1, 'the bid counter did not move');
});

test('customerInUse counts bids, projects, logs and invoices that name the customer', () => {
  const f = invoiceFixture();
  assert.strictEqual(S.customerInUse(f.d, f.cust.id), 4, 'one bid, one project, one log, one invoice');
  const other = S.findOrCreateCustomer(f.d, 'Schreiber');
  assert.strictEqual(S.customerInUse(f.d, other.id), 0);
});

test('openProjects lists a customer\'s projects that are not done, newest first', () => {
  const d = S.emptyData();
  const c = S.findOrCreateCustomer(d, 'UDA');
  const a = S.newProject(d, c.id, 'Boiler room', '2026-08-01');
  const b = S.newProject(d, c.id, 'UF Project', '2026-08-20');
  const done = S.newProject(d, c.id, 'Old job', '2026-07-01'); done.done = true;
  assert.deepStrictEqual(S.openProjects(d, c.id).map((p) => p.title), ['UF Project', 'Boiler room']);
});

// ---------------------------------------------------------------------------
// FIX ROUND (quality review of the invoices-on-disk task)
// ---------------------------------------------------------------------------

test('takeInvoiceNumber never reuses a number already on the file, even with the seed low or missing', () => {
  const f = invoiceFixture();   // carries invoice #166818
  delete f.d.settings.nextInvoiceNumber;
  const n = S.takeInvoiceNumber(f.d);
  assert.strictEqual(n, 166819, 'steps past the highest number on file, not the missing seed');
  assert.ok(S.check(f.d));
  // A seed that is merely low, not missing, is stepped past the same way.
  f.d.settings.nextInvoiceNumber = 1;
  assert.strictEqual(S.takeInvoiceNumber(f.d), 166819);
});

test('invoiceNumberInUse sees a number already on an invoice, except the one asking', () => {
  const f = invoiceFixture();
  assert.strictEqual(S.invoiceNumberInUse(f.d, 166818), true);
  assert.strictEqual(S.invoiceNumberInUse(f.d, 166818, f.inv.id), false, 'excepts its own invoice');
  assert.strictEqual(S.invoiceNumberInUse(f.d, 1), false);
});

test('validateImport refuses a one-sided log/invoice link, both directions, and a repeated logId', () => {
  const ok = (mutate) => { const f = invoiceFixture(); mutate(f); return S.validateImport(JSON.stringify(f.d)) !== null; };
  assert.ok(ok(() => {}), 'the good fixture still loads');
  assert.ok(!ok((f) => { f.log.invoiceId = null; }), 'the invoice points at the log but the log does not point back');
  assert.ok(!ok((f) => { f.inv.logIds = []; }), 'the log points at the invoice but the invoice does not list it');
  assert.ok(!ok((f) => {
    const inv2 = { ...f.inv, id: 'inv2', number: 166819, logIds: [] };
    f.d.invoices.push(inv2);
    f.log.invoiceId = inv2.id;   // f.inv.logIds still names this same log
  }), 'the log points at a different invoice than the one that names it');
  assert.ok(!ok((f) => { f.inv.logIds = [f.log.id, f.log.id]; }), 'a log id repeated inside one invoice');
  // Both sides cleared together is still fine.
  assert.ok(ok((f) => { f.log.invoiceId = null; f.inv.logIds = []; }));
});

test('customerUseCounts breaks the total down by record kind; customerInUse is their sum', () => {
  const f = invoiceFixture();
  assert.deepStrictEqual(S.customerUseCounts(f.d, f.cust.id), { bids: 1, projects: 1, logs: 1, invoices: 1 });
  assert.strictEqual(S.customerInUse(f.d, f.cust.id), 4);
  const other = S.findOrCreateCustomer(f.d, 'Schreiber');
  assert.deepStrictEqual(S.customerUseCounts(f.d, other.id), { bids: 0, projects: 0, logs: 0, invoices: 0 });
});

test('newLogEntry takes createdAt when given, and defaults to Date.now() only when it is not', () => {
  const d = S.emptyData();
  const c = S.findOrCreateCustomer(d, 'UDA');
  const p = S.newProject(d, c.id, 'Job', '2026-09-01');
  const fixed = S.newLogEntry(d, { customerId: c.id, projectId: p.id, dateISO: '2026-09-01', createdAt: 1 });
  assert.strictEqual(fixed.createdAt, 1);
  const before = Date.now();
  const defaulted = S.newLogEntry(d, { customerId: c.id, projectId: p.id, dateISO: '2026-09-01' });
  assert.ok(defaulted.createdAt >= before, 'no createdAt passed falls back to Date.now()');
});

test('newProject finds an open project by title, case-insensitively, and never matches a done one', () => {
  const d = S.emptyData();
  const c = S.findOrCreateCustomer(d, 'UDA');
  const first = S.newProject(d, c.id, 'UF Project', '2026-08-24');
  const again = S.newProject(d, c.id, 'UF project', '2026-09-01');
  assert.strictEqual(again, first, 'the same open project comes back, not a new one');
  assert.strictEqual(d.projects.length, 1);
  first.done = true;
  const revived = S.newProject(d, c.id, 'UF Project', '2026-09-05');
  assert.notStrictEqual(revived, first, 'a done project does not match; a new one is created');
  assert.strictEqual(d.projects.length, 2);
});

// ---------------------------------------------------------------------------
// FIX ROUND 2 (quality review of Tasks 2-3)
// ---------------------------------------------------------------------------

test('newProject slices to the cap before trimming, so a title cut off on a space carries none', () => {
  const d = S.emptyData();
  const c = S.findOrCreateCustomer(d, 'UDA');
  // 79 'a's then a space then more text: 81 characters. The 80th character
  // (index 79) is the space, so a naive trim-then-slice would leave it on
  // the end of the title.
  const spaced = 'a'.repeat(79) + ' ' + 'more text';
  const p = S.newProject(d, c.id, spaced, '2026-09-01');
  assert.strictEqual(p.title, 'a'.repeat(79));
  assert.strictEqual(p.title.length, 79);
  assert.notStrictEqual(p.title.slice(-1), ' ');
});

test('invoiceNumberInUse never matches a draft\'s null number', () => {
  const f = invoiceFixture();
  const draft = { ...f.inv, id: 'inv-draft', number: null, status: 'draft', sentAt: null, dateISO: null, payments: [], logIds: [] };
  f.d.invoices.push(draft);
  assert.strictEqual(S.invoiceNumberInUse(f.d, null), false, 'null is never "in use"');
  assert.strictEqual(S.invoiceNumberInUse(f.d, undefined), false);
  assert.strictEqual(S.invoiceNumberInUse(f.d, 166818), true, 'a real number is still found');
});

test('equipmentInUse/crewInUse/catalogInUse swallow a malformed log or invoice rather than throwing', () => {
  const f = invoiceFixture();
  const wantCrew = S.crewInUse(f.d, f.crewId);
  const wantCatalog = S.catalogInUse(f.d, 'anything');
  const wantEquip = S.equipmentInUse(f.d, 'anything');
  f.d.logs.push({ id: 'bad', customerId: f.cust.id, crew: 'oops', items: 'oops', equipment: 'oops' });
  assert.doesNotThrow(() => S.crewInUse(f.d, f.crewId));
  assert.doesNotThrow(() => S.catalogInUse(f.d, 'anything'));
  assert.doesNotThrow(() => S.equipmentInUse(f.d, 'anything'));
  // The malformed record contributes nothing rather than corrupting the count.
  assert.strictEqual(S.crewInUse(f.d, f.crewId), wantCrew);
  assert.strictEqual(S.catalogInUse(f.d, 'anything'), wantCatalog);
  assert.strictEqual(S.equipmentInUse(f.d, 'anything'), wantEquip);
});

// ---------------------------------------------------------------------------
// THE NUMBER HE WILL ACTUALLY GET
// ---------------------------------------------------------------------------
// The seed in Settings is the app's bookkeeping; this is the promise. They come
// apart the moment a backup is restored onto a phone whose counter had already
// run past the seed, and Settings prints THIS one, so the row and the invoice
// can never say two different numbers.

test('effectiveNextInvoiceNumber is the seed, raised past anything already on the file', () => {
  const d = S.emptyData();
  assert.strictEqual(S.effectiveNextInvoiceNumber(d), 1, 'a fresh phone starts at the seed');
  d.settings.nextInvoiceNumber = 166818;
  assert.strictEqual(S.effectiveNextInvoiceNumber(d), 166818, 'nothing on file: the seed stands');

  const f = invoiceFixture();                       // one invoice, numbered 166818
  f.d.settings.nextInvoiceNumber = 166818;
  assert.strictEqual(S.effectiveNextInvoiceNumber(f.d), 166819, 'a taken seed is raised one past it');
  f.d.settings.nextInvoiceNumber = 12;
  assert.strictEqual(S.effectiveNextInvoiceNumber(f.d), 166819, 'a seed far behind is raised the same way');
  f.d.settings.nextInvoiceNumber = 200000;
  assert.strictEqual(S.effectiveNextInvoiceNumber(f.d), 200000, 'a seed ahead of the file is left alone');

  // A draft has no number and is nobody's ceiling.
  f.d.settings.nextInvoiceNumber = 1;
  f.d.invoices.push({ ...f.inv, id: 'draft', number: null, logIds: [] });
  assert.strictEqual(S.effectiveNextInvoiceNumber(f.d), 166819);
});

test('effectiveNextInvoiceNumber reads a pre-v3 file and a junk seed without throwing', () => {
  const d = S.emptyData();
  delete d.invoices;
  d.settings.nextInvoiceNumber = 0;
  assert.strictEqual(S.effectiveNextInvoiceNumber(d), 1, 'a seed below 1 falls back to 1');
  delete d.settings.nextInvoiceNumber;
  assert.strictEqual(S.effectiveNextInvoiceNumber(d), 1, 'no seed at all reads as 1');
});

test('takeInvoiceNumber hands out exactly what effectiveNextInvoiceNumber promised', () => {
  const f = invoiceFixture();
  f.d.settings.nextInvoiceNumber = 12;
  const promised = S.effectiveNextInvoiceNumber(f.d);
  assert.strictEqual(S.takeInvoiceNumber(f.d), promised);
  // And the promise moves on with it: the counter is now past what it spent.
  assert.strictEqual(S.effectiveNextInvoiceNumber(f.d), promised + 1);
});

// ---------------------------------------------------------------------------
// A LOG ENTRY'S To AND ITS Ready FLAG (v3.1)
// ---------------------------------------------------------------------------
// Both are optional on disk. A v3 backup has neither and loads unchanged: the
// entry reads as one day, still in progress, which is what it was.

test('validateImport takes an entry with a To and a Ready on it, and one without', () => {
  const ok = (mutate) => { const f = invoiceFixture(); mutate(f); return S.validateImport(JSON.stringify(f.d)) !== null; };
  assert.ok(ok((f) => { f.log.toISO = '2026-08-28'; f.log.ready = true; }), 'the new shape loads');
  assert.ok(ok((f) => { f.log.ready = false; }), 'ready without a To');
  assert.ok(ok(() => {}), 'and neither of them, which is every entry on a v3 phone');
  assert.ok(!ok((f) => { f.log.toISO = '8/28/26'; }), 'a To that is not an ISO date');
  assert.ok(!ok((f) => { f.log.toISO = null; }), 'null is not a date; absent is how a v3 entry says it');
  assert.ok(!ok((f) => { f.log.ready = 'yes'; }), 'ready is a boolean');
});
