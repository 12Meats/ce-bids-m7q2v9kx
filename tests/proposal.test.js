// tests/proposal.test.js — the two rules about what a bid ARRIVES with, and
// the one about what the terms card offers him afterwards.
//
// screens/proposal.js is browser code loaded as globals, so it runs in a VM
// with the handful of globals it touches at load time, the same trick
// bids.test.js and reports.test.js use. Only the pure decisions are exercised
// here — seeding, the nudge, the offer — because everything else on that
// screen needs a document.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../storage.js');
const B = require('../bidmath.js');
const D = require('../dates.js');
const DM = require('../docmodel.js');

const state = { data: null, bidId: null };
let saved = true;                 // what persistOr is told the disk did
const sandbox = {
  console,
  document: undefined,
  state,
  Store: S,
  BidMath: B,
  Dates: D,
  DocModel: DM,
  DocGen: { loadLogo: () => {} },
  registerScreen: () => {},
  render: () => {},
  persistOr: (revert) => { if (!saved) { revert(); return false; } return true; },
  showBanner: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
vm.runInContext(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'screens', 'proposal.js'), 'utf8'), sandbox,
  { filename: 'proposal.js' });

const { proposalSeedClauses, proposalNudges, proposalBidMentions } = sandbox;

function fixture(detail, jobType) {
  const d = S.emptyData();
  state.data = d;
  const bid = S.newBid(d, { customerName: 'UDA', title: 'Cooler room', jobType: jobType || 'project' });
  bid.detail = detail;
  bid.areas.push({ id: 'a1', name: 'Cooler', items: [], photoIds: [] });
  d.bids.push(bid);
  state.bidId = bid.id;
  return { d, bid };
}
// proposalNudges builds its array inside the VM, so it is an Array from
// another realm and deepStrictEqual would refuse two identical empty ones.
// Everything asserted here is copied back into a host array first.
function nudgeGroups(bid) { return Array.from(proposalNudges(bid), (n) => n.group); }
function nudgeLabels(bid) { return Array.from(proposalNudges(bid), (n) => [n.group, n.label]); }

function alwaysIds(d) {
  return d.settings.clauses.filter((c) => c.group === 'always' && !c.hidden).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// WHAT A BID ARRIVES WITH
// ---------------------------------------------------------------------------

test('a Scope & price bid seeds the Always group, once', () => {
  const { d, bid } = fixture('scope');
  proposalSeedClauses(bid);
  assert.deepStrictEqual(Array.from(bid.clauseIds), alwaysIds(d));
  // His answer sticks: emptying the list is not a question the app asks twice.
  bid.clauseIds = [];
  proposalSeedClauses(bid);
  assert.deepStrictEqual(bid.clauseIds, []);
});

test('a Full or Summary bid arrives with no terms ticked', () => {
  ['full', 'summary'].forEach((detail) => {
    const { bid } = fixture(detail);
    proposalSeedClauses(bid);
    assert.deepStrictEqual(Array.from(bid.clauseIds), [], detail + ' must not carry the clause library');
  });
});

test('a refused save leaves the bid unasked rather than half-answered', () => {
  const { bid } = fixture('scope');
  saved = false;
  proposalSeedClauses(bid);
  saved = true;
  assert.strictEqual(bid.clauseIds, null);
});

test('the note a new bid carries follows the same split', () => {
  const d = S.emptyData();
  const cust = S.findOrCreateCustomer(d, 'UDA');
  cust.defaultDetail = 'full';
  assert.deepStrictEqual(S.newBid(d, { customerName: 'UDA', title: 'a', jobType: 'project' }).notes,
    ['Prices subject to change; final pricing based on actual material.']);
  cust.defaultDetail = 'summary';
  assert.strictEqual(S.newBid(d, { customerName: 'UDA', title: 'b', jobType: 'project' }).notes.length, 1);
  cust.defaultDetail = 'scope';
  assert.deepStrictEqual(S.newBid(d, { customerName: 'UDA', title: 'c', jobType: 'project' }).notes, [],
    'the terms page carries the validity, so the chip would be saying it twice');
});

// THE LEVEL HE TAPPED, NOT THE ONE THE CUSTOMER USUALLY GETS.
//
// The bid screen used to hand newBid the customer and then write the detail
// level on a line later, so the notes were seeded against a level that was
// already stale: a Scope & price bid for a Full customer arrived carrying the
// price note it is not supposed to have, and a Full bid for a scope-default
// customer arrived with none. Both were invisible until the paper printed.
test('the note follows the detail the bid is CREATED with, not the customer default', () => {
  const d = S.emptyData();
  const cust = S.findOrCreateCustomer(d, 'UDA');

  cust.defaultDetail = 'full';
  const scoped = S.newBid(d, { customerName: 'UDA', title: 'a', jobType: 'project', detail: 'scope' });
  assert.strictEqual(scoped.detail, 'scope');
  assert.deepStrictEqual(scoped.notes, []);

  cust.defaultDetail = 'scope';
  const full = S.newBid(d, { customerName: 'UDA', title: 'b', jobType: 'project', detail: 'full' });
  assert.strictEqual(full.detail, 'full');
  assert.deepStrictEqual(full.notes, ['Prices subject to change; final pricing based on actual material.']);

  // A level that is not one of the three is not a level: the customer's
  // default is still the fallback, and 'full' is the fallback for that.
  assert.strictEqual(S.newBid(d, { customerName: 'UDA', title: 'c', jobType: 'project', detail: 'nonsense' }).detail,
    'scope');
});

// ---------------------------------------------------------------------------
// THE NUDGE
// ---------------------------------------------------------------------------
// A prompt, never a tick. What it reads is what the walk left behind: an
// answered checklist row, or an item he typed himself.

test('trenching on the bid earns the trenching prompt, whichever door it came in', () => {
  const { bid } = fixture('full');
  assert.deepStrictEqual(nudgeGroups(bid), []);

  bid.forgetAnswers = { 'Trenching / backfill': 'added' };
  assert.deepStrictEqual(nudgeLabels(bid), [['trench', 'trenching']]);

  // The same bid by the other door: a line he typed in an area.
  const walked = fixture('full');
  walked.bid.areas[0].items.push({ catalogId: null, name: 'Trench to the pad', unit: 'lot', qty: 1, costCents: 0, priceCents: null });
  assert.strictEqual(nudgeGroups(walked.bid).length, 1);
});

// Core drilling used to nudge the trench group. Those three clauses are
// soils, Arizona 811 and drainage — paving and buried-utility language — and
// a hole through a slab earns none of them. There is no core-drill clause in
// the library, so the prompt had nothing honest to offer.
test('a sub-contractor finds its own group, and core drilling asks for nothing', () => {
  const { bid } = fixture('full');
  bid.forgetAnswers = { 'Core drilling / concrete cutting': 'added', 'Sub-contractor': 'added' };
  assert.deepStrictEqual(nudgeGroups(bid), ['subs']);
  const drillOnly = fixture('full');
  drillOnly.bid.forgetAnswers = { 'Core drilling / concrete cutting': 'added' };
  assert.deepStrictEqual(nudgeGroups(drillOnly.bid), []);
});

test('a row he said no to is not a row that earns a prompt', () => {
  const { bid } = fixture('full');
  bid.forgetAnswers = { 'Trenching / backfill': 'no' };
  assert.deepStrictEqual(nudgeGroups(bid), []);
});

test('one prompt per group, and none once the group is already on the bid', () => {
  const { d, bid } = fixture('full');
  // A trench answered on the checklist and a trench typed as a line are one
  // bid with trenching in it: one prompt, not two.
  bid.forgetAnswers = { 'Trenching / backfill': 'added' };
  bid.areas[0].items.push({ catalogId: null, name: 'Trench to the pad', unit: 'lot', qty: 1, costCents: 0, priceCents: null });
  assert.strictEqual(nudgeGroups(bid).length, 1);
  bid.clauseIds = d.settings.clauses.filter((c) => c.group === 'trench').map((c) => c.id);
  assert.deepStrictEqual(nudgeGroups(bid), [], 'nothing to add is nothing to ask about');
});

test('proposalBidMentions reads answers and item names, and nothing else', () => {
  const { bid } = fixture('full');
  bid.title = 'Trenching for the new pad';
  assert.strictEqual(proposalBidMentions(bid, /trench/i), false, 'the title is not a line on the bid');
  bid.areas[0].items.push({ catalogId: null, name: '3/4" EMT', unit: 'ft', qty: 10, costCents: 100, priceCents: null });
  assert.strictEqual(proposalBidMentions(bid, /trench/i), false);
  bid.areas[0].items.push({ catalogId: null, name: 'Subcontractor, insulation', unit: 'lot', qty: 1, costCents: 0, priceCents: null });
  assert.strictEqual(proposalBidMentions(bid, /sub-?contract/i), true);
});
