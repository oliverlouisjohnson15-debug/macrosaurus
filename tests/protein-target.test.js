'use strict';
/* The protein target, set as an exact number of grams.
 *
 * Protein had one control: a slider in grams per kg of LEAN mass. It is the right default - body
 * fat should not inflate a protein target - but it re-scales every time the scale moves, so on a
 * cut it quietly shaves protein off exactly when protein is doing the most work. Somebody
 * defending muscle through a deficit wants a floor they set and the plan holds.
 *
 * These mount the real Goals editor and drive the control the way a thumb would.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount } = require('./helpers/app.js');

const A = app();
const E = A.Engine;

// Lean mass 65.17 kg, so the band is 78-261 g and 182 g sits comfortably inside it.
const profile = {
  sex: 'male', age: 32, heightCm: 175.26, weightKg: 88.07, bodyFatPct: 26,
  goalType: 'cut', rateKgPerWeek: 0.75, dietStyle: 'balanced', proteinGPerKgLBM: 2.4,
  activityLevel: 'very', avgSteps: 12000, gymSessionsPerWeek: 5,
  weight_unit: 'kg', height_unit: 'cm', goalWeightKg: 80,
};
function db(extra) {
  const p = Object.assign({}, profile, extra || {});
  const t = Object.assign({ id: 't1', effective_date: '2026-09-01', source: 'formula' }, E.computeInitialTargets(p));
  return { profile: p, targets: [t], weight_entries: [], checkins: [], log_entries: [], paused: false };
}
const type = (r, el, value) => r.type(el, value);
// The goal-weight and confirm-weight fields are number inputs too; the protein box is the one
// carrying the band as its min/max.
const numberBox = (r) => r.host.querySelector('input[type="number"][min][max]');
// The pace-per-week control is a range input too; the protein one runs over the g/kg lean band.
const proteinSlider = (r) => r.host.querySelector('input[type="range"][min="1.8"]');
const open = (extra) => mount(A.GoalEditor, { db: db(extra), update() {}, showToast() {}, onDone() {} })
  .click('Advanced: protein and diet style');

test('the guided slider is still what Goals opens on', () => {
  const r = open();
  assert.ok(r.has('g/kg lean mass'), 'the per-kg reading should be on screen: ' + r.text.slice(0, 200));
  assert.ok(r.has('Protein: ' + Math.round(2.4 * 65.1718) + ' g a day'), r.text.slice(0, 300));
  assert.ok(proteinSlider(r), 'and the slider with it');
});

test('switching to exact grams seeds the box with the figure you were already on', () => {
  const r = open().click('Exact grams');
  const box = numberBox(r);
  assert.ok(box, 'a gram box should replace the slider');
  assert.strictEqual(box.value, String(Math.round(2.4 * 65.1718)));
  assert.ok(!proteinSlider(r), 'and the slider goes away');
});

test('a typed figure is read back, and the plan says it is held', () => {
  const r = open().click('Exact grams');
  type(r, numberBox(r), 182);
  assert.ok(r.has('Protein: 182 g a day'), r.text.slice(0, 300));
  assert.ok(r.has('the plan HOLDS it'), 'the point of the mode should be said out loud');
  assert.ok(r.has('stays 182 g as you lose weight'), r.text.slice(0, 400));
  assert.ok(!r.has('g/kg lean mass)'), 'and it is no longer described as a per-kg figure');
});

test('the band is named, and a fat-fingered figure is clamped rather than obeyed', () => {
  const bounds = E.proteinManualBounds(profile);
  const r = open().click('Exact grams');
  type(r, numberBox(r), 1820); // the 182 typo
  assert.ok(r.has('Held at ' + bounds.max + ' g'), 'the clamp should be explained: ' + r.text.slice(0, 400));
  assert.ok(r.has(bounds.min + '–' + bounds.max + ' g'), 'and the band named');
  assert.ok(r.has('Protein: ' + bounds.max + ' g a day'), r.text.slice(0, 300));
});

test('an empty box mid-edit reads as the slider, not as a target of nothing', () => {
  const r = open().click('Exact grams');
  type(r, numberBox(r), '');
  assert.ok(numberBox(r), 'clearing the box must not throw you back to the slider');
  assert.ok(r.has('Protein: ' + Math.round(2.4 * 65.1718) + ' g a day'), r.text.slice(0, 300));
});

test('an account already holding a figure opens on it', () => {
  const r = open({ proteinManualG: 182 });
  assert.strictEqual(numberBox(r).value, '182');
  assert.ok(r.has('Protein: 182 g a day'), r.text.slice(0, 300));
});

test('saving a held figure writes it to the profile and into the new target', () => {
  let saved = null;
  const d = db();
  const r = mount(A.GoalEditor, {
    db: d, showToast() {}, onDone() {},
    update(fn) { const copy = JSON.parse(JSON.stringify(d)); fn(copy); saved = copy; },
  }).click('Advanced: protein and diet style').click('Exact grams');
  type(r, numberBox(r), 182);
  r.click('Save & update goal').click('Confirm & update');
  assert.ok(saved, 'the save should have run');
  assert.strictEqual(saved.profile.proteinManualG, 182);
  const t = saved.targets[saved.targets.length - 1];
  assert.strictEqual(t.protein_g, 182);
  assert.strictEqual(t.source, 'goal-change');
});

test('going back to per kg clears the held figure', () => {
  let saved = null;
  const d = db({ proteinManualG: 182 });
  const r = mount(A.GoalEditor, {
    db: d, showToast() {}, onDone() {},
    update(fn) { const copy = JSON.parse(JSON.stringify(d)); fn(copy); saved = copy; },
  }).click('Advanced: protein and diet style').click('Per kg lean');
  r.click('Save & update goal').click('Confirm & update');
  assert.strictEqual(saved.profile.proteinManualG, null);
  assert.strictEqual(saved.targets[saved.targets.length - 1].protein_g, Math.round(2.4 * 65.1718));
});

// ---- adaptive mode, and the recommendation shown alongside every mode --------------------------

test('Goals opens on whatever mode the profile is in, and old profiles stay on the slider', () => {
  assert.ok(open().has('g/kg lean mass'), 'a profile with no proteinMode must not be migrated silently');
  assert.ok(proteinSlider(open()), 'and keeps its slider');
  const a = open({ proteinMode: 'adaptive' });
  assert.ok(!proteinSlider(a) && !numberBox(a), 'adaptive has nothing to set');
  assert.ok(a.has('Moves on its own'), a.text.slice(0, 300));
});

test('the recommendation and its arithmetic are shown in every mode', () => {
  const rec = E.proteinRecommendation(A.withActivity(profile));
  for (const mode of ['perkg', 'adaptive']) {
    const r = open(mode === 'adaptive' ? { proteinMode: 'adaptive' } : {});
    assert.ok(r.has('Research puts you on ' + rec.grams + ' g'), `${mode}: ` + r.text.slice(0, 400));
    assert.ok(r.has(`for ${profile.bodyFatPct}% body fat`), `${mode} should show the body-fat term: ` + r.text.slice(r.text.indexOf('Research puts'), r.text.indexOf('Research puts') + 300));
    assert.ok(r.has('% deficit'), `${mode} should show the deficit term`);
    assert.ok(r.has('Helms 2014'), `${mode} should cite what it is built on`);
  }
});

test('adaptive follows body fat: leaner reads higher, even at a lower weight', () => {
  const fatter = open({ bodyFatPct: 26, weightKg: 90, proteinMode: 'adaptive' });
  const leaner = open({ bodyFatPct: 18, weightKg: 84, proteinMode: 'adaptive' });
  const grams = (r) => +/Protein: (\d+) g a day/.exec(r.text)[1];
  assert.ok(grams(leaner) > grams(fatter), `${grams(leaner)} should exceed ${grams(fatter)}`);
});

test('a manual figure off the recommendation offers a one-tap way back', () => {
  const rec = E.proteinRecommendation(A.withActivity(profile));
  const r = open({ proteinManualG: 182 });
  assert.ok(r.has('Use ' + rec.grams + ' g'), 'the way back should be on screen: ' + r.text.slice(0, 500));
  r.click('Use ' + rec.grams + ' g');
  assert.strictEqual(numberBox(r).value, String(rec.grams));
  assert.ok(!r.has('Use ' + rec.grams + ' g'), 'and goes away once you are on it');
});

test('adaptive with no body-fat reading says what it needs instead of inventing a figure', () => {
  const r = open({ bodyFatPct: null, proteinMode: 'adaptive' });
  assert.ok(r.has('Adaptive needs a body-fat reading'), r.text.slice(0, 400));
  assert.ok(!r.has('Research puts you on'), 'and does not show a recommendation it cannot make');
  // The plan still has a number: the per-kg setting underneath.
  assert.ok(r.has('Protein: ' + Math.round(2.4 * profile.weightKg) + ' g a day'), r.text.slice(0, 300));
});

test('switching modes does not move your number', () => {
  const r = open();
  const before = +/Protein: (\d+) g a day/.exec(r.text)[1];
  r.click('Exact grams');
  assert.strictEqual(numberBox(r).value, String(before));
});

test('choosing adaptive saves the mode and drops any held figure', () => {
  let saved = null;
  const d = db({ proteinManualG: 182 });
  const r = mount(A.GoalEditor, {
    db: d, showToast() {}, onDone() {},
    update(fn) { const copy = JSON.parse(JSON.stringify(d)); fn(copy); saved = copy; },
  }).click('Advanced: protein and diet style').click('Adaptive');
  r.click('Save & update goal').click('Confirm & update');
  assert.strictEqual(saved.profile.proteinMode, 'adaptive');
  assert.strictEqual(saved.profile.proteinManualG, null);
  assert.strictEqual(saved.targets[saved.targets.length - 1].protein_g,
    E.proteinRecommendation(A.withActivity(Object.assign({}, profile, { proteinMode: 'adaptive' }))).grams);
});
