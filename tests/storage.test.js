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
  assert.strictEqual(d.settings.rateCents, 6500);
  assert.ok(d.catalog.length >= 50 && d.catalog.length <= 90);
  assert.ok(d.catalog.every((p) => p.lastCostCents === null && p.uses === 0));
  assert.deepStrictEqual([...new Set(d.catalog.map((p) => p.category))].sort(),
    ['boxes', 'conduit', 'gear', 'lighting', 'rentals', 'wire']);
  assert.strictEqual(d.settings.equipment.length, 6);
  assert.strictEqual(d.settings.clauses.filter((c) => c.group === 'always').length, 19);
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
  const b2 = S.newBid(d, { customerName: 'uda', title: 'x', jobType: 'project' });
  assert.strictEqual(d.customers.length, 1);              // case-insensitive match
  assert.strictEqual(b2.pricing.cushionPct, 15);
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
test('check: mirrors validateImport as a boolean', () => {
  const d = S.emptyData();
  assert.strictEqual(S.check(d), true);
  const bad = JSON.parse(JSON.stringify(d)); bad.settings.rateCents = 65.5;
  assert.strictEqual(S.check(bad), false);
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
    ['pricing cushionPct negative', (dd) => { dd.bids[0].pricing.cushionPct = -1; }],
    ['job.weeks hours negative', (dd) => { dd.bids[0].job.weeks[0].hours = -1; }],
    ['job.weeks weekISO invalid', (dd) => { dd.bids[0].job.weeks[0].weekISO = 'nope'; }],
    ['job.surprises cents negative', (dd) => { dd.bids[0].job.surprises[0].cents = -1; }],
    ['job.surprises note not string', (dd) => { dd.bids[0].job.surprises[0].note = 5; }],
    ['job.changeOrders priceCents negative', (dd) => { dd.bids[0].job.changeOrders[0].priceCents = -1; }],
    ['job.changeOrders area id empty', (dd) => { dd.bids[0].job.changeOrders[0].areas[0].id = ''; }],
    ['job.changeOrders labor unknown crewId', (dd) => { dd.bids[0].job.changeOrders[0].labor.crewIds = ['ghost']; }],
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
