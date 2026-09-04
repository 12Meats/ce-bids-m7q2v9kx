// tests/hourcost.test.js — the hour-cost exhibit's arithmetic.
//
// docgen.js is a browser file; it is loadable here because everything that
// touches the DOM or jsPDF sits inside a function. hourCostRows is the ONLY
// place in the whole app where docgen does money math (a bid's numbers all
// come off the document model), which is exactly why it is pure and why it is
// tested: the page it feeds is what he hands a plant manager who is arguing
// about the rate, and a line on it that doesn't add up loses the argument.
const test = require('node:test');
const assert = require('node:assert');
const DocGen = require('../docgen.js');

// A fixture whose numbers are deliberately NOT the app's defaults, so a change
// to the seed settings can't quietly make a wrong formula look right.
function settings() {
  return {
    crew: [
      { id: 'c1', name: 'Shawn', wageCents: 3400, hidden: false },
      { id: 'c2', name: 'George', wageCents: 2800, hidden: false },
      { id: 'c3', name: 'Gone', wageCents: 9900, hidden: true },   // must not count
    ],
    hoursPerDay: 10,
    burdenPct: 22,
    truckDayCents: 12000,
    consumablesPct: 4,
    overheadPct: 12,
    marginPct: 20,
    rateCents: 7000,
  };
}

function byLabel(rows, label) {
  const hit = rows.find((r) => r.label === label);
  assert.ok(hit, 'no row labelled ' + label);
  return hit;
}

test('hourCostRows: every line off a known settings fixture', () => {
  const rows = DocGen.hourCostRows(settings());

  // Hidden crew are off the payroll: (3400 + 2800) / 2, not a three-man average.
  const wage = Math.round((3400 + 2800) / 2);                       // 3100
  const burden = Math.round(wage * 22 / 100);                       // 682
  const truck = Math.round(12000 / 10);                             // 1200
  const consumables = Math.round(200000 * 4 / 100 / 32);            // 250
  const overhead = Math.round((wage + burden + truck + consumables) * 12 / 100); // 628
  const subtotal = wage + burden + truck + consumables + overhead;  // 5860
  const rate = Math.round(subtotal / (1 - 20 / 100));               // 7325

  assert.strictEqual(byLabel(rows, 'Wage').cents, 3100);
  assert.strictEqual(byLabel(rows, 'Payroll taxes & comp').cents, 682);
  assert.strictEqual(byLabel(rows, 'Truck & fuel').cents, 1200);
  assert.strictEqual(byLabel(rows, 'Consumables & small tools').cents, 250);
  assert.strictEqual(byLabel(rows, 'Overhead').cents, 628);
  assert.strictEqual(byLabel(rows, 'Subtotal (cost per hour)').cents, 5860);
  assert.strictEqual(byLabel(rows, 'Fair profit').cents, rate - subtotal); // 1465
  assert.strictEqual(byLabel(rows, 'Rate').cents, 7325);

  // Whole cents only — a fraction of a cent on an exhibit is a typo waiting to
  // be printed as "$58.60000000000001".
  rows.forEach((r) => assert.ok(Number.isInteger(r.cents), r.label + ' is not integer cents'));
});

// The screen and the page both pick rows out of this list. They match on key,
// never on the label, so rewording a line can never silently change which
// number the Reports card quotes or which line the page draws a rule above.
test('hourCostRows: every row carries its stable key, in order', () => {
  assert.deepStrictEqual(DocGen.hourCostRows(settings()).map((r) => r.key),
    ['wage', 'burden', 'truck', 'consumables', 'overhead', 'subtotal', 'profit', 'rate']);
});

test('hourCostRows: the last row is the rate, and it is the rows above it added up', () => {
  const rows = DocGen.hourCostRows(settings());
  const last = rows[rows.length - 1];

  assert.strictEqual(last.label, 'Rate');
  assert.strictEqual(
    last.cents,
    byLabel(rows, 'Subtotal (cost per hour)').cents + byLabel(rows, 'Fair profit').cents,
  );

  // A page that says the hour costs X and then bills X is what a 0% margin
  // means; the exhibit must not invent profit that isn't in the settings.
  const free = DocGen.hourCostRows(Object.assign(settings(), { marginPct: 0 }));
  assert.strictEqual(byLabel(free, 'Fair profit').cents, 0);
  assert.strictEqual(byLabel(free, 'Rate').cents, byLabel(free, 'Subtotal (cost per hour)').cents);
});
