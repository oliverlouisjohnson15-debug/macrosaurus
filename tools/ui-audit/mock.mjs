import { chromium } from 'playwright';
import { collect } from './measure-lib.mjs';
import fs from 'fs';
const [,, W='390', H='844', themes='light,dark', out='mock'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const res = {};
for (const theme of themes.split(',')) for (const d of ['A','B']) for (const s of ['today','food','log','train','progress','you']) {
  const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await p.goto(`http://localhost:8765/design-plans/35-reset/mockups/${d}-${s}.html`); await p.waitForTimeout(700);
  const m = await p.evaluate(collect, s === 'log' ? '.sheet' : null);
  m.primaryY = await p.evaluate(() => { const e = document.querySelector('[data-primary]'); return e ? Math.round(e.getBoundingClientRect().y) : null; });
  m.hOverflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  res[`${theme}-${d}-${s}`] = m;
  await p.screenshot({ path: `${out}/${theme}-${W}-${d}-${s}.png` });
  await p.close();
}
fs.writeFileSync(`${out}/metrics-${W}.json`, JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(20), JSON.stringify(v));
await b.close();
