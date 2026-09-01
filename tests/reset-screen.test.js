'use strict';
/* The reset screen. It is the one screen in the app whose job is destruction, so what it SAYS about
   what will go has to match what the store will actually clear - the two lists drifting apart is how
   somebody loses a cookbook they were told they were keeping. */
const test = require('node:test');
const assert = require('node:assert');
const { app, render } = require('./helpers/app.js');

const A = app();
const noop = () => {};

// An account with something in every group the screen offers, so no row can render empty by accident.
function livedIn() {
  return Object.assign(A.Store.defaultState(), {
    log_entries: [{ id: 'a', date: '2026-07-08', meal_id: 'm_1', computed_macros: { kcal: 500 } }],
    weight_entries: [{ id: 'w', date: '2026-07-08', scale_weight: 82 }],
    checkins: [{ date: '2026-07-04' }],
    foods: [{ id: 'f', name: 'Oats' }], recipes: [{ id: 'r', title: 'Katsu' }],
    buddy: { stage: 3, name: 'Chompers', cosmetics: [] },
    fight: { rank: 7, wins: 18, trophies: 1, prestige: 0 },
    steps: { '2026-07-08': 9000 },
    profile: { weightKg: 82, goalType: 'cut' },
    training: { blocks: [{ id: 'b1' }], logs: [{ id: 'l1', dateISO: '2026-07-08' }], custom: [], prefs: {} },
  });
}

test('every group the reset can clear is offered as its own row', () => {
  // The screen's rows and the store's groups have to be the same set. A group with no row could
  // never be kept; a row with no group would promise a choice that does nothing. Counted through the
  // rendered markup because RESET_ROWS is a const in the app's single shared scope, which is not
  // reachable from the harness the way a function declaration is.
  const r = render(A.ResetScreen, { db: livedIn(), onBack: noop, onConfirm: noop });
  assert.strictEqual(r.html.split('>DELETE<').length - 1, A.Store.RESET_GROUPS.length);
});

test('it arrives with everything marked for deletion, and says so', () => {
  const r = render(A.ResetScreen, { db: livedIn(), onBack: noop, onConfirm: noop });
  assert.strictEqual(r.html.split('>DELETE<').length - 1, A.Store.RESET_GROUPS.length, 'every row starts on DELETE');
  assert.ok(!r.has('>KEEP<'), 'and none of them starts on KEEP');
  assert.ok(r.has('Reset everything'), 'the button names the all-in case');
});

test('the rows carry this account\'s own numbers, not abstractions', () => {
  const r = render(A.ResetScreen, { db: livedIn(), onBack: noop, onConfirm: noop });
  assert.ok(r.has('1 entries across 1 days'), 'the food log is counted');
  assert.ok(r.has('Chompers'), 'the buddy is named, so you know which creature goes');
  assert.ok(r.has('rank 7, 18 wins'), 'the ladder is quantified');
});

test('what the screen promises to keep is what the store actually keeps', () => {
  // The contract that matters: tick Training and Recipes to keep, and those two groups - and only
  // those - survive Store.freshStart with the same map. Checked against the store, not a comment.
  const keep = {}; A.Store.RESET_GROUPS.forEach(g => { keep[g] = false; });
  keep.training = true; keep.recipes = true;
  const n = A.Store.freshStart(livedIn(), { today: '2026-09-01', now: 900, keep, groups: A.Store.RESET_GROUPS });
  assert.deepStrictEqual(n.training.logs.map(l => l.id), ['l1']);
  assert.deepStrictEqual(n.recipes.map(x => x.id), ['r']);
  assert.deepStrictEqual(n.log_entries, []);
  assert.strictEqual(n.buddy.name, '');
  assert.strictEqual(n.profile, null);
  assert.deepStrictEqual(n.steps, {});
  // ...and the watermark carries that same list, which is what makes it survive a merge.
  A.Store.RESET_GROUPS.forEach(g => {
    if (keep[g]) (A.Store.FRESH_PARTS[g] || []).forEach(f => assert.ok(n._soft.cleared.indexOf(f) < 0, f + ' was kept'));
    else (A.Store.FRESH_PARTS[g] || []).forEach(f => assert.ok(n._soft.cleared.indexOf(f) >= 0, f + ' was cleared'));
  });
});

test('a reset that keeps nothing still leaves the login-shaped things alone', () => {
  const keep = {}; A.Store.RESET_GROUPS.forEach(g => { keep[g] = false; });
  const before = Object.assign(livedIn(), { googleHealth: { connected: true, lastSync: '2026-08-31T00:00:00Z' } });
  const n = A.Store.freshStart(before, { today: '2026-09-01', now: 900, keep, groups: A.Store.RESET_GROUPS });
  // Admin lives in its own table and the Google link lives on the server; neither is app state, and
  // a reset that quietly unlinked an account would be a surprise the screen never warned about.
  assert.deepStrictEqual(n.googleHealth, { connected: true, lastSync: '2026-08-31T00:00:00Z' });
  assert.strictEqual(n.onboarding.needsSetup, true);
});
