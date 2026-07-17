'use strict';
// Tests for the recipe module: pure helpers in app/recipe.js (single-line ingredient model, nutrition
// analysis application, per-serving maths) plus store wiring (migration + conflict-free merge). node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Recipe = require('../app/recipe.js');
const Store = require('../app/store.js');

// ---- detectShare -----------------------------------------------------------------------------
test('detectShare finds YouTube/Instagram links in shared text', () => {
  assert.deepStrictEqual(Recipe.detectShare('nice wrap https://www.youtube.com/shorts/abc go'), { platform: 'youtube', url: 'https://www.youtube.com/shorts/abc' });
  assert.strictEqual(Recipe.detectShare('https://youtu.be/xY').platform, 'youtube');
  assert.strictEqual(Recipe.detectShare('look https://www.instagram.com/reel/CxYz/').platform, 'instagram');
  assert.strictEqual(Recipe.detectShare('just notes'), null);
  assert.strictEqual(Recipe.detectShare('https://example.com/recipe'), null);
});

// ---- lineOf / nameFromLine -------------------------------------------------------------------
test('nameFromLine strips a leading amount + unit', () => {
  assert.strictEqual(Recipe.nameFromLine('150 g cottage cheese'), 'cottage cheese');
  assert.strictEqual(Recipe.nameFromLine('1 tbsp olive oil'), 'olive oil');
  assert.strictEqual(Recipe.nameFromLine('2 cloves garlic'), 'garlic');
  assert.strictEqual(Recipe.nameFromLine('4 large eggs'), 'eggs');
  assert.strictEqual(Recipe.nameFromLine('salt'), 'salt');
});
test('lineOf rebuilds a line from legacy name/grams fields', () => {
  assert.strictEqual(Recipe.lineOf({ line: '150 g rice' }), '150 g rice');
  assert.strictEqual(Recipe.lineOf({ name: 'chicken', grams: 200 }), '200 g chicken');
  assert.strictEqual(Recipe.lineOf({ name: 'garlic', quantity: 2, unit: 'cloves' }), '2 cloves garlic');
});

// ---- gramsFromLine ---------------------------------------------------------------------------
test('gramsFromLine converts leading mass/volume amounts, else 0', () => {
  assert.strictEqual(Recipe.gramsFromLine('150 g cottage cheese'), 150);
  assert.strictEqual(Recipe.gramsFromLine('1.5 kg chicken'), 1500);
  assert.strictEqual(Recipe.gramsFromLine('200 ml milk'), 200);
  assert.strictEqual(Recipe.gramsFromLine('0.5 l stock'), 500);
  assert.strictEqual(Recipe.gramsFromLine('1 tbsp olive oil'), 0);   // portion unit -> AI
  assert.strictEqual(Recipe.gramsFromLine('2 cloves garlic'), 0);
  assert.strictEqual(Recipe.gramsFromLine('salt'), 0);
});

// ---- portionGrams / gramsForLine -------------------------------------------------------------
test('portionGrams converts standard cooking portions to grams', () => {
  assert.strictEqual(Recipe.portionGrams('1 tbsp olive oil'), 15);
  assert.strictEqual(Recipe.portionGrams('2 cloves garlic'), 10);
  assert.strictEqual(Recipe.portionGrams('1/2 tsp salt'), 3);      // round(2.5)
  assert.strictEqual(Recipe.portionGrams('1 can chopped tomatoes'), 400);
  assert.strictEqual(Recipe.portionGrams('150 g cottage cheese'), 0); // g handled elsewhere
  assert.strictEqual(Recipe.portionGrams('salt to taste'), 0);
});
test('gramsForLine prefers explicit mass, else a known portion', () => {
  assert.strictEqual(Recipe.gramsForLine('150 g cottage cheese'), 150);
  assert.strictEqual(Recipe.gramsForLine('1 tbsp olive oil'), 15);
  assert.strictEqual(Recipe.gramsForLine('a handful of spinach'), 0); // no leading number
});

// ---- stapleMacros ----------------------------------------------------------------------------
test('stapleMacros prices pure staples from the built-in table', () => {
  const oil = Recipe.stapleMacros('1 tbsp olive oil', 15);
  assert.strictEqual(oil.kcal, 133);   // 884 * 0.15
  assert.strictEqual(oil.fat, 15);
  const butter = Recipe.stapleMacros('50 g butter', 50);
  assert.strictEqual(butter.kcal, 359);
  assert.strictEqual(Recipe.stapleMacros('boiled potatoes', 200), null); // "oil" not a token of "boiled"
  assert.strictEqual(Recipe.stapleMacros('1 tbsp olive oil', 0), null);  // no grams -> no price
  assert.strictEqual(Recipe.stapleMacros('200 g chicken', 200), null);   // not a staple
});

// ---- bestOffMatch ----------------------------------------------------------------------------
test('bestOffMatch picks a confident, generic match and rejects weak ones', () => {
  const cheese = Recipe.bestOffMatch('cottage cheese', [
    { name: 'Cheddar cheese', per100: { kcal: 400 } },
    { name: 'Cottage Cheese', per100: { kcal: 98 } },
    { name: 'Cottage cheese light', brand: 'Brand', per100: { kcal: 72 } },
  ]);
  assert.strictEqual(cheese.name, 'Cottage Cheese');            // full overlap, shortest, no brand
  // two-token names need BOTH tokens, so olive oil is not satisfied by sunflower oil
  assert.strictEqual(Recipe.bestOffMatch('olive oil', [{ name: 'Sunflower oil', per100: { kcal: 900 } }]), null);
  assert.strictEqual(Recipe.bestOffMatch('chicken', [{ name: 'Chicken breast fillets', per100: { kcal: 106 } }]).name, 'Chicken breast fillets');
  assert.strictEqual(Recipe.bestOffMatch('quinoa', []), null);
});

// ---- normalize -------------------------------------------------------------------------------
test('normalize turns string ingredient lines into unresolved ingredients', () => {
  const rec = Recipe.normalize({
    title: 'Greek Bowl', servings: 2,
    ingredients: ['150 g cottage cheese', '55 g Greek yoghurt', '  '],
    steps: ['Mix', ' '],
    stated_macros_per_serving: null,
  }, { platform: 'instagram', url: 'https://instagram.com/reel/x' });
  assert.strictEqual(rec.ingredients.length, 2);      // blank line dropped
  assert.strictEqual(rec.ingredients[0].line, '150 g cottage cheese');
  assert.strictEqual(rec.ingredients[0].name, 'cottage cheese');
  assert.strictEqual(rec.ingredients[0].macros, null);
  assert.strictEqual(rec.macros_source, 'pending');
  assert.strictEqual(rec.macros_per_serving.kcal, 0);
  assert.deepStrictEqual(rec.steps, ['Mix']);
  assert.strictEqual(rec.source_platform, 'instagram');
});
test('normalize keeps stated per-serving macros when the source gave them', () => {
  const rec = Recipe.normalize({ title: 'X', servings: 2, ingredients: ['1 thing'], stated_macros_per_serving: { kcal: 0, protein_g: 40, carbs_g: 30, fat_g: 10 } }, {});
  assert.strictEqual(rec.macros_source, 'stated');
  assert.strictEqual(rec.macros_per_serving.kcal, 370); // 40*4+30*4+10*9
  assert.ok(rec.stated_macros);
});
test('normalize tolerates legacy object ingredients (with names/grams)', () => {
  const rec = Recipe.normalize({ title: 'Old', servings: 1, ingredients: [{ name: 'chicken', grams: 200, macros: { kcal: 330, protein: 62, carbs: 0, fat: 7 } }] }, {});
  assert.strictEqual(rec.ingredients[0].line, '200 g chicken');
  assert.strictEqual(rec.ingredients[0].macros.kcal, 330);
  assert.strictEqual(rec.ingredients[0].grams, 200);
});

// ---- applyAnalysis ---------------------------------------------------------------------------
test('applyAnalysis fills per-ingredient macros by index and recomputes per serving', () => {
  const rec = Recipe.normalize({ title: 'Curry', servings: 2, ingredients: ['400 g chicken', '20 g oil', '200 ml water'] }, {});
  const result = {
    source: 'edamam',
    per_ingredient: [
      { line: '400 g chicken', weight: 400, macros: { kcal: 660, protein: 124, carbs: 0, fat: 14, fiber: 0 } },
      { line: '20 g oil', weight: 20, macros: { kcal: 180, protein: 0, carbs: 0, fat: 20, fiber: 0 } },
      { line: '200 ml water', weight: 200, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } }, // no macros -> stays unresolved
    ],
  };
  const out = Recipe.applyAnalysis(rec, result);
  assert.strictEqual(Recipe.resolvedCount(out), 2);
  assert.strictEqual(out.ingredients[0].macros.kcal, 660);
  assert.strictEqual(out.ingredients[0].grams, 400);
  assert.strictEqual(out.ingredients[0].resolved.source, 'edamam');
  assert.strictEqual(out.macros_source, 'analysed');
  assert.strictEqual(out.macros_per_serving.kcal, 420); // (660+180)/2
  // input not mutated
  assert.strictEqual(rec.ingredients[0].macros, null);
});

// ---- setIngredientMacros / macrosFromPer100 --------------------------------------------------
test('macrosFromPer100 scales a per-100g profile', () => {
  const m = Recipe.macrosFromPer100({ kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 }, 200);
  assert.strictEqual(m.kcal, 330);
  assert.strictEqual(m.protein, 62);
});
test('setIngredientMacros overrides one ingredient and recomputes per serving', () => {
  let rec = Recipe.normalize({ title: 'X', servings: 1, ingredients: ['100 g bread', '10 g butter'] }, {});
  rec = Recipe.setIngredientMacros(rec, rec.ingredients[0].id, { kcal: 250, protein: 9, carbs: 46, fat: 3, fiber: 4 }, { source: 'manual' });
  assert.strictEqual(rec.ingredients[0].macros.kcal, 250);
  assert.strictEqual(rec.ingredients[0].resolved.source, 'manual');
  assert.strictEqual(rec.macros_per_serving.kcal, 250); // only one resolved, servings 1
});

// ---- perServingIngredients -------------------------------------------------------------------
test('perServingIngredients divides resolved ingredient macros by servings', () => {
  const rec = Recipe.applyAnalysis(
    Recipe.normalize({ title: 'C', servings: 2, ingredients: ['400 g chicken', '200 ml water'] }, {}),
    { source: 'edamam', per_ingredient: [{ weight: 400, macros: { kcal: 660, protein: 124, carbs: 0, fat: 14, fiber: 0 } }, { weight: 200, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } }] }
  );
  const items = Recipe.perServingIngredients(rec);
  assert.strictEqual(items.length, 1);           // water excluded
  assert.strictEqual(items[0].name, 'chicken');
  assert.strictEqual(items[0].grams, 200);        // 400/2
  assert.strictEqual(items[0].macros.kcal, 330);  // 660/2
});

// ---- fitScore --------------------------------------------------------------------------------
test('fitScore flags fit vs over remaining macros', () => {
  const fits = Recipe.fitScore({ kcal: 400, protein: 40 }, { kcal: 900 });
  assert.strictEqual(fits.fitsKcal, true);
  assert.strictEqual(fits.label, 'fits your day');
  const over = Recipe.fitScore({ kcal: 800 }, { kcal: 500 });
  assert.strictEqual(over.fitsKcal, false);
  assert.strictEqual(over.overKcal, 300);
});

// ---- fitPortion ------------------------------------------------------------------------------
test('fitPortion suggests the serving multiple that fits remaining calories', () => {
  assert.strictEqual(Recipe.fitPortion({ kcal: 500 }, { kcal: 750 }), 1.5);   // 1.5 servings fits
  assert.strictEqual(Recipe.fitPortion({ kcal: 800 }, { kcal: 300 }), 0.25);  // floors 0.375 down, min a quarter
  assert.strictEqual(Recipe.fitPortion({ kcal: 400 }, { kcal: 4000 }), 4);    // cap at 4
  assert.strictEqual(Recipe.fitPortion({ kcal: 0 }, { kcal: 500 }), null);    // unpriced
  assert.strictEqual(Recipe.fitPortion({ kcal: 500 }, { kcal: 0 }), null);    // no room
});

// ---- planMacros ------------------------------------------------------------------------------
test('planMacros sums a day of planned recipes by portion', () => {
  const byId = {
    r1: { macros_per_serving: { kcal: 400, protein: 40, carbs: 30, fat: 12, fiber: 5 } },
    r2: { macros_per_serving: { kcal: 600, protein: 30, carbs: 60, fat: 20, fiber: 8 } },
  };
  const m = Recipe.planMacros([{ recipe_id: 'r1', portion: 1 }, { recipe_id: 'r2', portion: 0.5 }, { recipe_id: 'missing' }], byId);
  assert.strictEqual(m.kcal, 700);   // 400 + 300
  assert.strictEqual(m.protein, 55); // 40 + 15
});

// ---- newShoppingItems ------------------------------------------------------------------------
test('newShoppingItems skips names already unchecked and dedupes', () => {
  const fresh = Recipe.newShoppingItems([{ name: 'Rice', checked: false }, { name: 'Salt', checked: true }], [{ name: 'rice' }, { name: 'Salt' }, { name: 'Chicken' }, { name: 'chicken' }]);
  assert.deepStrictEqual(fresh.map(x => x.name), ['Salt', 'Chicken']);
});

// ---- macroSanity -----------------------------------------------------------------------------
test('macroSanity flags implausible per-serving macros', () => {
  assert.strictEqual(Recipe.macroSanity({ macros_per_serving: { kcal: 0 } }), null);            // not priced yet
  assert.strictEqual(Recipe.macroSanity({ macros_per_serving: { kcal: 520, protein: 40, carbs: 45, fat: 18 } }), null); // fine
  assert.ok(Recipe.macroSanity({ macros_per_serving: { kcal: 40 } }));                            // too low
  assert.ok(Recipe.macroSanity({ macros_per_serving: { kcal: 2200 } }));                          // too high
  assert.ok(Recipe.macroSanity({ macros_per_serving: { kcal: 300, protein: 60, carbs: 60, fat: 30 } })); // kcal vs macros mismatch (~750)
});

// ---- scaleLine / scaleServings ---------------------------------------------------------------
test('scaleLine scales the leading amount in a line', () => {
  assert.strictEqual(Recipe.scaleLine('150 g cottage cheese', 2), '300 g cottage cheese');
  assert.strictEqual(Recipe.scaleLine('1 tbsp olive oil', 2), '2 tbsp olive oil');
  assert.strictEqual(Recipe.scaleLine('2 cloves garlic', 0.5), '1 cloves garlic');
  assert.strictEqual(Recipe.scaleLine('1/2 onion', 2), '1 onion');
  assert.strictEqual(Recipe.scaleLine('salt to taste', 2), 'salt to taste'); // no leading number
});
test('scaleServings scales amounts + macros, keeping per-serving the same', () => {
  let rec = Recipe.applyAnalysis(
    Recipe.normalize({ title: 'X', servings: 2, ingredients: ['200 g rice', '1 tbsp oil'] }, {}),
    { source: 'edamam', per_ingredient: [{ weight: 200, macros: { kcal: 260, protein: 5, carbs: 57, fat: 1, fiber: 1 } }, { weight: 14, macros: { kcal: 120, protein: 0, carbs: 0, fat: 14, fiber: 0 } }] }
  );
  const perServBefore = rec.macros_per_serving.kcal; // (260+120)/2 = 190
  const s = Recipe.scaleServings(rec, 4);
  assert.strictEqual(s.servings, 4);
  assert.strictEqual(s.ingredients[0].line, '400 g rice');
  assert.strictEqual(s.ingredients[0].macros.kcal, 520); // doubled
  assert.strictEqual(Recipe.computePerServing(s).macros.kcal, perServBefore); // 190, unchanged
});
test('scaleMacros multiplies a macro set by a portion', () => {
  const m = Recipe.scaleMacros({ kcal: 400, protein: 40, carbs: 30, fat: 12, fiber: 5 }, 1.5);
  assert.strictEqual(m.kcal, 600);
  assert.strictEqual(m.protein, 60);
});

// ---- store wiring ----------------------------------------------------------------------------
test('migrate backfills recipes + shopping_list + meal_plan', () => {
  const s = Store.migrate({ profile: { goalType: 'cut' } });
  assert.ok(Array.isArray(s.recipes));
  assert.ok(Array.isArray(s.shopping_list));
  assert.ok(Array.isArray(s.meal_plan));
});
test('mergeStates unions meal_plan and honours its tombstones', () => {
  const a = Object.assign(Store.defaultState(), { _rev: 2, meal_plan: [{ id: 'p1', date: '2026-01-01', recipe_id: 'r1' }] });
  const b = Object.assign(Store.defaultState(), { _rev: 1, meal_plan: [{ id: 'p2', date: '2026-01-02', recipe_id: 'r2' }], deleted: { p1: Date.now() } });
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.meal_plan.map(p => p.id).sort(), ['p2']);
});
test('mergeStates unions recipes/shopping_list and honours tombstones', () => {
  const a = Object.assign(Store.defaultState(), { _rev: 2, recipes: [{ id: 'r1', title: 'A' }], shopping_list: [{ id: 's1', name: 'Rice' }] });
  const b = Object.assign(Store.defaultState(), { _rev: 1, recipes: [{ id: 'r2', title: 'B' }], shopping_list: [{ id: 's2', name: 'Salt' }], deleted: { r1: Date.now() } });
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.recipes.map(r => r.id).sort(), ['r2']);
  assert.deepStrictEqual(m.shopping_list.map(s => s.id).sort(), ['s1', 's2']);
});
