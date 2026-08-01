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
  function shiftISO(iso, delta) { var t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); }
  // The engine, resolved lazily: in the bundle it is the block above this one, and under node the
  // store is required on its own. Never at load time, so neither order can leave it undefined.
  function engine() {
    if (root.Engine) return root.Engine;
    try { return typeof require === 'function' ? require('./engine.js') : null; } catch (e) { return null; }
  }

  // Profile-level defaults (profile is null in defaultState, so it needs its own
  // backfill map for deep-merge migration of nested settings).
  var PROFILE_DEFAULTS = {
    carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: false, highDays: [], deltaPct: 0.15 },
    cyclingHistory: [],     // dated record of the high/low plan: [{ effective_date, enabled, highDays, deltaPct }],
                            // ascending, effective_date null = since the beginning. A day is always
                            // composed against the plan in force ON it, so editing the plan today
                            // cannot restate days already eaten (see Engine.cyclingOn).
    program_mode: 'collaborative',
    proteinGPerKgLBM: 2.0,
    trackingLane: 'balance',
    newToTracking: false,   // set at onboarding; true = the buddy runs its teaching curriculum
    lessonState: { seen: [], lastAck: null }, // curriculum progress: lesson keys learnt + last ack date
    readAckDate: null,      // ISO date the buddy's morning read was dismissed, so it shows once a day
    premiumSince: null,     // ISO date the current Premium run began; null while free. Bounds how far
                            // back food-quality scoring will fill in missing nutrients, so nothing
                            // logged as a free user is ever rewritten (see useNutrientBackfill).
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
    // Macrodex removal: strip the retired collection/catch state from existing users on load, so it
    // can't linger, resurface through a merge, or be read by code that no longer expects it. Keep
    // items (Fight trophies), game_awards (badge idempotency), amber_ledger, fight and buddy.
    ['catch_log', 'dex_boost', 'sleepDex', 'primed', 'eggs', 'breakthrough'].forEach(function (k) { delete s[k]; });
    // Back-fill the high/low plan history for state saved before the plan was dated. With no
    // history there is nothing for a day to be read against but the plan as it stands NOW, so a
    // plan set today reshapes every day already eaten: exactly what the history exists to stop.
    // What the old state does record is cyclingChangedAt, the day the plan last changed, and that
    // is enough to know the current shape did NOT run before it. Those earlier days are therefore
    // written down as having no shape at all, the base target they were planned around, rather than
    // being handed a shape invented after the fact; the shape we do have runs from the change date.
    // A plan that has never been changed has always been the plan, so it back-fills as a single
    // open-start entry, which is what the app already assumed. Nothing is invented either way, and
    // both leave a record for later changes to date themselves against.
    if (s.profile && s.profile.cycling && !(s.profile.cyclingHistory || []).length) {
      var cy = s.profile.cycling;
      var pct = +cy.deltaPct || 0.15;
      var known = function (from) { return { effective_date: from, enabled: !!cy.enabled, highDays: (cy.highDays || []).slice(), deltaPct: pct }; };
      s.profile.cyclingHistory = s.profile.cyclingChangedAt
        ? [{ effective_date: null, enabled: false, highDays: [], deltaPct: pct }, known(s.profile.cyclingChangedAt)]
        : [known(null)];
    }
    // A back-filled change lands mid-window exactly as a live one does, and owes that window the same
    // rebalance (see Engine.cyclingSpread). The back-fill above cannot write one: it recovers the
    // shape of the plan, not what the change owed, so the entry it leaves is the only one the app can
    // produce with no rebalance on it at all. Without one the week keeps the change's overshoot, the
    // days already eaten stay flat, every day from the change on takes the new shape, and the window
    // no longer nets to the base target, so the days after a high day never come back down as far as
    // they should. Settle it here, on the newest dated entry, the only one whose window can still be
    // running. An edit made in the app always records its own spread (see pendingCyclingChange), so
    // `spreadKcal` missing entirely is what marks a back-filled entry, and writing a number, 0
    // included, is what stops this running again on the next load.
    var cycHist = (s.profile && s.profile.cyclingHistory) || [];
    var newest = cycHist.length ? cycHist[cycHist.length - 1] : null;
    if (newest && newest.effective_date && !('spreadKcal' in newest)) {
      var E = engine();
      var lastTarget = (s.targets && s.targets.length) ? s.targets[s.targets.length - 1] : null;
      if (E && lastTarget && lastTarget.kcal) {
        // The same window the app's own edit uses: this check-in's, never more than seven days back.
        // cyclingSpread is neutral by construction for a change on or before the window start, or
        // past its end, so a plan last changed in an older window settles at 0 and moves nothing.
        var today = todayISO();
        var floorISO = shiftISO(today, -6);
        var ws = (s.last_checkin && s.last_checkin > floorISO) ? s.last_checkin : floorISO;
        // Settled from TODAY, not from the change: the days between the two have already been
        // eaten, and a rebalance worked out after the fact must not reach back and restate them.
        // What is left carries the whole of it.
        var sp = E.cyclingSpread({
          cycling: s.profile.cycling, cyclingHistory: cycHist, changeDate: newest.effective_date,
          settleFrom: today, windowStart: ws, baseKcal: lastTarget.kcal, floorKcal: E.kcalFloor(s.profile),
        });
        newest.spreadKcal = sp.spreadKcal;
        newest.spreadFrom = sp.from;
        newest.spreadUntil = sp.until;
      }
    }
    // Reconcile the last_checkin pointer to the append-only checkins ledger on every load. A cross-device
    // merge can leave the scalar stale while the union preserves a newer check-in (see mergeStates), which
    // makes the app read "check-in due" despite a saved check-in. Healing here covers the single-copy load
    // too (no merge to trigger the fix). Only ever moves the pointer forward, never back.
    if (s.checkins && s.checkins.length) {
      var latestCheckin = s.checkins.reduce(function (m, c) { return (c && c.date && c.date > m) ? c.date : m; }, '');
      if (latestCheckin && (!s.last_checkin || latestCheckin > s.last_checkin)) s.last_checkin = latestCheckin;
    }
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
      ],
      day_meals: {},      // per-date meal lists overriding meal_templates: { 'YYYY-MM-DD': [{id,user_id,name,sort_order}] }
      foods: [],          // saved foods: favorites (is_favorite) + recents (updated_at); remembered serving
      // Both foods and log_entries may carry `nq`: the nutrients behind the nutrient-density score
      // ({ protein, fiber, fat, satfat, sugars, salt } in grams PER 100 KCAL, plus `ed`, the food's
      // energy density in kcal per 100 g). Held per 100 kcal so it never needs rescaling when the
      // portion changes, and left null when a food was logged without that data (see Engine.ndDay,
      // which reports how much of a day it could score rather than assuming the rest was fine).
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
      items: {},          // Fight / trophy inventory: { itemId: count } (e.g. the Champion Belt)
      game_awards: {},    // idempotency keys for one-time grants (the check-in badge track, etc.)
      amber_ledger: [],   // append-only Amber-currency ledger: [{ id, date, delta, reason }]; balance = sum(delta). Append-only so a merge can never lose or double-count winnings (see mergeStates)
      fight: { rank: 0, wins: 0, trophies: 0, lastBossWeek: null, prestige: 0, lastAttemptDate: null, lastDailyDate: null, dailyStreak: 0, dailyBest: 0 }, // ladder + weekly boss + daily hunt + prestige; one ladder/daily attempt per logged day
      game_salt: null,    // per-user random seed for the buddy's stable-per-day mood/personality flavour (set once on first run)
      badges: { checkins: 0, inRange: 0 }, // badge-track counters: check-ins completed / in-range check-ins
      buddy: { stage: 0, stageSeen: null, name: '', personality: '', hatchedISO: null, speciesId: null, evoStage: 0, affinity: null, cosmetics: [], equipped: {} },   // stage: high-water index (naps after a break); stageSeen: highest stage already celebrated, NULL until seeded so an existing buddy's stage is never replayed as growth (see Game.stageUp); name/personality/hatchedISO/speciesId/evoStage/affinity: the individual you raise, bond-evolve, and its day/night path; cosmetics: shop-bought items owned; equipped: slot -> item id actually worn
      records: { longestStreak: 0 }, // streak records shown in the trophy cabinet
      freezes: { frozen: [] }, // streak-freeze: ISO dates auto-forgiven (max one per calendar month)
      onboarding: { welcomed: false, sawDex: false, dismissed: false }, // first-run welcome tour + getting-started checklist
      deleted: {},        // deletion tombstones { entryId: deletedAtMs } so a merge/sync never resurrects a deleted item
      menstrual: { enabled: false, lastStart: null, cycleLen: 28 }, // optional cycle tracking so premenstrual water weight doesn't trigger a wrong calorie cut
      steps: {},          // daily step counts (Google Health sync or manual): { 'YYYY-MM-DD': count }. Powers the steps tile + steps-first check-in coaching.
      sleep: {},          // nightly sleep keyed by WAKE date (Google Health sync): { 'YYYY-MM-DD': { min, score, deep?, rem?, light?, awake? } }. Powers the sleep tile + readiness.
      health: {},         // daily recovery signals keyed by date (Google Health, Phase B): { 'YYYY-MM-DD': { hrv, hrvBaseline, rhr, rhrBaseline, tempDev } }. Powers the readiness score.
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
    // Meal names/order: union by id so a rename or added meal on one device isn't lost to a
    // higher-_rev copy that never saw it. Removals are tombstoned at save time (see the settings
    // editor), so the alive() filter below drops a meal deleted on either device rather than letting
    // the union resurrect it. Re-sorted by sort_order after the union so the merged order stays sane.
    out.meal_templates = unionBy(newer.meal_templates, older.meal_templates, byId);
    out.targets        = unionBy(newer.targets,        older.targets,        byId);
    out.checkins       = unionBy(newer.checkins,       older.checkins,       byDate);
    // Amber currency is an append-only ledger: union by entry id so a device that earned or spent
    // offline can never have its Amber lost or double-counted. Balance is recomputed from this.
    out.amber_ledger   = unionBy(newer.amber_ledger,   older.amber_ledger,   byId);
    // date-keyed maps: union keys, newer wins on a shared date
    out.day_meals     = Object.assign({}, older.day_meals || {},     newer.day_meals || {});
    out.day_overrides = Object.assign({}, older.day_overrides || {}, newer.day_overrides || {});
    out.game_awards   = Object.assign({}, older.game_awards || {},   newer.game_awards || {});
    out.steps         = Object.assign({}, older.steps || {},         newer.steps || {}); // newer wins per date (Google Health resync / manual edit)
    out.sleep         = Object.assign({}, older.sleep || {},         newer.sleep || {}); // newer wins per wake date
    out.health        = Object.assign({}, older.health || {},        newer.health || {}); // recovery signals, newer wins per date
    // googleHealth: a server-backed connection flag that must survive a merge from a device/tab that
    // never linked (or holds an older snapshot). Taking `newer` wholesale (as the JSON copy does) lets a
    // higher-_rev copy with no connection silently wipe a live link, so the UI flips to "not connected"
    // even though the server is still synced. Instead keep the most RECENT connection event across the
    // two copies: a live/synced link stamps lastSync, an explicit unlink stamps disconnectedAt, and a
    // copy that never linked has neither (time 0) so it can no longer clobber a live connection.
    var ghTime = function (g) { return g ? (Date.parse(g.lastSync) || Date.parse(g.disconnectedAt) || 0) : 0; };
    out.googleHealth = (ghTime(newer.googleHealth) >= ghTime(older.googleHealth) ? newer.googleHealth : older.googleHealth) || null;
    // (The Macrodex catch state - catch_log, sleepDex, primed, dex_boost, eggs, breakthrough - was
    // removed. migrate() strips it on load, so there is nothing here to union.)
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
    out.meal_templates = alive(out.meal_templates)
      .slice().sort(function (x, y) { return ((x && x.sort_order) || 0) - ((y && y.sort_order) || 0); });
    // Cap tombstones to the 1000 most recent so the map can't grow without bound.
    var dids = Object.keys(del);
    if (dids.length > 1000) { dids.sort(function (x, y) { return del[y] - del[x]; }); var cap = {}; dids.slice(0, 1000).forEach(function (id) { cap[id] = del[id]; }); del = cap; }
    out.deleted = del;
    // last_checkin is a pointer INTO the append-only checkins ledger, not an independent scalar.
    // The JSON clone above copies it from the higher-_rev copy, which desyncs it when the OTHER copy
    // recorded a check-in the union preserves: the ledger gains the entry but the pointer stays stale,
    // so the app reads "not checked in today" despite a saved check-in (the "check-in won't take shape"
    // bug). Reconcile it to the latest of both pointers and the newest merged entry (a resume-from-pause
    // can legitimately set last_checkin ahead of any checkins entry, so keep the max, never move back).
    var latestEntry = (out.checkins || []).reduce(function (m, c) { return (c && c.date && c.date > m) ? c.date : m; }, '');
    var lcCandidates = [a.last_checkin, b.last_checkin, latestEntry].filter(Boolean).sort();
    out.last_checkin = lcCandidates.length ? lcCandidates[lcCandidates.length - 1] : (out.last_checkin || null);

    // ---- Other derived scalars with the same last-writer-wins hazard as last_checkin ----
    // The JSON clone takes each of these from the higher-_rev copy, but they are monotonic or
    // recency-based: a stale-but-higher-_rev copy would drag them backward and discard progress the
    // other copy holds (learned after an offline check-in, a battle won on another device, etc).
    // Reconcile each by its own correct rule instead of last-writer-wins.
    var maxNum = function (x, y) { return Math.max((+x || 0), (+y || 0)); };
    var laterStr = function (x, y) { return (x || '') >= (y || '') ? (x || null) : (y || null); };

    // Adaptive TDEE: keep whichever copy LEARNED it most recently (stamped `updated` each check-in),
    // not the higher-_rev copy, which may not be the one that ran the latest check-in. A stale
    // expenditure skews the next target calculation until a future check-in overwrites it.
    var expA = a.expenditure, expB = b.expenditure;
    if (expA || expB) out.expenditure = ((expA && expA.updated) || '') >= ((expB && expB.updated) || '') ? (expA || expB) : (expB || expA);

    // Monotonic trophy-track counters and the longest-streak record: take the max so a device that
    // fell behind can never lower them.
    out.badges = Object.assign({}, newer.badges, {
      checkins: maxNum((a.badges || {}).checkins, (b.badges || {}).checkins),
      inRange:  maxNum((a.badges || {}).inRange,  (b.badges || {}).inRange),
    });
    out.records = Object.assign({}, newer.records, { longestStreak: maxNum((a.records || {}).longestStreak, (b.records || {}).longestStreak) });

    // Buddy is the individual the user raises, so a wholesale copy from a stale-but-higher-_rev
    // device can wipe the name, evolution or bought cosmetics it never saw (the JSON clone above only
    // carried the newer copy's buddy). Reconcile field-wise: growth stage and evoStage are high-water
    // marks (max, never regress); hatchedISO is the earliest known birth; identity fields prefer the
    // newer copy's value but never let an empty one clobber a set one (so a rename wins but a default
    // does not); owned cosmetics are UNIONED so an Amber-bought item can never be lost on a merge.
    if (out.buddy || a.buddy || b.buddy) {
      var ba = a.buddy || {}, bb = b.buddy || {}, bn = newer.buddy || {}, bo = older.buddy || {};
      var preferSet = function (x, y) { return (x != null && x !== '') ? x : (y != null && y !== '' ? y : (x != null ? x : y)); };
      var cos = {};
      [].concat(ba.cosmetics || [], bb.cosmetics || []).forEach(function (c) { if (c != null) cos[c] = 1; });
      var births = [ba.hatchedISO, bb.hatchedISO].filter(Boolean).sort();
      // Which cosmetic sits in each slot: the newer copy's choice wins per slot, but a slot the newer
      // copy never set falls back to the older one, so equipping on one device can't blank a slot the
      // other device had dressed. An explicit null (taken off) is a real choice and is preserved.
      var eqa = ba.equipped || {}, eqb = bb.equipped || {};
      var eqNew = bn.equipped || {}, eqOld = bo.equipped || {};
      var equipped = null;
      if (Object.keys(eqa).length || Object.keys(eqb).length) {
        equipped = Object.assign({}, eqOld);
        Object.keys(eqNew).forEach(function (k) { equipped[k] = eqNew[k]; });
      }
      // High-water like stage, EXCEPT that "never seeded" has to survive the merge: maxNum would turn
      // a pair of absent markers into 0, and a legacy buddy already at stage 4 would then read as a
      // four-stage rise and fire a celebration it never earned. Only fold when a side really has one.
      var seenA = ba.stageSeen, seenB = bb.stageSeen;
      var stageSeen = (seenA == null && seenB == null) ? null : maxNum(seenA, seenB);
      out.buddy = Object.assign({}, out.buddy || {}, {
        stage: maxNum(ba.stage, bb.stage),
        stageSeen: stageSeen,
        evoStage: maxNum(ba.evoStage, bb.evoStage),
        name: preferSet(bn.name, bo.name),
        personality: preferSet(bn.personality, bo.personality),
        speciesId: preferSet(bn.speciesId, bo.speciesId),
        affinity: preferSet(bn.affinity, bo.affinity),
        hatchedISO: births.length ? births[0] : ((out.buddy || {}).hatchedISO || null),
        cosmetics: Object.keys(cos),
      });
      if (equipped) out.buddy.equipped = equipped;
    }

    // First-run flags only ever flip true; OR them so a stale copy can't re-trigger onboarding.
    var oa = a.onboarding || {}, ob = b.onboarding || {};
    out.onboarding = Object.assign({}, older.onboarding, newer.onboarding, {
      welcomed: !!(oa.welcomed || ob.welcomed), sawDex: !!(oa.sawDex || ob.sawDex), dismissed: !!(oa.dismissed || ob.dismissed),
    });

    // Dino-fight progress has no append-only ledger, so a wholesale copy loses wins/rank earned on the
    // other device. Reconcile field-wise: prestige and the cumulative counters are monotonic (max);
    // ladder rank counts only WITHIN the top prestige tier (prestiging resets rank to 0, so a
    // lower-prestige copy's larger rank must not win); date gates take the later value; the daily
    // streak follows whichever copy logged the more recent daily win.
    if (a.fight || b.fight) {
      var fa = a.fight || {}, fb = b.fight || {};
      var prestige = maxNum(fa.prestige, fb.prestige);
      var rankAt = function (f) { return (+f.prestige || 0) === prestige ? (+f.rank || 0) : 0; };
      var dailyFrom = (fa.lastDailyDate || '') >= (fb.lastDailyDate || '') ? fa : fb;
      out.fight = Object.assign({}, newer.fight, {
        prestige: prestige,
        rank: Math.max(rankAt(fa), rankAt(fb)),
        wins: maxNum(fa.wins, fb.wins),
        trophies: maxNum(fa.trophies, fb.trophies),
        dailyBest: maxNum(fa.dailyBest, fb.dailyBest),
        dailyStreak: (+dailyFrom.dailyStreak || 0),
        lastDailyDate: laterStr(fa.lastDailyDate, fb.lastDailyDate),
        lastAttemptDate: laterStr(fa.lastAttemptDate, fb.lastAttemptDate),
        lastBossWeek: laterStr(fa.lastBossWeek, fb.lastBossWeek),
      });
    }
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
