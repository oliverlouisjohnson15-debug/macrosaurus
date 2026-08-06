/*
 * quantity.js - Pure macro-scaling maths for the food confirm screen. Framework-free.
 * Exposes window.Quantity + Node module.exports. Tested in tests/quantity.test.js.
 * This is the code that turns "per 100 g" or "per serving" nutrition into the exact amount you log,
 * so a bug here silently corrupts calories. Keep it pure and tested.
 */
(function (root) {
  'use strict';

  function macNums(v) { v = v || {}; return { kcal: +v.kcal || 0, protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0, fiber: +v.fiber || 0 }; }
  function macScale(m, f) { return m ? { kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f, fiber: m.fiber * f } : null; }
  function macRound(m) { return { kcal: Math.round(m.kcal), protein: +m.protein.toFixed(1), carbs: +m.carbs.toFixed(1), fat: +m.fat.toFixed(1), fiber: +m.fiber.toFixed(1) }; }
  // Calories the macros imply. Used to fill a missing calorie figure and to flag entries whose
  // stated calories run too high.
  //
  // Fibre carries energy and MUST be counted, or the day never adds up. UK/EU labels (Reg.
  // 1169/2011 Annex XIV) declare "carbohydrate" EXCLUDING fibre and list fibre separately at
  // 2 kcal/g. So a UK label's calories are protein*4 + carbs*4 + fat*9 + fibre*2, and a plain
  // 4/4/9 sum lands short by 2 kcal for every gram of fibre: ~26 kcal across a 13 g fibre day,
  // and much more on a high-fibre one. That shortfall is what makes a logged day look like its
  // calories and its macros disagree.
  //
  // Alcohol (7 kcal/g) is not a macro we store, so alcoholic entries keep their own calories and
  // are excluded from every check built on this.
  var KCAL_PER_G = { protein: 4, carbs: 4, fat: 9, fiber: 2 };
  function atwaterRaw(m) {
    m = m || {};
    return (+m.protein || 0) * KCAL_PER_G.protein + (+m.carbs || 0) * KCAL_PER_G.carbs
      + (+m.fat || 0) * KCAL_PER_G.fat + (+m.fiber || 0) * KCAL_PER_G.fiber;
  }
  function atwater(m) { return Math.round(atwaterRaw(m)); }

  // Canonical per-unit bases from the entered nutrition.
  //   per100: the numbers in `m` are per 100 g.
  //   basisIsServing: the numbers in `m` are for ONE serving/piece.
  //   sg: the weight of one serving in grams (enables gram logging for serving-based foods).
  // Returns { perGram, perServMac }, either of which may be null when it cannot be derived.
  function deriveBases(opts) {
    var per100 = opts.per100, basisIsServing = opts.basisIsServing, sg = +opts.sg || 0, m = opts.m;
    var perGram = per100 ? macScale(m, 1 / 100) : (basisIsServing && sg ? macScale(m, 1 / sg) : null);
    var perServMac = basisIsServing ? m : (per100 && sg ? macScale(m, sg / 100) : null);
    if (!perGram && !perServMac) perServMac = m; // last resort: treat the base as one serving
    return { perGram: perGram, perServMac: perServMac };
  }

  // Final logged macros for `amount` of the chosen unit ('g' uses perGram, anything else perServMac).
  function finalMacros(bases, unit, amount) {
    var base = unit === 'g' ? bases.perGram : bases.perServMac;
    return macRound(macScale(base, +amount || 0) || { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  }

  var Quantity = { macNums: macNums, macScale: macScale, macRound: macRound, atwater: atwater, atwaterRaw: atwaterRaw, KCAL_PER_G: KCAL_PER_G, deriveBases: deriveBases, finalMacros: finalMacros };
  if (typeof module !== 'undefined' && module.exports) module.exports = Quantity;
  root.Quantity = Quantity;
})(typeof window !== 'undefined' ? window : this);
