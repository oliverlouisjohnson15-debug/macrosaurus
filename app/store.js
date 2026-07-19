/*
 * store.js, Local-first repository (localStorage).
 * This is the swap point: replace these methods with a Supabase-backed
 * implementation later and the UI does not change. See PLAN.md §7 & §9.
 * Everything is namespaced by user_id (a fixed 'local' user for now).
 */
(function (root) {
  'use strict';

  var KEY = 'macrosaurus:v1';
  var USER = 'local';

  // LOCAL calendar date (not UTC) so entries land on the user's actual day.
  function isoOf(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function todayISO() { return isoOf(new Date()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Profile-level defaults (profile is null in defaultState, so it needs its own
  // backfill map for deep-merge migration of nested settings).
  var PROFILE_DEFAULTS = {
    carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: false, highDays: [], deltaPct: 0.15 },
    program_mode: 'collaborative',
    proteinGPerKgLBM: 2.0,
  };

  // Recursively fill in any keys missing from `target` using `defaults`,
  // without overwriting values the user already has. Arrays are treated as leaves.
  function deepDefaults(target, defaults) {
    if (Array.isArray(defaults)) return target === undefined ? defaults : target;
    if (defaults && typeof defaults === 'object') {
      var out = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
      for (var k in defaults) { if (Object.prototype.hasOwnProperty.call(defaults, k)) out[k] = deepDefaults(out[k], defaults[k]); }
      return out;
    }
    return target === undefined ? defaults : target;
  }

  // Self-heal calories that were logged clearly higher than their macros can account for (the classic
  // scan/entry-slip signature, e.g. a whole-pot calorie figure paired with a single serving of macros).
  // We only touch gross mismatches (>25% AND >40 kcal over Atwater) and never alcohol, so accurate
  // labels, fibre-rich foods and sugar-free items (where calories legitimately sit below the macro
  // maths) are left alone. Snapping to protein*4 + carbs*4 + fat*9 restores a sane, consistent value.
  function healMacro(m, isAlcohol) {
    if (!m || isAlcohol) return;
    var kcal = +m.kcal || 0;
    var atw = (+m.protein || 0) * 4 + (+m.carbs || 0) * 4 + (+m.fat || 0) * 9;
    if (atw > 0 && kcal > atw * 1.25 + 40) m.kcal = Math.round(atw);
  }
  function healMacros(s) {
    (s.log_entries || []).forEach(function (e) { healMacro(e.computed_macros, e.is_alcohol); });
    (s.foods || []).forEach(function (f) { healMacro(f.macros, f.is_alcohol); });
    (s.saved_meals || []).forEach(function (sm) { (sm.items || []).forEach(function (it) { healMacro(it.macros, it.is_alcohol); }); });
    return s;
  }

  // Bring any loaded/older state up to the current shape.
  function migrate(state) {
    var s = deepDefaults(state ? JSON.parse(JSON.stringify(state)) : {}, defaultState());
    if (s.profile) s.profile = deepDefaults(s.profile, PROFILE_DEFAULTS);
    return healMacros(s);
  }

  function defaultState() {
    return {
      user_id: USER,
      profile: null, // set during onboarding
      meal_templates: [
        { id: 'm_1', user_id: USER, name: 'Breakfast', sort_order: 0 },
        { id: 'm_2', user_id: USER, name: 'Lunch', sort_order: 1 },
        { id: 'm_3', user_id: USER, name: 'Dinner', sort_order: 2 },
        { id: 'm_s', user_id: USER, name: 'Snacks', sort_order: 3 },
        { id: 'm_o', user_id: USER, name: 'Other', sort_order: 4 },
      ],
      day_meals: {},      // per-date meal lists overriding meal_templates: { 'YYYY-MM-DD': [{id,user_id,name,sort_order}] }
      foods: [],          // saved foods: favorites (is_favorite) + recents (updated_at); remembered serving
      log_entries: [],    // what was eaten, per date+meal
      weight_entries: [], // check-ins (weight + body fat)
      targets: [],        // history of targets; last is current
      day_overrides: {},  // per-date carb/fat rebalance: { 'YYYY-MM-DD': { shiftKcal } }
      last_checkin: null, // ISO date of last completed weekly check-in (gates cadence)
      checkins: [],       // history: [{ date, weightKg, onTrack, changed, weeklyChangeKg?, deltaKcal?, tdee? }]
      pending_adjustment: null, // an un-actioned check-in proposal: { date, result } (survives reloads until approved/rejected)
      expenditure: null,  // smoothed adaptive TDEE: { kcal, n, updated } (null until the first check-in learns it)
      paused: false,      // goal paused (holiday mode)
      diet_break: null,       // temporary maintenance phase: { start, end, returnGoal }
      last_break_end: null,   // ISO date the last diet break ended (resets the dieting clock)
      diet_break_snooze: null,// ISO date until which the diet-break offer is hidden ("Not now")
      saved_meals: [],    // named multi-item meals for one-tap logging: { id, name, items:[...], created_at }
      recipes: [],        // saved recipes decomposed from a shared video/link: { id, user_id, title, source_platform, source_url, thumbnail, servings, ingredients:[{id,name,quantity,unit,grams,have}], steps:[], macros_per_serving:{kcal,protein,carbs,fat,fiber}, macros_confidence, created_at, updated_at }
      shopping_list: [],  // rolled-up things to buy: { id, name, qtys:{unit:amount}, qty_label, category, recipe_ids:[], checked, manual, added_at }
      pantry: [],         // normalised names the user "always has", skipped when adding recipe ingredients to the list
      meal_plan: [],      // planned recipes on a calendar: { id, date, recipe_id, portion, cooked, added_at }
      catch_log: {},      // persistent Macrodex catches: { 'YYYY-MM-DD': [{ id, shiny }] }, locked so later edits never lose a caught creature
      items: {},          // shared item inventory: { itemId: count }
      dex_boost: null,    // active catching boost for a day: { date, lure: macro|null, shiny: bool, rare: bool }
      game_awards: {},    // idempotency keys for one-time item / milestone grants
      fight: { rank: 0, wins: 0, trophies: 0, lastBossWeek: null, prestige: 0, lastAttemptDate: null }, // ladder + weekly boss + prestige; one ladder attempt per logged day
      game_salt: null,    // per-user random seed for daily catch rolls (set once on first run)
      badges: { checkins: 0, inRange: 0 }, // badge-track counters: check-ins completed / in-range check-ins
      buddy: { stage: 0, name: '', personality: '', hatchedISO: null, speciesId: null, evoStage: 0, affinity: null },   // stage: high-water index (naps after a break); name/personality/hatchedISO/speciesId/evoStage/affinity: the individual you raise, bond-evolve, and its day/night path
      records: { longestStreak: 0 }, // streak records shown in the trophy cabinet
      freezes: { frozen: [] }, // streak-freeze: ISO dates auto-forgiven (max one per calendar month)
      onboarding: { welcomed: false, sawDex: false, dismissed: false }, // first-run welcome tour + getting-started checklist
      deleted: {},        // deletion tombstones { entryId: deletedAtMs } so a merge/sync never resurrects a deleted item
      menstrual: { enabled: false, lastStart: null, cycleLen: 28 }, // optional cycle tracking so premenstrual water weight doesn't trigger a wrong calorie cut
      steps: {},          // daily step counts (Google Health sync or manual): { 'YYYY-MM-DD': count }. Powers the steps tile + steps-first check-in coaching.
      sleep: {},          // nightly sleep keyed by WAKE date (Google Health sync): { 'YYYY-MM-DD': { min, score, deep?, rem?, light?, awake? } }. Powers the sleep tile + morning Macrodex catch.
      sleepDex: { claimed: {}, lastDate: null, lastId: null, lastShiny: false, lastStyle: null }, // Pokemon Sleep style morning-catch: which wake dates already awarded a catch + last night's reveal
      googleHealth: null, // Google Health connection state (Phase 3): { connected, lastSync }; null until linked. Refresh token lives server-side only.
      goals: null,
    };
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('store.load failed, resetting', e);
      return defaultState();
    }
  }

  function save(state) {
    root.localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  function reset() {
    root.localStorage.removeItem(KEY);
    return defaultState();
  }

  // Union two arrays by a stable key, keeping the FIRST occurrence on conflict (callers pass the
  // authoritative array first). Anything without a key is kept as-is (never dropped).
  function unionBy(primary, secondary, keyFn) {
    var seen = {}, out = [], anon = 0;
    function add(arr) {
      (arr || []).forEach(function (e) {
        if (e == null) return;
        var k = keyFn(e); if (k == null) k = '__anon' + (anon++);
        if (seen[k]) return; seen[k] = 1; out.push(e);
      });
    }
    add(primary); add(secondary);
    return out;
  }

  // Conflict-free merge of two full states. The append-only collections (food log, weigh-ins,
  // check-ins, foods, saved meals, targets, catches, freezes, awards) are UNIONED so a save can
  // never lose an entry the other copy has. Scalar/derived fields come from the higher-_rev state.
  // This is the core safeguard against last-writer-wins overwriting good data with a stale copy.
  function mergeStates(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    // Reset watermark. "Reset all data" stamps the fresh, empty baseline with _wipe = t (and _rev = t).
    // Any copy whose entries all predate t (both its _rev and _wipe are < t) is a pre-reset snapshot:
    // its entries must NOT be unioned back in, or the union below would silently undo the reset (the
    // exact bug where a wiped log/engine reappears after closing and reopening the app). The post-reset
    // baseline, and any edit descended from it, carries _wipe forward and wins wholesale.
    var wipe = Math.max((a._wipe || 0), (b._wipe || 0));
    if (wipe) {
      var preWipe = function (s) { return (s._wipe || 0) < wipe && (s._rev || 0) < wipe; };
      if (preWipe(a)) return b;
      if (preWipe(b)) return a;
    }
    var ra = (a && a._rev) || 0, rb = (b && b._rev) || 0;
    var newer = ra >= rb ? a : b, older = ra >= rb ? b : a;
    var out = JSON.parse(JSON.stringify(newer));
    var byId = function (e) { return e && e.id; };
    var byDate = function (e) { return e && e.date; };
    out.log_entries    = unionBy(newer.log_entries,    older.log_entries,    byId);
    out.weight_entries = unionBy(newer.weight_entries, older.weight_entries, byId);
    out.foods          = unionBy(newer.foods,          older.foods,          byId);
    out.saved_meals    = unionBy(newer.saved_meals,    older.saved_meals,    byId);
    out.recipes        = unionBy(newer.recipes,        older.recipes,        byId);
    out.shopping_list  = unionBy(newer.shopping_list,  older.shopping_list,  byId);
    out.pantry         = Array.from(new Set([].concat(older.pantry || [], newer.pantry || [])));
    out.meal_plan      = unionBy(newer.meal_plan,      older.meal_plan,      byId);
    out.targets        = unionBy(newer.targets,        older.targets,        byId);
    out.checkins       = unionBy(newer.checkins,       older.checkins,       byDate);
    // date-keyed maps: union keys, newer wins on a shared date
    out.day_meals     = Object.assign({}, older.day_meals || {},     newer.day_meals || {});
    out.day_overrides = Object.assign({}, older.day_overrides || {}, newer.day_overrides || {});
    out.game_awards   = Object.assign({}, older.game_awards || {},   newer.game_awards || {});
    out.steps         = Object.assign({}, older.steps || {},         newer.steps || {}); // newer wins per date (Google Health resync / manual edit)
    out.sleep         = Object.assign({}, older.sleep || {},         newer.sleep || {}); // newer wins per wake date
    // sleepDex: union the claimed wake dates, keep the later night's reveal fields
    var so = older.sleepDex || {}, sn = newer.sleepDex || {};
    var later = (sn.lastDate || '') >= (so.lastDate || '') ? sn : so;
    out.sleepDex = Object.assign({}, later, { claimed: Object.assign({}, so.claimed || {}, sn.claimed || {}) });
    // catch_log: union dates, and union the creatures caught on each shared date
    var cl = {};
    [older.catch_log || {}, newer.catch_log || {}].forEach(function (src) {
      Object.keys(src).forEach(function (d) { cl[d] = unionBy(src[d], cl[d], function (c) { return c && c.id; }); });
    });
    out.catch_log = cl;
    // freezes: union the forgiven dates
    var fz = {};
    [older, newer].forEach(function (s) { (((s.freezes || {}).frozen) || []).forEach(function (d) { fz[d] = 1; }); });
    out.freezes = Object.assign({}, newer.freezes, { frozen: Object.keys(fz).sort() });
    // Deletion tombstones: union both maps (latest timestamp wins), then drop any unioned entry whose
    // id is tombstoned. Without this a merge resurrects deleted items, since the other copy still has them.
    var del = {};
    [older.deleted || {}, newer.deleted || {}].forEach(function (src) {
      for (var id in src) { if (Object.prototype.hasOwnProperty.call(src, id) && (!del[id] || src[id] > del[id])) del[id] = src[id]; }
    });
    var alive = function (arr) { return (arr || []).filter(function (e) { return !(e && e.id != null && del[e.id]); }); };
    out.log_entries    = alive(out.log_entries);
    out.weight_entries = alive(out.weight_entries);
    out.foods          = alive(out.foods);
    out.saved_meals    = alive(out.saved_meals);
    out.recipes        = alive(out.recipes);
    out.shopping_list  = alive(out.shopping_list);
    out.meal_plan      = alive(out.meal_plan);
    // Cap tombstones to the 1000 most recent so the map can't grow without bound.
    var dids = Object.keys(del);
    if (dids.length > 1000) { dids.sort(function (x, y) { return del[y] - del[x]; }); var cap = {}; dids.slice(0, 1000).forEach(function (id) { cap[id] = del[id]; }); del = cap; }
    out.deleted = del;
    out._rev = Math.max(ra, rb);
    out._wipe = wipe; // carry the reset watermark forward so it keeps protecting later merges
    return out;
  }

  var Store = {
    USER: USER,
    isoOf: isoOf,
    todayISO: todayISO,
    uid: uid,
    defaultState: defaultState,
    migrate: migrate,
    mergeStates: mergeStates,
    load: load,
    save: save,
    reset: reset,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  root.Store = Store;
})(typeof window !== 'undefined' ? window : this);
