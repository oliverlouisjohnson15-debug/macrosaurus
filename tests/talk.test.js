'use strict';
// Tests for app/talk.js: what the buddy's conversation is allowed to do, and what a tool call
// resolves to. This is the decision layer between the model and someone's food diary, so the cases
// that matter most are the REFUSALS - a tool call that should not have been made must come back as
// an error the model can act on, not as a write. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Talk = require('../app/talk.js');

const CTX = {
  meals: [{ id: 'm1', name: 'Breakfast' }, { id: 'm2', name: 'Lunch' }, { id: 'm3', name: 'Dinner' }],
  foods: [{ name: 'Chicken breast' }, { name: 'Chicken thigh' }, { name: 'Porridge oats' }, { name: 'Chicken' }],
  savedMeals: [{ name: 'Usual breakfast' }, { name: 'Post-gym shake' }],
};

// ---- the tool definitions themselves ----

test('every tool is strict with a closed schema', () => {
  for (const t of Talk.TOOLS) {
    assert.equal(t.strict, true, `${t.name} is not strict`);
    assert.equal(t.input_schema.additionalProperties, false, `${t.name} allows extra properties`);
    assert.ok(Array.isArray(t.input_schema.required), `${t.name} has no required list`);
    assert.ok(t.description.length > 40, `${t.name} needs a description the model can act on`);
  }
});

test('no tool accepts calories or macros: the model never invents numbers', () => {
  const banned = ['kcal', 'calories', 'protein', 'carbs', 'fat', 'fibre', 'fiber', 'macros'];
  for (const t of Talk.TOOLS) {
    for (const prop of Object.keys(t.input_schema.properties || {})) {
      assert.ok(!banned.includes(prop.toLowerCase()), `${t.name} takes ${prop} from the model`);
    }
  }
});

test('every tool that writes says so in its description', () => {
  for (const name of ['estimate_meal', 'log_known_food', 'log_saved_meal', 'save_weight']) {
    const t = Talk.TOOLS.find(x => x.name === name);
    assert.match(t.description, /does NOT (log|save) anything/,
      `${name} must tell the model it only proposes`);
  }
});

// ---- estimate_meal ----

test('estimate_meal carries the description through and resolves the meal', () => {
  const r = Talk.validate('estimate_meal', { description: 'two poached eggs on sourdough', meal: 'breakfast' }, CTX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, { kind: 'estimate', description: 'two poached eggs on sourdough', mealId: 'm1' });
});

test('estimate_meal without a meal leaves the choice to the app', () => {
  const r = Talk.validate('estimate_meal', { description: 'a flat white' }, CTX);
  assert.equal(r.plan.mealId, null);
});

test('estimate_meal refuses an empty description rather than estimating nothing', () => {
  for (const d of ['', '   ', undefined]) {
    const r = Talk.validate('estimate_meal', { description: d }, CTX);
    assert.equal(r.ok, false);
    assert.match(r.error, /what they ate/i);
  }
});

// ---- log_known_food ----

test('log_known_food resolves an exact food and rounds the grams', () => {
  const r = Talk.validate('log_known_food', { name: 'Porridge oats', grams: 60.4 }, CTX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, { kind: 'known_food', name: 'Porridge oats', grams: 60, mealId: null });
});

test('log_known_food prefers an exact match over a prefix one', () => {
  // "Chicken" is a food in its own right AND a prefix of two others. The exact one must win, or a
  // request for chicken silently logs chicken thigh.
  const r = Talk.validate('log_known_food', { name: 'chicken', grams: 100 }, CTX);
  assert.equal(r.plan.name, 'Chicken');
});

test('log_known_food falls back to a prefix match when there is no exact one', () => {
  const r = Talk.validate('log_known_food', { name: 'porridge', grams: 50 }, CTX);
  assert.equal(r.plan.name, 'Porridge oats');
});

test('log_known_food refuses a food the user has never logged, and says what they do have', () => {
  const r = Talk.validate('log_known_food', { name: 'chicken korma', grams: 300 }, CTX);
  assert.equal(r.ok, false);
  assert.match(r.error, /no saved food/i);
  assert.match(r.error, /Chicken/, 'the error should list near matches so the model can retry');
  assert.match(r.error, /estimate_meal/, 'and point at the tool that can handle something new');
});

test('log_known_food refuses a nonsense weight', () => {
  for (const g of [0, -50, NaN, undefined, 'lots']) {
    assert.equal(Talk.validate('log_known_food', { name: 'Chicken', grams: g }, CTX).ok, false, `grams=${g}`);
  }
});

test('log_known_food refuses an implausible weight rather than logging 50000 kcal', () => {
  const r = Talk.validate('log_known_food', { name: 'Chicken', grams: 9000 }, CTX);
  assert.equal(r.ok, false);
  assert.match(r.error, /slip/i);
});

// ---- log_saved_meal ----

test('log_saved_meal resolves a saved meal', () => {
  const r = Talk.validate('log_saved_meal', { name: 'Usual breakfast', meal: 'Breakfast' }, CTX);
  assert.deepEqual(r.plan, { kind: 'saved_meal', name: 'Usual breakfast', mealId: 'm1' });
});

test('log_saved_meal will not treat a plain food as a saved meal', () => {
  const r = Talk.validate('log_saved_meal', { name: 'Chicken breast' }, CTX);
  assert.equal(r.ok, false);
  assert.match(r.error, /no saved meal/i);
});

// ---- recent_foods ----

test('recent_foods searches both foods and saved meals', () => {
  const r = Talk.validate('recent_foods', { query: 'chicken' }, CTX);
  assert.deepEqual(r.plan.results.foods, ['Chicken breast', 'Chicken thigh', 'Chicken']);
  assert.deepEqual(r.plan.results.meals, []);
});

test('recent_foods with an empty query lists what there is', () => {
  const r = Talk.validate('recent_foods', { query: '' }, CTX);
  assert.equal(r.plan.results.foods.length, 4);
  assert.equal(r.plan.results.meals.length, 2);
});

test('recent_foods caps how much it hands back', () => {
  const many = { foods: Array.from({ length: 50 }, (_, i) => ({ name: 'Food ' + i })), savedMeals: [] };
  const r = Talk.validate('recent_foods', { query: 'food' }, many);
  assert.equal(r.plan.results.foods.length, Talk.MAX_MATCHES);
});

// ---- save_weight ----

test('save_weight rounds to one decimal', () => {
  const r = Talk.validate('save_weight', { kg: 82.44 }, CTX);
  assert.deepEqual(r.plan, { kind: 'weight', kg: 82.4 });
});

test('save_weight refuses a weight nobody is, which is how a misread stone value gets caught', () => {
  for (const kg of [0, -5, 12, 700, NaN]) {
    assert.equal(Talk.validate('save_weight', { kg }, CTX).ok, false, `kg=${kg}`);
  }
  assert.equal(Talk.validate('save_weight', { kg: Talk.MIN_KG }, CTX).ok, true);
  assert.equal(Talk.validate('save_weight', { kg: Talk.MAX_KG }, CTX).ok, true);
});

// ---- open_screen ----

test('open_screen maps a named screen to an app view', () => {
  assert.equal(Talk.validate('open_screen', { screen: 'progress' }, CTX).plan.view, 'goals');
  assert.equal(Talk.validate('open_screen', { screen: 'check-in' }, CTX).plan.view, 'checkin');
});

test('open_screen refuses anything not on the list', () => {
  // The one tool with no confirmation step, so the set of places it can send someone is closed.
  for (const s of ['admin', 'settings/billing', '', 'https://example.com', undefined]) {
    assert.equal(Talk.validate('open_screen', { screen: s }, CTX).ok, false, `screen=${s}`);
  }
});

test('every screen in the enum is one open_screen can actually resolve', () => {
  const t = Talk.TOOLS.find(x => x.name === 'open_screen');
  for (const s of t.input_schema.properties.screen.enum) {
    assert.equal(Talk.validate('open_screen', { screen: s }, CTX).ok, true, `enum lists ${s} but it does not resolve`);
  }
});

// ---- the outer edge ----

test('an unknown tool is refused rather than ignored', () => {
  const r = Talk.validate('delete_everything', {}, CTX);
  assert.equal(r.ok, false);
  assert.match(r.error, /no tool called/i);
});

test('validate survives missing args and a missing context', () => {
  for (const name of Talk.TOOL_NAMES) {
    assert.doesNotThrow(() => Talk.validate(name, undefined, undefined), `${name} threw on empty input`);
    assert.doesNotThrow(() => Talk.validate(name, {}, {}), `${name} threw on empty objects`);
  }
});

test('day_summary needs nothing and always resolves', () => {
  assert.deepEqual(Talk.validate('day_summary', {}, CTX).plan, { kind: 'summary' });
});
