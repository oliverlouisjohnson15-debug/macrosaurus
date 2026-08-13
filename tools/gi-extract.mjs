#!/usr/bin/env node
/**
 * Pulls the game-icons.net artwork we use into design-exports/game-icons.json, as-is.
 *
 * Their files are a 512x512 viewBox with a black background rect and the artwork as white paths.
 * We drop the background and keep the paths, which then take `currentColor` like everything else.
 * No downsampling, no redraw: the whole point is to ship their drawing.
 *
 * CC BY 3.0 - the authors are recorded per glyph here and credited in the app.
 *
 *   node tools/gi-extract.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

// our name -> the game-icons.net file it comes from
const SOURCES = {
  meat: 'lorc/chicken-leg',
  plant: 'delapouite/broccoli',
  drink: 'delapouite/coffee-cup',
  grain: 'lorc/wheat',
  sweet: 'delapouite/cupcake',
  egg: 'lorc/dinosaur-egg',
  dino: 'lorc/dinosaur-rex',
  glove: 'lorc/boxing-glove',
  scale: 'delapouite/weight-scale',
  snow: 'lorc/snowflake-2',
  drop: 'sbed/water-drop',
  trophy: 'lorc/trophy',
};

const icons = {};
for (const [name, src] of Object.entries(SOURCES)) {
  const svg = readFileSync(`.build/gi/${name}.svg`, 'utf8');
  const paths = [...svg.matchAll(/<path([^>]*)d="([^"]+)"/g)]
    .map(m => ({ attrs: m[1], d: m[2] }))
    // the first path is the black background plate; drop anything that is the full 512 square
    .filter(p => !/^M0 0h512v512H0z$/.test(p.d.trim()));
  if (!paths.length) throw new Error(`${name}: no artwork path found`);
  const [author, slug] = src.split('/');
  icons[name] = { author, slug, d: paths.map(p => p.d).join(' ') };
}

writeFileSync('design-exports/game-icons.json', JSON.stringify({
  meta: {
    source: 'https://game-icons.net',
    repo: 'https://github.com/game-icons/icons',
    licence: 'CC BY 3.0',
    viewBox: '0 0 512 512',
    note: 'Artwork as delivered. Background plate removed; paths inherit currentColor. Authors are credited in the app.',
  },
  icons,
}, null, 2) + '\n');

const authors = [...new Set(Object.values(icons).map(i => i.author))].sort();
console.log(`wrote design-exports/game-icons.json: ${Object.keys(icons).length} glyphs by ${authors.join(', ')}`);
