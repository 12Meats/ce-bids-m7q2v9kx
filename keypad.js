// keypad.js — the pure digit-buffer behind the number panel. UMD so node:test
// and the browser both load it. No DOM, no state outside the buffer it hands
// back: what the owner's thumb produces is decided here and tested here, and
// app.js only draws the result.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Keypad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // createBuffer({ allowDecimal, maxChars, maxDecimals, prior })
  //   -> { press, backspace, clear, text, value, submit }
  //
  // press(key) takes '0'-'9' or '.'; anything else is ignored.
  // text() is the raw string under the big digits.
  // value() is what he TYPED, or null when he typed nothing.
  // submit() is what Done hands back, which is not always the same thing.
  function createBuffer(opts) {
    opts = opts || {};
    const allowDecimal = !!opts.allowDecimal;
    // THE VALUE THE PANEL OPENED ON — the "was $32.00" over the digits, or
    // null on a line that has none. It is never preloaded into the buffer
    // (retyping beats editing on a phone), and it is the whole of what
    // submit() adds: see below.
    const prior = (typeof opts.prior === 'number' && isFinite(opts.prior)) ? opts.prior : null;
    // Counts every CHARACTER in the buffer, decimal point included — which is
    // why it is not called maxDigits. A cap of 3 on a decimal field allows
    // "22." and then refuses the 5, which is how a percentage keypad once
    // silently ate the tenths a caller had explicitly allowed. Twelve is far
    // past any real bid figure and well inside float-safe integer range.
    const maxChars = typeof opts.maxChars === 'number' ? opts.maxChars : 12;
    // Digits allowed after the point. Money passes 2: a third decimal is
    // always a fat-fingered tap, and refusing it at the key is honest, where
    // rounding it away later would silently change what the owner typed.
    // Unset means no cap (feet, hours, days can carry more precision).
    const maxDecimals = typeof opts.maxDecimals === 'number' ? opts.maxDecimals : Infinity;
    let buf = '';

    // How many digits sit after the decimal point right now.
    function decimalsTyped() {
      const dot = buf.indexOf('.');
      return dot === -1 ? 0 : buf.length - dot - 1;
    }

    function press(key) {
      if (key === '.') {
        // One decimal point, only where the caller allows one. Leading '.'
        // becomes '0.' so the display never starts with a bare point.
        if (!allowDecimal || buf.indexOf('.') !== -1) return;
        // The point is a character like any other: a full buffer has no room
        // for it either.
        if (buf.length >= maxChars) return;
        buf = buf === '' ? '0.' : buf + '.';
        return;
      }
      if (typeof key !== 'string' || key.length !== 1 || key < '0' || key > '9') return;
      if (buf.length >= maxChars) return;
      if (decimalsTyped() >= maxDecimals) return;
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

    // WHAT DONE HANDS BACK.
    //
    // He opens the wage that already says $32.00, looks at it, decides it is
    // right, and taps Done. Typing nothing is an answer there — "that one" —
    // and the panel used to shake at him for it, which is the app arguing with
    // a man who is agreeing with it. So Done on an untouched buffer keeps the
    // value the panel opened with, and the edit the caller sees is a no-op.
    //
    // On a NEW line there is no prior and nothing to keep, so submit() is
    // still null and Done still refuses rather than storing a guess. Clear is
    // untouched by any of this: it means "leave it", and it never comes
    // through here.
    function submit() {
      const v = value();
      return v === null ? prior : v;
    }

    return { press, backspace, clear, text, value, submit };
  }

  return { createBuffer };
});
