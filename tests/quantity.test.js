'use strict';
// Tests for the confirm-screen scaling maths (the exact spot the calorie overcount bug lived).
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../app/quantity.js');

const eq = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('atwater matches protein*4 + carbs*4 + fat*9', () => {
  assert.strictEqual(Q.atwater({ protein: 15, carbs: 5.9, fat: 0.2 }), 85); // the healed yoghurt value
  assert.strictEqual(Q.atwater({ protein: 31, carbs: 0, fat: 3.6 }), 156);
});

test('per-100g database food: logging 100 g gives the per-100g values (no 100x overcount)', () => {
  const m = Q.macNums({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 });
  const bases = Q.deriveBases({ per100: true, basisIsServing: false, sg: 0, m });
  assert.ok(bases.perGram, 'per-gram base should exist');
  assert.strictEqual(bases.perServMac, null, 'no serving base without a serving weight');
  const at100 = Q.finalMacros(bases, 'g', 100);
  eq(at100.kcal, 165); eq(at100.protein, 31); eq(at100.fat, 3.6); // exactly per-100g, NOT 16500
  const at200 = Q.finalMacros(bases, 'g', 200);
  eq(at200.kcal, 330); eq(at200.protein, 62);
});

test('per-serving branded food (with serving weight): serving and gram logging agree', () => {
  const m = Q.macNums({ kcal: 186, protein: 29.1, carbs: 9.4, fat: 3.5 }); // one meatball serving
  const sg = 28;
  const bases = Q.deriveBases({ per100: false, basisIsServing: true, sg, m });
  const oneServ = Q.finalMacros(bases, 'serv', 1);
  eq(oneServ.kcal, 186); eq(oneServ.protein, 29.1);
  const twoServ = Q.finalMacros(bases, 'serv', 2);
  eq(twoServ.kcal, 372);
  const byGrams = Q.finalMacros(bases, 'g', 28); // 28 g == one serving
  eq(byGrams.kcal, 186, 1); eq(byGrams.protein, 29.1, 0.2);
});

test('per-100g label with a serving size: a serving is the correct fraction of 100 g', () => {
  const m = Q.macNums({ kcal: 400, protein: 20, carbs: 50, fat: 12 }); // per 100 g
  const sg = 30; // one serving is 30 g
  const bases = Q.deriveBases({ per100: true, basisIsServing: false, sg, m });
  const oneServ = Q.finalMacros(bases, 'serv', 1);
  eq(oneServ.kcal, 120); eq(oneServ.protein, 6); eq(oneServ.fat, 3.6); // 30% of the per-100g figures
  const at100 = Q.finalMacros(bases, 'g', 100);
  eq(at100.kcal, 400);
});

test('manual per-serving with no serving weight: only serving logging, no gram base', () => {
  const m = Q.macNums({ kcal: 250, protein: 10, carbs: 30, fat: 9 });
  const bases = Q.deriveBases({ per100: false, basisIsServing: true, sg: 0, m });
  assert.strictEqual(bases.perGram, null);
  eq(Q.finalMacros(bases, 'serv', 1).kcal, 250);
  eq(Q.finalMacros(bases, 'serv', 1.5).kcal, 375);
});

test('half and quarter portions scale cleanly', () => {
  const m = Q.macNums({ kcal: 200, protein: 20, carbs: 20, fat: 4 });
  const bases = Q.deriveBases({ per100: false, basisIsServing: true, sg: 0, m });
  eq(Q.finalMacros(bases, 'serv', 0.5).kcal, 100);
  eq(Q.finalMacros(bases, 'serv', 0.25).protein, 5);
});

test('macRound keeps one decimal on macros and integer calories', () => {
  const r = Q.macRound({ kcal: 165.4, protein: 31.06, carbs: 0.04, fat: 3.58, fiber: 1.24 });
  assert.strictEqual(r.kcal, 165);
  assert.strictEqual(r.protein, 31.1);
  assert.strictEqual(r.carbs, 0);
  assert.strictEqual(r.fat, 3.6);
});
