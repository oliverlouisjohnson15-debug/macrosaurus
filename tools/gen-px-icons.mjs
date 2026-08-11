#!/usr/bin/env node
/**
 * Writes the icon set into app/src/app.jsx from design-exports/macrosaurus-icons-16.json.
 *
 * The JSON is the delivered artwork (Claude Design project "Macrosaurus Icons"); app.jsx carries a
 * generated copy so the app stays a single self-contained bundle with no fetch at boot. Editing the
 * art means editing the JSON and re-running this - `tests/pixel-icons.test.js` fails if the two
 * drift apart.
 *
 *   node tools/gen-px-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = join(ROOT, 'design-exports', 'macrosaurus-icons-16.json');
const APP_PATH = join(ROOT, 'app', 'src', 'app.jsx');

const art = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const names = Object.keys(art.icons).sort();

for (const name of names) {
  const rows = art.icons[name];
  if (rows.length !== 16) throw new Error(`${name}: ${rows.length} rows, expected 16`);
  rows.forEach((r, i) => {
    if (r.length !== 16) throw new Error(`${name} row ${i}: ${r.length} wide, expected 16`);
    if (!/^[.#]+$/.test(r)) throw new Error(`${name} row ${i}: bad character in "${r}"`);
  });
}

// One row per line so the source reads as the picture it is - which is the whole point of authoring
// sprites in ASCII, and the only way a stray pixel is visible in a diff.
const body = names.map(name =>
  `  ${name}: [\n` + art.icons[name].map(r => `    '${r}',`).join('\n') + '\n  ],'
).join('\n');

const src = readFileSync(APP_PATH, 'utf8');
const start = src.indexOf('const PX_ICONS = {');
if (start === -1) throw new Error('PX_ICONS block not found in app.jsx');
const end = src.indexOf('\n};', start);
if (end === -1) throw new Error('end of PX_ICONS block not found');

const next = src.slice(0, start) + 'const PX_ICONS = {\n' + body + src.slice(end);
writeFileSync(APP_PATH, next);
console.log(`wrote ${names.length} icons into app/src/app.jsx`);
