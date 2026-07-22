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
  assert.strictEqual(s.fight.lastDailyDate, null);     // new daily-hunt fields backfilled
  assert.strictEqual(s.fight.dailyStreak, 0);
  assert.strictEqual(s.fight.dailyBest, 0);
  assert.strictEqual(s.game_salt, null);               // minted lazily on first run
  assert.deepStrictEqual(s.badges, { checkins: 0, inRange: 0 });
  assert.deepStrictEqual(s.buddy, { stage: 0, name: '', personality: '', hatchedISO: null, speciesId: null, evoStage: 0, affinity: null, cosmetics: [] });
  assert.deepStrictEqual(s.records, { longestStreak: 0 });
  assert.deepStrictEqual(s.amber_ledger, []);          // new currency ledger backfilled
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

test('sleepScore returns null for a stage-less night (no quality to judge)', () => {
  // Without a stage breakdown we cannot assess quality, so we return null instead of a duration-only
  // score that used to pin at 100 (regression: "sleep always 100"). Callers show raw hours instead.
  assert.strictEqual(Game.sleepScore(480), null); // no stages -> no score
  assert.strictEqual(Game.sleepScore(600), null); // long night, no stages -> no score
  assert.strictEqual(Game.sleepScore(240), null); // short night, no stages -> no score
  assert.strictEqual(Game.sleepScore(0), 0);      // no sleep at all still scores 0
});

test('sleepScore nudges by deep+REM share when stages are present', () => {
  const ideal = Game.sleepScore(480, { deep: 120, rem: 96, light: 240, awake: 24 });
  const poor = Game.sleepScore(480, { deep: 20, rem: 20, light: 400, awake: 40 });   // far from ideal
  assert.ok(ideal > poor, 'ideal stage mix should score higher');
  assert.ok(ideal <= 100 && poor >= 0);
});

test('sleepScore does not pin at 100 for an 8h night with ordinary quality', () => {
  // A full ~8h asleep but a mediocre stage mix / low efficiency should land well under 100 now that
  // efficiency and deep+REM quality carry weight (regression: the old duration-only score always 100).
  const s = Game.sleepScore(456, { deep: 40, rem: 40, light: 376, awake: 60 });
  assert.ok(s < 100 && s > 40, 'ordinary night should score in a realistic band, got ' + s);
  // A restorative night of the same length scores clearly higher.
  const good = Game.sleepScore(462, { deep: 100, rem: 108, light: 254, awake: 18 });
  assert.ok(good > s, 'restorative night should beat the ordinary one');
});

test('sleepScoreParts itemises the score (duration / quality split) and always agrees with sleepScore', () => {
  const stages = { deep: 100, rem: 108, light: 254, awake: 18 };
  const p = Game.sleepScoreParts(462, stages);
  assert.strictEqual(p.score, Game.sleepScore(462, stages), 'parts.score must equal sleepScore');
  assert.strictEqual(p.hasStages, true);
  assert.strictEqual(p.parts.length, 4);
  assert.deepStrictEqual(p.parts.map(x => x.key), ['duration', 'efficiency', 'rem', 'deep']);
  assert.deepStrictEqual(p.parts.map(x => x.max), [45, 20, 18, 17]);
  assert.strictEqual(p.parts.reduce((a, x) => a + x.max, 0), 100, 'component maxima sum to 100');
  p.parts.forEach(x => assert.ok(x.points >= 0 && x.points <= x.max, x.key + ' points within [0,max]'));
  // Deep and REM are scored against their own clinical ranges, so a night short on ONE stage is docked
  // only on that component. Robbing REM (down to ~9%) should cost REM points but leave deep near full.
  const lowRem = Game.sleepScoreParts(462, { deep: 100, rem: 42, light: 320, awake: 18 });
  const remPart = lowRem.parts.find(x => x.key === 'rem'), deepPart = lowRem.parts.find(x => x.key === 'deep');
  assert.ok(remPart.points < 8, 'a REM-deficient night loses REM points');
  assert.ok(deepPart.points >= 15, 'but healthy deep sleep keeps its points');
  assert.ok(lowRem.score < p.score, 'and the overall score drops');
  // A stage-less night has no quality to itemise: score null, no parts, but hours are still known.
  const bare = Game.sleepScoreParts(450);
  assert.strictEqual(bare.score, null);
  assert.strictEqual(bare.hasStages, false);
  assert.strictEqual(bare.parts.length, 0);
  assert.strictEqual(bare.asleepMin, 450);
  // No sleep at all still scores 0 (matches sleepScore).
  assert.strictEqual(Game.sleepScoreParts(0).score, 0);
});

test('sleep duration is scored against the science (7-9h), with no editable target', () => {
  // Identical architecture, three durations: 5h scores low, 7h solid, 8h full duration credit.
  const arch = { rem: null }; // placeholder overwritten below
  const mk = (min, deepP, remP) => { const asleep = min; return { deep: Math.round(asleep * deepP), rem: Math.round(asleep * remP), light: asleep - Math.round(asleep * deepP) - Math.round(asleep * remP), awake: Math.round(asleep * 0.06) }; };
  const five = Game.sleepScoreParts(300, mk(300, 0.18, 0.22));
  const eight = Game.sleepScoreParts(480, mk(480, 0.18, 0.22));
  const fiveDur = five.parts.find(x => x.key === 'duration').points;
  const eightDur = eight.parts.find(x => x.key === 'duration').points;
  assert.strictEqual(eightDur, 45, '8h earns full duration credit');
  assert.ok(fiveDur < 20, '5h is heavily docked on duration, got ' + fiveDur);
  assert.ok(eight.score > five.score, 'more sleep (same architecture) scores higher');
  void arch;
});

test('readinessParts explains every signal and agrees with readinessScore', () => {
  // Nothing tracked: score null, all five signals listed as absent, zero anchors.
  const empty = Game.readinessParts({});
  assert.strictEqual(empty.score, null);
  assert.strictEqual(empty.anchored, false);
  assert.strictEqual(empty.anchorCount, 0);
  assert.strictEqual(empty.signals.length, 5);
  assert.deepStrictEqual(empty.signals.map(s => s.key), ['hrv', 'sleep', 'rhr', 'spo2', 'load']);
  assert.ok(empty.signals.every(s => s.present === false));
  // HRV is the dominant anchor (evidence-based): its weight exceeds every other signal's.
  const hrvW = empty.signals.find(s => s.key === 'hrv').weightPct;
  assert.ok(empty.signals.every(s => s.key === 'hrv' || s.weightPct < hrvW), 'HRV must carry the most weight');
  // Thin modifier proxies never anchor a score (regression: must not pin at 100). Load alone -> null...
  assert.strictEqual(Game.readinessScore({ load: 8000, loadBaseline: 9000 }), null);
  // ...and SpO2 alone -> null, even a perfect 99% night, because a healthy SpO2 must not fabricate 100.
  const spo2Only = Game.readinessParts({ spo2: 99 });
  assert.strictEqual(spo2Only.score, null);
  assert.strictEqual(spo2Only.anchorCount, 0);
  assert.strictEqual(spo2Only.signals.find(s => s.key === 'spo2').present, true);
  // Sleep alone anchors it; parts.score tracks readinessScore exactly.
  const sleepOnly = Game.readinessParts({ sleepScore: 80 });
  assert.strictEqual(sleepOnly.score, Game.readinessScore({ sleepScore: 80 }));
  assert.strictEqual(sleepOnly.anchorCount, 1);
  // Full signal set: three anchors, score matches, illness penalty flagged when tempDev present.
  const full = { sleepScore: 70, hrv: 65, hrvBaseline: 50, rhr: 52, rhrBaseline: 55, spo2: 97, tempDev: 0.6 };
  const fp = Game.readinessParts(full);
  assert.strictEqual(fp.score, Game.readinessScore(full));
  assert.strictEqual(fp.anchorCount, 3);
  assert.strictEqual(fp.tempPenaltyApplied, true);
});

test('readiness uses lnRMSSD: HRV is judged log-symmetrically around baseline', () => {
  // At baseline, HRV contributes exactly 0.5 (neutral).
  const atBase = Game.readinessParts({ hrv: 50, hrvBaseline: 50 });
  assert.strictEqual(atBase.signals.find(s => s.key === 'hrv').value, 50);
  // Log symmetry: a x1.25 HRV and a x0.8 HRV (reciprocals) sit equidistant from 50.
  const up = Game.readinessParts({ hrv: 62.5, hrvBaseline: 50 }).signals.find(s => s.key === 'hrv').value;
  const down = Game.readinessParts({ hrv: 40, hrvBaseline: 50 }).signals.find(s => s.key === 'hrv').value;
  assert.ok(Math.abs((up - 50) - (50 - down)) <= 1, 'lnRMSSD should be symmetric in log space around baseline');
  assert.ok(up > 50 && down < 50);
});

test('sleep scoring is strict: an average night lands well under 80, only an excellent one reaches 90+', () => {
  // Average night: 7h asleep of ~7h55 in bed (88% efficiency), stages a touch under ideal. Should NOT
  // flatter the user - lands in the 60s-70s matching real-world spread, not the 90s.
  const avg = Game.sleepScore(420, { deep: 63, rem: 80, light: 277, awake: 55 }); // 7h, deep 15%, rem 19%
  assert.ok(avg < 80, 'an average night should score under 80, got ' + avg);
  assert.ok(avg > 45, 'but not punitively low, got ' + avg);
  // Genuinely excellent night: 8h asleep, 95% efficiency, ideal architecture -> 90+.
  const great = Game.sleepScore(480, { deep: 110, rem: 110, light: 260, awake: 25 });
  assert.ok(great >= 90, 'an excellent night should reach 90+, got ' + great);
  // A poor night is clearly separated below the average one.
  const poor = Game.sleepScore(330, { deep: 20, rem: 25, light: 250, awake: 70 });
  assert.ok(poor < avg, 'a poor night scores below an average one');
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

// ---- readiness (our own recovery score) + the dino battle buff ----

test('readinessScore is baseline-relative and degrades to available signals', () => {
  assert.strictEqual(Game.readinessScore({}), null);            // nothing to score yet
  assert.strictEqual(Game.readinessScore({ sleepScore: 80 }), 80); // sleep-only (Phase A) tracks sleep
  // The step-load proxy alone is too thin to anchor readiness: at/under baseline it would read 1.0 and
  // pin readiness at 100, so a load-only day (e.g. a stage-less night with no HRV/RHR yet) scores nothing.
  assert.strictEqual(Game.readinessScore({ load: 8000, loadBaseline: 9000 }), null);
  assert.strictEqual(Game.readinessScore({ load: 12000, loadBaseline: 9000 }), null);
  const high = Game.readinessScore({ sleepScore: 70, hrv: 65, hrvBaseline: 50, rhr: 52, rhrBaseline: 55 });
  const low = Game.readinessScore({ sleepScore: 70, hrv: 38, hrvBaseline: 50, rhr: 60, rhrBaseline: 55 });
  assert.ok(high > low, 'higher HRV + lower resting HR should read more recovered');
  assert.ok(high <= 100 && low >= 0);
  const well = Game.readinessScore({ sleepScore: 80, hrv: 55, hrvBaseline: 50 });
  const feverish = Game.readinessScore({ sleepScore: 80, hrv: 55, hrvBaseline: 50, tempDev: 1.0 });
  assert.ok(feverish < well, 'a raised skin temperature knocks readiness down');
});

test('readinessBand + buff reward recovery and cushion a rough night', () => {
  assert.strictEqual(Game.readinessBand(85), 'apex');
  assert.strictEqual(Game.readinessBand(60), 'prowling');
  assert.strictEqual(Game.readinessBand(40), 'drowsy');
  assert.strictEqual(Game.readinessBand(null), null);
  assert.ok(Game.readinessBuff(90).atk > 1, 'apex hits harder');
  assert.strictEqual(Game.readinessBuff(65).atk, 1); // steady = no change
  const drowsy = Game.readinessBuff(30);
  assert.ok(drowsy.atk < 1 && drowsy.def > 1 && drowsy.heal > 0, 'a recovery day softens attack but adds defence + heal');
});

test('primedCatch is deterministic and draws from the rare primed pool', () => {
  const a = Game.primedCatch('saltZ', '2026-07-20');
  assert.deepStrictEqual(a, Game.primedCatch('saltZ', '2026-07-20')); // stable per user+date
  const pool = Game.PRIMED_POOL.concat(['rexosaur']);
  for (let i = 0; i < 30; i++) {
    const c = Game.primedCatch('u' + i, '2026-07-' + String((i % 28) + 1).padStart(2, '0'));
    assert.ok(pool.includes(c.id), 'off-pool primed catch: ' + c.id);
    assert.strictEqual(typeof c.shiny, 'boolean');
  }
});

// ---- Daily Hunt: a deterministic-per-day mini-boss ----

test('dailyHunt is stable for a date and stays inside the roster', () => {
  const a = Game.dailyHunt('2026-07-22', 7);
  assert.deepStrictEqual(a, Game.dailyHunt('2026-07-22', 7)); // same all day
  for (let i = 1; i <= 28; i++) {
    const h = Game.dailyHunt('2026-07-' + String(i).padStart(2, '0'), 7);
    assert.ok(h.idx >= 0 && h.idx < 7, 'idx in range');
    assert.ok(Game.FIGHT_TYPES.includes(h.type), 'valid type');
    assert.ok(h.power >= 2 && h.power <= 4, 'daily power is gentle (2..4): ' + h.power);
  }
});

test('dailyHunt differs across days (not a constant)', () => {
  const idxs = new Set();
  for (let i = 1; i <= 28; i++) idxs.add(Game.dailyHunt('2026-07-' + String(i).padStart(2, '0'), 7).idx);
  assert.ok(idxs.size > 1, 'daily hunt should vary day to day');
});

test('dailyReady is once per day', () => {
  assert.strictEqual(Game.dailyReady(null, '2026-07-22'), true);
  assert.strictEqual(Game.dailyReady('2026-07-21', '2026-07-22'), true);
  assert.strictEqual(Game.dailyReady('2026-07-22', '2026-07-22'), false);
});

test('dailyStreakNext extends on consecutive days and resets after a gap', () => {
  assert.strictEqual(Game.dailyStreakNext(null, 0, '2026-07-22'), 1);          // first clear
  assert.strictEqual(Game.dailyStreakNext('2026-07-21', 3, '2026-07-22'), 4);  // next day → +1
  assert.strictEqual(Game.dailyStreakNext('2026-07-19', 3, '2026-07-22'), 1);  // gap → reset to 1
  assert.strictEqual(Game.dailyStreakNext('2026-07-22', 4, '2026-07-22'), 4);  // already counted today
});

// ---- Amber currency: append-only ledger, balance = sum(delta) ----

test('amberBalance sums the ledger and never goes negative', () => {
  assert.strictEqual(Game.amberBalance(null), 0);
  assert.strictEqual(Game.amberBalance([]), 0);
  const led = [{ id: 'a', delta: 60 }, { id: 'b', delta: 15 }, { id: 'c', delta: -40 }];
  assert.strictEqual(Game.amberBalance(led), 35);
  assert.strictEqual(Game.amberBalance([{ id: 'x', delta: -999 }]), 0); // clamped
});

test('amberDailyReward tops up every 5th clear in a row', () => {
  assert.strictEqual(Game.amberDailyReward(1), Game.AMBER_REWARDS.daily);
  assert.strictEqual(Game.amberDailyReward(4), Game.AMBER_REWARDS.daily);
  assert.strictEqual(Game.amberDailyReward(5), Game.AMBER_REWARDS.daily + Game.AMBER_REWARDS.dailyStreakBonus);
  assert.strictEqual(Game.amberDailyReward(10), Game.AMBER_REWARDS.daily + Game.AMBER_REWARDS.dailyStreakBonus);
});

// ---- Shop: stable prices, affordability from the ledger ----

test('shopPrice covers every cosmetic and consumable, and is null otherwise', () => {
  Game.COSMETICS.forEach(c => assert.strictEqual(Game.shopPrice(c.id), c.price));
  Game.SHOP_CONSUMABLES.forEach(c => assert.strictEqual(Game.shopPrice(c.id), c.price));
  assert.strictEqual(Game.shopPrice('not_a_thing'), null);
});

test('canAfford reads the balance against the price', () => {
  const rich = [{ id: 'a', delta: 500 }];
  const poor = [{ id: 'a', delta: 10 }];
  assert.strictEqual(Game.canAfford(rich, 'crown'), true);
  assert.strictEqual(Game.canAfford(poor, 'crown'), false);
  assert.strictEqual(Game.canAfford(rich, 'not_a_thing'), false); // no price → cannot buy
});
