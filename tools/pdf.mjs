/* Assemble the captured screens into a single large page-map PDF. */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'fs';

const DIR = '/private/tmp/claude-501/-Users-oliverjohnson/490ad689-35c7-4b68-b8f2-a175aa09cfd9/scratchpad/map';
const OUT = process.env.PDFOUT || '/Users/oliverjohnson/Desktop/Macrosaurus-page-map.pdf';
const shots = JSON.parse(readFileSync(`${DIR}/shots.json`, 'utf8'));

const b64 = (f) => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const byId = {};
for (const s of shots) (byId[s.id] = byId[s.id] || { ...s, imgs: {} }).imgs[s.theme] = s.file;
const screens = Object.values(byId);

const LIGHT = [
  ['--bg', '#e7e3da', 'page'], ['--card', '#fffdf7', 'card'], ['--surface2', '#f8f4e8', 'inset'],
  ['--track', '#ece7dc', 'meter track'], ['--border', '#241f2e', 'ink / every frame'],
  ['--header', '#5B4FA6', 'chrome'], ['--accent', '#F0B429', 'accent (fill)'],
  ['--accent-ink', '#8A6100', 'accent (type)'], ['--cal', '#2E7D6B', 'energy'],
  ['--pro', '#C7472F', 'protein'], ['--carb', '#3D6FB4', 'carbs'], ['--fat', '#E0A21B', 'fat'],
  ['--weight', '#5B4FA6', 'fibre / streak'], ['--muted', '#6b6459', 'muted type'],
];
const DARK = [
  ['--bg', '#050507', 'page'], ['--card', '#0c0c11', 'card'], ['--surface2', '#101017', 'inset'],
  ['--track', '#1a1a22', 'meter track'], ['--border', '#2f2f3a', 'frame'],
  ['--header', '#000000', 'chrome'], ['--accent', '#3DFF62', 'accent'],
  ['--accent-ink', '#3DFF62', 'accent (type)'], ['--cal', '#3DFF62', 'energy'],
  ['--pro', '#3DFF62', 'protein'], ['--carb', '#35E0E8', 'carbs'], ['--fat', '#FF4FD0', 'fat'],
  ['--weight', '#9B7BFF', 'fibre / streak'], ['--muted', '#7c7c88', 'muted type'],
];
const sw = (rows) => rows.map(([t, v, use]) =>
  `<div class="sw"><span class="chip" style="background:${v}"></span><b>${t}</b><code>${v}</code><i>${use}</i></div>`).join('');

const page = (cls, inner) => `<section class="${cls}">${inner}</section>`;

const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: 420mm 560mm; margin: 0; }
* { box-sizing: border-box; }
body { margin:0; font-family: "IBM Plex Mono", ui-monospace, monospace; color:#241f2e; background:#e7e3da; }
section { width:420mm; height:560mm; padding:22mm 20mm; page-break-after:always; display:flex; flex-direction:column; }
h1 { font-size:34pt; margin:0 0 6mm; letter-spacing:-.5pt; }
h2 { font-size:20pt; margin:0 0 2mm; }
.kick { font-size:10pt; letter-spacing:.22em; text-transform:uppercase; color:#6b6459; margin:0 0 3mm; }
p { font-size:11pt; line-height:1.55; margin:0 0 4mm; max-width:250mm; }
.rule { height:3px; background:#241f2e; margin:5mm 0 7mm; }
.pair { flex:1; display:flex; gap:14mm; justify-content:center; align-items:flex-start; min-height:0; }
.col { display:flex; flex-direction:column; align-items:center; gap:3mm; min-height:0; }
.col span { font-size:9pt; letter-spacing:.2em; text-transform:uppercase; color:#6b6459; }
.col img { max-height:440mm; width:auto; max-width:180mm; border:3px solid #241f2e; box-shadow:5px 5px 0 #241f2e; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:10mm 16mm; }
.sw { display:flex; align-items:center; gap:4mm; font-size:10pt; padding:1.5mm 0; }
.sw .chip { width:11mm; height:11mm; border:2px solid #241f2e; flex:none; }
.sw b { width:38mm; font-weight:600; } .sw code { width:24mm; color:#6b6459; } .sw i { color:#6b6459; font-style:normal; }
.panel { border:3px solid #241f2e; background:#fffdf7; padding:8mm; }
.panel.dark { background:#0c0c11; border-color:#2f2f3a; color:#e8e8ea; }
.panel.dark .sw .chip { border-color:#2f2f3a; } .panel.dark .sw code, .panel.dark .sw i { color:#7c7c88; }
.toc { column-count:2; column-gap:16mm; font-size:11.5pt; line-height:2; }
.toc div { break-inside:avoid; } .toc b { display:inline-block; width:14mm; color:#6b6459; }
.note { font-size:10.5pt; color:#6b6459; }
ul { font-size:11pt; line-height:1.75; margin:0 0 5mm; padding-left:6mm; }
</style>

${page('', `
  <p class="kick">Macrosaurus · Paper Terrarium</p>
  <h1>Page map</h1>
  <div class="rule"></div>
  <p>Every screen in the app, captured from the live build in both themes, as a base for a full
  pre-design pass. Shot at 390&times;844 (iPhone 14/15 logical size) at 2&times;. Screens that scroll are
  captured full-length; sheets and modals are captured at viewport height, which is what they are
  laid out against.</p>
  <p>The two themes are <b>not</b> variants of one palette. Paper is the default and is built on ink
  frames over warm stock. Dark keeps Macrosaurus's original neon-on-black identity on the same
  layout, weight and type. Anything redesigned needs to work in both.</p>
  <div class="rule"></div>
  <h2>Contents</h2>
  <div class="toc">${screens.map((s, i) => `<div><b>${String(i + 1).padStart(2, '0')}</b>${s.title}</div>`).join('')}</div>
`)}

${page('', `
  <p class="kick">Foundations</p>
  <h1>The system</h1>
  <div class="rule"></div>
  <div class="grid">
    <div>
      <h2>Type</h2>
      <ul>
        <li><b>Silkscreen</b> &mdash; chrome only: labels, numbers, nav, section headings. Tracked
        0.08&ndash;0.16em; the tracking is most of what makes a 9px uppercase label read as a label.</li>
        <li><b>IBM Plex Mono</b> &mdash; all prose. Body 13.5px / 1.55.</li>
        <li>Ladder: 34 / 29 / 25 / 20 / 16 / 14 display; 13.5 / 12.5 / 12 / 11 / 10 text.</li>
      </ul>
      <h2>Chrome</h2>
      <ul>
        <li>3px outer frame, 2px inner rules. One step of hierarchy, no more.</li>
        <li>Hard offset shadow, 3px, no blur. Ink on paper; <code>#2f2f3a</code> after dark.</li>
        <li>Zero border-radius anywhere.</li>
        <li>Meters are 20 discrete cells butted together behind 1px hairlines.</li>
        <li>Card = filled title bar + divided interior. Never a padded box with hairlines.</li>
      </ul>
    </div>
    <div>
      <h2>Rules worth keeping</h2>
      <ul>
        <li><b>Fill vs ink.</b> A colour that works as a 13px meter block can be invisible as 9px
        type &mdash; the gold measures 1.8:1 on the card. Every accent has a darkened
        <code>-ink</code> twin for type. Never set small text in a fill colour.</li>
        <li><b>4.5:1 against the page</b>, not just the card. The page <code>#e7e3da</code> is the
        harshest surface and much of the app sits directly on it.</li>
        <li><b>One hero.</b> The buddy panel is ringed neon after dark and plain on paper; the light
        theme takes its hierarchy from position and size instead.</li>
      </ul>
    </div>
  </div>
  <div class="rule"></div>
  <div class="grid">
    <div class="panel"><h2 style="margin-bottom:4mm">Paper (default)</h2>${sw(LIGHT)}</div>
    <div class="panel dark"><h2 style="margin-bottom:4mm">Dark</h2>${sw(DARK)}</div>
  </div>
`)}

${screens.map((s, i) => page('', `
  <p class="kick">${String(i + 1).padStart(2, '0')} · ${s.id}</p>
  <h1>${s.title}</h1>
  <p class="note">${s.note}</p>
  <div class="rule"></div>
  <div class="pair">
    ${['light', 'dark'].filter(t => s.imgs[t]).map(t =>
      `<div class="col"><span>${t}</span><img src="${b64(s.imgs[t])}"></div>`).join('')}
  </div>
`)).join('')}
`;

writeFileSync(`${DIR}/map.html`, html);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await browser.newPage();
await p.goto('file://' + DIR + '/map.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.pdf({ path: OUT, width: '420mm', height: '560mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log('wrote', OUT);
