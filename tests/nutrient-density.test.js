'use strict';
// Tests for food quality scoring (engine.js). Two measures, each used where it is valid:
//   - Nutri-Score grades a single FOOD, per 100 g, with energy itself as a penalty.
//   - An HEI-style density score rates a whole DAY, scoring the day's totals in one pass.
// Both are published standards, so the tests are written against real UK foods and the grades those
// foods actually carry on the shelf. If a change here makes chocolate outrank broccoli, it is wrong.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

// Real UK nutrition per 100 g. fvl = the fruit/veg/legume/nut share Nutri-Score asks for; potatoes
// deliberately do not count towards it, which is why crisps are 0.
const P100 = {
  broccoli:   { kcal: 35,  protein: 2.8, fiber: 2.6, fat: 0.4, satfat: 0.1, sugars: 1.5, salt: 0.03, fvl: 100 },
  lentils:    { kcal: 116, protein: 9, fiber: 8, fat: 0.4, satfat: 0.1, sugars: 1.8, salt: 0.01, fvl: 100 },
  apple:      { kcal: 52,  protein: 0.3, fiber: 2.4, fat: 0.2, satfat: 0.03, sugars: 10, salt: 0, fvl: 100 },
  banana:     { kcal: 89,  protein: 1.1, fiber: 2.6, fat: 0.3, satfat: 0.1, sugars: 12, salt: 0, fvl: 100 },
  chicken:    { kcal: 165, protein: 31, fiber: 0, fat: 3.6, satfat: 0.6, sugars: 0, salt: 0.1, fvl: 0 },
  salmon:     { kcal: 208, protein: 20, fiber: 0, fat: 13, satfat: 3.1, sugars: 0, salt: 0.09, fvl: 0 },
  egg:        { kcal: 143, protein: 13, fiber: 0, fat: 10, satfat: 3.3, sugars: 1.1, salt: 0.3, fvl: 0 },
  yoghurt:    { kcal: 59,  protein: 10, fiber: 0, fat: 0.4, satfat: 0.1, sugars: 3.6, salt: 0.05, fvl: 0 },
  milk:       { kcal: 64,  protein: 3.4, fiber: 0, fat: 3.6, satfat: 2.3, sugars: 4.7, salt: 0.1, fvl: 0 },
  oats:       { kcal: 379, protein: 13, fiber: 10, fat: 7, satfat: 1.2, sugars: 1, salt: 0.02, fvl: 0 },
  wholemeal:  { kcal: 247, protein: 13, fiber: 7, fat: 3.4, satfat: 0.6, sugars: 3, salt: 1, fvl: 0 },
  whiteBread: { kcal: 265, protein: 9, fiber: 2.7, fat: 3.2, satfat: 0.7, sugars: 5, salt: 1.1, fvl: 0 },
  pizza:      { kcal: 266, protein: 11, fiber: 2.3, fat: 10, satfat: 4.4, sugars: 3.6, salt: 1.2, fvl: 15 },
  crisps:     { kcal: 536, protein: 6.6, fiber: 4.4, fat: 34, satfat: 3.1, sugars: 0.6, salt: 1.3, fvl: 0 },
  cheddar:    { kcal: 416, protein: 25, fiber: 0, fat: 35, satfat: 21, sugars: 0.1, salt: 1.8, fvl: 0 },
  chocolate:  { kcal: 535, protein: 7.6, fiber: 3.4, fat: 30, satfat: 18, sugars: 52, salt: 0.1, fvl: 0 },
  sausageRoll:{ kcal: 330, protein: 9, fiber: 1.5, fat: 22, satfat: 9, sugars: 2, salt: 1.4, fvl: 0 },
};
const grade = (k) => E.nutriScore(P100[k]).grade;

// ---------------------------------------------------------------------------
// Per-food grading (Nutri-Score)

test('grades match the labels these foods actually carry', () => {
  // Front-of-pack Nutri-Score grades for these products in the UK and EU.
  ['broccoli', 'lentils', 'apple', 'banana', 'chicken', 'salmon', 'egg', 'yoghurt', 'oats', 'wholemeal']
    .forEach(k => assert.equal(grade(k), 'A', `${k} graded ${grade(k)}, expected A`));
  assert.equal(grade('milk'), 'B');
  assert.equal(grade('whiteBread'), 'C');
  assert.equal(grade('pizza'), 'D');
  assert.equal(grade('crisps'), 'D');
  ['cheddar', 'chocolate', 'sausageRoll']
    .forEach(k => assert.equal(grade(k), 'E', `${k} graded ${grade(k)}, expected E`));
});

test('calorie density is penalised directly, which is the point of grading per 100 g', () => {
  // The failure this replaced: scored per calorie, crisps looked barely salty, because dividing
  // their salt by their many calories hid it. Per 100 g the energy itself counts against them.
  assert.ok(E.nutriScore(P100.crisps).points > E.nutriScore(P100.broccoli).points + 10);
});

test('protein cannot buy a bad food a good grade', () => {
  // Cheddar is as protein-rich as chicken; the rule that drops protein once a food is deep in the
  // negative is what keeps it at E.
  assert.equal(grade('cheddar'), 'E');
  assert.ok(E.nutriScore(P100.cheddar).points >= 19);
});

test('the fruit and veg share lifts whole plant foods, and potatoes do not count', () => {
  const withShare = E.nutriScore(P100.apple);
  const withoutShare = E.nutriScore(Object.assign({}, P100.apple, { fvl: 0 }));
  assert.ok(withShare.points < withoutShare.points, 'the plant share should improve an apple');
  assert.equal(withShare.grade, 'A');
  // Crisps are potato, which is excluded, so they must not sneak a lift out of it.
  assert.equal(grade('crisps'), 'D');
});

test('a food with no calories cannot be graded', () => {
  assert.equal(E.nutriScore({ kcal: 0, protein: 0 }), null);
  assert.equal(E.nutriScore(null), null);
});

test('grading needs a known weight, since the scale is per 100 g', () => {
  const withWeight = E.ndPer100kcal(
    { kcal: 165, protein: 31, fiber: 0, fat: 3.6 }, { satfat: 0.6, sugars: 0, salt: 0.1, grams: 100 });
  const withoutWeight = E.ndPer100kcal(
    { kcal: 165, protein: 31, fiber: 0, fat: 3.6 }, { satfat: 0.6, sugars: 0, salt: 0.1 });
  assert.equal(E.nsFromNq(withWeight).grade, 'A');
  assert.equal(E.nsFromNq(withoutWeight), null);
});

// ---------------------------------------------------------------------------
// The Density Score: our own 0-100 presentation of the same validated thresholds

test('the food score runs the same direction and scale as the day score', () => {
  // Higher is better on both, and 70 means the same thing on both, which is the whole point of
  // converting away from Nutri-Score's backwards points.
  const s = (k) => E.densityScore(E.nutriScore(P100[k]).points);
  assert.ok(s('broccoli') > s('chocolate'));
  assert.ok(s('lentils') >= 90, `lentils scored ${s('lentils')}`);
  assert.ok(s('chocolate') <= 25, `chocolate scored ${s('chocolate')}`);
  Object.keys(P100).forEach(k => {
    const v = s(k);
    assert.ok(v >= 0 && v <= 100 && Number.isInteger(v), `${k} scored ${v}`);
  });
});

test('the score bands sit exactly on the published grade boundaries', () => {
  // A food at the A/B boundary must land on 75, and the D/E boundary on 35, so the bands people see
  // are the validated ones rather than numbers we felt like picking.
  assert.equal(E.densityScore(1), 75);
  assert.equal(E.densityScore(3), 65);
  assert.equal(E.densityScore(11), 50);
  assert.equal(E.densityScore(19), 35);
  assert.equal(E.densityScore(-15), 100);
  assert.equal(E.densityScore(40), 0);
  // Beyond the ends it flattens rather than running off the scale.
  assert.equal(E.densityScore(-40), 100);
  assert.equal(E.densityScore(80), 0);
});

test('every food that clears the day target is one a coach would endorse', () => {
  const good = Object.keys(P100).filter(k => E.nsFromNq({
    ed: P100[k].kcal, protein: P100[k].protein / (P100[k].kcal / 100), fiber: P100[k].fiber / (P100[k].kcal / 100),
    fat: P100[k].fat / (P100[k].kcal / 100), satfat: P100[k].satfat / (P100[k].kcal / 100),
    sugars: P100[k].sugars / (P100[k].kcal / 100), salt: P100[k].salt / (P100[k].kcal / 100), fvl: P100[k].fvl,
  }).score >= E.ND_TARGET);
  ['chocolate', 'cheddar', 'crisps', 'sausageRoll', 'pizza'].forEach(k =>
    assert.ok(!good.includes(k), `${k} should not clear the target`));
  ['broccoli', 'lentils', 'chicken', 'salmon', 'oats'].forEach(k =>
    assert.ok(good.includes(k), `${k} should clear the target`));
});

test('the reasons given match what actually drove the score', () => {
  const nqOf = (k) => {
    const f = P100[k], s = 100 / f.kcal;
    return { ed: f.kcal, protein: f.protein * s, fiber: f.fiber * s, fat: f.fat * s,
      satfat: f.satfat * s, sugars: f.sugars * s, salt: f.salt * s, fvl: f.fvl };
  };
  const keys = (k) => E.dsReasons(nqOf(k)).map(r => r.key);
  assert.ok(keys('chocolate').includes('sugars'), 'chocolate should be called out for sugar');
  assert.ok(keys('chocolate').includes('satfat'));
  assert.ok(keys('cheddar').includes('salt'));
  assert.ok(keys('crisps').includes('energy'));
  assert.ok(keys('lentils').includes('fiber'), 'lentils should be credited for fibre');
  assert.ok(keys('chicken').includes('protein'));
  assert.ok(keys('broccoli').includes('fvl'));
  // Good things are flagged as good, bad as bad.
  E.dsReasons(nqOf('chocolate')).forEach(r => {
    if (['sugars', 'satfat', 'energy', 'salt'].includes(r.key)) assert.equal(r.good, false);
  });
});

test('a food with no known weight has no score and no reasons', () => {
  assert.equal(E.nsFromNq({ protein: 10, fiber: 2 }), null);
  assert.deepEqual(E.dsReasons({ protein: 10, fiber: 2 }), []);
});

// ---------------------------------------------------------------------------
// Drinks (the Nutri-Score beverage table)

const DRINK = {
  cola:      { kcal: 42, sugars: 10.6, protein: 0, satfat: 0, salt: 0.01, fvl: 0, beverage: true },
  dietCola:  { kcal: 1, sugars: 0, protein: 0, satfat: 0, salt: 0.01, fvl: 0, beverage: true },
  juice:     { kcal: 45, sugars: 8.9, protein: 0.7, satfat: 0, salt: 0.01, fvl: 100, beverage: true },
  milk:      { kcal: 50, sugars: 4.8, protein: 3.6, satfat: 1.1, salt: 0.1, fvl: 0, beverage: true },
  smoothie:  { kcal: 57, sugars: 11, protein: 0.8, satfat: 0, salt: 0.01, fvl: 100, beverage: true },
  water:     { kcal: 0, sugars: 0, protein: 0, satfat: 0, salt: 0, fvl: 0, beverage: true, water: true },
};

test('a drink is judged on the drinks table, which is far stricter', () => {
  // The bug this fixes: scored as a solid food, cola came out a C. A drink gets its worst energy
  // band at 390 kJ per 100 ml where a food is allowed 3,350, because liquid calories go down
  // without registering as food.
  assert.equal(E.nutriScore(DRINK.cola).grade, 'E');
  const asFood = E.nutriScore(Object.assign({}, DRINK.cola, { beverage: false }));
  assert.ok(E.densityScore(E.nutriScore(DRINK.cola).points, true) < E.densityScore(asFood.points) - 25,
    'the same cola must score far worse as a drink than it did as a food');
});

test('drink grades match the labels', () => {
  assert.equal(E.nutriScore(DRINK.dietCola).grade, 'B');
  assert.equal(E.nutriScore(DRINK.juice).grade, 'D');   // juice is not a health food, fruit or not
  assert.equal(E.nutriScore(DRINK.milk).grade, 'C');
  assert.equal(E.nutriScore(DRINK.smoothie).grade, 'E');
});

test('only water reaches the top, and it goes to the very top', () => {
  // Nutri-Score reserves A for water alone, so nothing else can claim it however empty it is.
  assert.equal(E.nutriScore(DRINK.water).grade, 'A');
  assert.notEqual(E.nutriScore(DRINK.dietCola).grade, 'A');
  const nq = { ed: 0.1, protein: 0, fiber: 0, fat: 0, satfat: 0, sugars: 0, salt: 0, bev: true, water: true };
  assert.equal(E.nsFromNq(nq).score, 100);
});

test('drink bands line up with the drink grade boundaries', () => {
  // The point of separate anchors: a C-grade drink must not land in the "good" band just because
  // the solid-food line put it there.
  const band = (k) => E.dsBand(E.densityScore(E.nutriScore(DRINK[k]).points, true)).key;
  assert.equal(band('cola'), 'treat');
  assert.equal(band('juice'), 'low');
  assert.equal(band('milk'), 'ok');          // milk grades C, and lands mid-scale rather than "good"
  assert.equal(band('dietCola'), 'excellent');
  // The ordering is the real assertion: milk above juice above cola, whatever the exact numbers.
  const score = (k) => E.densityScore(E.nutriScore(DRINK[k]).points, true);
  assert.ok(score('milk') > score('juice') && score('juice') > score('cola'));
});

test('the drink flag travels with the food, not with the portion', () => {
  const half = E.ndPer100kcal({ kcal: 84, protein: 0, fiber: 0, fat: 0 },
    { sugars: 21.2, satfat: 0, salt: 0.02, grams: 200, beverage: true });
  const double = E.ndPer100kcal({ kcal: 336, protein: 0, fiber: 0, fat: 0 },
    { sugars: 84.8, satfat: 0, salt: 0.08, grams: 800, beverage: true });
  assert.equal(half.bev, true);
  assert.equal(E.nsFromNq(half).score, E.nsFromNq(double).score);
  assert.equal(E.nsFromNq(half).grade, 'E');
});

test('a model saying it is a drink is carried through the estimate', () => {
  const c = E.ndClampEstimate({ satfat_g: 0, sugars_g: 10, salt_g: 0, is_drink: true, confident: true },
    { kcal: 42, carbs: 11, fat: 0 });
  assert.equal(c.beverage, true);
  const notDrink = E.ndClampEstimate({ satfat_g: 0, sugars_g: 10, salt_g: 0, confident: true },
    { kcal: 42, carbs: 11, fat: 0 });
  assert.equal(notDrink.beverage, undefined);
});

// ---------------------------------------------------------------------------
// Whole-day scoring (HEI-style density)

// Build a day entry from a food and the grams eaten of it.
const meal = (k, grams) => {
  const f = P100[k], s = grams / 100;
  return {
    kcal: f.kcal * s,
    nq: E.ndPer100kcal(
      { kcal: f.kcal * s, protein: f.protein * s, fiber: f.fiber * s, fat: f.fat * s },
      { satfat: f.satfat * s, sugars: f.sugars * s, salt: f.salt * s, fvl: f.fvl, grams: grams }),
  };
};
const GOOD_DAY = [meal('oats', 80), meal('banana', 120), meal('chicken', 200), meal('lentils', 200),
  meal('broccoli', 200), meal('yoghurt', 150), meal('wholemeal', 100)];
const POOR_DAY = [meal('whiteBread', 150), meal('cheddar', 60), meal('crisps', 60),
  meal('chocolate', 60), meal('sausageRoll', 120), meal('pizza', 200)];

test('a day of whole food clears the target and a day of treats does not', () => {
  const good = E.ndDay(GOOD_DAY), poor = E.ndDay(POOR_DAY);
  assert.ok(good.hit, `a whole-food day scored ${good.score}, below the ${good.target} target`);
  assert.ok(!poor.hit, `a day of treats scored ${poor.score}, at or above the target`);
  assert.ok(good.score > poor.score + 25);
});

test('the target and bands are the published HEI cut points', () => {
  assert.equal(E.ND_TARGET, 70);              // HEI-2020 "high" diet quality
  assert.equal(E.ND_POPULATION_AVERAGE, 58);  // the US population mean, our honest benchmark
  assert.equal(E.ndBand(70).key, 'good');
  assert.equal(E.ndBand(69).key, 'ok');
  assert.equal(E.ndBand(59).key, 'low');
  assert.equal(E.ndBand(49).key, 'poor');
  assert.equal(E.ndBand(null).key, 'none');
});

test('the day is scored on its totals, so one food is judged in the company it keeps', () => {
  // The same chocolate does less damage inside a good day than it does on its own, which is what
  // scoring the aggregate means and what averaging food scores could never express.
  const alone = E.ndDay([meal('chocolate', 60)]);
  const withinGoodDay = E.ndDay(GOOD_DAY.concat([meal('chocolate', 60)]));
  assert.ok(withinGoodDay.score > alone.score + 20);
  // It should still cost something.
  assert.ok(withinGoodDay.score < E.ndDay(GOOD_DAY).score);
});

test('alcohol dilutes the day rather than being excused', () => {
  // HEI-2015 onwards: alcohol is not scored as a component, but its calories still count towards
  // the day. A big night must not leave the score untouched, and must not read as "unscored" either.
  const sober = E.ndDay(GOOD_DAY);
  const withDrinks = E.ndDay(GOOD_DAY.concat([{ kcal: 600, alcohol: true }]));
  assert.ok(withDrinks.score < sober.score, `${withDrinks.score} should be below ${sober.score}`);
  assert.equal(withDrinks.uncovered, 0, 'alcohol is known to bring nothing, so it is not uncovered');
  assert.equal(withDrinks.kcalScored, sober.kcalScored + 600);
});

test('a missing nutrient record is never treated as a clean bill of health', () => {
  const day = E.ndDay([meal('chicken', 200), { kcal: 500 }]);
  assert.equal(day.uncovered, 500);
  assert.equal(day.kcalScored, 330);          // 200 g of chicken
  assert.equal(day.kcalTotal, 830);
  assert.ok(day.score != null, 'the part we can score still scores');
});

test('an empty day has no score rather than a zero', () => {
  const empty = E.ndDay([]);
  assert.equal(empty.score, null);
  assert.equal(empty.hit, false);
  assert.equal(empty.coverage, 0);
});

test('portion size does not change a food record', () => {
  const chicken = (g) => E.ndPer100kcal(
    { kcal: 1.65 * g, protein: 0.31 * g, fiber: 0, fat: 0.036 * g },
    { satfat: 0.006 * g, sugars: 0, salt: 0.001 * g, grams: g });
  assert.equal(E.nsFromNq(chicken(50)).grade, E.nsFromNq(chicken(400)).grade);
  assert.equal(E.ndScore(chicken(50)), E.ndScore(chicken(400)));
});

test('ignores portions too small to divide meaningfully', () => {
  assert.equal(E.ndPer100kcal({ kcal: 0 }, {}), null);
  assert.equal(E.ndPer100kcal({ kcal: 4 }, {}), null);
  assert.ok(E.ndPer100kcal({ kcal: 5, protein: 1 }, {}) !== null);
});

// ---------------------------------------------------------------------------
// The week

test('the trend averages only the days there is something to score', () => {
  const t = E.ndTrend([
    { date: '2026-07-29', entries: GOOD_DAY },
    { date: '2026-07-30', entries: [] },          // nothing logged, must not count as a bad day
    { date: '2026-07-31', entries: POOR_DAY },
  ]);
  assert.equal(t.daysScored, 2);
  assert.equal(t.days.length, 3);
  assert.equal(t.days[1].score, null);
  assert.equal(t.daysHit, 1);
  const good = E.ndDay(GOOD_DAY).score, poor = E.ndDay(POOR_DAY).score;
  assert.equal(t.average, Math.round((good + poor) / 2));
});

test('an unlogged week has no average rather than a zero', () => {
  const t = E.ndTrend([{ date: '2026-07-30', entries: [] }, { date: '2026-07-31', entries: [] }]);
  assert.equal(t.average, null);
  assert.equal(t.daysScored, 0);
});

// ---------------------------------------------------------------------------
// AI estimates

test('an AI estimate is held to the macros the food already has', () => {
  const macros = { kcal: 200, protein: 5, carbs: 10, fat: 6 };
  const clamped = E.ndClampEstimate({ satfat_g: 40, sugars_g: 60, salt_g: 1.2, fvl_pct: 150, confident: true }, macros);
  assert.equal(clamped.satfat, 6, 'saturated fat cannot exceed total fat');
  assert.equal(clamped.sugars, 10, 'sugars cannot exceed total carbohydrate');
  assert.equal(clamped.salt, 1.2);
  assert.equal(clamped.fvl, 100, 'a share of weight cannot exceed 100%');
  assert.equal(clamped.estimated, true);
});

test('an AI estimate that declines or says nothing leaves the food unscored', () => {
  const macros = { kcal: 200, protein: 5, carbs: 10, fat: 6 };
  assert.equal(E.ndClampEstimate({ satfat_g: 2, sugars_g: 3, salt_g: 1, confident: false }, macros), null);
  assert.equal(E.ndClampEstimate({ confident: true }, macros), null);
  assert.equal(E.ndClampEstimate(null, macros), null);
});

test('negative or junk values from a model never become credit', () => {
  const macros = { kcal: 200, protein: 5, carbs: 10, fat: 6 };
  const c = E.ndClampEstimate({ satfat_g: -5, sugars_g: 'lots', salt_g: -1, confident: true }, macros);
  assert.equal(c.satfat, 0);
  assert.equal(c.sugars, 0);
  assert.equal(c.salt, 0);
});

test('an unknown limit nutrient would flatter a food, which is why callers must not fake it', () => {
  const honest = E.ndPer100kcal(
    { kcal: 535, protein: 7.6, fiber: 3.4, fat: 30 }, { satfat: 18, sugars: 52, salt: 0.1, grams: 100 });
  const pretendingZero = E.ndPer100kcal(
    { kcal: 535, protein: 7.6, fiber: 3.4, fat: 30 }, { grams: 100 });
  assert.ok(E.ndScore(pretendingZero) > E.ndScore(honest) + 20,
    'missing limit nutrients inflate the score, so they must never be defaulted to 0');
  assert.equal(E.nsFromNq(honest).grade, 'E');
  assert.notEqual(E.nsFromNq(pretendingZero).grade, 'E');
});
