/*
 * recipe.js - Pure helpers for the recipe module. Framework-free, no DOM or network.
 * Exposes window.Recipe + Node module.exports. Tested in tests/recipes.test.js.
 *
 * Model: an ingredient is ONE human-readable line ("150 g cottage cheese", "1 tbsp olive oil").
 * Macros come from a nutrition-analysis service (Edamam) or an AI fallback, applied by index and
 * stored per ingredient; per-serving macros are the resolved total divided by servings. Keeping the
 * ingredient as a single line (not split name/amount fields) is what stops names and amounts desyncing.
 * The network calls and UI live in app.jsx; everything here is pure and unit-tested.
 */
(function (root) {
  'use strict';

  var num = function (v) { var n = +v; return isFinite(n) ? n : 0; };
  var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  var round1 = function (n) { return Math.round(n * 10) / 10; };
  function emptyMacros() { return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }; }
  function cleanMacros(m) { m = m || {}; return { kcal: Math.round(num(m.kcal)), protein: round1(num(m.protein)), carbs: round1(num(m.carbs)), fat: round1(num(m.fat)), fiber: round1(num(m.fiber)) }; }
  function trimNum(n) { return String(Math.round(n * 100) / 100); }

  // The display line for an ingredient. New ingredients store `line`; older ones are rebuilt from the
  // legacy name/grams/quantity fields so existing saved recipes keep working.
  function lineOf(ing) {
    if (!ing) return '';
    if (ing.line) return String(ing.line);
    var amt = ing.grams ? (ing.grams + ' g') : (ing.quantity != null ? (trimNum(ing.quantity) + (ing.unit ? ' ' + ing.unit : '')) : '');
    return ((amt ? amt + ' ' : '') + (ing.name || '')).trim();
  }
  // A clean food name from a line (leading amount + unit stripped), for the shopping list and food DB.
  var UNIT_RE = /^(g|kg|ml|l|oz|lb|tbsp|tbs|tsp|cup|cups|clove|cloves|slice|slices|can|cans|tin|tins|jar|jars|handful|pinch|dash|large|small|medium|whole|packet|pack|sachet|scoop|scoops|ball|balls|sprig|sprigs|stick|sticks|knob|bunch|head|heads)\b\.?\s+/i;
  function nameFromLine(line) {
    var s = String(line || '').trim();
    s = s.replace(/^[\d.,/¼½¾\s-]+/, '');
    s = s.replace(UNIT_RE, '');
    s = s.replace(/^of\s+/i, '');
    s = s.trim();
    return s || String(line || '').trim();
  }

  // Grams implied by an ingredient line's leading amount, for free Open Food Facts pricing
  // (per-100g x grams). Only mass/volume units convert here; portion words are handled by
  // portionGrams. ml/l treated as ~1g/ml.
  function gramsFromLine(line) {
    var m = String(line || '').trim().match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*(kg|g|ml|l)\b/i);
    if (!m) return 0;
    var amt = parseAmt(m[1].replace(/\s+/g, '')), unit = m[2].toLowerCase();
    return Math.round((unit === 'kg' || unit === 'l') ? amt * 1000 : amt);
  }
  // Standard grams for common cooking portions, so "1 tbsp oil" or "2 cloves garlic" can be priced
  // without AI. These are typical averages (UK kitchen); precise enough for macro estimates.
  var PORTION_G = {
    tsp: 5, teaspoon: 5, tbsp: 15, tbs: 15, tablespoon: 15, dsp: 10, cup: 240, cups: 240,
    clove: 5, cloves: 5, pinch: 0.5, dash: 0.5, handful: 30, knob: 15, sprig: 2, sprigs: 2,
    can: 400, cans: 400, tin: 400, tins: 400, scoop: 30, scoops: 30, ball: 125, balls: 125, rasher: 25, rashers: 25,
  };
  // Grams from a portion-word amount ("1 tbsp", "2 cloves"), or 0 if the line has no such unit.
  function portionGrams(line) {
    var m = String(line || '').trim().match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*([a-z]+)\b/i);
    if (!m) return 0;
    var per = PORTION_G[m[2].toLowerCase()];
    return per ? Math.round(parseAmt(m[1].replace(/\s+/g, '')) * per) : 0;
  }
  // Best grams estimate for a line: explicit mass/volume first, then a known portion word.
  function gramsForLine(line) { return gramsFromLine(line) || portionGrams(line); }

  // Per-100g macros for pure kitchen staples whose composition is stable and where an Open Food Facts
  // search would return noisy branded packs. Matched by whole-word tokens (so "oil" never matches
  // "boiled"), most specific first. Returns null when the line is not a known staple or has no grams.
  var STAPLES = [
    { k: ['olive', 'oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['coconut', 'oil'], p: { kcal: 892, protein: 0, carbs: 0, fat: 99, fiber: 0 } },
    { k: ['sesame', 'oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['sunflower', 'oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['vegetable', 'oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['rapeseed', 'oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['oil'], p: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['butter'], p: { kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, fiber: 0 } },
    { k: ['ghee'], p: { kcal: 900, protein: 0, carbs: 0, fat: 100, fiber: 0 } },
    { k: ['honey'], p: { kcal: 304, protein: 0.3, carbs: 82, fat: 0, fiber: 0.2 } },
    { k: ['maple', 'syrup'], p: { kcal: 260, protein: 0, carbs: 67, fat: 0, fiber: 0 } },
    { k: ['icing', 'sugar'], p: { kcal: 400, protein: 0, carbs: 100, fat: 0, fiber: 0 } },
    { k: ['brown', 'sugar'], p: { kcal: 380, protein: 0, carbs: 98, fat: 0, fiber: 0 } },
    { k: ['sugar'], p: { kcal: 400, protein: 0, carbs: 100, fat: 0, fiber: 0 } },
    { k: ['plain', 'flour'], p: { kcal: 341, protein: 10, carbs: 76, fat: 1.2, fiber: 3.1 } },
    { k: ['flour'], p: { kcal: 341, protein: 10, carbs: 76, fat: 1.2, fiber: 3.1 } },
    { k: ['soy', 'sauce'], p: { kcal: 60, protein: 8, carbs: 6, fat: 0, fiber: 0.8 } },
    { k: ['water'], p: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } },
    { k: ['salt'], p: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } },
  ];
  function stapleMacros(line, grams) {
    if (!(num(grams) > 0)) return null;
    var toks = {}; norm(nameFromLine(line)).split(' ').forEach(function (t) { if (t) toks[t] = 1; });
    for (var i = 0; i < STAPLES.length; i++) {
      if (STAPLES[i].k.every(function (t) { return toks[t]; })) return macrosFromPer100(STAPLES[i].p, grams);
    }
    return null;
  }
  // Pick the best Open Food Facts result for an ingredient name, or null if none is a confident match
  // (so the AI fallback takes it). Requires most/all name tokens to appear in the product name, then
  // prefers the highest overlap, shortest (most generic) name, and own-brand over branded packs.
  function bestOffMatch(name, products) {
    var tokens = norm(name).split(' ').filter(function (t) { return t.length > 2; });
    if (!tokens.length) tokens = norm(name).split(' ').filter(Boolean);
    if (!tokens.length || !products || !products.length) return null;
    var need = tokens.length <= 2 ? tokens.length : tokens.length - 1;
    var best = null, bestScore = -1;
    products.forEach(function (p) {
      var pn = norm(p && p.name);
      var overlap = tokens.filter(function (t) { return pn.indexOf(t) >= 0; }).length;
      if (overlap < need) return;
      var score = (overlap / tokens.length) * 100 - pn.split(' ').length - (p.brand ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
  }

  // Pull the first YouTube/Instagram link out of shared text. Returns { platform, url } or null.
  function detectShare(text) {
    var m = String(text || '').match(/https?:\/\/[^\s"'<>]+/g);
    if (!m) return null;
    for (var i = 0; i < m.length; i++) {
      var url = m[i].replace(/[).,]+$/, ''), host;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return { platform: 'youtube', url: url };
      if (host === 'instagram.com') return { platform: 'instagram', url: url };
    }
    return null;
  }
  function platformLabel(p) { return p === 'youtube' ? 'YouTube' : p === 'instagram' ? 'Instagram' : 'Link'; }

  // Clean the raw AI JSON into the stored recipe shape. Ingredients arrive as strings (lines); we also
  // tolerate legacy object ingredients. Per-serving macros are only taken from the source when it
  // explicitly stated them, else they stay pending until the ingredients are analysed.
  function normalize(raw, meta) {
    raw = raw || {}; meta = meta || {};
    var servings = Math.max(1, Math.round(num(raw.servings)) || 1);
    var ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(function (item, i) {
      var line = typeof item === 'string' ? item.trim() : lineOf(item);
      var legacyMacros = (item && typeof item === 'object' && item.macros) ? cleanMacros(item.macros) : null;
      return { id: 'ing' + i, line: line, name: nameFromLine(line), grams: (item && typeof item === 'object' && num(item.grams)) || 0, macros: legacyMacros, resolved: legacyMacros ? { source: 'legacy' } : null, have: false };
    }).filter(function (x) { return x.line; });
    var steps = (Array.isArray(raw.steps) ? raw.steps : []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var st = raw.stated_macros_per_serving || raw.macros_per_serving;
    var hasStated = st && typeof st === 'object';
    var macros = hasStated ? { kcal: Math.round(num(st.kcal)), protein: round1(num(st.protein_g != null ? st.protein_g : st.protein)), carbs: round1(num(st.carbs_g != null ? st.carbs_g : st.carbs)), fat: round1(num(st.fat_g != null ? st.fat_g : st.fat)), fiber: round1(num(st.fiber_g != null ? st.fiber_g : st.fiber)) } : emptyMacros();
    if (hasStated && !macros.kcal && (macros.protein || macros.carbs || macros.fat)) macros.kcal = Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fat * 9);
    return {
      title: String(raw.title || meta.title || 'Recipe').trim(),
      servings: servings,
      ingredients: ingredients,
      steps: steps,
      macros_per_serving: macros,
      stated_macros: hasStated ? macros : null,
      macros_source: hasStated ? 'stated' : 'pending',
      macros_confidence: ['low', 'medium', 'high'].indexOf(raw.macros_confidence) >= 0 ? raw.macros_confidence : 'low',
      source_platform: meta.platform || raw.source_platform || '',
      source_url: meta.url || '',
      thumbnail: meta.thumbnail || '',
    };
  }

  // Apply a nutrition-analysis result (per-ingredient macros + weight, matched by index) to a recipe,
  // and recompute per-serving macros from what resolved. `source` labels where the numbers came from.
  function applyAnalysis(recipe, result) {
    var per = (result && result.per_ingredient) || [];
    var source = (result && result.source) || 'analysis';
    var ingredients = (recipe.ingredients || []).map(function (ing, i) {
      var p = per[i], m = p && p.macros;
      if (m && (num(m.kcal) || num(m.protein) || num(m.carbs) || num(m.fat))) {
        return Object.assign({}, ing, { macros: cleanMacros(m), grams: num(p.weight) || ing.grams || 0, resolved: { source: (p && p.source) || source } });
      }
      return ing;
    });
    var out = Object.assign({}, recipe, { ingredients: ingredients });
    var cp = computePerServing(out);
    if (cp.resolved > 0) { out.macros_per_serving = cp.macros; out.macros_source = source === 'edamam' ? 'analysed' : source; }
    return out;
  }

  // Set/override one ingredient's macros directly (manual entry, per-100g x grams, label, etc.).
  function setIngredientMacros(recipe, ingId, macros, meta) {
    var ingredients = (recipe.ingredients || []).map(function (ing) {
      return ing.id === ingId ? Object.assign({}, ing, { macros: cleanMacros(macros), resolved: Object.assign({ source: 'manual' }, meta || {}) }) : ing;
    });
    var out = Object.assign({}, recipe, { ingredients: ingredients });
    var cp = computePerServing(out);
    if (cp.resolved > 0) { out.macros_per_serving = cp.macros; out.macros_source = 'computed'; }
    return out;
  }

  // Per-serving macros summed from whatever ingredients are resolved, divided by servings.
  function computePerServing(recipe) {
    var s = Math.max(1, num((recipe || {}).servings) || 1), t = emptyMacros(), n = 0;
    ((recipe || {}).ingredients || []).forEach(function (ing) {
      if (!ing || !ing.macros) return; n++;
      t.kcal += num(ing.macros.kcal); t.protein += num(ing.macros.protein); t.carbs += num(ing.macros.carbs); t.fat += num(ing.macros.fat); t.fiber += num(ing.macros.fiber);
    });
    return { resolved: n, macros: { kcal: Math.round(t.kcal / s), protein: round1(t.protein / s), carbs: round1(t.carbs / s), fat: round1(t.fat / s), fiber: round1(t.fiber / s) } };
  }
  function resolvedCount(recipe) { return ((recipe || {}).ingredients || []).filter(function (i) { return i && i.macros; }).length; }

  // Scale the leading amount in an ingredient line by a factor (for "make more/fewer servings").
  // Handles integers, decimals, simple "3/4" fractions and common unicode fractions; leaves the line
  // unchanged if it has no leading number (e.g. "salt to taste").
  var FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  function parseAmt(s) { if (FRAC[s] != null) return FRAC[s]; if (s.indexOf('/') >= 0) { var p = s.split('/'); return num(p[0]) / (num(p[1]) || 1); } return num(s); }
  function fmtAmt(n) { n = Math.round(n * 100) / 100; return String(n); }
  function scaleLine(line, f) {
    line = String(line || '');
    if (!(f > 0) || f === 1) return line;
    var m = line.match(/^(\s*)(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])/);
    if (!m) return line;
    return m[1] + fmtAmt(parseAmt(m[2].replace(/\s+/g, '')) * f) + line.slice(m[0].length);
  }
  // Rescale a recipe to a new serving count: scale the ingredient amounts (line text, grams, macros)
  // so the per-serving macros stay the same. This is "cook for N", not just changing the divisor.
  function scaleServings(recipe, newServings) {
    var target = Math.max(1, Math.round(num(newServings)) || 1);
    var base = Math.max(1, num((recipe || {}).servings) || 1);
    var f = target / base;
    var ings = ((recipe || {}).ingredients || []).map(function (ing) {
      return Object.assign({}, ing, { line: scaleLine(lineOf(ing), f), grams: ing.grams ? Math.round(ing.grams * f) : ing.grams, macros: ing.macros ? scaleMacros(ing.macros, f) : ing.macros });
    });
    return Object.assign({}, recipe, { servings: target, ingredients: ings });
  }
  // Scale a per-serving macro set by a portion multiplier (0.5, 1.5, ...), for logging a part-serving.
  function scaleMacros(m, f) { m = m || {}; return { kcal: Math.round(num(m.kcal) * f), protein: round1(num(m.protein) * f), carbs: round1(num(m.carbs) * f), fat: round1(num(m.fat) * f), fiber: round1(num(m.fiber) * f) }; }
  function macrosFromPer100(per100, grams) { var f = num(grams) / 100; per100 = per100 || {}; return { kcal: Math.round(num(per100.kcal) * f), protein: round1(num(per100.protein) * f), carbs: round1(num(per100.carbs) * f), fat: round1(num(per100.fat) * f), fiber: round1(num(per100.fiber) * f) }; }

  // Ingredients scaled to ONE serving for itemised diary logging.
  function perServingIngredients(recipe) {
    var s = Math.max(1, num(recipe.servings) || 1);
    return (recipe.ingredients || []).filter(function (ing) { return ing && ing.macros; }).map(function (ing) {
      return { id: ing.id, name: ing.name || nameFromLine(ing.line), grams: ing.grams ? Math.round(ing.grams / s) : 0, macros: { kcal: Math.round(num(ing.macros.kcal) / s), protein: round1(num(ing.macros.protein) / s), carbs: round1(num(ing.macros.carbs) / s), fat: round1(num(ing.macros.fat) / s), fiber: round1(num(ing.macros.fiber) / s) }, source: (ing.resolved && ing.resolved.source) || 'recipe' };
    }).filter(function (x) { return x.name && (x.macros.kcal || x.macros.protein || x.macros.carbs || x.macros.fat); });
  }

  // Which of `additions` are new to the shopping list (not already present, unchecked, by name).
  function newShoppingItems(existing, additions) {
    var have = {}; (existing || []).forEach(function (it) { if (it && !it.checked) have[norm(it.name)] = 1; });
    var out = [], seen = {};
    (additions || []).forEach(function (a) { var k = norm(a && a.name); if (!k || have[k] || seen[k]) return; seen[k] = 1; out.push(a); });
    return out;
  }

  // A light plausibility check on a recipe's per-serving macros, so a bad parse never logs silently.
  // Returns null when fine, else { msg } describing what looks off. Only runs once macros exist.
  function macroSanity(recipe) {
    var m = (recipe || {}).macros_per_serving || {}, kcal = num(m.kcal);
    if (!kcal) return null;
    if (kcal < 80) return { msg: 'That is very low for a serving. Check the ingredient amounts.' };
    if (kcal > 1600) return { msg: 'That is very high for a serving. Check the servings count is right.' };
    var atw = num(m.protein) * 4 + num(m.carbs) * 4 + num(m.fat) * 9;
    if (atw > 0 && Math.abs(kcal - atw) > kcal * 0.3 + 50) return { msg: 'The calories and the macros do not add up. Re-check a value.' };
    return null;
  }

  // The serving multiple that best fits the day's remaining calories, in 0.25 steps (min 0.25, cap 4),
  // for "make it fit my day". Returns null when there is nothing to fit or the recipe is unpriced.
  function fitPortion(macrosPerServing, remaining) {
    var perK = num((macrosPerServing || {}).kcal), remK = num((remaining || {}).kcal);
    if (!(perK > 0) || !(remK > 0)) return null;
    var p = Math.floor((remK / perK) / 0.25) * 0.25;   // floor so the suggestion never overshoots
    return Math.max(0.25, Math.min(4, p));
  }

  // How one serving fits a day's remaining macros, for the "fits today" badge + Discover ranking.
  function fitScore(macrosPerServing, remaining) {
    var m = macrosPerServing || {}, r = remaining || {};
    var kcal = num(m.kcal), remK = num(r.kcal), over = Math.max(0, kcal - remK);
    var proteinDensity = kcal > 0 ? (num(m.protein) * 4 / kcal) : 0;
    var label = remK <= 0 ? 'no room left' : over <= 0 ? 'fits your day' : over <= remK * 0.15 ? 'just over' : 'over your day';
    return { fitsKcal: over <= 0, overKcal: Math.round(over), proteinPer100kcal: +(proteinDensity * 100).toFixed(0), label: label };
  }

  var Recipe = {
    detectShare: detectShare, platformLabel: platformLabel, normalize: normalize,
    lineOf: lineOf, nameFromLine: nameFromLine, gramsFromLine: gramsFromLine, portionGrams: portionGrams,
    gramsForLine: gramsForLine, stapleMacros: stapleMacros, bestOffMatch: bestOffMatch,
    applyAnalysis: applyAnalysis, setIngredientMacros: setIngredientMacros,
    computePerServing: computePerServing, resolvedCount: resolvedCount, macrosFromPer100: macrosFromPer100,
    perServingIngredients: perServingIngredients, newShoppingItems: newShoppingItems, fitScore: fitScore,
    macroSanity: macroSanity, scaleServings: scaleServings, scaleLine: scaleLine, scaleMacros: scaleMacros, fitPortion: fitPortion,
    _norm: norm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Recipe;
  root.Recipe = Recipe;
})(typeof window !== 'undefined' ? window : this);
