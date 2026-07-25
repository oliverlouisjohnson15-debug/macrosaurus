'use strict';
// Tests for the buddy's proactive decision helpers in app/game.js: streak-save, weekly recap
// aggregation, and goal-milestone detection. These are the pure maths behind the buddy's lines;
// the wording and unit formatting live in app.jsx. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Game = require('../app/game.js');

// ---- streakAtRisk: protect a running streak late in the day when today is still empty ----

test('streakAtRisk: true in the evening with a streak and no activity today', () => {
  assert.strictEqual(Game.streakAtRisk(5, false, 20), true);
});

test('streakAtRisk: false once today already counts (logged or weighed)', () => {
  assert.strictEqual(Game.streakAtRisk(5, true, 20), false);
});

test('streakAtRisk: false earlier in the day (still time)', () => {
  assert.strictEqual(Game.streakAtRisk(5, false, 11), false);
});

test('streakAtRisk: false without a streak worth saving', () => {
  assert.strictEqual(Game.streakAtRisk(1, false, 22), false);
  assert.strictEqual(Game.streakAtRisk(0, false, 22), false);
});

test('streakAtRisk: custom evening threshold is honoured', () => {
  assert.strictEqual(Game.streakAtRisk(3, false, 17, 16), true);
  assert.strictEqual(Game.streakAtRisk(3, false, 15, 16), false);
});

// ---- weeklyRecap: aggregate a 7-day window into plain numbers ----

test('weeklyRecap: averages kcal over logged days only', () => {
  const days = [
    { logged: true, kcal: 2000, protein: 150, proteinTarget: 150 },
    { logged: true, kcal: 2200, protein: 120, proteinTarget: 150 },
    { logged: false, kcal: 0, protein: 0, proteinTarget: 150 },
  ];
  const r = Game.weeklyRecap(days, null);
  assert.strictEqual(r.daysLogged, 2);
  assert.strictEqual(r.avgKcal, 2100); // (2000+2200)/2, ignoring the empty day
});

test('weeklyRecap: protein counts as hit within 10% of target', () => {
  const days = [
    { logged: true, kcal: 2000, protein: 150, proteinTarget: 150 }, // exact - hit
    { logged: true, kcal: 2000, protein: 136, proteinTarget: 150 }, // 90.7% - hit
    { logged: true, kcal: 2000, protein: 130, proteinTarget: 150 }, // 86.7% - miss
    { logged: false, kcal: 0, protein: 0, proteinTarget: 150 },     // not logged - ignored
  ];
  const r = Game.weeklyRecap(days, null);
  assert.strictEqual(r.proteinDaysHit, 2);
  assert.strictEqual(r.proteinTarget, 150);
});

test('weeklyRecap: trend delta from the week\'s weights, rounded to 0.1kg', () => {
  const r = Game.weeklyRecap([{ logged: true, kcal: 2000, protein: 150, proteinTarget: 150 }], { startKg: 82.0, endKg: 81.36 });
  assert.strictEqual(r.trendDeltaKg, -0.6);
});

test('weeklyRecap: no weight window yields a null trend delta', () => {
  const r = Game.weeklyRecap([{ logged: true, kcal: 2000, protein: 150, proteinTarget: 150 }], null);
  assert.strictEqual(r.trendDeltaKg, null);
});

test('weeklyRecap: an empty week reports zeroes, not NaN', () => {
  const r = Game.weeklyRecap([], null);
  assert.strictEqual(r.daysLogged, 0);
  assert.strictEqual(r.avgKcal, 0);
  assert.strictEqual(r.proteinDaysHit, 0);
});

// ---- goalMilestone: fire each whole-kg step of net progress once, plus a one-off "reached" ----

test('goalMilestone: cut fires the current whole-kg milestone', () => {
  const m = Game.goalMilestone({ goalType: 'cut', startKg: 90, currentKg: 87.4, goalKg: 80, celebrated: [] });
  assert.strictEqual(m.kind, 'progress');
  assert.strictEqual(m.kg, 2);
  assert.deepStrictEqual(m.coveredKeys, ['m1', 'm2']); // a 2kg jump covers m1 and m2 in one pop
});

test('goalMilestone: nothing new once that milestone is celebrated', () => {
  const m = Game.goalMilestone({ goalType: 'cut', startKg: 90, currentKg: 87.4, goalKg: 80, celebrated: ['m1', 'm2'] });
  assert.strictEqual(m, null);
});

test('goalMilestone: gain measures the other direction', () => {
  const m = Game.goalMilestone({ goalType: 'gain', startKg: 70, currentKg: 71.2, goalKg: 75, celebrated: [] });
  assert.strictEqual(m.kind, 'progress');
  assert.strictEqual(m.kg, 1);
});

test('goalMilestone: reaching the goal fires once, sweeping up interim milestones', () => {
  const m = Game.goalMilestone({ goalType: 'cut', startKg: 82, currentKg: 79.9, goalKg: 80, celebrated: ['m1'] });
  assert.strictEqual(m.kind, 'reached');
  // 2kg of progress means m1 + m2 are swept up alongside 'goal', so nothing pops afterwards.
  assert.deepStrictEqual(m.coveredKeys, ['goal', 'm1', 'm2']);
  // ...and not again once the whole set is marked
  assert.strictEqual(Game.goalMilestone({ goalType: 'cut', startKg: 82, currentKg: 79.9, goalKg: 80, celebrated: m.coveredKeys }), null);
});

test('goalMilestone: no progress yet, and maintain never fires', () => {
  assert.strictEqual(Game.goalMilestone({ goalType: 'cut', startKg: 90, currentKg: 89.7, goalKg: 80, celebrated: [] }), null);
  assert.strictEqual(Game.goalMilestone({ goalType: 'maintain', startKg: 80, currentKg: 78, goalKg: 80, celebrated: [] }), null);
});

test('goalMilestone: missing weights are handled gracefully', () => {
  assert.strictEqual(Game.goalMilestone({ goalType: 'cut', startKg: null, currentKg: 80, goalKg: 75, celebrated: [] }), null);
});

// ---- trendRatePerWeek: kg/week from a smoothed trend series ----

test('trendRatePerWeek: losing 0.5kg/week over two weeks', () => {
  const pts = [{ date: '2026-07-01', kg: 82 }, { date: '2026-07-08', kg: 81.5 }, { date: '2026-07-15', kg: 81 }];
  assert.strictEqual(Game.trendRatePerWeek(pts), -0.5);
});

test('trendRatePerWeek: null when the span is under a week', () => {
  assert.strictEqual(Game.trendRatePerWeek([{ date: '2026-07-10', kg: 82 }, { date: '2026-07-13', kg: 81.8 }]), null);
});

test('trendRatePerWeek: null with fewer than two points', () => {
  assert.strictEqual(Game.trendRatePerWeek([{ date: '2026-07-10', kg: 82 }]), null);
  assert.strictEqual(Game.trendRatePerWeek([]), null);
});

// ---- goalETA: honest weeks-to-goal at the current pace ----

test('goalETA: projects weeks for a cut losing weight', () => {
  const e = Game.goalETA({ goalType: 'cut', currentKg: 84, goalKg: 80, ratePerWeek: -0.5 });
  assert.strictEqual(e.weeks, 8); // 4kg to go at 0.5kg/week
  assert.strictEqual(e.remainingKg, 4);
});

test('goalETA: projects weeks for a gain', () => {
  const e = Game.goalETA({ goalType: 'gain', currentKg: 72, goalKg: 75, ratePerWeek: 0.25 });
  assert.strictEqual(e.weeks, 12);
});

test('goalETA: null when the rate points the wrong way', () => {
  assert.strictEqual(Game.goalETA({ goalType: 'cut', currentKg: 84, goalKg: 80, ratePerWeek: 0.3 }), null);
});

test('goalETA: null when the rate is essentially flat', () => {
  assert.strictEqual(Game.goalETA({ goalType: 'cut', currentKg: 84, goalKg: 80, ratePerWeek: -0.02 }), null);
});

test('goalETA: null when already at goal, at a crawl beyond 2 years, or missing inputs', () => {
  assert.strictEqual(Game.goalETA({ goalType: 'cut', currentKg: 80, goalKg: 80, ratePerWeek: -0.5 }), null);
  assert.strictEqual(Game.goalETA({ goalType: 'cut', currentKg: 90, goalKg: 80, ratePerWeek: -0.05 }), null); // 10kg/0.05 = 200wk
  assert.strictEqual(Game.goalETA({ goalType: 'maintain', currentKg: 84, goalKg: 80, ratePerWeek: -0.5 }), null);
  assert.strictEqual(Game.goalETA({ goalType: 'cut', currentKg: 84, goalKg: null, ratePerWeek: -0.5 }), null);
});

// ---- buddyMood: the buddy's face reflects HOW you ate, not just whether you logged ----

test('buddyMood: over calories reads as stuffed (full and lazy)', () => {
  assert.strictEqual(Game.buddyMood(false, true, { kcalOver: true, proteinHit: true, kcalIn: false, perfect: false }), 'stuffed');
});

test('buddyMood: a perfect / on-target day still wins over stuffed', () => {
  assert.strictEqual(Game.buddyMood(false, true, { perfect: true, kcalOver: false }), 'thriving');
  assert.strictEqual(Game.buddyMood(false, true, { proteinHit: true, kcalIn: true, kcalOver: false }), 'content');
});

test('buddyMood: under / just-started stays peckish, and asleep + no-log take priority', () => {
  assert.strictEqual(Game.buddyMood(false, true, { proteinHit: false, kcalIn: false, kcalOver: false }), 'peckish');
  assert.strictEqual(Game.buddyMood(false, false, { kcalOver: true }), 'sluggish'); // nothing logged wins
  assert.strictEqual(Game.buddyMood(true, true, { kcalOver: true }), 'asleep');     // napping wins
});
