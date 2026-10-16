'use strict';
// Diet break readiness: the offer is personalised, not a stopwatch. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const base = { weeks: 6, bfPct: 22, sex: 'male', adaptDropPct: 3, deficitPct: 20, stalled: false, sleepAvgH: 7.5 };

test('six weeks in, mid body fat, nothing else wrong: wait', () => {
  assert.strictEqual(E.dietBreakReadiness(base).level, 'wait');
});

test('twelve weeks with a burn drop becomes a recommendation', () => {
  const r = E.dietBreakReadiness(Object.assign({}, base, { weeks: 12, adaptDropPct: 9 }));
  assert.strictEqual(r.level, 'recommended');
  assert.ok(r.reasons.length >= 2);
});

test('a lean person is pushed earlier and gets the longer break', () => {
  const r = E.dietBreakReadiness(Object.assign({}, base, { bfPct: 13, weeks: 7 }));
  assert.strictEqual(r.level, 'consider');
  assert.strictEqual(r.days, 14);
});

test('high body fat holds the offer back unless the cut is very long', () => {
  const heavy = Object.assign({}, base, { bfPct: 30, weeks: 10, stalled: true });
  assert.strictEqual(E.dietBreakReadiness(heavy).level, 'wait');
  assert.notStrictEqual(E.dietBreakReadiness(Object.assign({}, heavy, { weeks: 18 })).level, 'wait');
});

test('women use their own leanness bands', () => {
  const lean = E.dietBreakReadiness(Object.assign({}, base, { sex: 'female', bfPct: 22, weeks: 7 }));
  assert.strictEqual(lean.level, 'consider');
});

test('poor sleep and a stall each add weight', () => {
  const none = E.dietBreakReadiness(Object.assign({}, base, { weeks: 9 }));
  const both = E.dietBreakReadiness(Object.assign({}, base, { weeks: 9, stalled: true, sleepAvgH: 5.8 }));
  assert.ok(both.score >= none.score + 2);
});

test('missing inputs never throw', () => {
  assert.strictEqual(E.dietBreakReadiness().level, 'wait');
  assert.strictEqual(E.dietBreakReadiness({ weeks: 12 }).level, 'consider');   // twelve weeks alone is a soft offer
});
