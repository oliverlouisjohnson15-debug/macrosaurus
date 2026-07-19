'use strict';
// Tests for the pure gamification module (app/game.js): streaks that count weigh-in
// days, buddy high-water/wake logic, badge tiers, per-user seeding, check-in rewards
// and fight-attempt gating. Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Game = require('../app/game.js');

// ---- computeStreak: a day counts if it has food logs OR a weigh-in ----

test('streak counts weigh-in-only days as active', () => {
  // 8th logged, 9th weigh-in only, 10th logged: 3-day streak
  const active = new Set(['2026-07-08', '2026-07-09', '2026-07-10']);
  const r = Game.computeStreak(active, new Set(), '2026-07-10');
  assert.strictEqual(r.streak, 3);
  assert.deepStrictEqual(r.newFrozen, []);
});

test('streak still applies the monthly freeze across a single missed day', () => {
  const active = new Set(['2026-07-07', '2026-07-08', '2026-07-10']); // missed the 9th
  const r = Game.computeStreak(active, new Set(), '2026-07-10');
  assert.strictEqual(r.streak, 4); // 7,8,frozen 9,10
  assert.deepStrictEqual(r.newFrozen, ['2026-07-09']);
});

test('streak breaks after a second miss in the same month', () => {
  const active = new Set(['2026-07-05', '2026-07-06', '2026-07-08', '2026-07-10']);
  const r = Game.computeStreak(active, new Set(), '2026-07-10');
  assert.strictEqual(r.streak, 3); // 10, frozen 9, 8, then the missed 7th cannot be frozen again
  assert.deepStrictEqual(r.newFrozen, ['2026-07-09']);
});

test('freezeReady is false once a date this month is frozen', () => {
  assert.strictEqual(Game.freezeReady(new Set(['2026-07-03']), '2026-07-10'), false);
  assert.strictEqual(Game.freezeReady(new Set(['2026-06-03']), '2026-07-10'), true);
});

// ---- buddy: high-water stage, naps instead of resetting, wakes after 3 active days ----

test('buddy stage ratchets up with the streak', () => {
  assert.strictEqual(Game.stageIndex(0), 0);
  assert.strictEqual(Game.stageIndex(7), 3);
  assert.strictEqual(Game.stageIndex(30), 5);
  const v = Game.buddyView(0, 14);
  assert.strictEqual(v.stage, 4);
  assert.strictEqual(v.asleep, false);
  assert.strictEqual(v.ratchet, true);
});

test('a broken streak naps the buddy at its high-water stage, never back to the egg', () => {
  const v = Game.buddyView(4, 0); // was Veloci (stage 4), streak just broke
  assert.strictEqual(v.stage, 4); // still shows the high-water stage
  assert.strictEqual(v.asleep, true);
  assert.strictEqual(v.wakeIn, 3);
});

test('buddy wakes after 3 active days since the break', () => {
  assert.strictEqual(Game.buddyView(4, 2).asleep, true);
  assert.strictEqual(Game.buddyView(4, 2).wakeIn, 1);
  const awake = Game.buddyView(4, 3);
  assert.strictEqual(awake.asleep, false);
  assert.strictEqual(awake.stage, 4); // wakes back at the high-water stage
  assert.strictEqual(awake.ratchet, false); // streak 3 does not beat high water 4
});

test('stage never falls even while the current run is lower', () => {
  const v = Game.buddyView(5, 8); // high water Rexosaur, current run only stage 3
  assert.strictEqual(v.stage, 5);
  assert.strictEqual(v.asleep, false); // 8 active days, long since awake
});

// ---- badge tiers ----

test('badge tiers step through 1/3/6/12/24', () => {
  assert.strictEqual(Game.badgeTier(0).level, 0);
  assert.strictEqual(Game.badgeTier(1).level, 1);
  assert.strictEqual(Game.badgeTier(5).level, 2);
  assert.strictEqual(Game.badgeTier(5).next, 6);
  assert.strictEqual(Game.badgeTier(24).level, 5);
  assert.strictEqual(Game.badgeTier(99).next, null);
  assert.strictEqual(Game.badgeTier(99).progress, 1);
});

test('badge progress is a sane fraction toward the next tier', () => {
  const t = Game.badgeTier(9); // between 6 and 12
  assert.strictEqual(t.level, 3);
  assert.ok(t.progress > 0.4 && t.progress < 0.6);
});

// ---- per-user seeding ----

test('seeds are deterministic per user+date and diverge between users', () => {
  assert.strictEqual(Game.seedFor('salty', '2026-07-10'), Game.seedFor('salty', '2026-07-10'));
  assert.notStrictEqual(Game.seedFor('salty', '2026-07-10'), Game.seedFor('salty', '2026-07-11'));
  assert.notStrictEqual(Game.seedFor('userA', '2026-07-10'), Game.seedFor('userB', '2026-07-10'));
  // empty salt reproduces the legacy date-only hash so pre-salt accounts do not shift
  assert.strictEqual(Game.seedFor('', '2026-07-10'), Game.hash('2026-07-10'));
});

// ---- check-in guaranteed catch ----

test('check-in catch is deterministic and always at least rare-eligible', () => {
  const a = Game.checkinCatch('salt1', '2026-07-10');
  assert.deepStrictEqual(a, Game.checkinCatch('salt1', '2026-07-10'));
  const eligible = Game.CHECKIN_POOL.concat(['rexosaur']);
  for (let i = 1; i <= 40; i++) {
    const d = '2026-07-' + String((i % 28) + 1).padStart(2, '0');
    const c = Game.checkinCatch('u' + i, d);
    assert.ok(eligible.includes(c.id), 'unexpected id ' + c.id);
    assert.strictEqual(typeof c.shiny, 'boolean');
  }
});

// ---- fight gating: one ladder attempt per logged day ----

test('fight gate needs a food log today and one attempt per day', () => {
  const today = '2026-07-10';
  assert.deepStrictEqual(Game.fightGate(null, false, today), { can: false, reason: 'nolog' });
  assert.deepStrictEqual(Game.fightGate(null, true, today), { can: true, reason: null });
  assert.deepStrictEqual(Game.fightGate('2026-07-10', true, today), { can: false, reason: 'used' });
  // yesterday's attempt does not block today
  assert.deepStrictEqual(Game.fightGate('2026-07-09', true, today), { can: true, reason: null });
});

// ---- check-in chain + in-range maths ----

test('check-in chain counts trailing check-ins at most 9 days apart', () => {
  assert.strictEqual(Game.checkinChainLen([]), 0);
  assert.strictEqual(Game.checkinChainLen(['2026-07-10']), 1);
  assert.strictEqual(Game.checkinChainLen(['2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10']), 4);
  // a 12-day gap breaks the chain
  assert.strictEqual(Game.checkinChainLen(['2026-06-14', '2026-06-26', '2026-07-03', '2026-07-10']), 3);
});

test('in-range check-in means within 0.1 kg/wk of the target rate', () => {
  assert.strictEqual(Game.checkinInRange(-0.45, -0.5), true);
  assert.strictEqual(Game.checkinInRange(-0.75, -0.5), false);
  assert.strictEqual(Game.checkinInRange(0.05, 0), true); // hold on goal
  assert.strictEqual(Game.checkinInRange(null, -0.5), false);
});

// ---- migratory month counting ----

test('monthlyLogCount counts unique dates inside the calendar month', () => {
  const dates = ['2026-07-01', '2026-07-01', '2026-07-02', '2026-06-30', '2026-08-01'];
  assert.strictEqual(Game.monthlyLogCount(dates, '2026-07'), 2);
  assert.strictEqual(Game.monthlyLogCount(dates, '2026-06'), 1);
  assert.strictEqual(Game.monthlyLogCount([], '2026-07'), 0);
});

// ---- store migration of the new gamification fields ----

test('existing persisted state migrates with sensible gamification defaults', () => {
  const Store = require('../app/store.js');
  // An old state shape: fight without lastAttemptDate, no salt/badges/buddy/records.
  const s = Store.migrate({
    profile: { goalType: 'cut' },
    fight: { rank: 4, wins: 9, trophies: 1, lastBossWeek: '2026-27', prestige: 0 },
    catch_log: { '2026-07-01': [{ id: 'nugg', shiny: false }] },
  });
  assert.strictEqual(s.fight.rank, 4);                 // existing progress preserved
  assert.strictEqual(s.fight.lastAttemptDate, null);   // new gate field backfilled
  assert.strictEqual(s.game_salt, null);               // minted lazily on first run
  assert.deepStrictEqual(s.badges, { checkins: 0, inRange: 0 });
  assert.deepStrictEqual(s.buddy, { stage: 0, name: '', personality: '', hatchedISO: null, speciesId: null, evoStage: 0, affinity: null });
  assert.deepStrictEqual(s.records, { longestStreak: 0 });
  assert.strictEqual(s.catch_log['2026-07-01'][0].id, 'nugg'); // locked catches untouched
});

// ---- Weekly Breakthrough: rolling 7-stamp meter, one stamp per logged day ----

test('breakthrough meter starts empty at the baseline', () => {
  const s = Game.breakthroughState(40, 40); // existing user, base set to current count
  assert.strictEqual(s.stamps, 0);
  assert.strictEqual(s.breakthroughs, 0);
  assert.strictEqual(s.toNext, 7);
});

test('breakthrough meter fills one stamp per logged day past the baseline', () => {
  const s = Game.breakthroughState(43, 40); // 3 logged days since baseline
  assert.strictEqual(s.stamps, 3);
  assert.strictEqual(s.breakthroughs, 0);
  assert.strictEqual(s.toNext, 4);
});

test('a breakthrough unlocks every 7 logged days and the meter rolls over', () => {
  const s = Game.breakthroughState(47, 40); // 7 logged days since baseline
  assert.strictEqual(s.breakthroughs, 1);
  assert.strictEqual(s.stamps, 0);
  assert.strictEqual(s.toNext, 7);
  const s2 = Game.breakthroughState(55, 40); // 15 days -> 2 breakthroughs, 1 into the next
  assert.strictEqual(s2.breakthroughs, 2);
  assert.strictEqual(s2.stamps, 1);
});

test('breakthrough state is safe for a brand-new user with no baseline yet', () => {
  const s = Game.breakthroughState(0, 0);
  assert.strictEqual(s.stamps, 0);
  assert.strictEqual(s.breakthroughs, 0);
});

test('breakthroughCatch is a rare-or-better creature, deterministic per user and index', () => {
  const rarePlus = new Set(['flexor', 'veloci', 'platealon', 'triceros', 'rexosaur']);
  const a = Game.breakthroughCatch('saltA', 1);
  const b = Game.breakthroughCatch('saltA', 1);
  assert.deepStrictEqual(a, b); // stable for the same user + index
  assert.ok(rarePlus.has(a.id));
  // different indices and users draw independently
  for (let n = 1; n <= 12; n++) {
    assert.ok(rarePlus.has(Game.breakthroughCatch('saltB', n).id));
  }
});

// ---- Egg incubation: quality-day distance, tiered hatches ----

test('egg progress reports steps, ready and remaining against its tier', () => {
  assert.deepStrictEqual(Game.eggProgress(0, 5), { steps: 0, tier: 5, ready: false, toGo: 5 });
  assert.deepStrictEqual(Game.eggProgress(3, 5), { steps: 3, tier: 5, ready: false, toGo: 2 });
  assert.deepStrictEqual(Game.eggProgress(5, 5), { steps: 5, tier: 5, ready: true, toGo: 0 });
  assert.deepStrictEqual(Game.eggProgress(9, 5), { steps: 5, tier: 5, ready: true, toGo: 0 }); // steps clamp at tier
});

test('nextEggTier only ever returns a valid tier and is deterministic', () => {
  const valid = new Set(Game.EGG_TIERS);
  for (let n = 0; n < 40; n++) {
    const t = Game.nextEggTier('saltA', n);
    assert.ok(valid.has(t));
    assert.strictEqual(t, Game.nextEggTier('saltA', n)); // stable
  }
});

test('eggHatch draws from the tier pool and a 10-day egg can crack a legendary', () => {
  const pool2 = new Set(['dinky', 'pebble', 'protops', 'carbo', 'fatzilla', 'sprowl']);
  for (let n = 0; n < 20; n++) assert.ok(pool2.has(Game.eggHatch('s', 2, n).id));
  const tenIds = new Set();
  for (let n = 0; n < 60; n++) tenIds.add(Game.eggHatch('s', 10, n).id);
  assert.ok([...tenIds].every(id => new Set(['veloci', 'platealon', 'triceros', 'flexor', 'rexosaur']).has(id)));
  assert.ok(tenIds.has('rexosaur')); // the occasional legendary shows up across the run
  assert.deepStrictEqual(Game.eggHatch('s', 5, 3), Game.eggHatch('s', 5, 3)); // deterministic
});

// ---- buddy bond / mood / needs (the companion layer) ----

const PERFECT = { logged: true, proteinHit: true, carbHit: true, fatHit: true, kcalIn: true, fiberHit: true, perfect: true };
const LOGGED_ONLY = { logged: true, proteinHit: false, carbHit: false, fatHit: false, kcalIn: false, fiberHit: false, perfect: false };
const PROTEIN_KCAL = { logged: true, proteinHit: true, carbHit: false, fatHit: false, kcalIn: true, fiberHit: false, perfect: false };

test('buddyBond: no history is a cold start', () => {
  const b = Game.buddyBond([]);
  assert.strictEqual(b.score, 0);
  assert.strictEqual(b.hearts, 0);
  assert.strictEqual(b.maxHearts, 4);
});

test('buddyBond: a month of perfect days maxes the bond', () => {
  const b = Game.buddyBond(Array(30).fill(PERFECT));
  assert.strictEqual(b.score, 100);
  assert.strictEqual(b.hearts, 4);
  assert.strictEqual(b.toNext, 0);
});

test('buddyBond: showing up but eating poorly earns some warmth, not all', () => {
  const b = Game.buddyBond(Array(10).fill(LOGGED_ONLY)); // 1 of 4 pts/day => score 25
  assert.strictEqual(b.score, 25);
  assert.strictEqual(b.hearts, 1);
});

test('buddyBond: missed days (null) cool the bond', () => {
  const half = [].concat(Array(15).fill(PERFECT), Array(15).fill(null));
  const b = Game.buddyBond(half); // 15*4 / (30*4) => 50
  assert.strictEqual(b.score, 50);
  assert.strictEqual(b.hearts, 2);
});

test('buddyBond: only the trailing window counts', () => {
  const b = Game.buddyBond([].concat(Array(40).fill(null), Array(30).fill(PERFECT)));
  assert.strictEqual(b.score, 100); // the 40 old misses fall outside the 30-day window
});

test('buddyMood: reads nap, lapse and today\'s eating', () => {
  assert.strictEqual(Game.buddyMood(true, true, PERFECT), 'asleep');
  assert.strictEqual(Game.buddyMood(false, false, null), 'sluggish');
  assert.strictEqual(Game.buddyMood(false, true, PERFECT), 'thriving');
  assert.strictEqual(Game.buddyMood(false, true, PROTEIN_KCAL), 'content');
  assert.strictEqual(Game.buddyMood(false, true, LOGGED_ONLY), 'peckish');
});

test('buddyNeeds: fed, nourished and energy track behaviour', () => {
  const full = Game.buddyNeeds(true, PERFECT, 7);
  assert.strictEqual(full.hunger, 1);
  assert.strictEqual(full.nourish, 1);
  assert.strictEqual(full.energy, 1);
  const none = Game.buddyNeeds(false, null, 0);
  assert.ok(none.hunger < 0.2 && none.nourish === 0 && none.energy === 0);
  assert.strictEqual(Game.buddyNeeds(true, PROTEIN_KCAL, 3).nourish, 2 / 5);
});

// ---- buddy evolution: gated by BOTH cumulative quality days and bond hearts ----

test('buddyEvoStage: needs both the days and the hearts, sequentially', () => {
  const ats = [5, 10], req = [2, 3];
  assert.strictEqual(Game.buddyEvoStage(0, 4, ats, req), 0);   // no days yet
  assert.strictEqual(Game.buddyEvoStage(6, 1, ats, req), 0);   // days ok but bond too cold
  assert.strictEqual(Game.buddyEvoStage(6, 2, ats, req), 1);   // first evolution unlocked
  assert.strictEqual(Game.buddyEvoStage(12, 2, ats, req), 1);  // days for stage 2 but only 2 hearts
  assert.strictEqual(Game.buddyEvoStage(12, 3, ats, req), 2);  // both conditions -> fully evolved
  assert.strictEqual(Game.buddyEvoStage(99, 4, ats, req), 2);  // never exceeds the line length
});

test('buddyEvoStage: a species with no evo line never evolves', () => {
  assert.strictEqual(Game.buddyEvoStage(100, 4, [], []), 0);
  assert.strictEqual(Game.buddyEvoStage(100, 4, undefined, undefined), 0);
});

// ---- feed loop + Fight 2.0 (macro types, weakness, loadout) ----

test('buddyCraving names the first unmet macro, else null when well fed', () => {
  assert.strictEqual(Game.buddyCraving(null), 'firstmeal');
  assert.strictEqual(Game.buddyCraving({ proteinHit: false, fiberHit: false, kcalIn: false }), 'protein');
  assert.strictEqual(Game.buddyCraving({ proteinHit: true, fiberHit: false, kcalIn: false }), 'fibre');
  assert.strictEqual(Game.buddyCraving({ proteinHit: true, fiberHit: true, kcalIn: false }), 'fuel');
  assert.strictEqual(Game.buddyCraving({ proteinHit: true, fiberHit: true, kcalIn: true }), null);
});

test('type matchup: super-effective, resisted, neutral and balanced', () => {
  assert.strictEqual(Game.typeMult('power', 'guard'), 1.25); // power beats guard
  assert.strictEqual(Game.typeMult('guard', 'power'), 0.8);  // and is resisted the other way
  assert.strictEqual(Game.typeMult('power', 'swift'), 1);    // unrelated
  assert.strictEqual(Game.typeMult('balanced', 'power'), 1); // balanced is neutral
  assert.strictEqual(Game.typeForBiome('protein'), 'power');
  assert.strictEqual(Game.typeForBiome('apex'), 'balanced');
});

test('boss weakness is deterministic per week and maps to a macro', () => {
  assert.strictEqual(Game.bossWeakness('2026-30'), Game.bossWeakness('2026-30'));
  assert.ok(Game.FIGHT_TYPES.includes(Game.bossWeakness('2026-30')));
  assert.ok(['protein', 'fat', 'carbs', 'fibre'].includes(Game.TYPE_MACRO[Game.bossWeakness('2026-30')]));
});

test('weeklyLoadout caps charges from the week of eating', () => {
  assert.deepStrictEqual(Game.weeklyLoadout(2, 1, 0), { power: 2, heal: 1, special: 0 });
  assert.deepStrictEqual(Game.weeklyLoadout(9, 9, 9), { power: 3, heal: 3, special: 1 });
});

test('fightAtkMult stacks the boss-weakness bonus only when exploited', () => {
  assert.strictEqual(Game.fightAtkMult('power', 'guard', false, false), 1.25); // ladder, super-effective
  assert.strictEqual(Game.fightAtkMult('power', 'swift', true, false), 1);     // boss, not exploited
  assert.strictEqual(Game.fightAtkMult('power', 'swift', true, true), 1.35);   // boss weakness hit
  assert.strictEqual(Game.fightAtkMult('power', 'guard', true, true), Math.round(1.25 * 1.35 * 100) / 100);
});

// ---- day/night evolution affinity (Espeon/Umbreon by the clock) ----

test('dayNightAffinity splits on 06:00 and 18:00', () => {
  assert.strictEqual(Game.dayNightAffinity(6), 'day');
  assert.strictEqual(Game.dayNightAffinity(9), 'day');
  assert.strictEqual(Game.dayNightAffinity(17), 'day');
  assert.strictEqual(Game.dayNightAffinity(18), 'night');
  assert.strictEqual(Game.dayNightAffinity(23), 'night');
  assert.strictEqual(Game.dayNightAffinity(5), 'night');
  assert.strictEqual(Game.dayNightAffinity(0), 'night');
});

// ---- pre-fight stance (the battle plan) ----

test('stanceMult trades attack and defence, steady is neutral', () => {
  assert.deepStrictEqual(Game.stanceMult('press'), { atk: 1.2, def: 0.85 });
  assert.deepStrictEqual(Game.stanceMult('dig'), { atk: 0.85, def: 1.2 });
  assert.deepStrictEqual(Game.stanceMult('steady'), { atk: 1, def: 1 });
  assert.deepStrictEqual(Game.stanceMult('bogus'), { atk: 1, def: 1 }); // safe default
  assert.strictEqual(typeof Game.SPECIAL_ATK, 'number');
});

// ---- monthly expedition (a rotating collection set) ----

test('monthlyFeatured is deterministic per month and always in the pool', () => {
  assert.strictEqual(Game.monthlyFeatured('2026-07'), Game.monthlyFeatured('2026-07'));
  for (let m = 1; m <= 12; m++) {
    const ym = '2026-' + String(m).padStart(2, '0');
    assert.ok(Game.EXPEDITION_POOL.includes(Game.monthlyFeatured(ym)), 'off-pool for ' + ym);
  }
  // the feature rotates across the year, not one creature every month
  const picks = new Set(Array.from({ length: 12 }, (_, i) => Game.monthlyFeatured('2026-' + String(i + 1).padStart(2, '0'))));
  assert.ok(picks.size >= 3);
});

test('expeditionState tracks the quality-day goal and caps progress', () => {
  assert.deepStrictEqual(Game.expeditionState(0), { goal: 12, days: 0, ready: false, toGo: 12 });
  assert.deepStrictEqual(Game.expeditionState(5), { goal: 12, days: 5, ready: false, toGo: 7 });
  assert.deepStrictEqual(Game.expeditionState(12), { goal: 12, days: 12, ready: true, toGo: 0 });
  assert.deepStrictEqual(Game.expeditionState(20), { goal: 12, days: 12, ready: true, toGo: 0 });
});

// ---- sleep (a Pokemon Sleep style morning catch): score, band, style, deterministic catch ----

test('sleepScore ramps with duration and caps at 100 at target', () => {
  assert.strictEqual(Game.sleepScore(0, 480), 0);
  assert.strictEqual(Game.sleepScore(240, 480), 50);  // half the target
  assert.strictEqual(Game.sleepScore(480, 480), 100); // exactly on target
  assert.strictEqual(Game.sleepScore(600, 480), 100); // oversleeping does not exceed 100
  assert.strictEqual(Game.sleepScore(480, 0), 100);   // a zero/absent target falls back to the 8h default
  assert.strictEqual(Game.sleepScore(0, 0), 0);       // no sleep still scores 0
});

test('sleepScore nudges by deep+REM share when stages are present', () => {
  const ideal = Game.sleepScore(480, 480, { deep: 120, rem: 96, light: 240, awake: 24 }); // ~0.45 share
  const poor = Game.sleepScore(480, 480, { deep: 20, rem: 20, light: 400, awake: 40 });   // far from ideal
  assert.ok(ideal > poor, 'ideal stage mix should score higher');
  assert.ok(ideal <= 100 && poor >= 0);
});

test('sleepBand splits poor/ok/good/great at the right thresholds', () => {
  assert.strictEqual(Game.sleepBand(49), 'poor');
  assert.strictEqual(Game.sleepBand(50), 'ok');
  assert.strictEqual(Game.sleepBand(74), 'ok');
  assert.strictEqual(Game.sleepBand(75), 'good');
  assert.strictEqual(Game.sleepBand(89), 'good');
  assert.strictEqual(Game.sleepBand(90), 'great');
});

test('sleepStyleFor reads deep+REM share, else falls back to score', () => {
  assert.strictEqual(Game.sleepStyleFor(0, { deep: 5, rem: 5, light: 90, awake: 0 }), 'Dozing');    // ~0.1
  assert.strictEqual(Game.sleepStyleFor(0, { deep: 20, rem: 15, light: 65, awake: 0 }), 'Snoozing'); // ~0.35
  assert.strictEqual(Game.sleepStyleFor(0, { deep: 40, rem: 30, light: 30, awake: 0 }), 'Slumbering'); // ~0.7
  assert.strictEqual(Game.sleepStyleFor(40, null), 'Dozing');
  assert.strictEqual(Game.sleepStyleFor(70, null), 'Snoozing');
  assert.strictEqual(Game.sleepStyleFor(90, null), 'Slumbering');
});

test('sleepCatch is deterministic per user+date and stays in the band pool', () => {
  const a = Game.sleepCatch('saltA', '2026-07-19', 'good');
  const b = Game.sleepCatch('saltA', '2026-07-19', 'good');
  assert.deepStrictEqual(a, b); // same user + date + band => same catch
  for (const band of ['poor', 'ok', 'good', 'great']) {
    const c = Game.sleepCatch('saltA', '2026-07-19', band);
    const pool = Game.SLEEP_POOL[band].concat(band === 'great' ? ['rexosaur'] : []);
    assert.ok(pool.includes(c.id), 'off-pool ' + band + ': ' + c.id);
    assert.strictEqual(typeof c.shiny, 'boolean');
  }
  const fb = Game.sleepCatch('saltA', '2026-07-19', 'bogus'); // unknown band falls back to the poor pool
  assert.ok(Game.SLEEP_POOL.poor.includes(fb.id), 'unknown band should draw from poor: ' + fb.id);
});
