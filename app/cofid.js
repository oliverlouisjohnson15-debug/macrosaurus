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

  /* ---- retrieval: measured figures to send WITH the request, not to check it afterwards ----
     When someone types what they ate, their words are the food names, so the table can be searched
     before the model is called and the real per-100 g values handed over as reference. Free: no
     extra request, no added latency.

     Everything below is precision work against one failure mode - handing the model a confidently
     wrong reference, which is worse than handing it none. Words that name a serving rather than a
     food ("two slices of"), a food already covered by a better match, and near-miss substrings are
     each removed for that reason. */
  var REF_STOP = /^(and|the|with|had|ate|some|for|from|was|were|then|plus|about|around|got|out|two|three|four|large|small|medium|homemade|leftover|slice|slices|piece|pieces|portion|serving|glass|bowl|plate|pack|packet|tbsp|tsp|grams|gram|half|full|side|extra|order)$/;
  var REF_LIMIT = 6;

  function refs(search, list, text, limit) {
    if (!list || !text) return [];
    var cap = limit || REF_LIMIT;
    var words = String(text).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 2 && !REF_STOP.test(w); });
    var seen = {}, used = {}, out = [];

    function take(probe) {
      if (out.length >= cap) return null;
      var hit = search(list, probe, 1)[0];
      if (!hit || !hit.per100 || !(hit.per100.kcal > 0) || seen[hit.name]) return null;
      // Every probe word must appear in the matched name as a word, allowing a SHORT inflection but
      // not a different word: "toast" may reach "toasted" and "chip" may reach "chips", while
      // "white" must not reach "whitecurrants". Food search matches loose substrings, which is right
      // while someone is typing and wrong here: a berry offered as the reference for a flat white
      // is worse than no reference at all.
      var terms = probe.split(' ');
      for (var t = 0; t < terms.length; t++) {
        if (!new RegExp('(^|[^a-z])' + terms[t] + '[a-z]{0,3}([^a-z]|$)', 'i').test(hit.name)) return null;
      }
      seen[hit.name] = 1;
      out.push(hit);
      return hit;
    }

    // Two-word phrases first: far likelier to name the right food than either word alone
    // ("chicken breast" beats "chicken").
    for (var i = 0; i < words.length - 1; i++) {
      if (used[i] || used[i + 1]) continue;
      var hit = take(words[i] + ' ' + words[i + 1]);
      if (!hit) continue;
      // Consume every word the matched name already accounts for, not just the two that found it.
      // "chicken tikka" reaching "Curry, chicken tikka masala" covers "masala" too; without this the
      // single-word pass went on to offer Garam masala as the reference for a curry.
      var lc = hit.name.toLowerCase();
      for (var j = 0; j < words.length; j++) if (lc.indexOf(words[j]) >= 0) used[j] = 1;
    }
    // Then single words the phrases missed, and only ones long enough to mean something: at three
    // letters "mac" in "big mac" reaches Macaroon.
    for (var k = 0; k < words.length; k++) if (!used[k] && words[k].length >= 4) take(words[k]);
    return out;
  }

  var Cofid = { query: query, check: check, profile: profile, refs: refs, TOL_UP: TOL_UP, TOL_DOWN: TOL_DOWN, VARIANTS: VARIANTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cofid;
  root.Cofid = Cofid;
})(typeof window !== 'undefined' ? window : this);
