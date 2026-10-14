'use strict';
// Tests for supabase/functions/lifecycle-email/decide.ts: who gets the early "log one meal" nudge
// and the later one-question "what got in the way?", and what they say. Emailing someone who is
// actually using the app, or sending both on one day, is the failure that matters, so the
// "stays quiet" cases come first.
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/lifecycle-email/decide.ts');
const NOW = new Date('2026-10-14T09:07:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const isoAgo = (n) => daysAgo(n).slice(0, 10);
const cand = (o = {}) => Object.assign({
  user_id: 'u1', email: 'a@b.com', created_at: daysAgo(2), has_profile: true,
  buddy_name: null, active_days: 0, last_active: null, has_ticket: false,
}, o);

// ---- Silence ----

test('nobody is emailed on their first day', async () => {
  const { pickVariant, NUDGE, FEEDBACK } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ created_at: daysAgo(0.5) }), NOW), null);
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: daysAgo(0.5) }), NOW), null);
});

test('the two windows never overlap, so one run cannot send both', async () => {
  const { pickVariant, NUDGE, FEEDBACK } = await load();
  for (let d = 0; d <= 30; d++) {
    const c = cand({ created_at: daysAgo(d + 0.1) });
    assert.ok(!(pickVariant(NUDGE, c, NOW) && pickVariant(FEEDBACK, c, NOW)), 'day ' + d);
  }
});

test('the backlog of old sign-ups is never blasted', async () => {
  const { pickVariant, NUDGE, FEEDBACK } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ created_at: daysAgo(40) }), NOW), null);
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: daysAgo(40) }), NOW), null);
});

test('someone who already wrote to support is left alone', async () => {
  const { pickVariant, NUDGE, FEEDBACK } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ has_ticket: true }), NOW), null);
  assert.strictEqual(pickVariant(FEEDBACK, cand({ has_ticket: true, created_at: daysAgo(8) }), NOW), null);
});

test('an engaged user hears nothing', async () => {
  const { pickVariant, NUDGE, FEEDBACK } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ active_days: 1, last_active: isoAgo(0) }), NOW), null);
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: daysAgo(10), active_days: 5, last_active: isoAgo(0) }), NOW), null);
  // Only a couple of days, but still active recently: give them room.
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: daysAgo(10), active_days: 2, last_active: isoAgo(1) }), NOW), null);
});

test('someone who logged once is not nudged to log: they already did', async () => {
  const { pickVariant, NUDGE } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ active_days: 1, last_active: isoAgo(2) }), NOW), null);
});

// ---- Variants ----

test('nudge: never finished setup -> setup, set up but never logged -> never', async () => {
  const { pickVariant, NUDGE } = await load();
  assert.strictEqual(pickVariant(NUDGE, cand({ has_profile: false }), NOW), 'setup');
  assert.strictEqual(pickVariant(NUDGE, cand(), NOW), 'never');
});

test('feedback: setup / never / tried', async () => {
  const { pickVariant, FEEDBACK } = await load();
  const wk = daysAgo(8);
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: wk, has_profile: false }), NOW), 'setup');
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: wk }), NOW), 'never');
  assert.strictEqual(pickVariant(FEEDBACK, cand({ created_at: wk, active_days: 1, last_active: isoAgo(7) }), NOW), 'tried');
});

test('every email has an unsubscribe link, a reply ask, and no em dashes', async () => {
  const { compose, NUDGE, FEEDBACK } = await load();
  const all = [[NUDGE, 'setup'], [NUDGE, 'never'], [FEEDBACK, 'setup'], [FEEDBACK, 'never'], [FEEDBACK, 'tried']];
  for (const [k, v] of all) {
    const m = compose(k, v, 'https://x/unsub');
    assert.ok(m.subject.length > 0);
    assert.ok(m.text.includes('https://x/unsub'), k + v);
    assert.ok(/reply/i.test(m.text), k + v);
    assert.ok(!m.text.includes('—'), k + v);
  }
});

test('feedback emails ask one numbered question', async () => {
  const { compose, FEEDBACK } = await load();
  for (const v of ['setup', 'never', 'tried']) {
    const m = compose(FEEDBACK, v, 'u');
    assert.ok(/reply with a number/i.test(m.text), v);
    assert.ok(/\n1\. /.test(m.text) && /\n3\. /.test(m.text), v);
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

test('the HTML part hyperlinks "Unsubscribe" instead of printing the URL', async () => {
  const { compose, NUDGE, FEEDBACK } = await load();
  const url = 'https://x/fn?unsub=u1&sig=abc';
  for (const [k, v] of [[NUDGE, 'never'], [FEEDBACK, 'tried']]) {
    const m = compose(k, v, url);
    assert.ok(m.html.includes('<a href="https://x/fn?unsub=u1&amp;sig=abc" style="color:#888">Unsubscribe</a>'), k + v);
    assert.ok(!m.html.includes('>https://x/fn'), 'the raw unsubscribe URL is not shown as text');
    assert.ok(m.html.includes('<a href="https://macrosaurus.com'), 'app links are clickable');
    assert.ok(m.text.includes(url), 'plain-text part still carries the URL');
  }
});
