/*
 * gen-web-images.mjs - renders the pixel-art images on the public site (web/img/*.png).
 *
 * Why images at all: the rest of web/index.html is CSS and canvas drawn, which a person sees but a
 * crawler does not, so there was nothing for image search to index and nothing for a link preview
 * to show beyond og.png. These are real PNGs with real alt text in the page.
 *
 * Everything is drawn from the same sprites and the same Silkscreen face the site uses, scaled by
 * whole numbers with smoothing off so the pixels stay square. Re-run after changing the art:
 *   node tools/gen-web-images.mjs        (needs playwright and the Chromium in PLAYWRIGHT_BROWSERS_PATH)
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(resolve(process.env.PLAYWRIGHT_NODE_PATH || '/opt/node22/lib/node_modules/playwright'))); }

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'web/img');
mkdirSync(out, { recursive: true });

// The Silkscreen @font-face is inlined in index.html as base64; reuse it rather than ship a second copy.
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const fontFace = html.match(/@font-face\{font-family:"Silkscreen"[^}]+\}/)[0];

const SPECIES = [['doux', 'Doux'], ['cole', 'Cole'], ['kira', 'Kira'], ['kuro', 'Kuro'], ['loki', 'Loki'], ['mono', 'Mono'],
  ['mort', 'Mort'], ['nico', 'Nico'], ['olaf', 'Olaf'], ['sena', 'Sena'], ['tard', 'Taro'], ['vita', 'Vita']];
const sprite = (p) => pathToFileURL(resolve(root, p)).href;

const css = `
${fontFace}
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url(${sprite('web/fonts/plex-mono-400.woff2')});}
@font-face{font-family:'IBM Plex Mono';font-weight:700;src:url(${sprite('web/fonts/plex-mono-700.woff2')});}
:root{--ink:#241f2e;--paper:#e7e3da;--card:#fffdf7;--purple:#5B4FA6;--gold:#F0B429;--sky:#fdf1e7;--ground:#f3e4d4;--teal:#2E7D6B;--red:#C7472F;--blue:#3D6FB4;--muted:#6b6459;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--purple);font-family:'IBM Plex Mono',monospace;color:var(--ink);}
.pix{font-family:Silkscreen,monospace;letter-spacing:.08em;}
canvas{image-rendering:pixelated;display:block;}
.frame{border:5px solid var(--ink);box-shadow:7px 7px 0 var(--ink);background:var(--card);}
`;

// draw frame `f` of a 24px strip, whole-number scaled, onto a canvas the page already has
const drawJs = `
async function load(src){return new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=src;});}
const jobs=[];function put(cv,src,f,s){const j=_put(cv,src,f,s);jobs.push(j);return j;}
async function _put(cv,src,f,s){const i=await load(src);cv.width=24*s;cv.height=24*s;const x=cv.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(i,f*24,0,24,24,0,0,24*s,24*s);}
`;

const pages = {
  // 12 species roster, 6 x 2
  'dino-roster.png': { w: 1200, h: 620, body: `
    <div style="padding:34px 40px 0;display:flex;justify-content:space-between;align-items:center">
      <div class="pix" style="color:#fffdf7;font-size:30px;line-height:1.4">TWELVE DINOS TO HATCH.<br><span style="color:var(--gold)">ONE IS YOURS.</span></div>
      <div class="pix" style="color:#ddd7f2;font-size:15px;text-align:right;line-height:1.8">MACROSAURUS<br>DINO BUDDIES</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:22px;padding:30px 40px 0">
      ${SPECIES.map(([id, n]) => `<div class="frame"><div style="background:var(--sky);height:150px;position:relative;display:flex;align-items:flex-end;justify-content:center">
        <div style="position:absolute;left:0;right:0;bottom:0;height:34px;background:var(--ground);border-top:4px solid var(--ink)"></div>
        <canvas data-sp="${sprite('web/sprites/' + id + '-idle.png')}" style="position:relative;margin-bottom:18px"></canvas></div>
        <div class="pix" style="font-size:15px;text-align:center;padding:11px 0;border-top:5px solid var(--ink)">${n.toUpperCase()}</div></div>`).join('')}
    </div>`,
    js: `document.querySelectorAll('canvas[data-sp]').forEach(c=>put(c,c.dataset.sp,0,5));` },

  // egg to buddy
  'egg-to-dino.png': { w: 1200, h: 370, body: `
    <div class="pix" style="color:#fffdf7;font-size:26px;padding:30px 40px 0">FROM EGG TO BUDDY. YOU DO THE EATING.</div>
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;padding:26px 40px 0">
      ${['EGG', 'CRACKING', 'HATCHING', 'HATCHLING', 'BUDDY'].map((l, i) => `<div class="frame"><div style="background:var(--sky);height:190px;position:relative;display:flex;align-items:flex-end;justify-content:center">
        <div style="position:absolute;left:0;right:0;bottom:0;height:34px;background:var(--ground);border-top:4px solid var(--ink)"></div>
        <canvas id="s${i}" style="position:relative;margin-bottom:16px"></canvas></div>
        <div class="pix" style="font-size:14px;text-align:center;padding:11px 0;border-top:5px solid var(--ink)">${l}</div></div>`).join('')}
    </div>`,
    js: `put(s0,'${sprite('sprites/female/olaf/egg/move.png')}',0,6);put(s1,'${sprite('sprites/female/olaf/egg/crack.png')}',2,6);
         put(s2,'${sprite('sprites/female/olaf/egg/hatch.png')}',3,6);put(s3,'${sprite('web/sprites/doux-idle.png')}',0,4);
         put(s4,'${sprite('sprites/female/doux/base/cheer.png')}',1,7);` },

  // weekly check-in (illustrative numbers, labelled EXAMPLE)
  'weekly-checkin.png': { w: 1200, h: 540, body: `
    <div style="padding:46px 60px">
      <div class="pix" style="color:#fffdf7;font-size:28px">YOUR TARGETS RETUNE EVERY WEEK</div>
      <div class="frame" style="margin-top:30px;background:var(--card)">
        <div class="pix" style="background:var(--ink);color:#f4f1ea;font-size:15px;padding:11px 20px;display:flex;justify-content:space-between"><span>WEEK 6 CHECK-IN</span><span>EXAMPLE</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-bottom:5px solid var(--ink)">
          ${[['TREND WEIGHT', '78.4 kg', '-0.4 kg this week', 'var(--teal)'], ['DAILY CALORIES', '2,140', 'was 2,180', 'var(--blue)'], ['DAILY PROTEIN', '172 g', 'unchanged', 'var(--red)']].map(([a, b, c, col], i) => `
          <div style="padding:26px 24px;${i < 2 ? 'border-right:5px solid var(--ink);' : ''}">
            <div class="pix" style="font-size:13px;color:var(--muted)">${a}</div>
            <div class="pix" style="font-size:44px;color:${col};margin-top:14px;line-height:1">${b}</div>
            <div class="pix" style="font-size:13px;color:var(--muted);margin-top:14px">${c}</div></div>`).join('')}
        </div>
        <div style="padding:24px 28px;background:#f8f4e8;font-size:21px;line-height:1.6"><b>Why it moved:</b> your trend weight is dropping a touch faster than your goal rate, so calories ease up slightly to protect your training. Every change comes with its reason.</div>
      </div>
    </div>` , js: '' },
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, p] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
  // a real file: page, not setContent, so the file:// sprite URLs are allowed to load
  const tmp = resolve(mkdtempSync(resolve(tmpdir(), 'webimg-')), 'p.html');
  writeFileSync(tmp, `<!doctype html><meta charset=utf-8><style>${css}</style><body style="width:${p.w}px;height:${p.h}px">${p.body}<script>${drawJs}(async()=>{${p.js}await Promise.all(jobs);await document.fonts.ready;document.body.dataset.ready=1;})()</script></body>`);
  await page.goto(pathToFileURL(tmp).href);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(out, name), clip: { x: 0, y: 0, width: p.w, height: p.h } });
  await page.close();
  console.log('wrote web/img/' + name);
}
await browser.close();
