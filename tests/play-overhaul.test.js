'use strict';
// The Play overhaul's pure half: the boss that points at your worst habit, the charges today earns,
// and a shop catalogue with somewhere left to go.
const { test } = require('node:test');
const assert = require('node:assert');
const Game = require('../app/game.js');

const q = (o) => Object.assign({ logged: true, proteinHit: false, carbHit: false, fatHit: false, kcalIn: false, kcalOver: false, fiberHit: false, perfect: false }, o);

// ---- the boss is the macro you actually miss ----

test('the weakness is whichever macro is missed most', () => {
  // Protein every day, fibre almost never: the boss must ask for fibre.
  const days = Array.from({ length: 14 }, (_, i) => q({ proteinHit: true, carbHit: true, fatHit: true, fiberHit: i < 2 }));
  assert.strictEqual(Game.weakestMacro(days), 'fibre');
  // Flip it: fibre is fine, protein is the gap.
  const days2 = Array.from({ length: 14 }, (_, i) => q({ fiberHit: true, carbHit: true, fatHit: true, proteinHit: i < 3 }));
  assert.strictEqual(Game.weakestMacro(days2), 'protein');
});

test('unlogged days do not count against any macro', () => {
  // Someone who logged twice and hit protein both times has no protein problem, however many days
  // they missed entirely. Counting blank days as misses would point the boss at the wrong macro for
  // anyone who logs intermittently, which is most people early on.
  const days = [null, null, q({ proteinHit: true, fiberHit: true, carbHit: true }), null, q({ proteinHit: true, fiberHit: true, carbHit: true })];
  assert.strictEqual(Game.weakestMacro(days), 'fat');
});

test('a brand new user is asked for fibre, not nothing', () => {
  assert.strictEqual(Game.weakestMacro([]), 'fibre');
  assert.strictEqual(Game.weakestMacro([null, null]), 'fibre');
});

test('the weakness is stable, not a coin flip between equal macros', () => {
  // Two macros missed exactly as often must resolve the same way every render, or the boss flickers.
  const days = Array.from({ length: 8 }, () => q({ carbHit: true, fatHit: true }));
  const first = Game.weakestMacro(days);
  for (let i = 0; i < 20; i++) assert.strictEqual(Game.weakestMacro(days), first);
});

test('the plan counts this week and only goes live at three days', () => {
  const fortnight = Array.from({ length: 14 }, () => q({ proteinHit: true, carbHit: true, fatHit: true }));
  const week = [q({ fiberHit: true }), q({ fiberHit: true }), q({})];
  const p = Game.bossPlan(fortnight, week);
  assert.strictEqual(p.macro, 'fibre');
  assert.strictEqual(p.type, 'renew');
  assert.strictEqual(p.daysHit, 2);
  assert.strictEqual(p.live, false);
  assert.strictEqual(p.mult, 1);
  const p2 = Game.bossPlan(fortnight, week.concat([q({ fiberHit: true })]));
  assert.strictEqual(p2.daysHit, 3);
  assert.strictEqual(p2.live, true);
  assert.strictEqual(p2.mult, 1.35);
});

test('the week track cannot overflow its seven cells', () => {
  const week = Array.from({ length: 12 }, () => q({ fiberHit: true }));
  assert.strictEqual(Game.bossPlan([], week).daysHit, 7);
});

test('every macro maps to a fight type that exists', () => {
  Object.keys(Game.MACRO_TYPE).forEach(m => {
    assert.ok(Game.FIGHT_TYPES.indexOf(Game.MACRO_TYPE[m]) >= 0, m + ' maps to a type the fight does not have');
  });
});

test('the boss week runs out on Sunday, never to zero', () => {
  // 2026-08-10 is a Monday.
  assert.strictEqual(Game.bossDaysLeft('2026-08-10'), 7);
  assert.strictEqual(Game.bossDaysLeft('2026-08-15'), 2);
  assert.strictEqual(Game.bossDaysLeft('2026-08-16'), 1); // Sunday, the last day
});

// ---- charges, earned by today ----

test('charges come from today and nothing else', () => {
  assert.deepStrictEqual(Game.chargesToday(q({ proteinHit: true })), { power: true, heal: false, special: false, count: 1 });
  assert.deepStrictEqual(Game.chargesToday(q({ fiberHit: true })), { power: false, heal: true, special: false, count: 1 });
  const all = Game.chargesToday(q({ proteinHit: true, fiberHit: true, perfect: true }));
  assert.strictEqual(all.count, 3);
});

test('an unlogged day earns no charges and does not throw', () => {
  assert.strictEqual(Game.chargesToday(null).count, 0);
  assert.strictEqual(Game.chargesToday(undefined).count, 0);
});

test('every charge says what earns it', () => {
  assert.strictEqual(Game.CHARGE_META.length, 3);
  Game.CHARGE_META.forEach(c => {
    assert.ok(c.label && c.earn && c.need, c.key + ' is missing its copy');
    assert.ok(!/—/.test(c.earn + c.need), 'em dash in charge copy');
  });
});

// ---- the shop ----

test('the catalogue is big enough to outlast a month', () => {
  // The whole point of the overhaul: at ~30 Amber a day the old 2,000 Amber catalogue was gone in
  // a month. This asserts the shape of the fix, not an exact number.
  const total = Game.COSMETICS.reduce((n, c) => n + c.price, 0) + Game.HABITAT.reduce((n, h) => n + h.price, 0);
  assert.ok(total > 7000, 'catalogue is only worth ' + total + ' Amber');
  assert.ok(Game.COSMETICS.length + Game.HABITAT.length >= 40);
});

test('every slot has something in it, and the fight slots have a free default', () => {
  Game.COSMETIC_KINDS.forEach(k => {
    assert.ok(Game.cosmeticsOfKind(k).length >= 4, k + ' has too few items');
    assert.ok(Game.COSMETIC_KIND_META[k], k + ' has no label');
  });
  ['arena', 'flourish'].forEach(k => {
    const def = Game.COSMETIC_DEFAULT[k];
    assert.ok(def, k + ' needs a default so a fight is never unpainted');
    assert.strictEqual(Game.COSMETIC_BY_ID[def].price, 0, k + ' default must be free');
  });
});

test('every item is unique, priced and described', () => {
  const seen = new Set();
  Game.COSMETICS.concat(Game.HABITAT).forEach(c => {
    assert.ok(!seen.has(c.id), 'duplicate id ' + c.id);
    seen.add(c.id);
    assert.ok(typeof c.price === 'number' && c.price >= 0, c.id + ' has no price');
    assert.ok(c.desc && c.name, c.id + ' has no copy');
    assert.ok(!/—/.test(c.desc), 'em dash in ' + c.id);
  });
});

test('gates open only when they are earned', () => {
  assert.strictEqual(Game.gateMet(null, {}), true);
  assert.strictEqual(Game.gateMet('prestige1', { prestige: 0 }), false);
  assert.strictEqual(Game.gateMet('prestige1', { prestige: 1 }), true);
  assert.strictEqual(Game.gateMet('prestige2', { prestige: 1 }), false);
  assert.strictEqual(Game.gateMet('belt', { belt: true }), true);
  assert.strictEqual(Game.gateMet('founder', {}), false);
  // Every gate used in the catalogue must have a label, or the shop renders "undefined".
  Game.COSMETICS.filter(c => c.gate).forEach(c => assert.ok(Game.GATE_LABEL[c.gate], c.gate + ' has no label'));
});

test('the stall is stable within a week and moves between weeks', () => {
  const a = Game.weeklyStall('salt', '2026-08-10', []).map(i => i.id);
  assert.strictEqual(a.length, Game.STALL_SIZE);
  assert.deepStrictEqual(Game.weeklyStall('salt', '2026-08-10', []).map(i => i.id), a, 'the stall reshuffled inside one week');
  const b = Game.weeklyStall('salt', '2026-08-17', []).map(i => i.id);
  assert.notDeepStrictEqual(b, a, 'the stall never changes between weeks');
});

test('the stall never offers what you already own, or anything free', () => {
  const owned = Game.COSMETICS.slice(0, 20).map(c => c.id);
  const stall = Game.weeklyStall('salt', '2026-08-10', owned);
  stall.forEach(i => {
    assert.ok(owned.indexOf(i.id) < 0, 'the stall offered an owned item: ' + i.id);
    assert.ok(i.price > 0, 'the stall offered a free default: ' + i.id);
  });
});

test('the stall still fills up for someone who owns nearly everything', () => {
  const owned = Game.COSMETICS.map(c => c.id).slice(0, Game.COSMETICS.length - 3);
  const stall = Game.weeklyStall('salt', '2026-08-10', owned);
  assert.ok(stall.length >= 3, 'the stall emptied out instead of falling back to what is left');
});

test('the shop week turns over on a Monday', () => {
  assert.strictEqual(Game.shopWeekKey('2026-08-14'), '2026-08-10'); // Friday -> that Monday
  assert.strictEqual(Game.shopWeekKey('2026-08-10'), '2026-08-10');
  assert.strictEqual(Game.shopWeekKey('2026-08-16'), '2026-08-10'); // Sunday still that week
  assert.strictEqual(Game.stallDaysLeft('2026-08-16'), 1);
  assert.strictEqual(Game.stallDaysLeft('2026-08-10'), 7);
});

test('a habitat upgrade reads as a savings goal, not a wall', () => {
  const p = Game.habitatProgress([], 'hab_visitors', 640, 30);
  assert.strictEqual(p.owned, false);
  assert.ok(p.pct > 0.7 && p.pct < 1);
  assert.match(p.label, /640 of 800 · about \d+ days/);
  assert.strictEqual(Game.habitatProgress([], 'hab_wide', 500, 30).label, 'Affordable now');
  assert.strictEqual(Game.habitatProgress(['hab_wide'], 'hab_wide', 0, 30).owned, true);
});

test('a habitat estimate never divides by a zero earn rate', () => {
  const p = Game.habitatProgress([], 'hab_deep', 0, 0);
  assert.ok(Number.isFinite(parseInt(p.label.match(/about (\d+)/)[1], 10)));
});
