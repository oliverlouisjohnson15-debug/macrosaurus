/*
 * engine.js - Adaptive nutrition engine (pure, framework-free)
 * Weights in KG internally; body fat is a percent. Exposes window.Engine + Node module.exports.
 * v2: steps+training TDEE model, moderate protein, calorie cycling + carryover. See PLAN.md §3–4.
 */
(function (root) {
  'use strict';

  var KCAL_PER_KG = 7700;
  var KCAL_PER_STEP_PER_KG = 0.00057; // ~0.04 kcal/step at 70kg; scales with bodyweight
  var KCAL_PER_GYM_SESSION_PER_KG = 5.5; // ~410 kcal for a 75kg lifter, moderate-hard session
  var RESTING_MULT = 1.2; // BMR + thermic effect of food + baseline (non-step) daily movement
  var DIET_STYLE_FAT_PCT = { balanced: 0.28, lower_carb: 0.38, higher_carb: 0.22 };
  var KCAL_FLOOR = 1200; // absolute daily-calorie floor for female/unknown; males get 1500 via kcalFloor()
  var KCAL_FLOOR_MALE = 1500;
  var FAT_FLOOR_G_PER_KG = 0.8;      // default fat floor, PLAN sec 3.4
  var FAT_HARD_MIN_G_PER_KG = 0.5;   // hard minimum, only reached when the kcal budget is squeezed
  var COMPLETE_DAY_MIN_PCT = 0.6;    // a logged day under 60% of its target counts as incomplete

  // One principled, sex-scaled floor for initial targets, adaptive changes, and cycling low days.
  function kcalFloor(profile) { return (profile && profile.sex === 'male') ? KCAL_FLOOR_MALE : KCAL_FLOOR; }

  function round(n, dp) { var f = Math.pow(10, dp || 0); return Math.round(n * f) / f; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  function mifflinBMR(p) {
    var s = p.sex === 'male' ? 5 : -161;
    return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + s;
  }

  // Transparent activity model from average daily steps + weekly gym sessions.
  function tdeeBreakdown(p) {
    var bmr = mifflinBMR(p);
    var resting = bmr * RESTING_MULT;
    var stepsKcal = (p.avgSteps || 0) * KCAL_PER_STEP_PER_KG * p.weightKg;
    var gymKcal = ((p.gymSessionsPerWeek || 0) * KCAL_PER_GYM_SESSION_PER_KG * p.weightKg) / 7;
    var tdee = resting + stepsKcal + gymKcal;
    return {
      bmr: round(bmr), resting: round(resting),
      stepsKcal: round(stepsKcal), gymKcal: round(gymKcal), tdee: round(tdee),
    };
  }
  function tdeeFromProfile(p) { return tdeeBreakdown(p).tdee; }

  // Evidence-based sustainable rate guardrail. Helms et al.: ~0.5–1% of bodyweight/week during a cut
  // best preserves lean mass, with leaner dieters sitting at the slower end; lean bulks want roughly
  // 0.25–0.5%/week to limit fat gain (Nippard). Returns the recommended ceiling (kg/wk), the user's
  // target, and whether they're above it, used to warn, not to silently override the user's choice.
  function rateGuidance(p) {
    var bw = p.weightKg || 0;
    var target = Math.abs(p.rateKgPerWeek || 0);
    if (p.goalType === 'maintain') return { maxKg: 0, pctCap: 0, targetKg: 0, tooFast: false };
    var pctCap;
    if (p.goalType === 'gain') { pctCap = 0.005; }
    else { // cut, tighten for lean individuals
      var bf = p.bodyFatPct;
      var lean = (bf != null) && ((p.sex === 'male' && bf < 12) || (p.sex !== 'male' && bf < 20));
      pctCap = lean ? 0.0075 : 0.01;
    }
    var maxKg = round(bw * pctCap, 2);
    return { maxKg: maxKg, pctCap: pctCap, targetKg: round(target, 2), tooFast: target > maxKg + 1e-9, pctOfBW: bw ? round((target / bw) * 100, 2) : 0 };
  }

  function goalDailyDelta(goalType, rateKgPerWeek) {
    var perDay = (Math.abs(rateKgPerWeek || 0) * KCAL_PER_KG) / 7;
    if (goalType === 'cut') return -perDay;
    if (goalType === 'gain') return perDay;
    return 0;
  }

  function fatFreeMassKg(weightKg, bodyFatPct) {
    if (bodyFatPct == null || isNaN(bodyFatPct)) return null;
    return weightKg * (1 - bodyFatPct / 100);
  }

  // Reference mass for protein: lean (fat-free) mass when body fat is known,
  // otherwise fall back to bodyweight. Sizing protein to lean mass avoids
  // over-prescribing it for higher-body-fat users.
  function proteinReferenceKg(p) {
    var ffm = fatFreeMassKg(p.weightKg, p.bodyFatPct);
    return (ffm != null && ffm > 0) ? ffm : p.weightKg;
  }
  // Goal-aware default protein, expressed per kg of LEAN (fat-free) mass.
  // Grounded in Helms et al. 2014 (2.3-3.1 g/kg FFM during an energy deficit,
  // scaled up with leanness/deficit severity) and Nippard's practical ranges
  // (cut 1.8-2.7 g/kg bodyweight, maintain/gain 1.6-2.2 g/kg bodyweight).
  // On a lean-mass basis these map to roughly: cut 2.4, maintain 2.1, gain 2.0.
  var DEFAULT_PROTEIN_G_PER_KG_LBM = { cut: 2.4, maintain: 2.1, gain: 2.0 };
  function defaultProteinPerKgLBM(goalType) {
    return DEFAULT_PROTEIN_G_PER_KG_LBM[goalType] || 2.2;
  }
  // Evidence-based protein: manual gram target, else user's g/kg lean, else goal default.
  function proteinGrams(p) {
    if (p.proteinManualG) return Math.round(+p.proteinManualG);
    var gPerKg = p.proteinGPerKgLBM || defaultProteinPerKgLBM(p.goalType);
    return Math.round(gPerKg * proteinReferenceKg(p));
  }

  // Macro split from a kcal budget. No ranges (removed by design).
  // When protein + floor fat cannot fit inside the kcal budget, reconcile: trim fat down to the
  // 0.5 g/kg hard minimum first, then trim protein, and flag the result as squeezed so the UI can
  // warn that the target sits at the safety floor and the desired rate may be unachievable.
  function macrosFromKcal(kcal, profile) {
    var protein_g = proteinGrams(profile);
    var fatPct = DIET_STYLE_FAT_PCT[profile.dietStyle] || DIET_STYLE_FAT_PCT.balanced;
    var fatFloor = FAT_FLOOR_G_PER_KG * profile.weightKg;
    var fat_g = Math.max(fatFloor, (kcal * fatPct) / 9);
    var squeezed = false;
    if (protein_g * 4 + fat_g * 9 > kcal) {
      squeezed = true;
      var fatMin = FAT_HARD_MIN_G_PER_KG * profile.weightKg;
      fat_g = Math.max(fatMin, (kcal - protein_g * 4) / 9);
      if (protein_g * 4 + fat_g * 9 > kcal) {
        protein_g = Math.max(0, Math.floor((kcal - fat_g * 9) / 4));
      }
    }
    var carbs_g = Math.max(0, (kcal - protein_g * 4 - fat_g * 9) / 4);
    var out = { kcal: round(kcal), protein_g: Math.round(protein_g), fat_g: round(fat_g), carbs_g: round(carbs_g) };
    if (squeezed) out.squeezed = true;
    return out;
  }

  // Adequate daily fiber, scaled to the day's calories (~12 g per 1000 kcal),
  // kept in a realistic, achievable band (18–38 g). `min` is the goal to aim for.
  function fiberTarget(kcal) {
    var goal = Math.round(clamp((kcal / 1000) * 12, 18, 38));
    return { min: goal, max: goal + 10 };
  }

  // opts.priorTdee: a recent, adaptively learned TDEE. When provided it replaces the formula TDEE,
  // so a goal change or profile edit builds on what the app has learned instead of resetting to Mifflin.
  function computeInitialTargets(profile, opts) {
    var bd = tdeeBreakdown(profile);
    var prior = (opts && opts.priorTdee != null && isFinite(+opts.priorTdee) && +opts.priorTdee > 0) ? round(+opts.priorTdee) : null;
    var baseTdee = prior != null ? prior : bd.tdee;
    var kcal = baseTdee + goalDailyDelta(profile.goalType, profile.rateKgPerWeek);
    if (profile.proteinManualG && profile.manualKcal) kcal = +profile.manualKcal; // fully manual override
    // Absolute health floor only, so the rate slider keeps reducing calories across its full range.
    if (kcal < kcalFloor(profile)) kcal = kcalFloor(profile);
    var out = macrosFromKcal(kcal, profile);
    out.estimatedTDEE = baseTdee;
    out.tdeeBreakdown = bd;
    out.source = prior != null ? 'formula+learned' : 'formula';
    return out;
  }

  // ---- calorie cycling: high/low days, weekly total preserved ----
  // config: { enabled, highDays:[0..6 (0=Sun)], deltaPct }
  // Optional floorKcal: when the low-day drop would push below the floor, the low days clamp AT the
  // floor and the high-day bumps shrink proportionally so the week still nets to the base target
  // (or as close as the floor allows).
  function cyclingDelta(config, weekday, baseKcal, floorKcal) {
    if (!config || !config.enabled || !config.highDays || !config.highDays.length) return 0;
    var nHigh = config.highDays.length;
    if (nHigh >= 7) return 0;
    var nLow = 7 - nHigh;
    var bump = baseKcal * (config.deltaPct || 0.15);
    var lowDelta = -(nHigh * bump) / nLow;
    if (floorKcal != null && baseKcal + lowDelta < floorKcal) {
      lowDelta = Math.min(0, floorKcal - baseKcal);
      bump = (nLow * -lowDelta) / nHigh;
    }
    if (config.highDays.indexOf(weekday) !== -1) return round(bump);
    return round(lowDelta);
  }

  // ---- carryover (aggressive): bank yesterday's surplus/deficit into today ----
  function carryover(prevTargetKcal, prevConsumedKcal, capKcal) {
    var cap = capKcal == null ? 500 : capKcal;
    return round(clamp(prevTargetKcal - prevConsumedKcal, -cap, cap));
  }

  // ---- carryover (dispersed): spread the cycle's accumulated surplus/deficit
  // evenly across the remaining days of the check-in cycle (incl. today) ----
  function carryoverDispersed(accumulatedKcal, remainingDays, capKcal) {
    var cap = capKcal == null ? 500 : capKcal;
    var n = remainingDays < 1 ? 1 : remainingDays;
    return round(clamp(accumulatedKcal / n, -cap, cap));
  }

  // Apply a kcal delta to a base target, holding protein & fat, flexing carbs.
  function applyKcalDelta(base, deltaKcal) {
    var kcal = Math.max(0, base.kcal + deltaKcal);
    var carbs_g = Math.max(0, (kcal - base.protein_g * 4 - base.fat_g * 9) / 4);
    return { kcal: round(kcal), protein_g: base.protein_g, fat_g: base.fat_g, carbs_g: round(carbs_g), deltaKcal: round(deltaKcal) };
  }

  // ---- trend + adaptive ----
  // Gap-aware EMA: a 5-day gap between weigh-ins decays the trend as five daily steps would
  // (effAlpha = 1 - (1-alpha)^gapDays), so sparse weighing can't freeze the trend in the past.
  // Non-ISO or same-day dates fall back to a single step, matching the old behaviour.
  function trendSeries(entries, alpha) {
    alpha = alpha == null ? 0.1 : alpha;
    var out = [], trend = null, prevDate = null;
    for (var i = 0; i < entries.length; i++) {
      var w = entries[i].weightKg;
      if (trend == null) trend = w;
      else {
        var gap = prevDate != null ? daysBetweenISO(prevDate, entries[i].date) : 1;
        if (!isFinite(gap) || gap < 1) gap = 1;
        var effAlpha = 1 - Math.pow(1 - alpha, gap);
        trend = trend + effAlpha * (w - trend);
      }
      prevDate = entries[i].date;
      out.push({ date: entries[i].date, weightKg: w, trendKg: round(trend, 2) });
    }
    return out;
  }

  // A logged day with under 60% of its target is treated as incomplete (forgot to finish logging),
  // and excluded from intake averages, carryover maths and "days logged" coverage counts.
  function isCompleteDay(kcalLogged, targetKcal) {
    var k = +kcalLogged || 0;
    if (k <= 0) return false;
    var t = +targetKcal || 0;
    if (t <= 0) return true; // nothing to judge against, count any logged day
    return k >= t * COMPLETE_DAY_MIN_PCT;
  }

  // ---- persistent smoothed expenditure ----
  // prior: { kcal, n } where kcal is the current smoothed TDEE (seed it from the Mifflin formula at
  // n=0) and n counts absorbed check-ins. estimate: this cycle's raw TDEE estimate. conf: 0..1 data
  // quality. The gain ramps with n so early cycles lean on the formula prior and, after ~3-4 cycles,
  // the observed data dominates; low-confidence cycles always move the estimate less.
  function updateExpenditure(prior, estimate, conf) {
    var est = +estimate;
    if (!isFinite(est)) return prior || null;
    var c = clamp(conf == null ? 0.5 : +conf, 0, 1);
    var pk = (prior && isFinite(+prior.kcal)) ? +prior.kcal : null;
    var n = (prior && isFinite(+prior.n)) ? Math.max(0, +prior.n) : 0;
    if (pk == null) return { kcal: round(est), n: 1, k: 1 };
    var k = c * clamp((n + 1) / 5, 0.2, 0.6);
    return { kcal: round(pk + k * (est - pk)), n: n + 1, k: round(k, 3) };
  }

  // ---- plateau detection ----
  // A cut is plateaued when the most recent >= minCycles consecutive check-ins were adherent,
  // trended nearly flat (|weekly change| < rateThreshold kg/wk) AND stepped calories down, i.e.
  // repeated cuts are no longer producing movement. History entries need { adhered, weeklyChangeKg,
  // deltaKcal }; anything missing those fields (older persisted state) safely breaks the run.
  function detectPlateau(checkins, goalType, opts) {
    var minRun = (opts && opts.minCycles) || 2;
    var thresh = (opts && opts.rateThreshold) || 0.15;
    if (goalType !== 'cut' || !checkins || !checkins.length) return { plateau: false, cycles: 0 };
    var run = 0;
    for (var i = checkins.length - 1; i >= 0; i--) {
      var c = checkins[i] || {};
      if (c.adhered === false) break;
      if (c.weeklyChangeKg == null || c.deltaKcal == null) break;
      if (Math.abs(+c.weeklyChangeKg) < thresh && +c.deltaKcal < 0) run++;
      else break;
    }
    return { plateau: run >= minRun, cycles: run };
  }

  // Menstrual-cycle phase for a date, from a logged last-period start and average cycle length.
  // Extracellular water rises through the luteal phase, PEAKS on the first day of flow, and clears
  // over the next ~3-5 days (White 2011, 765 cycles); the nadir is the mid-follicular phase. So the
  // scale reads high for non-fat reasons across the premenstrual week and the first ~3 days of the
  // period. lowWater flags the cleanest weigh-in window (mid-follicular). Returns null unless on.
  function menstrualPhase(cfg, dateISO) {
    if (!cfg || !cfg.enabled || !cfg.lastStart) return null;
    var len = clamp(Math.round(+cfg.cycleLen || 28), 21, 40);
    var elapsed = daysBetweenISO(cfg.lastStart, dateISO);
    if (!(elapsed >= 0)) return null;
    var day = ((elapsed % len) + len) % len;                  // 0-indexed day of the current cycle
    var waterHigh = (day >= len - 7) || (day <= 2);           // premenstrual week + day-1 peak and its clear-out
    var lowWater = day >= 5 && day <= 13;                      // mid-follicular nadir: the cleanest read
    var phase = day <= 4 ? 'menstrual' : day <= 12 ? 'follicular' : day <= 15 ? 'ovulatory' : 'luteal';
    return { cycleDay: day, cycleLen: len, phase: phase, waterHigh: waterHigh, lowWater: lowWater, daysToNext: len - day };
  }

  function estimateExpenditure(opts) {
    var avgKcal = mean(opts.dailyKcal);
    var weeklyChangeKg = ((opts.trendEndKg - opts.trendStartKg) / opts.days) * 7;
    var tdee = avgKcal - (weeklyChangeKg * KCAL_PER_KG) / 7;
    return { tdee: round(tdee), avgKcal: round(avgKcal), weeklyChangeKg: round(weeklyChangeKg, 3), days: opts.days };
  }

  function weeklyAdjust(opts) {
    var profile = opts.profile;
    var currentKcal = opts.currentTargets.kcal;
    var bmr = mifflinBMR(profile);
    var goalDelta = goalDailyDelta(profile.goalType, profile.rateKgPerWeek);

    var minDays = opts.minDays || 5;
    var periodDays = opts.periodDays || (opts.estimate && opts.estimate.days) || 7;
    if (opts.adherenceDays < minDays) {
      return { changed: false, reason: 'Only ' + opts.adherenceDays + '/' + periodDays + ' days logged this cycle. I\'ll hold your targets. Log a fuller cycle and I\'ll dial them in.', estimate: opts.estimate };
    }
    if (opts.estimate.tdee < bmr * 1.05) {
      return { changed: false, underReportFlagged: true, reason: 'Your numbers imply an expenditure (' + opts.estimate.tdee + ' kcal) near or below your BMR (' + round(bmr) + '), which usually means food was under-logged. Trusting your weight trend and holding targets this cycle.', estimate: opts.estimate };
    }
    // Cap each check-in's move PROPORTIONAL to estimated burn (bigger person / bigger adaptation ->
    // bigger allowed step; ~10% of TDEE, 150-350 kcal), THEN scale that by how confident this cycle's
    // data is, coverage of logging and weigh-ins, and cycle length. A clean, complete cycle earns
    // the full step; a sparser one moves more cautiously so noise can't drive a big swing. Follows
    // Helms/Nippard practical sizing and MacroFactor's expenditure-scaled, smoothed adjustments.
    var logCov = clamp((opts.adherenceDays || 0) / periodDays, 0, 1);
    var weighCov = clamp((opts.weighDays != null ? opts.weighDays : (opts.adherenceDays || 0)) / periodDays, 0, 1);
    var conf = clamp(Math.min(logCov, weighCov) * clamp(periodDays / 7, 0.6, 1), 0, 1);
    var confidence = conf >= 0.85 ? 'high' : conf >= 0.6 ? 'medium' : 'low';
    // Smoothed expenditure: when a prior { kcal, n } state is supplied, fold this cycle's raw
    // estimate into it (confidence-scaled) and build the desired target on the SMOOTHED burn,
    // not the noisy single-cycle read. Without a prior (legacy callers), use the raw estimate.
    var smoothed = null, burnRef = opts.estimate.tdee;
    if (opts.expenditure && isFinite(+opts.expenditure.kcal)) {
      smoothed = updateExpenditure(opts.expenditure, opts.estimate.tdee, conf);
      burnRef = smoothed.kcal;
    }
    var desiredKcal = burnRef + goalDelta;
    // Deadband: a difference smaller than measurement noise is not worth chasing. Hold instead of
    // proposing a token change. Uses the estimate's uncertainty band when one is available.
    var noiseKcal = (opts.estimate.band != null && isFinite(+opts.estimate.band)) ? clamp(+opts.estimate.band, 50, 150) : 50;
    if (Math.abs(desiredKcal - currentKcal) < noiseKcal) {
      var actual0 = opts.estimate.weeklyChangeKg;
      return { changed: false, direction: 'unchanged', holdWithinNoise: true, deltaKcal: 0, confidence: confidence,
        expectedKgPerWeek: round(profile.goalType === 'cut' ? -Math.abs(profile.rateKgPerWeek || 0) : profile.goalType === 'gain' ? Math.abs(profile.rateKgPerWeek || 0) : 0, 2),
        actualKgPerWeek: round(actual0, 3), expenditure: smoothed,
        reason: 'Holding steady, your current ' + currentKcal + ' kcal target is within measurement noise of the ideal (' + round(desiredKcal) + ' kcal). No change worth making.', estimate: opts.estimate };
    }
    var fullCap = clamp(round(0.10 * (burnRef || currentKcal)), 150, 350);
    var adjCap = clamp(round(fullCap * (0.5 + 0.5 * conf)), 100, 350);
    var cappedDelta = clamp(desiredKcal - currentKcal, -adjCap, adjCap);
    var newKcal = Math.max(kcalFloor(profile), currentKcal + cappedDelta);
    var newTargets = macrosFromKcal(newKcal, profile);
    newTargets.estimatedTDEE = round(burnRef);
    newTargets.source = 'adaptive';
    var dir = cappedDelta > 0.5 ? 'up' : (cappedDelta < -0.5 ? 'down' : 'unchanged');

    // Menstrual water hold: a premenstrual water rise can masquerade as a stall (or a gain), so never
    // CUT calories on it. Hold this cycle and let the first check-in after the period read the trend
    // cleanly. Increases (dir up) are still safe and go through as normal.
    if (opts.waterHigh && dir === 'down') {
      var expW = profile.goalType === 'cut' ? -Math.abs(profile.rateKgPerWeek || 0) : profile.goalType === 'gain' ? Math.abs(profile.rateKgPerWeek || 0) : 0;
      return { changed: false, direction: 'unchanged', deltaKcal: 0, confidence: confidence, waterHeld: true,
        expectedKgPerWeek: round(expW, 2), actualKgPerWeek: round(opts.estimate.weeklyChangeKg, 3), expenditure: smoothed,
        reason: 'This cycle overlaps the water-weight rise around your period (it peaks on day one of your period and can look like a stall). Rather than cut on what\'s most likely water, not fat, I\'m holding you at ' + currentKcal + ' kcal. A check-in in the week after your period reads cleanest.', estimate: opts.estimate };
    }

    // ---- transparent, blunt-but-friendly explanation of the change ----
    var unit = profile.weight_unit;
    function rt(kg) { return unit === 'st_lb' ? (Math.abs(kg) * 2.20462).toFixed(1) + ' lb' : Math.abs(kg).toFixed(2) + ' kg'; }
    var goal = profile.goalType;
    var actual = opts.estimate.weeklyChangeKg; // -ve = losing
    var expected = goal === 'cut' ? -Math.abs(profile.rateKgPerWeek || 0) : goal === 'gain' ? Math.abs(profile.rateKgPerWeek || 0) : 0;
    var actualStr = actual < -0.02 ? 'losing ' + rt(actual) + '/wk' : actual > 0.02 ? 'gaining ' + rt(actual) + '/wk' : 'holding steady';
    var deltaR = Math.abs(round(cappedDelta));
    var newKcalR = round(newKcal);
    var reason;
    if (dir === 'unchanged') {
      if (goal === 'maintain') reason = 'You\'re ' + actualStr + '. Steady, exactly the plan. Keeping you at ' + newKcalR + ' kcal. No change, nice work.';
      else reason = 'Your goal is to ' + (goal === 'cut' ? 'lose' : 'gain') + ' ' + rt(expected) + '/wk and you\'re ' + actualStr + '. Bang on target. No change: keep doing exactly what you\'re doing.';
    } else {
      var why;
      if (goal === 'cut') {
        why = dir === 'down'
          ? 'That\'s slower than the ' + rt(expected) + '/wk you\'re aiming for' + (actual > 0.02 ? ' (you actually went up)' : '') + ', so to get fat loss moving again I\'m dropping you '
          : 'That\'s faster than your ' + rt(expected) + '/wk target. Great going, but to protect muscle and keep it sustainable I\'m giving you back ';
      } else if (goal === 'gain') {
        why = dir === 'up'
          ? 'That\'s slower than the ' + rt(expected) + '/wk you\'re aiming for' + (actual <= 0 ? ' (you didn\'t gain)' : '') + ', so to keep the muscle coming I\'m adding '
          : 'That\'s faster than your ' + rt(expected) + '/wk target, and extra gain that quick is mostly fat, so I\'m trimming ';
      } else {
        why = actual < 0 ? 'You\'re meant to hold steady but you\'re drifting down, so to stop the slide I\'m adding ' : 'You\'re meant to hold steady but you\'re drifting up, so to bring it back I\'m trimming ';
      }
      reason = 'You\'re ' + actualStr + '. ' + why + deltaR + ' kcal, to ' + newKcalR + ' kcal. (Your food and weight point to burning ~' + round(burnRef) + ' kcal a day.) Protein stays ' + newTargets.protein_g + ' g.';
    }
    return { changed: dir !== 'unchanged', direction: dir, deltaKcal: round(cappedDelta), adjCap: round(adjCap), confidence: confidence, expectedKgPerWeek: round(expected, 2), actualKgPerWeek: round(actual, 3), newTargets: newTargets, reason: reason, estimate: opts.estimate, expenditure: smoothed };
  }

  // First-cycle (no prior baseline) adjustment. Early rapid weight change is largely water and glycogen,
  // not fat, and a short window is noisy, so instead of a full retune we give a SMALL, science-scaled
  // nudge in the "eat more" direction when a cut runs faster than target (or trim a too-fast gain). The
  // nudge scales with how far past target you are, is discounted for water plus the short window
  // (keep only 25-60%, rising toward a fortnight), and is hard-capped. Normal cycle-vs-cycle adjustment
  // (weeklyAdjust) takes over from the second check-in once a real baseline exists.
  function earlyAdjust(opts) {
    var profile = opts.profile;
    var currentKcal = opts.currentTargets.kcal;
    var minDays = opts.minDays || 5;
    var periodDays = opts.periodDays || (opts.estimate && opts.estimate.days) || 7;
    var unit = profile.weight_unit;
    var goal = profile.goalType;
    var actual = opts.estimate.weeklyChangeKg; // -ve = losing
    var target = goal === 'cut' ? -Math.abs(profile.rateKgPerWeek || 0) : goal === 'gain' ? Math.abs(profile.rateKgPerWeek || 0) : 0;
    function rt(kg) { return unit === 'st_lb' ? (Math.abs(kg) * 2.20462).toFixed(1) + ' lb' : Math.abs(kg).toFixed(2) + ' kg'; }
    var actualStr = actual < -0.02 ? 'losing ' + rt(actual) + '/wk' : actual > 0.02 ? 'gaining ' + rt(actual) + '/wk' : 'holding steady';
    if (opts.adherenceDays < minDays) {
      return { changed: false, earlyPhase: true, reason: 'Only ' + opts.adherenceDays + '/' + periodDays + ' days logged this cycle, so I\'m holding your targets. Log a fuller cycle and I\'ll dial them in.', estimate: opts.estimate };
    }
    // Only act on a CLEAR deviation past target (>0.25 kg/wk), and only in the "eat more" direction this
    // early, so noisy first-week data can never over-cut you.
    var pastTarget = 0, dir = 'unchanged';
    if (goal === 'cut' && actual < target - 0.25) { pastTarget = Math.abs(actual) - Math.abs(target); dir = 'up'; }
    else if (goal === 'gain' && actual > target + 0.25) { pastTarget = actual - target; dir = 'down'; }
    var earlyCap = opts.earlyCap || 150;
    var fullGiveBack = pastTarget * KCAL_PER_KG / 7;                 // kcal/day if the excess were all fat
    var earlyFactor = clamp(periodDays / 14, 0.25, 0.6);            // discount water + short-window noise
    var nudge = clamp(round(fullGiveBack * earlyFactor / 10) * 10, 0, earlyCap);
    if (opts.waterHigh && dir === 'down') {
      return { changed: false, earlyPhase: true, direction: 'unchanged', waterHeld: true, expectedKgPerWeek: round(target, 2), actualKgPerWeek: round(actual, 3),
        reason: 'You\'re ' + actualStr + ', but this cycle overlaps the water-weight rise around your period, so I\'m holding rather than trimming on what\'s likely water, not fat. A check-in in the week after your period reads cleanest.', estimate: opts.estimate };
    }
    if (dir === 'unchanged' || nudge < 25) {
      return { changed: false, earlyPhase: true, direction: 'unchanged', expectedKgPerWeek: round(target, 2), actualKgPerWeek: round(actual, 3),
        reason: 'You\'re ' + actualStr + '. This early it\'s a short, noisy read and a lot of any first-fortnight change is water, not fat, so I\'m holding for now. Keep logging and weighing daily and I\'ll retune from your settled trend.', estimate: opts.estimate };
    }
    var signed = dir === 'up' ? nudge : -nudge;
    var newKcal = Math.max(kcalFloor(profile), currentKcal + signed);
    var newTargets = macrosFromKcal(newKcal, profile);
    newTargets.estimatedTDEE = opts.estimate.tdee;
    newTargets.source = 'adaptive-early';
    var reason = goal === 'gain'
      ? 'You\'re ' + actualStr + ', quicker than your ' + rt(target) + '/wk target. Some early gain is water and food weight, not muscle, so rather than a big cut I\'ve trimmed ' + nudge + ' kcal to ' + round(newKcal) + '. Keep going and I\'ll fine-tune from your settled trend next check-in. Protein stays ' + newTargets.protein_g + ' g.'
      : 'You\'re ' + actualStr + ', quicker than your ' + rt(target) + '/wk target. A lot of an early drop is water and glycogen, not fat, so rather than a big jump I\'ve nudged you up ' + nudge + ' kcal to ' + round(newKcal) + '. Keep it up and I\'ll fine-tune from your settled trend next check-in. Protein stays ' + newTargets.protein_g + ' g.';
    return { changed: true, earlyPhase: true, direction: dir, deltaKcal: signed, confidence: 'low', expectedKgPerWeek: round(target, 2), actualKgPerWeek: round(actual, 3), newTargets: newTargets, reason: reason, estimate: opts.estimate };
  }

  // ---- linear regression: returns slope, intercept, and standard error of slope ----
  function linreg(xs, ys) {
    var n = xs.length;
    if (n < 2) return { slope: 0, intercept: ys.length ? ys[0] : 0, slopeSE: Infinity, n: n };
    var xbar = mean(xs), ybar = mean(ys);
    var sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sxx += (xs[i] - xbar) * (xs[i] - xbar); sxy += (xs[i] - xbar) * (ys[i] - ybar); }
    if (sxx === 0) return { slope: 0, intercept: ybar, slopeSE: Infinity, n: n };
    var slope = sxy / sxx, intercept = ybar - slope * xbar;
    var ssr = 0;
    for (var j = 0; j < n; j++) { var e = ys[j] - (intercept + slope * xs[j]); ssr += e * e; }
    var slopeSE = n > 2 ? Math.sqrt((ssr / (n - 2)) / sxx) : Infinity;
    return { slope: slope, intercept: intercept, slopeSE: slopeSE, n: n };
  }

  // ---- Theil-Sen robust slope: the median of all pairwise slopes. A single water-weight spike or
  // scale blip cannot drag it the way it drags an OLS fit. Intercept is the median residual offset.
  function theilSen(xs, ys) {
    var n = xs.length;
    if (n < 2) return { slope: 0, intercept: ys.length ? ys[0] : 0, n: n };
    function median(a) { var s = a.slice().sort(function (p, q) { return p - q; }); var m = s.length; return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2; }
    var slopes = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dx = xs[j] - xs[i];
        if (dx !== 0) slopes.push((ys[j] - ys[i]) / dx);
      }
    }
    if (!slopes.length) return { slope: 0, intercept: mean(ys), n: n };
    var slope = median(slopes);
    var intercept = median(xs.map(function (x, k) { return ys[k] - slope * x; }));
    return { slope: slope, intercept: intercept, n: n };
  }

  // ---- live (between-check-in) expenditure estimate with an uncertainty band ----
  // opts: { weights:[{date,kg}], kcalByDate:{date:kcal}, today, windowDays,
  //         currentTargetKcal, goalType, rateKgPerWeek }
  // Returns a point TDEE, a ± band (combining weight-trend and intake uncertainty),
  // a confidence label, the observed trend, and a forecast of the next check-in nudge.
  function liveExpenditure(opts) {
    var windowDays = opts.windowDays || 14;
    var today = opts.today;
    var startISO = shiftISOdays(today, -(windowDays - 1));
    function dayIndex(iso) { return daysBetweenISO(startISO, iso); }

    // weigh-ins within the window
    var ws = (opts.weights || []).filter(function (w) { return w.date >= startISO && w.date <= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    // logged intake days within the window; incomplete days (well under that day's target,
    // i.e. logging was abandoned partway) are excluded when targets are supplied.
    var kbd = opts.kcalByDate || {};
    var tbd = opts.targetByDate || null;
    var loggedVals = [];
    for (var d in kbd) {
      if (d >= startISO && d <= today && kbd[d] > 0 && (!tbd || isCompleteDay(kbd[d], tbd[d]))) loggedVals.push(kbd[d]);
    }

    var weighDays = ws.length, loggedDays = loggedVals.length;
    var spanDays = weighDays ? (dayIndex(ws[weighDays - 1].date) - dayIndex(ws[0].date) + 1) : 0;
    // Need a real spread of weigh-ins and enough logged days to say anything.
    if (weighDays < 4 || loggedDays < 5 || spanDays < 7) {
      return { ok: false, weighDays: weighDays, loggedDays: loggedDays, needWeigh: 4, needLog: 5, windowDays: windowDays };
    }

    var xs = ws.map(function (w) { return dayIndex(w.date); });
    var ys = ws.map(function (w) { return w.kg; });
    var reg = linreg(xs, ys); // kept for the slope standard error (uncertainty band)
    var slopeKgPerDay = theilSen(xs, ys).slope; // robust point slope, outlier-resistant
    var avgKcal = mean(loggedVals);
    var tdee = avgKcal - slopeKgPerDay * KCAL_PER_KG;

    // Uncertainty: (a) weight-trend slope SE -> kcal/day, (b) intake sampling SE,
    // inflated when days are unlogged (mean intake is then less representative).
    var weightSEkcal = (isFinite(reg.slopeSE) ? reg.slopeSE : 0) * KCAL_PER_KG;
    var intakeSD = 0;
    if (loggedDays > 1) { var m = avgKcal, s = 0; for (var k = 0; k < loggedVals.length; k++) s += (loggedVals[k] - m) * (loggedVals[k] - m); intakeSD = Math.sqrt(s / (loggedDays - 1)); }
    var intakeSE = intakeSD / Math.sqrt(loggedDays);
    var coverage = clamp(loggedDays / windowDays, 0, 1);
    var intakePenalty = 1 + (1 - coverage) * 1.5; // up to +150% when few days logged
    var sigma = Math.sqrt(weightSEkcal * weightSEkcal + (intakeSE * intakePenalty) * (intakeSE * intakePenalty));
    if (!isFinite(sigma)) sigma = 250;
    sigma = Math.max(sigma, 40); // never claim silly precision
    var band = round(sigma / 10) * 10;

    var weeklyChangeKg = slopeKgPerDay * 7;
    var direction = weeklyChangeKg < -0.03 ? 'down' : weeklyChangeKg > 0.03 ? 'up' : 'flat';

    // Plausibility guard: a fast water-weight swing over a short window can imply an
    // absurd (or negative) TDEE. If the estimate is outside a sane band around BMR,
    // flag it as still-settling rather than showing a garbage number.
    var bmr = opts.bmr || 0;
    var plausible = !bmr || (tdee >= bmr * 0.9 && tdee <= bmr * 2.6);
    if (!plausible) {
      return {
        ok: true, implausible: true, tdee: round(tdee), weeklyChangeKg: round(weeklyChangeKg, 2), direction: direction,
        weighDays: weighDays, loggedDays: loggedDays, windowDays: windowDays,
      };
    }

    // Confidence from band width relative to TDEE plus data quantity.
    var rel = band / Math.max(tdee, 1);
    var confidence = (rel < 0.055 && weighDays >= 7 && loggedDays >= 10) ? 'high'
      : (rel < 0.11 && weighDays >= 5 && loggedDays >= 7) ? 'medium' : 'low';

    // Forecast the next check-in nudge: compare implied target to current target.
    var goalDelta = goalDailyDelta(opts.goalType, opts.rateKgPerWeek);
    var desired = tdee + goalDelta;
    var rawDelta = desired - (opts.currentTargetKcal || tdee);
    // Same proportional cap the check-in applies, scaled by this estimate's confidence.
    var confFactor = confidence === 'high' ? 1 : confidence === 'medium' ? 0.75 : 0.5;
    var fcCap = clamp(round(0.10 * tdee * confFactor), 100, 350);
    var fcDelta = clamp(rawDelta, -fcCap, fcCap);
    var forecast;
    if (confidence === 'low') forecast = { dir: 'unknown', deltaKcal: 0, text: 'need a bit more data to call it' };
    else if (Math.abs(fcDelta) < 25) forecast = { dir: 'hold', deltaKcal: 0, text: 'on track, no change likely' };
    else forecast = { dir: fcDelta > 0 ? 'up' : 'down', deltaKcal: round(fcDelta), text: (fcDelta > 0 ? 'leaning towards a small increase' : 'leaning towards a small decrease') + ' (~' + Math.abs(round(fcDelta)) + ' kcal)' };

    return {
      ok: true, tdee: round(tdee), band: band, low: round(tdee - band), high: round(tdee + band),
      confidence: confidence, weeklyChangeKg: round(weeklyChangeKg, 2), direction: direction,
      avgKcal: round(avgKcal), weighDays: weighDays, loggedDays: loggedDays, windowDays: windowDays,
      forecast: forecast,
    };
  }

  // ---- daily target composition (extracted from the UI, pure) ----
  // opts: {
  //   base: {kcal, protein_g, fat_g, carbs_g},          current base targets
  //   date: 'YYYY-MM-DD',                                the day being composed
  //   floorKcal: number,                                 kcal floor (use kcalFloor(profile))
  //   cycling: {enabled, highDays, deltaPct} | null,
  //   carryover: {enabled, mode, capKcal} | null,        capKcal default 400 (store default)
  //   cycleStart: 'YYYY-MM-DD',                          first day of the CURRENT cycle, i.e. the
  //                                                      day AFTER the last check-in (exclusive)
  //   eatenByDate: {iso: kcal},                          logged intake for past days of the cycle
  //   overrideShiftKcal: number                          per-day carb->fat rebalance (0 = none)
  // }
  // Returns { base, cyc, carry, eff, carryDetail, floorLimited }.
  function composeDayTarget(opts) {
    var base = opts.base;
    if (!base) return null;
    var floor = opts.floorKcal != null ? opts.floorKcal : KCAL_FLOOR;
    var date = opts.date;
    function wdOf(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
    var cycCfg = (opts.cycling && opts.cycling.enabled) ? opts.cycling : null;
    var cyc = cycCfg ? cyclingDelta(cycCfg, wdOf(date), base.kcal, floor) : 0;
    var carry = 0, carryDetail = null;
    var co = opts.carryover;
    if (co && co.enabled && opts.cycleStart) {
      var cap = co.capKcal == null ? 400 : co.capKcal; // nullish: an explicit 0 means "no carryover room"
      var idx = Math.max(0, daysBetweenISO(opts.cycleStart, date)); // days elapsed in the cycle
      if (idx >= 7) {
        // Beyond day 7 of a cycle (check-in overdue) the balance EXPIRES rather than dribbling
        // yesterday's maths into stale days indefinitely.
        carryDetail = { days: [], balance: 0, mode: co.mode, cap: cap, remaining: 0, applied: 0, cycleStart: opts.cycleStart, expired: true };
      } else {
        var eatenByDate = opts.eatenByDate || {};
        var acc = 0, days = [];
        for (var i = 0; i < idx; i++) {
          var dISO = shiftISOdays(opts.cycleStart, i);
          var e = eatenByDate[dISO];
          if (!(e > 0)) continue;
          var tgt = base.kcal + (cycCfg ? cyclingDelta(cycCfg, wdOf(dISO), base.kcal, floor) : 0);
          if (!isCompleteDay(e, tgt)) continue; // a half-logged day would fake a huge deficit
          var eaten = Math.round(e);
          acc += tgt - eaten;
          days.push({ date: dISO, eaten: eaten, delta: Math.round(tgt - eaten) });
        }
        // Dispersed spreads the balance across the days left in the week; Aggressive dumps it all today.
        var remaining = co.mode === 'dispersed' ? Math.max(1, 7 - idx) : 1;
        carry = carryoverDispersed(acc, remaining, cap);
        carryDetail = { days: days, balance: Math.round(acc), mode: co.mode, cap: cap, remaining: remaining, applied: carry, cycleStart: opts.cycleStart };
      }
    }
    // Never let cycling/carryover push a day below the calorie floor.
    var floorLimited = (cyc + carry) < (floor - base.kcal);
    var delta = Math.max(cyc + carry, floor - base.kcal);
    var eff = applyKcalDelta(base, delta);
    var shift = opts.overrideShiftKcal || 0;
    if (shift) eff = Object.assign({}, eff, { carbs_g: Math.max(0, Math.round(eff.carbs_g - shift / 4)), fat_g: Math.max(0, Math.round(eff.fat_g + shift / 9)) });
    return { base: base, cyc: cyc, carry: carry, eff: eff, carryDetail: carryDetail, floorLimited: floorLimited };
  }

  // ---- check-in decision pipeline (extracted from the UI, pure) ----
  // Complete-day filtering, gap-aware trend cycle means, early vs normal adjustment choice,
  // expenditure smoothing and plateau detection. Coverage/adherence gating against minDays happens
  // inside weeklyAdjust/earlyAdjust as before.
  // opts: {
  //   profile, currentTargets,
  //   weights: [{date, kg}],                 full weigh-in history (any order)
  //   kcalByDate: {iso: kcal},               logged intake per day of the cycle
  //   targetByDate: {iso: kcal},             planned kcal per logged day (completeness checks; optional)
  //   cycleStart, today, cycleDays,
  //   weighDays, minDays, periodDays, earlyCap,
  //   expenditure: {kcal, n} | null,         smoothed prior (seed kcal from the formula at n=0)
  //   checkins: [{adhered, weeklyChangeKg, deltaKcal}, ...]   prior history for plateau detection
  // }
  // Returns { status: 'needdata' } or { status: 'proposed', ...adjust result, completeDays,
  // expenditure, plateau }.
  function checkInDecision(opts) {
    var cs = opts.cycleStart, today = opts.today;
    var cycleDays = opts.cycleDays || Math.max(1, daysBetweenISO(cs, today) + 1);
    var kbd = opts.kcalByDate || {};
    var tbd = opts.targetByDate || {};
    var vals = [], completeDays = 0;
    for (var d in kbd) {
      if (d < cs || d > today) continue;
      if (!(kbd[d] > 0)) continue;
      if (!isCompleteDay(kbd[d], tbd[d])) continue;
      vals.push(kbd[d]); completeDays++;
    }
    if (vals.length < 3) return { status: 'needdata', reasonCode: 'logs', completeDays: completeDays };
    var avgKcal = mean(vals);
    // Cycle means diff SMOOTHED trend values (gap-aware EMA), not raw scale weights, so one odd
    // morning or a weigh-in gap cannot swing the read. The decision trend uses a faster alpha (0.3)
    // than the chart's 0.1: it still soaks up day-to-day water noise but lags only ~2 days, so the
    // measured rate tracks the CURRENT cycle instead of echoing last cycle's deficit (which would
    // bias the expenditure estimate and invite oscillation).
    var ws = (opts.weights || []).filter(function (w) { return w && w.kg != null; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var ts = trendSeries(ws.map(function (w) { return { date: w.date, weightKg: w.kg }; }), 0.3);
    var prevStart = shiftISOdays(cs, -cycleDays), prevEnd = shiftISOdays(cs, -1);
    var curVals = [], prevVals = [], curCycle = [];
    for (var i = 0; i < ts.length; i++) {
      var pnt = ts[i];
      if (pnt.date >= cs && pnt.date <= today) { curVals.push(pnt.trendKg); curCycle.push(pnt); }
      else if (pnt.date >= prevStart && pnt.date <= prevEnd) prevVals.push(pnt.trendKg);
    }
    var curAvg = curVals.length ? mean(curVals) : null;
    var prevAvg = prevVals.length ? mean(prevVals) : null;
    var result;
    if (prevAvg == null) {
      // First cycle: no previous-cycle baseline. A one-week EMA is still dominated by where it
      // started, so read the slope robustly (Theil-Sen) from the RAW weigh-ins instead; earlyAdjust
      // applies its own heavy water/noise discount on top.
      if (curCycle.length < 3) return { status: 'needdata', reasonCode: 'weighins', completeDays: completeDays };
      var xs = curCycle.map(function (w) { return daysBetweenISO(cs, w.date); });
      var ys = curCycle.map(function (w) { return w.weightKg; });
      var weeklyChangeKg = theilSen(xs, ys).slope * 7;
      var est = { tdee: round(avgKcal - (weeklyChangeKg * KCAL_PER_KG) / 7), avgKcal: round(avgKcal), weeklyChangeKg: round(weeklyChangeKg, 3), days: cycleDays };
      result = earlyAdjust({ profile: opts.profile, currentTargets: opts.currentTargets, estimate: est, adherenceDays: completeDays, weighDays: opts.weighDays, minDays: opts.minDays, periodDays: opts.periodDays || cycleDays, earlyCap: opts.earlyCap || 150, waterHigh: opts.waterHigh });
      // The early estimate is water-contaminated, so it nudges the smoothed expenditure only gently.
      if (opts.expenditure && result.estimate) result.expenditure = updateExpenditure(opts.expenditure, result.estimate.tdee, 0.3);
    } else {
      var est2 = estimateExpenditure({ dailyKcal: vals, trendStartKg: prevAvg, trendEndKg: curAvg, days: cycleDays });
      result = weeklyAdjust({ profile: opts.profile, currentTargets: opts.currentTargets, estimate: est2, adherenceDays: completeDays, weighDays: opts.weighDays, minDays: opts.minDays, periodDays: opts.periodDays || cycleDays, expenditure: opts.expenditure, waterHigh: opts.waterHigh });
    }
    result.status = 'proposed';
    result.completeDays = completeDays;
    // Plateau: judge history plus this cycle's outcome.
    var hist = (opts.checkins || []).slice();
    hist.push({ adhered: true, weeklyChangeKg: result.estimate ? result.estimate.weeklyChangeKg : null, deltaKcal: result.changed ? result.deltaKcal : 0 });
    result.plateau = detectPlateau(hist, opts.profile && opts.profile.goalType);
    return result;
  }

  // date helpers (engine-local, ISO 'YYYY-MM-DD', UTC-safe)
  function shiftISOdays(iso, delta) { var t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); }
  function daysBetweenISO(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

  // ---- Daily steps ---------------------------------------------------------------------------
  // Average steps over the days that actually HAVE a reading in [startISO, endISO] (0/blank days are
  // ignored, not counted as zero, so a day with no sync doesn't drag the average down). null if none.
  function avgStepsInRange(stepsMap, startISO, endISO) {
    if (!stepsMap) return null;
    var sum = 0, n = 0;
    for (var k in stepsMap) {
      if (!Object.prototype.hasOwnProperty.call(stepsMap, k)) continue;
      if (k < startISO || k > endISO) continue;
      var v = +stepsMap[k];
      if (isFinite(v) && v > 0) { sum += v; n++; }
    }
    return n ? { avg: Math.round(sum / n), days: n } : null;
  }

  // Steps-first coaching signal. The deterministic calorie engine has ALREADY decided this cycle's
  // number; this only decides which LEVER the coach should LEAD with. When progress is short of the
  // target rate, a good coach lifts NEAT (daily steps) before cutting food: so if steps are low or
  // have dropped, recommend raising them first; if steps are already solid, the small calorie move is
  // the honest lever. Pure and side-effect free. { hasData:false } when there's no step data to use.
  //   opts: { thisCycle:{avg,days}|null, prevCycle:{avg,days}|null, baseline:Number, behindTarget:Bool }
  function stepsCoaching(opts) {
    opts = opts || {};
    var thisC = opts.thisCycle, prevC = opts.prevCycle;
    var baseline = +opts.baseline || 0;          // activity-band assumed steps/day
    var behind = !!opts.behindTarget;            // slower than target this cycle (engine wants to cut)
    if (!thisC || !isFinite(+thisC.avg)) return { hasData: false };
    var avg = Math.round(+thisC.avg);
    var DROP = 750, LOW = 500;                   // material thresholds (step-count noise floor)
    var droppedVsPrev = !!(prevC && isFinite(+prevC.avg) && avg < prevC.avg - DROP);
    var belowBaseline = baseline > 0 && avg < baseline - LOW;
    // Where to aim when we want more NEAT: back to your usual level (baseline / last cycle) or a bump.
    var aims = [baseline, prevC && prevC.avg, avg + 2000].filter(function (x) { return isFinite(x) && x > 0; });
    var suggestTarget = aims.length ? Math.round(Math.max.apply(null, aims) / 500) * 500 : null;
    var lever = 'none';
    if (behind && (droppedVsPrev || belowBaseline)) lever = 'steps';   // lift steps before touching food
    else if (behind) lever = 'calories';                               // steps solid; the calorie move stands
    return {
      hasData: true, avg: avg, days: thisC.days,
      prevAvg: (prevC && isFinite(+prevC.avg)) ? Math.round(+prevC.avg) : null,
      baseline: baseline || null, droppedVsPrev: droppedVsPrev, belowBaseline: belowBaseline,
      lever: lever, suggestTarget: lever === 'steps' ? suggestTarget : null,
    };
  }

  var Engine = {
    KCAL_PER_KG: KCAL_PER_KG, KCAL_PER_STEP_PER_KG: KCAL_PER_STEP_PER_KG, KCAL_PER_GYM_SESSION_PER_KG: KCAL_PER_GYM_SESSION_PER_KG,
    linreg: linreg, theilSen: theilSen, liveExpenditure: liveExpenditure,
    mifflinBMR: mifflinBMR, tdeeBreakdown: tdeeBreakdown, tdeeFromProfile: tdeeFromProfile,
    goalDailyDelta: goalDailyDelta, rateGuidance: rateGuidance, fatFreeMassKg: fatFreeMassKg, proteinReferenceKg: proteinReferenceKg, proteinGrams: proteinGrams,
    defaultProteinPerKgLBM: defaultProteinPerKgLBM, DEFAULT_PROTEIN_G_PER_KG_LBM: DEFAULT_PROTEIN_G_PER_KG_LBM,
    KCAL_FLOOR: KCAL_FLOOR, KCAL_FLOOR_MALE: KCAL_FLOOR_MALE, kcalFloor: kcalFloor,
    macrosFromKcal: macrosFromKcal, computeInitialTargets: computeInitialTargets, fiberTarget: fiberTarget,
    cyclingDelta: cyclingDelta, carryover: carryover, carryoverDispersed: carryoverDispersed, applyKcalDelta: applyKcalDelta,
    composeDayTarget: composeDayTarget, checkInDecision: checkInDecision,
    isCompleteDay: isCompleteDay, updateExpenditure: updateExpenditure, detectPlateau: detectPlateau, menstrualPhase: menstrualPhase,
    trendSeries: trendSeries, estimateExpenditure: estimateExpenditure, weeklyAdjust: weeklyAdjust, earlyAdjust: earlyAdjust, round: round,
    avgStepsInRange: avgStepsInRange, stepsCoaching: stepsCoaching,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
