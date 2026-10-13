'use strict';
// The body, shaded by the week, and the calendar of training days.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');
const { app, mount, render, accountWith } = require('./helpers/app.js');

const A = app();

function coverageOf(volume, style) {
  return T.coverage(volume, T.defaultTargets({ style: style || 'minmax' }));
}

test('every muscle the engine counts has a place on the body', () => {
  const cov = coverageOf({});
  const html = render(A.MuscleMap, { coverage: cov }).html;
  for (const m of T.MUSCLES) {
    assert.ok(html.indexOf('aria-label="' + T.MUSCLE_LABEL[m]) !== -1, T.MUSCLE_LABEL[m] + ' is on the map');
  }
});

test('a muscle in its range, short of it and past it are three different colours, and an unprogrammed one is blank', () => {
  const t = T.defaultTargets({ style: 'minmax' });
  const vol = { ch: t.ch.mev, qu: 0, bi: t.bi.mrv + 5 };
  const cov = T.coverage(vol, t);
  const html = render(A.MuscleMap, { coverage: cov }).html;
  const fillOf = (label) => {
    const m = html.match(new RegExp('aria-label="' + label + '[^"]*"[^>]*><rect[^>]*fill="([^"]+)"'));
    return m && m[1];
  };
  assert.strictEqual(fillOf('Chest'), 'var(--good)');
  assert.strictEqual(fillOf('Quads'), 'var(--muted2)');
  assert.strictEqual(fillOf('Biceps'), 'var(--warn)');
  const obl = cov.rows.find(r => r.muscle === 'ob');
  if (!obl.mev) assert.strictEqual(fillOf('Obliques'), 'var(--track)', 'a muscle the style never programmes is not shown as a failure');
});

test('the figure says in words how the week looks, for anyone not looking at it', () => {
  const html = render(A.MuscleMap, { coverage: coverageOf({}) }).html;
  assert.ok(/Muscle map\. \d+ in range, \d+ short, \d+ past recovery\./.test(html));
});

test('tapping a muscle reports it', () => {
  const picked = [];
  const ui = mount(A.MuscleMap, { coverage: coverageOf({}), onPick: (m) => picked.push(m) });
  try {
    const g = Array.from(ui.host.querySelectorAll('g[role="button"]')).find(x => /^Chest/.test(x.getAttribute('aria-label')));
    ui.clickEl(g);
    assert.deepStrictEqual(picked, ['ch']);
  } finally { ui.unmount(); }
});

test('Coverage shows the map above the bars and says what a tapped muscle has', () => {
  const block = T.programmeBlock('mach5', {});
  const db = accountWith(block);
  const ui = mount(A.CoverageScreen, { db, update() {}, isPremium: true, onUpgrade() {}, blockId: block.id, onBack() {} });
  try {
    assert.ok(/Muscle map\./.test(ui.host.innerHTML));
    const g = Array.from(ui.host.querySelectorAll('g[role="button"]')).find(x => /^Side delts/.test(x.getAttribute('aria-label')));
    ui.clickEl(g);
    assert.ok(ui.has('Side delts:'), ui.text.slice(0, 600));
  } finally { ui.unmount(); }
});

// ---- the calendar -------------------------------------------------------------------------------

test('dayTotals counts working sets and tonnage per day, not warm-ups, and drops days with nothing', () => {
  const logs = [
    { dateISO: '2026-10-01', sets: [{ done: true, type: 'work', weightKg: 50, reps: 10 }, { done: true, type: 'warmup', weightKg: 20, reps: 10 }, { done: false, weightKg: 50, reps: 10 }] },
    { dateISO: '2026-10-01', sets: [{ done: true, type: 'work', weightKg: 40, reps: 5, unit: 'pin' }] },
    { dateISO: '2026-10-02', sets: [{ done: false, weightKg: 50, reps: 10 }] },
  ];
  assert.deepStrictEqual(T.dayTotals(logs), { '2026-10-01': { sets: 2, tonnage: 500, sessions: 2 } });
});

test('History opens with a calendar of the last twelve weeks; only trained days are controls, and a tap says what the day was', () => {
  const db = accountWith();
  const today = A.Store.todayISO();
  db.training.logs = [{ id: 'a', dateISO: today, name: 'Push', endedAt: today + 'T10:00:00Z', sets: [{ exerciseId: 'bb_bench', weightKg: 60, reps: 8, done: true, type: 'work' }] }];
  const ui = mount(A.TrainHistory, { db, update() {}, onBack() {}, onOpenExercise() {}, onOpenSession() {}, onTab() {} });
  try {
    assert.ok(ui.has('1 day trained in the last 12 weeks'), ui.text.slice(0, 300));
    const grid = ui.host.querySelector('[aria-label="Training days, last twelve weeks"]');
    assert.strictEqual(grid.children.length, 84);
    const live = grid.querySelectorAll('button');
    assert.strictEqual(live.length, 1, 'one trained day, one control');
    assert.ok(ui.has('Tap a day to jump to it.'));
    ui.clickEl(live[0]);
    assert.ok(ui.has('1 set'), 'the tap shows what that day was: ' + ui.text.slice(0, 400));
  } finally { ui.unmount(); }
});
