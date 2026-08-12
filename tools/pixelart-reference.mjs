// Build a drawing reference from the pixelarticons set (MIT, in node_modules), for deciding what
// our own glyphs should look like. Nothing here is imported by the app, and none of this art ships:
// the set is a 24x24 grid and ours is 16x16, so these are something to draw against, not to use.
//
// Writes design-exports/pixelart-reference.{html,pdf}: every chosen glyph at its real 24px, and at
// 6x over a pixel grid so a cell can be counted rather than guessed at.
//
// Run: node tools/pixelart-reference.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, globSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/pixelarticons/svg');
const OUT = join(ROOT, 'design-exports');

// Chosen for what Macrosaurus actually needs, plus a few that only earn their place by showing how
// the set solves a problem ours has not had to yet - a container, a face, a diagonal.
const GROUPS = {
  'Arrows and navigation': ['arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'chevron-left', 'chevron-right',
    'chevron-up', 'chevron-down', 'chevrons-vertical', 'corner-down-left', 'sort-vertical', 'close', 'menu',
    'more-horizontal', 'more-vertical', 'external-link'],
  'Actions': ['plus', 'minus', 'check', 'checkbox', 'checkbox-on', 'pencil', 'trash', 'undo', 'redo', 'reload',
    'download', 'upload', 'save', 'copy', 'share', 'search', 'filter', 'repeat'],
  'Food and drink': ['cake', 'coffee', 'fish'],
  'Body, time and weather': ['human', 'human-arms-up', 'heart', 'clock', 'calendar', 'moon', 'cloud-sun', 'zap'],
  'Charts and data': ['chart', 'chart-bar-big', 'chart-column-decreasing', 'list-box'],
  'Game and reward': ['trophy', 'goal', 'star', 'gamepad', 'gift', 'flag', 'crown', 'shield', 'sword', 'bookmark'],
  'Capture and media': ['camera', 'image', 'video', 'mic', 'play', 'volume-2', 'barcode'],
  'System': ['settings-cog', 'user', 'users', 'lock', 'unlock', 'bell', 'mail', 'message', 'cloud', 'home',
    'info-box', 'square-alert', 'warning-diamond', 'logout', 'power', 'wifi', 'battery'],
};

// ---- read the art -------------------------------------------------------
// Every glyph in the set is one <path> on a 24x24 viewBox. We want the path alone, so it can be
// dropped into an <svg> we control the size and colour of.
function readGlyph(name) {
  const file = join(SRC, name + '.svg');
  if (!existsSync(file)) return null;
  const s = readFileSync(file, 'utf8');
  const d = [...s.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
  if (!d.length) return null;
  return { name, d, bounds: bounds(d.join(' ')) };
}

// The tightest box the ink sits in. The set writes paths compactly - `m-2-2` is two numbers, not
// one, and a command repeats when more numbers follow it - so tokenise rather than pattern-match a
// command and its arguments together. Every glyph here is rectilinear; a curve would need real
// flattening, so say so instead of quietly reporting a box that is too small.
function bounds(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  const xs = [], ys = [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = null;
  const put = () => { xs.push(x); ys.push(y); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; if (t === 'Z' || t === 'z') { x = sx; y = sy; put(); } continue; }
    const rel = cmd === cmd.toLowerCase(), c = cmd.toUpperCase();
    if (c === 'H') { x = rel ? x + +t : +t; }
    else if (c === 'V') { y = rel ? y + +t : +t; }
    else if (c === 'M' || c === 'L') {
      const n2 = +tokens[++i];
      x = rel ? x + +t : +t; y = rel ? y + n2 : n2;
      if (c === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; } // a move's extra pairs are line-tos
    } else return null; // a curve: not something this reader can measure honestly
    put();
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const picked = [];
for (const [group, names] of Object.entries(GROUPS)) {
  const glyphs = names.map(readGlyph).filter(Boolean);
  const missing = names.filter(n => !existsSync(join(SRC, n + '.svg')));
  if (missing.length) console.warn(`skipped (not in the set): ${missing.join(', ')}`);
  picked.push([group, glyphs]);
}
const total = picked.reduce((n, [, g]) => n + g.length, 0);

// ---- the padding the set keeps ------------------------------------------
// Worth stating as a number rather than an impression: it is the single rule that makes a set of
// separately drawn glyphs look like one set, and the easiest one to break by eye.
const boxes = picked.flatMap(([, g]) => g).map(g => g.bounds).filter(Boolean);
const inset = { left: [], right: [], top: [], bottom: [] };
for (const b of boxes) { inset.left.push(b.x0); inset.right.push(24 - b.x1); inset.top.push(b.y0); inset.bottom.push(24 - b.y1); }
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const PAD = { left: median(inset.left), right: median(inset.right), top: median(inset.top), bottom: median(inset.bottom) };

// ---- render -------------------------------------------------------------
const CELL = 6, ZOOM = 24 * CELL; // 6px a cell: big enough to count, small enough for four across

const svg = (g, size, color) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" shape-rendering="crispEdges">` +
  g.d.map(d => `<path d="${d}"/>`).join('') + '</svg>';

const card = g => `<figure class="card">
  <div class="zoom">${svg(g, ZOOM, '#111')}<div class="grid"></div></div>
  <figcaption><span class="real">${svg(g, 24, '#111')}</span><code>${g.name}</code></figcaption>
</figure>`;

const html = `<title>Pixel icon reference</title>
<style>
  :root { --ink:#111; --line:#d8d8d8; --faint:#efefef; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 24px 40px; background:#fff; color:var(--ink);
         font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size:20px; margin:0 0 6px; letter-spacing:-.01em; }
  .lede { max-width:62ch; color:#444; margin:0 0 4px; }
  .lede + .lede { margin-top:10px; }
  h2 { font-size:13px; margin:30px 0 10px; padding-bottom:5px; border-bottom:1px solid var(--line);
       text-transform:uppercase; letter-spacing:.08em; page-break-after:avoid; }
  .row { display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; }
  .card { margin:0; page-break-inside:avoid; }
  .zoom { position:relative; width:${ZOOM}px; height:${ZOOM}px; border:1px solid var(--line); background:#fff; }
  .zoom svg { position:absolute; inset:0; }
  /* The grid sits over the art, so a stem can be counted without opening the file. */
  .grid { position:absolute; inset:0; pointer-events:none;
    background-image:
      repeating-linear-gradient(to right,  var(--faint) 0 1px, transparent 1px ${CELL}px),
      repeating-linear-gradient(to bottom, var(--faint) 0 1px, transparent 1px ${CELL}px); }
  figcaption { display:flex; align-items:center; gap:7px; margin-top:6px; }
  .real { display:inline-flex; width:24px; height:24px; flex:none; }
  code { font:11px/1 ui-monospace, monospace; color:#555; overflow-wrap:anywhere; }
  table { border-collapse:collapse; margin:10px 0 0; font-size:12px; }
  td, th { border:1px solid var(--line); padding:3px 9px; text-align:left; }
  @page { margin:12mm; }
</style>
<h1>Pixel icon reference — ${total} glyphs</h1>
<p class="lede">From <code>pixelarticons</code> (MIT, Gerrit Halfmann). Drawn on a <strong>24&times;24</strong>
grid; ours is 16&times;16, so nothing here drops in — it is here to draw against. Each glyph is shown at
6&times; over its pixel grid, with the real 24px beside the name.</p>
<p class="lede">The set's own spacing rule, measured across these ${boxes.length} glyphs — the median
inset from each edge. Holding one rule like this is most of what makes separately drawn glyphs read as
one family:</p>
<table><tr><th>Left</th><th>Right</th><th>Top</th><th>Bottom</th></tr>
<tr><td>${PAD.left}px</td><td>${PAD.right}px</td><td>${PAD.top}px</td><td>${PAD.bottom}px</td></tr></table>
${picked.map(([group, g]) => `<h2>${group} (${g.length})</h2><div class="row">${g.map(card).join('')}</div>`).join('\n')}
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'pixelart-reference.html'), html);

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  process.env.CHROME_PATH,
].find(p => p && existsSync(p)) || globSync('/opt/pw-browsers/chromium*/chrome-linux/chrome')[0];

if (CHROME) {
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
    `--print-to-pdf=${join(OUT, 'pixelart-reference.pdf')}`, 'file://' + join(OUT, 'pixelart-reference.html')],
    { stdio: 'ignore' });
  console.log('pdf: design-exports/pixelart-reference.pdf');
} else {
  console.warn('Chrome not found — wrote the HTML only.');
}
console.log(`${total} glyphs, median inset ${PAD.left}/${PAD.right}/${PAD.top}/${PAD.bottom}`);
