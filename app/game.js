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
  // `plannedSet` holds days inside a declared window (a holiday the user told us about at check-in).
  // Those days BRIDGE a run without extending it: a declared absence must not snap a streak, but
  // awarding days for it would pay people to declare holidays and the number would stop meaning
  // "days I showed up". They also must not spend the monthly freeze.
  function computeStreak(activeSet, frozenSet, today, plannedSet) {
    var planned = plannedSet || new Set();
    var monthUsed = {}; frozenSet.forEach(function (fd) { monthUsed[fd.slice(0, 7)] = true; });
    var d = (activeSet.has(today) || frozenSet.has(today) || planned.has(today)) ? today : shiftISO(today, -1);
    var streak = 0; var newFrozen = [];
    while (true) {
      if (activeSet.has(d) || frozenSet.has(d)) { streak++; d = shiftISO(d, -1); continue; }
      if (planned.has(d)) { d = shiftISO(d, -1); continue; }   // bridged, not counted
      var mo = d.slice(0, 7); var prev = shiftISO(d, -1);
      if (!monthUsed[mo] && (activeSet.has(prev) || frozenSet.has(prev) || planned.has(prev))) { monthUsed[mo] = true; newFrozen.push(d); streak++; d = prev; continue; }
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
  // The growth stage that deserves a celebration right now, or null. `stageSeen` is the highest stage
  // already celebrated (db.buddy.stageSeen). A NULL stageSeen means the account predates the marker,
  // so we return null rather than firing a retroactive moment for growth the user has long since had;
  // the caller seeds stageSeen to the current stage once, and every rise after that is celebrated.
  function stageUp(stage, stageSeen) {
    if (stageSeen == null) return null;
    var s = stage || 0;
    return s > stageSeen ? s : null;
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
    if (todayQ && todayQ.kcalOver) return 'stuffed'; // well over calories: full and lazy
    return 'peckish';                                 // logged but under / not on target yet
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
  var SLEEP_STYLES = ['Dozing', 'Snoozing', 'Slumbering'];
  // Sleep duration is judged against the SCIENCE, not a user-set target: adults need 7-9 hours a night
  // (Hirshkowitz 2015, National Sleep Foundation consensus). Rather than pinning "full credit" to a single
  // 8h point, we credit the WHOLE recommended 7-9h band in full - hitting the guideline is the thing the
  // duration component rewards, and docking someone for sleeping 7h (squarely in range) was the old model's
  // biggest unrealism. Below 7h duration ramps down to a 4.5h floor; above 9h a gentle taper treats
  // habitual over-sleep as a soft negative (long sleep tracks worse outcomes / fragmented rest, so 11h+ is
  // not "better" than 8h). Nothing editable feeds any of this.
  var SLEEP_RECOMMENDED_MIN = 420;  // 7h -> full duration credit begins (bottom of the recommended band)
  var SLEEP_RECOMMENDED_MAX = 540;  // 9h -> full duration credit ends (top of the recommended band)
  var SLEEP_DURATION_FLOOR = 270;   // 4.5h -> no duration credit below this (severe short sleep)
  var SLEEP_OVERSLEEP_FLOOR = 660;  // 11h -> over-sleep taper bottoms out here (retains 75% of duration credit)
  var SLEEP_RECOMMENDED_FULL = 480; // 8h, a "reference full night" kept for the stage-less catch-score fallback
  // Sleep score 0..100, evidence-based and modelled on the common duration / quality / restoration
  // split (~duration 45, quality 55; typical real nights cluster 72-83). We can't measure restlessness or
  // sleeping-HR restoration from Google Health stage minutes, so those points are routed into the signals
  // we CAN measure, and deep / REM are scored against their clinical healthy ranges (deep/N3 ~13-23% of
  // sleep, REM ~20-25%; sleep efficiency >=85% is "good"). Points: duration 45, efficiency 20, REM 18, deep 17.
  //   - Duration 45: time asleep vs the recommended range; full across 7-9h, 0 below 4.5h, tapering to 75%
  //     credit by 11h+ (over-sleep is a soft negative, never a bonus).
  //   - Efficiency 20: asleep / time-in-bed; 0 at 78%, full at very-healthy >=93% (85%+ is "good", per the sleep-efficiency literature).
  //   - REM 18 / Deep 17: share of sleep; full credit only at the good end of the healthy band, 0 well below.
  // The QUALITY ramps (efficiency, REM, deep) are deliberately STRICT so the score keeps its discriminative
  // power: crediting the recommended duration range in full lifts a solid-but-ordinary night into the good
  // band (high 70s / low 80s, matching real-world spread), while 90+ still demands genuinely excellent
  // efficiency and architecture rather than just time in bed.
  // A stage-less night returns null on purpose (no measured architecture to judge) so callers show raw
  // hours instead of a fabricated number. Refs: sleep architecture NCBI NBK19956, duration/efficiency Hirshkowitz 2015
  // (pubmed 29073412), long-sleep risk Jike 2018 (pmid 28890167). `durationMin` = time asleep; `stages` = { deep, rem, light, awake } minutes. Pure.
  // sleepScore() is the thin wrapper returning just the number, so the score the UI shows and the breakdown
  // it explains can never drift. Returns { score, hasStages, durationMin, asleepMin, awakeMin,
  // eff, deepShare, remShare, parts:[{key,label,points,max,detail}] }.
  function sleepScoreParts(durationMin, stages) {
    var dur = Number(durationMin) || 0;
    var out = { score: null, hasStages: false, durationMin: Math.max(0, Math.round(dur)),
      asleepMin: 0, awakeMin: 0, eff: null, deepShare: null, remShare: null, parts: [] };
    if (dur <= 0) { out.score = 0; return out; }
    var deep = stages ? (Number(stages.deep) || 0) : 0, rem = stages ? (Number(stages.rem) || 0) : 0;
    var light = stages ? (Number(stages.light) || 0) : 0, awake = stages ? (Number(stages.awake) || 0) : 0;
    var asleep = deep + rem + light;
    var total = asleep + awake;
    if (asleep > 0 && total > 0) {
      var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
      // Duration: full across the recommended 7-9h band, ramping down below 7h to a 4.5h floor, then a
      // gentle over-sleep taper above 9h (bottoming at 75% credit by 11h+). Rewarding the whole guideline
      // range - not a single 8h point - is the key realism fix: a 7h night no longer reads as a shortfall.
      var durComp;
      if (dur >= SLEEP_RECOMMENDED_MIN && dur <= SLEEP_RECOMMENDED_MAX) {
        durComp = 45;                                                 // 7-9h: full credit (hit the guideline)
      } else if (dur < SLEEP_RECOMMENDED_MIN) {
        durComp = 45 * clamp01((dur - SLEEP_DURATION_FLOOR) / (SLEEP_RECOMMENDED_MIN - SLEEP_DURATION_FLOOR)); // 0 at <=4.5h -> full at 7h
      } else {
        durComp = 45 * (1 - 0.25 * clamp01((dur - SLEEP_RECOMMENDED_MAX) / (SLEEP_OVERSLEEP_FLOOR - SLEEP_RECOMMENDED_MAX))); // >9h taper, floors at 0.75*45 by 11h
      }
      // Quality ramps stay strict: full credit only at the GOOD end of each range, so ordinary quality
      // earns partial credit and 90+ needs a genuinely excellent night rather than just time in bed.
      var eff = asleep / total;                                        // fraction of the night actually asleep
      var effComp = 20 * clamp01((eff - 0.78) / (0.93 - 0.78));        // 0 at <=78%, full at very-healthy >=93% (85%+ is the healthy threshold, 90%+ excellent)
      var deepShare = deep / asleep, remShare = rem / asleep;
      var remComp = 18 * clamp01((remShare - 0.12) / (0.22 - 0.12));   // 0 at <=12%, full at healthy >=22%
      var deepComp = 17 * clamp01((deepShare - 0.09) / (0.18 - 0.09)); // 0 at <=9%, full at healthy >=18%
      out.hasStages = true;
      out.asleepMin = Math.round(asleep); out.awakeMin = Math.round(awake);
      out.eff = eff; out.deepShare = deepShare; out.remShare = remShare;
      out.parts = [
        { key: 'duration', label: 'Time asleep', points: Math.round(durComp), max: 45, detail: Math.round(dur / 6) / 10 + 'h asleep (full credit across the recommended 7-9h)' },
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
  function sleepScore(durationMin, stages) { return sleepScoreParts(durationMin, stages).score; }
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
  // way the recovery-score literature does: baseline-RELATIVE signals (each judged against the user's own rolling
  // average, never an absolute target), weighted with HRV dominant, degrading gracefully to whatever data
  // we actually have. HRV carries the most weight because nocturnal RMSSD is the best-validated autonomic
  // recovery marker (Buchheit 2014; Plews 2013, pubmed 23852425) and it drives most recovery scores;
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
    // LOG of today's value to the log of the baseline (the field standard, Plews/Buchheit). A logistic
    // maps that log-ratio to 0..1: at baseline ~0.5, ~+28% RMSSD ~0.8, ~-20% ~0.2.
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
  var READY_BAND = { apex: { label: 'High', blurb: 'Roaring and ready. Push today.' }, prowling: { label: 'Steady', blurb: 'Steady. A normal day.' }, drowsy: { label: 'Low', blurb: 'Recover. Go gentle today.' } };
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

  // ---- Daily Hunt: a small, deterministic-per-day mini-boss, tuned easier than the weekly boss ----
  // The visual roster lives in app.jsx; here we pick a STABLE index + type + power for a date so the
  // same hunt shows all day and differs day to day (power 2..4 vs the weekly boss's 6..7).
  function dailyHunt(date, rosterLen) {
    var n = Math.max(1, rosterLen || 1);
    return {
      idx: seedFor('dailyhunt', date) % n,
      type: FIGHT_TYPES[seedFor('dailytype', date) % FIGHT_TYPES.length],
      power: 2 + (seedFor('dailypow', date) % 3), // 2..4
    };
  }
  // Daily hunt is available once per calendar day.
  function dailyReady(lastDailyDate, today) { return lastDailyDate !== today; }
  // Daily-clear streak: consecutive days you beat the hunt. Beating it the very next day extends the
  // streak; a gap of more than a day gently resets to 1 (never below, never a punishment).
  function dailyStreakNext(lastDailyDate, curStreak, today) {
    if (!lastDailyDate) return 1;
    if (lastDailyDate === today) return curStreak || 1; // already counted today
    return daysBetween(lastDailyDate, today) === 1 ? (curStreak || 0) + 1 : 1;
  }

  // ---- Amber: the spendable currency, an APPEND-ONLY LEDGER so it merges conflict-free (like catch_log) ----
  // Never store Amber as a bare mutable number: the state merge unions append-only collections, so a
  // ledger of {id, date, delta, reason} entries can never be lost or double-counted. Balance = sum(delta).
  var AMBER_REWARDS = { daily: 15, dailyStreakBonus: 10, weekly: 60, weeklyFirst: 25, ladderRung: 5, perfectDay: 8, dailyLog: 10 };
  // The daily hunt pays a little; every 5th clear in a row tops up, so consistency compounds.
  function amberDailyReward(streak) {
    var base = AMBER_REWARDS.daily;
    if (streak > 0 && streak % 5 === 0) base += AMBER_REWARDS.dailyStreakBonus;
    return base;
  }
  function amberBalance(ledger) {
    var b = 0; (ledger || []).forEach(function (e) { b += (e && Number(e.delta)) || 0; });
    return Math.max(0, Math.round(b));
  }

  // ---- Shop: spend Amber on buddy cosmetics. Prices are pure and stable. ----
  // Three slots, one equipped item each, all drawn in app.jsx (art lives beside the sprites):
  //   aura  - an FX glow around the buddy sprite (AURA_GLOW)
  //   scene - the terrarium backdrop the buddy stands in (SCENE_ART)
  //   prop  - a single pixel decoration on the terrarium floor (PROP_ART)
  // Emoji hats/faces read poorly over 24x24 pixel art, so worn cosmetics stay out; scenes and props
  // dress the habitat instead, which is art we already have and scales without new sprite work.
  // Ownership lives in db.buddy.cosmetics (unioned on merge, so a purchase can never be lost); which
  // of the owned items is actually worn lives in db.buddy.equipped (see equippedFor).
  var COSMETIC_KINDS = ['aura', 'scene', 'prop'];
  var COSMETICS = [
    { id: 'aura_ember', name: 'Ember Aura', kind: 'aura', price: 180, desc: 'A warm ember glow that follows your buddy.' },
    { id: 'aura_frost', name: 'Frost Aura', kind: 'aura', price: 180, desc: 'A cool blue shimmer that trails your buddy.' },
    { id: 'aura_spark', name: 'Spark Aura', kind: 'aura', price: 220, desc: 'A golden sparkle that dances around your buddy.' },
    { id: 'aura_toxic', name: 'Toxic Aura', kind: 'aura', price: 220, desc: 'An eerie green haze, for the apex predator.' },
    { id: 'scene_fern', name: 'Fern Hollow', kind: 'scene', price: 140, desc: 'A green, overgrown clearing full of soft light.' },
    { id: 'scene_dusk', name: 'Dusk Ridge', kind: 'scene', price: 160, desc: 'Warm evening sun sinking behind the ridge.' },
    { id: 'scene_tar', name: 'Tar Pit', kind: 'scene', price: 200, desc: 'Bubbling black tar under a smoky orange sky.' },
    { id: 'scene_frost', name: 'Frost Cavern', kind: 'scene', price: 200, desc: 'Pale blue ice, still and very quiet.' },
    { id: 'scene_aurora', name: 'Aurora Basin', kind: 'scene', price: 260, desc: 'Northern lights rippling over a deep violet sky.' },
    { id: 'prop_fern', name: 'Fern', kind: 'prop', price: 90, desc: 'A leafy fern for the corner of the terrarium.' },
    { id: 'prop_rock', name: 'Standing Stone', kind: 'prop', price: 110, desc: 'A weathered boulder to bask against.' },
    { id: 'prop_cycad', name: 'Cycad', kind: 'prop', price: 140, desc: 'A broad prehistoric palm, good for shade.' },
    { id: 'prop_nest', name: 'Nest Egg', kind: 'prop', price: 160, desc: 'A spare egg, kept safe beside your buddy.' },
  ];
  var COSMETIC_BY_ID = {}; COSMETICS.forEach(function (c) { COSMETIC_BY_ID[c.id] = c; });
  function cosmeticsOfKind(kind) { return COSMETICS.filter(function (c) { return c.kind === kind; }); }
  function shopPrice(id) { return COSMETIC_BY_ID[id] ? COSMETIC_BY_ID[id].price : null; }
  function canAfford(ledger, id) { var p = shopPrice(id); return p != null && amberBalance(ledger) >= p; }
  // What the buddy is actually wearing, per slot: { aura, scene, prop }, each an id or null.
  // `owned` is db.buddy.cosmetics, `equipped` is db.buddy.equipped (a slot -> id map).
  //   - A slot PRESENT in `equipped` is an explicit choice: the id if it is genuinely owned and of
  //     that kind, else null (this is also how "take it off" is stored, as an explicit null).
  //   - A slot ABSENT from `equipped` falls back to the last owned item of that kind, which is what
  //     the old own-it-and-it-is-worn behaviour did. That keeps accounts that predate the equipped
  //     map (aura buyers) looking exactly as they did before, with no migration.
  function equippedFor(owned, equipped) {
    var ownedSet = {}; (owned || []).forEach(function (id) { if (id != null) ownedSet[id] = 1; });
    var fallback = {};
    (owned || []).forEach(function (id) { var c = COSMETIC_BY_ID[id]; if (c) fallback[c.kind] = id; });
    var out = {};
    COSMETIC_KINDS.forEach(function (kind) {
      if (equipped && Object.prototype.hasOwnProperty.call(equipped, kind)) {
        var pick = equipped[kind];
        var c = pick ? COSMETIC_BY_ID[pick] : null;
        out[kind] = (c && c.kind === kind && ownedSet[pick]) ? pick : null;
      } else {
        out[kind] = fallback[kind] || null;
      }
    });
    return out;
  }

  // ---- Buddy attentiveness: streak-save, weekly recap, goal milestones ----
  // These are the pure decisions behind the buddy's proactive lines; the UI (app.jsx) gathers the
  // inputs and writes the prose, so the maths stays framework-free and unit-tested.

  // A streak is worth protecting when there's a run going, today has no activity yet (a food log OR a
  // weigh-in both count), and the day is running out. Callers pass activeToday and the current hour.
  function streakAtRisk(streak, activeToday, hour, eveningHour) {
    var h = (hour == null) ? 0 : hour;
    return (streak || 0) >= 2 && !activeToday && h >= (eveningHour || 18);
  }

  // ---- Training: what the buddy is entitled to say about lifting ----
  // Same division of labour as every line above: this decides WHETHER to speak and WHICH thing to
  // say, and app.jsx writes the words. Fed by Training.trainingSummary, so the buddy can never
  // contradict the Train tab.
  //
  // The bar for speaking is set deliberately high. Somebody running a block already has a tab that
  // tells them what is next, and a companion repeating it every morning is exactly the "streak
  // anxiety" failure the gamification research warns about (see TRAINING_UI_REVIEW). So the buddy
  // speaks when something CHANGED - a session went in, a week closed, a block finished - or when
  // enough time has passed that saying nothing would be the odder choice. On a day where training
  // is simply ticking along, it stays quiet and lets the food lines have the slot.
  var TRAIN_LAPSE_DAYS = 10;   // long enough that it reads as concern rather than nagging
  var TRAIN_DUE_DAYS = 2;      // a rest day is a rest day; two of them is worth a gentle word
  function trainingAsk(summary, hour) {
    var s = summary;
    if (!s || !s.everTrained) return null;           // never lifted: Train is not the buddy's business yet
    var h = (hour == null) ? 12 : hour;
    var b = s.block;
    // 1. It happened today. The warmest thing available and the only one tied to an event, so it
    //    outranks everything, and it carries no CTA because the work is already done.
    if (s.trainedToday) {
      var weekDone = !!(b && b.sessionsThisWeek > 0 && b.doneThisWeek >= b.sessionsThisWeek);
      return { kind: weekDone ? 'week_done' : 'trained_today', sessionsLast7: s.sessionsLast7,
        week: b ? b.week : null, weeks: b ? b.weeks : null };
    }
    // 2. A finished block is an unclaimed payoff sitting in the app, not a nudge to do more.
    if (b && b.finished) return { kind: 'block_finished', name: b.name };
    // 3. Gone quiet. No number of missed sessions, no percentage: just how long it has been.
    if (s.daysSinceSession != null && s.daysSinceSession >= TRAIN_LAPSE_DAYS) {
      return { kind: 'lapsed', days: s.daysSinceSession };
    }
    // 4. A session is waiting and a couple of days have passed. Evening only: telling somebody at
    //    8am what they should do after work is guessing at a day that has not happened yet.
    if (b && b.nextSession && !b.deloadWeek && h >= 16
      && s.daysSinceSession != null && s.daysSinceSession >= TRAIN_DUE_DAYS) {
      return { kind: 'session_due', session: b.nextSession, days: s.daysSinceSession,
        done: b.doneThisWeek, of: b.sessionsThisWeek };
    }
    // 5. A lift that has not moved in a month. Genuinely useful, rare, and the fix lives in the app.
    if (b && (s.stalledLifts || []).length) return { kind: 'stalled', lift: s.stalledLifts[0] };
    return null;
  }

  // ---- Weigh-in cadence: WHEN the buddy should ask for a weight ----
  // Weighing is the one thing the plan cannot be tuned without, and the honest reading is the one
  // taken first thing, before food or drink. So the buddy asks in the morning rather than leaving
  // people to find the scale log themselves: every day for a most-days weigher, and only on their
  // chosen day for a once-a-week one. Pure (the caller passes the date and hour) so both the app's
  // priority ladder and the push sender can share one definition of "due".
  var WEIGH_MORNING_END = 12;   // "first thing" runs until midday, local
  var WEIGH_STALE_DAYS = 2;     // a daily weigher who missed the morning is only chased after a gap
  var WEIGH_WEEKLY_GRACE = 8;   // a weekly weigher who missed their day gets asked again after this

  function weekdayOf(iso) { return new Date(iso + 'T00:00:00').getDay(); }

  // Should the buddy ask for a weight right now? Returns null (say nothing) or a small decision:
  //   kind 'daily'  - the morning ask for a most-days weigher
  //   kind 'weekly' - it is the weigh day a once-a-week weigher picked
  //   kind 'missed' - overdue whatever the cadence, so ask whenever they next open the app
  // opts: { cadence, weighDay, today, hour, weighedToday, lastWeighISO }. An unset cadence reads as
  // 'daily' (the recommended default) so a legacy account still gets asked.
  function weighDue(opts) {
    var o = opts || {};
    if (o.weighedToday) return null;
    var hour = o.hour == null ? 9 : o.hour;
    var morning = hour < WEIGH_MORNING_END;
    var since = o.lastWeighISO ? daysBetween(o.lastWeighISO, o.today) : null;
    if (o.cadence === 'single') {
      var day = o.weighDay == null ? null : +o.weighDay;
      if (day != null && weekdayOf(o.today) === day) return { kind: 'weekly', morning: morning, day: day };
      // Off-day silence is the whole point of the weekly cadence, so only an overdue gap breaks it.
      if (since == null || since >= WEIGH_WEEKLY_GRACE) return { kind: 'missed', morning: morning, day: day };
      return null;
    }
    if (morning) return { kind: 'daily', morning: true, day: null };
    // Past midday the daily ask has had its moment: chase only once a real gap has opened up, so an
    // afternoon open the day after a weigh-in stays quiet.
    if (since == null || since >= WEIGH_STALE_DAYS) return { kind: 'missed', morning: false, day: null };
    return null;
  }

  // Aggregate a 7-day window for the weekly recap. `days` is an array of
  // { logged, kcal, protein, proteinTarget }; `weight` is { startKg, endKg } for the week's trend, or
  // null. Returns plain numbers only, so the caller owns all wording and unit formatting.
  function weeklyRecap(days, weight) {
    days = days || [];
    var loggedDays = days.filter(function (d) { return d && d.logged; });
    var kcals = loggedDays.map(function (d) { return +d.kcal || 0; }).filter(function (k) { return k > 0; });
    var avgKcal = kcals.length ? Math.round(kcals.reduce(function (a, b) { return a + b; }, 0) / kcals.length) : 0;
    // Protein counts as "hit" when it lands within 10% of that day's target (and a target existed).
    var proteinDaysHit = loggedDays.filter(function (d) { return d.proteinTarget > 0 && (+d.protein || 0) >= d.proteinTarget * 0.9; }).length;
    var tgts = loggedDays.map(function (d) { return +d.proteinTarget || 0; }).filter(function (t) { return t > 0; });
    var proteinTarget = tgts.length ? Math.round(tgts.reduce(function (a, b) { return a + b; }, 0) / tgts.length) : 0;
    var trendDeltaKg = (weight && weight.startKg != null && weight.endKg != null) ? Math.round((weight.endKg - weight.startKg) * 10) / 10 : null;
    return { daysLogged: loggedDays.length, totalDays: days.length, avgKcal: avgKcal, proteinDaysHit: proteinDaysHit, proteinTarget: proteinTarget, trendDeltaKg: trendDeltaKg };
  }

  // The next uncelebrated goal milestone, or null. Fires the biggest whole-kg step of net progress not
  // yet shown, plus a one-off "reached" when the trend meets the goal. `celebrated` is the keys already
  // shown; coveredKeys lets the caller mark everything up to here at once, so a big jump (e.g. a first
  // weigh-in already 3kg down) pops once rather than queueing a backlog.
  function goalMilestone(opts) {
    opts = opts || {};
    var goalType = opts.goalType, startKg = opts.startKg, currentKg = opts.currentKg, goalKg = opts.goalKg;
    var celebrated = opts.celebrated || [];
    if (goalType !== 'cut' && goalType !== 'gain') return null;
    if (startKg == null || currentKg == null) return null;
    var seen = {}; celebrated.forEach(function (k) { seen[k] = true; });
    var progress = goalType === 'cut' ? (startKg - currentKg) : (currentKg - startKg);
    var m = Math.floor(progress + 1e-9);
    var reached = goalKg != null && (goalType === 'cut' ? currentKg <= goalKg + 0.05 : currentKg >= goalKg - 0.05);
    if (reached && !seen.goal) {
      // Reaching the goal also sweeps up every interim kg milestone, so none backlog and pop afterwards.
      var all = ['goal'];
      for (var j = 1; j <= m; j++) all.push('m' + j);
      return { key: 'goal', kind: 'reached', kg: null, coveredKeys: all };
    }
    if (m >= 1) {
      var key = 'm' + m;
      if (!seen[key]) {
        var covered = [];
        for (var i = 1; i <= m; i++) covered.push('m' + i);
        return { key: key, kind: 'progress', kg: m, coveredKeys: covered };
      }
    }
    return null;
  }

  // Weekly rate of change from a series of { date, kg } trend points (already smoothed upstream). Uses
  // the span from the earliest to latest point, requiring at least a week between them so a single noisy
  // day can't swing it. Returns kg/week (negative = losing), or null when there isn't enough spread.
  function trendRatePerWeek(points) {
    var pts = (points || []).filter(function (p) { return p && p.kg != null; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (pts.length < 2) return null;
    var first = pts[0], last = pts[pts.length - 1];
    var days = daysBetween(first.date, last.date);
    if (days < 7) return null;
    return (last.kg - first.kg) / (days / 7);
  }

  // Weeks to the goal at the current pace, or null when a projection wouldn't be honest: no goal or rate,
  // a near-flat or wrong-direction rate, or already there (that's a milestone, not a projection). Capped
  // so a crawling pace doesn't promise an absurd horizon.
  function goalETA(opts) {
    opts = opts || {};
    var goalType = opts.goalType, currentKg = opts.currentKg, goalKg = opts.goalKg, rate = opts.ratePerWeek;
    if ((goalType !== 'cut' && goalType !== 'gain') || currentKg == null || goalKg == null || rate == null) return null;
    var remaining = goalType === 'cut' ? currentKg - goalKg : goalKg - currentKg;
    if (remaining <= 0.1) return null;                 // essentially there already
    var speed = goalType === 'cut' ? -rate : rate;     // progress per week in the goal's direction
    if (speed < 0.05) return null;                     // flat or heading the wrong way: no honest ETA
    var weeks = Math.max(1, Math.ceil(remaining / speed));
    if (weeks > 104) return null;                      // beyond ~2 years, don't put a scary number on it
    return { weeks: weeks, remainingKg: Math.round(remaining * 10) / 10 };
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
    stageUp: stageUp,
    BOND_WINDOW: BOND_WINDOW,
    dayBondPoints: dayBondPoints,
    buddyBond: buddyBond,
    buddyMood: buddyMood,
    buddyNeeds: buddyNeeds,
    buddyEvoStage: buddyEvoStage,
    dayNightAffinity: dayNightAffinity,
    buddyCraving: buddyCraving,
    trainingAsk: trainingAsk,
    TRAIN_LAPSE_DAYS: TRAIN_LAPSE_DAYS,
    TRAIN_DUE_DAYS: TRAIN_DUE_DAYS,
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
    SLEEP_RECOMMENDED_FULL: SLEEP_RECOMMENDED_FULL,
    SLEEP_RECOMMENDED_MIN: SLEEP_RECOMMENDED_MIN,
    SLEEP_RECOMMENDED_MAX: SLEEP_RECOMMENDED_MAX,
    SLEEP_DURATION_FLOOR: SLEEP_DURATION_FLOOR,
    SLEEP_OVERSLEEP_FLOOR: SLEEP_OVERSLEEP_FLOOR,
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
    dailyHunt: dailyHunt,
    dailyReady: dailyReady,
    dailyStreakNext: dailyStreakNext,
    AMBER_REWARDS: AMBER_REWARDS,
    amberDailyReward: amberDailyReward,
    amberBalance: amberBalance,
    COSMETICS: COSMETICS,
    COSMETIC_BY_ID: COSMETIC_BY_ID,
    COSMETIC_KINDS: COSMETIC_KINDS,
    cosmeticsOfKind: cosmeticsOfKind,
    equippedFor: equippedFor,
    shopPrice: shopPrice,
    canAfford: canAfford,
    streakAtRisk: streakAtRisk,
    WEIGH_MORNING_END: WEIGH_MORNING_END,
    WEIGH_STALE_DAYS: WEIGH_STALE_DAYS,
    WEIGH_WEEKLY_GRACE: WEIGH_WEEKLY_GRACE,
    weighDue: weighDue,
    weeklyRecap: weeklyRecap,
    goalMilestone: goalMilestone,
    trendRatePerWeek: trendRatePerWeek,
    goalETA: goalETA,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
  root.Game = Game;
})(typeof window !== 'undefined' ? window : this);
