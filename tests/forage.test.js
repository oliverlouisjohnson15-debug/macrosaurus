'use strict';
// Foraging is the one loop in the app whose state changes while nobody is looking, which makes it
// the one loop where a bug is invisible until someone has already lost a reward. The rules that
// matter are all about what CANNOT happen: a trip cannot be started on a day that was not earned,
// a trip cannot be lost by closing the app, and the reward cannot be claimed twice.
const { test } = require('node:test');
const assert = require('node:assert');
const Game = require('../app/game.js');

const T = '2026-08-10';
const NOON = new Date(T + 'T12:00:00Z').getTime();
const HOUR = 3600 * 1000;

test('no trip is offered on a day that has not landed', () => {
  const v = Game.forageView(null, NOON, { today: T, landed: false });
  assert.equal(v.status, 'idle');
});

test('a landed day offers a trip', () => {
  const v = Game.forageView(null, NOON, { today: T, landed: true });
  assert.equal(v.status, 'ready');
});

test('a sent buddy is away until its return time, then back', () => {
  const f = Game.forageStart(T, NOON);
  assert.equal(f.date, T);
  assert.equal(f.claimed, false);
  assert.equal(f.returnsAt, NOON + Game.FORAGE_MS);

  const away = Game.forageView(f, NOON + HOUR, { today: T, landed: true });
  assert.equal(away.status, 'away');
  assert.ok(away.msLeft > 0, 'away should report time remaining');

  const back = Game.forageView(f, NOON + Game.FORAGE_MS, { today: T, landed: true });
  assert.equal(back.status, 'back');
  assert.equal(back.amber, Game.AMBER_REWARDS.forage);
});

test('a trip cannot be lost by not looking: back waits indefinitely', () => {
  const f = Game.forageStart(T, NOON);
  // A week later, still unclaimed, still on the same calendar day record.
  const late = Game.forageView(f, NOON + 7 * 24 * HOUR, { today: T, landed: true });
  assert.equal(late.status, 'back', 'an unclaimed trip must never expire');
});

test('claiming settles the day, and a landed day does not re-offer', () => {
  const f = Object.assign(Game.forageStart(T, NOON), { claimed: true });
  const v = Game.forageView(f, NOON + Game.FORAGE_MS, { today: T, landed: true });
  assert.equal(v.status, 'done', 'one trip per day, even if the day is still landed');
});

test('yesterday\'s record does not block today, and does not pay out today', () => {
  const yday = Object.assign(Game.forageStart('2026-08-09', NOON - 24 * HOUR), { claimed: false });
  // Unclaimed, but from a previous day: today gets its own offer rather than yesterday's payout.
  const v = Game.forageView(yday, NOON, { today: T, landed: true });
  assert.equal(v.status, 'ready');
  // And on a day that has not landed, a stale record still offers nothing.
  const idle = Game.forageView(yday, NOON, { today: T, landed: false });
  assert.equal(idle.status, 'idle');
});

test('the duration is overridable, so the demo switch cannot drift from the real clock', () => {
  const f = Game.forageStart(T, NOON, 20 * 1000);
  assert.equal(f.returnsAt, NOON + 20 * 1000);
  assert.equal(Game.forageView(f, NOON + 5 * 1000, { today: T, landed: true }).status, 'away');
  assert.equal(Game.forageView(f, NOON + 21 * 1000, { today: T, landed: true }).status, 'back');
});

test('a missing or malformed record is idle, never a crash', () => {
  assert.equal(Game.forageView(undefined, NOON, { today: T, landed: false }).status, 'idle');
  assert.equal(Game.forageView({}, NOON, { today: T, landed: false }).status, 'idle');
  // A record for today with no returnsAt reads as already back rather than stranding the buddy.
  assert.equal(Game.forageView({ date: T }, NOON, { today: T, landed: true }).status, 'back');
});
