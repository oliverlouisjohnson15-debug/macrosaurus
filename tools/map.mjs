/* Capture every screen of Macrosaurus in both themes and assemble a page map PDF.
   Runs against the already-running preview server (default http://localhost:8137). */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';

const BASE = process.env.BASE || 'http://localhost:8137';
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-oliverjohnson/490ad689-35c7-4b68-b8f2-a175aa09cfd9/scratchpad/map';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const shots = [];

// Click the first visible element whose trimmed text matches `re`. Returns false rather than
// throwing, so one missing screen never costs the rest of the sweep.
// Matches aria-label as well as text: much of the Cook header is icon-only buttons whose only
// accessible name is the label, and a textContent-only match silently found nothing there.
const clickText = async (page, re, tag = 'button, a, [role="button"]') => {
  const ok = await page.evaluate(([sel, src, flags]) => {
    const rx = new RegExp(src, flags);
    const els = [...document.querySelectorAll(sel)];
    const el = els.find(e => e.offsetParent !== null &&
      (rx.test((e.getAttribute('aria-label') || '').trim()) || rx.test((e.textContent || '').trim())));
    if (!el) return false;
    el.click(); return true;
  }, [tag, re.source, re.flags]);
  if (ok) await page.waitForTimeout(900);
  return ok;
};

// The big sheets (add-food, Play, paywall) mount well after the click that opens them - a flat
// 900ms wait read the DOM while the old screen was still the only thing in it, which is how the
// first run captured the Food log three times and called it three different tabs.
const waitText = async (page, re, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const seen = await page.evaluate(([src, flags]) => {
      const rx = new RegExp(src, flags);
      return [...document.querySelectorAll('button, a, [role="button"], h1, h2, h3')]
        .some(e => e.offsetParent !== null && (rx.test((e.getAttribute('aria-label') || '').trim()) || rx.test((e.textContent || '').trim())));
    }, [re.source, re.flags]);
    if (seen) { await page.waitForTimeout(500); return true; }
    await page.waitForTimeout(200);
  }
  return false;
};

const settle = async (page) => {
  await page.waitForTimeout(450);
  // Freeze the animations that would otherwise make two runs of the same screen differ, and drop the
  // transient furniture - confetti and the streak-freeze toast were both landing across screens they
  // have nothing to do with.
  // Run animations to COMPLETION, do not pause them. `animation-play-state: paused` freezes every
  // element on frame 0, and frame 0 of `.sheet-up` is translateY(100%) and of `.fade-in` is
  // opacity 0 - so pausing rendered every sheet in the app as an empty grey scrim with its content
  // parked off the bottom of the screen. Collapsing the duration instead lands them at their end
  // state, which is both correct and deterministic between runs.
  await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:1ms !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition:none !important}.confetti{display:none !important}' }).catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => { if ((b.getAttribute('aria-label') || '') === 'Dismiss') b.click(); });
  }).catch(() => {});
  await page.waitForTimeout(200);
};

async function newPage(theme, tall) {
  // Sheets and modals are position:fixed and sized against the VIEWPORT, so they get a viewport-
  // sized shot at a real phone height. A fullPage capture of a modal screen resizes the viewport to
  // the scroll height, which both stretches the scrim and leaves the sheet's own scroller empty -
  // the first run produced a page of grey for every sheet in the app.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  ! page error:', String(e).slice(0, 120)));
  await page.goto(BASE + '/?demo', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // Clear the welcome / milestone overlays that stand in front of Today on a fresh demo session.
  for (let i = 0; i < 4; i++) {
    const hit = await clickText(page, /^(Maybe later|NICE ONE|Got it|Close|Skip)$/i);
    if (!hit) break;
  }
  await page.evaluate((t) => {
    const el = document.documentElement;
    el.classList.toggle('theme-dark', t === 'dark');
    el.classList.toggle('theme-light', t !== 'dark');
  }, theme);
  await settle(page);
  return { ctx, page };
}

async function shoot(page, theme, id, title, note, overlay) {
  const file = `${OUT}/${theme}-${id}.png`;
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  // In a full-length capture a position:fixed bottom bar renders wherever the fold happened to be,
  // so the nav and its FAB landed across the middle of every scrolling screen, covering the content
  // underneath. Pinning it to the document instead puts it once, at the true bottom, where it reads
  // as the nav rather than as an artefact.
  if (!overlay) {
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.bottom-0').forEach(n => {
        n.style.position = 'absolute'; n.style.bottom = '0'; n.style.left = '0'; n.style.right = '0';
      });
      document.body.style.position = 'relative';
    }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, fullPage: !overlay });
  const dims = await page.evaluate(() => ({ h: document.documentElement.scrollHeight }));
  shots.push({ theme, id, title, note, file, h: dims.h });
  console.log(`  ✓ ${theme}/${id}  (${dims.h}px tall)`);
}

// A screen is: a name, and a recipe that gets the app there from Today.
const SCREENS = [
  { id: 'today', title: 'Today', note: 'Home. Buddy terrarium + status strip, Today\'s Plan, Recovery.', go: async () => {} },
  { id: 'food', title: 'Food log', note: 'The day\'s diary, grouped by meal.', go: async (p) => { await clickText(p, /^FOOD$/); } },
  { id: 'addfood', title: 'Add food · Search', note: 'The logging sheet, default tab: search the food database.', overlay: 1, go: async (p) => { await clickText(p, /^FOOD$/); await clickText(p, /^\+ Add food$/i); await waitText(p, /^Scan$/i); } },
  { id: 'addfood-describe', title: 'Add food · Describe (AI)', note: 'Natural-language logging: "two eggs and toast".', overlay: 1, go: async (p) => { await clickText(p, /^FOOD$/); await clickText(p, /^\+ Add food$/i); await waitText(p, /^Scan$/i); await clickText(p, /^Describe$/i); } },
  { id: 'addfood-manual', title: 'Add food · Manual', note: 'Hand-entered macros.', overlay: 1, go: async (p) => { await clickText(p, /^FOOD$/); await clickText(p, /^\+ Add food$/i); await waitText(p, /^Scan$/i); await clickText(p, /Enter it manually/i); } },
  { id: 'cook', title: 'Cook', note: 'Recipes: Discover rail + your cookbook.', go: async (p) => { await clickText(p, /^COOK$/); } },
  { id: 'cook-fridge', title: 'Cook · Fridge scan', note: 'Snap what you have in, get recipes you can make now.', go: async (p) => { await clickText(p, /^COOK$/); await clickText(p, /^Cook from your fridge$/i); } },
  { id: 'cook-shopping', title: 'Cook · Shopping list', note: 'Ingredients gathered from planned recipes.', go: async (p) => { await clickText(p, /^COOK$/); await clickText(p, /^Shopping list$/i); await waitText(p, /(Shopping|‹ Recipes)/i); } },
  { id: 'cook-plan', title: 'Cook · Meal plan', note: 'The week planner recipes are scheduled into.', go: async (p) => { await clickText(p, /^COOK$/); await clickText(p, /^Meal plan$/i); } },
  { id: 'train', title: 'Train', note: 'Workout blocks, sessions and history.', go: async (p) => { await clickText(p, /^TRAIN$/); } },
  { id: 'you', title: 'You', note: 'Account, settings overview, subscription.', go: async (p) => { await clickText(p, /^YOU$/); } },
  { id: 'progress', title: 'Progress', note: 'Weight trend, expenditure, check-ins.', go: async (p) => { await clickText(p, /^YOU$/); await clickText(p, /Progress/i); } },
  { id: 'play', title: 'Play · Buddy', note: 'The game hub behind the dino: hearts, needs, evolution.', overlay: 1, go: async (p) => { await clickText(p, /^Open Play$/i); await waitText(p, /^Buddy$/i); } },
  { id: 'play-shop', title: 'Play · Shop', note: 'Amber spend: scenes, cosmetics, renames.', overlay: 1, go: async (p) => { await clickText(p, /^Open Play$/i); await waitText(p, /^Buddy$/i); await clickText(p, /^Shop$/i); } },
  { id: 'play-battle', title: 'Play · Battle', note: 'The auto-battler behind the streak.', overlay: 1, go: async (p) => { await clickText(p, /^Open Play$/i); await waitText(p, /^Buddy$/i); await clickText(p, /^Battle$/i); } },
  { id: 'paywall', title: 'Paywall', note: 'Premium upgrade sheet.', overlay: 1, go: async (p) => { await p.evaluate(() => window.MPAYWALL && window.MPAYWALL({ type: 'manual' })); await waitText(p, /(Premium|Try free|per month)/i); } },
];

for (const theme of ['light', 'dark']) {
  console.log(`\n== ${theme} ==`);
  for (const s of SCREENS) {
    const { ctx, page } = await newPage(theme, s.overlay);
    try {
      await s.go(page);
      await shoot(page, theme, s.id, s.title, s.note, s.overlay);
    } catch (e) {
      console.log(`  ✗ ${theme}/${s.id}: ${String(e).slice(0, 120)}`);
    }
    await ctx.close();
  }
}

writeFileSync(`${OUT}/shots.json`, JSON.stringify(shots, null, 2));
console.log(`\ncaptured ${shots.length} screens -> ${OUT}`);
await browser.close();
