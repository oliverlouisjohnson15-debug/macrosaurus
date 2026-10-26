'use strict';
/* The admin Retention tab, rendered from the same engagement summaries admin-api sends
   (supabase/functions/admin-api/engagement.ts), so the funnel is checked against real output of that
   module rather than hand-written fixtures that could drift from it. */
const test = require('node:test');
const assert = require('node:assert');
const { app, render } = require('./helpers/app.js');

const A = app();
let E;
test.before(async () => { E = await import('../supabase/functions/admin-api/engagement.ts'); });

const now = Date.now();
const ago = n => new Date(now - n * 86400000).toISOString();
const day = n => ago(n).slice(0, 10);
function user(id, joined, state, extra = {}) {
  const u = { id, email: id + '@x.com', created_at: ago(joined), confirmed: true, hasProfile: !!(state && state.profile), is_admin: false, ...extra };
  u.engagement = E.summarise(state, { created_at: u.created_at, confirmed: u.confirmed }, now);
  return u;
}
const prof = { goalType: 'cut' };
function cohort() {
  return [
    user('ghost', 10, null, { confirmed: false }),
    user('nosetup', 10, { profile: null }),
    user('looker', 10, { profile: prof }),
    user('once', 30, { profile: prof, log_entries: [{ id: 'a', date: day(30) }] }),
    user('regular', 20, { profile: prof, log_entries: [0, 1, 2, 3, 4].map(d => ({ id: 'r' + d, date: day(d) })) }),
    user('boss', 20, { profile: prof, log_entries: [{ id: 'b', date: day(0) }] }, { is_admin: true }),
  ];
}

test('the funnel counts each step and leaves admins out', () => {
  const r = render(A.AdminRetention, { users: cohort(), onOpen: () => {} });
  assert.ok(r.has('Signup funnel'));
  // 5 non-admin signups; 2 ever logged (40%); 1 came back (20%).
  assert.ok(r.has('2 of 5'), 'ever logged is 2 of 5');
  assert.ok(r.has('20%'), 'came back is 20%');
  assert.ok(!r.has('boss@x.com'), 'the admin account is not listed');
});

test('drop-off buckets name the people in them', () => {
  const r = render(A.AdminRetention, { users: cohort(), onOpen: () => {} });
  // Default bucket is "Never logged": the account that set up and stopped.
  assert.ok(r.has('looker@x.com'));
  assert.ok(!r.has('regular@x.com'), 'an active user is not in the never-logged list');
  assert.ok(r.has('Lapsed · 1'), 'the one-day user has lapsed');
  assert.ok(r.has('No setup · 1') && r.has('Unconfirmed · 1'));
});
