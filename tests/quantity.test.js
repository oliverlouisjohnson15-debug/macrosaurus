'use strict';
// Tests for the confirm-screen scaling maths (the exact spot the calorie overcount bug lived).
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../app/quantity.js');

const eq = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('atwater matches protein*4 + carbs*4 + fat*9 (+ fibre*2)', () => {
  assert.strictEqual(Q.atwater({ protein: 15, carbs: 5.9, fat: 0.2 }), 85); // the healed yoghurt value
  assert.strictEqual(Q.atwater({ protein: 31, carbs: 0, fat: 3.6 }), 156);
  assert.strictEqual(Q.atwater({ protein: 10, carbs: 10, fat: 0, fiber: 5 }), 90); // 80 + 5 g fibre
  assert.strictEqual(Q.atwater({}), 0);
});

// The bug this guards: a UK label declares carbohydrate EXCLUDING fibre and counts fibre at
// 2 kcal/g, so a 4/4/9 sum lands 2 kcal short per gram of fibre. Left uncounted, a logged day's
// calories read higher than its own macros can explain, which is exactly what a user notices.
test('atwater reconciles real UK labels, where a plain 4/4/9 sum falls short', () => {
  const labels = [
    { name: 'butternut squash & sweet potato', kcal: 116, protein: 2.1, carbs: 16.8, fat: 3.7, fiber: 3 },
    { name: 'lower fat pork sausages', kcal: 184, protein: 21.2, carbs: 5.2, fat: 8, fiber: 4 },
    { name: 'flat iron steak (no fibre)', kcal: 192, protein: 31.8, carbs: 0, fat: 7.2, fiber: 0 },
  ];
  for (const l of labels) {
    const plain = l.protein * 4 + l.carbs * 4 + l.fat * 9;
    eq(Q.atwater(l), l.kcal, 2);                       // with fibre: matches the label
    eq(plain, l.kcal - l.fiber * 2, 2);                // without it: short by 2 kcal per g of fibre
  }
});

// A whole day is where the shortfall becomes visible: it is the sum of every entry's fibre.
test("a day's calories reconcile with its macros once fibre is counted", () => {
  const day = [
    { kcal: 116, protein: 2.1, carbs: 16.8, fat: 3.7, fiber: 3 },
    { kcal: 9, protein: 0, carbs: 2, fat: 0, fiber: 0 },
    { kcal: 192, protein: 31.8, carbs: 0, fat: 7.2, fiber: 0 },
    { kcal: 132, protein: 25, carbs: 7.2, fat: 0.8, fiber: 0.5 },
    { kcal: 184, protein: 21.2, carbs: 5.2, fat: 8, fiber: 4 },
    { kcal: 60, protein: 7.2, carbs: 3.3, fat: 1.8, fiber: 0 },
    { kcal: 480, protein: 28, carbs: 30, fat: 26, fiber: 5 },
    { kcal: 418, protein: 36.4, carbs: 14.5, fat: 23.6, fiber: 0.5 },
  ];
  const tot = day.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat, fiber: a.fiber + e.fiber }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const plain = tot.protein * 4 + tot.carbs * 4 + tot.fat * 9;
  assert.ok(tot.kcal - plain > 25, 'without fibre the day is short by more than 25 kcal');
  eq(Q.atwater(tot), tot.kcal, 3); // with fibre it reconciles to label rounding
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
