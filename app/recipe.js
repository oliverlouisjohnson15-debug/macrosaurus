/*
 * recipe.js - Pure helpers for the recipe module. Framework-free, no DOM or network.
 * Exposes window.Recipe + Node module.exports. Tested in tests/recipes.test.js.
 * The network fetch (recipe-extract), the AI structuring (ai-proxy) and all UI live in app.jsx;
 * everything here is pure so it can be unit-tested: URL detection, AI-JSON normalisation,
 * serving rescaling and shopping-list roll-up.
 */
(function (root) {
  'use strict';

  var num = function (v) { var n = +v; return isFinite(n) ? n : 0; };
  var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  // Ingredient macros from AI JSON (*_g keys) into the internal {kcal,protein,carbs,fat,fiber} shape.
  // Fills kcal from Atwater when the model left it blank but gave macros.
  function ingMacros(ing) {
    var m = { kcal: Math.round(num(ing.kcal)), protein: +num(ing.protein_g).toFixed(1), carbs: +num(ing.carbs_g).toFixed(1), fat: +num(ing.fat_g).toFixed(1), fiber: +num(ing.fiber_g).toFixed(1) };
    if (!m.kcal && (m.protein || m.carbs || m.fat)) m.kcal = Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9);
    return m;
  }
  function scaleMacros(m, f) { m = m || {}; return { kcal: Math.round(num(m.kcal) * f), protein: +(num(m.protein) * f).toFixed(1), carbs: +(num(m.carbs) * f).toFixed(1), fat: +(num(m.fat) * f).toFixed(1), fiber: +(num(m.fiber) * f).toFixed(1) }; }

  // Pull the first YouTube/Instagram link out of shared text (share sheets often send "caption https://...").
  // Returns { platform, url } or null. Only these two hosts are recognised (they are what the backend supports).
  function detectShare(text) {
    var m = String(text || '').match(/https?:\/\/[^\s"'<>]+/g);
    if (!m) return null;
    for (var i = 0; i < m.length; i++) {
      var url = m[i].replace(/[).,]+$/, '');
      var host;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return { platform: 'youtube', url: url };
      if (host === 'instagram.com') return { platform: 'instagram', url: url };
    }
    return null;
  }

  function platformLabel(p) { return p === 'youtube' ? 'YouTube' : p === 'instagram' ? 'Instagram' : 'Link'; }

  // Clean the raw AI JSON into the stored recipe shape. Pure: assigns per-index ingredient ids
  // (unique within a recipe) but leaves recipe id / user_id / timestamps to the caller. The AI uses
  // *_g macro keys; internally we store {kcal,protein,carbs,fat,fiber}.
  function normalize(raw, meta) {
    raw = raw || {}; meta = meta || {};
    var servings = Math.max(1, Math.round(num(raw.servings)) || 1);
    var ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(function (ing, i) {
      ing = ing || {};
      return {
        id: 'ing' + i,
        name: String(ing.name || '').trim(),
        quantity: ing.quantity != null && isFinite(+ing.quantity) ? +ing.quantity : null,
        unit: String(ing.unit || '').trim(),
        grams: num(ing.grams),
        // Per-ingredient macros for the WHOLE recipe (AI-anchored to a typical UK product). These make
        // itemised logging possible; scaleServings scales them with the rest of the recipe.
        macros: ingMacros(ing),
        note: String(ing.note || '').trim(),
        have: false,
      };
    }).filter(function (ing) { return ing.name; });
    var steps = (Array.isArray(raw.steps) ? raw.steps : []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var mps = raw.macros_per_serving || {};
    var macros = {
      kcal: Math.round(num(mps.kcal)),
      protein: +num(mps.protein_g).toFixed(1),
      carbs: +num(mps.carbs_g).toFixed(1),
      fat: +num(mps.fat_g).toFixed(1),
      fiber: +num(mps.fiber_g).toFixed(1),
    };
    // Never leave calories blank when macros exist (mirrors the app's normalizeMacros guard).
    if (!macros.kcal && (macros.protein || macros.carbs || macros.fat)) {
      macros.kcal = Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fat * 9);
    }
    return {
      title: String(raw.title || meta.title || 'Recipe').trim(),
      servings: servings,
      ingredients: ingredients,
      steps: steps,
      macros_per_serving: macros,
      macros_confidence: ['low', 'medium', 'high'].indexOf(raw.macros_confidence) >= 0 ? raw.macros_confidence : 'low',
      source_platform: meta.platform || raw.source_platform || '',
      source_url: meta.url || '',
      thumbnail: meta.thumbnail || '',
    };
  }

  // Rescale ingredient amounts to a new serving count. Per-serving macros are unchanged (they are
  // per serving); only ingredient quantities/grams scale. Returns a new recipe object.
  function scaleServings(recipe, newServings) {
    var target = Math.max(1, Math.round(num(newServings)) || 1);
    var base = Math.max(1, num(recipe.servings) || 1);
    var f = target / base;
    var round2 = function (n) { return Math.round(n * 100) / 100; };
    return Object.assign({}, recipe, {
      servings: target,
      ingredients: (recipe.ingredients || []).map(function (ing) {
        return Object.assign({}, ing, {
          quantity: ing.quantity != null ? round2(ing.quantity * f) : null,
          grams: ing.grams ? Math.round(ing.grams * f) : ing.grams,
          macros: ing.macros ? scaleMacros(ing.macros, f) : ing.macros,
        });
      }),
    });
  }

  // Ingredients scaled to ONE serving, for itemised diary logging: name, grams and macros divided by
  // the serving count. Each carries the ingredient's resolved source so smart-food memory can reuse it.
  function perServingIngredients(recipe) {
    var s = Math.max(1, num(recipe.servings) || 1);
    return (recipe.ingredients || []).map(function (ing) {
      return {
        id: ing.id,
        name: ing.name,
        grams: ing.grams ? Math.round(ing.grams / s) : 0,
        macros: scaleMacros(ing.macros || {}, 1 / s),
        source: (ing.resolved && ing.resolved.source) || 'recipe',
      };
    }).filter(function (x) { return x.name && (x.macros.kcal || x.macros.protein || x.macros.carbs || x.macros.fat); });
  }

  // Total macros for the whole recipe (per-serving x servings), for display.
  function totalMacros(recipe) {
    var m = recipe.macros_per_serving || {}, s = Math.max(1, num(recipe.servings) || 1);
    return {
      kcal: Math.round(num(m.kcal) * s),
      protein: +(num(m.protein) * s).toFixed(1),
      carbs: +(num(m.carbs) * s).toFixed(1),
      fat: +(num(m.fat) * s).toFixed(1),
      fiber: +(num(m.fiber) * s).toFixed(1),
    };
  }

  // Human label for an ingredient amount, e.g. "200 g", "2 cloves", "1 tbsp" or just the name.
  function amountLabel(ing) {
    if (ing.quantity != null && ing.unit) return trimNum(ing.quantity) + ' ' + ing.unit;
    if (ing.quantity != null) return trimNum(ing.quantity) + '';
    if (ing.grams) return ing.grams + ' g';
    return '';
  }
  function trimNum(n) { var r = Math.round(n * 100) / 100; return (r % 1 === 0) ? String(r) : String(r); }

  // Which of `additions` are genuinely new to the shopping list: not already present by name among the
  // still-unchecked items. Pure decision helper; the caller turns the survivors into stored rows.
  function newShoppingItems(existing, additions) {
    var have = {};
    (existing || []).forEach(function (it) { if (it && !it.checked) have[norm(it.name)] = 1; });
    var out = [], seen = {};
    (additions || []).forEach(function (a) {
      var k = norm(a && a.name);
      if (!k || have[k] || seen[k]) return;
      seen[k] = 1; out.push(a);
    });
    return out;
  }

  // How well one serving fits a day's remaining macros. `remaining` = {kcal,protein,carbs,fat} left
  // today. Returns { fitsKcal, overKcal, proteinPer100kcal, label } for ranking/badging in Discover
  // and the "fits your day" line. High protein-per-100kcal + within remaining kcal ranks best.
  function fitScore(macrosPerServing, remaining) {
    var m = macrosPerServing || {}, r = remaining || {};
    var kcal = num(m.kcal), remK = num(r.kcal);
    var over = Math.max(0, kcal - remK);
    var proteinDensity = kcal > 0 ? (num(m.protein) * 4 / kcal) : 0; // fraction of calories from protein
    var label = remK <= 0 ? 'no room left' : over <= 0 ? 'fits your day' : over <= remK * 0.15 ? 'just over' : 'over your day';
    return { fitsKcal: over <= 0, overKcal: Math.round(over), proteinPer100kcal: +(proteinDensity * 100).toFixed(0), label: label };
  }

  var Recipe = {
    detectShare: detectShare,
    platformLabel: platformLabel,
    normalize: normalize,
    scaleServings: scaleServings,
    totalMacros: totalMacros,
    perServingIngredients: perServingIngredients,
    amountLabel: amountLabel,
    newShoppingItems: newShoppingItems,
    fitScore: fitScore,
    _norm: norm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Recipe;
  root.Recipe = Recipe;
})(typeof window !== 'undefined' ? window : this);
