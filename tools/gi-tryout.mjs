#!/usr/bin/env node
/**
 * tools/gi-tryout.mjs - the game-icons.net試 test page.
 *
 * Question it answers: do game-icons.net silhouettes survive being rasterised onto our 24x24 grid?
 * They are 512x512 white-on-black illustrations, so this renders each to 24x24 on a canvas in the
 * browser, thresholds it to ink/empty, and shows the result beside the glyph we ship today - at
 * real size, and at 6x so the geometry is visible.
 *
 * The rasterising happens in the page (canvas), not here: this only writes the harness.
 *
 *   node tools/gi-tryout.mjs      then open http://localhost:8137/.build/gi.html
 *
 * Nothing here ships. `.build/` is gitignored.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const ART = JSON.parse(readFileSync('design-exports/macrosaurus-icons-24.json', 'utf8')).icons;
const NAMES = readdirSync('.build/gi').filter(f => f.endsWith('.svg')).map(f => f.replace('.svg', ''));

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
    <th>${n}</th>
    <td class="ours">${oursSvg(n, 24)}</td>
    <td class="ours big">${oursSvg(n, 144)}</td>
    <td class="gi" data-px="24"></td>
    <td class="gi big" data-px="144"></td>
    <td class="grid"></td>
  </tr>`).join('');

writeFileSync('.build/gi.html', `<!doctype html><meta charset="utf-8">
<title>game-icons.net on our grid</title>
<style>
  body{background:#e7e3da;color:#241f2e;font:13px ui-monospace,monospace;padding:24px}
  h1{font-size:15px;letter-spacing:.1em;text-transform:uppercase}
  p{max-width:70ch;line-height:1.5;color:#5a5566}
  table{border-collapse:collapse;margin-top:16px}
  th,td{border:2px solid #241f2e;padding:8px 12px;text-align:center;background:#fffdf7}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;text-align:left}
  thead th{background:#241f2e;color:#fffdf7}
  .grid{font:9px/9px ui-monospace,monospace;white-space:pre;text-align:left;color:#8a8496}
  .dark td,.dark th{background:#0c0c11;color:#3DFF62;border-color:#3DFF62}
  .dark thead th{background:#3DFF62;color:#0c0c11}
</style>
<h1>game-icons.net, rasterised onto our 24x24 grid</h1>
<p>Left pair is what ships today. Right pair is the game-icons.net silhouette rendered to 24x24 and
thresholded to ink, which is what adopting it would actually look like - not the 512px artwork on
their site. Judge the 24px column; the 6x column is only there to show where the geometry breaks.</p>
<table id="light"><thead><tr><th>glyph</th><th>ours 24px</th><th>ours 6x</th><th>theirs 24px</th><th>theirs 6x</th><th>grid</th></tr></thead><tbody>${rows}</tbody></table>
<h1 style="margin-top:32px">the same, dark theme</h1>
<table id="dark" class="dark"><thead><tr><th>glyph</th><th>ours 24px</th><th>ours 6x</th><th>theirs 24px</th><th>theirs 6x</th><th>grid</th></tr></thead><tbody>${rows}</tbody></table>
<script>
const GRIDS = {};
async function raster(name) {
  const svg = await (await fetch('gi/' + name + '.svg')).text();
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); });
  const c = document.createElement('canvas'); c.width = c.height = 24;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.drawImage(img, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data;
  const rows = [];
  for (let y = 0; y < 24; y++) {
    let s = '';
    for (let i = 0; i < 24; i++) {
      const o = (y * 24 + i) * 4;
      // white foreground on black background, so luminance is the ink test
      const lum = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255;
      s += lum > 0.5 ? '#' : '.';
    }
    rows.push(s);
  }
  return rows;
}
function draw(rows, px) {
  let r = '';
  rows.forEach((row, y) => { let x = 0; while (x < 24) { if (row[x] === '#') { const s = x; while (x < 24 && row[x] === '#') x++; r += '<rect x="' + s + '" y="' + y + '" width="' + (x - s) + '" height="1"/>'; } else x++; } });
  return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" style="shape-rendering:crispEdges">' + r + '</svg>';
}
(async () => {
  for (const tr of document.querySelectorAll('tr[data-name]')) {
    const n = tr.dataset.name;
    const rows = GRIDS[n] || (GRIDS[n] = await raster(n));
    tr.querySelectorAll('.gi').forEach(td => { td.innerHTML = draw(rows, +td.dataset.px); });
    const g = tr.querySelector('.grid');
    if (g) g.textContent = rows.join('\\n');
  }
  window.GI_GRIDS = GRIDS;
  document.title = 'ready';
})();
</script>`);
console.log('wrote .build/gi.html for', NAMES.length, 'glyphs');
