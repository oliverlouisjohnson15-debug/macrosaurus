'use strict';
// The buddy's message ladder must be TOTAL: every rung above the last one is a request that may
// decline to fire, and for a while the common case of a well-run day fell out of the bottom as null,
// so the top card on Today rendered an empty frame with a sprite in it. buddyRest closes that, and
// this file holds the closure shut - it is exactly the kind of property that a later rung, added in
// the middle with an early `return null`, would quietly reopen.
// Read out of the source the same way tests/pixel-icons.test.js reads the icon art: the ladder lives
// in app.jsx among the React tree and cannot be required, but its shape is still checkable.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');

function body(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in app.jsx');
  // Brace-match from the signature so nested functions and objects come along with it.
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  assert.fail('unbalanced braces reading ' + name);
}

// Comments carry the words "return null" all over this area, and a `//` line is not code.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('buddyMessage ends on the rest rung, not on a bare return null', () => {
  const src = stripComments(body('buddyMessage'));
  const returns = src.match(/return[^;]*;/g) || [];
  const last = returns[returns.length - 1];
  assert.match(last, /buddyRest\(/,
    'the last thing buddyMessage can do must be to rest; it was: ' + last);
});

test('buddyRest can never return null or undefined', () => {
  const src = stripComments(body('buddyRest'));
  assert.ok(!/return\s*(null|undefined)?\s*;/.test(src),
    'buddyRest has a return with no value, so the card can go blank again');
  // Every exit is a pick() out of a pool, which is what makes "always a line" structural.
  for (const r of src.match(/return[^;]*;/g) || []) {
    assert.match(r, /pick\(/, 'buddyRest returned something that is not a pooled line: ' + r);
  }
});

test('every rest pool has lines in it', () => {
  const block = SRC.match(/const REST_LINES = \{[\s\S]*?\n\};/);
  assert.ok(block, 'REST_LINES not found in app.jsx');
  const pools = {};
  for (const m of block[0].matchAll(/(\w+):\s*\[([\s\S]*?)\],?\n/g)) {
    pools[m[1]] = m[2].match(/'(?:[^'\\]|\\.)*'/g) || [];
  }
  const expected = ['landed', 'landedStreak', 'landedTrained', 'waved', 'asleep'];
  assert.deepStrictEqual(Object.keys(pools).sort(), expected.slice().sort());
  for (const [name, lines] of Object.entries(pools)) {
    assert.ok(lines.length >= 2, name + ' needs at least two lines so it does not repeat daily');
    // A resting line is a STATEMENT. It carries no CTA of its own, so a line that ends in a question
    // is asking for something the card gives no way to answer.
    for (const l of lines) assert.ok(!l.trim().endsWith("?'"), name + ' asks a question: ' + l);
  }
  // {n} is substituted with the streak, and only the streak pool is given one to substitute.
  for (const [name, lines] of Object.entries(pools)) {
    for (const l of lines) {
      if (name === 'landedStreak') continue;
      assert.ok(!l.includes('{n}'), name + ' has an unsubstituted placeholder: ' + l);
    }
  }
  assert.ok(pools.landedStreak.every(l => l.includes('{n}')),
    'every landedStreak line should name the run, that is the whole reason the pool exists');
});
