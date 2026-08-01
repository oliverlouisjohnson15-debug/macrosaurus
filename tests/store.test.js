'use strict';
// Tests for the local store: default shape, deep-merge migration, and the calorie self-heal.
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const Store = require('../app/store.js');
const E = require('../app/engine.js');

const shiftISO = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

test('defaultState ships the standard meal names', () => {
  const s = Store.defaultState();
  const names = s.meal_templates.map(m => m.name);
  assert.deepStrictEqual(names, ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
});

test('migrate backfills missing keys without touching existing data', () => {
  const partial = { profile: { goalType: 'cut' }, foods: [{ id: 'x', name: 'Eggs' }] };
  const s = Store.migrate(partial);
  assert.strictEqual(s.profile.goalType, 'cut');            // preserved
  assert.ok(Array.isArray(s.log_entries));                   // backfilled
  assert.ok(s.onboarding && typeof s.onboarding === 'object'); // backfilled
  assert.strictEqual(s.foods[0].name, 'Eggs');               // array leaf preserved
});

test('migrate backfills the smoothed-expenditure field for old state shapes', () => {
  const s = Store.migrate({ profile: { goalType: 'cut' } });
  assert.ok('expenditure' in s);
  assert.strictEqual(s.expenditure, null); // null until the first check-in learns it
  const kept = Store.migrate({ expenditure: { kcal: 2650, n: 4, updated: '2026-07-01' } });
  assert.strictEqual(kept.expenditure.kcal, 2650); // existing learned value preserved
  assert.strictEqual(kept.expenditure.n, 4);
});

test('migrate: a plan changed before the history existed does not reach back over earlier days', () => {
  // The live shape of the bug: a plan set today, no history, so every day since the start of
  // logging was being read against a shape that only came into force this morning.
  const s = Store.migrate({ profile: { goalType: 'cut', cycling: { enabled: true, highDays: [6], deltaPct: 0.31 }, cyclingChangedAt: '2026-07-31' } });
  assert.strictEqual(s.profile.cyclingHistory.length, 2);
  const [before, after] = s.profile.cyclingHistory;
  assert.strictEqual(before.effective_date, null);
  assert.strictEqual(before.enabled, false);          // the shape that ran then is not known: no shape
  assert.deepStrictEqual(before.highDays, []);
  assert.strictEqual(after.effective_date, '2026-07-31');
  assert.deepStrictEqual(after.highDays, [6]);        // the shape we do have, from the day it started
  assert.strictEqual(after.deltaPct, 0.31);
});

test('migrate: a plan that has never been changed back-fills as having always been the plan', () => {
  const s = Store.migrate({ profile: { goalType: 'cut', cycling: { enabled: true, highDays: [0, 6], deltaPct: 0.15 } } });
  assert.strictEqual(s.profile.cyclingHistory.length, 1);
  assert.strictEqual(s.profile.cyclingHistory[0].effective_date, null); // since the beginning
  assert.deepStrictEqual(s.profile.cyclingHistory[0].highDays, [0, 6]);
  // A history already on record is never rewritten.
  const kept = Store.migrate({ profile: { cycling: { enabled: false, highDays: [], deltaPct: 0.15 }, cyclingChangedAt: '2026-07-31', cyclingHistory: [{ effective_date: null, enabled: true, highDays: [3], deltaPct: 0.2 }] } });
  assert.strictEqual(kept.profile.cyclingHistory.length, 1);
  assert.deepStrictEqual(kept.profile.cyclingHistory[0].highDays, [3]);
});

// The back-fill recovers the SHAPE of a plan change but not what that change owed the week it
// landed in, so the entry it leaves is the only one the app can produce with no rebalance on it.
// Left that way the window keeps the change's overshoot and never nets to the base target.
test('migrate: a back-filled plan change settles up with the window it landed in', () => {
  const today = Store.todayISO();
  const base = 1986;
  const s = Store.migrate({
    profile: { sex: 'male', goalType: 'cut', cycling: { enabled: true, highDays: [6], deltaPct: 0.31 }, cyclingChangedAt: shiftISO(today, -1) },
    targets: [{ id: 't', effective_date: shiftISO(today, -13), kcal: base, protein_g: 163, fat_g: 74, carbs_g: 168 }],
    last_checkin: shiftISO(today, -3),
  });
  const entry = s.profile.cyclingHistory[1];
  assert.strictEqual(entry.effective_date, shiftISO(today, -1));
  assert.strictEqual(typeof entry.spreadKcal, 'number');
  assert.strictEqual(entry.spreadUntil, shiftISO(shiftISO(today, -3), 6)); // bounded by its own window
  // Recovered a day late, so it settles from TODAY: yesterday has been eaten and is not up for
  // restating, and the days still to come carry the whole of it.
  assert.strictEqual(entry.spreadFrom, today);
  const bare = s.profile.cyclingHistory.map(h => Object.assign({}, h, { spreadKcal: 0 }));
  const on = d => E.cyclingDeltaOn(s.profile.cycling, s.profile.cyclingHistory, d, base, E.kcalFloor(s.profile));
  const locked = d => E.cyclingDeltaOn(s.profile.cycling, bare, d, base, E.kcalFloor(s.profile));
  [-3, -2, -1].forEach(n => assert.strictEqual(on(shiftISO(today, n)), locked(shiftISO(today, n)), 'day ' + n + ' should be locked'));
  assert.strictEqual(on(today), locked(today) + entry.spreadKcal);
  // What the rebalance is for: the seven days of the window now add up to seven days at base.
  // Before it they did not, because the days already eaten kept the flat plan while every day from
  // the change on took the new shape, leaving the high day's bump with nothing to cancel it.
  let planned = 0;
  for (let i = 0; i < 7; i++) {
    const d = shiftISO(shiftISO(today, -3), i);
    planned += base + E.cyclingDeltaOn(s.profile.cycling, s.profile.cyclingHistory, d, base, E.kcalFloor(s.profile));
  }
  assert.ok(Math.abs(planned - base * 7) <= 7, 'window should net to base, got ' + planned + ' vs ' + base * 7);
});

test('migrate: a rebalance already on record is never recomputed, and an old change owes nothing', () => {
  const today = Store.todayISO();
  const targets = [{ id: 't', effective_date: shiftISO(today, -30), kcal: 2000, protein_g: 160, fat_g: 70, carbs_g: 180 }];
  // An edit made in the app records its own spread; migrate must not touch it on the next load.
  const kept = Store.migrate({
    profile: {
      sex: 'male', cycling: { enabled: true, highDays: [6], deltaPct: 0.2 }, cyclingChangedAt: shiftISO(today, -1),
      cyclingHistory: [
        { effective_date: null, enabled: false, highDays: [], deltaPct: 0.2 },
        { effective_date: shiftISO(today, -1), enabled: true, highDays: [6], deltaPct: 0.2, spreadKcal: -123, spreadUntil: shiftISO(today, 3) },
      ],
    },
    targets, last_checkin: shiftISO(today, -3),
  });
  assert.strictEqual(kept.profile.cyclingHistory[1].spreadKcal, -123);
  assert.strictEqual(kept.profile.cyclingHistory[1].spreadUntil, shiftISO(today, 3));
  // A plan last changed in a window that has long since closed ran the whole of every window since,
  // so it is neutral over them and owes nothing. Settled at 0, which also stops this re-running.
  const old = Store.migrate({
    profile: { sex: 'male', cycling: { enabled: true, highDays: [6], deltaPct: 0.2 }, cyclingChangedAt: shiftISO(today, -60) },
    targets, last_checkin: shiftISO(today, -3),
  });
  assert.strictEqual(old.profile.cyclingHistory[1].spreadKcal, 0);
});

test('self-heal snaps grossly-inflated calories back to the macro maths', () => {
  const s = Store.migrate({
    log_entries: [
      // the real bug: 366 kcal paired with ~85 kcal of macros -> healed to 85
      { id: 'a', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } },
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 85);
});

test('self-heal leaves accurate and sugar-free entries alone', () => {
  const s = Store.migrate({
    log_entries: [
      { id: 'b', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 215, protein: 7, carbs: 41, fat: 3 } }, // ~219, fine
      { id: 'c', date: '2026-07-07', is_alcohol: false, computed_macros: { kcal: 10, protein: 0, carbs: 4.4, fat: 0 } },  // sugar-free, kcal below maths
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 215);
  assert.strictEqual(s.log_entries[1].computed_macros.kcal, 10);
});

test('self-heal never touches alcohol (7 kcal/g legitimately exceeds Atwater)', () => {
  const s = Store.migrate({
    log_entries: [
      { id: 'd', date: '2026-07-07', is_alcohol: true, computed_macros: { kcal: 180, protein: 0, carbs: 0, fat: 0 } },
    ],
  });
  assert.strictEqual(s.log_entries[0].computed_macros.kcal, 180);
});

test('self-heal also cleans remembered foods and saved meals', () => {
  const s = Store.migrate({
    foods: [{ id: 'f', name: 'Yog', is_alcohol: false, macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } }],
    saved_meals: [{ id: 'sm', name: 'M', items: [{ name: 'Yog', is_alcohol: false, macros: { kcal: 366, protein: 15, carbs: 5.9, fat: 0.2 } }] }],
  });
  assert.strictEqual(s.foods[0].macros.kcal, 85);
  assert.strictEqual(s.saved_meals[0].items[0].macros.kcal, 85);
});

test('mergeStates: a stale copy with a newer _rev can never drop the other copy entries', () => {
  // "good" has 3 days of food + weigh-ins; "stale" is an old copy that was re-saved (higher _rev)
  // but only holds day 1. The merge must keep ALL of good's entries. This is the data-loss guard.
  const good = { _rev: 100,
    log_entries: [{ id: 'a', date: '2026-07-08' }, { id: 'b', date: '2026-07-09' }, { id: 'c', date: '2026-07-10' }],
    weight_entries: [{ id: 'w1', date: '2026-07-08' }, { id: 'w2', date: '2026-07-09' }],
    checkins: [{ date: '2026-07-04' }, { date: '2026-07-08' }] };
  const stale = { _rev: 200, // newer timestamp, but content is old and thin
    log_entries: [{ id: 'a', date: '2026-07-08' }], weight_entries: [{ id: 'w1', date: '2026-07-08' }], checkins: [{ date: '2026-07-04' }] };
  const m = Store.mergeStates(stale, good);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['a', 'b', 'c']);
  assert.deepStrictEqual(m.weight_entries.map(e => e.id).sort(), ['w1', 'w2']);
  assert.deepStrictEqual(m.checkins.map(e => e.date).sort(), ['2026-07-04', '2026-07-08']);
  // symmetric: order of arguments must not matter for the union
  const m2 = Store.mergeStates(good, stale);
  assert.deepStrictEqual(m2.log_entries.map(e => e.id).sort(), ['a', 'b', 'c']);
});

test('mergeStates: Amber earned/spent on two devices unions without loss or double-count', () => {
  const Game = require('../app/game.js');
  // Device A earned a weekly-boss payout; device B (higher _rev) earned a daily and spent on a crown.
  const a = { _rev: 100, amber_ledger: [{ id: 'e1', date: '2026-07-20', delta: 60, reason: 'weekly' }] };
  const b = { _rev: 200, amber_ledger: [
    { id: 'e2', date: '2026-07-21', delta: 15, reason: 'daily' },
    { id: 's1', date: '2026-07-21', delta: -260, reason: 'buy:crown' },
  ] };
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.amber_ledger.map(e => e.id).sort(), ['e1', 'e2', 's1']); // all three survive
  assert.strictEqual(Game.amberBalance(m.amber_ledger), 0); // 60 + 15 - 260, clamped to 0 (never negative)
  // order-independent, and a duplicated earn id is de-duped (union keeps one), so no double-count
  const dup = { _rev: 300, amber_ledger: [{ id: 'e1', date: '2026-07-20', delta: 60, reason: 'weekly' }] };
  const m2 = Store.mergeStates(m, dup);
  assert.strictEqual(m2.amber_ledger.filter(e => e.id === 'e1').length, 1);
});

test('mergeStates: scalar/derived fields come from the higher-_rev copy, edits win on conflict', () => {
  const older = { _rev: 1, profile: { goalType: 'cut' }, last_checkin: '2026-07-01',
    log_entries: [{ id: 'a', date: '2026-07-08', computed_macros: { kcal: 100 } }] };
  const newer = { _rev: 2, profile: { goalType: 'maintain' }, last_checkin: '2026-07-08',
    log_entries: [{ id: 'a', date: '2026-07-08', computed_macros: { kcal: 250 } }, { id: 'b', date: '2026-07-09' }] };
  const m = Store.mergeStates(older, newer);
  assert.strictEqual(m.profile.goalType, 'maintain');     // newer wins on scalars
  assert.strictEqual(m.last_checkin, '2026-07-08');
  assert.strictEqual(m.log_entries.find(e => e.id === 'a').computed_macros.kcal, 250); // newer edit wins
  assert.strictEqual(m.log_entries.length, 2);            // older's unique entries still kept
  assert.strictEqual(m._rev, 2);
});

test('mergeStates: last_checkin tracks the unioned checkins ledger, not just the higher-_rev scalar', () => {
  // Tab A checked in today (lower _rev). Tab B is an older session that never saw it (last_checkin
  // stale) but bumped _rev higher doing something else. The union must keep today's check-in AND move
  // last_checkin forward to match, or the app reads "not checked in today" despite a saved check-in.
  const checkedIn = { _rev: 5, last_checkin: '2026-07-24',
    checkins: [{ date: '2026-07-24', weightKg: 91.6 }] };
  const staleHigherRev = { _rev: 9, last_checkin: '2026-07-19', checkins: [] };
  const m = Store.mergeStates(checkedIn, staleHigherRev);
  assert.strictEqual(m.checkins.length, 1);
  assert.strictEqual(m.checkins[0].date, '2026-07-24'); // ledger keeps the check-in (union)
  assert.strictEqual(m.last_checkin, '2026-07-24');      // pointer reconciled to the ledger
  const m2 = Store.mergeStates(staleHigherRev, checkedIn); // order must not matter
  assert.strictEqual(m2.last_checkin, '2026-07-24');
});

test('mergeStates: a resume can keep last_checkin ahead of the newest checkins entry', () => {
  // Resuming from a pause stamps last_checkin without pushing a checkins row, so the pointer may sit
  // ahead of the ledger. The reconcile must take the max, never drag it back to the last entry date.
  const resumed = { _rev: 2, last_checkin: '2026-07-24', checkins: [{ date: '2026-07-10' }] };
  const older = { _rev: 1, last_checkin: '2026-07-10', checkins: [{ date: '2026-07-10' }] };
  assert.strictEqual(Store.mergeStates(resumed, older).last_checkin, '2026-07-24');
});

test('mergeStates: adaptive expenditure follows the most recently learned copy, not the higher _rev', () => {
  // The higher-_rev copy never ran the latest check-in, so its learned TDEE is older.
  const staleHigherRev = { _rev: 9, expenditure: { kcal: 2400, n: 3, updated: '2026-07-10' } };
  const freshLearned    = { _rev: 4, expenditure: { kcal: 2650, n: 5, updated: '2026-07-24' } };
  assert.strictEqual(Store.mergeStates(staleHigherRev, freshLearned).expenditure.kcal, 2650);
  assert.strictEqual(Store.mergeStates(freshLearned, staleHigherRev).expenditure.kcal, 2650); // order-independent
});

test('mergeStates: monotonic counters (badges, longest streak) take the max, never regress', () => {
  const a = { _rev: 9, badges: { checkins: 2, inRange: 1 }, records: { longestStreak: 4 } };
  const b = { _rev: 3, badges: { checkins: 5, inRange: 3 }, records: { longestStreak: 12 } };
  const m = Store.mergeStates(a, b);
  assert.strictEqual(m.badges.checkins, 5);
  assert.strictEqual(m.badges.inRange, 3);
  assert.strictEqual(m.records.longestStreak, 12);
});

test('mergeStates: buddy stage is a high-water mark and never naps backward on merge', () => {
  const grown = { _rev: 2, buddy: { stage: 5, name: 'Rex' } };
  const behind = { _rev: 8, buddy: { stage: 1, name: 'Rex' } }; // higher _rev but lower stage
  assert.strictEqual(Store.mergeStates(grown, behind).buddy.stage, 5);
  assert.strictEqual(Store.mergeStates(behind, grown).buddy.stage, 5);
});

test('mergeStates: onboarding flags OR together so a stale copy cannot re-trigger the tour', () => {
  const done = { _rev: 1, onboarding: { welcomed: true, sawDex: true, dismissed: true } };
  const fresh = { _rev: 9, onboarding: { welcomed: false, sawDex: false, dismissed: false } };
  const m = Store.mergeStates(done, fresh);
  assert.strictEqual(m.onboarding.welcomed, true);
  assert.strictEqual(m.onboarding.sawDex, true);
  assert.strictEqual(m.onboarding.dismissed, true);
});

test('mergeStates: dino-fight progress reconciles field-wise instead of losing a device\'s wins', () => {
  // Same prestige: rank/wins/trophies take the max; date gates take the later value.
  const deviceA = { _rev: 3, fight: { prestige: 0, rank: 6, wins: 10, trophies: 2, dailyBest: 4, dailyStreak: 4, lastDailyDate: '2026-07-24', lastAttemptDate: '2026-07-24', lastBossWeek: '2026-W30' } };
  const deviceB = { _rev: 9, fight: { prestige: 0, rank: 3, wins: 7, trophies: 1, dailyBest: 2, dailyStreak: 1, lastDailyDate: '2026-07-20', lastAttemptDate: '2026-07-23', lastBossWeek: '2026-W29' } };
  const m = Store.mergeStates(deviceA, deviceB);
  assert.strictEqual(m.fight.rank, 6);
  assert.strictEqual(m.fight.wins, 10);
  assert.strictEqual(m.fight.trophies, 2);
  assert.strictEqual(m.fight.dailyBest, 4);
  assert.strictEqual(m.fight.dailyStreak, 4);          // from the more recent daily win
  assert.strictEqual(m.fight.lastAttemptDate, '2026-07-24');
});

test('mergeStates: a prestige reset is not undone by the other copy\'s larger pre-reset rank', () => {
  // Device A prestiged (rank back to 0, prestige 1). Device B is still grinding the first ladder.
  const prestiged = { _rev: 4, fight: { prestige: 1, rank: 1, wins: 20 } };
  const grinding  = { _rev: 2, fight: { prestige: 0, rank: 9, wins: 15 } };
  const m = Store.mergeStates(prestiged, grinding);
  assert.strictEqual(m.fight.prestige, 1);
  assert.strictEqual(m.fight.rank, 1);   // NOT 9 - B's rank is at a lower prestige tier
  assert.strictEqual(m.fight.wins, 20);  // cumulative wins still max
});

test('mergeStates: meal_templates union keeps a rename and an added meal, and honors a deletion', () => {
  const higherRev = { _rev: 9, meal_templates: [
    { id: 'm_1', name: 'Breakfast', sort_order: 0 },
    { id: 'm_2', name: 'Brunch', sort_order: 1 },       // renamed on this device
    { id: 'm_3', name: 'Dinner', sort_order: 2 },
  ] };
  const lowerRev = { _rev: 3,
    meal_templates: [
      { id: 'm_1', name: 'Breakfast', sort_order: 0 },
      { id: 'm_2', name: 'Lunch', sort_order: 1 },      // stale name
      { id: 'm_3', name: 'Dinner', sort_order: 2 },
      { id: 'm_4', name: 'Supper', sort_order: 3 },      // added on the lower-_rev device
    ],
    deleted: { m_3: 1720000000000 },                     // and Dinner deleted here (tombstoned)
  };
  const m = Store.mergeStates(higherRev, lowerRev);
  const byId = Object.fromEntries(m.meal_templates.map(x => [x.id, x]));
  assert.strictEqual(byId.m_2.name, 'Brunch');           // rename (higher-_rev) wins
  assert.ok(byId.m_4 && byId.m_4.name === 'Supper');     // added meal is not lost
  assert.ok(!byId.m_3, 'deleted meal stays deleted, not resurrected by the union');
  const orders = m.meal_templates.map(x => x.sort_order);
  assert.deepStrictEqual(orders, orders.slice().sort((x, y) => x - y)); // sorted by sort_order
  // order-independent
  assert.ok(!Object.fromEntries(Store.mergeStates(lowerRev, higherRev).meal_templates.map(x => [x.id, x])).m_3);
});

test('mergeStates: a live Google Health link survives a higher-_rev copy that never connected', () => {
  // The bug: a stale device/tab with a higher _rev but no googleHealth wiped a live connection on
  // merge, flipping the UI to "not connected" while the server was still synced.
  const connected = { _rev: 5, googleHealth: { connected: true, lastSync: '2026-07-21T13:44:00.000Z' } };
  const neverLinked = { _rev: 9, googleHealth: null };
  assert.strictEqual(Store.mergeStates(connected, neverLinked).googleHealth.connected, true);
  assert.strictEqual(Store.mergeStates(neverLinked, connected).googleHealth.connected, true); // order-independent
  // Two connected copies: the most recently synced one wins.
  const older = { _rev: 2, googleHealth: { connected: true, lastSync: '2026-07-20T09:00:00.000Z' } };
  const fresher = { _rev: 1, googleHealth: { connected: true, lastSync: '2026-07-21T13:44:00.000Z' } };
  assert.strictEqual(Store.mergeStates(older, fresher).googleHealth.lastSync, '2026-07-21T13:44:00.000Z');
  // An explicit disconnect (timestamped) still wins over an older connected copy.
  const live = { _rev: 3, googleHealth: { connected: true, lastSync: '2026-07-21T08:00:00.000Z' } };
  const off = { _rev: 1, googleHealth: { connected: false, disconnectedAt: '2026-07-21T12:00:00.000Z' } };
  assert.strictEqual(Store.mergeStates(live, off).googleHealth.connected, false);
});

test('mergeStates: a tombstoned delete is not resurrected by the copy that still has it', () => {
  // device A deleted entry 'a' (tombstone); device B (or the cloud) still holds 'a'.
  const deletedOn = { _rev: 3, log_entries: [{ id: 'b', date: 'x' }], deleted: { a: 999 } };
  const stillHas  = { _rev: 2, log_entries: [{ id: 'a', date: 'x' }, { id: 'b', date: 'x' }], deleted: {} };
  const m = Store.mergeStates(deletedOn, stillHas);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['b']); // 'a' stays deleted, not resurrected
  assert.ok(m.deleted.a);                                             // tombstone carried forward
  const m2 = Store.mergeStates(stillHas, deletedOn);                  // order must not matter
  assert.deepStrictEqual(m2.log_entries.map(e => e.id).sort(), ['b']);
});

test('mergeStates: tombstones only remove their own id, never other entries', () => {
  const a = { _rev: 2, log_entries: [{ id: 'x' }], deleted: { gone: 1 } };
  const b = { _rev: 1, log_entries: [{ id: 'y' }], deleted: {} };
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['x', 'y']); // no accidental loss
});

test('mergeStates: a reset wipes old entries the union-merge would otherwise keep', () => {
  // The classic "I pressed Reset but my data and engine came back on reopen" bug. The old copy has a
  // full log + learned expenditure and a HIGHER content _rev; the reset baseline is empty but carries
  // a _wipe watermark. The merge must NOT union the old entries or engine state back in.
  const old = { _rev: 100,
    log_entries: [{ id: 'a', date: '2026-07-08' }, { id: 'b', date: '2026-07-09' }],
    weight_entries: [{ id: 'w1', date: '2026-07-08' }],
    checkins: [{ date: '2026-07-04' }], expenditure: { kcal: 2650, n: 4 } };
  const t = old._rev + 1000;
  const reset = Store.defaultState(); reset._rev = t; reset._wipe = t; // empty baseline, watermarked
  const m = Store.mergeStates(old, reset);
  assert.deepStrictEqual(m.log_entries, []);
  assert.deepStrictEqual(m.weight_entries, []);
  assert.deepStrictEqual(m.checkins, []);
  assert.strictEqual(m.expenditure, null);        // the adaptive engine is wiped too
  assert.strictEqual(m._wipe, t);                 // watermark carried forward
  const m2 = Store.mergeStates(reset, old);       // order must not matter (pre-write vs load merge)
  assert.deepStrictEqual(m2.log_entries, []);
  assert.strictEqual(m2.expenditure, null);
});

test('mergeStates: data logged AFTER a reset is kept, and two post-reset copies still union', () => {
  const t = 500;
  const base = Store.defaultState(); base._rev = t; base._wipe = t;
  // Device A logs a meal after the reset; device B logs a different one, both descend from the wipe.
  const a = JSON.parse(JSON.stringify(base)); a._rev = t + 10; a.log_entries = [{ id: 'x', date: '2026-07-18' }];
  const b = JSON.parse(JSON.stringify(base)); b._rev = t + 20; b.log_entries = [{ id: 'y', date: '2026-07-18' }];
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.log_entries.map(e => e.id).sort(), ['x', 'y']); // fresh entries survive & union
  // But a stale pre-reset copy still can't drag old data back in against a post-reset copy.
  const stale = { _rev: t - 50, log_entries: [{ id: 'old', date: '2026-07-01' }] };
  const m2 = Store.mergeStates(a, stale);
  assert.deepStrictEqual(m2.log_entries.map(e => e.id), ['x']);
});

test('mergeStates: null-safe', () => {
  const s = { _rev: 5, log_entries: [{ id: 'a' }] };
  assert.strictEqual(Store.mergeStates(null, s), s);
  assert.strictEqual(Store.mergeStates(s, null), s);
  assert.strictEqual(Store.mergeStates(null, null), null);
});

// --- Buddy overhaul Phase 2 safety net -----------------------------------------------------------
// The Macrodex/collection removal deletes collection state (catch_log, items, dex_boost, game_salt,
// sleepDex, primed, some game_awards). These characterization tests lock in that a real user's KEEP
// data — food logs, weigh-ins, check-ins, the Amber ledger, the buddy (name/stage/cosmetics), steps,
// sleep — survives migrate() and a cross-device mergeStates() untouched. They deliberately assert
// ONLY on keep-data (never on the collection fields) so they stay green after the removal lands.
function legacyState(rev) {
  return {
    _rev: rev || 1000,
    user_id: 'u',
    profile: { goalType: 'cut', proteinTarget: 130 },
    log_entries: [
      { id: 'le1', date: '2026-07-20', meal: 'm_1', items: [{ name: 'Eggs', macros: { kcal: 150, protein: 12 } }] },
      { id: 'le2', date: '2026-07-21', meal: 'm_3', items: [{ name: 'Chicken', macros: { kcal: 300, protein: 40 } }] },
    ],
    weight_entries: [{ id: 'w1', date: '2026-07-20', scale_weight: 80.5 }],
    checkins: [{ date: '2026-07-19', weightKg: 80.7, onTrack: true }],
    amber_ledger: [
      { id: 'am1', date: '2026-07-18', delta: 50, reason: 'weekly_boss' },
      { id: 'am2', date: '2026-07-20', delta: -20, reason: 'cosmetic_party_hat' },
    ],
    buddy: { stage: 3, name: 'Chompers', personality: 'plucky', hatchedISO: '2026-07-04', speciesId: 'dinky', evoStage: 1, affinity: 'day', cosmetics: ['party_hat'] },
    steps: { '2026-07-20': 8200, '2026-07-21': 10400 },
    sleep: { '2026-07-21': { min: 430, score: 78 } },
    foods: [{ id: 'f1', name: 'Eggs' }],
    saved_meals: [{ id: 'sm1', name: 'Breakfast', items: [{ name: 'Eggs' }] }],
    targets: [{ id: 't1', kcal: 2000 }],
    fight: { rank: 4, wins: 12, trophies: 2 },
    records: { longestStreak: 21 },
    // --- collection fields being removed in Phase 2 (must not take keep-data down with them) ---
    catch_log: { '2026-07-20': [{ id: 'carbo', shiny: false }] },
    items: { lure: 2, honest_rex: 1 },
    dex_boost: { date: '2026-07-20', lure: 'protein', shiny: false, rare: true },
    game_salt: 'abc123',
    game_awards: { 'checkin_catch:2026-07-20': true, streak7: true },
    sleepDex: { claimed: { '2026-07-21': true }, lastDate: '2026-07-21', lastId: 'dozer' },
    primed: { claimed: { '2026-07-20': true }, lastDate: '2026-07-20', lastId: 'apex' },
  };
}
function assertKeepDataIntact(s) {
  assert.strictEqual(s.profile.goalType, 'cut');
  assert.strictEqual(s.log_entries.length, 2);
  assert.strictEqual(s.log_entries[0].items[0].name, 'Eggs');
  assert.strictEqual(s.weight_entries.length, 1);
  assert.strictEqual(s.weight_entries[0].scale_weight, 80.5);
  assert.strictEqual(s.checkins.length, 1);
  // Amber balance = sum of ledger deltas; the ledger is the source of the customization currency.
  assert.strictEqual((s.amber_ledger || []).reduce((n, e) => n + e.delta, 0), 30);
  assert.strictEqual(s.buddy.name, 'Chompers');
  assert.strictEqual(s.buddy.stage, 3);
  assert.deepStrictEqual(s.buddy.cosmetics, ['party_hat']);
  assert.strictEqual(s.steps['2026-07-21'], 10400);
  assert.strictEqual(s.sleep['2026-07-21'].min, 430);
  assert.strictEqual(s.fight.wins, 12);
}

test('Phase 2 safety: migrate() preserves all keep-data on a legacy collection state', () => {
  assertKeepDataIntact(Store.migrate(legacyState()));
});

test('Phase 2 safety: mergeStates() preserves keep-data merging legacy against a fresh empty state', () => {
  // A device that loaded the new (post-removal) code holds a higher _rev but no collection fields.
  const fresh = Store.migrate({ _rev: 2000, profile: { goalType: 'cut' } });
  assertKeepDataIntact(Store.mergeStates(legacyState(1000), fresh));
  assertKeepDataIntact(Store.mergeStates(fresh, legacyState(1000)));
});

test('Phase 2 safety: migrate() strips the retired Macrodex/catch state, keeps Fight + currency', () => {
  const s = Store.migrate(legacyState());
  ['catch_log', 'dex_boost', 'sleepDex', 'primed', 'eggs', 'breakthrough'].forEach(k =>
    assert.strictEqual(s[k], undefined, k + ' should be stripped'));
  // Kept: Fight trophy inventory, game_awards (badge idempotency), the Amber ledger.
  assert.deepStrictEqual(s.items, { lure: 2, honest_rex: 1 }); // inventory retained (holds Fight trophies)
  assert.ok(s.game_awards && typeof s.game_awards === 'object');
  assert.strictEqual((s.amber_ledger || []).reduce((n, e) => n + e.delta, 0), 30);
});

test('Phase 2 safety: mergeStates() unions Amber ledger + logs across two offline copies', () => {
  const a = legacyState(1000);
  const b = legacyState(3000);
  b.amber_ledger = [{ id: 'am3', date: '2026-07-22', delta: 15, reason: 'streak' }];
  b.log_entries = [{ id: 'le3', date: '2026-07-22', meal: 'm_1', items: [{ name: 'Oats' }] }];
  const m = Store.mergeStates(a, b);
  // union by id: am1+am2 (from a) + am3 (from b) => balance 30 + 15
  assert.strictEqual(m.amber_ledger.reduce((n, e) => n + e.delta, 0), 45);
  const ids = m.log_entries.map(e => e.id).sort();
  assert.deepStrictEqual(ids, ['le1', 'le2', 'le3']);
});

// ---- Buddy merge: the new stageSeen / equipped fields ----

test('mergeStates keeps stageSeen unseeded when neither side has it', () => {
  // maxNum would fold two absent markers into 0, which would make an existing stage-4 buddy read as a
  // four-stage rise and fire a celebration it never earned.
  const a = { _rev: 2, buddy: { stage: 4, name: 'Rex' } };
  const b = { _rev: 1, buddy: { stage: 4, name: 'Rex' } };
  const m = Store.mergeStates(a, b);
  assert.strictEqual(m.buddy.stageSeen, null);
});

test('mergeStates takes the highest stageSeen so a moment is never replayed', () => {
  const a = { _rev: 1, buddy: { stage: 4, stageSeen: 4 } };  // this device already showed it
  const b = { _rev: 2, buddy: { stage: 4, stageSeen: 2 } };  // this one never did
  assert.strictEqual(Store.mergeStates(a, b).buddy.stageSeen, 4);
  assert.strictEqual(Store.mergeStates(b, a).buddy.stageSeen, 4);
});

test('mergeStates unions owned cosmetics and prefers the newer copy per equipped slot', () => {
  const a = { _rev: 3, buddy: { cosmetics: ['aura_ember', 'scene_tar'], equipped: { aura: 'aura_ember' } } };
  const b = { _rev: 1, buddy: { cosmetics: ['prop_fern'], equipped: { aura: 'aura_frost', prop: 'prop_fern' } } };
  const m = Store.mergeStates(a, b);
  assert.deepStrictEqual(m.buddy.cosmetics.slice().sort(), ['aura_ember', 'prop_fern', 'scene_tar']);
  assert.strictEqual(m.buddy.equipped.aura, 'aura_ember');   // newer copy wins the slot it set
  assert.strictEqual(m.buddy.equipped.prop, 'prop_fern');    // a slot the newer copy never set survives
});

test('mergeStates preserves an explicit "taken off" slot', () => {
  const a = { _rev: 3, buddy: { cosmetics: ['aura_ember'], equipped: { aura: null } } };
  const b = { _rev: 1, buddy: { cosmetics: ['aura_ember'], equipped: { aura: 'aura_ember' } } };
  const m = Store.mergeStates(a, b);
  assert.strictEqual(m.buddy.equipped.aura, null);
  assert.ok(m.buddy.cosmetics.indexOf('aura_ember') >= 0); // still owned, just not worn
});
