// Export every icon in the app as standalone art + a manifest, for handing to a designer.
//
// Reads app/src/app.jsx (the single source for both icon systems) and writes to
// design-exports/icons/:
//   svg/<name>.svg      the 19 vector `Icon` glyphs, 24x24, currentColor -> #111
//   px/<name>.svg       the `PX_ICONS` pixel glyphs, 24x24 grid rendered as rects
//   px/<name>.txt       the same pixel glyphs as '#'/'.' grids (the editable form)
//   index.html          contact sheet: every icon at real size, 4x zoom, light + dark
//   macrosaurus-icons.pdf   the same sheet, printed by headless Chrome (skipped if absent)
//   ICONS.md            manifest: name, system, usage count, sizes in use, call sites
//
// Nothing here is imported by the app. Run: node tools/export-icons.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'app/src/app.jsx'), 'utf8');
const OUT = join(ROOT, 'design-exports/icons');

// ---- parse the vector set -------------------------------------------------
// `const Icon = { name: (a) => <svg ...>...</svg>, ... }` — one entry per line, so a line-wise
// parse is honest here and avoids pulling in a JSX parser for a read-only export.
function parseIconSet() {
  const start = SRC.indexOf('const Icon = {');
  if (start < 0) throw new Error('Icon set not found in app.jsx');
  const end = SRC.indexOf('\n};', start);
  const body = SRC.slice(start, end);
  const out = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\w+):\s*\(a\)\s*=>\s*(<svg[\s\S]*<\/svg>),?\s*$/);
    if (!m) continue;
    // {...a} is the caller's width/height/style; drop it and pin an explicit size instead.
    const svg = m[2].replace(/\{\.\.\.a\}/, 'xmlns="http://www.w3.org/2000/svg" width="24" height="24"');
    out.push({ name: m[1], svg });
  }
  return out;
}

// ---- parse the pixel set --------------------------------------------------
function parsePxIcons() {
  const start = SRC.indexOf('const PX_ICONS = {');
  const end = SRC.indexOf('\n};', start);
  const body = SRC.slice(start, end);
  const out = [];
  const re = /^\s*(\w+):\s*\[([^\]]*)\],?\s*$/gm;
  let m;
  while ((m = re.exec(body))) {
    const rows = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    out.push({ name: m[1], rows });
  }
  return out;
}

function pxToSvg(rows, fill = '#111111') {
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  const rects = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}" fill="${fill}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// ---- usage ----------------------------------------------------------------
// Sizes matter more than raw counts: a glyph redrawn on a pixel grid has to land on whole pixels,
// so every size a name is actually rendered at is part of the brief. Count the render call itself,
// never the bare name — pixel names like `egg`, `up` and `drop` collide with sprite paths, sort
// directions and set types elsewhere in the file.
function usage(callRe, sizeRe) {
  const hits = [];
  SRC.split('\n').forEach((line, i) => {
    const calls = line.match(new RegExp(callRe, 'g'));
    if (!calls) return;
    const sizes = [...line.matchAll(new RegExp(sizeRe, 'g'))].map(m => Number(m[1]));
    for (let k = 0; k < calls.length; k++) hits.push({ line: i + 1, size: sizes[k] ?? null });
  });
  return {
    count: hits.length,
    sizes: [...new Set(hits.map(h => h.size).filter(Boolean))].sort((a, b) => a - b),
    lines: [...new Set(hits.map(h => h.line))],
  };
}

const vector = parseIconSet().map(i => {
  const u = usage(`Icon\\.${i.name}\\b`, `Icon\\.${i.name}\\b[^/>]*?width="(\\d+)"`);
  return { ...i, system: 'Icon (vector)', ...u, note: u.count ? '' : '**drawn, never rendered**' };
});

// `Tick` and `Spark` are thin wrappers that always render one specific pixel glyph, so their call
// sites are real uses of `check` and `star` and have to be counted as such.
const WRAPPED = { check: 'Tick', star: 'Spark' };
// The six food kinds (plus the `dino` fallback) are never named at a call site — `foodKind()` in
// app/engine.js picks one per logged food and it arrives as `kind={...}`. Zero literal uses here
// means dynamically dispatched, not unused: these are the most-seen glyphs in the product.
const DYNAMIC = new Set(['meat', 'plant', 'drink', 'egg', 'grain', 'sweet', 'dino']);

const pixel = parsePxIcons().map(i => {
  const u = usage(`<PixelGlyph\\s+kind=["']${i.name}["']`, `kind=["']${i.name}["'][^/>]*?size=\\{(\\d+)\\}`);
  const w = WRAPPED[i.name] ? usage(`<${WRAPPED[i.name]}\\b`, `<${WRAPPED[i.name]}\\b[^/>]*?size=\\{(\\d+)\\}`) : null;
  return {
    ...i, system: 'PX_ICONS (24x24)',
    count: u.count + (w ? w.count : 0),
    sizes: [...new Set([...u.sizes, ...(w ? w.sizes : [])])].sort((a, b) => a - b),
    lines: [...u.lines, ...(w ? w.lines : [])].sort((a, b) => a - b),
    note: [
      DYNAMIC.has(i.name) ? 'dispatched by `foodKind()`' : '',
      w ? `via \`<${WRAPPED[i.name]}>\`` : '',
      (!DYNAMIC.has(i.name) && !u.count && !(w && w.count)) ? '**drawn, never rendered**' : '',
    ].filter(Boolean).join(', '),
  };
});

// Every dynamic dispatch site, listed once, so "0 literal uses" is never read as "delete it".
const dynSites = usage(`<PixelGlyph\\s+kind=\\{`, `size=\\{(\\d+)\\}`);

// ---- emoji still in the UI ------------------------------------------------
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/gu;
const emoji = new Map();
SRC.split('\n').forEach((line, i) => {
  if (/^\s*(\/\/|\*)/.test(line)) return; // comments are prose, not UI
  for (const ch of line.match(EMOJI_RE) || []) {
    if (!emoji.has(ch)) emoji.set(ch, []);
    if (emoji.get(ch).length < 6) emoji.get(ch).push(i + 1);
  }
});

// ---- write ----------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'svg'), { recursive: true });
mkdirSync(join(OUT, 'px'), { recursive: true });

for (const i of vector) writeFileSync(join(OUT, 'svg', i.name + '.svg'), i.svg.replace(/currentColor/g, '#111111') + '\n');
for (const i of pixel) {
  writeFileSync(join(OUT, 'px', i.name + '.svg'), pxToSvg(i.rows) + '\n');
  writeFileSync(join(OUT, 'px', i.name + '.txt'), i.rows.join('\n') + '\n');
}

// contact sheet
const cell = (i, art) => `<figure>
  <div class="sizes">${[16, 24, 32].map(s => `<span style="width:${s}px;height:${s}px">${art.replace(/width="\d+" height="\d+"/, `width="${s}" height="${s}"`)}</span>`).join('')}</div>
  <div class="zoom">${art.replace(/width="\d+" height="\d+"/, 'width="96" height="96"')}</div>
  <figcaption><b>${i.name}</b><small>${i.count} use${i.count === 1 ? '' : 's'}${i.sizes.length ? ' · ' + i.sizes.join('/') + 'px' : ''}</small>${i.note ? `<small class="note">${i.note.replace(/`|\*\*/g, '')}</small>` : ''}</figcaption>
</figure>`;

const html = `<!doctype html><meta charset="utf-8"><title>Macrosaurus icon export</title>
<style>
:root{--bg:#fff;--fg:#111;--mut:#777;--line:#ddd}
body.dark{--bg:#141418;--fg:#f2f2f2;--mut:#8A8A90;--line:#2c2c33}
body{background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:24px}
h1{font-size:16px} h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);border-bottom:2px solid var(--line);padding-bottom:6px;margin:32px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px}
figure{margin:0;border:2px solid var(--line);padding:10px;text-align:center}
.sizes{display:flex;gap:10px;align-items:flex-end;justify-content:center;height:36px}
.sizes span{display:inline-flex;align-items:center;justify-content:center}
.zoom{margin:10px 0;display:flex;justify-content:center}
svg{fill:currentColor;stroke:currentColor}
svg[fill="none"]{fill:none}
figcaption{display:flex;flex-direction:column;gap:2px} small{color:var(--mut);font-size:11px}
.note{font-style:italic;font-size:10px}
/* Print/PDF: the light theme only (a dark PDF wastes ink and reads worse), and no tile or
   section allowed to split across a page break — a glyph cut in half is worse than a gap. */
@media print{
  body{padding:0} button{display:none}
  figure,tr{break-inside:avoid} h2{break-after:avoid}
  .grid{grid-template-columns:repeat(4,1fr)}
}
@page{margin:14mm}
button{position:fixed;top:16px;right:16px;font:inherit;padding:6px 12px;border:2px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
td,th{text-align:left;padding:3px 12px 3px 0;font-size:12px} th{color:var(--mut)}
</style>
<button onclick="document.body.classList.toggle('dark')">light / dark</button>
<h1>Macrosaurus — every icon in the app</h1>
<p style="color:var(--mut);max-width:62ch">Each tile: the glyph at 16 / 24 / 32px (real sizes), then 4x. Colour is inherited, so what you see is the shape only. Generated from <code>app/src/app.jsx</code> by <code>tools/export-icons.mjs</code>.</p>
<h2>Icon — vector, 24x24, stroked &amp; rounded (${vector.length})</h2>
<div class="grid">${vector.map(i => cell(i, i.svg)).join('')}</div>
<h2>PX_ICONS — pixel art on a 24x24 grid (${pixel.length})</h2>
<div class="grid">${pixel.map(i => cell(i, pxToSvg(i.rows, 'currentColor'))).join('')}</div>
<h2>Emoji still rendering in the UI (${emoji.size})</h2>
<table>${[...emoji].map(([ch, ls]) => `<tr><td style="font-size:22px">${ch}</td><td>${ch.codePointAt(0).toString(16).toUpperCase()}</td><td style="color:var(--mut)">app.jsx:${ls.join(', ')}</td></tr>`).join('')}</table>
`;
writeFileSync(join(OUT, 'index.html'), html);

// manifest
const table = rows => ['| Name | Uses | Sizes in use (px) | Call sites (app.jsx) | Notes |', '|---|---|---|---|---|',
  ...rows.map(i => `| \`${i.name}\` | ${i.count} | ${i.sizes.join(', ') || '—'} | ${i.lines.slice(0, 8).join(', ')}${i.lines.length > 8 ? ' …' : ''} | ${i.note || ''} |`)].join('\n');

writeFileSync(join(OUT, 'ICONS.md'), `# Macrosaurus icon inventory

Generated by \`tools/export-icons.mjs\` from \`app/src/app.jsx\`. Do not hand-edit — re-run the script.

ONE icon system: \`PX_ICONS\` (24x24 pixel art), reached either as \`PixelGlyph kind="..."\` or as
\`Icon.name\`, which is the same art wrapped for the call sites that pass width/height. The rounded
24x24 vector set it replaced is gone, so a non-zero count under "vector" below means one has come
back. The buddy \`SpriteSheet\` is animation, not iconography, and is out of scope. \`PixelEgg\` is
the brand mark.

Art is in \`svg/\` and \`px/\` next to this file; \`index.html\` is a contact sheet showing every glyph
at its real sizes and at 4x, in light and dark.

## Icon — vector (${vector.length})

Retired, and this table should stay empty. A rounded, stroked glyph is the one thing the global
\`border-radius: 0\` reset in \`styles.css\` cannot square, because CSS cannot reach an SVG's \`rx\`
attribute or its \`strokeLinecap\`.

${table(vector)}

## PX_ICONS — pixel (${pixel.length})

24x24 grids of \`'#'\` (ink) and \`'.'\` (empty), rendered as one \`<rect>\` per run of ink at
\`shapeRendering: crispEdges\`. Every row is exactly 24 characters. The editable master is
\`design-exports/macrosaurus-icons-24.json\` and \`node tools/gen-px-icons.mjs\` writes it into
app.jsx; \`px/<name>.txt\` holds the same grid one glyph per file.

**A zero here does not mean unused.** The food glyphs are chosen at runtime by \`foodKind()\` in
\`app/engine.js\` and arrive as \`kind={...}\`, so they never appear as a literal at a call site — they
are in fact the most-seen glyphs in the product, one on every logged food. ${dynSites.count} dynamic
dispatch sites, at ${dynSites.sizes.join('/')}px: app.jsx:${dynSites.lines.join(', ')}.

${table(pixel)}

## Emoji still rendering in the UI (${emoji.size})

These are not part of either system — they are literal characters in JSX, and they inherit the
platform's emoji font, so they are the one thing in the app that looks different on every device.

| Glyph | Codepoint | app.jsx lines |
|---|---|---|
${[...emoji].map(([ch, ls]) => `| ${ch} | U+${ch.codePointAt(0).toString(16).toUpperCase()} | ${ls.join(', ')} |`).join('\n')}

## Sizes in use

Vector: ${[...new Set(vector.flatMap(i => i.sizes))].sort((a, b) => a - b).join(', ')}
Pixel: ${[...new Set(pixel.flatMap(i => i.sizes))].sort((a, b) => a - b).join(', ')}

The set ships at 24 and 48, plus 12 for the two glyphs drawn on an even sub-grid for inline use.
Any other size lands the grid off whole pixels and blurs the art, so anything else above is a bug.
`);

// ---- pdf ------------------------------------------------------------------
// Chrome prints the same contact sheet, so the PDF can never drift from the HTML. It is the one
// piece here that needs a binary we do not ship, so a missing Chrome is a warning, not a failure —
// the HTML is self-contained and shareable on its own.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(CHROME)) {
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${join(OUT, 'macrosaurus-icons.pdf')}`, 'file://' + join(OUT, 'index.html')],
    { stdio: 'ignore' });
  console.log('pdf: macrosaurus-icons.pdf');
} else {
  console.warn('Chrome not found — skipped the PDF; index.html is self-contained and shareable as is.');
}

console.log(`vector: ${vector.length}  pixel: ${pixel.length}  emoji: ${emoji.size}`);
console.log('→ design-exports/icons/');
