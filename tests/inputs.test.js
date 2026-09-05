// tests/inputs.test.js — the two builders in ui.js that build a CONTROL rather
// than a string: the search field both search screens use, and the running
// total that sits above the add list.
//
// The search field is here because every one of its settings is invisible on a
// desktop and load-bearing on an iPhone. Autocorrect rewrites 3/4, autocapitalize
// capitalizes emt, the spellcheck underline makes a part number look wrong, and
// the Return key says the wrong word. A screenshot at 390x844 in Chrome shows
// none of that, so the attributes are asserted here instead — and asserted on
// the SHARED builder, because the walk and the home screen each used to build
// their own field and only one of them would ever get fixed.
//
// ui.js is browser code loaded as plain globals, so it runs in a VM against a
// document stub small enough to read: createElement, attributes, children,
// listeners. Nothing here needs layout.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const B = require('../bidmath.js');

function fakeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    attrs: {},
    children: [],
    listeners: {},
    className: '',
    value: '',
    hidden: false,
    textContent: '',
    focused: false,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type) { (this.listeners[type] || []).forEach((fn) => fn({})); },
    focus() { this.focused = true; },
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

const sandbox = { document: { createElement: fakeElement }, console, BidMath: B };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
const { searchInput, areaTallyText } = sandbox;

// ---------------------------------------------------------------------------
// searchInput
// ---------------------------------------------------------------------------

test('searchInput: the phone keyboard is told to leave the query alone', () => {
  const wrap = searchInput({ placeholder: 'Search all parts', label: 'Search all parts' });
  const input = wrap.input;
  assert.equal(input.getAttribute('type'), 'text');
  assert.equal(input.getAttribute('autocorrect'), 'off');
  assert.equal(input.getAttribute('autocapitalize'), 'off');
  assert.equal(input.getAttribute('spellcheck'), 'false');
  assert.equal(input.getAttribute('enterkeyhint'), 'search');
  assert.equal(input.getAttribute('inputmode'), 'search');
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(input.getAttribute('placeholder'), 'Search all parts');
  assert.equal(input.getAttribute('aria-label'), 'Search all parts');
});

test('searchInput: the label falls back to the placeholder, and the class is the caller\'s', () => {
  const wrap = searchInput({ placeholder: 'Search customer or title', className: 'bids-search' });
  assert.equal(wrap.input.getAttribute('aria-label'), 'Search customer or title');
  assert.equal(wrap.className, 'search-wrap bids-search');
  assert.equal(searchInput({}).input.getAttribute('aria-label'), 'Search');
});

test('searchInput: the clear-X is only there when there is something to clear', () => {
  const empty = searchInput({});
  const clearOf = (w) => w.children.find((c) => c.className === 'search-clear');
  assert.equal(clearOf(empty).hidden, true);

  const filled = searchInput({ value: '3/4' });
  assert.equal(filled.input.value, '3/4');
  assert.equal(clearOf(filled).hidden, false);

  // Typing it back to nothing takes the X away again.
  filled.input.value = '';
  filled.input.fire('input');
  assert.equal(clearOf(filled).hidden, true);
});

test('searchInput: tapping the X clears the field, tells the caller, and keeps the keyboard up', () => {
  const seen = [];
  const wrap = searchInput({ value: '3/4 emt', onInput: (v) => seen.push(v) });
  const clear = wrap.children.find((c) => c.className === 'search-clear');
  clear.fire('click');
  assert.equal(wrap.input.value, '');
  assert.deepEqual(seen, ['']);       // the list redraws to the unfiltered one
  assert.equal(clear.hidden, true);
  assert.equal(wrap.input.focused, true);  // he is mid-thought, not done
});

test('searchInput: typing reports the value, once per keystroke', () => {
  const seen = [];
  const wrap = searchInput({ onInput: (v) => seen.push(v) });
  wrap.input.value = '1';
  wrap.input.fire('input');
  wrap.input.value = '1"';
  wrap.input.fire('input');
  assert.deepEqual(seen, ['1', '1"']);
});

// ---------------------------------------------------------------------------
// areaTallyText
// ---------------------------------------------------------------------------

test('areaTallyText: counts the lines and adds up what they cost', () => {
  const area = { id: 'a1', name: 'Warehouse', items: [
    { name: '3/4" EMT', unit: 'ft', qty: 100, costCents: 112, priceCents: null },
    { name: 'LED high bay', unit: 'ea', qty: 4, costCents: 31800, priceCents: null },
  ] };
  assert.equal(areaTallyText(area), '2 items · $1,384.00');
  // One is not "1 items", and an empty room says so rather than showing nothing.
  assert.equal(areaTallyText({ items: [area.items[0]] }), '1 item · $112.00');
  assert.equal(areaTallyText({ items: [] }), '0 items · $0.00');
  assert.equal(areaTallyText(null), '0 items · $0.00');
});

test('areaTallyText: fractional counts round the same way the bid does', () => {
  // 12.5 ft at $1.13 is $14.125 — the line rounds once, here and on the Price
  // screen, so the strip and the area cost can never differ by a cent.
  const area = { items: [{ name: '3/4" EMT', unit: 'ft', qty: 12.5, costCents: 113, priceCents: null }] };
  assert.equal(areaTallyText(area), '1 item · $14.13');
});
