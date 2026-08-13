/*
 * tools/glyph-sheet.mjs — the icon review page.
 *
 * Reads PX_ICONS straight out of app/src/app.jsx and renders every glyph the way the app actually
 * renders it, so the sheet can never drift from what ships. Sprite art has to be judged at the size
 * it will be seen, on the backgrounds it will sit on, in both themes; reading the ASCII in the
 * source tells you almost nothing.
 *
 *   node tools/glyph-sheet.mjs      then open   http://localhost:8137/.build/glyphs.html
 *
 * Output goes to .build/ (gitignored), so it never ships with the app.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const SRC = readFileSync('app/src/app.jsx', 'utf8');
const CSS = readFileSync('app/src/styles.css', 'utf8');

// ---- pull the art out of the source -----------------------------------------------------------
const block = SRC.match(/const PX_ICONS = \{[\s\S]*?\n\};/);
if (!block) throw new Error('PX_ICONS not found in app/src/app.jsx');
const ICONS = {};
for (const m of block[0].matchAll(/(\w+):\s*\[([^\]]+)\]/g)) {
  ICONS[m[1]] = (m[2].match(/'[^']*'/g) || []).map((s) => s.slice(1, -1));
}

// ---- pull the two food palettes out of the stylesheet, so the swatches are the real colours -----
function paletteFrom(themeSelector) {
  const start = CSS.indexOf(themeSelector);
  const chunk = CSS.slice(start, CSS.indexOf('}', start));
  const out = {};
  for (const m of chunk.matchAll(/--food-([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const FOOD_DARK = paletteFrom(':root, .theme-dark');
const FOOD_LIGHT = paletteFrom('.theme-light');

const FOOD = ['meat', 'plant', 'drink', 'egg', 'grain', 'sweet', 'dino'];
const KIND_KEY = { meat: 'meat', plant: 'plant', drink: 'drink', egg: 'egg', grain: 'grain', sweet: 'sweet', dino: 'other' };
const OTHER = Object.keys(ICONS).filter((k) => !FOOD.includes(k));

// The three status colours a premium tile can wear, from the same stylesheet.
const STATUS = { good: '#39FF14', warn: '#FFB020', danger: '#FF5555' };
const STATUS_LIGHT = { good: '#17A398', warn: '#B26A00', danger: '#D7263D' };

const svg = (rows, px, ink) => {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" fill="${ink}" style="shape-rendering:crispEdges">${rects}</svg>`;
};
const tile = (name, rows, bg, ink, { px = 24, box = 36, label = name } = {}) => `
  <figure>
    <div class="tile" style="width:${box}px;height:${box}px;background:${bg}">${svg(rows, px, ink)}</div>
    <figcaption>${label}</figcaption>
  </figure>`;

const section = (title, note, body) => `
  <section><h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ''}<div class="row">${body}</div></section>`;

function themeBlock(theme) {
  const dark = theme === 'dark';
  const pal = dark ? FOOD_DARK : FOOD_LIGHT;
  const status = dark ? STATUS : STATUS_LIGHT;
  const ink = 'rgba(0,0,0,0.75)';
  const neutral = dark ? '#17171a' : '#e6e6e6';
  const muted = dark ? '#9b9ba3' : '#6b6b73';

  return `
  <div class="theme ${dark ? 'dark' : 'light'}">
    <h1>${dark ? 'Dark theme (Game Boy Pocket)' : 'Light theme (Game Boy Color)'}</h1>

    ${section('Free account: coloured by food type',
      'No score to show, so the tile says what the food is. A free account never sees a status colour, which is why this green cannot be misread as "good".',
      FOOD.map((k) => tile(k, ICONS[k], pal[KIND_KEY[k]], ink)).join(''))}

    ${section('Premium: coloured by Density Score',
      'The same tiles, now carrying meaning. Green clears the target, amber is middling, red is treat territory, grey is a food we could not score (and always alcohol).',
      [
        tile('good', ICONS.plant, status.good, ink, { label: 'scored 80' }),
        tile('warn', ICONS.grain, status.warn, ink, { label: 'scored 58' }),
        tile('danger', ICONS.sweet, status.danger, ink, { label: 'scored 24' }),
        tile('neutral', ICONS.meat, neutral, muted, { label: 'not scored' }),
        tile('alcohol', ICONS.drink, neutral, muted, { label: 'alcohol' }),
      ].join(''))}

    ${section('Every food glyph, at the size it ships',
      '24px of art inside a 36px tile. If it does not read here, it does not read.',
      FOOD.map((k) => tile(k, ICONS[k], pal[KIND_KEY[k]], ink)).join(''))}

    ${section('The rest of the set',
      'Used across the app for status, navigation and the game surfaces.',
      OTHER.map((k) => tile(k, ICONS[k], dark ? '#0d0d0d' : '#ffffff', dark ? '#39FF14' : '#111')).join(''))}

    ${section('Enlarged, to check the drawing',
      'Silhouette is the whole job at this size: if you cannot tell what it is from the outline alone, it needs simplifying.',
      FOOD.map((k) => tile(k, ICONS[k], pal[KIND_KEY[k]], ink, { px: 96, box: 112 })).join(''))}
  </div>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>Macrosaurus glyph sheet</title>
<style>
  body { margin:0; font-family: ui-monospace, Menlo, monospace; }
  .theme { padding: 28px 24px 40px; }
  .theme.light { background:#f2f2f2; color:#111; }
  .theme.dark  { background:#000; color:#eee; }
  h1 { font-size:15px; letter-spacing:.06em; text-transform:uppercase; margin:0 0 4px; }
  h2 { font-size:12px; font-weight:600; margin:22px 0 2px; }
  .note { font-size:11px; opacity:.6; margin:0 0 10px; max-width:70ch; line-height:1.5; }
  .row { display:flex; flex-wrap:wrap; gap:14px; }
  figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:6px; }
  .tile { border:4px solid #2c2c2e; display:flex; align-items:center; justify-content:center; }
  figcaption { font-size:9px; opacity:.65; }
  .count { font-size:11px; opacity:.5; padding:10px 24px; background:#111; color:#eee; }
</style>
${themeBlock('light')}
${themeBlock('dark')}
<div class="count">${Object.keys(ICONS).length} glyphs, generated from app/src/app.jsx</div>`;

mkdirSync('.build', { recursive: true });
writeFileSync('.build/glyphs.html', html);
console.log(`glyph sheet written: .build/glyphs.html (${Object.keys(ICONS).length} glyphs)`);
console.log('open http://localhost:8137/.build/glyphs.html');
