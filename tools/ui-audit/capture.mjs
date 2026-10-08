// Captures and measures every tab root and the log sheet in ?demo. Works on the 35-reset nav
// (Today · Food · + · Train · Progress, Recipes inside Food) and on the old one.
// usage: node capture.mjs <outDir> <width> <height> <paper|dark>
import { chromium } from 'playwright';
import { collect } from './measure-lib.mjs';
import fs from 'fs';
const [,, outDir = 'out', W = '390', Hh = '844', theme = 'paper'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: +W, height: +Hh }, deviceScaleFactor: 2 })).newPage();
p.on('pageerror', e => console.log('ERR', e.message));
const url = 'http://localhost:8765/index.html?demo' + (theme === 'dark' ? '&dark' : '');
const dismiss = async () => { for (const t of ['Nice one', 'Got it', 'Not now', 'Later']) { const l = p.getByRole('button', { name: t, exact: true }); if (await l.count()) { await l.first().click().catch(() => {}); await p.waitForTimeout(300); } } };
// Primary content per screen: the y of its top edge, CSS px from the top of the page.
const PRIMARY = { today: /kcal left/i, food: /Porridge, banana/, cook: /Cottage cheese protein bagel/, train: /^Lower B$/, progress: /ahead of plan|on plan|behind/i, you: /^Body details$/ };
const shot = async (name, scope) => {
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400);
  const m = await p.evaluate(collect, scope);
  if (PRIMARY[name]) { const bb = await p.getByText(PRIMARY[name]).first().boundingBox().catch(() => null); m.primaryY = bb ? Math.round(bb.y) : null; }
  await p.screenshot({ path: `${outDir}/${theme}-${W}-${name}.png` });
  await p.screenshot({ path: `${outDir}/${theme}-${W}-${name}-full.png`, fullPage: true });
  return m;
};
const tab = async (label) => { await p.locator('.fixed.bottom-0.inset-x-0 button', { hasText: label }).first().click(); await p.waitForTimeout(800); await dismiss(); };
const res = {};
await p.goto(url); await p.waitForTimeout(2500); await dismiss();
res.today = await shot('today');
await tab('FOOD'); res.food = await shot('food');
const recipesSeg = p.getByRole('button', { name: 'Recipes', exact: true });
if (await recipesSeg.count()) { await recipesSeg.first().click(); await p.waitForTimeout(800); } else await tab('COOK');
res.cook = await shot('cook');
await tab('TRAIN'); res.train = await shot('train');
if (await p.locator('.fixed.bottom-0.inset-x-0 button', { hasText: 'PROGRESS' }).count()) { await tab('PROGRESS'); res.progress = await shot('progress'); }
await p.getByRole('button', { name: 'You and settings' }).click(); await p.waitForTimeout(800); res.you = await shot('you');
if (!res.progress) { await p.getByRole('button', { name: /^Progress/ }).first().click(); await p.waitForTimeout(900); res.progress = await shot('progress'); }
await p.goto(url); await p.waitForTimeout(2500); await dismiss();
await p.getByRole('button', { name: 'Open Play' }).first().click(); await p.waitForTimeout(1200); await dismiss(); res.play = await shot('play');
await p.goto(url); await p.waitForTimeout(2500); await dismiss();
await p.getByRole('button', { name: 'Add food' }).click(); await p.waitForTimeout(800); res.logsheet = await shot('logsheet', '.fixed.inset-0');
fs.writeFileSync(`${outDir}/${theme}-${W}-metrics.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await b.close();
