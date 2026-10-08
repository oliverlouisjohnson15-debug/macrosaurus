// The collector. Same rules for the mockups and the live app, so before/after compare like with like.
//   node tools/audit.mjs mock   -> audit.json  (every screen, paper + dark, 390x844 + 320x640)
//   node tools/audit.mjs app    -> before.json (the current app in ?demo, the comparable screens)
// Serve the repo root on :8142 first (python3 -m http.server 8142).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const mode = process.argv[2] || 'mock';
const here = new URL('..', import.meta.url).pathname;
const BASE = 'http://localhost:8142/';

// Runs in the page. scope = the element the screen's content lives in.
const COLLECT = () => {
  const lum = (c) => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); if (p.length > 3 && p[3] === 0) return null; return p; };
  const blend = (fg, bg) => fg.length > 3 && fg[3] < 1 ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg.slice(0, 3);
  const bgOf = (el) => { const stack = []; let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c) { stack.push(c); if (c.length < 4 || c[3] === 1) break; } n = n.parentElement; }
    let col = [255, 255, 255]; for (let i = stack.length - 1; i >= 0; i--) col = blend(stack[i], col); return col; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const dark = document.documentElement.classList.contains('theme-dark') || document.querySelector('.theme-dark') != null;
  // fills that must never be text (paper). After dark the macro hues ARE their own text pairs (app/src/styles.css), so the check is paper-only.
  const FILLS = dark ? [] : ['#f0b429', '#c7472f', '#3d6fb4', '#e0a21b', '#2e7d6b', '#5b4fa6', '#ffd05e'];
  const ON_BAR_OK = ['#ffd05e'];

  const sheet = document.querySelector('.sheet, [role=dialog]');
  const scope = (sheet && sheet.querySelector('.body')) || sheet || document.querySelector('main') || document.body;
  const chrome = (el) => el.closest('.appbar, .tabbar, header, nav');
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const covered = (el) => sheet && !sheet.contains(el);            // under the scrim

  const out = { overflowX: document.scrollingElement.scrollWidth - innerWidth, small: [], contrast: [], fillText: [], tiny: [], blocks: 0, nested: 0, controls: 0, help: [], buddy: 0, primaryY: null };
  // text
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || covered(el)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize);
    const t = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (px < 11 && !el.closest('.vh')) out.small.push(px + 'px ' + t);
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const cr = ratio(blend(fg, bg), bg);
    const large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (cr < (large ? 3 : 4.5)) out.contrast.push(cr.toFixed(2) + ' ' + px + 'px ' + t);
    const h = hex(fg); if (FILLS.includes(h) && !(ON_BAR_OK.includes(h) && chrome(el))) out.fillText.push(h + ' ' + t);
  }
  // controls and tap targets (whole screen incl. bars), counts exclude the bars
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=switch], [role=tab], [role=menuitem], [role=textbox]')) {
    if (!visible(el) || covered(el) || el.disabled) continue;
    if (el.parentElement && el.parentElement.closest('button, a[href]')) continue;
    const r = el.getBoundingClientRect();
    if ((r.width < 44 || r.height < 44) && !el.closest('.hit')) out.tiny.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 28));
    if (!chrome(el) && (scope.contains(el) || el.closest('.foot, .sfoot'))) out.controls++;
  }
  // blocks: a frame on all four sides, a ring, or a fill different from what's behind it. Art (scenes, sprites, charts) and controls are not blocks.
  const isBlock = (el) => {
    if (el.closest('button, a, input, label, svg, .seg, .chip, .field, .hp, .scene, .terra, .viewfinder, .thumb, [role=img], .tabbar, .appbar, .tag, .day, .cell, .egg-grid')) return false;
    const r = el.getBoundingClientRect(); if (r.width < 120 || r.height < 36) return false;
    const cs = getComputedStyle(el);
    const ring = cs.boxShadow && cs.boxShadow !== 'none';
    const frame = ['Top', 'Right', 'Bottom', 'Left'].every(s => parseFloat(cs['border' + s + 'Width']) >= 2);
    const own = parse(cs.backgroundColor); const fill = own && el.parentElement && hex(bgOf(el)) !== hex(bgOf(el.parentElement));
    return ring || frame || fill;
  };
  const blocks = [...scope.querySelectorAll('*')].filter(el => visible(el) && isBlock(el));
  out.blocks = blocks.length;
  out.nested = blocks.filter(b => blocks.some(o => o !== b && o.contains(b))).length;
  // help sentences: real sentences (. ! ?) of 5+ words, outside controls and the buddy's own line
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; const p = n.parentElement;
    if (!p || !visible(p) || p.closest('button, a, [data-buddy], .appbar, .tabbar, label')) continue;
    const block = p.closest('p, div, li, td, span'); if (!block || seen.has(block)) continue; seen.add(block);
    const txt = block.textContent.replace(/\s+/g, ' ').trim();
    for (const s of txt.split(/(?<=[.!?])\s+/)) if (/[.!?]$/.test(s) && s.split(' ').length >= 5) out.help.push(s.slice(0, 60));
  }
  const top = sheet || document;
  out.buddy = top.querySelectorAll('[data-buddy]').length;
  const prim = top.querySelector('[data-primary]');
  if (prim) out.primaryY = Math.round(prim.getBoundingClientRect().top + scrollY - ((sheet && sheet.contains(prim)) ? sheet.getBoundingClientRect().top : 0));
  out.inSheet = !!sheet;
  return out;
};

const b = await chromium.launch();
const results = {};
if (mode === 'mock') {
  const list = JSON.parse(fs.readFileSync(here + 'screens.json', 'utf8'));
  for (const [w, h] of [[390, 844], [320, 640]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    for (const s of list) for (const th of ['paper', 'dark']) {
      await p.goto(BASE + 'design-plans/35-reset/mockups-full/screens/' + s.id + (th === 'dark' ? '-dark' : '') + '.html');
      await p.evaluate(() => document.fonts.ready);
      results[`${s.id}|${th}|${w}`] = await p.evaluate(COLLECT);
      if (w === 390) await p.screenshot({ path: here + 'shots/' + s.id + (th === 'dark' ? '-dark' : '') + '.png' });
    }
    await p.close();
  }
  fs.writeFileSync(here + 'audit.json', JSON.stringify(results, null, 1));
} else {
  // The current app. Primary locators match the mockups' data-primary on the same screens.
  const SCREENS = [
    ['today', [], 'kcal left'], ['food', ['^Food$'], 'Porridge'], ['cook', ['^Food$', '^Recipes$'], 'Cottage cheese'],
    ['train', ['^Train$'], 'Lower B'], ['progress', ['^Progress$'], 'Ahead of plan|This cycle'], ['you', ['You and settings'], 'Progress'],
    ['play', ['Open Play'], 'CHOMPERS|Chompers'], ['log', ['^\\+$|Log food|Add food'], 'Search foods'],
  ];
  for (const [w, h] of [[390, 844]]) for (const th of ['paper', 'dark']) {
    for (const [id, taps, prim] of SCREENS) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(BASE + 'index.html?demo' + (th === 'dark' ? '&dark' : ''), { waitUntil: 'networkidle' });
      await p.waitForTimeout(1800);
      const click = (s) => p.evaluate((s) => { const r = new RegExp(s, 'i'); const el = [...document.querySelectorAll('button,[role=button],a')].reverse().find(x => x.offsetParent && (r.test((x.textContent || '').trim()) || r.test(x.getAttribute('aria-label') || ''))); if (el) el.click(); return !!el; }, s);
      for (let i = 0; i < 3; i++) { await click('^(Maybe later|Nice one)$'); await p.waitForTimeout(300); }
      for (const t of taps) { await click(t); await p.waitForTimeout(900); }
      await p.evaluate(() => {   // name the app's chrome and its open sheet the way the mockups do, so the same rules apply
        const hb = document.querySelector('button[aria-label="You and settings"]'); if (hb && hb.parentElement) hb.parentElement.classList.add('appbar');
        const nb = [...document.querySelectorAll('.fixed.bottom-0')].find(x => /TODAY|Today/.test(x.textContent) && /PROGRESS|Progress/.test(x.textContent)); if (nb) nb.classList.add('tabbar');
        const sp = [...document.querySelectorAll('.sheet-panel')].filter(x => x.offsetParent).pop(); if (sp) sp.setAttribute('role', 'dialog');
      });
      await p.evaluate((prim) => { const r = new RegExp(prim); const sc = document.querySelector('[role=dialog]') || document.body; const el = [...sc.querySelectorAll('*')].filter(x => x.offsetParent && !x.closest('.appbar, .tabbar')).find(x => (x.placeholder && r.test(x.placeholder)) || ([...x.childNodes].some(n => n.nodeType === 3 && r.test(n.textContent)))); if (el) el.setAttribute('data-primary', ''); }, prim);
      results[`${id}|${th}|${w}`] = await p.evaluate(COLLECT);
      await p.close();
    }
  }
  fs.writeFileSync(here + 'before.json', JSON.stringify(results, null, 1));
}
await b.close();
console.log(Object.keys(results).length, 'audits');
