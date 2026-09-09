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
const APP_SRC = read('app.js');

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
// <img src>, and any url(...) in the inline stylesheet. Absolute URLs and
// data: URIs are somebody else's problem. There are no CSS url() references
// today; the scan covers them so the first background-image or @font-face
// someone adds cannot slip past precaching unnoticed.
function htmlRefs() {
  const refs = new Set();
  const patterns = [
    /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    /\burl\(\s*["']?([^"')]+?)["']?\s*\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(HTML)) !== null) {
      const ref = m[1].trim();
      if (/^(https?:|data:|#|\/\/)/i.test(ref)) continue;
      refs.add(ref.replace(/^\.\//, ''));
    }
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

// A screen registers itself with the id of the <section> it draws into, and
// nothing checks that the section is there: show() would simply toggle
// nothing, render into a null host and throw. Task H added three screens at
// once (the three libraries), which is exactly when one gets forgotten.
test('every screen registers against a section that exists in index.html', () => {
  const screens = fs.readdirSync(path.join(ROOT, 'screens')).filter((f) => f.endsWith('.js'));
  const missing = [];
  for (const file of screens) {
    const src = read('screens/' + file);
    const re = /id:\s*'(screen-[a-z-]+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (HTML.indexOf('<section id="' + m[1] + '"') === -1) missing.push(file + ' -> ' + m[1]);
    }
  }
  assert.deepStrictEqual(missing, [], 'no section for: ' + missing.join(', '));
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

test('APP_VERSION in app.js matches CACHE in sw.js', () => {
  // The version line at the bottom of Settings is the only way the owner can
  // tell from his phone which build he is running, so it has to name the cache
  // that is actually serving him. Bump one and forget the other and the line
  // lies, which is worse than not having the line at all.
  const m = APP_SRC.match(/^const APP_VERSION = '([^']+)';$/m);
  assert.ok(m, 'app.js declares a top-level APP_VERSION string');
  assert.strictEqual(m[1], CACHE, 'APP_VERSION and sw.js CACHE must be bumped together');
});

// The script tags are an ORDER, not a list. Every file here is a plain global
// evaluated top to bottom, and storage.js calls Catalog.straighten while it is
// building a new part: loaded first, storage.js would define itself against a
// Catalog that is not there yet, and the failure would not show until the day
// he adds a part in the field. sw.js caching both files makes them load fast,
// not in the right order.
test('catalog.js loads before storage.js', () => {
  const at = (src) => HTML.indexOf('<script src="' + src + '"');
  const catalog = at('catalog.js');
  const storage = at('storage.js');
  assert.notStrictEqual(catalog, -1, 'index.html loads catalog.js');
  assert.notStrictEqual(storage, -1, 'index.html loads storage.js');
  assert.ok(catalog < storage, 'catalog.js must be loaded before storage.js');
});

// invmath.js reads Docmodel (a project invoice's amount), Bidmath (the
// shared qtyNum/unitText formatters) and Dates (age, range text) at load
// time via require, so all three have to exist first. On the phone that
// means all three script tags have to run first too.
test('docmodel.js, bidmath.js and dates.js load before invmath.js', () => {
  const at = (src) => HTML.indexOf('<script src="' + src + '"');
  const docmodel = at('docmodel.js');
  const bidmath = at('bidmath.js');
  const dates = at('dates.js');
  const invmath = at('invmath.js');
  assert.notStrictEqual(docmodel, -1, 'index.html loads docmodel.js');
  assert.notStrictEqual(bidmath, -1, 'index.html loads bidmath.js');
  assert.notStrictEqual(dates, -1, 'index.html loads dates.js');
  assert.notStrictEqual(invmath, -1, 'index.html loads invmath.js');
  assert.ok(docmodel < invmath, 'docmodel.js must be loaded before invmath.js');
  assert.ok(bidmath < invmath, 'bidmath.js must be loaded before invmath.js');
  assert.ok(dates < invmath, 'dates.js must be loaded before invmath.js');
});

// invdoc.js reads BidMath (the file-name and quantity formatters), InvMath
// (rows and totals) and Dates (the invoice date) at load time via require, so
// all three have to exist first.
test('bidmath.js, invmath.js and dates.js load before invdoc.js', () => {
  const at = (src) => HTML.indexOf('<script src="' + src + '"');
  const bidmath = at('bidmath.js');
  const invmath = at('invmath.js');
  const dates = at('dates.js');
  const invdoc = at('invdoc.js');
  assert.notStrictEqual(bidmath, -1, 'index.html loads bidmath.js');
  assert.notStrictEqual(invmath, -1, 'index.html loads invmath.js');
  assert.notStrictEqual(dates, -1, 'index.html loads dates.js');
  assert.notStrictEqual(invdoc, -1, 'index.html loads invdoc.js');
  assert.ok(bidmath < invdoc, 'bidmath.js must be loaded before invdoc.js');
  assert.ok(invmath < invdoc, 'invmath.js must be loaded before invdoc.js');
  assert.ok(dates < invdoc, 'dates.js must be loaded before invdoc.js');
});

test('APP_BUILT is an ISO date, bumped with the version', () => {
  // The Settings line reads "CE Bids · v2.2 · built Sep 5, 2026", and the date
  // half comes from here. Dates.fmtDate refuses anything that is not
  // YYYY-MM-DD, so a typo would not print a wrong date, it would print no date
  // at all and the line would trail off mid-sentence.
  const m = APP_SRC.match(/^const APP_BUILT = '([^']+)';$/m);
  assert.ok(m, 'app.js declares a top-level APP_BUILT string');
  assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/, 'APP_BUILT is a YYYY-MM-DD date');
  const d = new Date(m[1] + 'T12:00:00');
  assert.ok(!isNaN(d.getTime()), 'APP_BUILT is a real day');
});

// picker.js is written in ui.js's vocabulary and every screen is written in
// picker.js's: the row a list of parts is drawn as, the strip a line opens, the
// picker itself. All three are plain globals evaluated top to bottom, so a
// screen loaded first would define itself against builders that are not there
// yet, and the failure would not show until he tapped the row.
test('ui.js loads before picker.js, and picker.js before every screen', () => {
  const at = (src) => HTML.indexOf('<script src="' + src + '"');
  const ui = at('ui.js');
  const picker = at('picker.js');
  assert.notStrictEqual(ui, -1, 'index.html loads ui.js');
  assert.notStrictEqual(picker, -1, 'index.html loads picker.js');
  assert.ok(ui < picker, 'ui.js must be loaded before picker.js');
  const screens = fs.readdirSync(path.join(ROOT, 'screens'))
    .filter((f) => f.endsWith('.js')).map((f) => 'screens/' + f);
  const early = screens.filter((rel) => {
    const i = at(rel);
    return i !== -1 && i < picker;
  });
  assert.deepStrictEqual(early, [], 'loaded before picker.js: ' + early.join(', '));
});

test('the cache name is namespaced to this app', () => {
  // The sibling timesheet app uses 'ce-*'. Sharing a name across two apps on the
  // same origin would have one wipe the other's cache on activate.
  //
  // A point release is a cache of its own: v2.1 ships changed JS, so it has to
  // miss v2's cache rather than be served out of it.
  assert.match(CACHE, /^bids-v\d+(\.\d+)?$/);
});
