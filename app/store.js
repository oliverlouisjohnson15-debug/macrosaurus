/*
 * store.js — Local-first repository (localStorage).
 * This is the swap point: replace these methods with a Supabase-backed
 * implementation later and the UI does not change. See PLAN.md §7 & §9.
 * Everything is namespaced by user_id (a fixed 'local' user for now).
 */
(function (root) {
  'use strict';

  var KEY = 'macrosaurus:v1';
  var USER = 'local';

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function defaultState() {
    return {
      user_id: USER,
      profile: null, // set during onboarding
      meal_templates: [
        { id: 'm_1', user_id: USER, name: 'Meal 1', sort_order: 0 },
        { id: 'm_2', user_id: USER, name: 'Meal 2', sort_order: 1 },
        { id: 'm_3', user_id: USER, name: 'Meal 3', sort_order: 2 },
        { id: 'm_s', user_id: USER, name: 'Snacks', sort_order: 3 },
        { id: 'm_o', user_id: USER, name: 'Other', sort_order: 4 },
      ],
      foods: [],          // saved foods: favorites (is_favorite) + recents (updated_at); remembered serving
      log_entries: [],    // what was eaten, per date+meal
      weight_entries: [], // check-ins (weight + body fat)
      targets: [],        // history of targets; last is current
      day_overrides: {},  // per-date carb/fat rebalance: { 'YYYY-MM-DD': { shiftKcal } }
      goals: null,
    };
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      return Object.assign(defaultState(), s);
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

  var Store = {
    USER: USER,
    todayISO: todayISO,
    uid: uid,
    defaultState: defaultState,
    load: load,
    save: save,
    reset: reset,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  root.Store = Store;
})(typeof window !== 'undefined' ? window : this);
