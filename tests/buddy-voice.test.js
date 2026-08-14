'use strict';
// The buddy's personality, finally audible. Every buddy has carried one of six personalities since
// it hatched and none of them ever changed a word on screen: the morning read and the recovery
// coach line were fixed strings, so a plucky dinosaur and a dozy one coached identically forever.
// These tests hold the two halves of the fix in place: the pools themselves (Game.buddySignoff,
// pure and requireable), and the fact that the coaching surfaces in app.jsx actually go through
// them rather than drifting back to a hardcoded tail.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Game = require('../app/game.js');

const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');
const PEOPLE = Object.keys(Game.VOICE_SIGNOFFS);
const DAY = '2026-08-14';

test('every personality can speak in every tone', () => {
  assert.ok(PEOPLE.length >= 6, 'the six seeded personalities all need lines');
  for (const p of PEOPLE) {
    for (const tone of Game.VOICE_TONES) {
      const pool = Game.VOICE_SIGNOFFS[p][tone];
      assert.ok(Array.isArray(pool) && pool.length >= 3, p + '/' + tone + ' needs at least three lines');
      for (const line of pool) {
        assert.ok(line && line.trim() === line, 'stray whitespace in ' + p + '/' + tone);
        assert.ok(/[.!?]$/.test(line), 'sign-offs are whole sentences: ' + line);
        // These are appended to a full sentence on a 390px screen, so length is a real constraint.
        assert.ok(line.length <= 48, 'too long to sit after a coaching sentence: ' + line);
      }
    }
  }
});

test('no em dash anywhere in the buddy voice', () => {
  // build.mjs throws on an em dash in the bundle, so this catches it at the source instead.
  for (const p of PEOPLE) {
    for (const tone of Game.VOICE_TONES) {
      for (const line of Game.VOICE_SIGNOFFS[p][tone]) assert.ok(!line.includes('—'), 'em dash in ' + line);
    }
  }
});

test('the same buddy on the same day says the same thing', () => {
  // A re-render must not reshuffle the line under the reader, and a screenshot of a day must repeat.
  for (const p of PEOPLE) {
    const once = Game.buddySignoff(p, 'cheer', 'salt-a', DAY, 0);
    assert.strictEqual(Game.buddySignoff(p, 'cheer', 'salt-a', DAY, 0), once);
  }
});

test('different buddies do not all say the same thing', () => {
  // The whole point: the voice has to actually vary by who your dinosaur is.
  const said = new Set(PEOPLE.map(p => Game.buddySignoff(p, 'cheer', 'salt-a', DAY, 0)));
  assert.ok(said.size >= 4, 'six personalities produced ' + said.size + ' distinct lines');
});

test('the line moves from day to day', () => {
  const week = new Set();
  for (let i = 0; i < 7; i++) week.add(Game.buddySignoff('plucky', 'steady', 'salt-a', '2026-08-0' + (i + 1), 0));
  assert.ok(week.size >= 2, 'a week of mornings read as the same sentence every time');
});

test('one read never repeats itself, whatever the seed', () => {
  // Sleep and steps can both be gentle news on the same morning (short night, missed goal). Hearing
  // the identical sign-off twice on one small screen is the canned feeling this set out to remove.
  for (const p of PEOPLE) {
    for (const tone of Game.VOICE_TONES) {
      for (let d = 1; d <= 28; d++) {
        const day = '2026-08-' + String(d).padStart(2, '0');
        const lines = [0, 1, 2].map(slot => Game.buddySignoff(p, tone, 'salt-' + d, day, slot));
        assert.strictEqual(new Set(lines).size, 3, 'repeated sign-off in one read: ' + p + '/' + tone + ' on ' + day);
      }
    }
  }
});

test('an unknown or missing personality still gets a voice', () => {
  // Accounts that predate the personality seed, and any future key, must never render "undefined".
  for (const p of [undefined, null, '', 'nonesuch']) {
    const line = Game.buddySignoff(p, 'cheer', 'salt-a', DAY, 0);
    assert.ok(line && typeof line === 'string', 'no line for personality ' + JSON.stringify(p));
  }
  assert.ok(Game.buddySignoff('plucky', 'nonesuch', 'salt-a', DAY, 0), 'an unknown tone still speaks');
});

test('both coaching surfaces speak through the buddy, not a fixed tail', () => {
  // The regression this guards: someone edits a coaching line and hardcodes the encouragement back
  // in, and the personality silently stops mattering again.
  const coach = SRC.slice(SRC.indexOf('function recoveryCoachLine('), SRC.indexOf('function readinessRecap('));
  const recap = SRC.slice(SRC.indexOf('function readinessRecap('), SRC.indexOf('function BuddyReadinessSheet('));
  assert.ok((coach.match(/buddySay\(/g) || []).length >= 3, 'a readiness band coaches without the buddy');
  assert.ok((recap.match(/buddySay\(/g) || []).length >= 3, 'a morning read line coaches without the buddy');
  // The old fixed tails, by name, so they cannot creep back.
  for (const dead of ["I'm right behind you", 'Go get it', 'I like you rested, let', 'Keep that up and I grow strong']) {
    assert.ok(!SRC.includes(dead), 'a fixed encouragement tail is back: ' + dead);
  }
});
