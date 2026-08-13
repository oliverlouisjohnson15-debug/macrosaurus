#!/usr/bin/env node
/**
 * Writes the game-icons.net artwork into app/src/app.jsx from design-exports/game-icons.json,
 * the same way tools/gen-px-icons.mjs does for the pixel set.
 *
 *   node tools/gen-gi-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = JSON.parse(readFileSync(join(ROOT, 'design-exports', 'game-icons.json'), 'utf8'));
const APP = join(ROOT, 'app', 'src', 'app.jsx');

const names = Object.keys(art.icons).sort();
const body = names.map(n => {
  const i = art.icons[n];
  if (i.d.includes("'")) throw new Error(`${n}: path contains a quote`);
  const rot = i.rot ? `, rot: ${i.rot}` : '';
  return `  ${n}: { by: '${i.author}', of: '${i.slug}'${rot}, d: '${i.d}' },`;
}).join('\n');

const src = readFileSync(APP, 'utf8');
const start = src.indexOf('const GI_ICONS = {');
if (start === -1) throw new Error('GI_ICONS block not found in app.jsx');
const end = src.indexOf('\n};', start);
writeFileSync(APP, src.slice(0, start) + 'const GI_ICONS = {\n' + body + src.slice(end));
console.log(`wrote ${names.length} game-icons glyphs into app/src/app.jsx`);
