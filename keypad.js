// keypad.js — the pure digit-buffer behind the number panel. UMD so node:test
// and the browser both load it. No DOM, no state outside the buffer it hands
// back: what the owner's thumb produces is decided here and tested here, and
// app.js only draws the result.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Keypad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // createBuffer({ allowDecimal, maxDigits }) -> { press, backspace, clear, text, value }
  //
  // press(key) takes '0'-'9' or '.'; anything else is ignored.
  // text() is the raw string under the big digits.
  // value() is the Number the caller receives on Done, or null when nothing
  // has been typed — Done refuses on null rather than storing a guess.
  function createBuffer(opts) {
    opts = opts || {};
    const allowDecimal = !!opts.allowDecimal;
    // Counts every character in the buffer, decimal point included. Twelve is
    // far past any real bid figure and well inside float-safe integer range.
    const maxDigits = typeof opts.maxDigits === 'number' ? opts.maxDigits : 12;
    let buf = '';

    function press(key) {
      if (key === '.') {
        // One decimal point, only where the caller allows one. Leading '.'
        // becomes '0.' so the display never starts with a bare point.
        if (!allowDecimal || buf.indexOf('.') !== -1) return;
        buf = buf === '' ? '0.' : buf + '.';
        return;
      }
      if (typeof key !== 'string' || key.length !== 1 || key < '0' || key > '9') return;
      if (buf.length >= maxDigits) return;
      // A leading zero is a placeholder, not a digit: tapping 0 then 5 means 5.
      // ('0.' is untouched by this — it has a decimal point in it.)
      buf = buf === '0' ? key : buf + key;
    }

    function backspace() { buf = buf.slice(0, -1); }
    function clear() { buf = ''; }
    function text() { return buf; }

    // '0.' is a real zero (the point was tapped and nothing followed), not a
    // rejection: Number('0.') === 0.
    function value() {
      if (buf === '') return null;
      const n = Number(buf);
      return isFinite(n) ? n : null;
    }

    return { press, backspace, clear, text, value };
  }

  return { createBuffer };
});
