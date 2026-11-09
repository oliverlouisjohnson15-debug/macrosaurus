'use strict';
/* Phases: a goal weight by a date.
 *
 * The person names a weight and a date and the app does the rest. These pin the arithmetic that
 * decides whether that is allowed, what rate it runs at, and how the rate moves week to week. The
 * worked case throughout is a real one: a 32-year-old man trending 85.57 kg on Monday 9 November,
 * burning about 2,771 kcal a day, who wants 80.0 kg by Monday 21 December.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const MAN = { sex: 'male', age: 32, weightKg: 85.57, bodyFatPct: 22.1, goalType: 'cut' };
const BURN = 2771;

test('the rate a deadline needs is the distance over the weeks left', () => {
  assert.strictEqual(E.deadlineRate(85.57, 80, '2026-11-09', '2026-12-21'), 0.928);
  assert.strictEqual(E.deadlineRate(80, 83, '2026-01-01', '2026-03-26'), 0.25, 'a gain reads the same way');
  assert.strictEqual(E.deadlineRate(85, 80, '2026-11-09', '2026-11-09'), null, 'a deadline today has no rate');
  assert.strictEqual(E.deadlineRate(85, 80, '2026-11-09', '2026-11-01'), null, 'nor one in the past');
});

test('limits: 1% of bodyweight is fine, up to 1.25% needs a yes, past that is refused', () => {
  const l = E.phaseLimits(MAN);
  assert.strictEqual(l.okKg, 0.86);
  assert.strictEqual(l.hardKg, 1.07);
  const lean = E.phaseLimits(Object.assign({}, MAN, { bodyFatPct: 10 }));
  assert.ok(lean.okKg < l.okKg && lean.hardKg < l.hardKg, 'lean dieters get the slower limits');
  const gain = E.phaseLimits(Object.assign({}, MAN, { goalType: 'gain' }));
  assert.strictEqual(gain.hardPct, 0.0075);
});

test('80 kg by 21 December needs a yes, and says what it costs a day', () => {
  const f = E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 80, fromISO: '2026-11-09', endISO: '2026-12-21' });
  assert.strictEqual(f.status, 'confirm');
  assert.strictEqual(f.goalType, 'cut');
  assert.strictEqual(f.rate, 0.93);
  assert.ok(f.intakeKcal > 1700 && f.intakeKcal < 1800, 'about 1,750 a day: ' + f.intakeKcal);
  assert.strictEqual(f.weeks, 6);
});

test('a slower deadline is simply fine', () => {
  const f = E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 80, fromISO: '2026-11-09', endISO: '2027-01-18' });
  assert.strictEqual(f.status, 'ok');
});

test('too fast is refused, with the nearest weight and date that work', () => {
  const f = E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 80, fromISO: '2026-11-09', endISO: '2026-12-15' });
  assert.strictEqual(f.status, 'over');
  assert.ok(f.reachableKg > 80 && f.reachableKg < 85.57, 'a weight between here and the goal: ' + f.reachableKg);
  assert.ok(f.earliestISO > '2026-12-15', 'a later date: ' + f.earliestISO);
  // The earliest date really is reachable inside the hard limit.
  const again = E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 80, fromISO: '2026-11-09', endISO: f.earliestISO });
  assert.notStrictEqual(again.status, 'over');
});

test('a deadline that would need eating under the floor is refused even inside the limits', () => {
  const small = { sex: 'female', weightKg: 60, goalType: 'cut' };
  const f = E.phaseFeasibility({ profile: small, burnKcal: 1700, goalKg: 57, fromISO: '2026-11-09', endISO: '2026-12-21' });
  assert.strictEqual(f.status, 'floor');
  assert.ok(f.intakeKcal < 1200);
  assert.ok(f.earliestISO > '2026-12-21');
  const ok = E.phaseFeasibility({ profile: small, burnKcal: 1700, goalKg: 57, fromISO: '2026-11-09', endISO: f.earliestISO });
  assert.ok(ok.intakeKcal >= 1199, 'the earliest date keeps you at or above the floor: ' + ok.intakeKcal);
});

test('already there, or a goal above you, is read the right way', () => {
  assert.strictEqual(E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 85.57, fromISO: '2026-11-09', endISO: '2026-12-21' }).status, 'done');
  assert.strictEqual(E.phaseFeasibility({ profile: MAN, burnKcal: BURN, goalKg: 88, fromISO: '2026-11-09', endISO: '2027-05-01' }).goalType, 'gain');
});

test('checkpoints are a straight line from the start weight to the goal', () => {
  const ph = { start: '2026-11-09', end: '2026-12-21', startKg: 85.57, goalKg: 80 };
  assert.strictEqual(E.phaseTargetOn(ph, '2026-11-09'), 85.57);
  assert.strictEqual(E.phaseTargetOn(ph, '2026-12-21'), 80);
  assert.strictEqual(E.phaseTargetOn(ph, '2026-11-30'), 82.79);
  assert.strictEqual(E.phaseTargetOn(ph, '2027-01-10'), 80, 'clamped after the end');
});

test('the rate steps towards the deadline, never by more than 0.1 up', () => {
  const behind = E.phaseRateStep({ prevRate: 0.92, required: 1.2, capKg: 1.07 });
  assert.strictEqual(behind.rate, 1.02);
  assert.strictEqual(behind.why, 'behind');
  const capped = E.phaseRateStep({ prevRate: 1.02, required: 1.3, capKg: 1.07 });
  assert.strictEqual(capped.rate, 1.07);
  assert.strictEqual(capped.capped, true);
  const ahead = E.phaseRateStep({ prevRate: 0.92, required: 0.5, capKg: 1.07 });
  assert.strictEqual(ahead.rate, 0.72, 'down by at most 0.2');
  assert.strictEqual(ahead.why, 'ahead');
  assert.strictEqual(E.phaseRateStep({ prevRate: 0.92, required: 0.93, capKg: 1.07 }).why, 'steady');
  assert.strictEqual(E.phaseRateStep({ prevRate: 0.92, required: 0, capKg: 1.07 }).why, 'reached');
});

test('falling lifts bring the rate down, poor readiness stops it rising', () => {
  const brake = E.phaseRateStep({ prevRate: 0.92, required: 1.1, capKg: 1.07, brake: true });
  assert.strictEqual(brake.rate, 0.82);
  assert.strictEqual(brake.why, 'brake');
  const rec = E.phaseRateStep({ prevRate: 0.92, required: 1.1, capKg: 1.07, recover: true });
  assert.strictEqual(rec.rate, 0.92);
  assert.strictEqual(rec.why, 'recover');
  assert.ok(E.phaseRateStep({ prevRate: 0.15, required: 1, capKg: 1, brake: true }).rate >= 0.1, 'never below 0.1');
});

function session(date, lifts) {
  return { dateISO: date, sets: Object.keys(lifts).map((ex, i) => ({ id: date + i, exerciseId: ex, done: true, type: 'work', weightKg: lifts[ex][0], reps: lifts[ex][1] })) };
}

test('strength: two main lifts down more than 5% is a brake', () => {
  const today = '2026-11-27';
  const logs = [
    session('2026-11-02', { squat: [200, 8], press: [90, 6], row: [45, 8] }),
    session('2026-11-06', { squat: [200, 8], press: [90, 6], row: [45, 8] }),
    session('2026-11-16', { squat: [180, 6], press: [80, 5], row: [45, 8] }),
    session('2026-11-20', { squat: [180, 6], press: [80, 5], row: [46, 8] }),
  ];
  const t = E.strengthTrend(logs, today);
  assert.strictEqual(t.brake, true);
  assert.deepStrictEqual(t.drops.map(d => d.exerciseId).sort(), ['press', 'squat']);
});

test('strength: progress, a swapped exercise and unfinished sets are not a brake', () => {
  const today = '2026-11-27';
  const logs = [
    session('2026-11-02', { squat: [200, 8], press: [90, 6], curl: [30, 10] }),
    session('2026-11-16', { squat: [210, 8], press: [90, 7], hammer: [10, 10] }),
    { dateISO: '2026-11-20', sets: [{ exerciseId: 'press', done: false, type: 'work', weightKg: 5, reps: null }] },
  ];
  const t = E.strengthTrend(logs, today);
  assert.strictEqual(t.brake, false);
  assert.ok(!t.lifts.find(l => l.exerciseId === 'curl'), 'a lift dropped from the programme is not compared');
});

test('readiness: poor twice running means recover', () => {
  const poor = { hunger: 2, energy: 2, sleep: 4, gym: 3 };
  const fine = { hunger: 3, energy: 4, sleep: 4, gym: 4 };
  assert.strictEqual(E.readinessPoor(poor), true);
  assert.strictEqual(E.readinessPoor(fine), false);
  assert.strictEqual(E.readinessRecover([{ date: 'a', ready: poor }], poor), true);
  assert.strictEqual(E.readinessRecover([{ date: 'a', ready: fine }], poor), false);
  assert.strictEqual(E.readinessRecover([{ date: 'a' }], poor), false, 'no earlier rating, no streak');
});

test('the pace is judged as it is shown, so a hair over the limit never reads "0.83, faster than 0.83"', () => {
  const p = { sex: 'male', weightKg: 83.4, bodyFatPct: 22, goalType: 'cut' };
  const lim = E.phaseLimits(p);
  // A goal that needs exactly the limit once rounded to two decimals.
  const f = E.phaseFeasibility({ profile: p, burnKcal: 2700, goalKg: +(83.4 - lim.okKg * 6 - 0.004).toFixed(3), fromISO: '2026-11-09', endISO: '2026-12-21' });
  assert.strictEqual(f.rate, lim.okKg);
  assert.strictEqual(f.status, 'ok');
});
