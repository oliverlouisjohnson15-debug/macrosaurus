'use strict';
// The soft reset: clearing the calorie log and the weigh-in history WITHOUT taking the training,
// recipes, buddy, shop and streak down with them. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Store = require('../app/store.js');
const Game = require('../app/game.js');

const shiftISO = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const TODAY = '2026-08-17';

// A state that looks like somebody who has genuinely used the app: five days of logging, weigh-ins,
// a check-in, a training block with a session in it, a recipe, Amber, a named buddy and a streak.
function livedIn() {
  const s = Store.migrate({
    profile: { goalType: 'cut', weightKg: 82, weight_unit: 'kg', sex: 'male', age: 33, heightCm: 180, activity: 'moderate' },
    log_entries: [0, 1, 2, 3, 4].map(i => ({
      id: 'e' + i, date: shiftISO(TODAY, -i), meal_id: 'm_1', name: 'Eggs',
      computed_macros: { kcal: 200, protein: 18, carbs: 2, fat: 14, fiber: 0 },
    })),
    weight_entries: [{ id: 'w0', date: shiftISO(TODAY, -4), scale_weight: 83.4, trend_weight: 83.4 }],
    checkins: [{ date: shiftISO(TODAY, -4), weightKg: 83.4, onTrack: true, changed: false }],
    last_checkin: shiftISO(TODAY, -4),
    targets: [{ id: 't0', effective_date: shiftISO(TODAY, -30), kcal: 2100, protein_g: 165, carbs_g: 200, fat_g: 60 }],
    day_overrides: { [TODAY]: { shiftKcal: 120 } },
    day_meals: { [TODAY]: [{ id: 'm_1', name: 'Brunch', sort_order: 0 }] },
    pending_adjustment: { date: TODAY, result: { deltaKcal: -80 } },
    diet_break: { start: shiftISO(TODAY, -2), end: shiftISO(TODAY, 5), returnGoal: 'cut' },
    last_break_end: shiftISO(TODAY, -60),
    paused: true,
    expenditure: { kcal: 2680, n: 6, updated: shiftISO(TODAY, -4) },
    foods: [{ id: 'f1', name: 'Skyr', is_favorite: true, macros: { kcal: 60, protein: 10, carbs: 4, fat: 0 } }],
    saved_meals: [{ id: 'sm1', name: 'Usual breakfast', items: [], created_at: 1 }],
    recipes: [{ id: 'r1', title: 'Chilli', ingredients: [], steps: [] }],
    shopping_list: [{ id: 'sl1', name: 'Mince', checked: false }],
    pantry: ['salt'],
    meal_plan: [{ id: 'mp1', date: TODAY, recipe_id: 'r1', portion: 1 }],
    training: {
      blocks: [{ id: 'b1', name: 'Upper/Lower', weeks: 4, sessions: [] }],
      logs: [{ id: 'tl1', dateISO: shiftISO(TODAY, -6), blockId: 'b1', sets: [] }],
      custom: [{ id: 'cx1', name: 'Zercher squat', primary: 'qu' }],
      prefs: { units: 'kg', experience: 'advanced', daysPerWeek: 5 },
    },
    amber_ledger: [{ id: 'a1', date: shiftISO(TODAY, -3), delta: 120, reason: 'Weekly boss' }],
    habitat: ['fern', 'pool'],
    items: { champion_belt: 1 },
    fight: { rank: 7, wins: 22, trophies: 3, prestige: 1 },
    badges: { checkins: 9, inRange: 6 },
    records: { longestStreak: 41 },
    buddy: { stage: 4, name: 'Chomp', speciesId: 'veloci', evoStage: 2, cosmetics: ['hat_party'], equipped: { head: 'hat_party' } },
    menstrual: { enabled: true, lastStart: shiftISO(TODAY, -10), cycleLen: 28 },
    steps: { [TODAY]: 9400 },
  });
  s._rev = 1000;
  return s;
}

// The app's own definition of an active day, mirrored from activeDatesSet in app.jsx.
function activeDates(s) {
  const out = new Set(s.streak_credit || []);
  (s.log_entries || []).forEach(e => out.add(e.date));
  (s.weight_entries || []).forEach(w => out.add(w.date));
  ((s.training || {}).logs || []).forEach(l => out.add(l.dateISO));
  return out;
}
const streakOf = (s, today) => Game.computeStreak(activeDates(s), new Set(((s.freezes || {}).frozen) || []), today, new Set()).streak;

test('softReset clears the tracking side', () => {
  const s = Store.softReset(livedIn(), { today: TODAY, now: 5000 });
  assert.deepStrictEqual(s.log_entries, []);
  assert.deepStrictEqual(s.checkins, []);
  assert.deepStrictEqual(s.targets, []);           // no target handed in, so nothing re-anchored
  assert.deepStrictEqual(s.day_overrides, {});
  assert.deepStrictEqual(s.day_meals, {});
  assert.strictEqual(s.pending_adjustment, null);
  assert.strictEqual(s.diet_break, null);
  assert.strictEqual(s.last_break_end, null);
  assert.strictEqual(s.diet_break_snooze, null);
  assert.strictEqual(s.paused, false);
  assert.strictEqual(s.last_checkin, TODAY);       // the cycle restarts today, it is not owed from a week that is gone
});

test('softReset keeps everything the user built', () => {
  const before = livedIn();
  const s = Store.softReset(before, { today: TODAY, now: 5000 });
  assert.deepStrictEqual(s.training, before.training);
  assert.deepStrictEqual(s.recipes, before.recipes);
  assert.deepStrictEqual(s.shopping_list, before.shopping_list);
  assert.deepStrictEqual(s.pantry, before.pantry);
  assert.deepStrictEqual(s.meal_plan, before.meal_plan);
  assert.deepStrictEqual(s.saved_meals, before.saved_meals);
  assert.deepStrictEqual(s.foods, before.foods);
  assert.deepStrictEqual(s.meal_templates, before.meal_templates);
  assert.deepStrictEqual(s.buddy, before.buddy);
  assert.deepStrictEqual(s.amber_ledger, before.amber_ledger);
  assert.deepStrictEqual(s.habitat, before.habitat);
  assert.deepStrictEqual(s.items, before.items);
  assert.deepStrictEqual(s.fight, before.fight);
  assert.deepStrictEqual(s.badges, before.badges);
  assert.deepStrictEqual(s.records, before.records);
  assert.deepStrictEqual(s.menstrual, before.menstrual);
  assert.deepStrictEqual(s.steps, before.steps);
  // Learned physiology is not history: a goal change already builds on it, and so does a restart.
  assert.deepStrictEqual(s.expenditure, before.expenditure);
  // The profile and its settings survive, so the app does not bounce the user back to the wizard.
  assert.strictEqual(s.profile.goalType, 'cut');
  assert.strictEqual(s.profile.weight_unit, 'kg');
});

// The fixture's run, worked out the long way so the numbers below are not magic: five logged days
// (today back to -4), then a gap at -5 that the monthly freeze forgives because -6 carries a training
// session. Five logged + one forgiven + one trained = 7, and a soft reset must not cost any of them.
const FIXTURE_STREAK = 7;

test('softReset keeps the streak the user earned', () => {
  const before = livedIn();
  assert.strictEqual(streakOf(before, TODAY), FIXTURE_STREAK);
  const s = Store.softReset(before, { today: TODAY, now: 5000 });
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
  // And the run keeps growing from there: log tomorrow and it is eight, not one.
  const tomorrow = shiftISO(TODAY, 1);
  s.log_entries.push({ id: 'new', date: tomorrow, meal_id: 'm_1', computed_macros: { kcal: 300 } });
  assert.strictEqual(streakOf(s, tomorrow), FIXTURE_STREAK + 1);
});

test('softReset banks only the recent past, so the credit list cannot grow without bound', () => {
  const before = livedIn();
  before.log_entries.push({ id: 'ancient', date: shiftISO(TODAY, -900), meal_id: 'm_1', computed_macros: { kcal: 100 } });
  const s = Store.softReset(before, { today: TODAY, now: 5000 });
  assert.ok(!s.streak_credit.includes(shiftISO(TODAY, -900)));
  assert.ok(s.streak_credit.includes(shiftISO(TODAY, -4)));
});

test('softReset re-anchors the plan from the weight the scale last saw', () => {
  const before = livedIn();
  before.weight_entries.push({ id: 'w1', date: shiftISO(TODAY, -1), scale_weight: 81.6, trend_weight: 81.8 });
  const s = Store.softReset(before, {
    today: TODAY, now: 5000, weightKg: 81.6,
    target: { kcal: 2040, protein_g: 168, carbs_g: 190, fat_g: 58 },
  });
  assert.strictEqual(s.weight_entries.length, 1);
  assert.strictEqual(s.weight_entries[0].date, TODAY);
  assert.strictEqual(s.weight_entries[0].scale_weight, 81.6);
  assert.strictEqual(s.weight_entries[0].trend_weight, 81.6); // one reading is its own trend
  assert.strictEqual(s.profile.weightKg, 81.6);               // the plan and the profile agree
  assert.strictEqual(s.targets.length, 1);
  assert.strictEqual(s.targets[0].kcal, 2040);
  assert.strictEqual(s.targets[0].effective_date, TODAY);
  assert.strictEqual(s.targets[0].source, 'soft-reset');
  assert.ok(s.targets[0].id);
  // The seed weigh-in also makes today active, so the streak survives on its own terms.
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
});

test('a stale device cannot union the cleared log back in', () => {
  const stale = livedIn();                                    // _rev 1000, never saw the reset
  const fresh = Store.softReset(livedIn(), { today: TODAY, now: 5000, weightKg: 82, target: { kcal: 2040 } });
  [Store.mergeStates(fresh, stale), Store.mergeStates(stale, fresh)].forEach(m => {
    assert.deepStrictEqual(m.log_entries, [], 'food log stayed cleared');
    assert.deepStrictEqual(m.checkins, [], 'check-in ledger stayed cleared');
    assert.strictEqual(m.weight_entries.length, 1, 'only the seed weigh-in survives');
    assert.strictEqual(m.weight_entries[0].date, TODAY);
    assert.strictEqual(m.targets.length, 1, 'only the re-anchored target survives');
    assert.strictEqual(m.targets[0].kcal, 2040);
    assert.deepStrictEqual(m.day_overrides, {});
    assert.strictEqual(m._soft, 5000, 'the watermark carries forward to protect later merges');
    assert.strictEqual(streakOf(m, TODAY), FIXTURE_STREAK, 'and the merge did not cost the streak');
  });
});

test('a soft reset is not a wipe: work only the stale device has still merges in', () => {
  const stale = livedIn();
  // A session logged in the gym, offline, on the phone that has not seen the reset yet.
  stale.training.logs.push({ id: 'tl_offline', dateISO: shiftISO(TODAY, -1), blockId: 'b1', sets: [] });
  stale.recipes.push({ id: 'r_offline', title: 'Katsu curry', ingredients: [], steps: [] });
  stale.amber_ledger.push({ id: 'a_offline', date: shiftISO(TODAY, -1), delta: 15, reason: 'Daily hunt' });
  const fresh = Store.softReset(livedIn(), { today: TODAY, now: 5000, weightKg: 82, target: { kcal: 2040 } });
  const m = Store.mergeStates(fresh, stale);
  assert.ok(m.training.logs.some(l => l.id === 'tl_offline'), 'the gym session survived');
  assert.ok(m.recipes.some(r => r.id === 'r_offline'), 'the recipe survived');
  assert.ok(m.amber_ledger.some(e => e.id === 'a_offline'), 'the Amber survived');
  assert.deepStrictEqual(m.log_entries, [], 'and the food log is still cleared');
});

test('a device that HAS seen the reset keeps logging normally afterwards', () => {
  const fresh = Store.softReset(livedIn(), { today: TODAY, now: 5000, weightKg: 82, target: { kcal: 2040 } });
  const laptop = JSON.parse(JSON.stringify(fresh));
  laptop.log_entries.push({ id: 'post1', date: TODAY, meal_id: 'm_1', computed_macros: { kcal: 420 } });
  laptop._rev = 6000;
  const phone = JSON.parse(JSON.stringify(fresh));
  phone.log_entries.push({ id: 'post2', date: TODAY, meal_id: 'm_3', computed_macros: { kcal: 610 } });
  phone._rev = 5500;
  const m = Store.mergeStates(laptop, phone);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['post1', 'post2']);
});

test('a full wipe still beats a soft reset, whichever way round they merge', () => {
  const soft = Store.softReset(livedIn(), { today: TODAY, now: 5000, weightKg: 82, target: { kcal: 2040 } });
  const wiped = Store.defaultState(); wiped._wipe = 9000; wiped._rev = 9000;
  [Store.mergeStates(wiped, soft), Store.mergeStates(soft, wiped)].forEach(m => {
    assert.deepStrictEqual(m.recipes, []);
    assert.deepStrictEqual(m.training.logs, []);
    assert.deepStrictEqual(m.targets, []);
  });
});

test('migrate backfills streak_credit without disturbing a banked one', () => {
  assert.deepStrictEqual(Store.migrate({ profile: { goalType: 'cut' } }).streak_credit, []);
  const kept = Store.migrate({ streak_credit: ['2026-08-01', '2026-08-02'] });
  assert.deepStrictEqual(kept.streak_credit, ['2026-08-01', '2026-08-02']);
});

test('a second soft reset does not un-bank the first one', () => {
  const first = Store.softReset(livedIn(), { today: TODAY, now: 5000, weightKg: 82, target: { kcal: 2040 } });
  const later = shiftISO(TODAY, 1);
  first.log_entries.push({ id: 'n1', date: later, meal_id: 'm_1', computed_macros: { kcal: 300 } });
  const second = Store.softReset(first, { today: later, now: 6000, weightKg: 82, target: { kcal: 2040 } });
  assert.strictEqual(streakOf(second, later), FIXTURE_STREAK + 1);
});
