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
const GRID = 24;  // the delivered set's grid; 16 had no room for detail, 8 none for a chevron
const ART = JSON.parse(readFileSync(
  path.join(__dirname, '..', 'design-exports', 'macrosaurus-icons-24.json'), 'utf8'));

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
  assert.deepEqual(ICONS, ART.icons, 'app.jsx and macrosaurus-icons-24.json have drifted apart');
});

test('every icon is a square 24x24 grid', () => {
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

/* ---- the geometry the 24x24 brief promised, checked rather than eyeballed ----
   Every rule below was a line in `design-plans/23-icon-brief-v2.md`. They are here because a
   lopsided glyph is invisible in a diff, obvious on a screen, and the exact thing a redraw is
   supposed to fix. */

const lit = (g, x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && g[y][x] === '#';

test('nothing is drawn in the 2px margin', () => {
  // The live area is 20x20 inside the 24 box. A glyph that reaches the edge looks a size larger
  // than the one beside it, which is most of what made the old set feel unrelated.
  for (const [name, g] of Object.entries(ICONS)) {
    for (let i = 0; i < GRID; i++) {
      for (const [x, y] of [[i, 0], [i, 1], [i, GRID - 2], [i, GRID - 1],
                            [0, i], [1, i], [GRID - 2, i], [GRID - 1, i]]) {
        assert.ok(g[y][x] !== '#', `${name} has ink in the margin at ${x},${y}`);
      }
    }
  }
});

test('no pixel is joined to its glyph by a corner alone', () => {
  // A diagonal-only join reads as a break at 24px and as a jagged mistake when enlarged.
  for (const [name, g] of Object.entries(ICONS)) {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if (!lit(g, x, y)) continue;
      const joined = lit(g, x - 1, y) || lit(g, x + 1, y) || lit(g, x, y - 1) || lit(g, x, y + 1);
      assert.ok(joined, `${name} has a pixel at ${x},${y} attached only at a corner`);
    }
  }
});

test('there are no 1x1 features', () => {
  // Below 2px a feature is invisible at real size and shimmers at 48.
  for (const [name, g] of Object.entries(ICONS)) {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if (!lit(g, x, y)) continue;
      const alone = !lit(g, x - 1, y) && !lit(g, x + 1, y) && !lit(g, x, y - 1) && !lit(g, x, y + 1);
      assert.ok(!alone, `${name} has a 1x1 feature at ${x},${y}`);
    }
  }
});

test('every glyph is optically centred', () => {
  for (const [name, g] of Object.entries(ICONS)) {
    let x0 = GRID, x1 = -1, y0 = GRID, y1 = -1;
    g.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === '#') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }));
    const mid = (GRID - 1) / 2;
    assert.ok(Math.abs((x0 + x1) / 2 - mid) <= 1, `${name} sits off-centre horizontally`);
    assert.ok(Math.abs((y0 + y1) / 2 - mid) <= 1, `${name} sits off-centre vertically`);
  }
});

test('mirrored pairs are one drawing, not two', () => {
  // Two drawings of the same idea drift apart. One drawing, flipped, cannot.
  const flipH = g => g.map(r => [...r].reverse().join(''));
  const flipV = g => [...g].reverse();
  const pairs = [['arrow_left', 'arrow_right', flipH], ['caret_up', 'caret_down', flipV],
                 ['tri_up', 'tri_down', flipV], ['trend_up', 'trend_down', flipV]];
  for (const [a, b, flip] of pairs) {
    assert.deepEqual(flip(ICONS[a]), ICONS[b], `${a} and ${b} are not exact transforms`);
  }
  // The bond meter fills a heart in place, so the empty one has to sit inside the full one.
  const full = new Set();
  ICONS.heart_full.forEach((r, y) => [...r].forEach((c, x) => c === '#' && full.add(x + ',' + y)));
  ICONS.heart_empty.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '#') assert.ok(full.has(x + ',' + y), `heart_empty has ink at ${x},${y} that heart_full lacks`);
  }));
});

test('check and star halve cleanly, because they render inline at 12px', () => {
  // Everything else ships at 24 or 48. These two sit inside 13px running text, where a 24px glyph
  // would tower over the line - so they are drawn on an even 2px sub-grid and every 2x2 block
  // collapses to one clean pixel at half size.
  for (const name of ['check', 'star']) {
    const g = ICONS[name];
    for (let y = 0; y < GRID; y += 2) for (let x = 0; x < GRID; x += 2) {
      const quad = [g[y][x], g[y][x + 1], g[y + 1][x], g[y + 1][x + 1]];
      const mixed = quad.some(c => c === '#') && quad.some(c => c === '.');
      assert.ok(!mixed, `${name} has a mixed 2x2 block at ${x},${y}, so it blurs at 12px`);
    }
  }
});

test('every glyph in the set is drawn by game-icons artwork', () => {
  // Every icon the app renders now comes from game-icons.net: `PixelGlyph` checks `GI_ICONS` first
  // and only falls through to the pixel grid for a name it does not know. So the invariant that
  // matters is coverage - a name in the pixel set with no game-icons entry is a glyph that would
  // silently render in the old style, which is exactly the mixed look this replaced.
  const block = SRC.match(/const GI_ICONS = \{[\s\S]*?\n\};/);
  assert.ok(block, 'GI_ICONS block not found in app.jsx');
  const gi = new Set([...block[0].matchAll(/^\s{2}(\w+): \{ by:/gm)].map(m => m[1]));
  assert.ok(gi.size >= 56, `only ${gi.size} game-icons glyphs`);
  for (const name of Object.keys(ICONS)) {
    assert.ok(gi.has(name), `${name} has no game-icons artwork, so it would render as pixel art`);
  }
});

test('every game-icons glyph carries the credit it is licensed under', () => {
  // CC BY 3.0 is an attribution licence and the Credits page is built from these fields, so a glyph
  // without an author is a licence problem, not a cosmetic one.
  const block = SRC.match(/const GI_ICONS = \{[\s\S]*?\n\};/)[0];
  for (const m of block.matchAll(/^\s{2}(\w+): \{ by: '([^']*)', of: '([^']*)'/gm)) {
    assert.ok(m[2], `${m[1]} has no author`);
    assert.ok(m[3], `${m[1]} has no source icon name`);
  }
});

test('the app only ever asks for a size the grid lands on', () => {
  // The old ladder existed because a 24x24 pixel grid only lands on whole pixels at multiples of
  // 24. These are vectors now, so the sizes follow the job instead: 16 for an affordance sitting
  // beside text, 24 for a control or a nav item, 32/48 for a hero. The list stays short on purpose -
  // eleven different widths is how the set looked incoherent in the first place.
  const TRAIN = readFileSync(path.join(__dirname, '..', 'app', 'src', 'train.jsx'), 'utf8');
  const ALLOWED = new Set([12, 16, 24, 32, 48]);
  for (const [file, src] of [['app.jsx', SRC], ['train.jsx', TRAIN]]) {
    for (const m of src.matchAll(/<Icon\.[a-z_]+\s(?:[a-zA-Z-]+=(?:"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})\s*)*?width="(\d+)"/g)) {
      assert.ok(ALLOWED.has(+m[1]), `${file} renders an icon at ${m[1]}px`);
    }
    for (const m of src.matchAll(/<(?:PixelGlyph|Tick|Spark)[^>]*?size=\{(\d+)\}/g)) {
      assert.ok(ALLOWED.has(+m[1]), `${file} renders a glyph at ${m[1]}px`);
    }
  }
});
