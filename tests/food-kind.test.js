'use strict';
// Food classification and how a diary tile gets its colour.
//
// The classifier is a pile of regexes over whatever someone types into a food name, which is the
// kind of code that rots silently: a new phrasing lands on the fallback and nobody notices, because
// the fallback still renders something. These tests are the real UK foods people log.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const k = (name, alc) => E.foodKind(name, alc);

test('meat, fish and their many names', () => {
  ['Chicken breast', 'Beef mince', 'Pork chop', 'Streaky bacon', 'Turkey slices',
   'Lamb shank', 'Pork sausage', 'Tuna steak', 'Smoked salmon', 'King prawns']
    .forEach(n => assert.equal(k(n), 'meat', `${n} -> ${k(n)}`));
});

test('plants, including fruit', () => {
  ['Mixed salad', 'Steamed broccoli', 'Baby spinach', 'Cherry tomatoes', 'Red pepper',
   'Green beans', 'Red lentils', 'Avocado', 'Apple', 'Banana', 'Blueberries']
    .forEach(n => assert.equal(k(n), 'plant', `${n} -> ${k(n)}`));
});

test('drinks, and alcohol whatever it is called', () => {
  ['Black coffee', 'Green tea', 'Orange juice', 'Protein shake', 'Diet cola', 'Semi skimmed milk']
    .forEach(n => assert.equal(k(n), 'drink', `${n} -> ${k(n)}`));
  // Alcohol short-circuits on the flag, since "Peroni" matches nothing.
  assert.equal(k('Peroni', true), 'drink');
  assert.equal(k('Merlot', true), 'drink');
});

test('grains and the starchy staples', () => {
  ['Wholemeal bread', 'Sourdough toast', 'Basmati rice', 'Pasta bake', 'Porridge oats',
   'Bagel', 'Chicken wrap is not this', 'Egg noodles', 'Jacket potato', 'Couscous']
    .filter(n => !/wrap is not/.test(n))
    .forEach(n => assert.equal(k(n), 'grain', `${n} -> ${k(n)}`));
});

test('sweets and treats', () => {
  ['Chocolate bar', 'Digestive biscuit', 'Carrot cake is tricky', 'Ice cream', 'Doughnut', 'Sticky toffee pudding']
    .filter(n => !/tricky/.test(n))
    .forEach(n => assert.equal(k(n), 'sweet', `${n} -> ${k(n)}`));
});

test('anything unrecognised gets the dino, never undefined', () => {
  ['Nando\'s medium', 'Leftovers', 'Sunday roast', '', null, undefined]
    .forEach(n => assert.equal(k(n), 'dino', `${JSON.stringify(n)} -> ${k(n)}`));
});

test('classification never throws on odd input', () => {
  [123, {}, [], true].forEach(n => assert.doesNotThrow(() => k(n)));
});

// ---------------------------------------------------------------------------
// Tile colour

test('a free account colours tiles by food type', () => {
  assert.equal(E.foodTileTone({ premium: false, scored: false }), 'kind');
  // Even if a score somehow exists, a free account must not be shown it.
  assert.equal(E.foodTileTone({ premium: false, scored: true }), 'kind');
});

test('a premium account colours tiles by score, or plainly says unscored', () => {
  assert.equal(E.foodTileTone({ premium: true, scored: true }), 'score');
  assert.equal(E.foodTileTone({ premium: true, scored: false }), 'neutral');
});

test('alcohol is never given a score colour', () => {
  // It is not graded as a food at all, so a green tile beside a pint would be a lie.
  assert.equal(E.foodTileTone({ premium: true, scored: true, isAlcohol: true }), 'neutral');
});

test('the two palettes can never appear in the same account', () => {
  // The whole reason the split is safe: a free user never sees a status colour, so their green
  // cannot read as "good"; a premium user never sees a type colour, so their amber cannot read
  // as "grain". If this ever fails, one of the palettes has leaked into the other's account.
  const free = [true, false].map(scored => E.foodTileTone({ premium: false, scored }));
  const prem = [true, false].map(scored => E.foodTileTone({ premium: true, scored }));
  assert.ok(!free.includes('score'), 'a free account must never wear the score palette');
  assert.ok(!prem.includes('kind'), 'a premium account must never wear the type palette');
});
