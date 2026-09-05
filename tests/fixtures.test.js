// tests/fixtures.test.js — THE RELEASE RULE.
//
// Every shipped version leaves a real backup file behind in tests/fixtures/,
// and this test loads every one of them with the CURRENT code. It is the only
// test in the suite whose job is to fail: when a later change to the data
// model quietly stops reading a shape that is sitting on his phone right now,
// this is what says so, before the version that cannot read it ships.
//
// So the rules for anyone editing the schema:
//
//   * DO NOT edit a fixture to make this pass. A fixture is a photograph of a
//     file that already exists in the world; changing it changes nothing about
//     the phone. Add a MIGRATIONS step instead.
//   * Every release adds its own fixture (backup-bids-v2.json, and so on) —
//     a real export from that build, not one hand-written to suit the test.
//   * New bid fields are OPTIONAL with a fallback, which is what lets an old
//     fixture keep loading with no version bump at all.
//
// backup-bids-v1.json is the file the shipped v1 wrote: $65 rate and floor,
// three bids (a draft mid-walk, a sent bid with clauses and a scope, a
// complete one with a job, a surprise and a change order), and — deliberately
// — no forgetAnswers key anywhere, because v1 had no such field.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../storage.js');
const D = require('../docmodel.js');

const dir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(dir).filter((f) => /^backup-.*\.json$/.test(f)).sort();

test('there is at least one shipped-version fixture to load', () => {
  assert.ok(files.length > 0, 'tests/fixtures holds no backup-*.json');
});

for (const file of files) {
  test(file + ': loads with the current code and survives a round trip', () => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const d = S.validateImport(text);
    assert.ok(d, file + ' no longer loads — add a MIGRATIONS step, do not edit the fixture');
    assert.strictEqual(S.check(d), true, file + ' loads but would not save again');
    assert.ok(Array.isArray(d.bids) && d.bids.length > 0, file + ' has no bids to price');
  });

  test(file + ': every bid still prices, at every detail level', () => {
    const d = S.validateImport(fs.readFileSync(path.join(dir, file), 'utf8'));
    d.bids.forEach((b) => {
      ['full', 'summary', 'scope'].forEach((level) => {
        const doc = D.build(b, d, level);
        assert.ok(Number.isFinite(doc.totalCents),
          file + ': bid ' + b.number + ' at ' + level + ' priced ' + doc.totalCents);
        assert.ok(Number.isInteger(doc.totalCents),
          file + ': bid ' + b.number + ' at ' + level + ' priced in fractional cents');
      });
    });
  });
}

// The one thing about v1's shape this suite asserts by name, because it is the
// thing v2 added: a bid with no forgetAnswers key is a valid bid, and the walk
// screen has to read it as "nothing answered yet" rather than fall over.
test('backup-bids-v1.json really is a pre-forgetAnswers file', () => {
  const d = S.validateImport(fs.readFileSync(path.join(dir, 'backup-bids-v1.json'), 'utf8'));
  assert.ok(d, 'the v1 fixture does not load');
  assert.strictEqual(d.bids.some((b) => 'forgetAnswers' in b), false,
    'the v1 fixture has grown a v2 field — regenerate it from the shipped v1 shape');
  assert.strictEqual(d.settings.rateCents, 6500, 'the v1 fixture must carry v1 defaults');
  assert.strictEqual(d.settings.floorCents, 6500, 'the v1 fixture must carry v1 defaults');
});
