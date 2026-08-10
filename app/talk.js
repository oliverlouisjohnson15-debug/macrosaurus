/*
 * talk.js  ·  what the buddy is allowed to do, and what it means
 * ----------------------------------------------------------------------------
 * The buddy conversation is a CLIENT-EXECUTED tool loop. The model asks for a tool, this file says
 * whether the ask is valid and what it resolves to, and app.jsx carries it out against the live
 * diary. The split matters: the decision layer is pure, so it can be unit-tested without React, a
 * network, or a signed-in user, and the part that can actually write to someone's food log is a
 * small, readable switch rather than a maze of model-shaped conditionals.
 *
 * TWO RULES RUN THROUGH EVERYTHING HERE.
 *
 * 1. NOTHING IS LOGGED WITHOUT A TAP. Every tool that would touch the diary resolves to a PROPOSAL,
 *    which the conversation renders as a card the user confirms. The model is told this in the tool
 *    descriptions, so it never claims to have logged something it has only suggested. A macro
 *    tracker whose numbers can be changed by a sentence you did not read back is not a tracker.
 *
 * 2. THE MODEL NEVER INVENTS NUMBERS. It does not get a tool that takes calories or macros. It can
 *    describe a meal for the estimator (which is a separate, calibrated prompt with its own
 *    review screen), or name a food the user has logged before (whose numbers we already hold), and
 *    that is the whole surface. Whatever the conversation is for, it is not a second, chattier
 *    route around the estimator's calibration.
 *
 * Concatenated ahead of app.jsx by build.mjs, and require()d directly by the tests.
 */
(function (root) {
  'use strict';

  // Tool schemas, in the shape the Messages API wants. `strict` + `additionalProperties: false`
  // mean arguments validate exactly at the API layer, so everything below is defending against a
  // model that asked for something sensible-but-wrong (a food it has not seen, a meal that is not
  // in this day) rather than against malformed JSON.
  var TOOLS = [
    {
      name: 'estimate_meal',
      description: 'Estimate the calories and macros of a meal the user describes, or of the photo they have attached. '
        + 'Use this for anything they ate that is not already one of their saved foods or saved meals. '
        + 'This does NOT log anything: it shows the user an estimate to check and confirm. Say you have worked it out '
        + 'and it is waiting for them, never that it is logged. Pass on everything they told you about portion size, '
        + 'cooking method, brand or restaurant, because the estimator is much more accurate with those.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What they ate, in their own words plus any detail they gave you about size, cooking or brand.' },
          meal: { type: 'string', description: 'Which meal of the day it belongs to, e.g. Breakfast, Lunch, Dinner, Snacks. Omit if they did not say.' },
        },
        required: ['description'],
        additionalProperties: false,
      },
    },
    {
      name: 'log_known_food',
      description: 'Propose logging a food the user has logged before, at a given weight. Only for foods returned by '
        + 'recent_foods - never guess a name. This does NOT log anything: it shows the user a card to confirm.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The food name exactly as recent_foods returned it.' },
          grams: { type: 'number', description: 'How many grams of it.' },
          meal: { type: 'string', description: 'Which meal of the day it belongs to. Omit if they did not say.' },
        },
        required: ['name', 'grams'],
        additionalProperties: false,
      },
    },
    {
      name: 'log_saved_meal',
      description: 'Propose logging one of the user\'s saved meals, whole. Only for meals returned by recent_foods. '
        + 'This does NOT log anything: it shows the user a card to confirm.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The saved meal name exactly as recent_foods returned it.' },
          meal: { type: 'string', description: 'Which meal of the day it belongs to. Omit if they did not say.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'recent_foods',
      description: 'Search the foods and saved meals this user has logged before. Use it before log_known_food or '
        + 'log_saved_meal to find the exact name, and whenever you are not sure whether something is already saved.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Part of a food or meal name. Empty string lists the most recent.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'day_summary',
      description: 'Read today\'s numbers: calories and macros eaten and remaining, protein target, whether they have '
        + 'weighed in, and their sleep, steps and readiness. Use it before answering anything about how the day is going. '
        + 'Call it again after something is logged, because the numbers will have moved.',
      strict: true,
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'save_weight',
      description: 'Propose saving a weigh-in for today. This does NOT save anything: it shows the user the number to '
        + 'confirm. Only use it when they tell you a weight; never estimate one.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          kg: { type: 'number', description: 'The weight in kilograms. Convert from stones and pounds if that is what they said.' },
        },
        required: ['kg'],
        additionalProperties: false,
      },
    },
    {
      name: 'open_screen',
      description: 'Open a screen in the app for anything you cannot do yourself. Use it instead of explaining where to tap.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          screen: {
            type: 'string',
            description: 'Which screen to open.',
            enum: ['food', 'cook', 'train', 'progress', 'settings', 'buddy', 'check-in', 'weigh-in'],
          },
        },
        required: ['screen'],
        additionalProperties: false,
      },
    },
  ];
  var TOOL_NAMES = TOOLS.map(function (t) { return t.name; });
  // Screens the buddy may open, mapped to what the app calls them. A closed list rather than a
  // passthrough: "open a screen" is the one tool with no confirmation step, so the set of places it
  // can send someone is fixed here rather than being whatever string the model produced.
  var SCREENS = {
    food: 'foodlog', cook: 'recipes', train: 'train', progress: 'goals',
    settings: 'more', buddy: 'play', 'check-in': 'checkin', 'weigh-in': 'weigh',
  };
  // A weight a person could actually be. Wide on purpose - this is here to catch a decimal point in
  // the wrong place or stones read as kilos, not to have an opinion about anybody's body.
  var MIN_KG = 25, MAX_KG = 400;
  var MAX_GRAMS = 5000;   // 5kg of one food in one sitting is a typo, not a meal
  var MAX_MATCHES = 8;    // how many foods recent_foods hands back

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function err(message) { return { ok: false, error: message }; }
  function norm(s) { return String(s || '').trim().toLowerCase(); }

  // Which meal of the day. The model gets to say "lunch" and we find the real one, because meal ids
  // are ours and the names are the user's (they can rename them, and a day can have a different set).
  // Unmatched is not an error: no meal named is the normal case, and the caller picks the sensible
  // default for the time of day rather than the conversation having to ask.
  function resolveMeal(name, meals) {
    var want = norm(name);
    if (!want) return null;
    var list = meals || [];
    for (var i = 0; i < list.length; i++) if (norm(list[i].name) === want) return list[i].id;
    for (var j = 0; j < list.length; j++) if (norm(list[j].name).indexOf(want) === 0) return list[j].id;
    return null;
  }

  // Find a food the user has logged before. Exact first, then prefix, then substring, so "chicken"
  // finds "Chicken breast" but an exact "Chicken" still wins if they have one.
  function findFood(name, foods) {
    var want = norm(name);
    if (!want) return null;
    var list = foods || [];
    var i;
    for (i = 0; i < list.length; i++) if (norm(list[i].name) === want) return list[i];
    for (i = 0; i < list.length; i++) if (norm(list[i].name).indexOf(want) === 0) return list[i];
    for (i = 0; i < list.length; i++) if (norm(list[i].name).indexOf(want) >= 0) return list[i];
    return null;
  }

  // What to offer when a name did not resolve. Searching the whole phrase is useless here - the
  // reason it failed is that nothing matches it - so this falls back to the first word, which is
  // what turns "chicken korma" into a list of the chicken they actually have. Without it the model
  // gets a flat "no" and its only move is to guess again.
  function nearMatches(name, foods, savedMeals) {
    var whole = search(name, foods, savedMeals);
    if (whole.foods.length || whole.meals.length) return whole;
    var first = String(name || '').trim().split(/\s+/)[0];
    return first && first !== name ? search(first, foods, savedMeals) : whole;
  }

  function search(query, foods, savedMeals) {
    var q = norm(query);
    var hit = function (n) { return !q || norm(n).indexOf(q) >= 0; };
    return {
      foods: (foods || []).filter(function (f) { return hit(f.name); }).slice(0, MAX_MATCHES).map(function (f) { return f.name; }),
      meals: (savedMeals || []).filter(function (m) { return hit(m.name); }).slice(0, MAX_MATCHES).map(function (m) { return m.name; }),
    };
  }

  /* Validate one tool call and resolve it into a PLAN the app can carry out.
     ctx = { meals: [{id,name}], foods: [{name}], savedMeals: [{name}] }
     Returns { ok: true, plan } or { ok: false, error }. The error string goes straight back to the
     model as a tool_result, so it is written to be acted on ("I do not have a food called X, here
     is what I do have") rather than to be logged. */
  function validate(name, args, ctx) {
    var a = args || {}, c = ctx || {};
    switch (name) {
      case 'estimate_meal': {
        var d = str(a.description);
        if (!d) return err('I need to know what they ate before I can estimate it. Ask them.');
        return { ok: true, plan: { kind: 'estimate', description: d, mealId: resolveMeal(a.meal, c.meals) } };
      }
      case 'log_known_food': {
        var fname = str(a.name);
        if (!fname) return err('Which food? Use recent_foods to find the exact name first.');
        var food = findFood(fname, c.foods);
        if (!food) {
          var near = nearMatches(fname, c.foods, c.savedMeals);
          return err('There is no saved food called "' + fname + '".'
            + (near.foods.length ? ' Closest matches: ' + near.foods.join(', ') + '.' : '')
            + ' If it is something new, use estimate_meal instead.');
        }
        var g = Number(a.grams);
        if (!isFinite(g) || g <= 0) return err('How many grams? I need a positive number.');
        if (g > MAX_GRAMS) return err('That is over ' + MAX_GRAMS + 'g of one food, which is almost certainly a slip. Check the amount with them.');
        return { ok: true, plan: { kind: 'known_food', name: food.name, grams: Math.round(g), mealId: resolveMeal(a.meal, c.meals) } };
      }
      case 'log_saved_meal': {
        var mname = str(a.name);
        if (!mname) return err('Which saved meal? Use recent_foods to find the exact name first.');
        var meal = findFood(mname, c.savedMeals);
        if (!meal) {
          var nearM = nearMatches(mname, c.foods, c.savedMeals);
          return err('There is no saved meal called "' + mname + '".'
            + (nearM.meals.length ? ' Saved meals: ' + nearM.meals.join(', ') + '.' : '')
            + ' If it is something new, use estimate_meal instead.');
        }
        return { ok: true, plan: { kind: 'saved_meal', name: meal.name, mealId: resolveMeal(a.meal, c.meals) } };
      }
      case 'recent_foods':
        return { ok: true, plan: { kind: 'search', results: search(a.query, c.foods, c.savedMeals) } };
      case 'day_summary':
        return { ok: true, plan: { kind: 'summary' } };
      case 'save_weight': {
        var kg = Number(a.kg);
        if (!isFinite(kg) || kg <= 0) return err('I need a weight as a number in kilograms.');
        if (kg < MIN_KG || kg > MAX_KG) return err('I read that as ' + kg + 'kg, which does not look right. Check the number with them.');
        return { ok: true, plan: { kind: 'weight', kg: Math.round(kg * 10) / 10 } };
      }
      case 'open_screen': {
        var view = SCREENS[norm(a.screen)];
        if (!view) return err('I cannot open "' + str(a.screen) + '". Choose one of: ' + Object.keys(SCREENS).join(', ') + '.');
        return { ok: true, plan: { kind: 'open', screen: norm(a.screen), view: view } };
      }
      default:
        return err('There is no tool called "' + String(name) + '".');
    }
  }

  var Talk = {
    TOOLS: TOOLS,
    TOOL_NAMES: TOOL_NAMES,
    SCREENS: SCREENS,
    MIN_KG: MIN_KG,
    MAX_KG: MAX_KG,
    MAX_GRAMS: MAX_GRAMS,
    MAX_MATCHES: MAX_MATCHES,
    resolveMeal: resolveMeal,
    findFood: findFood,
    search: search,
    nearMatches: nearMatches,
    validate: validate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Talk;
  root.Talk = Talk;
})(typeof window !== 'undefined' ? window : this);
