'use strict';
// Tests for the recipe module: pure helpers in app/recipe.js plus the store wiring (migration
// backfill + conflict-free merge/tombstones for recipes and the shopping list). Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Recipe = require('../app/recipe.js');
const Store = require('../app/store.js');

// ---- detectShare -----------------------------------------------------------------------------
test('detectShare finds a YouTube Shorts link inside shared text', () => {
  const r = Recipe.detectShare('Amazing high-protein wrap https://www.youtube.com/shorts/abc123 try it');
  assert.deepStrictEqual(r, { platform: 'youtube', url: 'https://www.youtube.com/shorts/abc123' });
});
test('detectShare finds youtu.be and instagram links', () => {
  assert.strictEqual(Recipe.detectShare('https://youtu.be/xY').platform, 'youtube');
  assert.strictEqual(Recipe.detectShare('look https://www.instagram.com/reel/CxYz/').platform, 'instagram');
});
test('detectShare returns null for unrelated text or other hosts', () => {
  assert.strictEqual(Recipe.detectShare('just some notes'), null);
  assert.strictEqual(Recipe.detectShare('https://example.com/recipe'), null);
});
test('detectShare strips trailing punctuation from the url', () => {
  assert.strictEqual(Recipe.detectShare('(https://youtu.be/abc).').url, 'https://youtu.be/abc');
});

// ---- normalize -------------------------------------------------------------------------------
test('normalize: ingredients start unresolved; per-serving only from stated macros', () => {
  const raw = {
    title: 'Chicken Wrap', servings: 2,
    ingredients: [
      { name: 'Chicken breast', quantity: 200, unit: 'g', grams: 200 },
      { name: '', quantity: 1, unit: 'tbsp' }, // dropped: no name
    ],
    steps: ['Cook chicken', '  ', 'Assemble'],
    stated_macros_per_serving: { kcal: 0, protein_g: 40, carbs_g: 30, fat_g: 10 },
    macros_confidence: 'medium',
  };
  const rec = Recipe.normalize(raw, { platform: 'youtube', url: 'https://youtu.be/x', thumbnail: 't.jpg' });
  assert.strictEqual(rec.ingredients.length, 1);          // blank-name ingredient dropped
  assert.strictEqual(rec.ingredients[0].macros, null);    // unresolved until looked up
  assert.strictEqual(rec.ingredients[0].resolved, null);
  assert.deepStrictEqual(rec.steps, ['Cook chicken', 'Assemble']);
  assert.strictEqual(rec.macros_source, 'stated');
  assert.strictEqual(rec.macros_per_serving.kcal, 370);   // derived from stated macros (40*4+30*4+10*9)
  assert.strictEqual(rec.macros_confidence, 'medium');
  assert.strictEqual(rec.source_platform, 'youtube');
});

test('normalize: no stated macros => pending, zeroed per-serving', () => {
  const rec = Recipe.normalize({ title: 'X', servings: 3, ingredients: [{ name: 'Rice', grams: 300 }], stated_macros_per_serving: null }, {});
  assert.strictEqual(rec.macros_source, 'pending');
  assert.strictEqual(rec.macros_per_serving.kcal, 0);
  assert.strictEqual(rec.ingredients[0].macros, null);
});

test('macrosFromPer100 scales a per-100g profile to a gram weight', () => {
  const m = Recipe.macrosFromPer100({ kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 }, 200);
  assert.strictEqual(m.kcal, 330);
  assert.strictEqual(m.protein, 62);
  assert.strictEqual(m.fat, 7.2);
});

test('computePerServing sums resolved ingredients only, divided by servings', () => {
  const rec = Recipe.normalize({ title: 'Curry', servings: 2, ingredients: [{ name: 'Chicken', grams: 400 }, { name: 'Oil', grams: 20 }, { name: 'Water', grams: 200 }] }, {});
  // simulate resolution of two ingredients (as OFF/manual would)
  rec.ingredients[0].macros = { kcal: 660, protein: 124, carbs: 0, fat: 14, fiber: 0 };
  rec.ingredients[1].macros = { kcal: 180, protein: 0, carbs: 0, fat: 20, fiber: 0 };
  assert.strictEqual(Recipe.resolvedCount(rec), 2);
  const cp = Recipe.computePerServing(rec);
  assert.strictEqual(cp.resolved, 2);
  assert.strictEqual(cp.macros.kcal, 420);  // (660+180)/2
  assert.strictEqual(cp.macros.fat, 17);    // (14+20)/2
  const items = Recipe.perServingIngredients(rec);
  assert.strictEqual(items.length, 2);      // unresolved Water excluded
  assert.strictEqual(items[0].macros.kcal, 330);
});
test('normalize defaults servings to at least 1 and confidence to low', () => {
  const rec = Recipe.normalize({ title: 'X', servings: 0, macros_per_serving: {} }, {});
  assert.strictEqual(rec.servings, 1);
  assert.strictEqual(rec.macros_confidence, 'low');
  assert.strictEqual(rec.macros_per_serving.kcal, 0);
});

// ---- scaleServings ---------------------------------------------------------------------------
test('scaleServings scales ingredient amounts + resolved macros but not per-serving macros', () => {
  const base = Recipe.normalize({
    title: 'Curry', servings: 4,
    ingredients: [{ name: 'Rice', quantity: 200, unit: 'g', grams: 200 }],
    stated_macros_per_serving: { kcal: 500, protein_g: 30, carbs_g: 60, fat_g: 15 },
  }, {});
  base.ingredients[0].macros = { kcal: 720, protein: 16, carbs: 156, fat: 4, fiber: 2 }; // resolved
  const s = Recipe.scaleServings(base, 2);
  assert.strictEqual(s.servings, 2);
  assert.strictEqual(s.ingredients[0].quantity, 100); // halved
  assert.strictEqual(s.ingredients[0].grams, 100);
  assert.strictEqual(s.ingredients[0].macros.kcal, 360); // resolved ingredient macros halved too
  assert.strictEqual(s.macros_per_serving.kcal, 500);  // stated per-serving unchanged
  assert.strictEqual(base.ingredients[0].quantity, 200); // original not mutated
  assert.strictEqual(base.ingredients[0].macros.kcal, 720);
});

test('fitScore flags whether a serving fits remaining macros', () => {
  const fits = Recipe.fitScore({ kcal: 400, protein: 40 }, { kcal: 900, protein: 60 });
  assert.strictEqual(fits.fitsKcal, true);
  assert.strictEqual(fits.overKcal, 0);
  assert.strictEqual(fits.proteinPer100kcal, 40); // 40*4/400 = 40%
  assert.strictEqual(fits.label, 'fits your day');
  const over = Recipe.fitScore({ kcal: 800 }, { kcal: 500 });
  assert.strictEqual(over.fitsKcal, false);
  assert.strictEqual(over.overKcal, 300);
  assert.strictEqual(over.label, 'over your day');
});

// ---- totalMacros -----------------------------------------------------------------------------
test('totalMacros multiplies per-serving by servings', () => {
  const rec = { servings: 3, macros_per_serving: { kcal: 400, protein: 30, carbs: 40, fat: 12, fiber: 5 } };
  const t = Recipe.totalMacros(rec);
  assert.strictEqual(t.kcal, 1200);
  assert.strictEqual(t.protein, 90);
  assert.strictEqual(t.fiber, 15);
});

// ---- amountLabel -----------------------------------------------------------------------------
test('amountLabel formats quantity+unit, grams, or empty', () => {
  assert.strictEqual(Recipe.amountLabel({ quantity: 2, unit: 'clove' }), '2 clove');
  assert.strictEqual(Recipe.amountLabel({ quantity: null, unit: '', grams: 200 }), '200 g');
  assert.strictEqual(Recipe.amountLabel({ quantity: null, unit: '', grams: 0 }), '');
});

// ---- newShoppingItems ------------------------------------------------------------------------
test('newShoppingItems skips names already unchecked on the list, and dedupes additions', () => {
  const existing = [{ name: 'Rice', checked: false }, { name: 'Salt', checked: true }];
  const additions = [
    { name: 'rice' },   // already present (case-insensitive) -> skip
    { name: 'Salt' },   // present but checked -> allowed back on
    { name: 'Chicken' },
    { name: 'chicken' }, // duplicate within additions -> skip
  ];
  const fresh = Recipe.newShoppingItems(existing, additions);
  assert.deepStrictEqual(fresh.map(x => x.name), ['Salt', 'Chicken']);
});

// ---- store wiring ----------------------------------------------------------------------------
test('migrate backfills recipes and shopping_list on old state', () => {
  const s = Store.migrate({ profile: { goalType: 'cut' } });
  assert.ok(Array.isArray(s.recipes));
  assert.ok(Array.isArray(s.shopping_list));
  assert.strictEqual(s.recipes.length, 0);
});
test('mergeStates unions recipes/shopping_list and honours tombstones', () => {
  const a = Object.assign(Store.defaultState(), {
    _rev: 2,
    recipes: [{ id: 'r1', title: 'A' }],
    shopping_list: [{ id: 's1', name: 'Rice' }],
  });
  const b = Object.assign(Store.defaultState(), {
    _rev: 1,
    recipes: [{ id: 'r2', title: 'B' }],
    shopping_list: [{ id: 's2', name: 'Salt' }],
    deleted: { r1: Date.now() }, // r1 was deleted on the other device
  });
  const m = Store.mergeStates(a, b);
  const ids = m.recipes.map(r => r.id).sort();
  assert.deepStrictEqual(ids, ['r2']);              // r2 unioned in, r1 stays deleted (tombstone)
  const sids = m.shopping_list.map(s => s.id).sort();
  assert.deepStrictEqual(sids, ['s1', 's2']);       // both shopping items survive the merge
});
