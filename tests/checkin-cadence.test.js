'use strict';
// When the next check-in falls, and whether the day you picked in Settings has any effect on it.
// It didn't: three surfaces (Progress, the buddy's ask, the Progress teaser) each inlined their own
// `daysSince >= 7` and none of them read profile.checkinDay, so on a week where the cycle had
// drifted a day early your chosen day arrived with nothing on it and no page said when it would.
// checkinStatus is now the single answer, so this file holds its two clauses in place.
// Read out of the source the way tests/buddy-rest.test.js reads the buddy ladder: these helpers sit
// in app.jsx among the React tree and cannot be required, but they are pure and so are evaluable.
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SRC = readFileSync(path.join(__dirname, '..', 'app', 'src', 'app.jsx'), 'utf8');

function body(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in app.jsx');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  assert.fail('unbalanced braces reading ' + name);
}
function constant(name) {
  const m = SRC.match(new RegExp('^const ' + name + ' = (\\d+);', 'm'));
  assert.ok(m, name + ' not found in app.jsx');
  return 'const ' + name + ' = ' + m[1] + ';';
}

// The DOW_FULL / shiftISO / daysBetween the helpers close over, plus the helpers themselves.
const sandbox = new Function(`
  const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const Store = { isoOf: (d) => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') };
  ${body('shiftISO')}
  ${body('daysBetween')}
  ${constant('CHECKIN_MIN_DAYS')}
  ${constant('CHECKIN_DAY_MIN_DAYS')}
  ${body('checkinReadyOn')}
  ${body('checkinStatus')}
  ${body('checkinWaitLabel')}
  return { checkinStatus, checkinWaitLabel, CHECKIN_MIN_DAYS, CHECKIN_DAY_MIN_DAYS };
`)();
const { checkinStatus, checkinWaitLabel } = sandbox;

// 2026-08-10 is a Monday, so Monday is day 1 and the fixtures read as calendar dates.
const MON = '2026-08-10', TUE = '2026-08-11', WED = '2026-08-12', SUN = '2026-08-09';
const db = (last, day) => ({ last_checkin: last, profile: { checkinDay: day } });

test('a full week is due whatever weekday it lands on', () => {
  const st = checkinStatus(db('2026-08-04', 1), TUE); // Tue -> Tue, 7 days, but Monday is the day
  assert.strictEqual(st.due, true);
  assert.strictEqual(st.daysSince, 7);
});

test('your chosen day is due at six, so a short cycle snaps back to it', () => {
  // Checked in a day early last week (Tuesday), and Monday is the day you picked: six days.
  const st = checkinStatus(db('2026-08-04', 1), MON);
  assert.strictEqual(st.due, true, 'the day you picked in Settings arrived with nothing on it');
  assert.strictEqual(st.daysSince, 6);
});

test('six days on any OTHER weekday is still too short to read', () => {
  const st = checkinStatus(db('2026-08-05', 1), TUE); // Wed -> Tue is 6 days, Tuesday is not the day
  assert.strictEqual(st.due, false);
  assert.strictEqual(st.daysUntil, 1, 'it becomes due the next day on the full-week clause');
});

test('never sooner than six days, even on your day', () => {
  const st = checkinStatus(db(SUN, 1), MON); // one day
  assert.strictEqual(st.due, false);
});

test('a check-in run today is not due again today', () => {
  assert.strictEqual(checkinStatus(db(MON, 1), MON).due, false);
});

test('the first ever check-in is due immediately', () => {
  const st = checkinStatus({ last_checkin: null, profile: {} }, MON);
  assert.strictEqual(st.due, true);
  assert.strictEqual(st.daysSince, 999);
});

test('when it is not due, it always says when it will be', () => {
  // Every day of a fortnight, from a check-in on each weekday, must name a next date within a week.
  for (let day = 0; day <= 6; day++) {
    for (let i = 0; i <= 13; i++) {
      const last = '2026-08-01';
      const todayISO = (() => { const d = new Date(last + 'T00:00:00'); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); })();
      const st = checkinStatus(db(last, day), todayISO);
      if (st.due) continue;
      assert.ok(st.nextISO, 'no next date offered on ' + todayISO + ' (day ' + day + ')');
      assert.ok(st.daysUntil >= 1 && st.daysUntil <= 7, 'next check-in is ' + st.daysUntil + ' days out');
      assert.match(checkinWaitLabel(st), /^(Tomorrow|In \d+ days) · (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/);
    }
  }
});

test('the wait label reads as a sentence, and says nothing when one is due', () => {
  assert.strictEqual(checkinWaitLabel(checkinStatus(db('2026-08-04', 1), MON)), '');
  // Checked in Wed 5th, day picked is Sunday: the full week lands first, on Wed 12th.
  assert.strictEqual(checkinWaitLabel(checkinStatus(db('2026-08-05', 0), MON)), 'In 2 days · Wednesday');
  // Checked in Tue 4th, day picked is Friday: today is day six and not a Friday, so it's tomorrow.
  assert.strictEqual(checkinWaitLabel(checkinStatus(db('2026-08-04', 5), MON)), 'Tomorrow · Tuesday');
});

test('no surface re-inlines the old bare gate', () => {
  // The bug was three copies of the rule. Any new `daysSince >= 7` against last_checkin is a fourth.
  const bare = SRC.match(/daysBetween\(db\.last_checkin[^\n]*\n[^\n]*>=\s*7/g) || [];
  assert.deepStrictEqual(bare, [], 'a check-in gate was inlined again instead of using checkinStatus');
  assert.strictEqual((SRC.match(/checkinStatus\(/g) || []).length >= 4, true,
    'checkinStatus should be the answer on Progress, the buddy ask, the teaser and the setting');
});
