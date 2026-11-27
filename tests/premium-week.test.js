'use strict';
// Selling Premium after Black Friday (PREMIUM_GROWTH_PLAN.md). The free Premium week, the 48-hour
// first-year offer and the win-back are mostly TIME: what someone sees depends on where "now" falls
// against their week. These pin those windows down, plus the parts of the screens that say them,
// because an offer that shows a day late or a recap that counts the wrong week is the kind of bug
// nobody notices until it has cost a sale.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { app, render } = require('./helpers/app.js');
const Game = require('../app/game.js');

const A = app();
// Top-level consts are not on the app scope (only declarations are), so read them from the source.
const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');
const constOf = (name) => { const m = SRC.match(new RegExp('const ' + name + ' = ([0-9]+);')); return m ? +m[1] : null; };
const H = 36e5, D = 864e5;
const T0 = Date.parse('2026-12-10T12:00:00Z');
const row = (startOffsetDays, extra) => Object.assign({
  started_at: new Date(T0 + startOffsetDays * D).toISOString(),
  ends_at: new Date(T0 + (startOffsetDays + 7) * D).toISOString(),
}, extra || {});

test('no row, no week', () => {
  const w = A.premiumWeekState(null, T0);
  assert.strictEqual(w.has, false);
  assert.strictEqual(w.inWeek, false);
  assert.strictEqual(w.offerEnds, null);
});

test('inside the week: days left count today, and there is no offer yet', () => {
  const w = A.premiumWeekState(row(-2.2), T0);   // started 2.2 days ago
  assert.strictEqual(w.inWeek, true);
  assert.strictEqual(w.dayOf, 3);
  assert.strictEqual(w.daysLeft, 5);
  assert.strictEqual(w.offerEnds, null);
  // The last hour still says one day, never zero.
  assert.strictEqual(A.premiumWeekState(row(-7 + 1 / 24), T0).daysLeft, 1);
});

test('the offer opens the moment the week ends and lasts exactly 48 hours', () => {
  const r = row(-7);                               // ended exactly now
  const end = Date.parse(r.ends_at);
  assert.strictEqual(A.premiumWeekState(r, end - 1).offerEnds, null, 'not before the end');
  assert.strictEqual(A.premiumWeekState(r, end).offerEnds, end + 48 * H);
  assert.strictEqual(A.premiumWeekState(r, end + 47.9 * H).offerEnds, end + 48 * H);
  assert.strictEqual(A.premiumWeekState(r, end + 48 * H).offerEnds, null, 'gone at 48 hours');
  assert.strictEqual(A.premiumWeekState(r, end + 1 * H).winback, false);
});

test('win-back is due after 30 days, once, and opens its own 48 hours', () => {
  const r = row(-40);                              // ended 33 days ago
  assert.strictEqual(A.premiumWeekState(r, T0).winbackDue, true);
  assert.strictEqual(A.premiumWeekState(row(-20), T0).winbackDue, false, 'not before 30 days');
  const opened = Object.assign({}, r, { winback_at: new Date(T0 - 2 * H).toISOString() });
  const w = A.premiumWeekState(opened, T0);
  assert.strictEqual(w.winbackDue, false, 'already opened');
  assert.strictEqual(w.winback, true);
  assert.strictEqual(w.offerEnds, T0 - 2 * H + 48 * H);
});

test('the app and the billing function agree on the offer window', () => {
  const billing = readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'billing', 'index.ts'), 'utf8');
  assert.match(billing, /const OFFER_HOURS = 48;/);
  assert.strictEqual(constOf('OFFER_HOURS'), 48);
  const mig = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261127200000_premium_week_and_tastes.sql'), 'utf8');
  assert.match(mig, /interval '30 days'/);
  assert.strictEqual(constOf('WINBACK_AFTER_DAYS'), 30);
  assert.match(mig, /interval '7 days'/);
  assert.strictEqual(constOf('PREMIUM_WEEK_DAYS'), 7);
});

test('countdown reads days and hours, then hours and minutes', () => {
  assert.strictEqual(A.countdownLabel(T0 + 1 * D + 4 * H, T0), '1d 04h');
  assert.strictEqual(A.countdownLabel(T0 + 4 * H + 12 * 6e4, T0), '04h 12m');
  assert.strictEqual(A.countdownLabel(T0 - 5, T0), '00h 00m');
});

test('the recap counts only what happened inside the week', () => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const start = T0 - 7 * D, end = T0;
  const db = {
    log_entries: [
      { date: iso(start + D), source: 'ai_estimate' },
      { date: iso(start + D), source: 'label', fiber_est: true },
      { date: iso(start + 3 * D), source: 'manual' },
      { date: iso(start - 3 * D), source: 'ai_estimate' },   // before the week: not counted
    ],
    training: { logs: [
      { dateISO: iso(start + 2 * D), sets: [{ done: true }] },
      { dateISO: iso(start + 2 * D), sets: [{ done: false }] }, // never trained: not a session
    ] },
    checkins: [{ date: iso(start + 6 * D) }],
  };
  const r = A.premiumWeekRecap(db, start, end);
  // Built inside the app's sandbox, so compared as plain data rather than by prototype.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { meals: 3, ai: 2, fibre: 1, days: 2, sessions: 1, checkins: 1 });
});

test('a free taste reads "free once", then "Premium", and nothing for a subscriber', () => {
  const w = A.window || globalThis;
  const was = { p: w.MISPREMIUM, t: w.MTASTES };
  try {
    w.MISPREMIUM = false; w.MTASTES = [];
    assert.strictEqual(A.tasteLeft('block_review'), true);
    assert.strictEqual(A.tasteSuffix('block_review'), ' · free once');
    w.MTASTES = ['block_review'];
    assert.strictEqual(A.tasteLeft('block_review'), false);
    assert.strictEqual(A.tasteSuffix('block_review'), ' · Premium');
    w.MISPREMIUM = true;
    assert.strictEqual(A.tasteSuffix('block_review'), '');
  } finally { w.MISPREMIUM = was.p; w.MTASTES = was.t; }
});

test('the server tastes the same features the app offers', () => {
  const proxy = readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-proxy', 'index.ts'), 'utf8');
  for (const f of ['block_review', 'weekplan', 'coverage_advice']) assert.ok(proxy.includes("'" + f + "'"), f);
  const mig = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261127200000_premium_week_and_tastes.sql'), 'utf8');
  assert.match(mig, /p_feature not in \('deepdive'\)/);
});

test('Patron auras: one a month, premium-gated, never on the weekly stall', () => {
  const dec = Game.patronItems('2026-12');
  assert.deepStrictEqual(dec.released.map(c => c.id), ['aura_patron']);
  assert.strictEqual(dec.next.id, 'aura_rose');
  const mar = Game.patronItems('2027-03');
  assert.deepStrictEqual(mar.released.map(c => c.id), ['aura_solar', 'aura_tide', 'aura_rose', 'aura_patron'], 'newest first');
  assert.strictEqual(Game.patronItems('2026-11').released.length, 0, 'none before December');
  assert.strictEqual(Game.gateMet('premium', { premium: false }), false);
  assert.strictEqual(Game.gateMet('premium', { premium: true }), true);
  for (let w = 0; w < 30; w++) {
    const stall = Game.weeklyStall('salt', '2027-W' + w, []);
    assert.ok(stall.every(c => c.gate !== 'premium'), 'a Patron aura is never sold for Amber');
  }
  // Every Patron aura has a glow, or it would be an aura that does nothing.
  const glow = SRC.slice(SRC.indexOf('const AURA_GLOW = '), SRC.indexOf('};', SRC.indexOf('const AURA_GLOW = ')));
  for (const c of Game.COSMETICS.filter(c => c.gate === 'premium')) assert.ok(glow.includes(c.id + ':'), c.id);
});

test('the AI meter counts down, turns amber at 3, and offers the free way out', () => {
  const full = render(A.AiAllowance, { used: 0, onUpgrade() {}, onInvite() {} });
  assert.ok(full.has('10 of 10 left'));
  assert.ok(!full.has('Invite a friend'), 'no invite while there are plenty left');
  const low = render(A.AiAllowance, { used: 8, bonus: 5, onUpgrade() {}, onInvite() {} });
  assert.ok(low.has('2 of 10 left + 5 bonus'));
  assert.ok(low.has('Invite a friend for 5 more'));
  assert.ok(low.html.includes('var(--warn)'), 'amber when low');
  const out = render(A.AiAllowance, { used: 12, onUpgrade() {}, onInvite() {} });
  assert.ok(out.has('No free AI logs left'));
  assert.ok(out.has('0 of 10 left'));
});

test('the week recap shows what they did, what changes, and the offer price', () => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const week = A.premiumWeekState({ started_at: new Date(now - 7.1 * D).toISOString(), ends_at: new Date(now - 0.1 * D).toISOString() }, now);
  const db = { log_entries: [{ date: iso(now - 3 * D), source: 'ai_estimate' }], training: { logs: [] }, checkins: [] };
  const r = render(A.PremiumRecapSheet, { week, db, buddy: { hatched: true, stage: 2 }, buddyLabel: 'Chompers', onClose() {}, onKeep() {} });
  assert.ok(r.has('That was your Premium week'));
  assert.ok(r.has('Snapped, scanned or described'));
  assert.ok(r.has('Back to 10 a month'));
  assert.ok(r.has('Keep Premium for £29.99'));
  assert.ok(!r.has(' 0 '), 'no zero rows');
});

test('the shop sells Patron auras to supporters and shows free accounts what they would get', () => {
  const w = A.window || globalThis;
  const was = w.MISPREMIUM;
  const db = { buddy: { hatched: true, stage: 2, species: 'doux', cosmetics: [] }, amber_ledger: [], habitat: [], fight: {}, game_awards: {}, items: {} };
  const props = { db, amber: 0, buy() {}, equip() {}, update() {} };
  try {
    const month = A.Store.todayISO().slice(0, 7);
    if (!Game.patronItems(month).released.length) return;   // before December 2026 there is no shelf yet
    w.MISPREMIUM = false;
    const free = render(A.ShopView, props);
    assert.ok(free.has('Premium · new each month'));
    assert.ok(free.has('Patron Glow'));
    assert.ok(!free.has('Claim'), 'a free account cannot claim');
    w.MISPREMIUM = true;
    const paid = render(A.ShopView, props);
    assert.ok(paid.has('Claim'), 'a supporter claims it, for no Amber');
  } finally { w.MISPREMIUM = was; }
});
