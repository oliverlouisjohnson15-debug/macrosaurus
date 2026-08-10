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

// ---- trainingAsk: whether the buddy is entitled to say anything about lifting ----
// The bar is high on purpose. A companion that comments on training every single day is the
// streak-anxiety failure mode, so most days this returns null and the food lines keep the slot.

const trainedBlock = (over) => Object.assign({
  name: 'Summer growth', week: 2, weeks: 4, finished: false,
  sessionsThisWeek: 4, doneThisWeek: 1, nextSession: 'Upper B', deloadWeek: false,
}, over || {});
const trained = (over) => Object.assign({
  everTrained: true, sessions: 12, trainedToday: false, lastSessionISO: '2026-08-07',
  lastSessionName: 'Upper A', daysSinceSession: 2, sessionsLast7: 2, sessionsLast28: 8,
  tonnageLast7Kg: 9000, block: trainedBlock(), stalledLifts: [],
}, over || {});

test('trainingAsk says nothing to somebody who has never trained', () => {
  assert.strictEqual(Game.trainingAsk({ everTrained: false }, 18), null);
  assert.strictEqual(Game.trainingAsk(null, 18), null);
});

test('trainingAsk leads with today\'s session, whatever else is true', () => {
  const a = Game.trainingAsk(trained({ trainedToday: true, daysSinceSession: 0, stalledLifts: ['Barbell bench press'] }), 19);
  assert.equal(a.kind, 'trained_today');
  assert.equal(a.week, 2);
});

test('trainingAsk marks the week closed when today finished it', () => {
  const a = Game.trainingAsk(trained({ trainedToday: true, block: trainedBlock({ doneThisWeek: 4 }) }), 19);
  assert.equal(a.kind, 'week_done');
});

test('trainingAsk offers the finished block before it nudges anything', () => {
  const a = Game.trainingAsk(trained({ daysSinceSession: 12, block: trainedBlock({ finished: true }) }), 19);
  assert.equal(a.kind, 'block_finished');
  assert.equal(a.name, 'Summer growth');
});

test('trainingAsk only calls it a lapse after ten days', () => {
  assert.equal(Game.trainingAsk(trained({ daysSinceSession: 9, block: null }), 12), null);
  assert.equal(Game.trainingAsk(trained({ daysSinceSession: 10, block: null }), 12).kind, 'lapsed');
});

test('trainingAsk holds the session nudge until the evening', () => {
  assert.equal(Game.trainingAsk(trained(), 9), null, 'at 9am the day has not happened yet');
  const a = Game.trainingAsk(trained(), 17);
  assert.equal(a.kind, 'session_due');
  assert.equal(a.session, 'Upper B');
});

test('trainingAsk does not nudge a session after a single rest day', () => {
  assert.equal(Game.trainingAsk(trained({ daysSinceSession: 1 }), 19), null);
});

test('trainingAsk leaves a deload week alone', () => {
  // Backing off is the point of the week. Chasing sessions through it teaches the wrong lesson.
  assert.equal(Game.trainingAsk(trained({ block: trainedBlock({ deloadWeek: true }) }), 19), null);
});

test('trainingAsk mentions a stall only when nothing more pressing is due', () => {
  const s = trained({ daysSinceSession: 1, stalledLifts: ['Barbell bench press', 'Barbell row'] });
  const a = Game.trainingAsk(s, 19);
  assert.equal(a.kind, 'stalled');
  assert.equal(a.lift, 'Barbell bench press', 'the worst one, not a list');
});

// ---- sessionPraise: what the buddy leads with when a session is signed off ----
// Ordered by RARITY, not by how good the line sounds. A finished block lands every five weeks, an
// ordinary Tuesday lands every Tuesday, and treating them the same teaches people to ignore both.

const sess = (over) => Object.assign({
  sets: 14, prs: 0, first: false, minutes: 58, tonnageKg: 9000, avgTonnageKg: 9000,
  weekDone: 2, weekOf: 4, blockFinished: false, sessionsLast7: 2,
}, over || {});

test('sessionPraise says nothing about a session with nothing ticked', () => {
  assert.strictEqual(Game.sessionPraise(sess({ sets: 0, prs: 2, first: true })), null);
  assert.strictEqual(Game.sessionPraise(null), null);
});

test('sessionPraise leads with the first session ever, over everything else', () => {
  assert.equal(Game.sessionPraise(sess({ first: true, prs: 3, blockFinished: true })).kind, 'first');
});

test('sessionPraise puts a finished block above a record', () => {
  // A record already had its own moment mid-session (PRFlash). A block lands every five weeks.
  assert.equal(Game.sessionPraise(sess({ blockFinished: true, prs: 2 })).kind, 'block_done');
});

test('sessionPraise reports records over a closed week', () => {
  const p = Game.sessionPraise(sess({ prs: 2, weekDone: 4 }));
  assert.equal(p.kind, 'pr');
  assert.equal(p.prs, 2);
});

test('sessionPraise only closes the week on the session that closed it', () => {
  assert.equal(Game.sessionPraise(sess({ weekDone: 3, weekOf: 4 })).kind, 'solid');
  assert.equal(Game.sessionPraise(sess({ weekDone: 4, weekOf: 4 })).kind, 'week_done');
});

test('sessionPraise calls a session heavy only well above the recent average', () => {
  assert.equal(Game.sessionPraise(sess({ tonnageKg: 10000, avgTonnageKg: 9000 })).kind, 'solid', '11% is noise');
  const p = Game.sessionPraise(sess({ tonnageKg: 11000, avgTonnageKg: 9000 }));
  assert.equal(p.kind, 'big');
  assert.equal(p.pct, 22);
});

test('sessionPraise will not call a short session heavy on tonnage alone', () => {
  // Three sets of very heavy deadlifts can out-tonnage a full session. That is not a big day.
  assert.equal(Game.sessionPraise(sess({ sets: 4, tonnageKg: 20000, avgTonnageKg: 9000 })).kind, 'short');
});

test('sessionPraise has no average to compare against early on', () => {
  assert.equal(Game.sessionPraise(sess({ avgTonnageKg: 0, tonnageKg: 40000 })).kind, 'solid');
});

test('sessionPraise gives a short session its own warm line', () => {
  const p = Game.sessionPraise(sess({ sets: 3 }));
  assert.equal(p.kind, 'short');
  assert.equal(p.sets, 3);
});

// ---- idleLine: the buddy is never speechless ----
// buddyMessage is entitled to return nothing on a settled day. When it does, the world card used to
// render with no dialogue box at all - a sprite on a bare floor band, which read as broken. These
// cover the fallback that guarantees a line, and the properties the caller relies on.

test('idleLine always returns a usable line, whatever the seed', () => {
  const seeds = ['', 'abc', 'zzz', 'salt-1', '9f2b', 'Chompers'];
  const dates = ['2026-08-10', '2026-01-01', '2026-12-31', ''];
  for (const s of seeds) {
    for (const d of dates) {
      const line = Game.idleLine(s, d);
      assert.equal(typeof line, 'string', `seed ${s} / ${d}`);
      assert.ok(line.length > 0, `seed ${s} / ${d} produced an empty line`);
      assert.ok(Game.IDLE_LINES.includes(line), 'line came from the pool');
    }
  }
});

test('idleLine is stable for the same user and day', () => {
  assert.equal(Game.idleLine('salt', '2026-08-10'), Game.idleLine('salt', '2026-08-10'));
});

test('idleLine varies across days, so the empty state does not read as frozen', () => {
  const week = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']
    .map(d => Game.idleLine('salt', d));
  assert.ok(new Set(week).size > 1, 'a whole week produced one identical line');
});

test('idleLine copy stays short enough for the dialogue box', () => {
  for (const line of Game.IDLE_LINES) assert.ok(line.length <= 72, `too long for two lines at 390px: ${line}`);
});
