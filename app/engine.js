/*
 * engine.js — Adaptive nutrition engine (pure, framework-free)
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

  // Moderate, evidence-based protein: default 1.8 g/kg bodyweight, or a manual gram target.
  function proteinGrams(p) {
    if (p.proteinManualG) return Math.round(+p.proteinManualG);
    var gPerKg = p.proteinGPerKgBW || 1.8;
    return Math.round(gPerKg * p.weightKg);
  }

  // Macro split from a kcal budget. No ranges (removed by design).
  function macrosFromKcal(kcal, profile) {
    var protein_g = proteinGrams(profile);
    var fatPct = DIET_STYLE_FAT_PCT[profile.dietStyle] || DIET_STYLE_FAT_PCT.balanced;
    var fatFloor = 0.6 * profile.weightKg;
    var fat_g = Math.max(fatFloor, (kcal * fatPct) / 9);
    var carbs_g = Math.max(0, (kcal - protein_g * 4 - fat_g * 9) / 4);
    return { kcal: round(kcal), protein_g: protein_g, fat_g: round(fat_g), carbs_g: round(carbs_g) };
  }

  function computeInitialTargets(profile) {
    var bd = tdeeBreakdown(profile);
    var kcal = bd.tdee + goalDailyDelta(profile.goalType, profile.rateKgPerWeek);
    if (profile.proteinManualG && profile.manualKcal) kcal = +profile.manualKcal; // fully manual override
    // Absolute health floor only, so the rate slider keeps reducing calories across its full range.
    if (kcal < 1200) kcal = 1200;
    var out = macrosFromKcal(kcal, profile);
    out.estimatedTDEE = bd.tdee;
    out.tdeeBreakdown = bd;
    out.source = 'formula';
    return out;
  }

  // ---- calorie cycling: high/low days, weekly total preserved ----
  // config: { enabled, highDays:[0..6 (0=Sun)], deltaPct }
  function cyclingDelta(config, weekday, baseKcal) {
    if (!config || !config.enabled || !config.highDays || !config.highDays.length) return 0;
    var nHigh = config.highDays.length;
    if (nHigh >= 7) return 0;
    var bump = baseKcal * (config.deltaPct || 0.15);
    if (config.highDays.indexOf(weekday) !== -1) return round(bump);
    return round(-(nHigh * bump) / (7 - nHigh));
  }

  // ---- carryover: bank yesterday's surplus/deficit into today ----
  function carryover(prevTargetKcal, prevConsumedKcal, capKcal) {
    var cap = capKcal == null ? 500 : capKcal;
    return round(clamp(prevTargetKcal - prevConsumedKcal, -cap, cap));
  }

  // Apply a kcal delta to a base target, holding protein & fat, flexing carbs.
  function applyKcalDelta(base, deltaKcal) {
    var kcal = Math.max(0, base.kcal + deltaKcal);
    var carbs_g = Math.max(0, (kcal - base.protein_g * 4 - base.fat_g * 9) / 4);
    return { kcal: round(kcal), protein_g: base.protein_g, fat_g: base.fat_g, carbs_g: round(carbs_g), deltaKcal: round(deltaKcal) };
  }

  // ---- trend + adaptive ----
  function trendSeries(entries, alpha) {
    alpha = alpha == null ? 0.1 : alpha;
    var out = [], trend = null;
    for (var i = 0; i < entries.length; i++) {
      var w = entries[i].weightKg;
      trend = trend == null ? w : trend + alpha * (w - trend);
      out.push({ date: entries[i].date, weightKg: w, trendKg: round(trend, 2) });
    }
    return out;
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

    if (opts.adherenceDays < 5) {
      return { changed: false, reason: 'Only ' + opts.adherenceDays + '/7 days logged this week. I\'ll hold your targets — log a fuller week and I\'ll dial them in.', estimate: opts.estimate };
    }
    if (opts.estimate.tdee < bmr * 1.05) {
      return { changed: false, underReportFlagged: true, reason: 'Your numbers imply an expenditure (' + opts.estimate.tdee + ' kcal) near or below your BMR (' + round(bmr) + '), which usually means food was under-logged. Trusting your weight trend and holding targets this week.', estimate: opts.estimate };
    }
    var desiredKcal = opts.estimate.tdee + goalDelta;
    var cappedDelta = clamp(desiredKcal - currentKcal, -150, 150);
    var newKcal = Math.max(bmr * 1.1, currentKcal + cappedDelta);
    var newTargets = macrosFromKcal(newKcal, profile);
    newTargets.estimatedTDEE = opts.estimate.tdee;
    newTargets.source = 'adaptive';
    var dir = cappedDelta > 0.5 ? 'up' : (cappedDelta < -0.5 ? 'down' : 'unchanged');
    var reason;
    if (dir === 'unchanged') {
      reason = 'Trend is tracking your goal (' + opts.estimate.weeklyChangeKg + ' kg/wk). No change needed — keep going.';
    } else {
      reason = 'Over ' + opts.estimate.days + ' days your real burn looks like ~' + opts.estimate.tdee + ' kcal and weight moved ' + opts.estimate.weeklyChangeKg + ' kg/wk. Nudging calories ' + dir + ' ' + Math.abs(round(cappedDelta)) + ' to ' + round(newKcal) + ' kcal. Protein stays ' + newTargets.protein_g + ' g.';
    }
    return { changed: dir !== 'unchanged', direction: dir, deltaKcal: round(cappedDelta), newTargets: newTargets, reason: reason, estimate: opts.estimate };
  }

  var Engine = {
    KCAL_PER_KG: KCAL_PER_KG, KCAL_PER_STEP_PER_KG: KCAL_PER_STEP_PER_KG, KCAL_PER_GYM_SESSION_PER_KG: KCAL_PER_GYM_SESSION_PER_KG,
    mifflinBMR: mifflinBMR, tdeeBreakdown: tdeeBreakdown, tdeeFromProfile: tdeeFromProfile,
    goalDailyDelta: goalDailyDelta, fatFreeMassKg: fatFreeMassKg, proteinGrams: proteinGrams,
    macrosFromKcal: macrosFromKcal, computeInitialTargets: computeInitialTargets,
    cyclingDelta: cyclingDelta, carryover: carryover, applyKcalDelta: applyKcalDelta,
    trendSeries: trendSeries, estimateExpenditure: estimateExpenditure, weeklyAdjust: weeklyAdjust, round: round,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
