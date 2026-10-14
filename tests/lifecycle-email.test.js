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

// ---- Cancellation ----

const sub = (o = {}) => cand(Object.assign({ created_at: daysAgo(60), active_days: 20, last_active: isoAgo(1),
  sub_status: 'active', sub_plan: 'monthly', sub_cancel_at_period_end: true,
  sub_period_end: daysAgo(-12), sub_updated_at: daysAgo(1) }, o));

test('cancel: a fresh cancellation is asked why, with the right variant', async () => {
  const { pickVariant, CANCEL } = await load();
  assert.strictEqual(pickVariant(CANCEL, sub(), NOW), 'ending');
  assert.strictEqual(pickVariant(CANCEL, sub({ sub_status: 'canceled', sub_cancel_at_period_end: false }), NOW), 'ended');
  // A trial cancelled two days after signing up still counts.
  assert.strictEqual(pickVariant(CANCEL, sub({ created_at: daysAgo(2), sub_status: 'trialing' }), NOW), 'ending');
});

test('cancel: stays quiet for active subs, comps, and old cancellations', async () => {
  const { pickVariant, CANCEL } = await load();
  assert.strictEqual(pickVariant(CANCEL, sub({ sub_cancel_at_period_end: false }), NOW), null);
  assert.strictEqual(pickVariant(CANCEL, sub({ sub_plan: 'comp' }), NOW), null);
  assert.strictEqual(pickVariant(CANCEL, sub({ sub_updated_at: daysAgo(40) }), NOW), null);
  assert.strictEqual(pickVariant(CANCEL, cand({ created_at: daysAgo(60) }), NOW), null);
});

test('cancel: the ending variant names the date Premium runs to', async () => {
  const { compose, CANCEL } = await load();
  const m = compose(CANCEL, 'ending', 'u', { periodEnd: '2026-11-14T10:00:00Z' });
  assert.ok(m.text.includes('You keep Premium until 14 November'));
  assert.ok(!compose(CANCEL, 'ended', 'u', {}).text.includes('You keep Premium'));
  assert.ok(m.text.includes('cancelled your Macrosaurus subscription'), 'its own footer, not the sign-up one');
});

// ---- Win-back ----

const regular = (o = {}) => cand(Object.assign({ created_at: daysAgo(90), active_days: 25, last_active: isoAgo(16), buddy_name: 'Rex' }, o));

test('winback: a regular gone quiet for a couple of weeks is invited back', async () => {
  const { pickVariant, WINBACK } = await load();
  assert.strictEqual(pickVariant(WINBACK, regular(), NOW), 'lapsed');
});

test('winback: silence for the not-regular, the recently quiet, the long gone, and the paused', async () => {
  const { pickVariant, WINBACK } = await load();
  assert.strictEqual(pickVariant(WINBACK, regular({ active_days: 3 }), NOW), null);
  assert.strictEqual(pickVariant(WINBACK, regular({ last_active: isoAgo(5) }), NOW), null);
  assert.strictEqual(pickVariant(WINBACK, regular({ last_active: isoAgo(80) }), NOW), null);
  assert.strictEqual(pickVariant(WINBACK, regular({ paused: true }), NOW), null);
});

test('winback: someone who told us they would be away is left alone', async () => {
  const { pickVariant, WINBACK } = await load();
  assert.strictEqual(pickVariant(WINBACK, regular({ plan_end: isoAgo(2) }), NOW), null);
  // An old holiday from before they went quiet does not count.
  assert.strictEqual(pickVariant(WINBACK, regular({ plan_end: isoAgo(60) }), NOW), 'lapsed');
});

test('winback: never within a fortnight of another lifecycle email', async () => {
  const { pickVariant, WINBACK } = await load();
  assert.strictEqual(pickVariant(WINBACK, regular({ last_email_at: daysAgo(5) }), NOW), null);
  assert.strictEqual(pickVariant(WINBACK, regular({ last_email_at: daysAgo(30) }), NOW), 'lapsed');
});

test('winback: copy uses the dino and the real count of days', async () => {
  const { compose, WINBACK } = await load();
  const m = compose(WINBACK, 'lapsed', 'u', { buddy: 'Rex', activeDays: 23, quietDays: 16 });
  assert.strictEqual(m.subject, 'Rex has been asking after you');
  assert.ok(m.text.includes('You logged 23 days'));
  assert.ok(m.text.includes('a couple of weeks ago'));
  assert.strictEqual(compose(WINBACK, 'lapsed', 'u', {}).subject, "It's been a little while");
});

test('every new email still has the reply ask, unsubscribe, and no em dashes', async () => {
  const { compose, CANCEL, WINBACK } = await load();
  for (const [k, v] of [[CANCEL, 'ending'], [CANCEL, 'ended'], [WINBACK, 'lapsed']]) {
    const m = compose(k, v, 'https://x/unsub', { periodEnd: '2026-11-14T10:00:00Z', buddy: 'Rex', activeDays: 9, quietDays: 20 });
    assert.ok(/reply/i.test(m.text) && m.text.includes('https://x/unsub') && !m.text.includes('—'), k + v);
    assert.ok(m.html.includes('>Unsubscribe</a>'), k + v);
  }
});
