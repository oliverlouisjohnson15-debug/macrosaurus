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

  // Pull the first YouTube/Instagram/TikTok link out of shared text. Returns { platform, url } or null.
  function detectShare(text) {
    var m = String(text || '').match(/https?:\/\/[^\s"'<>]+/g);
    if (!m) return null;
    for (var i = 0; i < m.length; i++) {
      var url = m[i].replace(/[).,]+$/, ''), host;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return { platform: 'youtube', url: url };
      if (host === 'instagram.com') return { platform: 'instagram', url: url };
      if (host === 'tiktok.com' || host === 'm.tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return { platform: 'tiktok', url: url };
    }
    return null;
  }
  function platformLabel(p) { return p === 'youtube' ? 'YouTube' : p === 'instagram' ? 'Instagram' : p === 'tiktok' ? 'TikTok' : 'Link'; }

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
      source_author: String(meta.author || raw.source_author || '').trim(),
      source_url: meta.url || '',
      thumbnail: meta.thumbnail || '',
      tags: normTags(raw.tags, steps, macros),
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

  // Servings still available from a batch cook (0 when none), for the leftovers surfaces.
  function batchLeft(recipe) { var b = (recipe || {}).batch; return b ? Math.max(0, num(b.left)) : 0; }

  // Summed macros for a day's planned recipes (per-serving x portion each), for the meal planner.
  function planMacros(entries, recipeById) {
    var t = emptyMacros();
    (entries || []).forEach(function (e) {
      var r = recipeById[e && e.recipe_id]; if (!r || !r.macros_per_serving) return;
      var p = num(e.portion) || 1, m = r.macros_per_serving;
      t.kcal += num(m.kcal) * p; t.protein += num(m.protein) * p; t.carbs += num(m.carbs) * p; t.fat += num(m.fat) * p; t.fiber += num(m.fiber) * p;
    });
    return cleanMacros(t);
  }

  // Which of `additions` are new to the shopping list (not already present, unchecked, by name).
  function newShoppingItems(existing, additions) {
    var have = {}; (existing || []).forEach(function (it) { if (it && !it.checked) have[norm(it.name)] = 1; });
    var out = [], seen = {};
    (additions || []).forEach(function (a) { var k = norm(a && a.name); if (!k || have[k] || seen[k]) return; seen[k] = 1; out.push(a); });
    return out;
  }

  // ---- Shopping list: quantity combining + aisle categories ------------------------------------
  // Map a measurement word to a canonical unit. Mass normalises to g, volume to ml, so amounts can be
  // summed across recipes; portion words (tbsp, clove...) keep their own unit; anything else is a count.
  var UNIT_WORDS = {
    g: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', litre: 'l', liter: 'l',
    tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', dsp: 'dsp',
    cup: 'cup', cups: 'cup', clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
    can: 'can', cans: 'can', tin: 'tin', tins: 'tin', jar: 'jar', jars: 'jar', pinch: 'pinch',
    dash: 'dash', handful: 'handful', scoop: 'scoop', scoops: 'scoop', ball: 'ball', balls: 'ball',
    rasher: 'rasher', rashers: 'rasher', sprig: 'sprig', sprigs: 'sprig', stick: 'stick', sticks: 'stick',
    bunch: 'bunch', head: 'head', heads: 'head', packet: 'packet', pack: 'packet', sachet: 'sachet',
    punnet: 'punnet', bottle: 'bottle', knob: 'knob',
  };
  // Parse the leading "amount [unit]" from an ingredient line into { n, unit }, or null if none. Bare
  // counts and unrecognised words (e.g. "1 wholemeal pitta") become the count unit 'x'.
  function parseQtyToken(line) {
    var s = String(line || '').trim();
    var m = s.match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*([a-zA-Z]+)?\b/);
    if (!m) return null;
    var n = parseAmt(m[1].replace(/\s+/g, ''));
    if (!(n > 0)) return null;
    var unit = UNIT_WORDS[(m[2] || '').toLowerCase()] || '';
    if (unit === 'kg') { n *= 1000; unit = 'g'; }
    else if (unit === 'l') { n *= 1000; unit = 'ml'; }
    if (!unit) unit = 'x';
    return { n: n, unit: unit };
  }
  function addQty(qtys, token) { qtys = qtys || {}; if (token) qtys[token.unit] = (qtys[token.unit] || 0) + token.n; return qtys; }
  var QTY_ORDER = ['x', 'g', 'ml', 'tbsp', 'tsp', 'dsp', 'cup', 'clove', 'slice', 'can', 'tin', 'jar', 'handful', 'pinch', 'dash', 'scoop', 'ball', 'rasher', 'sprig', 'stick', 'bunch', 'head', 'packet', 'sachet', 'punnet', 'bottle', 'knob'];
  var PLURAL_UNITS = { clove: 1, slice: 1, can: 1, tin: 1, jar: 1, scoop: 1, ball: 1, rasher: 1, sprig: 1, stick: 1, head: 1, bottle: 1, packet: 1, punnet: 1, bunch: 1 };
  // Render a combined { unit: amount } map as a short label ("400 g", "2 tbsp", "3", "200 g + 1").
  function fmtQty(qtys) {
    if (!qtys) return '';
    var keys = Object.keys(qtys).filter(function (u) { return qtys[u]; }).sort(function (a, b) {
      var ia = QTY_ORDER.indexOf(a), ib = QTY_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return keys.map(function (u) {
      var n = Math.round(qtys[u] * 100) / 100;
      if (u === 'g') return n >= 1000 ? (Math.round(n / 100) / 10) + ' kg' : n + ' g';
      if (u === 'ml') return n >= 1000 ? (Math.round(n / 100) / 10) + ' l' : n + ' ml';
      if (u === 'x') return String(n);
      return n + ' ' + u + (n !== 1 && PLURAL_UNITS[u] ? 's' : '');
    }).join(' + ');
  }

  // Aisle categories, checked in priority order (most specific first) by substring on the food name.
  var CATEGORY_ORDER = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Rice, pasta & grains', 'Tins, jars & packets', 'Frozen', 'Store cupboard', 'Drinks', 'Household', 'Other'];
  var CATEGORY_KEYWORDS = [
    ['Meat & fish', ['chicken', 'beef', 'pork', 'lamb', 'mince', 'steak', 'bacon', 'sausage', 'turkey', 'ham', 'gammon', 'chorizo', 'salmon', 'tuna', 'cod', 'haddock', 'prawn', 'shrimp', 'fish', 'fillet', 'thigh', 'drumstick', 'breast', 'mackerel', 'sardine', 'anchovy']],
    ['Dairy & eggs', ['milk', 'cheese', 'yoghurt', 'yogurt', 'butter', 'egg', 'cream', 'feta', 'mozzarella', 'cheddar', 'parmesan', 'halloumi', 'quark', 'mascarpone', 'ghee', 'custard']],
    ['Bakery', ['bread', 'pitta', 'pita', 'wrap', 'tortilla', 'bagel', 'bun', 'roll', 'naan', 'baguette', 'croissant', 'brioche', 'muffin', 'crumpet', 'flatbread']],
    ['Rice, pasta & grains', ['rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'couscous', 'quinoa', 'oats', 'oat', 'porridge', 'bulgur', 'barley', 'polenta', 'risotto']],
    ['Frozen', ['frozen', 'ice cream']],
    ['Tins, jars & packets', ['tinned', 'canned', 'chickpea', 'lentil', 'kidney bean', 'black bean', 'passata', 'chopped tomato', 'tomato puree', 'coconut milk', 'stock', 'broth', 'olives', 'sweetcorn', 'baked bean', 'butter bean', 'cannellini']],
    ['Produce', ['onion', 'garlic', 'tomato', 'pepper', 'spinach', 'lettuce', 'carrot', 'potato', 'avocado', 'lemon', 'lime', 'banana', 'apple', 'orange', 'mango', 'berry', 'berries', 'strawberr', 'blueberr', 'raspberr', 'broccoli', 'courgette', 'zucchini', 'cucumber', 'mushroom', 'coriander', 'cilantro', 'basil', 'parsley', 'mint', 'ginger', 'chilli', 'chili', 'kale', 'cabbage', 'celery', 'leek', 'spring onion', 'shallot', 'sweet potato', 'squash', 'aubergine', 'eggplant', 'beetroot', 'rocket', 'arugula', 'salad', 'pea', 'cauliflower', 'asparagus', 'green bean', 'grape', 'pear', 'peach', 'fruit', 'veg', 'herb']],
    ['Store cupboard', ['oil', 'salt', 'pepper', 'sugar', 'honey', 'vinegar', 'soy sauce', 'soy', 'fish sauce', 'spice', 'cumin', 'paprika', 'cinnamon', 'turmeric', 'curry', 'stock cube', 'baking', 'vanilla', 'mustard', 'ketchup', 'mayo', 'mayonnaise', 'peanut butter', 'tahini', 'nut', 'seed', 'syrup', 'cocoa', 'chocolate', 'flour', 'cornflour', 'yeast', 'oregano', 'thyme', 'rosemary', 'sriracha', 'harissa', 'pesto', 'jam', 'sesame', 'raisin', 'sultana', 'date', 'bouillon']],
    ['Drinks', ['water', 'juice', 'squash', 'cola', 'lemonade', 'sparkling', 'coffee', 'tea', 'wine', 'beer', 'kombucha', 'oat milk', 'almond milk', 'soya milk']],
    ['Household', ['bin bag', 'bin liner', 'foil', 'clingfilm', 'cling film', 'kitchen roll', 'washing up', 'detergent', 'soap', 'sponge', 'toilet', 'tissue', 'battery', 'cleaner', 'baking paper', 'parchment', 'napkin']],
  ];
  function shoppingCategory(name) {
    var s = norm(name);
    for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
      var kws = CATEGORY_KEYWORDS[i][1];
      for (var j = 0; j < kws.length; j++) { if (s.indexOf(kws[j]) >= 0) return CATEGORY_KEYWORDS[i][0]; }
    }
    return 'Other';
  }

  // Add ingredient lines to a shopping list, COMBINING quantities into an existing unchecked item of the
  // same name (this is what stops two recipes' chicken from silently overwriting each other) and skipping
  // anything in the pantry. `additions` are { line, recipe_id }. Returns { list, added }. Pure: never
  // mutates the input list or its items (clones any item it merges into), so it is store/immer-safe.
  function addToShoppingList(list, additions, opts) {
    opts = opts || {};
    var uid = opts.uid || function () { return 'sl' + Math.round((opts.now || 0)); };
    var pantry = opts.pantry || {};
    var now = opts.now || 0;
    var out = (list || []).slice();
    var added = 0;
    (additions || []).forEach(function (a) {
      var line = String((a && (a.line || a.name)) || '').trim();
      if (!line) return;
      var nm = nameFromLine(line) || line;
      var key = norm(nm);
      if (!key || pantry[key]) return;
      var token = parseQtyToken(line);
      var idx = -1;
      for (var i = 0; i < out.length; i++) { if (out[i] && !out[i].checked && norm(out[i].name) === key) { idx = i; break; } }
      if (idx >= 0) {
        var ex = out[idx];
        var qtys = ex.qtys ? Object.assign({}, ex.qtys) : (ex.qty_label ? addQty({}, parseQtyToken(ex.qty_label)) : {});
        addQty(qtys, token);
        var rids = (ex.recipe_ids || []).slice();
        if (a.recipe_id && rids.indexOf(a.recipe_id) < 0) rids.push(a.recipe_id);
        out[idx] = Object.assign({}, ex, { qtys: qtys, qty_label: fmtQty(qtys), recipe_ids: rids });
        added++;
      } else {
        var q = addQty({}, token);
        out.push({
          id: uid(), name: nm, qtys: q, qty_label: fmtQty(q), category: shoppingCategory(nm),
          recipe_ids: a.recipe_id ? [a.recipe_id] : [], recipe_id: a.recipe_id || null,
          manual: !!opts.manual, checked: false, added_at: now,
        });
        added++;
      }
    });
    return { list: out, added: added };
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

  // ---- "Cook from what you have": match recipes to the ingredients you've got ------------------
  // Powers the fridge-photo feature (and any "what can I make" surface): from a set of ingredient
  // names you own - scanned from a fridge photo, plus your pantry - work out which recipes you can
  // cook right now and which you're only a couple of ingredients away from, listing exactly what's
  // missing so it can go straight on the shopping list. Pure + unit-tested so the matching never
  // drifts from the UI. Promotes using what you have instead of letting food go to waste.

  // Words that carry no food identity - preparation, size, quality, packaging - so "2 large free-range
  // eggs" and "eggs" match on the token that matters. Leading amounts + units are stripped by nameFromLine.
  var FOOD_STOPWORDS = {
    fresh: 1, dried: 1, frozen: 1, ground: 1, chopped: 1, sliced: 1, diced: 1, minced: 1, grated: 1,
    crushed: 1, whole: 1, large: 1, small: 1, medium: 1, ripe: 1, boneless: 1, skinless: 1, free: 1,
    range: 1, organic: 1, raw: 1, cooked: 1, taste: 1, extra: 1, virgin: 1, plain: 1, light: 1, low: 1,
    fat: 1, reduced: 1, unsalted: 1, salted: 1, finely: 1, roughly: 1, thinly: 1, peeled: 1, deseeded: 1,
    drained: 1, rinsed: 1, roasted: 1, toasted: 1, ready: 1, optional: 1, cut: 1, good: 1, quality: 1,
    mixed: 1, baby: 1, wild: 1, lean: 1, thick: 1, thin: 1, warm: 1, room: 1, temperature: 1, semi: 1,
    skimmed: 1, full: 1, natural: 1, and: 1, the: 1, for: 1, plus: 1, into: 1, with: 1, your: 1, few: 1,
    of: 1, splash: 1, dash: 1, pinch: 1, drizzle: 1, squeeze: 1, handful: 1, knob: 1, glug: 1, some: 1,
    grilled: 1, fried: 1, baked: 1, boiled: 1, steamed: 1, roast: 1, poached: 1, seared: 1, smoked: 1, homemade: 1,
  };
  // Canonical token for common cross-Atlantic / spelling variants, so a US fridge photo ("cilantro",
  // "zucchini", "garbanzo") still matches UK recipe wording ("coriander", "courgette", "chickpea").
  var FOOD_SYNONYMS = {
    cilantro: 'coriander', eggplant: 'aubergine', zucchini: 'courgette', garbanzo: 'chickpea',
    shrimp: 'prawn', arugula: 'rocket', scallion: 'springonion', chickpeas: 'chickpea',
    yoghurt: 'yogurt', capsicum: 'pepper', mange: 'mangetout',
  };
  // Words that only ever describe a store-cupboard basic everyone is assumed to have, so a recipe is
  // "makeable" without them. A real vegetable like "red pepper" keeps "red" (not in here) so it is NOT
  // waved through - only ingredients whose every token is a staple word count as assumed-present.
  var STAPLE_VOCAB = { salt: 1, pepper: 1, water: 1, oil: 1, olive: 1, vegetable: 1, sunflower: 1, rapeseed: 1, sea: 1, black: 1, cracked: 1, freshly: 1, table: 1 };

  function singularToken(t) {
    if (t.length <= 3) return t;
    if (/ies$/.test(t)) return t.slice(0, -3) + 'y';        // berries -> berry
    if (/(ches|shes|sses|xes|zes)$/.test(t)) return t.slice(0, -2); // glasses -> glass
    if (/oes$/.test(t)) return t.slice(0, -2);              // tomatoes -> tomato, potatoes -> potato
    if (/ss$/.test(t)) return t;                            // watercress stays
    if (/s$/.test(t)) return t.slice(0, -1);               // eggs -> egg, onions -> onion
    return t;
  }
  // The meaningful food tokens of an ingredient name: amount/unit stripped, lowercased, de-pluralised,
  // spelling-normalised, with prep/size words dropped. "2 large ripe avocados" -> ["avocado"].
  function foodTokens(name) {
    var s = norm(nameFromLine(name)).replace(/[^a-z\s]/g, ' ');
    var out = [], seen = {};
    s.split(/\s+/).forEach(function (w) {
      if (!w) return;
      w = FOOD_SYNONYMS[w] || singularToken(w);
      w = FOOD_SYNONYMS[w] || w;
      if (w.length < 3 || FOOD_STOPWORDS[w]) return;
      if (!seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }
  // An ingredient whose every token is a store-cupboard basic (salt, black pepper, olive oil, water).
  function isBasicStaple(toks) { return toks.length > 0 && toks.every(function (t) { return STAPLE_VOCAB[t]; }); }
  // A token index of everything you have (fridge scan + pantry), for O(1) ingredient lookups.
  function buildHaveIndex(names) {
    var idx = {};
    (names || []).forEach(function (n) { foodTokens(n).forEach(function (t) { idx[t] = 1; }); });
    return idx;
  }
  // Classify one recipe's ingredients against what you have: { have, missing, staples, makeable, ... }.
  // Staples are assumed-present and excluded from both counts (you don't shop for salt). An ingredient
  // is "have" when any of its food tokens is in your have-index; otherwise it's missing (with its line
  // kept, so it can drop straight onto the shopping list).
  function matchRecipeToHave(recipe, haveIndex) {
    var have = [], missing = [], staples = [];
    ((recipe && recipe.ingredients) || []).forEach(function (ing) {
      var line = lineOf(ing);
      var name = (ing && ing.name) || nameFromLine(line);
      var toks = foodTokens(name);
      if (isBasicStaple(toks)) { staples.push(name); return; }
      if (toks.length && toks.some(function (t) { return haveIndex[t]; })) have.push(name);
      else missing.push({ line: line, name: name });
    });
    var real = have.length + missing.length;
    return {
      id: recipe && recipe.id, recipe: recipe, have: have, missing: missing, staples: staples,
      haveCount: have.length, missingCount: missing.length, total: real,
      makeable: missing.length === 0 && have.length > 0,
      matchPct: real > 0 ? Math.round(have.length / real * 100) : 0,
    };
  }
  // Rank recipes by how cookable they are from what you have. Returns matches (best first) filtered to
  // those you can make now or are within `maxMissing` ingredients of. `haveNames` are raw item names
  // (from the fridge photo and your pantry). Recipes with no real overlap are dropped as irrelevant.
  function suggestRecipesFromHave(recipes, haveNames, opts) {
    opts = opts || {};
    var maxMissing = opts.maxMissing == null ? 3 : opts.maxMissing;
    var minHave = opts.minHave == null ? 1 : opts.minHave;
    var haveIndex = buildHaveIndex(haveNames);
    var out = [];
    (recipes || []).forEach(function (r) {
      if (!r || !(r.ingredients && r.ingredients.length)) return;
      var m = matchRecipeToHave(r, haveIndex);
      if (m.total === 0 || m.haveCount < minHave || m.missingCount > maxMissing) return;
      out.push(m);
    });
    out.sort(function (a, b) {
      return (a.missingCount - b.missingCount) || (b.haveCount - a.haveCount) || (b.matchPct - a.matchPct)
        || String((a.recipe || {}).title || '').localeCompare(String((b.recipe || {}).title || ''));
    });
    return out;
  }

  // ---- Taxonomy: how recipes are found at scale ----------------------------------------------
  // A controlled vocabulary (not free text) so filters stay clean with thousands of recipes. The AI
  // structurer maps each recipe onto these values at import; normTags validates so a bad value can
  // never leak into a facet. Kept here (pure) so the prompt, the filters and the tests share one list.
  var TAX = {
    meal: ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink'],
    cuisine: ['british', 'italian', 'indian', 'chinese', 'thai', 'mexican', 'japanese', 'mediterranean', 'middle-eastern', 'american', 'french', 'korean', 'vietnamese', 'greek', 'spanish', 'caribbean', 'other'],
    main: ['chicken', 'beef', 'pork', 'lamb', 'fish', 'seafood', 'eggs', 'tofu', 'beans', 'veg', 'cheese', 'other'],
    effort: ['quick', 'standard', 'project'],
    diet: ['high-protein', 'vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free'],
  };
  var TAX_LABEL = {
    'middle-eastern': 'Middle-Eastern', 'high-protein': 'High protein', 'gluten-free': 'Gluten-free',
    'dairy-free': 'Dairy-free', quick: 'Quick', standard: 'Standard', project: 'Project',
  };
  function taxLabel(v) { v = String(v || ''); return TAX_LABEL[v] || (v ? v.charAt(0).toUpperCase() + v.slice(1) : ''); }
  function inList(v, list) { v = norm(v); return list.indexOf(v) >= 0 ? v : ''; }
  // Validate + enrich AI tags. `steps`/`macros` let us fill effort (from method length) and derive
  // the high-protein diet flag from the numbers, so tags are useful even when the source was thin.
  function normTags(raw, steps, macros) {
    raw = raw || {};
    var meal = inList(raw.meal, TAX.meal);
    var cuisine = inList(raw.cuisine, TAX.cuisine);
    var main = inList(raw.main, TAX.main);
    var effort = inList(raw.effort, TAX.effort);
    if (!effort) { var n = (steps || []).length; effort = n > 0 ? (n <= 4 ? 'quick' : n <= 8 ? 'standard' : 'project') : ''; }
    var diet = (Array.isArray(raw.diet) ? raw.diet : []).map(function (d) { return inList(d, TAX.diet); }).filter(Boolean);
    if (macros && num(macros.kcal) > 0 && (num(macros.protein) * 4 / num(macros.kcal)) >= 0.4 && diet.indexOf('high-protein') < 0) diet.push('high-protein');
    var seen = {}, uniqDiet = [];
    diet.forEach(function (d) { if (!seen[d]) { seen[d] = 1; uniqDiet.push(d); } });
    return { meal: meal, cuisine: cuisine, main: main, effort: effort, diet: uniqDiet };
  }
  // Derived macro badges, computed LIVE from current per-serving macros (so they're right even after
  // macros resolve post-import). These are the tracker's edge over a plain recipe app.
  function badges(recipe) {
    var m = (recipe && recipe.macros_per_serving) || {}, out = [];
    var kcal = num(m.kcal);
    if (kcal > 0 && (num(m.protein) * 4 / kcal) >= 0.4) out.push({ key: 'high-protein', label: 'High protein' });
    if (kcal > 0 && kcal < 400) out.push({ key: 'low-cal', label: 'Low cal' });
    if (num(m.fiber) >= 8) out.push({ key: 'high-fibre', label: 'High fibre' });
    return out;
  }
  // One recipe against a set of active facet filters. Missing facets pass. `badge` uses live macros.
  function matchesFilters(recipe, f) {
    f = f || {}; var t = (recipe && recipe.tags) || {};
    if (f.meal && t.meal !== f.meal) return false;
    if (f.cuisine && t.cuisine !== f.cuisine) return false;
    if (f.main && t.main !== f.main) return false;
    if (f.effort && t.effort !== f.effort) return false;
    if (f.diet && (t.diet || []).indexOf(f.diet) < 0) return false;
    if (f.badge && !badges(recipe).some(function (b) { return b.key === f.badge; })) return false;
    return true;
  }

  var Recipe = {
    detectShare: detectShare, platformLabel: platformLabel, normalize: normalize,
    TAX: TAX, taxLabel: taxLabel, normTags: normTags, badges: badges, matchesFilters: matchesFilters,
    lineOf: lineOf, nameFromLine: nameFromLine, gramsFromLine: gramsFromLine, portionGrams: portionGrams,
    gramsForLine: gramsForLine, stapleMacros: stapleMacros, bestOffMatch: bestOffMatch,
    applyAnalysis: applyAnalysis, setIngredientMacros: setIngredientMacros,
    computePerServing: computePerServing, resolvedCount: resolvedCount, macrosFromPer100: macrosFromPer100,
    perServingIngredients: perServingIngredients, newShoppingItems: newShoppingItems, fitScore: fitScore,
    parseQtyToken: parseQtyToken, addQty: addQty, fmtQty: fmtQty, shoppingCategory: shoppingCategory,
    addToShoppingList: addToShoppingList, CATEGORY_ORDER: CATEGORY_ORDER,
    macroSanity: macroSanity, scaleServings: scaleServings, scaleLine: scaleLine, scaleMacros: scaleMacros, fitPortion: fitPortion,
    planMacros: planMacros, batchLeft: batchLeft,
    foodTokens: foodTokens, isBasicStaple: isBasicStaple, buildHaveIndex: buildHaveIndex,
    matchRecipeToHave: matchRecipeToHave, suggestRecipesFromHave: suggestRecipesFromHave,
    _norm: norm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Recipe;
  root.Recipe = Recipe;
})(typeof window !== 'undefined' ? window : this);
