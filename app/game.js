/*
 * game.js - Pure gamification logic (framework-free, unit-tested).
 * Streak maths (logged OR weighed days), buddy high-water/sleep, badge tiers,
 * per-user catch seeding, check-in rewards and fight-attempt gating.
 * app.jsx consumes this via the Game global; tests require() it directly.
 */
(function (root) {
  'use strict';

  // LOCAL calendar date maths (mirrors store.js so days match the user's actual day).
  function isoOf(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function shiftISO(d, n) { var x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return isoOf(x); }
  function daysBetween(aISO, bISO) { return Math.floor((new Date(bISO + 'T00:00:00') - new Date(aISO + 'T00:00:00')) / 86400000); }

  // FNV-1a string hash, the app's stable roll source.
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // Per-user daily seed: stable for one user+date, diverges between users. An empty
  // salt reproduces the legacy date-only hash so pre-salt accounts don't shift.
  function seedFor(salt, date) { return hash(salt ? salt + '|' + date : date); }
  function makeSalt() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); }

  // Consecutive ACTIVE days (a food log OR a weigh-in) ending today, with a monthly
  // "streak freeze" forgiving a single missed day per calendar month (auto-applied).
  // Returns the streak plus any newly frozen dates to persist.
  function computeStreak(activeSet, frozenSet, today) {
    var monthUsed = {}; frozenSet.forEach(function (fd) { monthUsed[fd.slice(0, 7)] = true; });
    var d = (activeSet.has(today) || frozenSet.has(today)) ? today : shiftISO(today, -1);
    var streak = 0; var newFrozen = [];
    while (true) {
      if (activeSet.has(d) || frozenSet.has(d)) { streak++; d = shiftISO(d, -1); continue; }
      var mo = d.slice(0, 7); var prev = shiftISO(d, -1);
      if (!monthUsed[mo] && (activeSet.has(prev) || frozenSet.has(prev))) { monthUsed[mo] = true; newFrozen.push(d); streak++; d = prev; continue; }
      break;
    }
    return { streak: streak, newFrozen: newFrozen };
  }
  function freezeReady(frozenSet, today) { var mo = today.slice(0, 7); var ok = true; frozenSet.forEach(function (fd) { if (fd.slice(0, 7) === mo) ok = false; }); return ok; }

  // Buddy stage thresholds (art lives in app.jsx alongside the sprites).
  var STAGE_MINS = [0, 1, 3, 7, 14, 30];
  var WAKE_DAYS = 3;
  function stageIndex(streak) { var si = 0; STAGE_MINS.forEach(function (m, i) { if (streak >= m) si = i; }); return si; }
  // High-water buddy: the stage never falls back to the egg. After a break the buddy
  // shows its best-ever stage ASLEEP, and wakes once the new run reaches WAKE_DAYS
  // active days. The stage only ratchets up when the current run beats the high water.
  function buddyView(hwStage, streak) {
    var cur = stageIndex(streak || 0);
    var hw = Math.max(hwStage || 0, cur);
    var asleep = cur < hw && (streak || 0) < WAKE_DAYS;
    return { stage: hw, cur: cur, asleep: asleep, wakeIn: asleep ? WAKE_DAYS - (streak || 0) : 0, ratchet: cur > (hwStage || 0) };
  }

  // ---- Buddy as a companion: bond, mood and needs (the Tamagotchi layer) ----
  // BOND is relationship warmth over a trailing window: recent good eating raises it,
  // neglect lets it cool. It takes one "quality" object per elapsed day in the window
  // (or null for a day with no log). Effort elsewhere is never wasted (the dex persists);
  // the bond itself can cool, which is what makes the buddy feel alive without punishing.
  var BOND_WINDOW = 30;
  var BOND_HEARTS = [15, 40, 65, 88];   // score needed for hearts 1..4 (of 4)
  function dayBondPoints(q) {
    if (!q || !q.logged) return 0;
    var p = 1;                          // showed up and logged
    if (q.proteinHit) p += 1;
    if (q.fiberHit) p += 0.5;
    if (q.perfect) p += 1.5;
    return p;                           // 0..4 points for one day
  }
  function buddyBond(recentQ) {
    var win = (recentQ || []).slice(-BOND_WINDOW);
    if (!win.length) return { score: 0, hearts: 0, maxHearts: BOND_HEARTS.length, toNext: BOND_HEARTS[0] };
    var got = 0; for (var i = 0; i < win.length; i++) got += dayBondPoints(win[i]);
    var score = Math.max(0, Math.min(100, Math.round(got / (win.length * 4) * 100)));
    var hearts = 0; BOND_HEARTS.forEach(function (t) { if (score >= t) hearts++; });
    var next = hearts < BOND_HEARTS.length ? BOND_HEARTS[hearts] : null;
    return { score: score, hearts: hearts, maxHearts: BOND_HEARTS.length, toNext: next == null ? 0 : next - score };
  }
  // MOOD: one word for how the buddy is right now, from the nap state and today's eating.
  function buddyMood(asleep, loggedToday, todayQ) {
    if (asleep) return 'asleep';
    if (!loggedToday) return 'sluggish';
    if (todayQ && todayQ.perfect) return 'thriving';
    if (todayQ && todayQ.proteinHit && todayQ.kcalIn) return 'content';
    return 'peckish';
  }
  // EVOLUTION (Gen 2 friendship): the buddy evolves along its species line only when it has
  // BOTH grown (cumulative quality days = level) AND is well cared for (bond hearts). Sequential
  // (no skipping) and computed as an eligibility; the caller stores it high-water so a cooled
  // bond never de-evolves an already-evolved buddy. `ats` = the species' per-stage day
  // thresholds, `heartReqs` = hearts needed for each stage. Returns the eligible stage (0..N).
  function buddyEvoStage(level, hearts, ats, heartReqs) {
    var reqs = heartReqs || [];
    var n = 0;
    for (var k = 0; k < (ats || []).length; k++) {
      if ((level || 0) >= ats[k] && (hearts || 0) >= (reqs[k] || 0)) n = k + 1; else break;
    }
    return n;
  }

  // NEEDS: three 0..1 meters topped up by eating well. Fed = logged today, Nourished =
  // today's macro balance, Energy = current streak toward a full week.
  function buddyNeeds(loggedToday, todayQ, streak) {
    var flags = todayQ ? [todayQ.proteinHit, todayQ.carbHit, todayQ.fatHit, todayQ.kcalIn, todayQ.fiberHit] : [];
    var hit = 0; flags.forEach(function (f) { if (f) hit++; });
    return {
      hunger: loggedToday ? 1 : 0.12,
      nourish: todayQ ? hit / 5 : (loggedToday ? 0.1 : 0),
      energy: Math.max(0, Math.min(1, (streak || 0) / 7)),
    };
  }

  // Badge tracks (Avatar-style): 5 tiers, level = tiers already reached.
  var BADGE_TIERS = [1, 3, 6, 12, 24];
  function badgeTier(count, tiers) {
    var t = tiers || BADGE_TIERS; var n = count || 0;
    var level = 0; t.forEach(function (x) { if (n >= x) level++; });
    var next = level < t.length ? t[level] : null;
    var prev = level > 0 ? t[level - 1] : 0;
    var progress = next == null ? 1 : Math.max(0, Math.min(1, (n - prev) / (next - prev)));
    return { level: level, max: t.length, next: next, prev: prev, progress: progress };
  }

  // Guaranteed check-in catch: a boosted pool that is at least rare-eligible
  // (every completed check-in, any outcome, catches from here). Deterministic per user+date.
  var CHECKIN_POOL = ['flexor', 'noodon', 'buttron', 'frondo', 'veloci', 'platealon', 'triceros'];
  function checkinCatch(salt, date) {
    var h = seedFor(salt, date + '#checkin');
    var pool = CHECKIN_POOL.slice();
    if (h % 14 === 0) pool.push('rexosaur'); // same rexosaur cadence as daily catches, per-user
    return { id: pool[h % pool.length], shiny: seedFor(salt, date + '#cishiny') % 11 === 0 };
  }

  // Fight gating: one ladder attempt per day, and only on a day with food logged.
  function fightGate(lastAttemptDate, loggedToday, today) {
    if (lastAttemptDate === today) return { can: false, reason: 'used' };
    if (!loggedToday) return { can: false, reason: 'nolog' };
    return { can: true, reason: null };
  }

  // Trailing chain of check-ins completed on schedule: each at most 9 days after the previous.
  function checkinChainLen(dates) {
    if (!dates || !dates.length) return 0;
    var ds = dates.slice().sort();
    var n = 1;
    for (var i = ds.length - 1; i > 0; i--) {
      if (daysBetween(ds[i - 1], ds[i]) <= 9) n++; else break;
    }
    return n;
  }

  // In-range check-in: the cycle's actual weekly change landed within 0.1 kg/wk of the
  // target rate (a hold-on-goal passes via the same maths with target 0).
  function checkinInRange(actualKgPerWk, targetKgPerWk) {
    if (actualKgPerWk == null || targetKgPerWk == null || isNaN(actualKgPerWk) || isNaN(targetKgPerWk)) return false;
    return Math.abs(actualKgPerWk - targetKgPerWk) <= 0.1;
  }

  // Migratory creature: unique logged days inside a calendar month ('YYYY-MM').
  function monthlyLogCount(dates, ym) {
    var seen = {}; var n = 0;
    (dates || []).forEach(function (d) { if (d && d.slice(0, 7) === ym && !seen[d]) { seen[d] = true; n++; } });
    return n;
  }

  // Weekly Breakthrough (a Pokemon GO style Research Breakthrough): a rolling 7-stamp
  // meter. Each logged day adds one stamp; every 7 logged days earns a Breakthrough
  // reward. Counting starts from a per-user baseline (the logged-day count when the
  // feature first ran) so existing history never dumps a pile of rewards at once.
  var BREAKTHROUGH_GOAL = 7;
  function breakthroughState(totalLoggedDays, base) {
    var earned = Math.max(0, (totalLoggedDays || 0) - (base || 0));
    return {
      stamps: earned % BREAKTHROUGH_GOAL,          // 0..6, position on the current card
      goal: BREAKTHROUGH_GOAL,
      earnedDays: earned,                          // logged days since the baseline
      breakthroughs: Math.floor(earned / BREAKTHROUGH_GOAL), // total breakthroughs unlocked
      toNext: BREAKTHROUGH_GOAL - (earned % BREAKTHROUGH_GOAL), // logged days until the next one
    };
  }
  // The guaranteed rare-or-better catch a Breakthrough awards. Deterministic per user and
  // breakthrough index, with a boosted shiny chance so the reward always feels special.
  var BREAKTHROUGH_POOL = ['flexor', 'veloci', 'platealon', 'triceros'];
  function breakthroughCatch(salt, n) {
    var h = seedFor(salt, 'breakthrough#' + n);
    var pool = BREAKTHROUGH_POOL.slice();
    if (h % 8 === 0) pool.push('rexosaur'); // an occasional legendary
    return { id: pool[h % pool.length], shiny: seedFor(salt, 'btshiny#' + n) % 6 === 0 };
  }

  // Egg incubation (a Pokemon GO style egg): a single egg always incubates, its "distance" is
  // QUALITY days (days you logged, hit protein and landed calories), so it rewards eating well
  // rather than just showing up. Eggs come in 2 / 5 / 10-day tiers; rarer tiers hatch rarer
  // creatures. One hatches, the next appears, forever.
  var EGG_TIERS = [2, 5, 10];
  function eggProgress(qualityDaysElapsed, tier) {
    var q = Math.max(0, qualityDaysElapsed || 0);
    return { steps: Math.min(q, tier), tier: tier, ready: q >= tier, toGo: Math.max(0, tier - q) };
  }
  // The tier of the next egg to appear, weighted toward the quicker tiers. Deterministic per user + index.
  function nextEggTier(salt, n) { var r = seedFor(salt, 'eggtier#' + n) % 100; return r < 55 ? 2 : r < 88 ? 5 : 10; }
  // What a tier hatches into. Tiers map to rarity bands; the 10-day egg can crack a legendary.
  var EGG_POOL = {
    2: ['dinky', 'pebble', 'protops', 'carbo', 'fatzilla', 'sprowl'],
    5: ['noodon', 'buttron', 'frondo', 'flexor'],
    10: ['veloci', 'platealon', 'triceros', 'flexor'],
  };
  function eggHatch(salt, tier, n) {
    var pool = (EGG_POOL[tier] || EGG_POOL[2]).slice();
    var h = seedFor(salt, 'egg#' + tier + '#' + n);
    if (tier >= 10 && h % 6 === 0) pool.push('rexosaur');
    var shinyMod = tier >= 10 ? 5 : tier >= 5 ? 8 : 12; // rarer tiers shine more often
    return { id: pool[h % pool.length], shiny: seedFor(salt, 'eggshiny#' + tier + '#' + n) % shinyMod === 0, tier: tier };
  }

  var Game = {
    shiftISO: shiftISO,
    daysBetween: daysBetween,
    hash: hash,
    seedFor: seedFor,
    makeSalt: makeSalt,
    computeStreak: computeStreak,
    freezeReady: freezeReady,
    STAGE_MINS: STAGE_MINS,
    WAKE_DAYS: WAKE_DAYS,
    stageIndex: stageIndex,
    buddyView: buddyView,
    BOND_WINDOW: BOND_WINDOW,
    dayBondPoints: dayBondPoints,
    buddyBond: buddyBond,
    buddyMood: buddyMood,
    buddyNeeds: buddyNeeds,
    buddyEvoStage: buddyEvoStage,
    BADGE_TIERS: BADGE_TIERS,
    badgeTier: badgeTier,
    CHECKIN_POOL: CHECKIN_POOL,
    checkinCatch: checkinCatch,
    fightGate: fightGate,
    checkinChainLen: checkinChainLen,
    checkinInRange: checkinInRange,
    monthlyLogCount: monthlyLogCount,
    BREAKTHROUGH_GOAL: BREAKTHROUGH_GOAL,
    breakthroughState: breakthroughState,
    breakthroughCatch: breakthroughCatch,
    EGG_TIERS: EGG_TIERS,
    eggProgress: eggProgress,
    nextEggTier: nextEggTier,
    eggHatch: eggHatch,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
  root.Game = Game;
})(typeof window !== 'undefined' ? window : this);
