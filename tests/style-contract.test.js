'use strict';
// The style contract.
//
// Two training styles now fork the generator in about fifteen places, and the failures that come out
// of that are quiet ones: a block that looks fine and breaks a rule of the method it claims to be.
// Both of the bugs this file was written after were exactly that - coverage judged against the other
// style's landmarks, and a block talking its own caps upward one block at a time.
//
// So this is a matrix rather than a list of cases: every style, at every day count, at every shape,
// asserting the things that must be true of it whatever else changed.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

const DAYS = [2, 3, 4, 5, 6];
const SHAPES = { minmax: ['minmax6', 'build4'], landmarks: ['build4', 'build3-deload1'] };

function build(style, days, shape) {
  const targets = T.defaultTargets({ style: style, experience: 'intermediate' });
  return T.generateBlock({
    style: style, daysPerWeek: days, shape: shape,
    weeks: T.SHAPES[shape].build + (T.SHAPES[shape].deload ? 1 : 0),
    targets: targets, sessionMinutes: 60,
  });
}

function eachBlock(fn) {
  for (const style of Object.keys(SHAPES)) {
    for (const days of DAYS) {
      for (const shape of SHAPES[style]) {
        const label = `${style} / ${days} days / ${shape}`;
        fn(build(style, days, shape), { style, days, shape, label });
      }
    }
  }
}

// ---- true of any block, whatever style built it ------------------------------------------------

test('every block is trainable: real days, real weeks, unique ids', () => {
  eachBlock((block, c) => {
    assert.equal(block.daysPerWeek, c.days, c.label);
    const wk1 = T.weekSessions(block, 1);
    assert.equal(wk1.length, c.days, c.label + ': week one is not the day count asked for');
    for (let w = 1; w <= block.weeks; w++) {
      assert.equal(T.weekSessions(block, w).length, c.days, `${c.label}: week ${w}`);
    }
    const ids = block.sessions.reduce((a, s) => a.concat(s.exercises.map(e => e.id)), []);
    assert.equal(new Set(ids).size, ids.length, c.label + ': two lines share an id');
    for (const s of block.sessions) {
      assert.ok(s.dayOfWeek >= 0 && s.dayOfWeek <= 6, `${c.label}: ${s.name} falls outside the week`);
      assert.ok(s.exercises.length > 0, `${c.label}: ${s.name} is empty`);
      for (const e of s.exercises) {
        assert.ok(T.byId(e.exerciseId), `${c.label}: ${e.exerciseId} is not a movement`);
        assert.ok(e.target.repLow <= e.target.repHigh, c.label);
        assert.ok(e.target.sets >= 1, c.label);
      }
    }
  });
});

test('no block ever programmes a muscle past what it can recover from', () => {
  eachBlock((block, c) => {
    const targets = T.defaultTargets({ style: c.style, experience: 'intermediate' });
    for (let w = 1; w <= block.weeks; w++) {
      const over = T.coverage(T.blockWeekVolume(block, w), targets).overs;
      assert.equal(over.length, 0, `${c.label}: week ${w} runs ${over.map(r => r.label).join(', ')} past MRV`);
    }
  });
});

test('a block packs and comes back identical, whatever built it', () => {
  eachBlock((block, c) => {
    assert.deepEqual(T.unpackBlock(T.packBlock(block)), block, c.label + ': did not survive storage');
  });
});

// ---- what makes min-max min-max -----------------------------------------------------------------

test('min-max holds its own rules at every day count and shape', () => {
  for (const days of DAYS) {
    for (const shape of SHAPES.minmax) {
      const block = build('minmax', days, shape);
      const label = `minmax / ${days} days / ${shape}`;
      assert.equal(block.style, 'minmax', label);
      for (const s of block.sessions) {
        assert.ok(s.exercises.length >= 5 && s.exercises.length <= 9, `${label}: ${s.name} has ${s.exercises.length} movements`);
        for (const e of s.exercises) {
          assert.ok(e.target.sets <= 2, `${label}: ${e.target.sets} sets on one movement`);
          const window = e.target.repLow + '-' + e.target.repHigh;
          assert.ok(window === '6-8' || window === '8-10', `${label}: ${window}`);
          assert.ok(e.target.rirLast != null, label + ': no last-set effort');
          assert.ok(e.target.rirLast <= e.target.rir, label + ': the last set is not the hard one');
          if (s.week > 1 && !s.deload) assert.equal(e.target.rirLast, 0, `${label}: week ${s.week} does not go to failure`);
        }
      }
      // Volume never climbs: the progression is on the bar, not in the plan.
      const setsIn = (w) => T.weekSessions(block, w).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
      assert.equal(setsIn(block.weeks), setsIn(2), label + ': sets climbed across the block');
      // And the caps are the caps.
      const vol = T.blockWeekVolume(block, 2);
      for (const m of T.MUSCLES) assert.ok(vol[m] <= 10, `${label}: ${T.MUSCLE_LABEL[m]} got ${vol[m]} sets`);
    }
  }
});

test('the min-max week keeps its rest days wherever it is run', () => {
  for (const days of DAYS) {
    const block = build('minmax', days, 'minmax6');
    const trained = T.trainingDaysOfWeek(block);
    assert.equal(trained.length, days, `${days} days: sessions doubled up on a weekday`);
    if (days <= 5) assert.ok(T.restDaysOfWeek(block, 1).length === 7 - days, `${days} days: rest days do not add up`);
  }
});

// ---- what makes the volume model itself ---------------------------------------------------------

test('the volume model still builds up and stops short, at every day count', () => {
  for (const days of DAYS) {
    for (const shape of SHAPES.landmarks) {
      const block = build('landmarks', days, shape);
      const label = `landmarks / ${days} days / ${shape}`;
      const setsIn = (w) => T.weekSessions(block, w).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
      assert.ok(setsIn(3) > setsIn(1), label + ': volume did not climb');
      const w1 = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises), []);
      assert.ok(w1.every(e => e.target.rir > 0), label + ': week one should stop short of failure');
      assert.ok(w1.every(e => e.target.rirLast == null), label + ': the pair belongs to the other style');
      if (T.SHAPES[shape].deload) {
        const last = T.weekSessions(block, block.weeks);
        assert.ok(last.every(s => s.deload), label + ': the last week should be the lighter one');
      }
    }
  }
});

// ---- the two must not read each other's numbers -------------------------------------------------

test('a style never borrows the other style\'s landmarks, however it is asked', () => {
  // The trap this was written after: generateBlock with a style but no targets used to build against
  // whichever table defaultTargets happened to reach for.
  const noTargets = T.generateBlock({ style: 'minmax', daysPerWeek: 5, weeks: 6, shape: 'minmax6' });
  const vol = T.blockWeekVolume(noTargets, 2);
  for (const m of T.MUSCLES) assert.ok(vol[m] <= 10, `${T.MUSCLE_LABEL[m]} got ${vol[m]} sets with no targets passed`);
  // And the tables themselves stay apart.
  const mm = T.defaultTargets({ style: 'minmax' }), lm = T.defaultTargets({});
  assert.ok(mm.ch.mrv < lm.ch.mrv / 2, 'the two ceilings should not be in the same range');
  for (const m of T.MUSCLES) assert.ok(mm[m].mrv <= 10, `min-max ${m} ceiling is ${mm[m].mrv}`);
});
