'use strict';
// Tests for supabase/functions/lifecycle-email/decide.ts: who gets the one-off "what got in the
// way?" email and what it says. Emailing someone who is actually using the app, or emailing anyone
// twice, is the failure that matters, so the "stays quiet" cases come first.
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/lifecycle-email/decide.ts');
const NOW = new Date('2026-10-14T09:07:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const isoAgo = (n) => daysAgo(n).slice(0, 10);
const cand = (o = {}) => Object.assign({
  user_id: 'u1', email: 'a@b.com', created_at: daysAgo(4), has_profile: true,
  buddy_name: null, active_days: 0, last_active: null, has_ticket: false,
}, o);

// ---- Silence ----

test('too new: nobody is asked before day three', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ created_at: daysAgo(2) }), NOW), null);
});

test('too old: the backlog of old sign-ups is never blasted', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ created_at: daysAgo(40) }), NOW), null);
});

test('someone who already wrote to support is left alone', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ has_ticket: true }), NOW), null);
});

test('an engaged user hears nothing', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ active_days: 5, last_active: isoAgo(0) }), NOW), null);
  // Only a couple of days, but still active recently: give them room.
  assert.strictEqual(pickVariant(cand({ active_days: 2, last_active: isoAgo(1) }), NOW), null);
});

// ---- Variants ----

test('never finished setup -> setup', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ has_profile: false }), NOW), 'setup');
});

test('set up but never logged -> never', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand(), NOW), 'never');
});

test('tried it briefly then went quiet -> tried', async () => {
  const { pickVariant } = await load();
  assert.strictEqual(pickVariant(cand({ created_at: daysAgo(10), active_days: 1, last_active: isoAgo(8) }), NOW), 'tried');
});

test('every variant has an unsubscribe link, a reply ask, and no em dashes', async () => {
  const { compose } = await load();
  for (const v of ['setup', 'never', 'tried']) {
    const m = compose(cand({ buddy_name: 'Rex' }), v, 'https://x/unsub');
    assert.ok(m.subject.length > 0);
    assert.ok(m.text.includes('https://x/unsub'), v);
    assert.ok(/reply/i.test(m.text), v);
    assert.ok(!m.text.includes('—'), v);
  }
});

// ---- Unsubscribe tokens ----

test('unsubscribe token verifies for its user only', async () => {
  const { unsubToken, verifyUnsub } = await load();
  const sig = await unsubToken('s3cret', 'user-a');
  assert.strictEqual(await verifyUnsub('s3cret', 'user-a', sig), true);
  assert.strictEqual(await verifyUnsub('s3cret', 'user-b', sig), false);
  assert.strictEqual(await verifyUnsub('other', 'user-a', sig), false);
  assert.strictEqual(await verifyUnsub('', 'user-a', sig), false);
  assert.strictEqual(await verifyUnsub('s3cret', 'user-a', ''), false);
});
