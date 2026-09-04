'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The offline story lives or dies on sw.js ASSETS being complete. The failure
// it guards is quiet and nasty: add a tenth screen file, forget to precache it,
// and the app looks fine on wifi and blanks out in a plant with no signal.
// So these tests read the real index.html and the real sw.js and cross-check.

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SW_SRC = read('sw.js');
const HTML = read('index.html');
const MANIFEST = JSON.parse(read('manifest.json'));

// Evaluate just the two top-level const declarations out of sw.js. Running the
// whole file would need a service worker global scope; slicing out the array
// literal and letting the JS engine parse it beats a regex that has to know
// about trailing commas and quote styles.
function swConst(name) {
  const start = SW_SRC.indexOf('const ' + name + ' =');
  assert.notStrictEqual(start, -1, 'sw.js declares ' + name);
  const arrayEnd = SW_SRC.indexOf('\n];', start);
  const stop = arrayEnd === -1 ? SW_SRC.indexOf(';', start) + 1 : arrayEnd + 3;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SW_SRC.slice(start, stop) + '\nresult = ' + name + ';', ctx);
  return ctx.result;
}

// Spread into a host-realm array: values that come back from vm.runInContext
// carry that context's Array.prototype, and assert.deepStrictEqual compares
// prototypes, so a vm-realm [] is not deepStrictEqual to a plain [].
const ASSETS = [...swConst('ASSETS')];
const CACHE = swConst('CACHE');

// Everything index.html pulls over the network: <script src>, <link href>,
// <img src>. Absolute URLs and data: URIs are somebody else's problem.
function htmlRefs() {
  const refs = new Set();
  const re = /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(HTML)) !== null) {
    const ref = m[1];
    if (/^(https?:|data:|#|\/\/)/i.test(ref)) continue;
    refs.add(ref.replace(/^\.\//, ''));
  }
  return [...refs];
}

test('ASSETS covers every file index.html references', () => {
  const missing = htmlRefs().filter((ref) => !ASSETS.includes(ref));
  assert.deepStrictEqual(missing, [], 'not precached: ' + missing.join(', '));
});

test('ASSETS covers index.html itself and the manifest icons', () => {
  for (const required of ['index.html', 'manifest.json', 'apple-touch-icon.png', 'logo.png']) {
    assert.ok(ASSETS.includes(required), required + ' must be precached');
  }
  for (const icon of MANIFEST.icons) {
    assert.ok(ASSETS.includes(icon.src), 'manifest icon ' + icon.src + ' must be precached');
  }
});

test('every precached asset exists on disk', () => {
  const gone = ASSETS.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepStrictEqual(gone, [], 'listed but missing: ' + gone.join(', '));
});

test('ASSETS has no duplicates and no leading slashes', () => {
  assert.strictEqual(new Set(ASSETS).size, ASSETS.length, 'duplicate entries in ASSETS');
  // A leading slash would break the app when it is served from a subdirectory,
  // which is exactly how GitHub Pages serves the sibling timesheet app.
  const absolute = ASSETS.filter((rel) => rel.startsWith('/'));
  assert.deepStrictEqual(absolute, [], 'root-relative paths break subdirectory hosting');
});

test('every screen file is precached', () => {
  const screens = fs.readdirSync(path.join(ROOT, 'screens'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => 'screens/' + f);
  const missing = screens.filter((rel) => !ASSETS.includes(rel));
  assert.deepStrictEqual(missing, [], 'new screen not precached: ' + missing.join(', '));
});

test('the manifest matches the app chrome', () => {
  assert.strictEqual(MANIFEST.name, 'CE Bids');
  assert.strictEqual(MANIFEST.display, 'standalone');
  assert.strictEqual(MANIFEST.start_url, './');
  // The theme color has to match the <meta name="theme-color"> in index.html or
  // the status bar and the app header end up two different navies.
  const meta = HTML.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i);
  assert.ok(meta, 'index.html declares a theme-color');
  assert.strictEqual(MANIFEST.theme_color, meta[1]);
});

test('index.html links the manifest and the apple touch icon', () => {
  assert.match(HTML, /<link\s+rel="manifest"\s+href="manifest\.json">/i);
  assert.match(HTML, /<link\s+rel="apple-touch-icon"\s+href="apple-touch-icon\.png">/i);
});

test('the cache name is namespaced to this app', () => {
  // The sibling timesheet app uses 'ce-*'. Sharing a name across two apps on the
  // same origin would have one wipe the other's cache on activate.
  assert.match(CACHE, /^bids-v\d+$/);
});
