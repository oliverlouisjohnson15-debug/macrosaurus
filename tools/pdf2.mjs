/* Page map, part two: the surfaces with no design yet. */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'fs';
const DIR = '/private/tmp/claude-501/-Users-oliverjohnson/490ad689-35c7-4b68-b8f2-a175aa09cfd9/scratchpad/map2';
const OUT = '/Users/oliverjohnson/Desktop/Macrosaurus-undesigned-map.pdf';
const shots = JSON.parse(readFileSync(`${DIR}/shots.json`, 'utf8'))
  .filter(s => s.id !== 'density');   // that capture landed on the edit sheet; better absent than mislabelled
const b64 = f => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const byId = {};
for (const s of shots) (byId[s.id] = byId[s.id] || { ...s, imgs: {} }).imgs[s.theme] = s.file;
const screens = Object.values(byId).sort((a, b) => a.tier - b.tier);

const TIERS = {
  1: 'Tier 1 — seen daily or weekly, one tap behind a redesigned page',
  2: 'Tier 2 — settings archetype (one design covers all twelve)',
  3: 'Tier 3 — Cook and Train subscreens',
  4: 'Tier 4 — first run',
  6: 'Tier 6 — utility',
};
const page = inner => `<section>${inner}</section>`;

const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: 420mm 560mm; margin: 0; }
* { box-sizing: border-box; }
body { margin:0; font-family:"IBM Plex Mono",ui-monospace,monospace; color:#241f2e; background:#e7e3da; }
section { width:420mm; height:560mm; padding:22mm 20mm; page-break-after:always; display:flex; flex-direction:column; }
h1 { font-size:34pt; margin:0 0 6mm; letter-spacing:-.5pt; }
h2 { font-size:19pt; margin:0 0 3mm; }
.kick { font-size:10pt; letter-spacing:.22em; text-transform:uppercase; color:#6b6459; margin:0 0 3mm; }
p { font-size:11pt; line-height:1.55; margin:0 0 4mm; max-width:250mm; }
.rule { height:3px; background:#241f2e; margin:5mm 0 7mm; }
.pair { flex:1; display:flex; gap:14mm; justify-content:center; align-items:flex-start; min-height:0; }
.col { display:flex; flex-direction:column; align-items:center; gap:3mm; min-height:0; }
.col span { font-size:9pt; letter-spacing:.2em; text-transform:uppercase; color:#6b6459; }
.col img { max-height:440mm; width:auto; max-width:180mm; border:3px solid #241f2e; box-shadow:5px 5px 0 #241f2e; }
.note { font-size:10.5pt; color:#6b6459; }
.tier { display:inline-block; border:2px solid #241f2e; background:#F0B429; padding:1.5mm 3mm; font-size:9pt; letter-spacing:.12em; text-transform:uppercase; margin-bottom:4mm; }
ul { font-size:11pt; line-height:1.8; margin:0 0 5mm; padding-left:6mm; }
.toc { column-count:2; column-gap:16mm; font-size:11.5pt; line-height:1.95; }
.toc div { break-inside:avoid; } .toc b { display:inline-block; width:12mm; color:#6b6459; }
.toc .grp { font-weight:600; margin-top:3mm; display:block; }
</style>

${page(`
  <p class="kick">Macrosaurus · Paper Terrarium</p>
  <h1>What still needs designing</h1>
  <div class="rule"></div>
  <p>Seven surfaces have a Claude Design file and are built. Around seventy do not. This is the
  second half of the map: the screens behind the ones already redesigned, captured from the live
  build in both themes so the seam is visible.</p>
  <p><b>Most of these are not individual designs.</b> Twelve settings subscreens are one archetype
  built from the same field primitives. Twenty-odd sheets are one bottom-sheet archetype. Five
  archetypes cover nearly all of it — the same way seven page designs let the token layer and one
  <code>CardHead</code> component cover every card in the app.</p>
  <div class="rule"></div>
  <h2>The five archetypes worth designing</h2>
  <ul>
    <li><b>A settings subscreen</b> — covers Tier 2 outright, ~12 screens.</li>
    <li><b>A bottom sheet</b> (header, body, primary action) — covers most of Tiers 1 and 6, ~20 surfaces.</li>
    <li><b>A multi-step flow</b> — check-in, block builder, onboarding.</li>
    <li><b>A detail page</b> (hero image, sections, sticky action) — recipe detail, exercise, block.</li>
    <li><b>The live session screen</b> — genuinely one of a kind.</li>
  </ul>
  <p>The two that will <b>not</b> fall out of an archetype are <b>recipe detail</b> and the
  <b>training session player</b>. Both are high traffic and both carry layout that exists nowhere
  else in the app. If only two individual pages get designed, those are the two.</p>
  <div class="rule"></div>
  <h2>Contents</h2>
  <div class="toc">${[1, 2, 3, 4, 6].filter(t => screens.some(s => s.tier === t)).map(t =>
    `<div><span class="grp">${TIERS[t]}</span></div>` +
    screens.filter(s => s.tier === t).map((s, i) => `<div><b>${String(screens.indexOf(s) + 1).padStart(2, '0')}</b>${s.title}</div>`).join('')
  ).join('')}</div>
`)}

${screens.map((s, i) => page(`
  <p class="kick">${String(i + 1).padStart(2, '0')} · ${s.id}</p>
  <span class="tier">${TIERS[s.tier] || 'Tier ' + s.tier}</span>
  <h1>${s.title}</h1>
  <p class="note">${s.note}</p>
  <div class="rule"></div>
  <div class="pair">
    ${['light', 'dark'].filter(t => s.imgs[t]).map(t => `<div class="col"><span>${t}</span><img src="${b64(s.imgs[t])}"></div>`).join('')}
  </div>
`)).join('')}
`;
writeFileSync(`${DIR}/map2.html`, html);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await browser.newPage();
await p.goto('file://' + DIR + '/map2.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.pdf({ path: OUT, width: '420mm', height: '560mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log('wrote', OUT, '—', screens.length + 1, 'pages');
