const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');

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
});
