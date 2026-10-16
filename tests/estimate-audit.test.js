'use strict';
// Auditing the AI estimates in a diary: how much of the intake they carry, whether they agree with
// foods that were MEASURED, and whether the same dish keeps coming out at the same figure.
//
// The matching is the risky part. A wrong match hands someone a worse number than the one the model
// gave, so most of these tests are about what must NOT match.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

let n = 0;
// A logged entry with its density, the way the app stores it: kcal for the portion, nq.ed per 100 g.
const entry = (name, source, kcal, ed, over) => Object.assign({
  id: 'e' + (++n), date: '2026-10-01', ref_type: 'food', name: name, source: source, is_alcohol: false,
  computed_macros: { kcal: kcal, protein: kcal * 0.05, carbs: kcal * 0.1, fat: kcal * 0.02, fiber: 1 },
  nq: ed == null ? null : { ed: ed },
}, over || {});

test('names match on equal tokens, or a shorter name of two+ words inside a longer one', () => {
  const t = E.foodNameTokens;
  assert.ok(E.sameFood(t('Lean beef mince'), t('Lean Beef Steak Mince 5%')));
  assert.ok(E.sameFood(t('Frozen blackberries'), t('Frozen blackberries 500g')));
  assert.ok(E.sameFood(t('Chips'), t('chips')));
});

test('one shared word is not a match: chicken is not chicken curry', () => {
  const t = E.foodNameTokens;
  assert.strictEqual(E.sameFood(t('Chicken'), t('Chicken curry')), false);
  assert.strictEqual(E.sameFood(t('Cheese'), t('Cheese and onion crisps')), false);
});

test('raw and cooked versions of a food are different foods', () => {
  const t = E.foodNameTokens;
  assert.strictEqual(E.sameFood(t('Raw chicken breast'), t('Fried chicken breast')), false);
  assert.strictEqual(E.sameFood(t('Chicken breast'), t('Raw chicken breast')), true);
});

test('an estimate far from your own labelled food is flagged, and offers your figure', () => {
  const refs = E.ownRefs([entry('Lean Beef Steak Mince 5%', 'off', 198, 132)]);
  const out = E.ownCheck(refs, [{ name: 'Lean beef mince', grams: 150, kcal: 300 }]); // 200/100g vs 132
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'measured');
  assert.strictEqual(out[0].refKcal100, 132);
  assert.strictEqual(out[0].aiKcal100, 200);
  assert.strictEqual(out[0].high, true);
  assert.ok(Math.abs(out[0].profile.kcal - 1.32) < 1e-9, 'profile is per gram');
});

test('an estimate inside the tolerance of a measured food is left alone', () => {
  const refs = E.ownRefs([entry('Lean Beef Steak Mince 5%', 'label', 198, 132)]);
  assert.strictEqual(E.ownCheck(refs, [{ name: 'Lean beef mince', grams: 150, kcal: 210 }]).length, 0); // 140/100g
});

test('a weight the user stated is never questioned', () => {
  const refs = E.ownRefs([entry('Lean Beef Steak Mince 5%', 'off', 198, 132)]);
  assert.strictEqual(E.ownCheck(refs, [{ name: 'Lean beef mince', grams: 150, kcal: 300, userSpecified: true }]).length, 0);
});

test('a repeated estimate becomes your usual figure only once it has been logged twice', () => {
  const once = E.ownRefs([entry('Large egg', 'ai_estimate', 166, 145)]);
  assert.strictEqual(E.ownCheck(once, [{ name: 'Large egg', grams: 110, kcal: 200 }]).length, 0);
  const twice = E.ownRefs([entry('Large egg', 'ai_estimate', 166, 145), entry('Large egg', 'ai_estimate', 173, 150)]);
  const out = E.ownCheck(twice, [{ name: 'Large egg', grams: 110, kcal: 200 }]); // 182/100g vs ~147.5
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'usual');
  assert.strictEqual(out[0].n, 2);
  assert.ok(Math.abs(out[0].refKcal100 - 148) <= 1);
});

test('measured beats usual: your packet outranks your own earlier guess', () => {
  const refs = E.ownRefs([
    entry('Lean beef mince', 'off', 132, 132),
    entry('Lean beef mince', 'ai_estimate', 200, 200), entry('Lean beef mince', 'ai_estimate', 210, 210),
  ]);
  const out = E.ownCheck(refs, [{ name: 'Lean beef mince', grams: 100, kcal: 205 }]);
  assert.strictEqual(out[0].kind, 'measured');
});

test('alcohol, recipes and community foods never become references', () => {
  const refs = E.ownRefs([
    entry('Lager', 'alcohol', 200, 45, { is_alcohol: true }),
    entry('Chilli', 'recipe', 400, 100), entry('Mystery bar', 'community', 300, 400),
  ]);
  assert.strictEqual(refs.measured.length, 0);
  assert.strictEqual(refs.usual.length, 0);
});

test('entries without a density take no part rather than breaking the build', () => {
  const refs = E.ownRefs([entry('Pasta', 'label', 300, null), entry('Pasta', 'label', 0, 150)]);
  assert.strictEqual(refs.measured.length, 0);
});

test('the audit reports which way the estimates lean against measured foods', () => {
  const entries = [
    entry('Lean Beef Steak Mince 5%', 'off', 198, 132),
    entry('Frozen Blackberries', 'label', 34, 34),
    entry('Potato Waffles', 'off', 98, 168),
    entry('Lean beef mince', 'ai_estimate', 300, 200),          // +52%
    entry('Frozen blackberries', 'ai_estimate', 51, 51),         // +50%
    entry('Potato waffles', 'ai_estimate', 200, 200),            // +19%
    entry('Pizza in Leeds', 'ai_estimate', 906, 230),            // no reference: not counted
  ];
  const a = E.estimateAudit(entries);
  assert.strictEqual(a.n, 3);
  assert.strictEqual(a.high, 3);
  assert.strictEqual(a.low, 0);
  assert.ok(a.medianPct > 15);
  assert.strictEqual(a.rows[0].name, 'Lean beef mince'); // biggest gap first
});

test('too few matches is silence, not a verdict', () => {
  const a = E.estimateAudit([entry('Lean Beef Steak Mince 5%', 'off', 198, 132), entry('Lean beef mince', 'ai_estimate', 300, 200)]);
  assert.strictEqual(a, null);
});

test('estimate share counts only AI estimates, within the window', () => {
  const d = (date, e) => Object.assign(e, { date });
  const entries = [
    d('2026-10-01', entry('Toast', 'off', 200, 260)),
    d('2026-10-01', entry('Pizza', 'ai_estimate', 800, 230)),
    d('2026-10-02', entry('Lager', 'alcohol', 200, null, { is_alcohol: true })),
    d('2026-10-02', entry('Wings', 'ai_estimate', 600, 290)),
    d('2026-10-09', entry('Outside window', 'ai_estimate', 999, 200)),
  ];
  const s = E.estimateShare(entries, '2026-10-01', '2026-10-07', 1);
  assert.strictEqual(s.totalKcal, 1800);
  assert.strictEqual(s.estimatedKcal, 1400);
  assert.ok(Math.abs(s.share - 1400 / 1800) < 1e-9);
  assert.strictEqual(s.days, 2);
  assert.strictEqual(s.perDay, 700);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.top.length, 1);
  assert.strictEqual(s.top[0].name, 'Pizza');
});

test('an empty window is zero, not NaN', () => {
  const s = E.estimateShare([], '2026-10-01', '2026-10-07');
  assert.strictEqual(s.share, 0); assert.strictEqual(s.perDay, 0); assert.deepStrictEqual(s.top, []);
});

test('grams that cannot be a weight are dropped: 1 g at 690 kcal', () => {
  assert.strictEqual(E.aiGramsOk(1, 690), 0);
  assert.strictEqual(E.aiGramsOk(115, 173), 115);
  assert.strictEqual(E.aiGramsOk(0, 100), 0);
  assert.strictEqual(E.aiGramsOk(14, 125), 14);   // a tablespoon of oil is 9 kcal/g: allowed
  assert.strictEqual(E.aiGramsOk(5, 20), 5);
});

test('the check-in note stays quiet when little is estimated, and names the big ones when a lot is', () => {
  const share = (over) => Object.assign({ estimatedKcal: 5000, share: 0.25, days: 7, perDay: 714, top: [{ name: 'Pizza', kcal: 906 }, { name: 'Chips', kcal: 845 }] }, over);
  assert.strictEqual(E.estimateNote(share({ share: 0.05 }), null), null);
  assert.strictEqual(E.estimateNote(share({ days: 2 }), null), null);
  assert.strictEqual(E.estimateNote(null, null), null);
  const loud = E.estimateNote(share(), null);
  assert.ok(loud.includes('25%') && loud.includes('714 kcal') && loud.includes('Pizza (906)'), loud);
  const mild = E.estimateNote(share({ share: 0.15 }), null);
  assert.ok(mild.includes('15%') && !mild.includes('Pizza'), mild);
});

test('the check-in note only talks about the leaning when there are enough matches', () => {
  const share = { estimatedKcal: 5000, share: 0.15, days: 7, perDay: 700, top: [] };
  assert.ok(!E.estimateNote(share, { n: 2, medianPct: 40 }).includes('scanned'));
  assert.ok(E.estimateNote(share, { n: 4, medianPct: 22 }).includes('22% high'));
  assert.ok(E.estimateNote(share, { n: 4, medianPct: -18 }).includes('18% low'));
  assert.ok(E.estimateNote(share, { n: 4, medianPct: 4 }).includes('within about 10%'));
});
