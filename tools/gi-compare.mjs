#!/usr/bin/env node
/**
 * Builds a SELF-CONTAINED comparison page: what ships today vs the game-icons.net silhouette
 * rasterised onto our 24x24 grid. The SVGs are inlined as data URIs and rasterised in the page, so
 * the file opens anywhere with no server and no network.
 *
 *   node tools/gi-tryout.mjs && node tools/gi-compare.mjs   ->  .build/gi-compare.html
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const ART = JSON.parse(readFileSync('design-exports/macrosaurus-icons-24.json', 'utf8')).icons;
const DIR = '.build/gi';
const NAMES = readdirSync(DIR).filter(f => f.endsWith('.svg')).map(f => f.replace('.svg', '')).sort();
const SVGS = Object.fromEntries(NAMES.map(n => [n, readFileSync(`${DIR}/${n}.svg`, 'utf8')]));

// Which one reads better at 24px. Judged from the render, not from the 512px artwork.
const VERDICT = {
  drop: 'theirs', trophy: 'theirs', drink: 'theirs', meat: 'theirs', plant: 'theirs',
  snow: 'theirs', sweet: 'theirs',
  dino: 'ours', grain: 'ours', glove: 'ours', scale: 'ours', egg: 'ours',
};
const WHY = {
  drop: 'a teardrop against our pentagon',
  trophy: 'a cup with handles against our goblet',
  drink: 'a cup with steam against our bowl',
  meat: 'a drumstick with a bone against our mallet',
  plant: 'broccoli against an abstract shape',
  snow: 'a lobed snowflake against an asterisk',
  sweet: 'a cupcake against a bowtie, though it is busy at 24px',
  dino: 'their rex head goes solid; a whole standing dino reads',
  grain: 'their wheat stalks disintegrate into noise at 24px',
  glove: 'their seams and highlights blur into a fuzzy mass',
  scale: 'their interior detail turns to speckle',
  egg: 'their shell highlight reads as damage, not shine',
};

const oursSvg = (name, px) => {
  const g = ART[name];
  let rects = '';
  g.forEach((r, y) => {
    let x = 0;
    while (x < 24) {
      if (r[x] === '#') { const s = x; while (x < 24 && r[x] === '#') x++; rects += `<rect x="${s}" y="${y}" width="${x - s}" height="1"/>`; }
      else x++;
    }
  });
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" style="shape-rendering:crispEdges">${rects}</svg>`;
};

const rows = NAMES.map(n => `
  <tr data-name="${n}">
    <th>${n}<span class="why">${WHY[n] || ''}</span></th>
    <td>${oursSvg(n, 24)}</td>
    <td>${oursSvg(n, 96)}</td>
    <td class="gi" data-px="24"></td>
    <td class="gi" data-px="96"></td>
    <td class="v ${VERDICT[n]}">${VERDICT[n] === 'ours' ? 'ours' : 'theirs'}</td>
  </tr>`).join('');

writeFileSync('.build/gi-compare.html', `<!doctype html><html><head><meta charset="utf-8">
<title>game-icons.net vs the shipped set, both on our 24x24 grid</title>
<style>
  :root{--bg:#e7e3da;--card:#fffdf7;--ink:#241f2e;--mut:#6b6577}
  body{background:var(--bg);color:var(--ink);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:28px}
  h1{font-size:14px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px}
  p{max-width:74ch;color:var(--mut);margin:0 0 8px}
  table{border-collapse:collapse;margin-top:20px;background:var(--card)}
  th,td{border:2px solid var(--ink);padding:10px 14px;text-align:center;vertical-align:middle}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
  thead th{background:var(--ink);color:var(--card);text-align:center}
  .why{display:block;text-transform:none;letter-spacing:0;font-size:10px;color:var(--mut);max-width:26ch;margin-top:3px}
  .v{font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:700}
  .v.ours{background:#cfe3d6}.v.theirs{background:#f0d9a8}
  .dark{--bg:#0c0c11;--card:#0c0c11;--ink:#3DFF62;--mut:#6f7a72}
  .dark table{background:#0c0c11}
  .dark thead th{background:#3DFF62;color:#0c0c11}
  .dark .v.ours{background:#123d24}.dark .v.theirs{background:#3d3312}
  section{padding:24px;margin-top:24px;background:var(--bg);color:var(--ink)}
</style></head><body>
<h1>game-icons.net, rasterised onto our 24x24 grid</h1>
<p>The right-hand pair is not the artwork from their site. It is that artwork rendered down to 24x24
and thresholded to ink, which is what adopting it would actually look like in the app. Judge the
24px columns; the 4x columns only show where the geometry breaks.</p>
<p>Verdict column is my read: seven of twelve, their choice of subject beats ours. The five where
ours wins are all cases where their 512px drawing carries interior detail that cannot survive the
downsample.</p>
<section><table><thead><tr><th>glyph</th><th>ours 24px</th><th>ours 4x</th><th>theirs 24px</th><th>theirs 4x</th><th>better</th></tr></thead><tbody>${rows}</tbody></table></section>
<section class="dark"><table><thead><tr><th>glyph</th><th>ours 24px</th><th>ours 4x</th><th>theirs 24px</th><th>theirs 4x</th><th>better</th></tr></thead><tbody>${rows}</tbody></table></section>
<script>
const SVGS = ${JSON.stringify(SVGS)};
function raster(name) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data, rows = [];
      for (let y = 0; y < 24; y++) {
        let s = '';
        for (let i = 0; i < 24; i++) {
          const o = (y * 24 + i) * 4;
          s += ((d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255) > 0.5 ? '#' : '.';
        }
        rows.push(s);
      }
      res(rows);
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(SVGS[name])));
  });
}
function draw(rows, px) {
  let r = '';
  rows.forEach((row, y) => { let x = 0; while (x < 24) { if (row[x] === '#') { const s = x; while (x < 24 && row[x] === '#') x++; r += '<rect x="' + s + '" y="' + y + '" width="' + (x - s) + '" height="1"/>'; } else x++; } });
  return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" style="shape-rendering:crispEdges">' + r + '</svg>';
}
(async () => {
  const cache = {};
  for (const tr of document.querySelectorAll('tr[data-name]')) {
    const n = tr.dataset.name;
    cache[n] = cache[n] || await raster(n);
    tr.querySelectorAll('.gi').forEach(td => { td.innerHTML = draw(cache[n], +td.dataset.px); });
  }
})();
</script></body></html>`);
console.log('wrote .build/gi-compare.html');
