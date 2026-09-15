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
  ${constant('CHECKIN_MOVE_MIN_DAYS')}
  ${constant('CHECKIN_MOVE_MAX_DAYS')}
  ${constant('CHECKIN_READ_MIN_DAYS')}
  ${body('cycleStartISO')}
  ${body('readStartISO')}
  ${body('checkinDayMovePending')}
  ${body('checkinReadyOn')}
  ${body('checkinStatus')}
  ${body('checkinWaitLabel')}
  return { checkinStatus, checkinWaitLabel, readStartISO, CHECKIN_MIN_DAYS, CHECKIN_DAY_MIN_DAYS, CHECKIN_MOVE_MIN_DAYS };
`)();
const { checkinStatus, checkinWaitLabel, readStartISO } = sandbox;

// 2026-08-10 is a Monday, so Monday is day 1 and the fixtures read as calendar dates.
const MON = '2026-08-10', TUE = '2026-08-11', WED = '2026-08-12', SUN = '2026-08-09';
const db = (last, day) => ({ last_checkin: last, profile: { checkinDay: day } });
// Shift in UTC, like every other suite here: local midnight + toISOString() lands on the PREVIOUS
// day anywhere east of Greenwich, so in BST this handed the tests a "today" before the check-in.
const shiftDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('a full week is due whatever weekday it lands on', () => {
  const st = checkinStatus(db('2026-08-04', 1), TUE); // Tue -> Tue, 7 days, but Monday is the day
  assert.strictEqual(st.due, true);
  assert.strictEqual(st.daysSince, 7);
});

test('your chosen day is due early, so a short cycle snaps back to it', () => {
  // Checked in a day early last week (Tuesday), and Monday is the day you picked: six days.
  const st = checkinStatus(db('2026-08-04', 1), MON);
  assert.strictEqual(st.due, true, 'the day you picked in Settings arrived with nothing on it');
  assert.strictEqual(st.daysSince, 6);
});

test('the day you picked is always reachable, from every day the cycle can drift to', () => {
  // The bug this constant exists to prevent, stated as the guarantee rather than the number: a
  // cycle that has settled on a Wednesday puts Monday FIVE days out, every week, forever. At a
  // six-day minimum a Monday check-in day was offered Wednesday and only Wednesday, so the setting
  // silently did nothing and looked broken. Every (drifted-to day, chosen day) pair must be able to
  // land on the chosen day within a fortnight, or the setting is a lie on some week of the year.
  for (let from = 0; from <= 6; from++) {
    for (let chosen = 0; chosen <= 6; chosen++) {
      // 2026-08-09 is a Sunday, so `from` indexes straight off it.
      const last = shiftDays('2026-08-09', from);
      let landed = false;
      for (let i = 1; i <= 14 && !landed; i++) {
        const iso = shiftDays(last, i);
        const st = checkinStatus(db(last, chosen), iso);
        if (st.due) landed = new Date(iso + 'T00:00:00').getDay() === chosen;
      }
      assert.ok(landed, 'a cycle landing on day ' + from + ' can never reach chosen day ' + chosen);
    }
  }
});

test('a cycle still cannot be read after only a few days, chosen day or not', () => {
  // The floor under the snap: five days is short but readable, four is not, on any weekday.
  for (let chosen = 0; chosen <= 6; chosen++) {
    for (let gap = 1; gap <= 4; gap++) {
      const st = checkinStatus(db('2026-08-09', chosen), shiftDays('2026-08-09', gap));
      assert.strictEqual(st.due, false, gap + ' days was offered as a check-in on day ' + chosen);
    }
  }
});

test('six days on any OTHER weekday is still too short to read', () => {
  const st = checkinStatus(db('2026-08-05', 1), TUE); // Wed -> Tue is 6 days, Tuesday is not the day
  assert.strictEqual(st.due, false);
  assert.strictEqual(st.daysUntil, 1, 'it becomes due the next day on the full-week clause');
});

test('never sooner than the minimum, even on your day', () => {
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
      const todayISO = shiftDays(last, i);
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

// ---- moving your check-in day ----
// Changing the day in Settings used to be a setting that couldn't take effect. Tuesday -> Friday is
// three days, under the drift floor, so it was never offered; Tuesday -> Wednesday is eight, so the
// full-week clause fired on the Tuesday first, every week, forever. Both left you to move the day
// by hand, by skipping a check-in and hoping. These hold the rule that replaced that: a moved day
// is landed on, in whichever direction it lies.
const moved = (last, day, movedAt) => ({ last_checkin: last, profile: { checkinDay: day, checkinDayMovedAt: movedAt || last } });

test('a day moved FORWARDS shortens the cycle onto it, rather than waiting a week', () => {
  // Checked in Tuesday, moved the day to Friday the same day: three days, under the drift floor.
  const st = checkinStatus(moved(TUE, 5), shiftDays(TUE, 3));
  assert.strictEqual(st.due, true, 'the moved day was not offered, so the setting did nothing');
  assert.strictEqual(new Date(shiftDays(TUE, 3) + 'T00:00:00').getDay(), 5);
});

test('a day moved BACKWARDS stretches the cycle onto it, instead of firing a day early', () => {
  // Checked in Tuesday, moved the day to Wednesday: the full week lands on the Tuesday first, and
  // taking it would re-anchor to Tuesday and move the day no closer - the forever loop.
  const nextTue = shiftDays(TUE, 7), nextWed = shiftDays(TUE, 8);
  assert.strictEqual(checkinStatus(moved(TUE, 3), nextTue).due, false, 'the old day fired first and the move was lost');
  assert.strictEqual(checkinStatus(moved(TUE, 3), nextWed).due, true);
});

test('the move never offers a cycle with no new mornings in it', () => {
  // Two days is the floor, MacroFactor's "check in up to two days early". One is a day, not a cycle.
  for (let chosen = 0; chosen <= 6; chosen++) {
    const st = checkinStatus(moved(TUE, chosen), shiftDays(TUE, 1));
    assert.strictEqual(st.due, false, 'a one-day cycle was offered for chosen day ' + chosen);
  }
  // ...and the same day you moved it is never a check-in either.
  assert.strictEqual(checkinStatus(moved(TUE, 2), TUE).due, false);
});

test('every move lands, from any day to any day, within a week', () => {
  for (let from = 0; from <= 6; from++) {
    for (let chosen = 0; chosen <= 6; chosen++) {
      const last = shiftDays('2026-08-09', from);   // 2026-08-09 is a Sunday
      let landedOn = null;
      for (let i = 1; i <= 14 && !landedOn; i++) {
        const iso = shiftDays(last, i);
        if (checkinStatus(moved(last, chosen), iso).due) landedOn = iso;
      }
      assert.ok(landedOn, 'a move from day ' + from + ' to day ' + chosen + ' never landed');
      assert.strictEqual(new Date(landedOn + 'T00:00:00').getDay(), chosen,
        'the first check-in after a move to day ' + chosen + ' was on some other day');
      const gap = Math.round((new Date(landedOn) - new Date(last)) / 86400000);
      assert.ok(gap >= 2 && gap <= 9, 'a move from day ' + from + ' to day ' + chosen + ' took ' + gap + ' days');
    }
  }
});

test('a move stops steering once it has been honoured', () => {
  // The marker is stamped on the day the setting changed; the check-in that lands on the new day
  // is later than it, so from then on the ordinary rules run again.
  const fri = shiftDays(TUE, 3);
  const after = { last_checkin: fri, profile: { checkinDay: 5, checkinDayMovedAt: TUE } };
  assert.strictEqual(checkinStatus(after, shiftDays(fri, 3)).due, false, 'it kept offering short cycles after the move landed');
  assert.strictEqual(checkinStatus(after, shiftDays(fri, 7)).due, true);
});

test('a chosen day that never arrives cannot hold a check-in open forever', () => {
  // The safety valve: a day set and then forgotten (phone in a drawer) must not mean no check-in.
  // Nothing reaches it in practice - any thirteen-day stretch contains every weekday twice.
  const st = checkinStatus(moved(TUE, 5), shiftDays(TUE, 14));
  assert.strictEqual(st.due, true);
});

// ---- what a short cycle is READ over ----
// The reason a short cycle is safe to offer at all. Somebody whose big days are Friday and Saturday
// carries that water into Sunday and Monday; three days ending on a Friday are the leanest mornings
// of their week, and read on their own they look like a whoosh that never happened.
test('a cycle shorter than a week is read back over a whole week', () => {
  const fri = shiftDays(TUE, 3);
  const rs = readStartISO({ last_checkin: TUE, checkins: [{ date: TUE }], profile: {} }, fri);
  assert.strictEqual(rs, shiftDays(fri, -6), 'a three-day cycle was read over three days');
  assert.strictEqual(Math.round((new Date(fri) - new Date(rs)) / 86400000) + 1, 7);
});

test('an ordinary cycle is read over itself, unchanged', () => {
  // The widening is a floor, not a rewrite: a full week (or a stretched one) reads from its own
  // start, and cycleMeans goes on trimming the long ones back to whole weeks itself.
  const db7 = { last_checkin: '2026-08-04', checkins: [{ date: '2026-08-04' }], profile: {} };
  assert.strictEqual(readStartISO(db7, '2026-08-11'), '2026-08-05');
  assert.strictEqual(readStartISO(db7, '2026-08-18'), '2026-08-05');
});
