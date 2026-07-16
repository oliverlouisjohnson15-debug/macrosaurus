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
        });
      }),
    });
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

  var Recipe = {
    detectShare: detectShare,
    platformLabel: platformLabel,
    normalize: normalize,
    scaleServings: scaleServings,
    totalMacros: totalMacros,
    amountLabel: amountLabel,
    newShoppingItems: newShoppingItems,
    _norm: norm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Recipe;
  root.Recipe = Recipe;
})(typeof window !== 'undefined' ? window : this);
