#!/usr/bin/env node
/**
 * The review page for the all-game-icons set: every glyph at the sizes it ships, in both themes,
 * with the source drawing named under it so a bad match is obvious rather than merely wrong.
 *
 *   node tools/gi-sheet.mjs      then open http://localhost:8137/.build/gi-sheet.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const art = JSON.parse(readFileSync('design-exports/game-icons.json', 'utf8'));
const CSS = readFileSync('app/src/styles.css', 'utf8');

function palette(sel) {
  const start = CSS.indexOf(sel);
  const chunk = CSS.slice(start, CSS.indexOf('}', start));
  const out = {};
  for (const m of chunk.matchAll(/--food-([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const FOOD_LIGHT = palette('.theme-light');
const KIND = { meat: 'meat', plant: 'plant', drink: 'drink', egg: 'egg', grain: 'grain', sweet: 'sweet', dino: 'other' };

// Matches I am least sure of - game-icons has no drawing for these ideas, so they are the nearest
// thing rather than the right thing. Called out so they get looked at first.
const WEAK = {
  barcode: 'no barcode exists; this is a price tag',
  photo: 'no image/gallery icon; this is a film strip',
  dash: 'no dashboard grid; these are cubes',
  heart_empty: 'no hollow heart; same drawing, the caller inks it',
  chevron: 'no chevron; a plain arrow turned 90',
  caret_down: 'no caret; a plain arrow turned 180',
  trend_up: 'a plain arrow turned 45',
  trend_down: 'a plain arrow turned 135',
  tri_up: 'a play triangle turned -90',
  dumbbell: 'no dumbbell; a weight-lifting figure',
};

const one = (name, px, ink) => {
  const g = art.icons[name];
  const t = g.rot ? ` transform="rotate(${g.rot} 256 256)"` : '';
  return `<svg viewBox="0 0 512 512" width="${px}" height="${px}" fill="${ink}"><path d="${g.d}"${t}/></svg>`;
};
const cell = (name, ink) => `
  <figure${WEAK[name] ? ' class="weak"' : ''}>
    <div class="sizes">${one(name, 24, ink)}${one(name, 48, ink)}</div>
    <figcaption><b>${name}</b><span>${art.icons[name].slug}</span>${WEAK[name] ? `<em>${WEAK[name]}</em>` : ''}</figcaption>
  </figure>`;

const NAMES = Object.keys(art.icons).sort();
const FOODS = ['meat', 'plant', 'drink', 'egg', 'grain', 'sweet', 'dino'];

const block = (dark) => `
<section class="${dark ? 'dark' : 'light'}">
  <h2>${dark ? 'Dark theme' : 'Light theme'}</h2>
  <p>Each glyph at 24px and 48px - the two sizes the app ships. The name under it is the
  game-icons.net drawing it comes from.</p>
  <h3>On the food tiles, which is the harshest case in the set</h3>
  <div class="tiles">${FOODS.map(k => `<figure><div class="tile" style="background:${dark ? '#1b1b22' : (FOOD_LIGHT[KIND[k]] || '#ddd')}">${one(k, 24, dark ? '#3DFF62' : 'rgba(0,0,0,0.78)')}</div><figcaption><b>${k}</b></figcaption></figure>`).join('')}</div>
  <h3>The whole set</h3>
  <div class="grid">${NAMES.map(n => cell(n, dark ? '#3DFF62' : '#241f2e')).join('')}</div>
</section>`;

mkdirSync('.build', { recursive: true });
writeFileSync('.build/gi-sheet.html', `<!doctype html><meta charset="utf-8">
<title>Macrosaurus icons - all game-icons.net</title>
<style>
  body{margin:0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  section{padding:28px}
  .light{background:#e7e3da;color:#241f2e}
  .dark{background:#0c0c11;color:#3DFF62}
  h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px}
  h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.7;margin:26px 0 12px}
  p{max-width:74ch;opacity:.75;margin:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
  .tiles{display:flex;gap:10px;flex-wrap:wrap}
  figure{margin:0;padding:10px;border:2px solid currentColor;display:flex;flex-direction:column;align-items:center;gap:8px}
  .light figure{background:#fffdf7}
  .dark figure{background:#101018}
  .sizes{display:flex;align-items:center;gap:10px;min-height:48px}
  .tile{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #241f2e}
  figcaption{text-align:center;font-size:10px;line-height:1.35}
  figcaption b{display:block;font-weight:700}
  figcaption span{display:block;opacity:.55}
  figcaption em{display:block;font-style:normal;margin-top:3px;color:#b3541e}
  .dark figcaption em{color:#F0B429}
  .weak{outline:2px dashed #b3541e;outline-offset:2px}
  .dark .weak{outline-color:#F0B429}
</style>
${block(false)}${block(true)}`);
console.log(`wrote .build/gi-sheet.html: ${NAMES.length} glyphs, ${Object.keys(WEAK).length} flagged`);
