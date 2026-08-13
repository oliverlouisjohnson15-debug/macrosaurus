#!/usr/bin/env node
/**
 * tools/gi-convert.mjs - turn a game-icons.net SVG into a glyph on our 24x24 grid.
 *
 * A naive threshold of their 512px artwork produces speckle, because their drawings carry interior
 * line work (glove seams, wheat stalks, shell highlights) that has nowhere to go at 24x24. This
 * does four things instead, in the page where a real renderer exists:
 *
 *   1. supersample - rasterise at 24x SCALE and measure coverage per cell, rather than point-sample
 *   2. solidify    - flood the background in from the border; any background NOT reached is an
 *                    interior hole, so it becomes ink. Their line work disappears and what is left
 *                    is the silhouette, which is the only thing that reads at 24px anyway
 *   3. fit         - trim to the ink, scale to the target box, and centre on the canvas, so the
 *                    glyph lands in the same live area as the rest of the set
 *   4. clean       - drop orphan pixels, fill single-pixel notches, and repeat until stable, so the
 *                    result satisfies the geometry rules in tests/pixel-icons.test.js
 *
 * Writes .build/gi-convert.html; open it and the grids are printed in the page ready to paste.
 *
 *   node tools/gi-convert.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const ART = JSON.parse(readFileSync('design-exports/macrosaurus-icons-24.json', 'utf8')).icons;
const DIR = '.build/gi';
// Only the glyphs where their choice of subject beat ours on the comparison sheet.
const TAKE = ['drop', 'trophy', 'drink', 'meat', 'plant', 'snow', 'sweet'];
const SVGS = Object.fromEntries(
  readdirSync(DIR).filter(f => f.endsWith('.svg')).map(f => f.replace('.svg', ''))
    .filter(n => TAKE.includes(n)).map(n => [n, readFileSync(`${DIR}/${n}.svg`, 'utf8')]));

// Target height in cells inside the 24 box. Pictorial glyphs in the set run 18-22 rows; a couple of
// these read better a little smaller because their shapes are wide.
const BOX = { drop: 20, trophy: 20, drink: 20, meat: 22, plant: 20, snow: 20, sweet: 20 };
// Solidifying kills interior line work, which is what rescues the glove and the wheat - but the
// cupcake IS its wrapper ridges, so that one keeps its holes.
const SOLID = { sweet: false };

const oursSvg = (name, px) => {
  const g = ART[name]; let r = '';
  g.forEach((row, y) => { let x = 0; while (x < 24) { if (row[x] === '#') { const s = x; while (x < 24 && row[x] === '#') x++; r += `<rect x="${s}" y="${y}" width="${x - s}" height="1"/>`; } else x++; } });
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" style="shape-rendering:crispEdges">${r}</svg>`;
};

const rows = TAKE.map(n => `<tr data-name="${n}"><th>${n}</th><td>${oursSvg(n, 24)}</td><td>${oursSvg(n, 96)}</td><td class="out" data-px="24"></td><td class="out" data-px="96"></td><td class="note"></td></tr>`).join('');

writeFileSync('.build/gi-convert.html', `<!doctype html><meta charset="utf-8"><title>converting</title>
<style>
 body{background:#e7e3da;color:#241f2e;font:12px ui-monospace,monospace;padding:24px}
 table{border-collapse:collapse;background:#fffdf7}
 th,td{border:2px solid #241f2e;padding:8px 12px;text-align:center}
 th{text-align:left;text-transform:uppercase;letter-spacing:.08em}
 .note{font-size:10px;color:#6b6577;max-width:22ch;text-align:left}
 pre{background:#fffdf7;border:2px solid #241f2e;padding:12px;overflow:auto;font-size:10px;line-height:1.15}
</style>
<h3>ours vs the converted silhouette</h3>
<table><thead><tr><th>glyph</th><th>ours 24</th><th>ours 4x</th><th>new 24</th><th>new 4x</th><th>checks</th></tr></thead><tbody>${rows}</tbody></table>
<h3>grids</h3><pre id="json">working...</pre>
<script>
const SVGS = ${JSON.stringify(SVGS)}, BOX = ${JSON.stringify(BOX)}, SOLID = ${JSON.stringify(SOLID)}, N = 24, SCALE = 16;
const idx = (x, y, w) => y * w + x;

function load(name) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(SVGS[name])));
  });
}

// 1+2: rasterise big, then solidify by flooding the background in from the border.
function silhouette(img, solid) {
  const S = N * SCALE;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const fg = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    fg[i] = ((d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255) > 0.5 ? 1 : 0;
  }
  const outside = new Uint8Array(S * S);
  const stack = [];
  for (let i = 0; i < S; i++) { stack.push([i, 0], [i, S - 1], [0, i], [S - 1, i]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= S || y >= S) continue;
    const i = idx(x, y, S);
    if (outside[i] || fg[i]) continue;
    outside[i] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  if (solid !== false) for (let i = 0; i < S * S; i++) if (!outside[i]) fg[i] = 1;   // interior holes become ink
  return { fg, S };
}

// 3: trim, scale to the target box, centre.
function fit(fgBig, S, box) {
  let x0 = S, x1 = -1, y0 = S, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (fgBig[idx(x, y, S)]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const scale = box / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const ox = Math.floor((N - cw) / 2), oy = Math.floor((N - ch) / 2);
  const out = Array.from({ length: N }, () => new Array(N).fill('.'));
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    // area coverage of this cell in the source box
    const sx0 = x0 + Math.floor(cx * w / cw), sx1 = x0 + Math.max(Math.floor((cx + 1) * w / cw), Math.floor(cx * w / cw) + 1);
    const sy0 = y0 + Math.floor(cy * h / ch), sy1 = y0 + Math.max(Math.floor((cy + 1) * h / ch), Math.floor(cy * h / ch) + 1);
    let on = 0, tot = 0;
    for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { tot++; if (fgBig[idx(sx, sy, S)]) on++; }
    if (tot && on / tot >= 0.5) out[oy + cy][ox + cx] = '#';
  }
  return out;
}

// 4: orphans out, single-pixel notches in, until nothing changes.
function clean(g) {
  const at = (x, y) => x >= 0 && y >= 0 && x < N && y < N && g[y][x] === '#';
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = (at(x - 1, y) ? 1 : 0) + (at(x + 1, y) ? 1 : 0) + (at(x, y - 1) ? 1 : 0) + (at(x, y + 1) ? 1 : 0);
      if (g[y][x] === '#' && n === 0) { g[y][x] = '.'; changed = true; }           // orphan
      else if (g[y][x] === '.' && n >= 3) { g[y][x] = '#'; changed = true; }        // notch
    }
    // keep the 2px margin clear
    for (let i = 0; i < N; i++) for (const [x, y] of [[i, 0], [i, 1], [i, N - 2], [i, N - 1], [0, i], [1, i], [N - 2, i], [N - 1, i]]) {
      if (g[y][x] === '#') { g[y][x] = '.'; changed = true; }
    }
    if (!changed) break;
  }
  return g;
}

function checks(g) {
  const at = (x, y) => x >= 0 && y >= 0 && x < N && y < N && g[y][x] === '#';
  let orphan = 0, thin = 0, ink = 0;
  let x0 = N, x1 = -1, y0 = N, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!at(x, y)) continue;
    ink++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    const h = !at(x - 1, y) && !at(x + 1, y), v = !at(x, y - 1) && !at(x, y + 1);
    if (h && v) orphan++;
    else if (h && v) thin++;
  }
  const mid = (N - 1) / 2;
  return { ink, orphan, thin,
    cx: +((x0 + x1) / 2 - mid).toFixed(1), cy: +((y0 + y1) / 2 - mid).toFixed(1),
    h: y1 - y0 + 1, w: x1 - x0 + 1 };
}

function draw(g, px) {
  let r = '';
  g.forEach((row, y) => { let x = 0; while (x < N) { if (row[x] === '#') { const s = x; while (x < N && row[x] === '#') x++; r += '<rect x="' + s + '" y="' + y + '" width="' + (x - s) + '" height="1"/>'; } else x++; } });
  return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" style="shape-rendering:crispEdges">' + r + '</svg>';
}

(async () => {
  const out = {};
  for (const tr of document.querySelectorAll('tr[data-name]')) {
    const n = tr.dataset.name;
    const img = await load(n);
    const { fg, S } = silhouette(img, SOLID[n]);
    const g = clean(fit(fg, S, BOX[n]));
    const rows = g.map(r => r.join(''));
    out[n] = rows;
    tr.querySelectorAll('.out').forEach(td => td.innerHTML = draw(g, +td.dataset.px));
    const c = checks(g);
    tr.querySelector('.note').textContent = 'ink ' + c.ink + ' · ' + c.w + 'x' + c.h + ' · orphans ' + c.orphan + ' · offset ' + c.cx + ',' + c.cy;
  }
  document.getElementById('json').textContent = JSON.stringify(out);
  window.GI_OUT = out;
  document.title = 'ready';
})();
</script>`);
console.log('wrote .build/gi-convert.html for', TAKE.join(', '));
