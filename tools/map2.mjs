/* Capture the surfaces that have NO Claude Design file yet, in both themes. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
const BASE = 'http://localhost:8137';
const OUT = '/private/tmp/claude-501/-Users-oliverjohnson/490ad689-35c7-4b68-b8f2-a175aa09cfd9/scratchpad/map2';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const shots = [];

const click = async (p, re, sel = 'button, a, [role="button"]') => {
  const ok = await p.evaluate(([s, src, f]) => {
    const rx = new RegExp(src, f);
    const el = [...document.querySelectorAll(s)].find(e => e.offsetParent !== null &&
      (rx.test((e.getAttribute('aria-label') || '').trim()) || rx.test((e.textContent || '').trim())));
    if (!el) return false; el.click(); return true;
  }, [sel, re.source, re.flags]);
  if (ok) await p.waitForTimeout(950);
  return ok;
};
const waitFor = async (p, re, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const seen = await p.evaluate(([src, f]) => {
      const rx = new RegExp(src, f);
      return [...document.querySelectorAll('button,a,[role="button"],h1,h2,h3,label,span')]
        .some(e => e.offsetParent !== null && rx.test((e.textContent || '').trim()));
    }, [re.source, re.flags]);
    if (seen) { await p.waitForTimeout(500); return true; }
    await p.waitForTimeout(200);
  }
  return false;
};
const settle = async (p) => {
  await p.waitForTimeout(400);
  await p.addStyleTag({ content: '*,*::before,*::after{animation-duration:1ms !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition:none !important}.confetti{display:none !important}' }).catch(() => {});
  await p.evaluate(() => document.querySelectorAll('button').forEach(b => { if ((b.getAttribute('aria-label') || '') === 'Dismiss') b.click(); })).catch(() => {});
  await p.waitForTimeout(200);
};

const SCREENS = [
  { id: 'auth', title: 'Sign in', tier: 4, note: 'First screen anyone sees. No design yet.', raw: true,
    go: async (p) => { await waitFor(p, /(Sign in|Continue|Email)/i); } },
  { id: 'edit-entry', title: 'Edit an entry', tier: 1, note: 'The most-opened sheet after the log sheet itself.', overlay: 1,
    go: async (p) => { await click(p, /^FOOD$/); await click(p, /Porridge|Chicken|Apple/i); await waitFor(p, /(Save|Delete|Amount)/i); } },
  { id: 'weigh', title: 'Weigh in', tier: 1, note: 'The daily/weekly prompt the buddy asks for.', overlay: 1,
    go: async (p) => { await click(p, /^YOU$/); await click(p, /Progress/i); await click(p, /^WEIGH IN$/i); await waitFor(p, /(Save|kg|st)/i); } },
  { id: 'checkin', title: 'Weekly check-in', tier: 1, note: 'The adaptive engine’s main input. Multi-step.', overlay: 1,
    go: async (p) => { await click(p, /^YOU$/); await click(p, /Progress/i); await click(p, /Check.?in/i); await waitFor(p, /(Next|How did|week)/i); } },
  { id: 'recipe-detail', title: 'Recipe detail', tier: 1, note: 'Where every Cook tap lands. Bespoke layout.',
    go: async (p) => { await click(p, /^COOK$/); await click(p, /^Cookbook$/i); await p.waitForTimeout(700); await click(p, /kcal/i, 'button, [role="button"], a, div[role="button"]'); await waitFor(p, /(Ingredients|Method|Log)/i); } },
  { id: 'recipe-import', title: 'Import a recipe', tier: 3, note: 'Paste a video link, AI extracts the recipe.',
    go: async (p) => { await click(p, /^COOK$/); await click(p, /^Cookbook$/i); await click(p, /Import a recipe/i); await waitFor(p, /(paste|link|URL)/i); } },
  { id: 'train-player', title: 'Live training session', tier: 1, note: 'Held through a whole workout. Unlike anything else in the app.',
    go: async (p) => { await click(p, /^TRAIN$/); await click(p, /^▶ Open/i); await waitFor(p, /(Start|Set|kg)/i); await click(p, /^Start/i); await p.waitForTimeout(900); } },
  { id: 'train-history', title: 'Training history', tier: 3, note: 'Past sessions.',
    go: async (p) => { await click(p, /^TRAIN$/); await click(p, /^HISTORY$/i); await p.waitForTimeout(600); } },
  { id: 'train-stats', title: 'Training stats', tier: 3, note: 'Volume, PRs, trends.',
    go: async (p) => { await click(p, /^TRAIN$/); await click(p, /^STATS$/i); await p.waitForTimeout(600); } },
  { id: 'train-blocks', title: 'Your blocks', tier: 3, note: 'Block library and archive.',
    go: async (p) => { await click(p, /^TRAIN$/); await click(p, /^YOUR BLOCKS$/i); await p.waitForTimeout(600); } },
  { id: 'settings-goal', title: 'Settings · Goal', tier: 2, note: 'ARCHETYPE: one design covers all 12 settings subscreens.',
    go: async (p) => { await click(p, /^YOU$/); await click(p, /^Goal$/i); await p.waitForTimeout(700); } },
  { id: 'settings-macros', title: 'Settings · Calories & macros', tier: 2, note: 'Same archetype, heavier on numeric fields.',
    go: async (p) => { await click(p, /^YOU$/); await click(p, /Calories & macros/i); await p.waitForTimeout(700); } },
  { id: 'settings-meals', title: 'Settings · Default meals', tier: 2, note: 'Same archetype, list-editing variant.',
    go: async (p) => { await click(p, /^YOU$/); await click(p, /Default meals/i); await p.waitForTimeout(700); } },
  { id: 'account', title: 'Account', tier: 2, note: 'Email, password, subscription, export, delete.',
    go: async (p) => { await click(p, /^YOU$/); await click(p, /^Account$/i); await p.waitForTimeout(700); } },
  { id: 'buddy-chat', title: 'Buddy conversation', tier: 1, note: 'The coach conversation behind the dino.', overlay: 1,
    go: async (p) => { await click(p, /^Open Play$/i); await waitFor(p, /^Buddy$/i); await click(p, /(Chat|Talk)/i); await p.waitForTimeout(900); } },
  { id: 'recap', title: 'Weekly recap', tier: 1, note: 'The retention moment at the end of each week.', overlay: 1,
    go: async (p) => { await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /recap/i.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(900); } },
  { id: 'density', title: 'Density explainer', tier: 6, note: 'Typical small explainer sheet.', overlay: 1,
    go: async (p) => { await click(p, /^FOOD$/); await click(p, /DENSITY/i); await p.waitForTimeout(800); } },
];

for (const theme of ['light', 'dark']) {
  console.log(`\n== ${theme} ==`);
  for (const s of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    try {
      await p.goto(BASE + (s.raw ? '/' : '/?demo'), { waitUntil: 'networkidle' });
      await p.waitForTimeout(1300);
      if (!s.raw) for (let i = 0; i < 4; i++) { if (!await click(p, /^(Maybe later|NICE ONE)$/i)) break; }
      await p.evaluate((t) => { const el = document.documentElement; el.classList.toggle('theme-dark', t === 'dark'); el.classList.toggle('theme-light', t !== 'dark'); }, theme);
      await s.go(p);
      await settle(p);
      if (!s.overlay) await p.evaluate(() => { document.querySelectorAll('.fixed.bottom-0').forEach(n => { n.style.position = 'absolute'; n.style.bottom = '0'; n.style.left = 0; n.style.right = 0; }); document.body.style.position = 'relative'; }).catch(() => {});
      await p.waitForTimeout(250);
      const file = `${OUT}/${theme}-${s.id}.png`;
      await p.screenshot({ path: file, fullPage: !s.overlay });
      shots.push({ theme, id: s.id, title: s.title, note: s.note, tier: s.tier, file });
      console.log(`  ✓ ${s.id}`);
    } catch (e) { console.log(`  ✗ ${s.id}: ${String(e).slice(0, 90)}`); }
    await ctx.close();
  }
}
writeFileSync(`${OUT}/shots.json`, JSON.stringify(shots, null, 2));
console.log('\ncaptured', shots.length);
await browser.close();
