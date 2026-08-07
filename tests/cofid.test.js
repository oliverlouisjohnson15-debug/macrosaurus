'use strict';
// Tests for grounding an AI meal estimate against the UK food tables (app/cofid.js).
//
// These run against the REAL foods-uk.json, not a fixture. The bugs this guards against are all
// bugs of the actual data: CoFID ranks microwave chips above fried ones, "chips" also matches
// chocolate chips, and the table is mostly retail and home cooking rather than the restaurant
// versions people photograph. A fixture would hide every one of them.
//
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Cofid = require('../app/cofid.js');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'foods-uk.json'), 'utf8'));
const FOODS = raw.foods.map(f => ({
  name: f[0],
  per100: { kcal: f[1], protein: f[2] || 0, carbs: f[3] || 0, fat: f[4] || 0, fiber: f[5] || 0 },
  extra: (f[5] != null && f[6] != null && f[7] != null && f[8] != null) ? { satfat: f[6], sugars: f[7], salt: f[8] } : null,
  lc: f[0].toLowerCase()
}));

// The app's own ranking, mirrored here so the tests exercise the real matching behaviour rather
// than an idealised one. Kept in step with searchGenericFoods() in app/src/app.jsx.
function search(list, query, limit) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const f of list) {
    if (!terms.every(t => f.lc.indexOf(t) >= 0)) continue;
    const at = f.lc.indexOf(terms[0]);
    const rank = at === 0 ? 0 : (/[\s,(]/.test(f.lc.charAt(at - 1)) ? 1 : 2);
    hits.push({ f, k: rank * 10000 + f.name.length });
  }
  hits.sort((a, b) => a.k - b.k);
  return hits.slice(0, limit || 12).map(x => x.f);
}
const check = (items) => Cofid.check(search, FOODS, items);
const flagged = (items) => new Set(check(items).map(c => c.name));
// grams/kcal chosen so kcal/grams*100 lands on the per-100g figure each case is about.
const item = (name, per100, grams = 100, extra = {}) =>
  Object.assign({ name, grams, kcal: per100 / 100 * grams }, extra);

test('the food tables actually loaded', () => {
  assert.ok(FOODS.length > 2500, `only ${FOODS.length} foods`);
});

test('query() strips what CoFID never says, keeps the food itself', () => {
  assert.strictEqual(Cofid.query('Large portion of homemade lasagne'), 'lasagne');
  assert.strictEqual(Cofid.query('Olive oil (1 tbsp)'), 'olive oil');
  assert.strictEqual(Cofid.query('Grilled chicken breast'), 'grilled chicken breast');
  assert.strictEqual(Cofid.query('a side of chips'), 'chips');
  assert.strictEqual(Cofid.query(''), '');
});

// The whole point: catch a plate that has been priced at well above what the food can be.
test('catches energy densities no real food reaches', () => {
  const f = flagged([
    item('Cheddar cheese', 1000),   // real cheddar ~416
    item('Naan bread', 545),        // real naan ~285
  ]);
  assert.ok(f.has('Cheddar cheese'), 'cheddar at 1000 kcal/100g should flag');
  assert.ok(f.has('Naan bread'), 'naan at 545 kcal/100g should flag');
});

// The regression that made me rewrite this: comparing against ONE top hit flagged honest estimates.
// CoFID ranks "Potato chips, microwave, cooked" (221) above the fried variants (~290-364), so a
// chip-shop estimate got flagged and offered a LOWER, wronger number. Comparing against the spread
// of all matching variants is what fixes it.
test('does not flag an honest estimate that sits inside the range of CoFID variants', () => {
  assert.strictEqual(check([item('Chips', 290)]).length, 0, 'chip-shop chips are not an error');
  assert.strictEqual(check([item('Chicken tikka masala', 200)]).length, 0, 'takeaway curry is richer than the retail ready-meal');
  assert.strictEqual(check([item('Lasagne', 225)]).length, 0);
});

test('leaves accurate everyday estimates alone', () => {
  const items = [
    item('Grilled chicken breast', 165),
    item('Boiled white rice', 130),
    item('Baked beans', 80),
    item('Olive oil', 900),
    item('Cheddar cheese', 416),
  ];
  assert.deepStrictEqual(check(items), [], 'accurate items must produce no flags');
});

// Silence is the correct outcome for anything we cannot match confidently. A branded or oddly
// named item must never be "corrected" towards a generic food that only shares a word with it.
test('says nothing about items it cannot confidently match', () => {
  const items = [
    item("Nando's peri-peri chicken thigh", 267),
    item('Tandoori roti', 286),
    item('Zinger tower burger', 400),
    item('', 500),
  ];
  assert.deepStrictEqual(check(items), [], 'unmatched items must be left alone');
});

// Grams are the model's job because only it saw the photo. If we started correcting weights we
// would be overriding the one thing we have no information about.
test('compares energy density, not weight', () => {
  // Same food, same (correct) density, wildly different portions: neither is an error.
  assert.strictEqual(check([item('Cheddar cheese', 416, 30)]).length, 0);
  assert.strictEqual(check([item('Cheddar cheese', 416, 300)]).length, 0);
  // And a flag reports density, independent of the grams it was computed from.
  const [c] = check([item('Cheddar cheese', 1000, 37)]);
  assert.strictEqual(c.aiKcal100, 1000);
});

test('never questions a weight the user stated explicitly', () => {
  assert.strictEqual(check([item('Cheddar cheese', 1000, 100, { userSpecified: true })]).length, 0);
});

test('skips items with nothing to compare', () => {
  assert.deepStrictEqual(check([
    { name: 'Chips', grams: 0, kcal: 300 },
    { name: 'Chips', grams: 100, kcal: 0 },
  ]), []);
});

test('offers the variant closest to what the model said, not the leanest one', () => {
  // Grossly overpriced cheddar should be pulled back to a real cheddar, not to half-fat cheddar
  // just because that entry ranks higher in a name search.
  const [c] = check([item('Cheddar cheese', 1000)]);
  assert.match(c.ref, /cheddar/i);
  assert.ok(c.refKcal100 >= 380 && c.refKcal100 <= 460, `offered ${c.refKcal100} for cheddar`);
  assert.strictEqual(c.high, true, 'an overestimate reports as high');
});

test('reports direction so the screen can say high or low', () => {
  const [lo] = check([item('Double cream', 60)]); // real double cream ~450
  assert.strictEqual(lo.high, false);
  assert.ok(lo.refKcal100 > 300, `offered ${lo.refKcal100} for double cream`);
});

// A wide band is the deliberate cost of never producing a false flag. "olive oil" also matches
// sardines canned in olive oil (220 kcal), so the band runs 220-899 and an implausibly low estimate
// for the oil itself passes unchallenged. Silence is the intended failure direction, and this test
// exists so that stays a decision rather than becoming a surprise.
test('goes quiet when a name matches foods of genuinely different densities', () => {
  assert.strictEqual(check([item('Olive oil', 200)]).length, 0);
});

test('tolerance is wider upward, since CoFID under-represents restaurant cooking', () => {
  assert.ok(Cofid.TOL_UP > Cofid.TOL_DOWN);
});

// "Nobody measured it" and "there is none of it in the food" are different claims, and conflating
// them is how a food gets rated as more nutritious than it is.
test('profile() passes through measured nutrients and nulls unmeasured ones', () => {
  const measured = Cofid.profile({ per100: { kcal: 400, protein: 25, carbs: 1, fat: 33, fiber: 0 }, extra: { satfat: 21, sugars: 0.1, salt: 1.8 } });
  assert.strictEqual(measured.kcal, 4);
  assert.strictEqual(measured.satfat, 0.21);
  const unmeasured = Cofid.profile({ per100: { kcal: 400, protein: 25, carbs: 1, fat: 33, fiber: 0 }, extra: null });
  assert.strictEqual(unmeasured.satfat, null);
  assert.strictEqual(unmeasured.sugars, null);
  assert.strictEqual(unmeasured.salt, null);
});

// A profile is applied at the model's grams by the confirm screen, so it must scale linearly.
test('profile() is per gram, so it scales to any weight', () => {
  const p = Cofid.profile({ per100: { kcal: 300, protein: 10, carbs: 40, fat: 8, fiber: 5 }, extra: null });
  assert.strictEqual(Math.round(p.kcal * 133), 399);
  assert.strictEqual(Math.round(p.carbs * 133), 53);
});

// ---- retrieval: the reference figures sent WITH the request ----------------------------------
// Each of these pins a real mistake this matcher made before it was tightened. The failure that
// matters is a confidently WRONG reference, so most of these assert what must NOT come back.
const refs = (text) => Cofid.refs(search, FOODS, text).map(f => f.name);

test('finds the right measured reference for a described meal', () => {
  const r = refs('chicken tikka masala with pilau rice and a naan');
  assert.ok(r.some(n => /tikka masala/i.test(n)), r.join(' | '));
  assert.ok(r.some(n => /naan/i.test(n)), r.join(' | '));
});

test('a two-word phrase beats either word alone', () => {
  const r = refs('grilled chicken breast');
  assert.ok(/chicken/i.test(r[0]) && /breast/i.test(r[0]), r.join(' | '));
  // "breast" alone reached "Lamb, breast, raw, lean" before phrase words were consumed.
  assert.ok(!r.some(n => /lamb/i.test(n)), r.join(' | '));
});

test('a matched name consumes the words it already covers', () => {
  // "chicken tikka" matches a row whose name also contains "masala", so the single-word pass must
  // not then offer Garam masala as a reference for a curry.
  assert.ok(!refs('chicken tikka masala').some(n => /garam/i.test(n)));
});

test('a near-miss substring is not a match', () => {
  // "flat white" reached Whitecurrants; a berry is not a reference for a coffee.
  assert.ok(!refs('a flat white').some(n => /whitecurrant/i.test(n)));
  // "big mac" reached Macaroon at three letters.
  assert.ok(!refs('a big mac').some(n => /macaroon/i.test(n)));
});

test('but a short inflection still matches', () => {
  assert.ok(refs('wholemeal toast').some(n => /toasted/i.test(n)), 'toast should reach toasted');
});

test('words that name a serving rather than a food are ignored', () => {
  // "slices" reached Turkey slices in "two slices of wholemeal toast".
  assert.ok(!refs('two slices of wholemeal toast with peanut butter').some(n => /turkey/i.test(n)));
  // "half" reached "Cream, half, fresh" in "half chicken".
  assert.ok(!refs('half a chicken').some(n => /cream/i.test(n)));
});

test('returns nothing rather than guessing', () => {
  assert.deepStrictEqual(Cofid.refs(search, FOODS, ''), []);
  assert.deepStrictEqual(Cofid.refs(search, FOODS, 'zzzz qqqq'), []);
  assert.deepStrictEqual(Cofid.refs(search, null, 'chicken'), []);
});

test('is capped, so the prompt cannot be flooded', () => {
  const long = 'chicken rice pasta bread cheese butter potato broccoli banana yoghurt salmon beans oil milk';
  assert.ok(Cofid.refs(search, FOODS, long).length <= 6);
});

test('every reference carries usable per-100g numbers', () => {
  for (const f of Cofid.refs(search, FOODS, 'grilled chicken breast and boiled rice')) {
    assert.ok(f.per100.kcal > 0, f.name);
    assert.ok(typeof f.per100.protein === 'number' && typeof f.per100.fat === 'number', f.name);
  }
});
