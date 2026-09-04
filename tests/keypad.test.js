const { test } = require('node:test');
const assert = require('node:assert');
const K = require('../keypad.js');

// Types a string of keys into a fresh buffer and reports what it holds.
function type(keys, opts) {
  const b = K.createBuffer(opts || { allowDecimal: true });
  keys.split('').forEach((k) => b.press(k));
  return b;
}

test('typed sequences produce the expected value', () => {
  const cases = [
    ['005', 5],        // leading zeros are placeholders, not digits
    ['0', 0],
    ['0.', 0],         // point tapped, nothing after: a real zero
    ['1..5', 1.5],     // the second point is ignored
    ['.5', 0.5],       // a leading point becomes 0.5
    ['180', 180],
    ['125.50', 125.5],
    ['', null],        // nothing typed: Done must refuse, not guess
  ];
  cases.forEach(([keys, expected]) => {
    assert.strictEqual(type(keys).value(), expected, `"${keys}"`);
  });
});

test('text() shows the raw buffer, including a trailing point', () => {
  assert.strictEqual(type('0.').text(), '0.');
  assert.strictEqual(type('.').text(), '0.');
  assert.strictEqual(type('005').text(), '5');
  assert.strictEqual(type('').text(), '');
});

test('the decimal point is inert when the caller does not allow one', () => {
  const b = type('1.5', { allowDecimal: false });
  assert.strictEqual(b.text(), '15');
  assert.strictEqual(b.value(), 15);
});

test('the buffer is capped at maxDigits (12 by default)', () => {
  const b = type('123456789012345');
  assert.strictEqual(b.text(), '123456789012');
  assert.strictEqual(b.text().length, 12);
  assert.strictEqual(b.value(), 123456789012);

  const short = K.createBuffer({ allowDecimal: true, maxDigits: 3 });
  '9999'.split('').forEach((k) => short.press(k));
  assert.strictEqual(short.text(), '999');
});

test('backspace removes one character at a time and stops at empty', () => {
  const b = type('12.5');
  b.backspace();
  assert.strictEqual(b.text(), '12.');
  b.backspace();
  assert.strictEqual(b.text(), '12');
  b.backspace();
  b.backspace();
  assert.strictEqual(b.text(), '');
  b.backspace(); // already empty
  assert.strictEqual(b.text(), '');
  assert.strictEqual(b.value(), null);
});

test('backspacing away the decimal point frees the next one', () => {
  const b = type('1.5');
  b.backspace();
  b.backspace();      // buffer is now "1"
  b.press('.');
  b.press('2');
  assert.strictEqual(b.value(), 1.2);
});

test('clear() empties the buffer and value() reports null', () => {
  const b = type('9999');
  b.clear();
  assert.strictEqual(b.text(), '');
  assert.strictEqual(b.value(), null);
  b.press('7');
  assert.strictEqual(b.value(), 7); // still usable after a clear
});

test('non-key presses are ignored', () => {
  const b = K.createBuffer({ allowDecimal: true });
  [null, undefined, '', 'a', '12', '-', 5].forEach((k) => b.press(k));
  assert.strictEqual(b.text(), '');
  assert.strictEqual(b.value(), null);
});

test('two buffers do not share state', () => {
  const a = type('11');
  const b = type('22');
  assert.strictEqual(a.value(), 11);
  assert.strictEqual(b.value(), 22);
});

test('maxDecimals refuses a third decimal digit at the key', () => {
  const b = K.createBuffer({ allowDecimal: true, maxDecimals: 2 });
  '12.345'.split('').forEach((k) => b.press(k));
  assert.strictEqual(b.text(), '12.34');
  assert.strictEqual(b.value(), 12.34);

  // digits before the point are unaffected by the decimal cap
  const c = K.createBuffer({ allowDecimal: true, maxDecimals: 2 });
  '123456.78'.split('').forEach((k) => c.press(k));
  assert.strictEqual(c.text(), '123456.78');

  // and backspacing frees the slot back up
  b.backspace();
  b.press('9');
  assert.strictEqual(b.text(), '12.39');
});

test('no decimal cap by default', () => {
  const b = type('1.23456');
  assert.strictEqual(b.text(), '1.23456');
});

test('a full buffer has no room for the decimal point either', () => {
  const b = K.createBuffer({ allowDecimal: true });
  '123456789012'.split('').forEach((k) => b.press(k)); // 12 chars, at the cap
  b.press('.');
  assert.strictEqual(b.text(), '123456789012');
  b.press('5');
  assert.strictEqual(b.text(), '123456789012');

  // one under the cap: the point fits, and then nothing more does
  const c = K.createBuffer({ allowDecimal: true, maxDigits: 4 });
  '123'.split('').forEach((k) => c.press(k));
  c.press('.');
  assert.strictEqual(c.text(), '123.');
  c.press('5');
  assert.strictEqual(c.text(), '123.');
  assert.strictEqual(c.value(), 123);
});
