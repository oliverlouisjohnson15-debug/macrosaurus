'use strict';
// The buddy's animation decision. This used to be spread across four components, each with its own
// idea of what to do when a strip was missing, and the failure mode was silent: a flourish armed on
// an animation the species did not own would wait forever for an onEnd that never fired, and the
// buddy would freeze mid-pose until something else re-rendered it. Two properties keep that shut:
// every request degrades to a strip that exists, and the ladder is TOTAL (there is always an answer).
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const Game = require('../app/game.js');
const MANIFEST = JSON.parse(readFileSync(path.join(__dirname, '..', 'sprites', 'manifest.json'), 'utf8'));
const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');

test('the ladder is total: every state gets a resting animation', () => {
  const states = [
    {}, { asleep: true }, { stuffed: true }, { dayState: 'hungry' }, { dayState: 'open' },
    { dayState: 'done' }, { dayState: 'back' }, { dayState: 'full' }, { dayState: 'nonsense' },
    { reaction: 'eat' }, { asleep: true, stuffed: true }, { reaction: 'cheer', asleep: true },
  ];
  for (const st of states) {
    const a = Game.buddyAnim(st);
    assert.ok(a && typeof a.rest === 'string' && a.rest, 'no rest animation for ' + JSON.stringify(st));
  }
});

test('a reaction outranks everything and plays exactly once', () => {
  const a = Game.buddyAnim({ reaction: 'eat', asleep: true, stuffed: true, dayState: 'done' });
  assert.equal(a.rest, 'eat');
  assert.equal(a.once, true);
  assert.equal(a.flourish, null, 'a one-shot must not also arm a flourish');
});

test('asleep and stuffed are rests, not flourishes, and hold still', () => {
  const s = Game.buddyAnim({ asleep: true, dayState: 'done' });
  assert.equal(s.rest, 'sleep');
  assert.equal(s.still, true);
  assert.equal(s.flourish, null, 'a sleeping buddy must not periodically jog on the spot');
  const f = Game.buddyAnim({ stuffed: true, dayState: 'done' });
  assert.equal(f.rest, 'coma');
  assert.equal(f.still, true);
  assert.equal(f.flourish, null);
});

test('an over-eaten day rests on coma rather than flourishing', () => {
  // 'full' deliberately has no flourish: the coma pose IS the statement.
  assert.equal(Game.DAY_FLOURISH.full, null);
  assert.equal(Game.buddyAnim({ dayState: 'full', stuffed: true }).rest, 'coma');
});

test('every fallback chain ends at idle and cannot loop forever', () => {
  for (const anim of Object.keys(Game.ANIM_FALLBACK).concat(['idle', 'nonsense', ''])) {
    const chain = Game.animChain(anim);
    assert.equal(chain[chain.length - 1], 'idle', anim + ' does not degrade to idle');
    assert.equal(new Set(chain).size, chain.length, anim + ' repeats a step, so the walk could cycle');
  }
});

test('every animation the decision layer can ask for exists in the art', () => {
  // The one that actually bites: buddyAnim naming a strip the forge never generated.
  const asked = new Set(Object.values(Game.DAY_FLOURISH).filter(Boolean).concat(['idle', 'sleep', 'coma']));
  for (const a of asked) assert.ok(MANIFEST.frames['base/' + a], 'base/' + a + ' is asked for but not on disk');
});

test('the female colourway can serve every animation, for every species', () => {
  // The female colourway is the guaranteed floor the resolver falls back to, so it has to be
  // complete: if it ever gains a gap, the last fallback stops being a fallback.
  const species = [...new Set(Object.keys(MANIFEST.frames).length && ['doux', 'cole', 'kira', 'kuro',
    'loki', 'mono', 'mort', 'nico', 'olaf', 'sena', 'tard', 'vita'])];
  for (const sp of species) {
    const gaps = MANIFEST.missing['female/' + sp] || [];
    for (const anim of Object.keys(Game.ANIM_FALLBACK)) {
      const landed = Game.animChain(anim).find(a => MANIFEST.frames['base/' + a] && !gaps.includes('base/' + a));
      assert.ok(landed, anim + ' has no reachable strip on female/' + sp);
    }
  }
});

test('a colourway missing the whole body falls back to female, not to a 404', () => {
  // male/doux never shipped a body at all, so walking the animation chain alone dead-ends: it lacks
  // eat, move AND idle. The resolver needs the second, palette-level fallback.
  const gaps = MANIFEST.missing['male/doux'] || [];
  assert.ok(gaps.includes('base/idle'), 'fixture assumption changed: male/doux now has an idle');
  assert.ok(Game.animChain('eat').every(a => gaps.includes('base/' + a)),
    'fixture assumption changed: the eat chain now resolves on male/doux by itself');
  assert.ok(/const tries = palette === 'female' \? \['female'\] : \[palette, 'female'\]/.test(SRC),
    'resolveSprite lost its palette fallback, so incomplete colourways will render empty boxes');
});

test('the manifest is generated, not hand-written', () => {
  // The old SPRITE_FRAMES/SPRITE_INCOMPLETE_MALE constants were a claim about disk that could drift.
  assert.ok(!/const SPRITE_FRAMES\s*=/.test(SRC), 'SPRITE_FRAMES is back; frame counts must come from the manifest');
  assert.ok(/SPRITE_MANIFEST/.test(SRC), 'app.jsx no longer reads the manifest');
  const gen = readFileSync(path.join(__dirname, '..', 'app', 'src', 'sprite-manifest.js'), 'utf8');
  assert.ok(/GENERATED by tools\/gen-anim\.mjs/.test(gen), 'sprite-manifest.js lost its generated header');
  assert.ok(!/—/.test(gen), 'em dash in a bundled file; build.mjs rejects it');
});

test('the reaction queue is bounded and drops immediate repeats', () => {
  // A recipe logging six ingredients fires six reactions; the buddy should acknowledge, not chew
  // for six seconds. Checked in source because the queue is a React hook.
  assert.ok(/REACT_QUEUE_MAX/.test(SRC), 'the reaction queue lost its cap');
  assert.ok(/q\[q\.length - 1\] === anim/.test(SRC), 'the queue no longer collapses repeated reactions');
});

test('night is the clock, and it is not the lapse nap', () => {
  assert.equal(Game.isNight(23), true);
  assert.equal(Game.isNight(2), true);
  assert.equal(Game.isNight(5), true);
  assert.equal(Game.isNight(6), false, 'the wake hour is awake');
  assert.equal(Game.isNight(14), false);
  assert.equal(Game.isNight(21), false);
  assert.equal(Game.isNight(22), true, 'the sleep hour is asleep');
  // The two states share an animation but nothing else: `asleep` means you lapsed, `night` means it
  // is 10pm. Only buddyAnim may see `night`; buddyMood and the coach line must never.
  const n = Game.buddyAnim({ night: true, dayState: 'done' });
  assert.equal(n.rest, 'sleep');
  assert.equal(n.still, true);
  assert.equal(n.flourish, null);
  assert.equal(Game.buddyMood(false, true, { perfect: true }), 'thriving',
    'night must not be able to reach buddyMood');
});

test('a late meal still gets a reaction', () => {
  // The whole point of eat is the moment you log. Sleeping through it would be the one regression
  // that makes the animation pointless for anyone who eats dinner after ten.
  const a = Game.buddyAnim({ night: true, reaction: 'eat' });
  assert.equal(a.rest, 'eat');
  assert.equal(a.once, true);
});

test('the buddy responds to the box underneath it', () => {
  // tilt = a question of its own still unanswered; point = it said something with a button on it.
  // Both outrank the ambient day-state flourish, because both are about the user, not the day.
  assert.equal(Game.buddyAnim({ asking: true, dayState: 'open' }).flourish, 'tilt');
  assert.equal(Game.buddyAnim({ pointing: true, dayState: 'open' }).flourish, 'point');
  assert.equal(Game.buddyAnim({ asking: true, pointing: true }).flourish, 'tilt', 'a question beats a button');
  assert.equal(Game.buddyAnim({ dayState: 'open' }).flourish, 'move', 'no message, ambient flourish');
});

test('speaking is a rest, and loses to the states that are not negotiable', () => {
  assert.equal(Game.buddyAnim({ speaking: true }).rest, 'talk');
  assert.equal(Game.buddyAnim({ speaking: true }).once, false, 'the jaw loops, it is not a one-shot');
  for (const st of [{ asleep: true }, { night: true }, { sad: true }, { stuffed: true }]) {
    const a = Game.buddyAnim(Object.assign({ speaking: true }, st));
    assert.notEqual(a.rest, 'talk', 'talk must not override ' + JSON.stringify(st));
  }
});

test('the blink only fills a plain idle', () => {
  assert.equal(Game.buddyAnim({}).micro, 'blink');
  assert.equal(Game.buddyAnim({ dayState: 'hungry' }).micro, 'blink');
  for (const st of [{ asleep: true }, { night: true }, { sad: true }, { stuffed: true },
    { speaking: true }, { reaction: 'eat' }]) {
    assert.equal(Game.buddyAnim(st).micro, null, 'blinking through ' + JSON.stringify(st));
  }
});

test('sad is for a paused account, never for a bad day', () => {
  assert.equal(Game.buddyAnim({ sad: true }).rest, 'sad');
  assert.equal(Game.buddyAnim({ sad: true }).still, true);
  // The states that mean "today went badly" must not reach it.
  assert.notEqual(Game.buddyAnim({ dayState: 'full', stuffed: true }).rest, 'sad');
  assert.notEqual(Game.buddyAnim({ dayState: 'hungry' }).rest, 'sad');
  assert.ok(/const sad = !asleep && !!db\.paused/.test(SRC), 'sad is no longer wired to the paused account');
});

test('the coma reads dayState, not the mood that hides it', () => {
  // buddyMood ranks 'content' above 'stuffed', so an over-calorie day that hit its protein never
  // reported as stuffed and the pose never played. dayState.full is the honest test.
  assert.equal(Game.buddyMood(false, true, { kcalOver: true, proteinHit: true, kcalIn: true }), 'content',
    'fixture assumption changed: buddyMood no longer hides stuffed behind content');
  assert.ok(/const stuffed = !asleep && bp\.dayState === 'full'/.test(SRC),
    'stuffed is keyed on the mood again, which reopens the hole where a big day animates nothing');
});

test('a one-shot cannot get stuck', () => {
  // The sprite is keyed on the animation NAME, so a reaction whose animationend is dropped (an
  // offscreen or backgrounded tab) can never replay to fire a second one: it freezes mid-pose.
  // Observed holding a `nod` indefinitely. A watchdog ends it, and the drain is idempotent so the
  // event and the timer cannot consume two reactions between them.
  assert.ok(/WATCHDOG/.test(SRC), 'the reaction watchdog is gone; a dropped animationend will stick');
  assert.ok(/setTimeout\(\(\) => reactionDone\(reaction\), ms\)/.test(SRC), 'the watchdog no longer drains the queue');
  assert.ok(/!q\.length \|\| \(anim && q\[0\] !== anim\)/.test(SRC),
    'the drain is unconditional again, so two finishers would swallow the next reaction');
});
