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

  // ---------------------------------------------------------------------------
  // Nutrient density / food quality
  //
  // Modelled on the USDA's Healthy Eating Index (HEI-2020), the validated 0-100 diet quality score,
  // rather than on thresholds of our own invention. Three things are taken from it directly:
  //
  //  1. DENSITY, not amount. HEI scores nutrients per 1,000 kcal, so the measure asks what each
  //     calorie buys you. We work per 100 kcal, which is the same idea: a small portion and a large
  //     one of the same food score identically, and eating more can never inflate the score.
  //  2. PROPORTIONAL components. Each component earns its points on a sliding scale between a
  //     minimum standard (0 points) and a maximum (full points), rather than being clamped at a
  //     single cutoff. This is what stops every whole food pinning at the top of the scale.
  //  3. The published STANDARDS themselves, where we hold the same data HEI does:
  //       fatty acids   (PUFA+MUFA)/SFA  <=1.2 scores 0, >=2.5 scores full   [HEI-2020, 10 pts]
  //       saturated fat  <=8% of energy scores full, >=16% scores 0          [HEI-2020, 10 pts]
  //       sodium         <=1.1 g/1000 kcal full, >=2.0 g/1000 kcal zero      [HEI-2020, 10 pts]
  //       protein foods  >=2.5 oz-equivalents per 1,000 kcal for full marks  [HEI-2020, 5 pts]
  //     Sodium is converted to the salt figure UK labels print (salt = sodium x 2.5), and protein
  //     oz-equivalents to grams at the standard 7 g of protein per ounce-equivalent.
  //
  // Three deliberate departures, each forced by the data a UK label actually carries:
  //
  //  a. HEI's adequacy side is built on FOOD GROUPS (greens, whole grains, dairy), which we cannot
  //     compute from a nutrition panel. Fibre stands in for them, scored against the Institute of
  //     Medicine's Adequate Intake of 14 g per 1,000 kcal. Fibre tracks the same foods those groups
  //     are trying to capture.
  //  b. HEI limits ADDED sugars; a label only prints TOTAL sugars, which also counts the sugar in
  //     fruit and milk. Scoring total sugars against HEI's added-sugar standard would punish an
  //     apple as though it were a biscuit, so the standard is loosened (10% to 30% of energy rather
  //     than 6.5% to 26%) and fibre discounts the figure, on the reasoning that sugar arriving with
  //     fibre is the intrinsic kind. This is the least exact part of the score.
  //  c. HEI has no energy-density component and does not need one, because it can see food groups.
  //     Without them, foods whose value is micronutrients (fruit, veg, milk, soup) look empty, so
  //     low energy density earns points as a proxy for whole plant foods. It is GATED on the food
  //     carrying some protein or fibre, otherwise beer and squash would score well for being mostly
  //     water.
  //
  // Alcohol follows HEI-2015 and later: it is not scored as a component, but its calories still
  // count towards the day's total, so a heavy night dilutes the day rather than being ignored.
  // See ndDay.
  var ND_PROTEIN_FULL = 17.5;              // g per 1000 kcal (2.5 oz-eq x 7 g), HEI total protein foods
  var ND_FIBER_FULL = 14;                  // g per 1000 kcal, Institute of Medicine Adequate Intake
  var ND_FAT_RATIO_MIN = 1.2, ND_FAT_RATIO_MAX = 2.5;   // (PUFA+MUFA)/SFA, HEI fatty acids
  var ND_SATFAT_BEST = 8, ND_SATFAT_WORST = 16;         // % of energy, HEI saturated fats
  var ND_SUGAR_BEST = 10, ND_SUGAR_WORST = 30;          // % of energy, HEI added-sugar standard loosened for total sugars
  var ND_SALT_BEST = 2.75, ND_SALT_WORST = 5.0;         // g salt per 1000 kcal (HEI sodium 1.1-2.0 g x 2.5)
  var ND_ED_BEST = 50, ND_ED_WORST = 350;               // kcal per 100 g, the whole-food proxy
  var ND_VOLUME_GATE = 0.30;               // share of the protein+fibre marks needed to earn it in full
  var ND_SUGAR_FIBER_OFFSET = 2;           // g of sugar forgiven per g of fibre, per 100 kcal
  // Points per component, in HEI's own proportions: the things you eat more of are worth less
  // individually than the things you are trying to limit.
  var ND_POINTS = { protein: 5, fiber: 10, fatRatio: 10, satfat: 10, sugars: 10, salt: 10, volume: 10 };
  var ND_MAX_POINTS = 65;
  // Bands follow the published HEI-2020 cut points, so "good" means what it means in the literature
  // rather than what felt right: high >=70, marginal 60-70, low 50-60, very low <=50. The US
  // population averages 58, which is the honest benchmark for a typical day.
  var ND_TARGET = 70;
  var ND_POPULATION_AVERAGE = 58;

  function ndClampPct(x) { return clamp(x, 0, 1); }
  // Points earned on a sliding scale between a zero-point standard and a full-point one, in either
  // direction (more is better for fibre, less is better for salt).
  function ndBetween(value, zeroAt, fullAt, points) {
    if (!isFinite(value)) return 0;
    return ndClampPct((value - zeroAt) / (fullAt - zeroAt)) * points;
  }

  // n = grams PER 100 KCAL: { protein, fiber, satfat, sugars, salt, fat }, plus `ed` = the food's
  // energy density in kcal per 100 g. Missing values are treated as absent rather than guessed, so
  // callers should only score foods they have data for (see ndDay, which reports coverage instead
  // of quietly inventing numbers). A food with no `ed` simply forgoes the volume points.
  function ndScore(n) { return Math.round(ndBreakdown(n).score); }

  // The same score with its components exposed, so the app can say WHY a food or a day scored what
  // it did instead of showing a bare number.
  function ndBreakdown(n) {
    n = n || {};
    var protein = Math.max(0, +n.protein || 0);
    var fiber = Math.max(0, +n.fiber || 0);
    var satfat = Math.max(0, +n.satfat || 0);
    var salt = Math.max(0, +n.salt || 0);
    var fat = Math.max(0, +n.fat || 0);
    var unsat = Math.max(0, fat - satfat);
    // Sugar arriving with fibre is treated as the intrinsic kind, per the note above.
    var sugars = Math.max(0, (+n.sugars || 0) - fiber * ND_SUGAR_FIBER_OFFSET);

    // Everything below is per 100 kcal, so a "per 1000 kcal" standard is a tenth of its stated value
    // and a "% of energy" standard converts through the 9 and 4 kcal per gram of fat and sugar.
    var pProtein = ndBetween(protein, 0, ND_PROTEIN_FULL / 10, ND_POINTS.protein);
    var pFiber = ndBetween(fiber, 0, ND_FIBER_FULL / 10, ND_POINTS.fiber);
    // A food with fat but none of it saturated is at the top of the ratio scale, not undefined.
    var ratio = satfat > 0 ? unsat / satfat : (unsat > 0 ? ND_FAT_RATIO_MAX : null);
    var pRatio = ratio == null ? ND_POINTS.fatRatio / 2   // no fat at all is neither good nor bad here
      : ndBetween(ratio, ND_FAT_RATIO_MIN, ND_FAT_RATIO_MAX, ND_POINTS.fatRatio);
    var pSatfat = ndBetween(satfat * 9, ND_SATFAT_WORST, ND_SATFAT_BEST, ND_POINTS.satfat);
    var pSugars = ndBetween(sugars * 4, ND_SUGAR_WORST, ND_SUGAR_BEST, ND_POINTS.sugars);
    var pSalt = ndBetween(salt * 10, ND_SALT_WORST, ND_SALT_BEST, ND_POINTS.salt);

    var gate = ndClampPct((pProtein / ND_POINTS.protein + pFiber / ND_POINTS.fiber) / 2 / ND_VOLUME_GATE);
    var ed = +n.ed;
    var pVolume = (isFinite(ed) && ed > 0)
      ? ndBetween(ed, ND_ED_WORST, ND_ED_BEST, ND_POINTS.volume) * gate
      : 0;

    var total = pProtein + pFiber + pRatio + pSatfat + pSugars + pSalt + pVolume;
    return {
      score: clamp(total / ND_MAX_POINTS * 100, 0, 100),
      parts: { protein: pProtein, fiber: pFiber, fatRatio: pRatio, satfat: pSatfat, sugars: pSugars, salt: pSalt, volume: pVolume },
      max: ND_POINTS,
    };
  }

  // Convert a logged portion (absolute grams for that portion) to the per-100-kcal basis ndScore
  // wants. `extra.grams` is the portion weight, used only for energy density; without it the food
  // still scores, just without the volume credit. Returns null below 5 kcal, where the division
  // stops meaning anything (a squirt of sauce, a black coffee) and rounding would swing the score.
  function ndPer100kcal(macros, extra) {
    macros = macros || {}; extra = extra || {};
    var kcal = +macros.kcal || 0;
    if (kcal < 5) return null;
    var f = 100 / kcal;
    var grams = +extra.grams || 0;
    var out = {
      protein: (+macros.protein || 0) * f,
      fiber: (+macros.fiber || 0) * f,
      fat: (+macros.fat || 0) * f,
      satfat: (+extra.satfat || 0) * f,
      sugars: (+extra.sugars || 0) * f,
      salt: (+extra.salt || 0) * f,
    };
    // A share of the food's weight, not an amount, so it does not scale with the portion.
    if (extra.fvl != null) out.fvl = clamp(+extra.fvl || 0, 0, 100);
    // Whether this is a drink decides which Nutri-Score table applies, so it travels with the food.
    if (extra.beverage) out.bev = true;
    if (extra.water) out.water = true;
    if (grams > 0) out.ed = kcal / grams * 100;
    return out;
  }

  // The day's score. HEI scores a whole day's eating in one pass rather than averaging the foods in
  // it, and that is what we do here: add up everything eaten, work out the day's nutrient density,
  // then score that once. Scoring the aggregate matters, because a food eaten alongside others is
  // judged in their company. It is also what makes ALCOHOL behave correctly with no special case
  // (HEI-2015 onwards): a drink brings calories and no nutrients, so it dilutes the day's density
  // and drags the score down, exactly as a night out should.
  //
  // Entries are { kcal, nq, alcohol } where nq is the stored per-100-kcal record. Entries with no
  // nq are counted in `uncovered` and left out entirely, rather than assumed good or bad.
  function ndDay(entries) {
    var sum = { protein: 0, fiber: 0, fat: 0, satfat: 0, sugars: 0, salt: 0, grams: 0 };
    var kcalScored = 0, kcalTotal = 0, gramsKnown = true;
    (entries || []).forEach(function (e) {
      var kcal = Math.max(0, +(e && e.kcal) || 0);
      if (!e || kcal <= 0) return;
      kcalTotal += kcal;
      // Alcohol counts towards the day's calories but contributes no nutrients, so it dilutes rather
      // than being quietly excused. It is never "uncovered": we know exactly what it brings, nothing.
      if (e.alcohol) { kcalScored += kcal; gramsKnown = false; return; }
      if (!e.nq) return;
      kcalScored += kcal;
      var f = kcal / 100;   // nq is per 100 kcal, so this converts back to absolute grams
      sum.protein += (+e.nq.protein || 0) * f;
      sum.fiber += (+e.nq.fiber || 0) * f;
      sum.fat += (+e.nq.fat || 0) * f;
      sum.satfat += (+e.nq.satfat || 0) * f;
      sum.sugars += (+e.nq.sugars || 0) * f;
      sum.salt += (+e.nq.salt || 0) * f;
      if (e.nq.ed > 0) sum.grams += kcal / e.nq.ed * 100; else gramsKnown = false;
    });
    var day = null;
    if (kcalScored > 0) {
      day = ndPer100kcal({ kcal: kcalScored, protein: sum.protein, fiber: sum.fiber, fat: sum.fat },
        { satfat: sum.satfat, sugars: sum.sugars, salt: sum.salt, grams: gramsKnown ? sum.grams : 0 });
    }
    var score = day ? ndScore(day) : null;
    return {
      score: score,
      breakdown: day ? ndBreakdown(day) : null,
      target: ND_TARGET,
      average: ND_POPULATION_AVERAGE,
      hit: score != null && score >= ND_TARGET,
      kcalScored: Math.round(kcalScored),
      kcalTotal: Math.round(kcalTotal),
      coverage: kcalTotal > 0 ? kcalScored / kcalTotal : 0,
      uncovered: Math.round(Math.max(0, kcalTotal - kcalScored)),
    };
  }

  // A run of days, for the trend. `days` is [{ date, entries }]. Days with nothing scoreable are
  // reported but left out of the average, so a day you did not log cannot read as a bad one.
  // The average is what actually matters: HEI is a measure of a dietary PATTERN, and one heavy
  // Saturday inside a good week is not the same thing as a bad week.
  function ndTrend(days) {
    var scored = [], total = 0;
    (days || []).forEach(function (d) {
      var r = ndDay(d.entries);
      scored.push({ date: d.date, score: r.score, hit: r.hit });
      if (r.score != null) total += r.score;
    });
    var withScore = scored.filter(function (d) { return d.score != null; });
    return {
      days: scored,
      average: withScore.length ? Math.round(total / withScore.length) : null,
      daysScored: withScore.length,
      daysHit: withScore.filter(function (d) { return d.hit; }).length,
      target: ND_TARGET,
    };
  }

  // ---------------------------------------------------------------------------
  // Display decisions
  //
  // These used to live in the UI file, where nothing could test them, and every one of them has
  // been wrong at least once: blocks painted red for beating a target, a status colour borrowed
  // from a macro's identity hue, a meter that filled past its own goal. They are pure functions of
  // a value and a target, so they belong here with the rest of the maths.

  // How many blocks of a segmented meter are lit, and which of them are an overshoot.
  // `overIsFine` is the difference between "you have gone over your fat" and "you have beaten your
  // fibre target": only the first is worth colouring as a problem.
  function meterCells(value, target, opts) {
    opts = opts || {};
    var cells = opts.cells || 10;
    var scale = opts.scale || 1.15;
    // Coerced, because a missing or half-typed number reaching a meter must draw an empty track
    // rather than NaN blocks. Entry fields hand over '' and undefined more often than you would think.
    var v = isFinite(+value) ? +value : 0;
    var t = isFinite(+target) ? +target : 0;
    var denom = t > 0 ? t * scale : 0;
    var goal = Math.round(cells / scale);
    var lit = denom > 0 ? Math.round(clamp(v, 0, denom) / denom * cells) : 0;
    var over = (!opts.overIsFine && t > 0 && v > t) ? Math.max(0, lit - goal) : 0;
    return { cells: cells, lit: lit, goal: goal, over: over };
  }

  // The status band a quality score sits in, as a token name rather than a colour. The UI maps the
  // token to a variable; keeping the decision here is what stops a macro's identity hue being
  // reused for a state, which is exactly what went wrong when "middling" wore the fat colour.
  function densityTone(score) {
    if (score == null) return 'muted';
    if (score >= ND_TARGET) return 'good';
    if (score >= 50) return 'warn';
    return 'danger';
  }

  // ---------------------------------------------------------------------------
  // Per-food grade (Nutri-Score 2023)
  //
  // The day score above is a dietary-pattern measure, and applying it to a single food goes wrong in
  // both directions: a food with nothing in it earns full marks for containing no saturated fat, and
  // a calorie-dense salty snack looks unsalted once you divide its salt by its calories. Nutri-Score
  // is the validated model built for the other job, judging one food per 100 g, with energy itself
  // as a penalty. So each measure is used where it holds: HEI for the day, Nutri-Score for the food.
  //
  // 2023 algorithm, general (solid) foods. The fruit/vegetable/legume share is supplied as a
  // percentage by weight (`fvl`), which the food database sometimes publishes and the AI estimator
  // otherwise judges; without it whole fruit and nuts land a grade low, since their virtue is
  // exactly what that component measures. One knowing gap remains: drinks are scored on the
  // solid-food table, because nothing in our data says a food is a drink, which is gentler on sugary
  // drinks than the real beverage table. Alcohol is not graded at all, as in Nutri-Score itself.
  var NS_GRADES = [['A', 1], ['B', 3], ['C', 11], ['D', 19]];   // upper bounds; anything above is E
  // Drinks are scored on their own, stricter table, because a liquid's calories are swallowed
  // without registering as food: 390 kJ per 100 ml is the worst band for a drink where a solid food
  // is allowed 3,350. Without this a sugary drink scored like a mild snack. Nutri-Score reserves A
  // for water alone, so the best any other drink can reach is B.
  var NS_BEV_GRADES = [['B', 3], ['C', 7], ['D', 10]];          // upper bounds; anything above is E
  var NS_BEV_PROTEIN = [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0];     // g per 100 ml, one point each
  function nsBevFvlPoints(pct) {
    if (!(pct > 40)) return 0;
    if (pct > 80) return 6;
    if (pct > 60) return 4;
    return 2;
  }
  // Fruit, vegetable and legume share by weight, and the points it earns.
  function nsFvlPoints(pct) {
    if (!(pct > 40)) return 0;
    if (pct > 80) return 5;
    if (pct > 60) return 2;
    return 1;
  }
  function nsSteps(value, first, step, max) {
    if (!(value > 0) || value < first) return 0;
    return Math.min(max, Math.floor((value - first) / step) + 1);
  }
  // The drinks table. Energy runs 30 to 390 kJ per 100 ml and sugars 0.5 to 11 g, both far tighter
  // than the solid-food scale, and protein always counts (there is no "too negative to earn it"
  // rule here). Plain water is the only drink that can reach A, which the caller flags.
  function nutriScoreBeverage(p100ml, kcal) {
    var kJ = kcal * 4.184;
    var neg = nsSteps(kJ, 30, 36, 10)
      + nsSteps(+p100ml.sugars || 0, 0.5, 1.05, 10)
      + Math.min(10, Math.floor(Math.max(0, +p100ml.satfat || 0)))
      + Math.min(20, Math.floor(Math.max(0, +p100ml.salt || 0) / 0.2));
    var proteinPts = 0, protein = Math.max(0, +p100ml.protein || 0);
    for (var i = 0; i < NS_BEV_PROTEIN.length; i++) { if (protein >= NS_BEV_PROTEIN[i]) proteinPts = i + 1; }
    var fvlPts = nsBevFvlPoints(+p100ml.fvl || 0);
    var points = neg - (proteinPts + fvlPts);
    var grade = 'E';
    if (p100ml.water) grade = 'A';
    else {
      for (var g = 0; g < NS_BEV_GRADES.length; g++) { if (points < NS_BEV_GRADES[g][1]) { grade = NS_BEV_GRADES[g][0]; break; } }
    }
    return { points: points, grade: grade, negative: neg, positive: proteinPts + fvlPts, beverage: true };
  }
  // p100g = per 100 g (or per 100 ml for a drink):
  //   { kcal, protein, fiber, fat, satfat, sugars, salt, fvl, beverage, water }
  function nutriScore(p100g) {
    if (!p100g) return null;
    var kcal = Math.max(0, +p100g.kcal || 0);
    if (p100g.beverage) return nutriScoreBeverage(p100g, kcal);
    if (kcal <= 0) return null;
    var kJ = kcal * 4.184;
    // Negative: energy 0-10 in 335 kJ steps; sugars 0-15 from 3.4 g in 3.4 g steps; saturated fat
    // 0-10 at a point per gram; salt 0-20 in 0.2 g steps.
    var neg = Math.min(10, Math.floor(kJ / 335))
      + nsSteps(+p100g.sugars || 0, 3.4, 3.4, 15)
      + Math.min(10, Math.floor(Math.max(0, +p100g.satfat || 0)))
      + Math.min(20, Math.floor(Math.max(0, +p100g.salt || 0) / 0.2));
    // Positive: fibre 0-5 from 3.0 g in 1.1 g steps; protein 0-7 from 2.4 g in 2.433 g steps;
    // fruit/veg/legumes by share of weight.
    var fiberPts = nsSteps(+p100g.fiber || 0, 3.0, 1.1, 5);
    var proteinPts = nsSteps(+p100g.protein || 0, 2.4, (17 - 2.4) / 6, 7);
    var fvlPts = nsFvlPoints(+p100g.fvl || 0);
    // Protein stops counting once a food is far enough into the negative, so a salty, fatty product
    // cannot buy its way back with protein alone. Fibre and the plant share always count.
    var points = neg >= 11 ? neg - (fiberPts + fvlPts) : neg - (fiberPts + proteinPts + fvlPts);
    var grade = 'E';
    for (var i = 0; i < NS_GRADES.length; i++) { if (points < NS_GRADES[i][1]) { grade = NS_GRADES[i][0]; break; } }
    return { points: points, grade: grade, negative: neg, positive: fiberPts + proteinPts + fvlPts };
  }

  // ---------------------------------------------------------------------------
  // The Density Score
  //
  // Nutri-Score's own output is a letter and a points total that runs BACKWARDS (fewer points is
  // better, and it goes negative), which is no good to show anyone. We publish our own 0-100
  // Density Score instead: same direction as the day score, same meaning at the same numbers, so 70
  // means "good" whether you are looking at one food or a whole day.
  //
  // The conversion is a straight line between Nutri-Score's OWN published grade boundaries, so the
  // validated thresholds still decide where the bands fall; only the presentation is ours.
  //   points -15 (the best a food can do) -> 100
  //   points   1 (the A/B boundary)       -> 75
  //   points   3 (B/C)                    -> 65
  //   points  11 (C/D)                    -> 50
  //   points  19 (D/E)                    -> 35
  //   points  40 (the worst)              -> 0
  var DS_ANCHORS = [[-15, 100], [1, 75], [3, 65], [11, 50], [19, 35], [40, 0]];
  // Drinks have their own grade boundaries, so they get their own anchors through the same band
  // meanings. Sharing the solid-food line would have read a cola's points against thresholds set for
  // biscuits and flattered it, which is the whole failure this table exists to fix.
  var DS_BEV_ANCHORS = [[-6, 100], [3, 70], [7, 50], [10, 35], [25, 0]];
  function densityScore(points, beverage) {
    if (points == null || !isFinite(points)) return null;
    var anchors = beverage ? DS_BEV_ANCHORS : DS_ANCHORS;
    if (points <= anchors[0][0]) return 100;
    for (var i = 1; i < anchors.length; i++) {
      var a = anchors[i - 1], b = anchors[i];
      if (points <= b[0]) {
        return Math.round(a[1] + (points - a[0]) / (b[0] - a[0]) * (b[1] - a[1]));
      }
    }
    return 0;
  }
  // Bands for a single food, lined up with the day's target so 70 reads the same on both screens.
  function dsBand(score) {
    if (score == null) return { key: 'none', label: 'Not scored' };
    if (score >= 75) return { key: 'excellent', label: 'Excellent' };
    if (score >= ND_TARGET) return { key: 'good', label: 'Good' };
    if (score >= 50) return { key: 'ok', label: 'Middling' };
    if (score >= 35) return { key: 'low', label: 'Once in a while' };
    return { key: 'treat', label: 'Treat' };
  }

  // Convert a stored per-100-kcal record into the per-100-g basis the food score needs. Needs `ed`
  // (energy density), so a food logged without a known weight cannot be scored.
  function nsFromNq(nq) {
    if (!nq || !(nq.ed > 0)) return null;
    var f = nq.ed / 100;   // grams per 100 kcal -> grams per 100 g
    var ns = nutriScore({
      kcal: nq.ed,
      protein: (+nq.protein || 0) * f, fiber: (+nq.fiber || 0) * f, fat: (+nq.fat || 0) * f,
      satfat: (+nq.satfat || 0) * f, sugars: (+nq.sugars || 0) * f, salt: (+nq.salt || 0) * f,
      fvl: +nq.fvl || 0, beverage: !!nq.bev, water: !!nq.water,
    });
    if (!ns) return null;
    // Plain water is the one drink Nutri-Score lets reach A, and it is the ideal by definition, so
    // it takes the top of the scale rather than whatever its (zero) points happen to interpolate to.
    ns.score = nq.water ? 100 : densityScore(ns.points, !!nq.bev);
    ns.band = dsBand(ns.score);
    return ns;
  }

  // What drove a food's score, worst offender first, so the app can say why in plain words rather
  // than showing a bare number. Thresholds are the Nutri-Score point steps themselves.
  function dsReasons(nq) {
    if (!nq || !(nq.ed > 0)) return [];
    var f = nq.ed / 100;
    var out = [];
    var sugars = (+nq.sugars || 0) * f, satfat = (+nq.satfat || 0) * f, salt = (+nq.salt || 0) * f;
    var fiber = (+nq.fiber || 0) * f, protein = (+nq.protein || 0) * f, fvl = +nq.fvl || 0;
    if (nq.ed >= 480) out.push({ good: false, key: 'energy', text: 'very calorie dense' });
    else if (nq.ed >= 320) out.push({ good: false, key: 'energy', text: 'calorie dense' });
    if (sugars >= 22.5) out.push({ good: false, key: 'sugars', text: 'high in sugar' });
    else if (sugars >= 10) out.push({ good: false, key: 'sugars', text: 'fairly sugary' });
    if (satfat >= 5) out.push({ good: false, key: 'satfat', text: 'high in saturated fat' });
    else if (satfat >= 1.5) out.push({ good: false, key: 'satfat', text: 'some saturated fat' });
    if (salt >= 1.5) out.push({ good: false, key: 'salt', text: 'high in salt' });
    else if (salt >= 0.6) out.push({ good: false, key: 'salt', text: 'fairly salty' });
    if (protein >= 12) out.push({ good: true, key: 'protein', text: 'high in protein' });
    else if (protein >= 5) out.push({ good: true, key: 'protein', text: 'a good bit of protein' });
    if (fiber >= 6) out.push({ good: true, key: 'fiber', text: 'high in fibre' });
    else if (fiber >= 3) out.push({ good: true, key: 'fiber', text: 'a good bit of fibre' });
    if (fvl > 80) out.push({ good: true, key: 'fvl', text: 'mostly fruit, veg or pulses' });
    else if (fvl > 40) out.push({ good: true, key: 'fvl', text: 'plenty of fruit, veg or pulses' });
    return out;
  }

  // Take an AI estimate of the three limit nutrients and hold it to the macros we already know.
  // A model that claims more saturated fat than there is fat, or more sugar than carbohydrate, has
  // contradicted the food in front of it, and an estimate that does that is worse than none. Returns
  // null when the model declined or gave us nothing, so the caller leaves the food unscored.
  function ndClampEstimate(raw, macros) {
    if (!raw || raw.confident === false) return null;
    var sf = raw.satfat_g, sg = raw.sugars_g, sa = raw.salt_g;
    if (sf == null && sg == null && sa == null) return null;
    macros = macros || {};
    var out = {
      satfat: Math.min(Math.max(0, +sf || 0), Math.max(0, +macros.fat || 0)),
      sugars: Math.min(Math.max(0, +sg || 0), Math.max(0, +macros.carbs || 0)),
      salt: Math.max(0, +sa || 0),
      estimated: true,
    };
    if (raw.fvl_pct != null && isFinite(+raw.fvl_pct)) out.fvl = clamp(+raw.fvl_pct, 0, 100);
    if (raw.is_drink === true) out.beverage = true;
    if (raw.is_water === true) { out.beverage = true; out.water = true; }
    return out;
  }

  // Plain-English band for a day, on the published HEI-2020 cut points: high >=70, marginal 60-70,
  // low 50-60, very low <=50. Worded for someone looking at their own day, not for a journal.
  function ndBand(score) {
    if (score == null) return { key: 'none', label: 'No data' };
    if (score >= ND_TARGET) return { key: 'good', label: 'Good' };
    if (score >= 60) return { key: 'ok', label: 'Nearly there' };
    if (score >= 50) return { key: 'low', label: 'Room to improve' };
    return { key: 'poor', label: 'Worth a look' };
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
  // TREND_ALPHA is the app's ONE smoothing: the chart's trend line, the stored trend_weight and the
  // check-in's cycle means all use it, so "your trend weight" is a single number wherever it appears.
  var TREND_ALPHA = 0.3;
  function trendSeries(entries, alpha) {
    alpha = alpha == null ? TREND_ALPHA : alpha;
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
    // Weight-only lane: the person keeps roughly on plan but doesn't log every bite, so we can't trust
    // intake for the energy-balance read. The caller instead assumes intake == current target and feeds
    // an implied burn from the weigh-in trend; we steer purely on the gap between actual and goal rate.
    var wOnly = opts.mode === 'weightOnly';

    var minDays = opts.minDays || 5;
    var periodDays = opts.periodDays || (opts.estimate && opts.estimate.days) || 7;
    if (!wOnly && opts.adherenceDays < minDays) {
      return { changed: false, reason: 'Only ' + opts.adherenceDays + '/' + periodDays + ' days logged this cycle. I\'ll hold your targets. Log a fuller cycle and I\'ll dial them in.', estimate: opts.estimate };
    }
    if (!wOnly && opts.estimate.tdee < bmr * 1.05) {
      return { changed: false, underReportFlagged: true, reason: 'Your numbers imply an expenditure (' + opts.estimate.tdee + ' kcal) near or below your BMR (' + round(bmr) + '), which usually means food was under-logged. Trusting your weight trend and holding targets this cycle.', estimate: opts.estimate };
    }
    // Cap each check-in's move PROPORTIONAL to estimated burn (bigger person / bigger adaptation ->
    // bigger allowed step; ~10% of TDEE, 150-350 kcal), THEN scale that by how confident this cycle's
    // data is, coverage of logging and weigh-ins, and cycle length. A clean, complete cycle earns
    // the full step; a sparser one moves more cautiously so noise can't drive a big swing. Follows
    // Helms/Nippard practical sizing and MacroFactor's expenditure-scaled, smoothed adjustments.
    var logCov = clamp((opts.adherenceDays || 0) / periodDays, 0, 1);
    // A single weekly weigh-in is full coverage for THAT cadence, just noisier than a daily average, so
    // treat it as present-but-moderate rather than reading as 1-of-7 days missing.
    var weighCov = opts.weighCadence === 'single'
      ? ((opts.weighDays || 0) >= 1 ? 0.7 : 0)
      : clamp((opts.weighDays != null ? opts.weighDays : (opts.adherenceDays || 0)) / periodDays, 0, 1);
    // Weight-only leans entirely on weigh-in coverage; the balance lane takes the weaker of the two.
    var conf = clamp((wOnly ? weighCov : Math.min(logCov, weighCov)) * clamp(periodDays / 7, 0.6, 1), 0, 1);
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
    newTargets.source = wOnly ? 'adaptive-weight' : 'adaptive';
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
      reason = 'You\'re ' + actualStr + '. ' + why + deltaR + ' kcal, to ' + newKcalR + ' kcal. (' + (wOnly ? 'Your weigh-ins point' : 'Your food and weight point') + ' to burning ~' + round(burnRef) + ' kcal a day.) Protein stays ' + newTargets.protein_g + ' g.';
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
  //   cyclingChangedAt: 'YYYY-MM-DD' | null              day the high/low plan was last edited; days
  //                                                      eaten before it are locked out of carryover
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
        // A mid-cycle change to the high/low plan locks in the days already eaten under the old plan:
        // we don't re-score them against the new cycling targets (that would invent a phantom
        // surplus/deficit). Only eating from the change date forward carries across remaining days.
        var accrueFrom = opts.cyclingChangedAt || null;
        var acc = 0, days = [];
        for (var i = 0; i < idx; i++) {
          var dISO = shiftISOdays(opts.cycleStart, i);
          if (accrueFrom && dISO < accrueFrom) continue;
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

  // ---- can this cycle actually be read? -------------------------------------------------------
  // A short cycle cannot see a small change when the scale swings more than the change does. Someone
  // whose weight bounces 1.4 kg between mornings needs more days than someone who reads +-0.2 kg, and
  // the difference is not a matter of opinion: it is the standard error of the difference between two
  // cycle means, sd * sqrt(2/n). Reporting "flat" from a window too short to see the target is worse
  // than saying nothing, because it looks like a verdict on the person rather than on the data.
  //   opts: { weights:[{date,kg}], cycleStart, today, cycleDays, targetRatePerWeek, weighCadence }
  // Returns { readable, sd, noiseKg, signalKg, n, daysNeeded, readyOn } (readable:true when there is
  // nothing to warn about, including when there is too little data to judge noise at all).
  function readReliability(opts) {
    var cs = opts.cycleStart, today = opts.today;
    var cycleDays = opts.cycleDays || Math.max(1, daysBetweenISO(cs, today) + 1);
    var rate = Math.abs(opts.targetRatePerWeek || 0);
    // A single weekly reading has no within-cycle spread to measure, and maintenance has no target
    // movement to detect, so neither has a noise floor this can speak to.
    if (opts.weighCadence === 'single' || !(rate > 0)) return { readable: true, sd: null, n: 0 };
    var ws = (opts.weights || []).filter(function (w) { return w && w.kg != null; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    // Day-to-day noise, measured the robust way: the typical size of an overnight change, which for a
    // steady-ish series is about 1.4 sd. Uses up to the last 28 readings so it reflects this person now.
    var recent = ws.slice(-28), diffs = [];
    for (var i = 1; i < recent.length; i++) {
      var gap = daysBetweenISO(recent[i - 1].date, recent[i].date);
      if (gap === 1) diffs.push(Math.abs(recent[i].kg - recent[i - 1].kg));
    }
    if (diffs.length < 4) return { readable: true, sd: null, n: diffs.length };
    diffs.sort(function (a, b) { return a - b; });
    var med = diffs.length % 2 ? diffs[(diffs.length - 1) / 2] : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2;
    var sd = med / 1.128;   // median absolute successive difference -> sd, for a stable series
    var n = 0;
    for (var j = 0; j < ws.length; j++) if (ws[j].date >= cs && ws[j].date <= today) n++;
    if (n < 2) return { readable: true, sd: round(sd, 3), n: n };
    // Consecutive mornings are not independent: a salty meal or a big day inflates two or three
    // readings together, so five weigh-ins can carry less information than five coin flips. Discount
    // the count by the lag-1 autocorrelation of the readings around their own trend, the standard
    // effective-sample-size correction, so clustered water weight cannot masquerade as evidence.
    var nEff = Math.max(1.5, n * (1 - lag1Autocorr(recent)) / (1 + lag1Autocorr(recent)));
    // What we could detect from that many independent readings a side, versus what the goal should
    // have moved by now.
    var noise = sd * Math.sqrt(2 / nEff);
    var signal = rate * (cycleDays / 7);
    if (signal >= noise) return { readable: true, sd: round(sd, 3), noiseKg: round(noise, 2), signalKg: round(signal, 2), n: n };
    // How many more days of daily weighing until the target movement clears the noise. Both sides grow
    // with the window, so solve for the day count where signal >= sd * sqrt(2/days).
    var days = cycleDays;
    var perDayEff = nEff / n;   // hold this person's information-per-weigh-in as the window grows
    while (days < 28 && rate * (days / 7) < sd * Math.sqrt(2 / Math.max(1.5, days * perDayEff))) days++;
    return {
      readable: false, sd: round(sd, 3), noiseKg: round(noise, 2), signalKg: round(signal, 2), n: n,
      daysNeeded: days, readyOn: shiftISOdays(cs, days - 1),
    };
  }

  // Lag-1 autocorrelation of weigh-ins around their own trend line. 0 means each morning is fresh
  // information; higher means readings move in runs, as they do when water is coming and going.
  function lag1Autocorr(ws) {
    if (!ws || ws.length < 4) return 0;
    var ts = trendSeries(ws.map(function (w) { return { date: w.date, weightKg: w.kg }; }));
    var res = ws.map(function (w, i) { return w.kg - ts[i].trendKg; });
    var m = mean(res), num = 0, den = 0;
    for (var i = 1; i < res.length; i++) num += (res[i] - m) * (res[i - 1] - m);
    for (var j = 0; j < res.length; j++) den += (res[j] - m) * (res[j] - m);
    if (!(den > 0)) return 0;
    return clamp(num / den, 0, 0.9);
  }

  // ---- body-fat trend ------------------------------------------------------------------------
  // Body fat comes from three very different rulers: a smart scale (a reading every morning, noisy
  // by +-2 points on hydration alone), a photo estimate (episodic, directional), and a deliberate
  // measurement like DEXA or calipers (rare, the most trustworthy single number). All three are
  // worth having, so the app takes any of them and reads the TREND rather than the last number.
  //
  // Two rules make that honest:
  //   1. Gap-aware EMA at a slower alpha than weight. Daily scale noise is damped, but a reading
  //      after a six-week gap effectively becomes the trend, which is what you want from an
  //      episodic measurement.
  //   2. A change of METHOD restarts the trend instead of blending across it. A DEXA 18% after a
  //      scale's 24% is not a six-point drop in a day, it is a different ruler, and smoothing the
  //      two together would invent a fat loss that never happened (and move the protein target
  //      with it).
  var BF_TREND_ALPHA = 0.15;
  function bfSourceOf(r) { return (r && r.source) || 'manual'; }
  // readings: [{ date, pct, source }] in any order. Returns them sorted, each with trendPct.
  function bodyFatTrend(readings, alpha) {
    alpha = alpha == null ? BF_TREND_ALPHA : alpha;
    var rs = (readings || []).filter(function (r) { return r && r.pct != null && isFinite(+r.pct); })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = [], trend = null, prevDate = null, prevSource = null;
    for (var i = 0; i < rs.length; i++) {
      var pct = +rs[i].pct, src = bfSourceOf(rs[i]);
      if (trend == null || src !== prevSource) trend = pct;   // first reading, or a new ruler
      else {
        var gap = prevDate != null ? daysBetweenISO(prevDate, rs[i].date) : 1;
        if (!isFinite(gap) || gap < 1) gap = 1;
        var effAlpha = 1 - Math.pow(1 - alpha, gap);
        trend = trend + effAlpha * (pct - trend);
      }
      prevDate = rs[i].date; prevSource = src;
      out.push({ date: rs[i].date, pct: pct, source: src, trendPct: round(trend, 1) });
    }
    return out;
  }
  // The body fat the app should ACT on (protein target, lean mass), plus the context needed to say
  // where it came from and whether it is getting stale. null when nothing has ever been recorded.
  function bodyFatNow(readings) {
    var ts = bodyFatTrend(readings);
    if (!ts.length) return null;
    var last = ts[ts.length - 1];
    var sameRuler = 0;
    for (var i = ts.length - 1; i >= 0 && ts[i].source === last.source; i--) sameRuler++;
    return { pct: last.trendPct, raw: last.pct, date: last.date, source: last.source, n: ts.length, nSameSource: sameRuler };
  }
  // Is a body-fat reading due? Not on a calendar: when the number would actually be WRONG. Body fat
  // only earns its keep by sizing the protein target off lean mass, so what matters is how far the
  // body has moved since the last reading. A deliberate measurement also goes stale slower than a
  // scale reading nobody took on purpose.
  //   opts: { readings, weightKg, weightAtLastReadingKg, today, minDays }
  // Returns { due, reason:'moved'|'stale'|null, kgMoved, daysSince } (due:false when never recorded,
  // so a first reading is invited elsewhere rather than nagged for here).
  function bodyFatReadingDue(opts) {
    var now = bodyFatNow(opts && opts.readings);
    if (!now) return { due: false, reason: null, kgMoved: null, daysSince: null };
    var days = daysBetweenISO(now.date, opts.today);
    var moved = (opts.weightKg != null && opts.weightAtLastReadingKg != null)
      ? Math.abs(opts.weightKg - opts.weightAtLastReadingKg) : null;
    var minDays = opts.minDays == null ? 14 : opts.minDays;
    // 3% of bodyweight is roughly where a stale body-fat figure starts to misprice protein.
    var moveTrigger = opts.weightKg != null ? Math.max(2, opts.weightKg * 0.03) : 3;
    if (days >= minDays && moved != null && moved >= moveTrigger) return { due: true, reason: 'moved', kgMoved: round(moved, 1), daysSince: days };
    if (days >= 84) return { due: true, reason: 'stale', kgMoved: moved != null ? round(moved, 1) : null, daysSince: days };
    return { due: false, reason: null, kgMoved: moved != null ? round(moved, 1) : null, daysSince: days };
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
  // The two weights a check-in is decided between, and the real span between them. Split out of
  // checkInDecision so the UI can SHOW the same numbers the decision is made from, rather than a
  // second, similar-looking average of its own.
  //   opts: { weights:[{date,kg}], cycleStart, today, cycleDays, weighCadence }
  // Returns { cur, prev, curCycle:[{date,weightKg}], spanDays, count, curDate, prevDate, source }
  // where source is 'trend' (EMA cycle means) or 'reading' (single weekly weigh-in).
  function cycleMeans(opts) {
    var cs = opts.cycleStart, today = opts.today;
    var cycleDays = opts.cycleDays || Math.max(1, daysBetweenISO(cs, today) + 1);
    var ws = (opts.weights || []).filter(function (w) { return w && w.kg != null; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    // Single weigh-in cadence: one reading per cycle, so EMA cycle means over a lone point add
    // nothing. Diff the two most recent raw weigh-ins directly, over their real gap.
    if (opts.weighCadence === 'single') {
      var curPts = ws.filter(function (w) { return w.date >= cs && w.date <= today; });
      var prevPts = ws.filter(function (w) { return w.date < cs; });
      var curPt = curPts.length ? curPts[curPts.length - 1] : null;
      var prevPt = prevPts.length ? prevPts[prevPts.length - 1] : null;
      return {
        cur: curPt ? curPt.kg : null, prev: prevPt ? prevPt.kg : null,
        curCycle: curPts.map(function (w) { return { date: w.date, weightKg: w.kg }; }),
        spanDays: (curPt && prevPt) ? Math.max(1, daysBetweenISO(prevPt.date, curPt.date)) : cycleDays,
        count: curPts.length, curDate: curPt ? curPt.date : null, prevDate: prevPt ? prevPt.date : null,
        source: 'reading',
      };
    }
    // Cycle means diff SMOOTHED trend values (gap-aware EMA), not raw scale weights, so one odd
    // morning or a weigh-in gap cannot swing the read. The decision trend uses a faster alpha (0.3)
    // than the chart's 0.1: it still soaks up day-to-day water noise but lags only ~2 days, so the
    // measured rate tracks the CURRENT cycle instead of echoing last cycle's deficit (which would
    // bias the expenditure estimate and invite oscillation).
    var ts = trendSeries(ws.map(function (w) { return { date: w.date, weightKg: w.kg }; }), TREND_ALPHA);
    var prevStart = shiftISOdays(cs, -cycleDays), prevEnd = shiftISOdays(cs, -1);
    var curVals = [], prevVals = [], curCycle = [];
    for (var i = 0; i < ts.length; i++) {
      var pnt = ts[i];
      if (pnt.date >= cs && pnt.date <= today) { curVals.push(pnt.trendKg); curCycle.push(pnt); }
      else if (pnt.date >= prevStart && pnt.date <= prevEnd) prevVals.push(pnt.trendKg);
    }
    return {
      cur: curVals.length ? mean(curVals) : null, prev: prevVals.length ? mean(prevVals) : null,
      curCycle: curCycle, spanDays: cycleDays, count: curVals.length,
      curDate: curCycle.length ? curCycle[curCycle.length - 1].date : null, prevDate: null,
      source: 'trend',
    };
  }

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
    var wOnly = opts.mode === 'weightOnly';
    // Balance lane needs real logged intake; the weight-only lane doesn't, so skip the logs gate there.
    if (!wOnly && vals.length < 3) return { status: 'needdata', reasonCode: 'logs', completeDays: completeDays };
    var avgKcal = vals.length ? mean(vals) : null;
    var cm = cycleMeans(opts);
    var curAvg = cm.cur, prevAvg = cm.prev, curCycle = cm.curCycle, spanDaysForRate = cm.spanDays;
    if (opts.weighCadence === 'single') {
      if (curAvg == null) return { status: 'needdata', reasonCode: 'weighins', completeDays: completeDays };
      if (prevAvg == null) {
        // First single weigh-in ever: nothing to diff, so hold and let this reading set the baseline.
        return { status: 'proposed', changed: false, earlyPhase: true, direction: 'unchanged', completeDays: completeDays,
          expectedKgPerWeek: 0, actualKgPerWeek: 0, plateau: { plateau: false, cycles: 0 },
          reason: 'This weigh-in sets your baseline. On a single weekly weigh-in I need two readings to see a trend, so I\'m holding your targets. Weigh in again on your next check-in and I\'ll retune.',
          estimate: { tdee: (opts.expenditure && opts.expenditure.kcal) || opts.currentTargets.kcal, avgKcal: opts.currentTargets.kcal, weeklyChangeKg: 0, days: cycleDays, weightOnly: wOnly } };
      }
    }
    var result;
    if (wOnly) {
      // Weight-only lane: assume intake tracked the current target and read the trend for the actual
      // rate. The implied burn (target minus what the scale moved) feeds the same desired-target math;
      // when on-track the rate gap is ~0 and it holds, so what was actually eaten never needs knowing.
      var curKcal = opts.currentTargets.kcal;
      var expW = opts.profile.goalType === 'cut' ? -Math.abs(opts.profile.rateKgPerWeek || 0) : opts.profile.goalType === 'gain' ? Math.abs(opts.profile.rateKgPerWeek || 0) : 0;
      if (prevAvg == null) {
        // First cycle on the scale alone is water-heavy and noisy; hold and let a full cycle settle.
        if (curCycle.length < 3) return { status: 'needdata', reasonCode: 'weighins', completeDays: completeDays };
        var xsW = curCycle.map(function (w) { return daysBetweenISO(cs, w.date); });
        var ysW = curCycle.map(function (w) { return w.weightKg; });
        var wChg = theilSen(xsW, ysW).slope * 7;
        result = { changed: false, earlyPhase: true, direction: 'unchanged', expectedKgPerWeek: round(expW, 2), actualKgPerWeek: round(wChg, 3),
          reason: 'First cycle on weigh-ins alone is a noisy, water-heavy read, so I\'m holding your targets. Keep weighing in across a full cycle and I\'ll steer from your settled trend.',
          estimate: { tdee: round(curKcal - (wChg * KCAL_PER_KG) / 7), avgKcal: round(curKcal), weeklyChangeKg: round(wChg, 3), days: cycleDays, weightOnly: true } };
      } else {
        if (curAvg == null) return { status: 'needdata', reasonCode: 'weighins', completeDays: completeDays };
        var wChg2 = ((curAvg - prevAvg) / spanDaysForRate) * 7;
        var estW = { tdee: round(curKcal - (wChg2 * KCAL_PER_KG) / 7), avgKcal: round(curKcal), weeklyChangeKg: round(wChg2, 3), days: cycleDays, weightOnly: true };
        result = weeklyAdjust({ profile: opts.profile, currentTargets: opts.currentTargets, estimate: estW, adherenceDays: completeDays, weighDays: opts.weighDays, minDays: opts.minDays, periodDays: opts.periodDays || cycleDays, expenditure: opts.expenditure, waterHigh: opts.waterHigh, mode: 'weightOnly', weighCadence: opts.weighCadence });
      }
    } else if (prevAvg == null) {
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
      var est2 = estimateExpenditure({ dailyKcal: vals, trendStartKg: prevAvg, trendEndKg: curAvg, days: spanDaysForRate });
      result = weeklyAdjust({ profile: opts.profile, currentTargets: opts.currentTargets, estimate: est2, adherenceDays: completeDays, weighDays: opts.weighDays, minDays: opts.minDays, periodDays: opts.periodDays || cycleDays, expenditure: opts.expenditure, waterHigh: opts.waterHigh, weighCadence: opts.weighCadence });
    }
    // Two strikes and the food log is out. Holding once on a suspicious log is prudent; holding every
    // cycle is a dead end, because the person whose log never reconciles is exactly the person whose
    // plan never adapts. When the previous check-in flagged under-reporting and this one does too,
    // stop waiting for a log we don't believe and steer from the scale instead, which is what the
    // weight-only lane already exists to do.
    var priorFlagged = (function () {
      var cis = opts.checkins || [];
      for (var i = cis.length - 1; i >= 0; i--) if (cis[i] && cis[i].underReport != null) return !!cis[i].underReport;
      return false;
    })();
    if (result.underReportFlagged && priorFlagged && !wOnly && curAvg != null && prevAvg != null) {
      var curKcalS = opts.currentTargets.kcal;
      var wChgS = ((curAvg - prevAvg) / spanDaysForRate) * 7;
      var estS = { tdee: round(curKcalS - (wChgS * KCAL_PER_KG) / 7), avgKcal: round(curKcalS), weeklyChangeKg: round(wChgS, 3), days: cycleDays, weightOnly: true };
      var switched = weeklyAdjust({ profile: opts.profile, currentTargets: opts.currentTargets, estimate: estS, adherenceDays: completeDays, weighDays: opts.weighDays, minDays: opts.minDays, periodDays: opts.periodDays || cycleDays, expenditure: opts.expenditure, waterHigh: opts.waterHigh, mode: 'weightOnly', weighCadence: opts.weighCadence });
      switched.laneSwitched = 'weightOnly';
      switched.underReportFlagged = true;
      switched.reason = 'Your food log and your scale have disagreed two cycles running, so I\'m going to stop trying to reconcile them and steer from your weigh-ins alone. ' + (switched.reason || '');
      result = switched;
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
    composeDayTarget: composeDayTarget, checkInDecision: checkInDecision, cycleMeans: cycleMeans,
    isCompleteDay: isCompleteDay, updateExpenditure: updateExpenditure, detectPlateau: detectPlateau, menstrualPhase: menstrualPhase,
    trendSeries: trendSeries, TREND_ALPHA: TREND_ALPHA, readReliability: readReliability,
    bodyFatTrend: bodyFatTrend, bodyFatNow: bodyFatNow, bodyFatReadingDue: bodyFatReadingDue, BF_TREND_ALPHA: BF_TREND_ALPHA, estimateExpenditure: estimateExpenditure, weeklyAdjust: weeklyAdjust, earlyAdjust: earlyAdjust, round: round,
    avgStepsInRange: avgStepsInRange, stepsCoaching: stepsCoaching,
    ndScore: ndScore, ndPer100kcal: ndPer100kcal, ndDay: ndDay, ndBand: ndBand, ND_TARGET: ND_TARGET,
    ndClampEstimate: ndClampEstimate, ndBreakdown: ndBreakdown, ndTrend: ndTrend,
    ND_POPULATION_AVERAGE: ND_POPULATION_AVERAGE,
    nutriScore: nutriScore, nsFromNq: nsFromNq, densityScore: densityScore, dsBand: dsBand, dsReasons: dsReasons,
    meterCells: meterCells, densityTone: densityTone,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
