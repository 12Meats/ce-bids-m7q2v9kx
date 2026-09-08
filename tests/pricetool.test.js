// tests/pricetool.test.js — the seam between the Python script that writes the
// price file and the module that reads it. Nothing else tests it end to end.
// Skipped when python is not on this machine.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const P = require('../pricefile.js');

const script = path.join(__dirname, '..', 'tools', 'qed-prices.py');
const py = spawnSync('python', [script, '--sample-json'], { encoding: 'utf8' });
const available = py.status === 0 && py.stdout && py.stdout.trim().startsWith('{');

test('the script writes what PriceFile.parse reads', { skip: !available && 'python not available' }, () => {
  const parsed = P.parse(py.stdout);
  assert.strictEqual(parsed.error, null, parsed.error);
  assert.strictEqual(parsed.rows.length, 1);
  assert.deepStrictEqual(parsed.rows[0], { sku: '3302434', name: 'Pass & Seymour 1597-TRWRW 15A 125V Self-Test GFCI, White', listCents: 3908, per: 'ea' });
  assert.match(parsed.checkedISO, /^\d{4}-\d{2}-\d{2}$/);
});
