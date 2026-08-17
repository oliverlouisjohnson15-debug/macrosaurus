'use strict';
// Fresh start: a reset the user configures. Every group they can keep or clear, the couplings they
// are not offered a choice about, and the merge that has to keep a cleared thing cleared when a
// device that never saw the reset syncs back in. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Store = require('../app/store.js');
const Game = require('../app/game.js');
const E = require('../app/engine.js');

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


// The default the screen offers: clear the tracking history, keep everything you built.
const DEFAULTS = { log: false, weight: false, checkins: false, streak: true, foods: true, recipes: true, training: true };
const KEEP_ALL = { log: true, weight: true, checkins: true, streak: true, foods: true, recipes: true, training: true };
const KEEP_NONE = {};
const TARGET = { kcal: 2040, protein_g: 168, carbs_g: 190, fat_g: 58 };
const run = (s, keep, extra) => Store.freshStart(s, Object.assign({ today: TODAY, now: 5000, keep, weightKg: 81.6, target: TARGET }, extra || {}));

// The fixture's run, worked out the long way so the numbers below are not magic: five logged days
// (today back to -4), then a gap at -5 that the monthly freeze forgives because -6 carries a training
// session. Five logged + one forgiven + one trained = 7.
const FIXTURE_STREAK = 7;

test('the fixture is what the tests below think it is', () => {
  assert.strictEqual(streakOf(livedIn(), TODAY), FIXTURE_STREAK);
});

/* ---- what always happens, whatever is kept ---- */

test('a fresh start always forgets the learned expenditure and restarts the cycle', () => {
  [DEFAULTS, KEEP_ALL, KEEP_NONE].forEach(keep => {
    const s = run(livedIn(), keep);
    assert.strictEqual(s.expenditure, null, 'learned TDEE forgotten');
    assert.strictEqual(s.pending_adjustment, null);
    assert.strictEqual(s.diet_break, null);
    assert.strictEqual(s.last_break_end, null);
    assert.strictEqual(s.diet_break_snooze, null);
    assert.strictEqual(s.paused, false);
    assert.strictEqual(s.last_checkin, TODAY);
    assert.strictEqual(s.fresh_start, TODAY);
    // The plan is re-anchored from today whatever else survives.
    assert.strictEqual(s.targets[s.targets.length - 1].kcal, 2040);
    assert.strictEqual(s.targets[s.targets.length - 1].effective_date, TODAY);
    assert.strictEqual(s.targets[s.targets.length - 1].source, 'fresh-start');
  });
});

test('a fresh start never touches the profile, the buddy or anything synced from Health', () => {
  const before = livedIn();
  const s = run(before, KEEP_NONE);
  assert.deepStrictEqual(s.buddy, before.buddy);
  assert.deepStrictEqual(s.amber_ledger, before.amber_ledger);
  assert.deepStrictEqual(s.habitat, before.habitat);
  assert.deepStrictEqual(s.items, before.items);
  assert.deepStrictEqual(s.fight, before.fight);
  assert.deepStrictEqual(s.steps, before.steps);
  assert.deepStrictEqual(s.menstrual, before.menstrual);
  assert.strictEqual(s.profile.goalType, 'cut');
  assert.strictEqual(s.profile.weight_unit, 'kg');
});

/* ---- each group keeps or clears on its own ---- */

test('keeping nothing clears every group', () => {
  const s = run(livedIn(), KEEP_NONE);
  assert.deepStrictEqual(s.log_entries, []);
  assert.deepStrictEqual(s.day_meals, {});
  assert.deepStrictEqual(s.day_overrides, {});
  assert.deepStrictEqual(s.checkins, []);
  assert.deepStrictEqual(s.streak_credit, []);
  assert.deepStrictEqual(s.records, { longestStreak: 0 });
  assert.deepStrictEqual(s.foods, []);
  assert.deepStrictEqual(s.saved_meals, []);
  assert.deepStrictEqual(s.recipes, []);
  assert.deepStrictEqual(s.shopping_list, []);
  assert.deepStrictEqual(s.pantry, []);
  assert.deepStrictEqual(s.meal_plan, []);
  assert.deepStrictEqual(s.training.blocks, []);
  assert.deepStrictEqual(s.training.logs, []);
  assert.strictEqual(s.targets.length, 1);          // only the fresh anchor
  assert.strictEqual(streakOf(s, TODAY), 1);        // just the seed weigh-in
});

test('keeping everything clears nothing but the plan it re-anchors', () => {
  const before = livedIn();
  const s = run(before, KEEP_ALL);
  assert.strictEqual(s.log_entries.length, before.log_entries.length);
  assert.deepStrictEqual(s.day_meals, before.day_meals);
  assert.deepStrictEqual(s.day_overrides, before.day_overrides);
  assert.deepStrictEqual(s.checkins, before.checkins);
  assert.deepStrictEqual(s.foods, before.foods);
  assert.deepStrictEqual(s.recipes, before.recipes);
  assert.deepStrictEqual(s.training, before.training);
  assert.deepStrictEqual(s.records, before.records);
  // Weigh-ins kept means no invented seed reading: the history is left exactly as it was.
  assert.deepStrictEqual(s.weight_entries, before.weight_entries);
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
});

test('the food log can be kept while the weigh-ins start again', () => {
  const before = livedIn();
  const s = run(before, Object.assign({}, DEFAULTS, { log: true }));
  assert.strictEqual(s.log_entries.length, before.log_entries.length, 'the diary survived');
  assert.deepStrictEqual(s.day_overrides, before.day_overrides, 'and its per-day balance with it');
  assert.strictEqual(s.weight_entries.length, 1, 'the scale started again');
  assert.strictEqual(s.weight_entries[0].date, TODAY);
  assert.deepStrictEqual(s.checkins, []);
});

test('the weigh-ins can be kept while the food log starts again', () => {
  const before = livedIn();
  const s = run(before, Object.assign({}, DEFAULTS, { weight: true }));
  assert.deepStrictEqual(s.log_entries, []);
  assert.deepStrictEqual(s.weight_entries, before.weight_entries, 'untouched, and no seed invented');
  assert.strictEqual(s.profile.weightKg, before.profile.weightKg, 'nor the profile weight rewritten');
});

/* ---- the coupling the user is NOT offered a choice about ---- */

test('a kept food log keeps the target history that scores it', () => {
  const before = livedIn();
  const oldTarget = before.targets[0];
  const s = run(before, Object.assign({}, DEFAULTS, { log: true }));
  assert.strictEqual(s.targets.length, 2, 'the old target and the new anchor');
  assert.strictEqual(s.targets[0].id, oldTarget.id);
  // The point of keeping it: a day already eaten still resolves to the bar it was actually set.
  const past = shiftISO(TODAY, -3);
  assert.strictEqual(E.targetOn(s.targets, past).kcal, oldTarget.kcal);
  assert.strictEqual(E.targetOn(s.targets, TODAY).kcal, 2040);
});

test('a kept check-in history keeps the targets its entries refer to', () => {
  const s = run(livedIn(), Object.assign({}, DEFAULTS, { checkins: true }));
  assert.strictEqual(s.targets.length, 2);
});

test('with both gone the target history goes too', () => {
  const s = run(livedIn(), DEFAULTS);
  assert.strictEqual(s.targets.length, 1);
  assert.strictEqual(s.targets[0].kcal, 2040);
});

test('a kept target history cannot smuggle the old learned TDEE into the new plan', () => {
  // learnedTdee (app.jsx) scans kept targets for a recent adaptive estimate. fresh_start is what
  // stops it reading one from before the reset, which would undo the whole point.
  const before = livedIn();
  before.targets.push({ id: 't1', effective_date: shiftISO(TODAY, -3), source: 'adaptive', estimatedTDEE: 2680, kcal: 2100 });
  const s = run(before, Object.assign({}, DEFAULTS, { log: true }));
  const stillThere = s.targets.filter(t => (t.source || '').indexOf('adaptive') === 0);
  assert.strictEqual(stillThere.length, 1, 'the adaptive target is kept for the days it scored');
  assert.ok(stillThere[0].effective_date < s.fresh_start, 'but it predates the fresh start, so learnedTdee skips it');
});

/* ---- the streak ---- */

test('a kept streak survives the entries that proved it being cleared', () => {
  const s = run(livedIn(), DEFAULTS);
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
  const tomorrow = shiftISO(TODAY, 1);
  s.log_entries.push({ id: 'new', date: tomorrow, meal_id: 'm_1', computed_macros: { kcal: 300 } });
  assert.strictEqual(streakOf(s, tomorrow), FIXTURE_STREAK + 1, 'and keeps growing from where it was');
});

test('a kept streak banks the training days too when the sessions are being cleared', () => {
  const s = run(livedIn(), Object.assign({}, DEFAULTS, { training: false }));
  assert.deepStrictEqual(s.training.logs, []);
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK, 'the trained day was banked before its log went');
});

test('a kept streak banks nothing for a group that is itself kept', () => {
  // Nothing to bank when the log stays: its own dates still prove the run, live.
  const s = run(livedIn(), Object.assign({}, DEFAULTS, { log: true, weight: true, training: true }));
  assert.deepStrictEqual(s.streak_credit, []);
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
});

test('clearing the streak clears the credit, the records and the freezes', () => {
  const before = livedIn();
  before.freezes = { frozen: [shiftISO(TODAY, -5)] };
  before.streak_credit = ['2026-01-01'];
  const s = run(before, Object.assign({}, DEFAULTS, { streak: false }));
  assert.deepStrictEqual(s.streak_credit, []);
  assert.deepStrictEqual(s.freezes, { frozen: [] });
  assert.deepStrictEqual(s.records, { longestStreak: 0 });
});

test('clearing the streak while keeping the log leaves the days to rebuild from', () => {
  // Nothing is banked, and nothing needs to be: the kept diary still carries its own dates, so the
  // run stands on the days themselves rather than on credit written down for it.
  const s = run(livedIn(), Object.assign({}, DEFAULTS, { log: true, streak: false }));
  assert.deepStrictEqual(s.streak_credit, []);
  assert.strictEqual(s.log_entries.length, 5);
  assert.strictEqual(streakOf(s, TODAY), FIXTURE_STREAK);
});

test('banked credit is bounded, so it cannot grow without end', () => {
  const before = livedIn();
  before.log_entries.push({ id: 'ancient', date: shiftISO(TODAY, -900), meal_id: 'm_1', computed_macros: { kcal: 100 } });
  const s = run(before, DEFAULTS);
  assert.ok(!s.streak_credit.includes(shiftISO(TODAY, -900)));
  assert.ok(s.streak_credit.includes(shiftISO(TODAY, -4)));
});

/* ---- the merge, which has to keep a cleared thing cleared ---- */

test('a stale device cannot union back whatever this reset cleared', () => {
  const stale = livedIn();                                  // _rev 1000, never saw the reset
  const fresh = run(livedIn(), DEFAULTS);
  [Store.mergeStates(fresh, stale), Store.mergeStates(stale, fresh)].forEach(m => {
    assert.deepStrictEqual(m.log_entries, []);
    assert.deepStrictEqual(m.checkins, []);
    assert.strictEqual(m.expenditure, null, 'the learned TDEE stayed forgotten');
    assert.strictEqual(m.weight_entries.length, 1);
    assert.strictEqual(m.targets.length, 1);
    assert.strictEqual(m.fresh_start, TODAY, 'the date carries forward to keep gating learnedTdee');
    assert.strictEqual(streakOf(m, TODAY), FIXTURE_STREAK);
  });
});

test('the merge only clears what THIS reset chose to clear', () => {
  const stale = livedIn();
  const fresh = run(livedIn(), Object.assign({}, DEFAULTS, { log: true }));
  const m = Store.mergeStates(fresh, stale);
  assert.strictEqual(m.log_entries.length, 5, 'a kept log is not stripped out of the stale copy');
  assert.deepStrictEqual(m.checkins, [], 'a cleared one still is');
  assert.deepStrictEqual(m.recipes, stale.recipes);
});

test('a fresh start is not a wipe: work only the stale device has still merges in', () => {
  const stale = livedIn();
  // A session logged in the gym, offline, on the phone that has not seen the reset yet.
  stale.training.logs.push({ id: 'tl_offline', dateISO: shiftISO(TODAY, -1), blockId: 'b1', sets: [] });
  stale.recipes.push({ id: 'r_offline', title: 'Katsu curry', ingredients: [], steps: [] });
  stale.amber_ledger.push({ id: 'a_offline', date: shiftISO(TODAY, -1), delta: 15, reason: 'Daily hunt' });
  const m = Store.mergeStates(run(livedIn(), DEFAULTS), stale);
  assert.ok(m.training.logs.some(l => l.id === 'tl_offline'), 'the gym session survived');
  assert.ok(m.recipes.some(r => r.id === 'r_offline'), 'the recipe survived');
  assert.ok(m.amber_ledger.some(e => e.id === 'a_offline'), 'the Amber survived');
  assert.deepStrictEqual(m.log_entries, [], 'and the food log is still cleared');
});

test('two devices that HAVE seen the reset keep logging normally afterwards', () => {
  const fresh = run(livedIn(), DEFAULTS);
  const laptop = JSON.parse(JSON.stringify(fresh));
  laptop.log_entries.push({ id: 'post1', date: TODAY, meal_id: 'm_1', computed_macros: { kcal: 420 } });
  laptop._rev = 6000;
  const phone = JSON.parse(JSON.stringify(fresh));
  phone.log_entries.push({ id: 'post2', date: TODAY, meal_id: 'm_3', computed_macros: { kcal: 610 } });
  phone._rev = 5500;
  assert.deepStrictEqual(Store.mergeStates(laptop, phone).log_entries.map(e => e.id).sort(), ['post1', 'post2']);
});

test('the merge tolerates the bare-timestamp watermark the first version wrote', () => {
  const legacy = run(livedIn(), DEFAULTS);
  legacy._soft = 5000; // the old shape: a timestamp, meaning the original fixed set
  const m = Store.mergeStates(legacy, livedIn());
  assert.deepStrictEqual(m.log_entries, []);
  assert.deepStrictEqual(m.checkins, []);
});

test('a full wipe still beats a fresh start, whichever way round they merge', () => {
  const fresh = run(livedIn(), KEEP_ALL);
  const wiped = Store.defaultState(); wiped._wipe = 9000; wiped._rev = 9000;
  [Store.mergeStates(wiped, fresh), Store.mergeStates(fresh, wiped)].forEach(m => {
    assert.deepStrictEqual(m.recipes, []);
    assert.deepStrictEqual(m.training.logs, []);
    assert.deepStrictEqual(m.log_entries, []);
  });
});

test('migrate backfills the new fields without disturbing existing ones', () => {
  const bare = Store.migrate({ profile: { goalType: 'cut' } });
  assert.deepStrictEqual(bare.streak_credit, []);
  assert.strictEqual(bare.fresh_start, null);
  const kept = Store.migrate({ streak_credit: ['2026-08-01'], fresh_start: '2026-08-02' });
  assert.deepStrictEqual(kept.streak_credit, ['2026-08-01']);
  assert.strictEqual(kept.fresh_start, '2026-08-02');
});

test('a second fresh start does not un-bank the first', () => {
  const first = run(livedIn(), DEFAULTS);
  const later = shiftISO(TODAY, 1);
  first.log_entries.push({ id: 'n1', date: later, meal_id: 'm_1', computed_macros: { kcal: 300 } });
  const second = Store.freshStart(first, { today: later, now: 6000, keep: DEFAULTS, weightKg: 82, target: TARGET });
  assert.strictEqual(streakOf(second, later), FIXTURE_STREAK + 1);
});
