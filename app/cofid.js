/*
 * cofid.js - Grounding an AI meal estimate against the UK food tables. Framework-free, no DOM or
 * network. Exposes window.Cofid + Node module.exports. Tested in tests/cofid.test.js.
 *
 * Why this exists: the meal estimator is a language model reasoning from a photo, and until this
 * landed nothing downstream ever checked its arithmetic against a measured source. The app has
 * shipped 2,854 CoFID foods since the food tables arrived and the estimator never looked at one.
 *
 * The split of responsibility is the whole idea. GRAMS are the model's job, because only it saw the
 * photo and only it knows how big the plate was. KCAL PER 100 G is the tables' job, because that is
 * a measured property of the food and not something worth guessing. So this compares energy density
 * and leaves weight alone.
 *
 * Everything here is deliberately conservative, because a wrong match is worse than no match: it
 * would talk someone out of a correct estimate and hand them a worse number. It only ever produces
 * an OFFER, never a rewrite; the confirm screen decides whether to show it and the user decides
 * whether to take it.
 */
(function (root) {
  'use strict';

  // Words that appear in the model's item names but never in a CoFID name, so they would block an
  // otherwise good match. Kept tight on purpose: every word removed here makes matching more
  // permissive, and permissive matching is what produces false corrections.
  var SKIP = /^(a|an|the|of|with|and|plus|some|large|small|medium|big|regular|extra|homemade|home-made|approx|approximately|about|leftover|side|portion|serving|helping)$/;

  function query(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')   // "(fried)" style notes are the model's, not CoFID's
      .replace(/[^a-z\s-]/g, ' ')    // apostrophes in brand names would never match anyway
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && !SKIP.test(w); })
      .join(' ')
      .trim();
  }

  /* Tolerances are asymmetric and loose on purpose, because the two failure modes are not equally
     bad. A false flag talks someone out of a correct estimate and offers them a worse number, which
     is worse than doing nothing at all; a missed flag just leaves the estimate where it already was.
     So this stays silent unless the gap is severe. The upward tolerance is the wider of the two
     because CoFID is largely retail and home cooking, and the restaurant or takeaway version of the
     same dish is legitimately richer than any variant in the table. */
  var TOL_UP = 0.35, TOL_DOWN = 0.30, VARIANTS = 8;

  /* Compare against the SPREAD of matching foods rather than one top hit. The app's food search
     ranks for "show me the plainest form", which is the wrong answer for a reference value:
     "chips" ranks microwave chips (221 kcal) above fried ones (~290), so grounding on the top hit
     alone would flag an honest chip-shop estimate. Taking the whole band means a food whose
     variants legitimately run 214-364 is left alone, while cheddar at 1000 is caught whichever
     cheddar you pick.
     `search` is injected (the app passes its own searchGenericFoods) so this file stays pure. */
  function check(search, list, items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var g = +it.grams || 0, kcal = +it.kcal || 0;
      // A weight the user stated explicitly is not ours to question.
      if (g <= 0 || kcal <= 0 || it.userSpecified) continue;
      var q = query(it.name);
      if (!q) continue;
      var hits = search(list, q, VARIANTS).filter(function (f) { return f.per100 && f.per100.kcal > 0; });
      if (!hits.length) continue;
      var aiPer100 = (kcal / g) * 100;
      var lo = Infinity, hi = 0;
      for (var h = 0; h < hits.length; h++) {
        var k = hits[h].per100.kcal;
        if (k < lo) lo = k;
        if (k > hi) hi = k;
      }
      if (aiPer100 <= hi * (1 + TOL_UP) && aiPer100 >= lo * (1 - TOL_DOWN)) continue;
      // Nearest variant to the model's own figure: the least disruptive correction that is still
      // measured, so "the fried one" is respected rather than overridden with the leanest entry.
      var best = hits[0];
      for (var b = 1; b < hits.length; b++) {
        if (Math.abs(hits[b].per100.kcal - aiPer100) < Math.abs(best.per100.kcal - aiPer100)) best = hits[b];
      }
      out.push({ i: i, name: it.name, ref: best.name, refKcal100: best.per100.kcal,
        aiKcal100: Math.round(aiPer100), high: aiPer100 > hi, profile: profile(best) });
    }
    return out;
  }

  // Per-100 g profile the confirm screen can apply at the model's grams. satfat/sugars/salt stay
  // null unless CoFID measured all of them, so an unmeasured value is never applied as a virtuous
  // zero: "nobody measured it" and "there is none in it" are not the same claim.
  function profile(food) {
    var p = food.per100;
    return { kcal: p.kcal / 100, protein: p.protein / 100, carbs: p.carbs / 100, fat: p.fat / 100, fiber: p.fiber / 100,
      satfat: food.extra ? food.extra.satfat / 100 : null,
      sugars: food.extra ? food.extra.sugars / 100 : null,
      salt: food.extra ? food.extra.salt / 100 : null };
  }

  var Cofid = { query: query, check: check, profile: profile, TOL_UP: TOL_UP, TOL_DOWN: TOL_DOWN, VARIANTS: VARIANTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cofid;
  root.Cofid = Cofid;
})(typeof window !== 'undefined' ? window : this);
