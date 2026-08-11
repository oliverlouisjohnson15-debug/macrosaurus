// Measure the built app rather than reasoning about it: contrast of every text node against its
// painted background, tap-target sizes, and the smallest type actually in use.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8142/index.html?demo', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const click = async (rx) => { await p.evaluate(s => { const r = new RegExp(s); const el = [...document.querySelectorAll('button')].find(x => r.test(x.textContent.trim())); if (el) el.click() }, rx.source); await p.waitForTimeout(700); };
for (let i = 0; i < 6; i++) await click(/^(Maybe later|Nice one)$/);

const AUDIT = `(() => {
  const lum = (c) => { const [r,g,bl] = c.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*bl; };
  const parse = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return p[3] === 0 ? null : p.slice(0,3); };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c) return c; n = n.parentElement; } return [255,255,255]; };
  const ratio = (a,b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2); return (hi+0.05)/(lo+0.05); };
  const out = { contrast: [], targets: [], sizes: {} };
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const fg = parse(cs.color), bg = bgOf(el);
      const px = parseFloat(cs.fontSize);
      out.sizes[px] = (out.sizes[px] || 0) + 1;
      if (fg) {
        const cr = ratio(fg, bg);
        const large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
        const need = large ? 3 : 4.5;
        if (cr < need) out.contrast.push({ t: el.textContent.trim().slice(0,42), px, cr: +cr.toFixed(2), need, color: cs.color });
      }
    }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && !el.disabled) {
      const hit = el.classList.contains('hit');
      if (!hit && (r.width < 24 || r.height < 24)) out.targets.push({ t: (el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,30), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return out;
})()`;

for (const [name, taps] of [['today', []], ['food', [/^FOOD$/]], ['session', [/^TRAIN$/, /Open Lower B/, /Start Lower B/]]]) {
  for (const t of taps) await click(t);
  const r = await p.evaluate(AUDIT);
  console.log('\n===== ' + name + ' =====');
  console.log('type sizes in use:', Object.entries(r.sizes).sort((a,b)=>a[0]-b[0]).map(([k,v])=>k+'px x'+v).join('  '));
  console.log('contrast failures (' + r.contrast.length + '):');
  const seen = new Set();
  for (const c of r.contrast) { const k = c.color + c.px; if (seen.has(k)) continue; seen.add(k); console.log('   ', c.cr + ':1 (needs ' + c.need + ')', c.px + 'px', c.color, '·', JSON.stringify(c.t)); }
  console.log('sub-24px targets (' + r.targets.length + '):', r.targets.slice(0,8).map(t=>`${t.w}x${t.h} ${JSON.stringify(t.t)}`).join('  '));
}
await b.close();
