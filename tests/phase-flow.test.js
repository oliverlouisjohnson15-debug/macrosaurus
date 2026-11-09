'use strict';
/* Phases, walked through the real screens.
 *
 * phases.test.js pins the arithmetic. This is the rest of it: starting a phase from the goal screen,
 * the Friday check-in steering the pace towards the deadline (and asking how you are holding up),
 * and the end of the phase handing over to maintenance and then a review. Every flow mounts the
 * real components and clicks real buttons.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, render } = require('./helpers/app.js');

const A = app();
const TODAY = '2026-10-09';          // a Friday, the check-in day
const FRIDAY = 5;
const BURN = 2771;
const TARGET = { kcal: 2095, protein_g: 175, carbs_g: 184, fat_g: 70 };
const realToday = A.Store.todayISO;
const at = (iso, fn) => { A.Store.todayISO = () => iso; try { return fn(); } finally { A.Store.todayISO = realToday; } };
const shift = (iso, n) => A.shiftISO(iso, n);

// Four weeks of a man losing `rate` kg a week down to 85.5 kg yesterday, logging every day, last check-in a week ago.
function account({ rate = -0.6, today = TODAY } = {}) {
  const db = A.Store.defaultState();
  db.profile = {
    sex: 'male', age: 32, heightCm: 175, weightKg: 85.6, bodyFatPct: 22, weight_unit: 'kg',
    activityLevel: 'very', goalType: 'cut', rateKgPerWeek: 0.6, dietStyle: 'balanced', goalWeightKg: 80,
    proteinManualG: 175, checkinDay: FRIDAY,
    carryover: { enabled: false, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: false, highDays: [], deltaPct: 0.15 },
  };
  db.buddy = { name: 'Rex' };
  db.targets = [Object.assign({ id: 't1', effective_date: shift(today, -40), source: 'adaptive', estimatedTDEE: BURN }, TARGET)];
  db.expenditure = { kcal: BURN, n: 4, updated: shift(today, -7) };
  db.last_checkin = shift(today, -7);
  db.checkins = [21, 14, 7].map(n => ({ date: shift(today, -n), weightKg: 86, onTrack: true, adhered: true, days: 7, weeklyChangeKg: rate, deltaKcal: 0, tdee: BURN, underReport: false }));
  for (let i = 27; i >= 1; i--) {
    const date = shift(today, -i);
    db.weight_entries.push({ id: 'w' + i, date, scale_weight: +(85.5 - (rate / 7) * 27 + (rate / 7) * (28 - i)).toFixed(2) });
    db.log_entries.push({ id: 'l' + i, date, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: TARGET.kcal, protein: 175, carbs: 184, fat: 70 } });
  }
  db.log_entries.push({ id: 'l0', date: today, meal_id: 'm_3', name: 'Day', computed_macros: { kcal: TARGET.kcal, protein: 175, carbs: 184, fat: 70 } });
  A.recomputeTrend(db);
  return db;
}
// Started a phase a week ago, with the goal and end given.
function inPhase(db, { goalKg = 80, weeks = 6, startedDaysAgo = 7, confirmed = true } = {}) {
  at(shift(TODAY, -startedDaysAgo), () => {
    const ok = A.startPhase(db, { goalKg, endISO: shift(TODAY, weeks * 7 - startedDaysAgo), maintainDays: 14, confirmed }, A.Store.todayISO());
    assert.ok(ok, 'the phase should start');
  });
  return db;
}
function checkIn(db, { kg, ready = null } = {}) {
  return at(TODAY, () => {
    const update = (fn) => fn(db);
    const ui = mount(A.CheckInModal, { db, update, onClose() {}, isPremium: true });
    ui.click(ui.has('Right, let’s see') ? 'Right, let’s see' : 'Carry on anyway');
    if (kg != null) ui.type(ui.host.ownerDocument.querySelector('input'), kg);
    ui.click('Continue');
    if (A.phaseLive(db, TODAY)) {
      assert.ok(ui.has('How are you holding up?'), 'a phase asks for readiness: ' + ui.text.slice(0, 300));
      if (ready) {
        const radios = Array.from(ui.host.querySelectorAll('[role="radio"]'));
        ['hunger', 'energy', 'sleep', 'gym'].forEach((k, row) => { if (ready[k]) ui.clickEl(radios[row * 5 + ready[k] - 1]); });
        ui.click('Continue');
      } else ui.click('Skip');
    }
    ui.click('On plan');
    ui.click('See what it means');
    return ui;
  });
}
// Objects built inside the app's sandbox have its prototypes, so compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const lastCi = (db) => db.checkins[db.checkins.length - 1];

test('starting a phase works the pace out, keeps the check-in day and re-anchors from the learned burn', () => {
  const db = account();
  const before = db.last_checkin;
  at(TODAY, () => A.startPhase(db, { goalKg: 80, endISO: shift(TODAY, 42), maintainDays: 14, confirmed: true }, TODAY));
  assert.ok(db.phase, 'a phase was written');
  assert.strictEqual(db.phase.goalType, 'cut');
  assert.ok(db.phase.rate > 0.8 && db.phase.rate < 1.0, 'about 0.9 kg a week: ' + db.phase.rate);
  assert.strictEqual(db.profile.rateKgPerWeek, db.phase.rate);
  assert.strictEqual(db.profile.goalWeightKg, 80);
  assert.strictEqual(db.last_checkin, before, 'a phase must not move the check-in day');
  const t = db.targets[db.targets.length - 1];
  assert.strictEqual(t.effective_date, TODAY);
  assert.ok(t.kcal < TARGET.kcal, 'a faster pace means fewer calories: ' + t.kcal);
  assert.ok(Math.abs(t.estimatedTDEE - BURN) < 50, 'built on the learned burn, not the formula: ' + t.estimatedTDEE);
});

test('a pace past the evidence-backed range needs a yes, and one past the hard limit is refused', () => {
  const db = account();
  const r1 = at(TODAY, () => A.startPhase(db, { goalKg: 80, endISO: shift(TODAY, 42), maintainDays: 14, confirmed: false }, TODAY));
  assert.strictEqual(r1, null, 'needs confirming');
  assert.strictEqual(db.phase, null);
  const r2 = at(TODAY, () => A.startPhase(db, { goalKg: 80, endISO: shift(TODAY, 21), maintainDays: 14, confirmed: true }, TODAY));
  assert.strictEqual(r2, null, 'too fast is refused even with a yes');
});

test('the Friday check-in asks how you are holding up and steers the pace towards the deadline', () => {
  const db = inPhase(account({ rate: -0.6 }));
  const prevRate = db.profile.rateKgPerWeek;
  const lastW = db.weight_entries[db.weight_entries.length - 1];
  const ui = checkIn(db, { kg: +(lastW.scale_weight - 0.05).toFixed(1) });
  try {
    assert.ok(ui.has('the line says'), 'the reading shows the checkpoint: ' + ui.text.slice(0, 500));
  } finally { ui.unmount(); }
  const ci = lastCi(db);
  assert.strictEqual(ci.date, TODAY);
  assert.ok(ci.phase, 'the step is recorded on the check-in');
  assert.ok(db.profile.rateKgPerWeek <= prevRate + 0.1 + 1e-9, 'never more than 0.1 up in one go: ' + prevRate + ' -> ' + db.profile.rateKgPerWeek);
  assert.ok(db.profile.rateKgPerWeek <= db.phase.capKg + 1e-9, 'never past the agreed limit');
  assert.strictEqual(db.phase.rate, db.profile.rateKgPerWeek);
  assert.strictEqual(db.last_checkin, TODAY);
});

test('two rough weeks in a row and the pace is held, not pushed', () => {
  const db = inPhase(account({ rate: -0.3 }));
  db.checkins[db.checkins.length - 1].ready = { hunger: 1, energy: 2, sleep: 2, gym: 3 };
  const prevRate = db.profile.rateKgPerWeek;
  const lastW = db.weight_entries[db.weight_entries.length - 1];
  const ui = checkIn(db, { kg: lastW.scale_weight, ready: { hunger: 2, energy: 2, sleep: 3, gym: 2 } });
  ui.unmount();
  const ci = lastCi(db);
  assert.deepStrictEqual(plain(ci.ready), { hunger: 2, energy: 2, sleep: 3, gym: 2 });
  assert.strictEqual(ci.phase.why, 'recover');
  assert.ok(db.profile.rateKgPerWeek <= prevRate + 1e-9, 'held: ' + prevRate + ' -> ' + db.profile.rateKgPerWeek);
});

test('outside a phase the check-in is exactly as it was: no readiness step', () => {
  const db = account();
  const ui = checkIn(db, { kg: 85.4 });
  try { assert.ok(!ui.has('How are you holding up?')); } finally { ui.unmount(); }
  assert.ok(!lastCi(db).ready && !lastCi(db).phase);
});

test('the end of a phase hands over to maintenance, books a review, and is idempotent', () => {
  const db = inPhase(account());
  const end = db.phase.end;
  const day = shift(end, 1);
  const targetsBefore = db.targets.length;
  const pastTarget = db.targets[db.targets.length - 1];
  at(day, () => A.applyPhaseTransitions(db, day));
  assert.ok(db.phase.applied.end, 'marked done');
  assert.ok(db.phase.outcome && db.phase.outcome.reason === 'finished');
  assert.strictEqual(db.profile.goalType, 'maintain');
  assert.deepStrictEqual(plain(db.diet_break), { start: day, end: shift(end, 14), returnGoal: 'maintain' });
  assert.strictEqual(db.phase.reviewOn, shift(end, 15));
  assert.strictEqual(db.targets.length, targetsBefore + 1);
  assert.strictEqual(db.targets[db.targets.length - 1].effective_date, day, 'never backdated');
  assert.strictEqual(A.Engine.targetOn(db.targets, end).id, pastTarget.id, 'the last phase day keeps its target');
  at(day, () => A.applyPhaseTransitions(db, day));
  assert.strictEqual(db.targets.length, targetsBefore + 1, 'running it again does nothing');
  assert.strictEqual(A.phaseReviewDue(db, day), false, 'no review during maintenance');
  assert.strictEqual(A.phaseReviewDue(db, shift(end, 15)), true);
});

test('the review card reads the phase back and Done files it in the history', () => {
  const db = inPhase(account());
  const day = shift(db.phase.end, 1);
  at(day, () => A.applyPhaseTransitions(db, day));
  const reviewDay = db.phase.reviewOn;
  const out = at(reviewDay, () => render(A.PhaseReviewCard, { db, update: (fn) => fn(db), showToast() {} }));
  assert.ok(out.has('Your phase is done'), out.text);
  assert.ok(out.has('Copy summary'));
  const text = A.phaseSummaryText(db.phase, A.phaseSummary(db, db.phase), 'kg');
  assert.ok(/What should my next phase be\?/.test(text));
  at(reviewDay, () => A.closePhase(db, reviewDay, 'reviewed'));
  assert.strictEqual(db.phase, null);
  assert.strictEqual(db.phase_log.length, 1);
  assert.strictEqual(db.phase_log[0].outcome.reason, 'finished', 'the outcome recorded at the end is kept');
});

test('ending a phase early keeps the goal and pace and files it', () => {
  const db = inPhase(account());
  const rate = db.profile.rateKgPerWeek;
  at(TODAY, () => A.closePhase(db, TODAY, 'ended'));
  assert.strictEqual(db.phase, null);
  assert.strictEqual(db.profile.rateKgPerWeek, rate);
  assert.strictEqual(db.phase_log[0].outcome.reason, 'ended');
});

test('Today shows the phase strip while it runs', () => {
  const db = inPhase(account());
  const st = at(TODAY, () => A.phaseStatus(db, TODAY));
  assert.ok(st && st.week === 2 && st.weeks === 6, JSON.stringify(st && { week: st.week, weeks: st.weeks }));
  assert.ok(st.target < st.ph.startKg && st.target > st.ph.goalKg);
});

test('goal screen: weight by a date, confirm the faster pace, start the phase', () => {
  const db = account();
  const ui = at(TODAY, () => mount(A.GoalEditor, { db, update: (fn) => fn(db), showToast() {}, onDone() {} }));
  try {
    at(TODAY, () => ui.click('Weight by a date'));
    const inputs = () => Array.from(ui.host.querySelectorAll('input'));
    const date = inputs().find(i => i.type === 'date');
    assert.ok(date, 'a date field appears');
    at(TODAY, () => ui.type(date, shift(TODAY, 42)));
    assert.ok(ui.has('Faster than the evidence-backed'), 'about 0.9 kg a week asks for a yes: ' + ui.text.slice(0, 600));
    const start = ui.findEl('Start phase');
    assert.ok(start && start.disabled, 'cannot start before saying yes');
    at(TODAY, () => ui.click('I understand, run it at this pace'));
    assert.ok(!ui.findEl('Start phase').disabled, 'enabled once confirmed');
    at(TODAY, () => ui.click('Start phase'));
    at(TODAY, () => ui.click('Confirm & update'));
  } finally { ui.unmount(); }
  assert.ok(db.phase, 'the phase was started');
  assert.strictEqual(db.phase.end, shift(TODAY, 42));
  assert.strictEqual(db.phase.maintainDays, 14);
  assert.strictEqual(db.phase.capKg, A.Engine.phaseLimits(db.profile).hardKg);
});

test('goal screen: a refused deadline offers the nearest date that works', () => {
  const db = account();
  const ui = at(TODAY, () => mount(A.GoalEditor, { db, update: (fn) => fn(db), showToast() {}, onDone() {} }));
  try {
    at(TODAY, () => ui.click('Weight by a date'));
    const date = Array.from(ui.host.querySelectorAll('input')).find(i => i.type === 'date');
    at(TODAY, () => ui.type(date, shift(TODAY, 21)));
    assert.ok(ui.has('Too fast to do safely'), ui.text.slice(0, 600));
    at(TODAY, () => ui.click('Same weight by'));
    assert.ok(!ui.has('Too fast to do safely'), 'the suggested date is allowed');
  } finally { ui.unmount(); }
});

test('finished phases survive a merge from another device', () => {
  const a = A.Store.defaultState(), b = A.Store.defaultState();
  a._rev = 2; b._rev = 1;
  a.phase_log = [{ id: 'p1', start: '2026-01-01', end: '2026-02-01' }];
  b.phase_log = [{ id: 'p0', start: '2025-09-01', end: '2025-10-01' }];
  const m = A.Store.mergeStates(a, b);
  assert.deepStrictEqual(plain(m.phase_log.map(p => p.id).sort()), ['p0', 'p1']);
});
