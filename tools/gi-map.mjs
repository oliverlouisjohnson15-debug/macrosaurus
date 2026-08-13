#!/usr/bin/env node
/**
 * tools/gi-map.mjs - map every glyph in the set to a game-icons.net drawing and fetch it.
 *
 * game-icons is a game library, so it is rich in objects and thin in UI chrome: there is no
 * chevron, no caret and no barcode in 4,239 icons. Where a shape is only a direction, one arrow is
 * reused and rotated rather than a different drawing picked, which is also how the set stays
 * coherent - `rot` is applied about the centre of the 512 box at render time.
 *
 *   node tools/gi-map.mjs           # resolves, downloads to .build/gi/, writes the json
 *
 * Anything that could not be matched is listed at the end rather than quietly skipped.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const TREE = 'https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1';
const RAW = 'https://raw.githubusercontent.com/game-icons/icons/master/';
const OUT = '.build/gi';

// our name -> [game-icons slug, rotation in degrees]
// A rotation means "same drawing, turned", never "a different icon that happens to point that way".
const MAP = {
  // nav and chrome
  dash: ['cubes'], food: ['fork-knife-spoon'], recipe: ['cooking-pot'],
  dumbbell: ['weight-lifting-up'], goal: ['bullseye'], more: ['hamburger-menu'],
  // affordances
  chevron: ['plain-arrow', -90], close: ['cancel'], check: ['check-mark'], star: ['star'],
  caret_up: ['plain-arrow', 180], caret_down: ['plain-arrow'],
  tri_up: ['play-button', -90], tri_down: ['play-button', 90],
  dot: ['plain-circle'], square: ['plain-square'],
  // arrows
  arrow_up: ['plain-arrow', 180], arrow_left: ['plain-arrow', 90], arrow_right: ['plain-arrow', -90],
  corner_arrow: ['return-arrow'], trend_up: ['plain-arrow', -135], trend_down: ['plain-arrow', -45],
  // actions
  plus: ['plus'], cam: ['photo-camera'], photo: ['film-strip'], barcode: ['price-tag'],
  mic: ['microphone'], share: ['share'], cart: ['shopping-cart'], gear: ['cog'],
  sliders: ['settings-knobs'], calendar: ['calendar'], edit: ['pencil'], play: ['play-button'],
  // food types
  meat: ['chicken-leg'], plant: ['broccoli'], drink: ['coffee-cup'], grain: ['wheat'],
  sweet: ['cupcake'], egg: ['dinosaur-egg'], dino: ['dinosaur-rex'],
  // buddy, game and stats
  trophy: ['trophy'], glove: ['boxing-glove'], scale: ['weight-scale'], drop: ['water-drop'],
  sun: ['sun'], moon: ['moon'], snow: ['snowflake-2'], bolt: ['bolt'],
  flashlight: ['flashlight'], chat: ['chat-bubble'], figure: ['person'], lock: ['padlock'],
  info: ['info'],
  // the bond meter fills a heart in place, and game-icons has no hollow one: same drawing, and the
  // caller already passes a different ink for empty, which is what the meter actually reads by.
  heart_full: ['heart'], heart_empty: ['heart'],
};

// Prefer these authors when a slug exists in more than one folder: delapouite draws the flat,
// modern, UI-ish end of the library and lorc the ornate one, so this keeps the set in one hand.
const PREFER = ['delapouite', 'lorc', 'sbed', 'skoll', 'carl-olsen', 'darkzaitzev'];

const tree = await (await fetch(TREE)).json();
const bySlug = {};
for (const f of tree.tree) {
  if (!f.path.endsWith('.svg')) continue;
  const [author, file] = f.path.split('/');
  const slug = file.replace('.svg', '');
  (bySlug[slug] = bySlug[slug] || []).push(author);
}

mkdirSync(OUT, { recursive: true });
const icons = {}, missing = [];
for (const [name, [slug, rot]] of Object.entries(MAP)) {
  const authors = bySlug[slug];
  if (!authors) { missing.push(`${name} -> ${slug}`); continue; }
  const author = PREFER.find(a => authors.includes(a)) || authors[0];
  const file = `${OUT}/${name}.svg`;
  const svg = existsSync(file) && readFileSync(file, 'utf8').includes('512')
    ? readFileSync(file, 'utf8')
    : await (await fetch(`${RAW}${author}/${slug}.svg`)).text();
  writeFileSync(file, svg);
  const paths = [...svg.matchAll(/<path([^>]*)d="([^"]+)"/g)]
    .map(m => m[2]).filter(d => !/^M0 0h512v512H0z$/.test(d.trim()));
  if (!paths.length) { missing.push(`${name} -> ${slug} (no artwork path)`); continue; }
  icons[name] = { author, slug, d: paths.join(' ') };
  if (rot) icons[name].rot = rot;
}

writeFileSync('design-exports/game-icons.json', JSON.stringify({
  meta: {
    source: 'https://game-icons.net',
    repo: 'https://github.com/game-icons/icons',
    licence: 'CC BY 3.0',
    viewBox: '0 0 512 512',
    note: 'Artwork as delivered. Background plate removed; paths inherit currentColor. `rot` turns a drawing about the centre of the box, so one arrow serves several directions. Authors are credited in the app.',
  },
  icons,
}, null, 2) + '\n');

console.log(`mapped ${Object.keys(icons).length} glyphs`);
if (missing.length) console.log('MISSING:\n  ' + missing.join('\n  '));
