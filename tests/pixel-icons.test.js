'use strict';
// The pixel icon set is hand-drawn ASCII, which is a pleasant way to author sprites and an easy way
// to ship a broken one: a row a character short, a stray space instead of a dot, an icon with seven
// rows. The renderer used to hardcode a width of 6 while two icons were drawn at a different width,
// so they silently stretched. This reads the art straight out of the source and holds it to the grid.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');
const GRID = 16;  // the delivered set's grid; 8 had no room for a chevron or a camera
const ART = JSON.parse(readFileSync(
  path.join(__dirname, '..', 'design-exports', 'macrosaurus-icons-16.json'), 'utf8'));

function parseIcons() {
  const block = SRC.match(/const PX_ICONS = \{[\s\S]*?\n\};/);
  assert.ok(block, 'PX_ICONS block not found in app.jsx');
  const out = {};
  for (const m of block[0].matchAll(/(\w+):\s*\[([^\]]+)\]/g)) {
    out[m[1]] = (m[2].match(/'[^']*'/g) || []).map(s => s.slice(1, -1));
  }
  return out;
}
const ICONS = parseIcons();

test('there are icons to check', () => {
  assert.ok(Object.keys(ICONS).length >= 20, `only found ${Object.keys(ICONS).length} icons`);
});

test('the art in app.jsx is exactly what the design export holds', () => {
  // Two copies exist on purpose: the JSON is the delivered artwork and the editable one, app.jsx
  // carries a generated copy so the bundle stays self-contained. Hand-editing either one is the
  // easy mistake, so hold them identical - `node tools/gen-px-icons.mjs` is the fix.
  assert.deepEqual(ICONS, ART.icons, 'app.jsx and macrosaurus-icons-16.json have drifted apart');
});

test('every icon is a square 16x16 grid', () => {
  for (const [name, rows] of Object.entries(ICONS)) {
    assert.equal(rows.length, GRID, `${name} has ${rows.length} rows, expected ${GRID}`);
    rows.forEach((r, i) => assert.equal(r.length, GRID, `${name} row ${i} is ${r.length} wide: "${r}"`));
  }
});

test('every icon uses only ink and empty, never a stray space', () => {
  // A space renders as empty but reads as a typo, and it is how the old dino art hid a bug.
  for (const [name, rows] of Object.entries(ICONS)) {
    rows.forEach((r, i) => assert.ok(/^[.#]+$/.test(r), `${name} row ${i} has a bad character: "${r}"`));
  }
});

test('no icon is blank or completely filled', () => {
  // Either would render as a solid block or as nothing, which is never the intent.
  for (const [name, rows] of Object.entries(ICONS)) {
    const ink = rows.join('').split('').filter(c => c === '#').length;
    assert.ok(ink > 4, `${name} is nearly blank (${ink} lit pixels)`);
    assert.ok(ink < GRID * GRID - 4, `${name} is nearly solid (${ink} lit pixels)`);
  }
});

test('the food icons are all distinct shapes', () => {
  // The reason for the redraw: at 6x6 meat, grain and sweet all resolved to the same blob, so a
  // glance at the diary told you nothing. Identical art means the icon carries no information.
  const food = ['meat', 'plant', 'drink', 'egg', 'grain', 'sweet', 'dino'];
  const seen = new Map();
  for (const k of food) {
    assert.ok(ICONS[k], `${k} is missing from the icon set`);
    const art = ICONS[k].join('|');
    assert.ok(!seen.has(art), `${k} is drawn identically to ${seen.get(art)}`);
    seen.set(art, k);
  }
});

test('food icons differ from each other by a real margin, not one pixel', () => {
  const food = ['meat', 'plant', 'drink', 'egg', 'grain', 'sweet'];
  for (let i = 0; i < food.length; i++) {
    for (let j = i + 1; j < food.length; j++) {
      const a = ICONS[food[i]].join(''), b = ICONS[food[j]].join('');
      let diff = 0;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
      assert.ok(diff >= 6, `${food[i]} and ${food[j]} differ by only ${diff} pixels`);
    }
  }
});
