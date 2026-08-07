/*
 * calibrate.mjs - measure the meal estimator against known truth.
 *
 * Run:  ANTHROPIC_API_KEY=sk-... npm run calibrate
 *       ANTHROPIC_API_KEY=sk-... node tools/calibrate.mjs --only=composite
 *
 * Groups: knowledge (one food, known weight), composite (a plate of several, known weights),
 * chain (a named menu item), portion (your photos, weighed - empty until you add them).
 *
 * NOT part of `npm test`: it costs money and needs network, so CI cannot run it. Run it by hand
 * before and after any change to AI_PROMPT, and keep the two reports side by side. A prompt change
 * you have not measured is a guess.
 *
 * It reads the REAL prompt out of app/src/prompts.jsx rather than holding a copy, so what gets
 * measured is always what ships.
 *
 * TWO NUMBERS, and the second is the one this project cares about:
 *   MAPE - mean absolute percentage error. How far off, ignoring direction. Precision.
 *   MPE  - mean signed percentage error. WHICH WAY it is off. Bias.
 * A tracker can survive imprecision, because day-to-day noise averages out and the adaptive
 * expenditure engine absorbs what is left. It cannot survive bias: a consistent lean in one
 * direction is exactly what the engine mistakes for a change in metabolism. The published finding
 * that photo estimators run about a third low is an MPE finding, not a MAPE one.
 */
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('Set ANTHROPIC_API_KEY.'); process.exit(1); }

const MODEL = 'claude-sonnet-5';
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

// Pull AI_PROMPT out of the shipped source. prompts.jsx is declarations only, by design, so it can
// be evaluated in isolation; if that ever stops being true this throws rather than testing a stale copy.
const promptSrc = readFileSync('app/src/prompts.jsx', 'utf8');
const { AI_PROMPT } = new Function(promptSrc + '\n return { AI_PROMPT };')();
if (!AI_PROMPT || AI_PROMPT.length < 500) throw new Error('AI_PROMPT did not load from app/src/prompts.jsx');

const fx = JSON.parse(readFileSync('tests/fixtures/calibration.json', 'utf8'));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function estimate(text, imagePath) {
  const content = [];
  if (imagePath) {
    if (!existsSync(imagePath)) throw new Error('missing image: ' + imagePath);
    const media = MIME[extname(imagePath).toLowerCase()];
    if (!media) throw new Error('unsupported image type: ' + imagePath);
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: readFileSync(imagePath).toString('base64') } });
  }
  content.push({ type: 'text', text: 'Context: food or drink consumed in England. Description: "' + text + '"' });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3000,
      thinking: { type: 'disabled' },   // matches the app: thinking tokens come out of max_tokens and truncate the JSON
      system: AI_PROMPT,
      messages: [{ role: 'user', content }]
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const body = await res.json();
  const raw = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = raw.replace(/```json?/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply: ' + raw.slice(0, 200));
  return JSON.parse(m[0]);
}

const pct = (got, want) => (want > 0 ? (got - want) / want : 0);
const fmtPct = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
const pad = (s, n) => String(s).padEnd(n);

async function runGroup(name, cases) {
  if (!cases.length) return null;
  console.log('\n\x1b[1m' + name.toUpperCase() + '\x1b[0m  (' + cases.length + ' cases)');
  console.log(pad('case', 26) + pad('expected', 11) + pad('got', 11) + pad('error', 10) + 'macros P/C/F');
  console.log('-'.repeat(86));
  const errs = [];
  for (const c of cases) {
    let est;
    try { est = await estimate(c.text, c.image); }
    catch (e) { console.log(pad(c.id, 26) + '\x1b[31mFAILED\x1b[0m ' + e.message.slice(0, 44)); continue; }
    const gotK = +est.kcal || 0, wantK = +c.expect.kcal;
    const e = pct(gotK, wantK);
    errs.push({ id: c.id, e, conf: c.confidence });
    const mac = ['protein', 'carbs', 'fat']
      .map(k => (c.expect[k] > 0 ? fmtPct(pct(+est[k + '_g'] || 0, c.expect[k])) : '-'))
      .join(' ');
    const colour = Math.abs(e) <= 0.2 ? '\x1b[32m' : Math.abs(e) <= 0.35 ? '\x1b[33m' : '\x1b[31m';
    console.log(pad(c.id, 26) + pad(wantK + ' kcal', 11) + pad(gotK + ' kcal', 11) + colour + pad(fmtPct(e), 10) + '\x1b[0m' + mac);
  }
  if (!errs.length) return null;
  const mape = errs.reduce((a, x) => a + Math.abs(x.e), 0) / errs.length;
  const mpe = errs.reduce((a, x) => a + x.e, 0) / errs.length;
  const worst = errs.slice().sort((a, b) => Math.abs(b.e) - Math.abs(a.e))[0];
  console.log('-'.repeat(86));
  console.log('  MAPE (precision) ' + (mape * 100).toFixed(1) + '%   MPE (bias) ' + fmtPct(mpe) + '   worst: ' + worst.id + ' ' + fmtPct(worst.e));
  return { name, mape, mpe, n: errs.length };
}

const groups = [];
if (!only || only === 'knowledge') groups.push(['knowledge', fx.knowledge]);
if (!only || only === 'composite') groups.push(['composite', fx.composite || []]);
if (!only || only === 'chain') groups.push(['chain', fx.chain]);
if (!only || only === 'portion') groups.push(['portion', fx.portion || []]);

const results = [];
for (const [name, cases] of groups) {
  const r = await runGroup(name, cases);
  if (r) results.push(r);
}

console.log('\n\x1b[1mSUMMARY\x1b[0m');
for (const r of results) {
  console.log('  ' + pad(r.name, 12) + 'n=' + pad(r.n, 5) + 'MAPE ' + pad((r.mape * 100).toFixed(1) + '%', 9) + 'bias ' + fmtPct(r.mpe));
}
const k = results.find(r => r.name === 'knowledge');
if (k) {
  const target = fx.targets.kcal_mape;
  console.log('\n  Target for known-weight cases: comfortably under ' + (target * 100) + '% MAPE.');
  console.log('  ' + (k.mape <= target ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mOVER TARGET\x1b[0m') + ' at ' + (k.mape * 100).toFixed(1) + '%.');
  if (Math.abs(k.mpe) > 0.1) {
    console.log('  \x1b[33mBias warning:\x1b[0m consistently ' + (k.mpe > 0 ? 'HIGH' : 'LOW') + ' by ' + fmtPct(k.mpe) + '.');
    console.log('  Bias matters more than spread here: the adaptive engine reads a steady lean as a change in metabolism.');
  }
}
if (!(fx.portion || []).length) {
  console.log('\n  \x1b[33mNo portion cases.\x1b[0m Only nutrition knowledge at a known weight is being measured.');
  console.log('  Portion estimation is the dominant error source in the literature and is currently unmeasured.');
  console.log('  Add cases to "portion" in tests/fixtures/calibration.json. The shape is in');
  console.log('  "portion_example" in that same file: photograph the meal, weigh it, and leave the');
  console.log('  weight OUT of `text` so the estimator has to work the portion out from the picture.');
}
