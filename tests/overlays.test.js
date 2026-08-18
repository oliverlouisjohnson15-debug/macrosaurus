'use strict';
// Overlay layering.
//
// Written after "I can't copy meals to another day, the buttons are broken". Nothing about the copy
// screen was wrong: it opened, it drew the calendar, and its handlers were sound. The toast left
// over from the PREVIOUS copy - "1 item copied to tomorrow", five seconds on screen, and copying to
// several days in a row is the whole reason the feature exists - was a full-width fixed strip
// sitting at the same z as the sheet. A tie is broken by document order and the toast is mounted at
// the root, below every screen, so it won, and the row of days underneath it took every tap.
//
// Two rules come out of that, and both are checked here against the real source rather than against
// a rendered screen, because the bug is in the numbers, not in the markup.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');

// The toast's own layer, read from the component so this test cannot drift from it.
const toastStart = SRC.indexOf('function Toast({');
const toastBlock = SRC.slice(toastStart, SRC.indexOf('\n}', toastStart));
const toastZ = Number((toastBlock.match(/className="fixed left-0 right-0 z-\[(\d+)\]/) || [])[1]);

test('the toast has a layer of its own to be measured against', () => {
  assert.ok(Number.isFinite(toastZ), 'could not read the toast z-index out of Toast()');
});

test('the toast is above the whole sheet ladder, not somewhere inside it', () => {
  // Sheets run 50-to-95 so one opened from another lands above its parent. A toast pitched inside
  // that range covers some screens and not others, and covers a screen level with it by document
  // order alone - which is precisely how a working calendar came to have a dead row of days.
  const zs = [...SRC.matchAll(/<Sheet\b[^>]*?\bz=\{(\d+)\}/g)].map(m => Number(m[1]));
  assert.ok(zs.length > 20, 'expected to find the app\'s sheets, found ' + zs.length);
  const over = zs.filter(z => z >= toastZ);
  assert.equal(over.length, 0, 'sheet(s) at or above the toast\'s z-' + toastZ + ': ' + over.join(', '));
});

test('the toast cannot take a tap meant for anything under it', () => {
  // It spans the full width of the screen, so everything but its own controls must be transparent.
  assert.ok(/className="fixed left-0 right-0 z-\[\d+\] flex justify-center px-4 pointer-events-none"/.test(toastBlock),
    'the toast wrapper must be pointer-events-none');
  const buttons = toastBlock.match(/<button[^>]*>/g) || [];
  assert.ok(buttons.length >= 3, 'expected the toast\'s action, second action and dismiss buttons');
  for (const b of buttons) {
    assert.ok(/pointer-events-auto/.test(b), 'a toast button must take its own taps back: ' + b.slice(0, 80));
  }
});
