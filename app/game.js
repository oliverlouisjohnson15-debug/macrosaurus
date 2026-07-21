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

  // FEED LOOP: what the buddy is craving = the first macro target not yet met today, in priority
  // order. Turns the day's macro gap into a thing to feed it. null once it is well fed.
  function buddyCraving(todayQ) {
    if (!todayQ) return 'firstmeal';
    if (!todayQ.proteinHit) return 'protein';
    if (!todayQ.fiberHit) return 'fibre';
    if (!todayQ.kcalIn) return 'fuel';
    return null;
  }

  // ---- Fight 2.0: macros are types, with a matchup triangle and a weekly boss weakness ----
  // Types cycle power > guard > swift > renew > power; balanced is neutral both ways.
  var FIGHT_TYPES = ['power', 'guard', 'swift', 'renew'];
  var TYPE_BEATS = { power: 'guard', guard: 'swift', swift: 'renew', renew: 'power' };
  var BIOME_TYPE = { protein: 'power', fat: 'guard', carb: 'swift', fibre: 'renew', apex: 'balanced', nursery: 'balanced', mythic: 'balanced' };
  var TYPE_MACRO = { power: 'protein', guard: 'fat', swift: 'carbs', renew: 'fibre' };
  function typeForBiome(biome) { return BIOME_TYPE[biome] || 'balanced'; }
  function typeMult(atk, def) {
    if (!atk || !def || atk === 'balanced' || def === 'balanced') return 1;
    if (TYPE_BEATS[atk] === def) return 1.25;   // super-effective
    if (TYPE_BEATS[def] === atk) return 0.8;    // resisted
    return 1;
  }
  // A rival/boss's type, deterministic from its name so it is stable week to week.
  function typeForName(name) { return FIGHT_TYPES[hash(String(name || '')) % FIGHT_TYPES.length]; }
  // The weekly boss's weakness = the type you should field / the macro you should eat to exploit it.
  function bossWeakness(weekKey) { return FIGHT_TYPES[seedFor('boss', weekKey) % FIGHT_TYPES.length]; }
  // Your week's loadout: protein days -> Power, fibre days -> Heal, perfect days -> Special (capped).
  function weeklyLoadout(proteinDays, fibreDays, perfectDays) {
    return { power: Math.min(3, proteinDays || 0), heal: Math.min(3, fibreDays || 0), special: Math.min(1, perfectDays || 0) };
  }
  // Attack multiplier your buddy fights at: the type matchup, plus a boss-weakness bonus when you
  // field the beating type OR ate the weakness macro enough days this week.
  function fightAtkMult(buddyType, oppType, isBoss, weaknessExploited) {
    var m = typeMult(buddyType, oppType);
    if (isBoss && weaknessExploited) m *= 1.35;
    return Math.round(m * 100) / 100;
  }
  // Pre-fight stance: the player's one tactical choice, read against the matchup. Press trades
  // defence for attack, Dig in the reverse, Steady is neutral.
  var STANCE_MULT = { press: { atk: 1.2, def: 0.85 }, steady: { atk: 1, def: 1 }, dig: { atk: 0.85, def: 1.2 } };
  function stanceMult(stance) { return STANCE_MULT[stance] || STANCE_MULT.steady; }
  var SPECIAL_ATK = 1.3;   // a spent perfect-day Special adds this attack multiplier for the bout

  // Day/night affinity (Gen 2 Espeon/Umbreon): the path the buddy takes is set by the clock at
  // the moment it evolves, i.e. whether you tend to hit your macros by day or after dark. Day is
  // 06:00-17:59, night is 18:00-05:59.
  function dayNightAffinity(hour) { return (hour >= 6 && hour < 18) ? 'day' : 'night'; }

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

  // Monthly Expedition (a rotating collection set, like a spotlight event): each calendar month
  // features one creature to chase, the same for everyone, caught by reaching a quality-day goal
  // that month. A fresh monthly hook and a guaranteed route to a creature you might not land otherwise.
  var EXPEDITION_POOL = ['veloci', 'platealon', 'triceros', 'flexor', 'noodon', 'buttron', 'frondo', 'rexosaur', 'aurora'];
  function monthlyFeatured(monthYm) { return EXPEDITION_POOL[seedFor('expedition', monthYm) % EXPEDITION_POOL.length]; }
  var EXPEDITION_GOAL = 12;
  function expeditionState(qualityDaysThisMonth) {
    var got = Math.max(0, qualityDaysThisMonth || 0);
    return { goal: EXPEDITION_GOAL, days: Math.min(got, EXPEDITION_GOAL), ready: got >= EXPEDITION_GOAL, toGo: Math.max(0, EXPEDITION_GOAL - got) };
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

  // Sleep (a Pokemon Sleep style morning encounter): a night's sleep earns a SCORE, and the score
  // powers a morning catch whose rarity climbs with how well you slept. It rewards recovery, a third
  // signal alongside showing up (breakthrough) and eating well (eggs). Each catch also carries a
  // "sleep style" collected into a small style dex. All deterministic per user + wake date.
  var SLEEP_TARGET_DEFAULT = 480; // 8h in minutes; per-user override in profile.sleepTargetMin
  var SLEEP_STYLES = ['Dozing', 'Snoozing', 'Slumbering'];
  // Sleep score 0..100, evidence-based and modelled on Fitbit's published duration / quality / restoration
  // split (Fitbit ~duration 50, quality 25, restoration 25; typical real nights cluster 72-83). We can't
  // measure restlessness or sleeping-HR restoration from Google Health stage minutes, so those points are
  // routed into the signals we CAN measure, and deep / REM are scored against their clinical healthy ranges
  // (deep/N3 ~13-23% of sleep, REM ~20-25%; sleep efficiency >=85% is "good") rather than one arbitrary
  // combined target. Points: duration 45, efficiency 20, REM 18, deep 17.
  //   - Duration 45: time asleep vs the 7-9h target (oversleeping past target does not add).
  //   - Efficiency 20: asleep / time-in-bed; ramps 0.75 (poor) -> 0.90 (excellent).
  //   - REM 18 / Deep 17: share of sleep, full credit inside the healthy band, tapering as it falls short.
  // A stage-less night returns null on purpose (no measured architecture to judge) so callers show raw
  // hours instead of a fabricated number. Refs: Fitbit sleep score (androidpolice.com/fitbit-sleep-score-
  // calculation-explainer), sleep architecture NCBI NBK19956, duration/efficiency Hirshkowitz 2015
  // (pubmed 29073412). `durationMin` = time asleep; `stages` = { deep, rem, light, awake } minutes. Pure.
  // sleepScore() is the thin wrapper returning just the number, so the score the UI shows and the breakdown
  // it explains can never drift. Returns { score, hasStages, durationMin, targetMin, asleepMin, awakeMin,
  // eff, deepShare, remShare, parts:[{key,label,points,max,detail}] }.
  function sleepScoreParts(durationMin, targetMin, stages) {
    var dur = Number(durationMin) || 0; var tgt = Number(targetMin) || SLEEP_TARGET_DEFAULT;
    var out = { score: null, hasStages: false, durationMin: Math.max(0, Math.round(dur)), targetMin: Math.round(tgt),
      asleepMin: 0, awakeMin: 0, eff: null, deepShare: null, remShare: null, parts: [] };
    if (dur <= 0 || tgt <= 0) { out.score = 0; return out; }
    var deep = stages ? (Number(stages.deep) || 0) : 0, rem = stages ? (Number(stages.rem) || 0) : 0;
    var light = stages ? (Number(stages.light) || 0) : 0, awake = stages ? (Number(stages.awake) || 0) : 0;
    var asleep = deep + rem + light;
    var total = asleep + awake;
    if (asleep > 0 && total > 0) {
      var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
      var ratio = Math.min(dur / tgt, 1);                              // time asleep vs target (no oversleep bonus)
      var durComp = 45 * ratio;
      var eff = asleep / total;                                        // fraction of the night actually asleep
      var effComp = 20 * clamp01((eff - 0.75) / (0.90 - 0.75));        // 0 at <=75%, full at >=90%
      var deepShare = deep / asleep, remShare = rem / asleep;
      var remComp = 18 * clamp01((remShare - 0.08) / (0.22 - 0.08));   // 0 at <=8%, full at healthy >=22%
      var deepComp = 17 * clamp01((deepShare - 0.05) / (0.18 - 0.05)); // 0 at <=5%, full at healthy >=18%
      out.hasStages = true;
      out.asleepMin = Math.round(asleep); out.awakeMin = Math.round(awake);
      out.eff = eff; out.deepShare = deepShare; out.remShare = remShare;
      out.parts = [
        { key: 'duration', label: 'Time asleep', points: Math.round(durComp), max: 45, detail: 'vs your ' + Math.round(tgt / 6) / 10 + 'h target' },
        { key: 'efficiency', label: 'Efficiency', points: Math.round(effComp), max: 20, detail: Math.round(eff * 100) + '% of the night asleep' },
        { key: 'rem', label: 'REM sleep', points: Math.round(remComp), max: 18, detail: Math.round(remShare * 100) + '% of sleep (healthy 20-25%)' },
        { key: 'deep', label: 'Deep sleep', points: Math.round(deepComp), max: 17, detail: Math.round(deepShare * 100) + '% of sleep (healthy 13-23%)' },
      ];
      out.score = Math.max(0, Math.min(100, Math.round(durComp + effComp + remComp + deepComp)));
      return out;
    }
    out.asleepMin = Math.round(dur); // stage-less: we know the hours but nothing about quality
    return out; // score stays null -> callers fall back to showing hours
  }
  function sleepScore(durationMin, targetMin, stages) { return sleepScoreParts(durationMin, targetMin, stages).score; }
  // Score -> rarity band. Every night above the floor still catches something (Pokemon Sleep always
  // gives an encounter); better sleep just reaches rarer pools.
  function sleepBand(score) { var s = Number(score) || 0; return s < 50 ? 'poor' : s < 75 ? 'ok' : s < 90 ? 'good' : 'great'; }
  // Which sleep style a night reads as: from the deep+REM share when stages exist, else the score.
  function sleepStyleFor(score, stages) {
    var total = stages ? (Number(stages.deep) || 0) + (Number(stages.rem) || 0) + (Number(stages.light) || 0) + (Number(stages.awake) || 0) : 0;
    if (total > 0) {
      var frac = ((Number(stages.deep) || 0) + (Number(stages.rem) || 0)) / total;
      return frac < 0.25 ? 'Dozing' : frac < 0.45 ? 'Snoozing' : 'Slumbering';
    }
    var s = Number(score) || 0; return s < 60 ? 'Dozing' : s < 85 ? 'Snoozing' : 'Slumbering';
  }
  // Rarity-banded morning pools (reuse existing creature ids), rarer as sleep improves.
  var SLEEP_POOL = {
    poor: ['dinky', 'pebble', 'sprowl', 'carbo'],
    ok: ['protops', 'fatzilla', 'noodon', 'buttron'],
    good: ['frondo', 'flexor', 'noodon', 'buttron'],
    great: ['veloci', 'platealon', 'triceros', 'flexor'],
  };
  var SLEEP_SHINY_MOD = { poor: 14, ok: 11, good: 8, great: 5 }; // better sleep shines more often
  function sleepCatch(salt, date, band) {
    var b = SLEEP_POOL[band] ? band : 'poor';
    var pool = SLEEP_POOL[b].slice();
    var h = seedFor(salt, 'sleep#' + date);
    if (b === 'great' && h % 7 === 0) pool.push('rexosaur'); // a great night can rouse a legendary
    return { id: pool[h % pool.length], shiny: seedFor(salt, 'sleepshiny#' + date) % (SLEEP_SHINY_MOD[b] || 14) === 0 };
  }

  // ---- Readiness (our own recovery score) --------------------------------------------------------
  // No wearable exposes a readiness score through the Google Health API, so we build one the evidence-based
  // way Whoop / Oura / Fitbit do: baseline-RELATIVE signals (each judged against the user's own rolling
  // average, never an absolute target), weighted with HRV dominant, degrading gracefully to whatever data
  // we actually have. HRV carries the most weight because nocturnal RMSSD is the best-validated autonomic
  // recovery marker (Buchheit 2014; Plews 2013, pubmed 23852425) and it drives Whoop/Fitbit recovery;
  // resting HR and sleep corroborate; SpO2 and load are thin/noisy so they only ever MODIFY an
  // anchored score, never produce one (a 96% SpO2 or an easy step day must not pin readiness at 100).
  // Weights when all present: HRV 40, sleep 25, RHR 20, SpO2 7 (modifier), load 8 (modifier).
  // inputs (all optional; needs at least one anchor to return a score): {
  //   sleepScore,           // last night, 0..100
  //   hrv, hrvBaseline,     // ms RMSSD, today vs personal baseline   -> higher = more recovered
  //   rhr, rhrBaseline,     // bpm, today vs baseline                 -> lower  = more recovered
  //   spo2,                 // nightly average blood-oxygen %          -> an illness / desaturation flag
  //   load, loadBaseline,   // yesterday's steps vs baseline (a big day tilts to rest)
  //   tempDev               // nightly skin-temp deviation from baseline (deg C), an illness flag (unused today)
  // }
  var READY_WEIGHTS = { sleep: 0.25, hrv: 0.40, rhr: 0.20, spo2: 0.07, load: 0.08 };
  // The full, itemised readiness calculation. readinessScore() is the thin wrapper returning just the
  // number, so what the UI shows and what it explains stay in lockstep. Returns:
  //   { score, anchored, anchorCount, tempPenaltyApplied, signals: [{ key, label, weightPct, present,
  //     value(0..100|null), modifierOnly, note }] }
  // score is null until at least one ANCHOR (sleep quality, HRV or resting HR) is present. A signal is
  // always listed whether present or not, with a note saying what it would take to light it up.
  function readinessParts(inp) {
    inp = inp || {};
    var sum = 0, weights = 0, anchored = false;
    function clamp01(v) { return Math.max(0, Math.min(1, v)); }
    var signals = [];
    // HRV balance (anchor, dominant). lnRMSSD vs baseline: raw RMSSD is right-skewed, so we compare the
    // LOG of today's value to the log of the baseline (the field standard, Plews/Buchheit; Whoop does the
    // same). A logistic maps that log-ratio to 0..1: at baseline ~0.5, ~+28% RMSSD ~0.8, ~-20% ~0.2.
    if (isFinite(inp.hrv) && isFinite(inp.hrvBaseline) && Number(inp.hrv) > 0 && Number(inp.hrvBaseline) > 0) {
      var hd = Math.log(Number(inp.hrv) / Number(inp.hrvBaseline)); var hvv = clamp01(1 / (1 + Math.exp(-6 * hd)));
      sum += READY_WEIGHTS.hrv * hvv; weights += READY_WEIGHTS.hrv; anchored = true;
      signals.push({ key: 'hrv', label: 'HRV balance', weightPct: 40, present: true, value: Math.round(hvv * 100), modifierOnly: false, note: "Last night's HRV (lnRMSSD) vs your rolling baseline." });
    } else signals.push({ key: 'hrv', label: 'HRV balance', weightPct: 40, present: false, value: null, modifierOnly: false, note: 'Needs a wearable that reports HRV.' });
    // Sleep quality (anchor). A stage-less night gives no sleepScore, so this stays dark until stages land.
    if (isFinite(inp.sleepScore)) {
      var sv = clamp01((Number(inp.sleepScore) || 0) / 100); sum += READY_WEIGHTS.sleep * sv; weights += READY_WEIGHTS.sleep; anchored = true;
      signals.push({ key: 'sleep', label: 'Sleep quality', weightPct: 25, present: true, value: Math.round(sv * 100), modifierOnly: false, note: "Last night's sleep score." });
    } else signals.push({ key: 'sleep', label: 'Sleep quality', weightPct: 25, present: false, value: null, modifierOnly: false, note: 'Needs a night with sleep stages. An hours-only night has no quality to score.' });
    // Resting HR (anchor). Lower than baseline is better; a sustained +3-7 bpm rise flags fatigue/illness
    // (pmc PMC11235883). ~10% below baseline spans most of the range; weaker evidence than HRV, so half.
    if (isFinite(inp.rhr) && isFinite(inp.rhrBaseline) && inp.rhrBaseline > 0) {
      var rd = (Number(inp.rhrBaseline) - Number(inp.rhr)) / Number(inp.rhrBaseline); var rv = clamp01(0.5 + rd * 5);
      sum += READY_WEIGHTS.rhr * rv; weights += READY_WEIGHTS.rhr; anchored = true;
      signals.push({ key: 'rhr', label: 'Resting HR', weightPct: 20, present: true, value: Math.round(rv * 100), modifierOnly: false, note: 'Today vs your rolling baseline. A rise above baseline signals fatigue.' });
    } else signals.push({ key: 'rhr', label: 'Resting HR', weightPct: 20, present: false, value: null, modifierOnly: false, note: 'Needs a wearable that reports resting heart rate.' });
    // Blood oxygen (modifier only, never an anchor). For healthy users a stable >=95% carries little
    // day-to-day signal; its value is as an illness / desaturation flag, and consumer SpO2 is noisy, so it
    // only trims an already-anchored score. Full at >=95%, 0 by ~91% (pmc PMC6594211).
    if (isFinite(inp.spo2) && Number(inp.spo2) > 0) {
      var ov2 = clamp01((Number(inp.spo2) - 91) / (95 - 91)); sum += READY_WEIGHTS.spo2 * ov2; weights += READY_WEIGHTS.spo2;
      signals.push({ key: 'spo2', label: 'Blood oxygen', weightPct: 7, present: true, value: Math.round(ov2 * 100), modifierOnly: true, note: Math.round(Number(inp.spo2) * 10) / 10 + '% overnight. A low night trims the score as an illness flag.' });
    } else signals.push({ key: 'spo2', label: 'Blood oxygen', weightPct: 7, present: false, value: null, modifierOnly: true, note: 'Needs a wearable that reports overnight SpO2.' });
    // Recent load (modifier only, never an anchor). At/under baseline is fine; a big spike tilts to rest.
    if (isFinite(inp.load) && isFinite(inp.loadBaseline) && inp.loadBaseline > 0) {
      var ov = Math.max(0, (Number(inp.load) - Number(inp.loadBaseline)) / Number(inp.loadBaseline)); var lv = clamp01(1 - Math.min(ov, 1) * 0.6);
      sum += READY_WEIGHTS.load * lv; weights += READY_WEIGHTS.load;
      signals.push({ key: 'load', label: 'Recent load', weightPct: 8, present: true, value: Math.round(lv * 100), modifierOnly: true, note: "Yesterday's steps vs baseline. Only shapes the score once a recovery signal anchors it." });
    } else signals.push({ key: 'load', label: 'Recent load', weightPct: 8, present: false, value: null, modifierOnly: true, note: 'From your recent daily steps.' });

    var anchorCount = signals.filter(function (s) { return s.present && !s.modifierOnly; }).length;
    var out = { score: null, anchored: anchored, anchorCount: anchorCount, tempPenaltyApplied: false, signals: signals };
    if (!weights || !anchored) return out; // nothing (or only thin modifier proxies) to score yet
    var score = sum / weights; // renormalise to whatever signals are present
    if (isFinite(inp.tempDev)) { score -= Math.min(Math.abs(Number(inp.tempDev)) / 1.0, 1) * 0.15; out.tempPenaltyApplied = true; } // illness knock
    out.score = Math.max(0, Math.min(100, Math.round(score * 100)));
    return out;
  }
  function readinessScore(inp) { return readinessParts(inp).score; }
  // Dino-flavoured bands. Apex = roaring and ready; Drowsy = a recovery day, not a failure.
  function readinessBand(score) { if (score == null) return null; var s = Number(score); if (!isFinite(s)) return null; return s >= 80 ? 'apex' : s >= 55 ? 'prowling' : 'drowsy'; }
  var READY_BAND = { apex: { label: 'Apex', blurb: 'Roaring and ready. Push today.' }, prowling: { label: 'Prowling', blurb: 'Steady. A normal day.' }, drowsy: { label: 'Drowsy', blurb: 'Recover. Go gentle today.' } };
  // The daily Fight buff a readiness band grants. Good sleep + recovery earns a real edge; a rough night
  // gives a defensive, self-healing stance so a recovery day still helps rather than only punishing.
  function readinessBuff(score) {
    var band = readinessBand(score);
    if (band === 'apex') return { band: band, atk: 1.15, def: 1.0, heal: 0, label: 'Well rested' };
    if (band === 'drowsy') return { band: band, atk: 0.9, def: 1.15, heal: 0.1, label: 'Recovering' };
    return { band: band || 'prowling', atk: 1.0, def: 1.0, heal: 0, label: 'Steady' };
  }
  // A "primed" morning bonus catch: an extra, rarer encounter you only earn on an Apex-readiness
  // morning, so genuinely good recovery is rewarded in the dex (distinct from the sleep-style catch).
  // Deterministic per user + date.
  var PRIMED_POOL = ['veloci', 'platealon', 'triceros', 'flexor', 'aurora'];
  function primedCatch(salt, date) {
    var h = seedFor(salt, 'primed#' + date);
    var pool = PRIMED_POOL.slice();
    if (h % 6 === 0) pool.push('rexosaur'); // a great recovery day can rouse a legendary
    return { id: pool[h % pool.length], shiny: seedFor(salt, 'primedshiny#' + date) % 5 === 0 };
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
    dayNightAffinity: dayNightAffinity,
    buddyCraving: buddyCraving,
    FIGHT_TYPES: FIGHT_TYPES,
    TYPE_MACRO: TYPE_MACRO,
    typeForBiome: typeForBiome,
    typeForName: typeForName,
    typeMult: typeMult,
    bossWeakness: bossWeakness,
    weeklyLoadout: weeklyLoadout,
    fightAtkMult: fightAtkMult,
    stanceMult: stanceMult,
    SPECIAL_ATK: SPECIAL_ATK,
    EXPEDITION_POOL: EXPEDITION_POOL,
    EXPEDITION_GOAL: EXPEDITION_GOAL,
    monthlyFeatured: monthlyFeatured,
    expeditionState: expeditionState,
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
    SLEEP_TARGET_DEFAULT: SLEEP_TARGET_DEFAULT,
    SLEEP_STYLES: SLEEP_STYLES,
    SLEEP_POOL: SLEEP_POOL,
    sleepScore: sleepScore,
    sleepScoreParts: sleepScoreParts,
    sleepBand: sleepBand,
    sleepStyleFor: sleepStyleFor,
    sleepCatch: sleepCatch,
    READY_WEIGHTS: READY_WEIGHTS,
    READY_BAND: READY_BAND,
    readinessScore: readinessScore,
    readinessParts: readinessParts,
    readinessBand: readinessBand,
    readinessBuff: readinessBuff,
    PRIMED_POOL: PRIMED_POOL,
    primedCatch: primedCatch,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
  root.Game = Game;
})(typeof window !== 'undefined' ? window : this);
