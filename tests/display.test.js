'use strict';
// Tests for the display decisions in engine.js: how a segmented meter fills, and which status tone
// a quality score wears.
//
// These exist because every bug in the food-quality work was a DISPLAY bug, not a maths bug, and
// none of them could be caught by a test while the logic sat inside a React component. Each case
// below is a mistake that actually shipped into the preview and was found by eye:
//   - blocks past the goal painted red when beating the target was the whole point
//   - a meter running past its own track
//   - a status colour borrowed from a macro's identity hue
// If any of these fails, the UI has regressed to something a person already spotted once.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

test('a meter part-way to target lights part of the track', () => {
  const m = E.meterCells(50, 100);
  assert.equal(m.cells, 10);
  assert.ok(m.lit > 0 && m.lit < m.goal, `lit ${m.lit}, goal ${m.goal}`);
  assert.equal(m.over, 0);
});

test('the goal notch sits on a block boundary, never between two', () => {
  const m = E.meterCells(0, 100);
  assert.equal(m.goal, Math.round(m.goal), 'the notch must land on a whole block');
  assert.ok(m.goal > 0 && m.goal < m.cells, 'the notch must be visible inside the track');
});

test('an empty day lights nothing', () => {
  const m = E.meterCells(0, 100);
  assert.equal(m.lit, 0);
  assert.equal(m.over, 0);
});

test('no target means no meter rather than a full one', () => {
  // A food logged before targets exist must not read as "100% of nothing".
  const m = E.meterCells(50, 0);
  assert.equal(m.lit, 0);
  assert.equal(m.over, 0);
});

test('going over a target you should not exceed is flagged', () => {
  const m = E.meterCells(130, 100);
  assert.ok(m.over > 0, 'blocks past the goal should read as an overshoot');
  assert.ok(m.lit >= m.goal);
});

test('beating a target you are meant to beat is never flagged', () => {
  // The bug: a Density Score of 94 against a target of 70 rendered its last blocks in the danger
  // colour, scolding someone for eating well. Fibre had the same problem.
  const quality = E.meterCells(94, 70, { scale: 100 / 70, overIsFine: true });
  assert.equal(quality.over, 0, 'exceeding a quality target must not be an overshoot');
  assert.ok(quality.lit > quality.goal, 'it should still be visibly past the notch');
  const fibre = E.meterCells(40, 27, { overIsFine: true });
  assert.equal(fibre.over, 0);
});

test('the meter never runs past its own track', () => {
  [200, 1000, 99999].forEach((v) => {
    const m = E.meterCells(v, 100);
    assert.ok(m.lit <= m.cells, `lit ${m.lit} exceeded ${m.cells} cells at value ${v}`);
    assert.ok(m.over <= m.cells);
  });
});

test('negative or missing values cannot light blocks', () => {
  assert.equal(E.meterCells(-50, 100).lit, 0);
  assert.equal(E.meterCells(NaN, 100).lit, 0);
  assert.equal(E.meterCells(undefined, 100).lit, 0);
});

test('quality tones are status tokens, never a macro identity colour', () => {
  // The bug dark mode exposed: "middling" wore --fat, the fat macro's magenta, so food quality
  // shared an identity colour with a meter two rows above it on the same card.
  assert.equal(E.densityTone(90), 'good');
  assert.equal(E.densityTone(E.ND_TARGET), 'good');
  assert.equal(E.densityTone(E.ND_TARGET - 1), 'warn');
  assert.equal(E.densityTone(50), 'warn');
  assert.equal(E.densityTone(49), 'danger');
  assert.equal(E.densityTone(null), 'muted');
  const tones = [90, 60, 20, null].map(E.densityTone);
  tones.forEach(t => assert.ok(['good', 'warn', 'danger', 'muted'].includes(t), `${t} is not a status token`));
});

test('the tone never disagrees with the band', () => {
  // Two ways of describing the same score, shown side by side on the food badge, so they must never
  // contradict: a score the band calls good cannot wear the danger tone.
  for (let s = 0; s <= 100; s++) {
    const band = E.dsBand(s).key, tone = E.densityTone(s);
    if (band === 'excellent' || band === 'good') assert.equal(tone, 'good', `score ${s}: ${band} vs ${tone}`);
    if (band === 'treat') assert.equal(tone, 'danger', `score ${s}: ${band} vs ${tone}`);
  }
});

// ---------------------------------------------------------------------------
// The backfill trigger
//
// These cover a bug that reached production: the effect that fills in missing nutrients keyed off
// `db.log_entries`, and the app's update() deep-clones state, so that array had a new identity after
// every unrelated write. The effect restarted constantly and cancelled its own in-flight AI call, so
// the answer came back, was thrown away, and the entry stayed unscored forever. Five calls were paid
// for and none were kept. The trigger is now the SET of entries needing work.

const DAY = '2026-07-31';
const entry = (id, over) => Object.assign({ id, date: DAY, computed_macros: { kcal: 400 } }, over);

test('the trigger is the same for an identical set of work', () => {
  const a = [entry('1'), entry('2')];
  const b = [entry('1'), entry('2')];   // same work, different array identity, as a clone gives
  assert.equal(E.pendingNqIds(a, DAY), E.pendingNqIds(b, DAY));
  assert.notEqual(a, b, 'the arrays really are different objects');
});

test('order does not change the trigger', () => {
  // A drag-reorder must not look like new work.
  assert.equal(E.pendingNqIds([entry('a'), entry('b')], DAY),
               E.pendingNqIds([entry('b'), entry('a')], DAY));
});

test('the trigger changes when there is genuinely something new to do', () => {
  const before = E.pendingNqIds([entry('1')], DAY);
  const after = E.pendingNqIds([entry('1'), entry('2')], DAY);
  assert.notEqual(before, after);
});

test('scoring an entry removes it from the work', () => {
  const before = E.pendingNqIds([entry('1'), entry('2')], DAY);
  const after = E.pendingNqIds([entry('1'), entry('2', { nq: { protein: 5 } })], DAY);
  assert.notEqual(before, after);
  assert.equal(after, '1');
});

test('alcohol, other days and tiny entries are never work', () => {
  const list = [
    entry('booze', { is_alcohol: true }),
    entry('yesterday', { date: '2026-07-30' }),
    entry('sip', { computed_macros: { kcal: 2 } }),
    entry('real'),
  ];
  assert.equal(E.pendingNqIds(list, DAY), 'real');
});

test('a fully scored day asks for no work at all', () => {
  const done = [entry('1', { nq: { protein: 5 } }), entry('2', { nq: { protein: 3 } })];
  assert.equal(E.pendingNqIds(done, DAY), '');
});

test('missing or malformed entries do not break the trigger', () => {
  assert.equal(E.pendingNqIds(null, DAY), '');
  assert.equal(E.pendingNqIds([null, undefined], DAY), '');
  assert.equal(E.pendingNqIds([{ id: 'x', date: DAY }], DAY), '');   // no macros at all
});
