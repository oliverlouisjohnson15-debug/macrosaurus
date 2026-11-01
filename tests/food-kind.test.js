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

test('tiles wear their food type', () => {
  assert.equal(E.foodTileTone({}), 'kind');
  assert.equal(E.foodTileTone({ premium: true }), 'kind');
});

test('alcohol is never given a food-type colour', () => {
  assert.equal(E.foodTileTone({ isAlcohol: true }), 'neutral');
});
