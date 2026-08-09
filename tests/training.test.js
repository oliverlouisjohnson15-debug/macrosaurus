'use strict';
// The training engine. Everything the AI is NOT allowed to decide lives in training.js, so these
// tests are the guarantee that a generated block is actually trainable: that volume adds up the way
// a coach would count it, that gaps are real gaps, and that progression cannot run away with itself.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

// ---- library integrity -------------------------------------------------------------------------

test('every exercise is well formed and attributable', () => {
  const ids = new Set();
  for (const e of T.EXERCISES) {
    assert.ok(e.id && !ids.has(e.id), `duplicate or missing id: ${e.id}`);
    ids.add(e.id);
    assert.ok(e.name && e.name.length > 2, `bad name for ${e.id}`);
    assert.ok(e.primary.length >= 1, `${e.id} has no primary mover, so it would count for nothing`);
    for (const m of e.primary.concat(e.secondary)) {
      assert.ok(T.MUSCLES.includes(m), `${e.id} references unknown muscle "${m}"`);
    }
    // A muscle cannot be both primary and secondary on the same movement, or it double-counts.
    for (const m of e.secondary) assert.ok(!e.primary.includes(m), `${e.id} lists ${m} twice`);
    assert.ok(['len', 'mid', 'sho'].includes(e.profile), `${e.id} bad profile ${e.profile}`);
  }
  assert.ok(T.EXERCISES.length > 150, 'library too small to build real programmes from');
});

test('every muscle has at least three exercises that primarily train it', () => {
  for (const m of T.MUSCLES) {
    const n = T.EXERCISES.filter(e => e.primary.includes(m)).length;
    assert.ok(n >= 3, `${T.MUSCLE_LABEL[m]} only has ${n} primary exercises, gaps could not be filled`);
  }
});

test('every alias points at a real exercise', () => {
  for (const [alias, id] of Object.entries(T.ALIASES)) {
    assert.ok(T.byId(id), `alias "${alias}" points at missing exercise "${id}"`);
  }
});

test('landmarks are ordered mev < mav < mrv for every muscle', () => {
  for (const m of T.MUSCLES) {
    const L = T.LANDMARKS[m];
    assert.ok(L, `no landmarks for ${m}`);
    assert.ok(L.mev < L.mav && L.mav < L.mrv, `${m} landmarks out of order`);
  }
});

// ---- name resolution ---------------------------------------------------------------------------

test('resolves the names people actually type', () => {
  const cases = [
    ['Bench Press', 'bb_bench'], ['bench', 'bb_bench'], ['BB Bench Press', 'bb_bench'],
    ['RDLs', 'rdl'], ['romanian deadlift', 'rdl'], ['Stiff Leg DL', 'stiff_leg_dl'],
    ['Lat Pulldown', 'lat_pulldown'], ['pulldowns', 'lat_pulldown'],
    ['Bulgarian split squats', 'bulgarian'], ['leg extension', 'leg_extension'],
    ['lateral raises', 'db_lateral'], ['face pulls', 'face_pull'],
    ['Seated Cable Row', 'seated_cable_row'], ['hammer curls', 'hammer_curl'],
    ['Rope Pushdown', 'rope_pushdown'], ['hip thrusts', 'hip_thrust'],
    ['squats', 'back_squat'], ['pull ups', 'pullup'], ['chin ups', 'chinup'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(T.resolve(input), expected, `"${input}" resolved to ${T.resolve(input)}`);
  }
});

test('strips the noise a caption or spreadsheet carries around the movement name', () => {
  assert.equal(T.resolve('A1. Barbell Bench Press 4x8-10 @2RIR'), 'bb_bench');
  assert.equal(T.resolve('3) Lat Pulldown - 3 sets 12 reps'), 'lat_pulldown');
  assert.equal(T.resolve('Leg Press 4x12'), 'leg_press');
});

test('refuses to guess when it genuinely does not know', () => {
  // The failure mode that matters: a nonsense line must come back null so the import can flag it,
  // rather than silently logging someone's warm-up note as an exercise.
  assert.equal(T.resolve('vibes and protein shakes'), null);
  assert.equal(T.resolve('xyzzy'), null);
  assert.equal(T.resolve(''), null);
});

// ---- fractional volume -------------------------------------------------------------------------

test('a set counts 1.0 to primary movers and 0.5 to secondary', () => {
  const c = T.setContribution(T.byId('bb_bench'));
  assert.equal(c.ch, 1);
  assert.equal(c.tr, 0.5);
  assert.equal(c.fd, 0.5);
  assert.equal(c.lt, undefined);
});

test('a muscle listed as primary is never downgraded by also being assisted', () => {
  // Chin-ups are primary lats AND primary biceps: both must be full sets.
  const c = T.setContribution(T.byId('chinup'));
  assert.equal(c.lt, 1);
  assert.equal(c.bi, 1);
  assert.equal(c.ub, 0.5);
});

test('cardio contributes nothing to lifting volume', () => {
  assert.deepEqual(T.setContribution(T.byId('cardio_run')), {});
  const vol = T.performedVolume([{ dateISO: '2026-08-01', sets: [{ exerciseId: 'cardio_run', done: true }] }]);
  assert.equal(vol.qu, 0);
});

test('planned volume sums fractional sets across a week', () => {
  const sessions = [
    { exercises: [{ exerciseId: 'bb_bench', target: { sets: 4 } }, { exerciseId: 'rope_pushdown', target: { sets: 3 } }] },
    { exercises: [{ exerciseId: 'db_incline', target: { sets: 3 } }] },
  ];
  const v = T.plannedVolume(sessions);
  assert.equal(v.ch, 4 + 3);              // bench 4 primary + incline 3 primary
  assert.equal(v.tr, 4 * 0.5 + 3 + 3 * 0.5); // bench assist + pushdown primary + incline assist
  assert.equal(v.fd, 4 * 0.5 + 3);        // bench assist + incline primary
});

test('performed volume counts only completed working sets', () => {
  const logs = [{
    dateISO: '2026-08-01',
    sets: [
      { exerciseId: 'bb_bench', done: true, type: 'work' },
      { exerciseId: 'bb_bench', done: true, type: 'warmup' },  // warm-ups do not grow anything
      { exerciseId: 'bb_bench', done: false, type: 'work' },   // an unticked set is an intention
      { exerciseId: 'bb_bench', done: true },                   // missing type defaults to work
    ],
  }];
  assert.equal(T.performedVolume(logs).ch, 2);
});

// ---- coverage ----------------------------------------------------------------------------------

test('bands read against the landmarks', () => {
  const L = { mev: 10, mav: 20, mrv: 25 };
  assert.equal(T.band(0, L), 'none');
  assert.equal(T.band(4, L), 'under');
  assert.equal(T.band(8, L), 'maintaining');
  assert.equal(T.band(15, L), 'productive');
  assert.equal(T.band(22, L), 'high');
  assert.equal(T.band(30, L), 'over');
});

test('coverage finds the real gap in a classic bro split', () => {
  // Chest and arms only. Legs, back and rear delts should all come back as gaps.
  const sessions = [{
    exercises: [
      { exerciseId: 'bb_bench', target: { sets: 4 } },
      { exerciseId: 'db_incline', target: { sets: 4 } },
      { exerciseId: 'cable_fly', target: { sets: 3 } },
      { exerciseId: 'bb_curl', target: { sets: 4 } },
      { exerciseId: 'rope_pushdown', target: { sets: 4 } },
    ],
  }];
  const cov = T.coverage(T.plannedVolume(sessions), T.defaultTargets());
  const gapMuscles = cov.gaps.map(g => g.muscle);
  for (const m of ['qu', 'ha', 'gl', 'lt', 'ub', 'rd', 'ca']) {
    assert.ok(gapMuscles.includes(m), `${T.MUSCLE_LABEL[m]} should be flagged as a gap`);
  }
  assert.ok(!gapMuscles.includes('ch'), 'chest is clearly covered here');
  assert.ok(cov.score < 40, 'a chest-and-arms week should score badly');
});

test('the audit is not fooled into thinking pressing covers side delts', () => {
  // Every press assists the front delt, none of them primarily trains the side delt. This is the
  // single most common real-world programming gap and the audit has to catch it.
  const sessions = [
    { exercises: [{ exerciseId: 'bb_bench', target: { sets: 5 } }, { exerciseId: 'bb_ohp', target: { sets: 5 } }, { exerciseId: 'db_incline', target: { sets: 4 } }] },
    { exercises: [{ exerciseId: 'machine_press', target: { sets: 4 } }, { exerciseId: 'db_ohp', target: { sets: 4 } }] },
  ];
  const cov = T.coverage(T.plannedVolume(sessions), T.defaultTargets());
  const sd = cov.rows.find(r => r.muscle === 'sd');
  const fd = cov.rows.find(r => r.muscle === 'fd');
  assert.ok(sd.sets < sd.mev, 'side delts must read as under-trained');
  assert.ok(fd.sets >= fd.mev, 'front delts are well covered by all that pressing');
});

// ---- suggestions -------------------------------------------------------------------------------

test('gap suggestions respect equipment and dislikes', () => {
  const picks = T.suggestFor('ch', { equipment: ['bodyweight'], dislikes: ['dip_chest'] });
  assert.ok(picks.length > 0);
  for (const p of picks) {
    assert.equal(p.equipment, 'bodyweight');
    assert.notEqual(p.id, 'dip_chest');
    assert.ok(p.primary.includes('ch'));
  }
});

test('suggestions prefer a resistance profile you are not already running', () => {
  // Already doing a lengthened-biased hamstring movement, so the top pick should not be another one.
  const picks = T.suggestFor('ha', { currentExerciseIds: ['rdl', 'seated_leg_curl'] });
  assert.ok(picks.length > 0);
  assert.notEqual(picks[0].profile, 'len', 'should reach for a different curve first');
  assert.ok(!picks.some(p => p.id === 'rdl'), 'must not suggest what is already in the plan');
});

// ---- strength maths ----------------------------------------------------------------------------

test('e1RM is Epley, and refuses to estimate from high-rep sets', () => {
  assert.equal(T.e1rm(100, 1), 100);
  assert.equal(T.e1rm(100, 5), 116.7);
  assert.equal(T.e1rm(100, 13), 0, 'past 12 reps the formulas drift, so we report nothing');
  assert.equal(T.e1rm(0, 5), 0);
});

test('PRs are rebuilt from logs, so an edit cannot leave a phantom record', () => {
  const logs = [
    { dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] },
    { dateISO: '2026-07-08', sets: [{ exerciseId: 'bb_bench', weightKg: 90, reps: 5, done: true }] },
  ];
  assert.equal(T.computePRs(logs).bb_bench.e1rm, 116.7);
  // Correct the first session downward and the PR follows it down.
  logs[0].sets[0].weightKg = 80;
  assert.equal(T.computePRs(logs).bb_bench.e1rm, 105);
});

test('warm-up sets never become PRs', () => {
  const logs = [{ dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 200, reps: 1, done: true, type: 'warmup' }] }];
  assert.equal(T.computePRs(logs).bb_bench, undefined);
});

// ---- progression -------------------------------------------------------------------------------

test('clearing the top of the rep range adds load', () => {
  const p = T.progressExercise(
    { sets: 3, repLow: 8, repHigh: 12, rir: 2 },
    [{ weightKg: 60, reps: 12, rir: 1, done: true }, { weightKg: 60, reps: 12, rir: 1, done: true }, { weightKg: 60, reps: 12, rir: 0, done: true }],
    T.byId('bb_bench'));
  assert.equal(p.action, 'load');
  assert.ok(p.weightKg > 60, 'weight should go up');
});

test('an easy session chases reps, not weight', () => {
  const p = T.progressExercise(
    { sets: 3, repLow: 8, repHigh: 12, rir: 2 },
    [{ weightKg: 60, reps: 9, rir: 4, done: true }, { weightKg: 60, reps: 9, rir: 4, done: true }],
    T.byId('bb_bench'));
  assert.equal(p.action, 'reps');
  assert.equal(p.weightKg, 60);
});

test('grinding to failure holds the weight instead of piling more on', () => {
  const p = T.progressExercise(
    { sets: 3, repLow: 8, repHigh: 12, rir: 2 },
    [{ weightKg: 60, reps: 8, rir: 0, done: true }, { weightKg: 60, reps: 8, rir: 0, done: true }],
    T.byId('bb_bench'));
  assert.equal(p.action, 'hold');
  assert.equal(p.weightKg, 60);
});

test('load steps scale with the lift, not a flat 2.5kg everywhere', () => {
  const legPress = T.loadStep(T.byId('leg_press'), 300);
  const lateral = T.loadStep(T.byId('db_lateral'), 10);
  assert.ok(legPress > lateral, 'a leg press jump should dwarf a lateral raise jump');
  assert.ok(lateral <= 2.5, 'lateral raises must not jump 10kg');
});

test('a stall is detected and the advice is to back off, never to add volume', () => {
  const flat = [{ e1rm: 100 }, { e1rm: 100 }, { e1rm: 99 }];
  const s = T.detectStall(flat);
  assert.ok(s && s.stalled);
  assert.ok(/swap|back/i.test(s.advice));
  assert.equal(T.detectStall([{ e1rm: 100 }, { e1rm: 105 }, { e1rm: 110 }]), null);
  assert.equal(T.detectStall([{ e1rm: 100 }]), null, 'not enough data is not a stall');
});

// ---- block generation --------------------------------------------------------------------------

test('a generated block covers the body it claims to', () => {
  const targets = T.defaultTargets({ experience: 'intermediate' });
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, targets });
  assert.equal(block.weeks, 4);
  assert.equal(T.weekSessions(block, 1).length, 4);
  const cov = T.coverage(T.blockWeekVolume(block, 1), targets);
  // Week 1 sits at MEV by design, so nothing should be below it.
  const belowMev = cov.rows.filter(r => r.sets < r.mev).map(r => r.label);
  assert.deepEqual(belowMev, [], `week 1 leaves these under MEV: ${belowMev.join(', ')}`);
});

test('volume climbs across the build weeks and drops on the deload', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build3-deload1' });
  const total = w => Object.values(T.blockWeekVolume(block, w)).reduce((a, b) => a + b, 0);
  assert.ok(total(2) > total(1), 'week 2 should add volume');
  assert.ok(total(3) > total(2), 'week 3 should add again');
  assert.ok(total(4) < total(1), 'the deload should be lighter than week 1');
  assert.ok(T.weekSessions(block, 4).every(s => s.deload), 'week 4 is the deload');
});

test('RIR walks down through the block', () => {
  // Week 1 leaves about three reps in the tank and that walks down as the block goes on, so the
  // hardest weeks land when you are ready for them rather than in week one.
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const rir = w => T.weekSessions(block, w)[0].exercises[0].target.rir;
  assert.equal(rir(1), 3);
  assert.equal(rir(2), 2);
  assert.equal(rir(3), 1);
  assert.ok(rir(4) <= 1, 'the last building week is the hardest');
});

test('a scheduled deload week backs the effort off', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build3-deload1' });
  const rir = w => T.weekSessions(block, w)[0].exercises[0].target.rir;
  assert.ok(rir(4) >= 3, 'a deload leaves plenty in the tank');
});

test('build4 shape has no deload week', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build4' });
  assert.ok(!T.weekSessions(block, 4).some(s => s.deload));
});

test('no session ever exceeds MRV for a muscle', () => {
  // The engine adding sets each week must not walk a muscle past its ceiling.
  const targets = T.defaultTargets();
  for (const days of [2, 3, 4, 5, 6]) {
    const block = T.generateBlock({ daysPerWeek: days, weeks: 4, targets });
    for (let w = 1; w <= 4; w++) {
      const cov = T.coverage(T.blockWeekVolume(block, w), targets);
      const over = cov.rows.filter(r => r.band === 'over').map(r => `${r.label} ${r.sets}/${r.mrv}`);
      assert.deepEqual(over, [], `${days}-day block week ${w} exceeds MRV: ${over.join(', ')}`);
    }
  }
});

test('a bodyweight-only block is still buildable', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, equipment: ['bodyweight'] });
  const ids = T.weekSessions(block, 1).flatMap(s => s.exercises.map(e => e.exerciseId));
  assert.ok(ids.length > 0, 'should still produce sessions');
  for (const id of ids) assert.equal(T.byId(id).equipment, 'bodyweight', `${id} is not bodyweight`);
});

test('every generated exercise carries a full prescription', () => {
  const block = T.generateBlock({ daysPerWeek: 5, weeks: 4 });
  for (const s of block.sessions) {
    for (const e of s.exercises) {
      assert.ok(T.byId(e.exerciseId), `unknown exercise ${e.exerciseId}`);
      const t = e.target;
      assert.ok(t.sets >= 1 && t.sets <= 8, `silly set count ${t.sets}`);
      assert.ok(t.repLow >= 3 && t.repHigh <= 30 && t.repLow < t.repHigh, `bad rep range ${t.repLow}-${t.repHigh}`);
      assert.ok(t.rir >= 0 && t.rir <= 5, `bad RIR ${t.rir}`);
      assert.ok(t.restSec >= 30, 'rest should be prescribed');
    }
  }
});

test('experience scales the targets a block is built to', () => {
  const beg = T.defaultTargets({ experience: 'beginner' });
  const adv = T.defaultTargets({ experience: 'advanced' });
  assert.ok(beg.ch.mav < adv.ch.mav, 'advanced lifters get a higher productive band');
  assert.ok(beg.ch.mev >= 3, 'MEV never collapses to nothing');
});

// ---- import ------------------------------------------------------------------------------------

test('an imported plan resolves names and keeps its own prescription', () => {
  const parsed = {
    name: 'Some coach PPL',
    days: [
      { name: 'Push', exercises: [
        { name: 'Barbell Bench Press', sets: 4, repLow: 6, repHigh: 8 },
        { name: 'lateral raises', sets: 3, repLow: 12, repHigh: 15 },
      ] },
      { name: 'Pull', exercises: [{ name: 'Lat Pulldown', sets: 4, repLow: 10, repHigh: 12 }] },
    ],
  };
  const { template, unresolved } = T.importTemplate(parsed);
  assert.equal(unresolved.length, 0);
  assert.equal(template.length, 2);
  assert.equal(template[0].exercises[0].exerciseId, 'bb_bench');
  assert.equal(template[0].exercises[0].target.sets, 4);
  assert.equal(template[0].exercises[0].target.repLow, 6);
  assert.equal(template[1].exercises[0].exerciseId, 'lat_pulldown');
});

test('a single rep target is opened into a range so progression has somewhere to go', () => {
  // "4 x 10" is a target, not a range. Left as 10-10 there is no way to add a rep before adding load.
  const { template } = T.importTemplate({ days: [{ name: 'A', exercises: [{ name: 'Leg Press', sets: 4, repLow: 10 }] }] });
  const t = template[0].exercises[0].target;
  assert.ok(t.repHigh > t.repLow, `range collapsed to ${t.repLow}-${t.repHigh}`);
});

test('an unreadable movement is reported, never guessed at or silently dropped', () => {
  const { template, unresolved } = T.importTemplate({
    days: [{ name: 'Day 1', exercises: [
      { name: 'Bench Press', sets: 3 },
      { name: 'the special thing coach showed me', sets: 3 },
    ] }],
  });
  assert.equal(template[0].exercises.length, 1, 'only the movement we understood is kept');
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].name, 'the special thing coach showed me');
  assert.equal(unresolved[0].dayName, 'Day 1');
});

test('a day where nothing resolved does not become an empty session', () => {
  const { template } = T.importTemplate({ days: [{ name: 'Mystery', exercises: [{ name: 'qqqq', sets: 3 }] }] });
  assert.equal(template.length, 0);
});

test('an imported plan gets real periodisation, not four identical weeks', () => {
  const { template } = T.importTemplate({
    days: [
      { name: 'Upper', exercises: [{ name: 'Bench Press', sets: 3 }, { name: 'Lat Pulldown', sets: 3 }, { name: 'lateral raise', sets: 3 }] },
      { name: 'Lower', exercises: [{ name: 'Squat', sets: 3 }, { name: 'RDL', sets: 3 }, { name: 'calf raise', sets: 3 }] },
    ],
  });
  const block = T.blockFromTemplate(template, { weeks: 4, shape: 'build3-deload1', targets: T.defaultTargets(), source: 'import' });
  const total = w => Object.values(T.blockWeekVolume(block, w)).reduce((a, b) => a + b, 0);
  assert.ok(total(3) > total(1), 'an imported plan should still build week on week');
  assert.ok(total(4) < total(1), 'and still deload');
  assert.equal(block.source, 'import');
  assert.equal(T.weekSessions(block, 1)[0].name, 'Upper', 'the coach\'s own day names survive');
});

test('an imported plan is still held under MRV', () => {
  // A caption promising twelve sets of bench three times a week must not import as-is.
  const targets = T.defaultTargets();
  const { template } = T.importTemplate({
    days: [1, 2, 3].map(i => ({ name: 'Chest ' + i, exercises: [{ name: 'Bench Press', sets: 8 }, { name: 'Incline DB Press', sets: 8 }] })),
  });
  const block = T.blockFromTemplate(template, { weeks: 4, targets });
  for (let w = 1; w <= 4; w++) {
    const over = T.coverage(T.blockWeekVolume(block, w), targets).rows.filter(r => r.band === 'over');
    assert.deepEqual(over.map(r => r.label), [], `week ${w} imported over MRV`);
  }
});

test('silly numbers from a bad parse are clamped rather than trusted', () => {
  const { template } = T.importTemplate({
    days: [{ name: 'A', exercises: [{ name: 'Bench Press', sets: 99, repLow: 0, repHigh: 900, rir: 40 }] }],
  });
  const t = template[0].exercises[0].target;
  assert.ok(t.sets <= 8 && t.sets >= 1, `sets ${t.sets}`);
  assert.ok(t.repHigh <= 50, `repHigh ${t.repHigh}`);
  assert.ok(t.rir <= 5, `rir ${t.rir}`);
});

// ---- sharing and adopting ------------------------------------------------------------------------

test('a shared block carries the author\'s week 1, not the built-up weeks', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const tpl = T.templateOf(block);
  assert.equal(tpl.length, 4);
  const wk1 = T.weekSessions(block, 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  assert.equal(tpl[0].name, wk1[0].name, 'day names survive');
  assert.equal(tpl[0].exercises[0].target.sets, wk1[0].exercises[0].target.sets);
  assert.equal(tpl[0].exercises[0].target.rir, wk1[0].exercises[0].target.rir,
    'week 1 RIR, so the receiving block can walk effort down again from the start');
});

test('a template survives a round trip through share and adopt', () => {
  const original = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const { block } = T.adoptTemplate(T.templateOf(original), { weeks: 4, targets: T.defaultTargets() });
  assert.equal(block.daysPerWeek, 4);
  assert.equal(T.weekSessions(block, 1).length, 4);
  assert.equal(T.weekSessions(block, 1)[0].name, T.weekSessions(original, 1)[0].name);
});

test('adopting rescales an advanced block to a beginner rather than handing it over whole', () => {
  // The whole point of sharing a TEMPLATE rather than the built weeks. An advanced author's block
  // must not walk a beginner past what they can recover from.
  const advancedTargets = T.defaultTargets({ experience: 'advanced' });
  const authored = T.generateBlock({ daysPerWeek: 5, weeks: 4, targets: advancedTargets });
  const beginnerTargets = T.defaultTargets({ experience: 'beginner' });
  const { block } = T.adoptTemplate(T.templateOf(authored), { weeks: 4, targets: beginnerTargets });
  for (let w = 1; w <= 4; w++) {
    const over = T.coverage(T.blockWeekVolume(block, w), beginnerTargets).rows.filter(r => r.band === 'over');
    assert.deepEqual(over.map(r => r.label), [], `week ${w} exceeds a beginner's ceiling: ${over.map(r => r.label).join(', ')}`);
  }
});

test('adopting swaps out equipment you do not have, and says what it swapped', () => {
  const authored = T.generateBlock({ daysPerWeek: 3, weeks: 4 });  // full gym
  const { block, swaps } = T.adoptTemplate(T.templateOf(authored), {
    weeks: 4, targets: T.defaultTargets(), equipment: ['bodyweight', 'dumbbell'],
  });
  const ids = T.weekSessions(block, 1).flatMap(s => s.exercises.map(e => e.exerciseId));
  for (const id of ids) {
    assert.ok(['bodyweight', 'dumbbell'].includes(T.byId(id).equipment), `${id} needs kit we said we lack`);
  }
  assert.ok(swaps.length > 0, 'a full-gym block adopted with two bits of kit must report substitutions');
  for (const s of swaps) assert.ok(s.from, 'every swap names what it replaced');
});

test('adopting never silently empties a day', () => {
  const authored = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const { block } = T.adoptTemplate(T.templateOf(authored), { weeks: 4, targets: T.defaultTargets(), equipment: ['bodyweight'] });
  for (const s of block.sessions) assert.ok(s.exercises.length > 0, `${s.name} came out empty`);
});

test('split kind is read off what a day trains, not off its name', () => {
  const ul = T.templateOf(T.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  assert.equal(T.splitKind(ul), 'upper_lower');
  const fb = T.templateOf(T.generateBlock({ daysPerWeek: 3, weeks: 4 }));
  assert.equal(T.splitKind(fb), 'full');
  const ppl = T.templateOf(T.generateBlock({ daysPerWeek: 6, weeks: 4 }));
  assert.equal(T.splitKind(ppl), 'ppl');
  // A day LABELLED "Push" that is actually full body must not make this a PPL split.
  const lying = [{ name: 'Push A', exercises: [
    { exerciseId: 'bb_bench', order: 0, target: { sets: 3 } },
    { exerciseId: 'back_squat', order: 1, target: { sets: 3 } },
  ] }];
  assert.notEqual(T.splitKind(lying), 'ppl');
});

// ---- gyms ------------------------------------------------------------------------------------

test('every gym profile can build a complete block', () => {
  const targets = T.defaultTargets();
  for (const type of ['commercial', 'bodybuilding', 'home', 'minimal']) {
    const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, targets, gym: { type } });
    const cov = T.coverage(T.blockWeekVolume(block, 1), targets);
    const short = cov.rows.filter(r => r.sets < r.mev).map(r => r.label);
    assert.deepEqual(short, [], `${type} leaves these under MEV: ${short.join(', ')}`);
  }
});

test('a home gym with no bench and no bar is never given a bench or bar movement', () => {
  // The fastest way to lose someone's trust is to prescribe an incline dumbbell press to a person
  // who has told you they own no bench.
  const block = T.generateBlock({
    daysPerWeek: 3, weeks: 4, targets: T.defaultTargets(),
    gym: { type: 'home', bench: false, pullupBar: false },
  });
  const ids = block.sessions.flatMap(s => s.exercises.map(e => e.exerciseId));
  for (const id of ids) {
    assert.ok(!T.NEEDS_BENCH.includes(id), `${id} needs a bench`);
    assert.ok(!T.NEEDS_BAR.includes(id), `${id} needs a pull-up bar`);
  }
});

test('a home gym still covers the whole body without a bench or bar', () => {
  const targets = T.defaultTargets();
  const block = T.generateBlock({
    daysPerWeek: 4, weeks: 4, targets, gym: { type: 'home', bench: false, pullupBar: false },
  });
  const cov = T.coverage(T.blockWeekVolume(block, 1), targets);
  const short = cov.rows.filter(r => r.sets < r.mev).map(r => r.label);
  assert.deepEqual(short, [], `left short: ${short.join(', ')}`);
});

test('a commercial gym reaches for machines and cables more than a home gym does', () => {
  const targets = T.defaultTargets();
  const share = (gym) => {
    const ids = T.weekSessions(T.generateBlock({ daysPerWeek: 5, weeks: 4, targets, gym }), 1)
      .flatMap(s => s.exercises.map(e => e.exerciseId));
    const n = ids.filter(id => ['machine', 'cable'].includes(T.byId(id).equipment)).length;
    return n / ids.length;
  };
  assert.ok(share({ type: 'commercial' }) > share({ type: 'home' }),
    'the gym profile should change what gets picked, not just what is allowed');
});

test('light kit shifts the rep ranges up rather than pretending the load is there', () => {
  const targets = T.defaultTargets();
  const topRep = (gym) => {
    const e = T.weekSessions(T.generateBlock({ daysPerWeek: 3, weeks: 4, targets, gym }), 1)[0].exercises[0];
    return e.target.repHigh;
  };
  assert.ok(topRep({ type: 'minimal' }) > topRep({ type: 'commercial' }));
});

test('gymEquipment resolves a profile into what the builder consumes', () => {
  const full = T.gymEquipment({ type: 'commercial' });
  assert.ok(full.equipment.includes('machine'));
  assert.deepEqual(full.excluded, []);
  const bare = T.gymEquipment({ type: 'home', bench: false, pullupBar: false });
  assert.ok(!bare.equipment.includes('machine'));
  assert.ok(bare.excluded.includes('pullup'));
  assert.ok(bare.excluded.includes('db_incline'));
});

test('adopting a shared block respects the gym you are standing in', () => {
  const authored = T.generateBlock({ daysPerWeek: 4, weeks: 4, targets: T.defaultTargets() });
  const { block } = T.adoptTemplate(T.templateOf(authored), {
    weeks: 4, targets: T.defaultTargets(), gym: { type: 'minimal' },
  });
  const ids = block.sessions.flatMap(s => s.exercises.map(e => e.exerciseId));
  for (const id of ids) {
    assert.ok(['dumbbell', 'bodyweight', 'band'].includes(T.byId(id).equipment), `${id} is not minimal-gym kit`);
  }
});

// ---- saying why ------------------------------------------------------------------------------

test('every exercise can explain itself without an AI call', () => {
  for (const e of T.EXERCISES) {
    const why = T.whyFor(e);
    assert.ok(why && why.length > 20, `${e.id} has no usable explanation`);
    assert.ok(why.includes('full set'), `${e.id} does not say what it trains`);
  }
});

test('the explanation reflects fractional counting, so it matches the audit', () => {
  const why = T.whyFor(T.byId('bb_bench'));
  assert.ok(/full set to Chest/i.test(why));
  assert.ok(/Half a set each to Front delts and Triceps/i.test(why));
  // A movement with no assistance must not claim any.
  assert.ok(!/Half a set/i.test(T.whyFor(T.byId('leg_extension'))));
});

test('cues exist for the movements people get wrong, and point at real cues', () => {
  const cued = T.EXERCISES.filter(e => T.cueFor(e));
  assert.ok(cued.length >= 25, `only ${cued.length} movements carry a cue`);
  for (const e of cued) assert.ok(T.cueFor(e).length > 20, `${e.id} cue is too thin to help`);
  assert.equal(T.cueFor(T.byId('cardio_run')), null);
});

// ---- emphasis --------------------------------------------------------------------------------

test('emphasis is a trade, not a free upgrade', () => {
  const base = T.defaultTargets();
  const emph = T.emphasise(base, ['sd', 'rd']);
  assert.ok(emph.sd.mev > base.sd.mev, 'the named muscle starts higher');
  assert.ok(emph.rd.mev > base.rd.mev);
  assert.ok(emph.qu.mev < base.qu.mev, 'everything else drops back to pay for it');
  for (const m of T.MUSCLES) {
    assert.ok(emph[m].mev >= 3, `${m} floor collapsed to ${emph[m].mev}`);
    assert.ok(emph[m].mev < emph[m].mrv, `${m} floor ended up at or above its ceiling`);
  }
});

test('a block built with emphasis actually trains that muscle more', () => {
  const targets = T.defaultTargets();
  const plain = T.generateBlock({ daysPerWeek: 4, weeks: 4, targets });
  const shoulders = T.generateBlock({ daysPerWeek: 4, weeks: 4, targets, emphasis: ['sd'] });
  const sd = b => T.blockWeekVolume(b, 1).sd;
  assert.ok(sd(shoulders) > sd(plain), `emphasis gave ${sd(shoulders)} vs ${sd(plain)}`);
});

test('emphasis still cannot break the ceiling', () => {
  const targets = T.defaultTargets();
  const block = T.generateBlock({ daysPerWeek: 5, weeks: 4, targets, emphasis: ['sd', 'ch', 'bi'] });
  for (let w = 1; w <= 4; w++) {
    const over = T.coverage(T.blockWeekVolume(block, w), targets).rows.filter(r => r.band === 'over');
    assert.deepEqual(over.map(r => r.label), [], `week ${w} over MRV`);
  }
});

// ---- review and tuning -------------------------------------------------------------------------

const sampleBlock = () => T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });

test('a block review reports progress, adherence and coverage', () => {
  const block = sampleBlock();
  const logs = [];
  T.weekSessions(block, 1).concat(T.weekSessions(block, 2)).forEach((s, i) => {
    logs.push({
      id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-0' + (i + 1),
      sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, () => ({
        exerciseId: e.exerciseId, weightKg: 50 + i * 5, reps: 10, rir: 2, done: true, type: 'work',
      }))),
    });
  });
  const review = T.reviewBlock(block, logs, T.defaultTargets());
  assert.equal(review.sessionsLogged, 6);
  assert.ok(review.tonnage > 0);
  assert.ok(review.improved.length > 0, 'weights went up, so lifts should show improvement');
  assert.ok(review.completion.total === block.sessions.length);
  assert.ok(review.adherence > 0 && review.adherence < 100, 'half the block was logged');
});

test('tuning ignores a block nobody actually ran', () => {
  const targets = T.defaultTargets();
  const tuned = T.tuneTargets(targets, { adherence: 20, coverage: { rows: [] }, stalled: [] });
  assert.deepEqual(tuned, targets, 'a 20% adherence block teaches us nothing');
});

test('tuning raises the band when high volume worked and cuts it when lifts stalled', () => {
  const targets = T.defaultTargets();
  const grew = T.tuneTargets(targets, {
    adherence: 95, stalled: [],
    coverage: { rows: [{ muscle: 'ch', band: 'high' }] },
  });
  assert.ok(grew.ch.mav > targets.ch.mav, 'tolerated high volume, so the band moves up');

  const stalled = T.tuneTargets(targets, {
    adherence: 95,
    stalled: [{ exerciseId: 'bb_bench' }],
    coverage: { rows: [{ muscle: 'ch', band: 'high' }] },
  });
  assert.ok(stalled.ch.mav < targets.ch.mav, 'stalling at high volume should pull the band DOWN, not up');
});

test('tuning never inverts the landmarks', () => {
  let targets = T.defaultTargets();
  for (let i = 0; i < 10; i++) {
    targets = T.tuneTargets(targets, {
      adherence: 95, stalled: [{ exerciseId: 'bb_bench' }],
      coverage: { rows: T.MUSCLES.map(m => ({ muscle: m, band: 'over' })) },
    });
  }
  for (const m of T.MUSCLES) {
    assert.ok(targets[m].mev < targets[m].mav, `${m} mev/mav inverted after repeated tuning`);
    assert.ok(targets[m].mav < targets[m].mrv, `${m} mav/mrv inverted after repeated tuning`);
  }
});

// ---- session helpers ---------------------------------------------------------------------------

test('a session pre-fills from last time and explains the change', () => {
  const sessionExercise = { exerciseId: 'bb_bench', target: { sets: 3, repLow: 8, repHigh: 12, rir: 2 } };
  const logs = [{
    dateISO: '2026-08-01',
    sets: [
      { exerciseId: 'bb_bench', weightKg: 80, reps: 12, rir: 1, done: true, type: 'work' },
      { exerciseId: 'bb_bench', weightKg: 80, reps: 12, rir: 1, done: true, type: 'work' },
      { exerciseId: 'bb_bench', weightKg: 80, reps: 12, rir: 0, done: true, type: 'work' },
    ],
  }];
  const pre = T.prefillSets(sessionExercise, logs);
  assert.equal(pre.action, 'load');
  // The weight box opens EMPTY. Prescribing a load computed from last Tuesday is a guess dressed up
  // as an instruction: it knows nothing about how you slept or which bar is free. We prescribe the
  // effort and let the person pick the weight that hits it.
  assert.equal(pre.sets[0].weightKg, 0, 'no weight is typed in on your behalf');
  assert.ok(pre.suggested > 80, 'but the engine still knows what it would go for, as a note');
  assert.ok(/left in the tank|reps left|reps short/i.test(pre.note), `the advice should be about effort, not load: "${pre.note}"`);
  assert.equal(pre.sets[0].lastTime.reps, 12, 'and last time is there as the reference');
  assert.equal(pre.sets[0].lastTime.weightKg, 80);
  assert.equal(pre.sets[0].done, false, 'nothing is pre-ticked');
});

test('every progression message talks about effort rather than only a number', () => {
  const ex = T.byId('bb_bench');
  const target = { sets: 3, repLow: 8, repHigh: 12, rir: 2 };
  const cases = [
    [{ weightKg: 60, reps: 12, rir: 1 }, 'load'],
    [{ weightKg: 60, reps: 9, rir: 4 }, 'reps'],
    [{ weightKg: 60, reps: 8, rir: 0 }, 'hold'],
  ];
  for (const [set, expected] of cases) {
    const p = T.progressExercise(target, [Object.assign({ done: true }, set), Object.assign({ done: true }, set)], ex);
    assert.equal(p.action, expected);
    assert.ok(/tank|reps left|reps short|closer|control/i.test(p.reason), `"${p.reason}" does not mention effort`);
  }
});

test('a first-ever session has nothing to reference and says so', () => {
  const pre = T.prefillSets({ exerciseId: 'bb_bench', target: { sets: 3, repLow: 8, repHigh: 12 } }, []);
  assert.equal(pre.sets.length, 3);
  assert.equal(pre.sets[0].weightKg, 0);
  assert.equal(pre.sets[0].lastTime, null);
  assert.equal(pre.suggested, null, 'nothing to suggest from');
});

test('block progress locates the current week from the start date', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, startISO: '2026-08-03' });
  assert.equal(T.blockProgress(block, '2026-08-03').week, 1);
  assert.equal(T.blockProgress(block, '2026-08-11').week, 2);
  assert.equal(T.blockProgress(block, '2026-08-25').week, 4);
  assert.ok(T.blockProgress(block, '2026-09-10').done, 'past the end the block is done');
  assert.ok(T.blockProgress(block, '2026-08-01').notStarted);
});

test('training days feed the carb-cycling high days', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const days = T.trainingDaysOfWeek(block);
  assert.equal(days.length, 4);
  assert.deepEqual(days, [...days].sort((a, b) => a - b), 'returned in weekday order');
});

// ---- loading the bar ---------------------------------------------------------------------------

test('plate maths loads the bar correctly', () => {
  const r = T.plateBreakdown(100, { units: 'kg' });
  assert.ok(r.ok);
  // 100 - 20kg bar = 80, so 40 a side: 25 + 15.
  assert.deepEqual(r.perSide, [{ plate: 25, count: 1 }, { plate: 15, count: 1 }]);
});

test('plate maths handles the fractional plates without a floating point ghost', () => {
  // 63.75 is bar + 21.875 a side = 20 + 1.25 + ... the classic case where naive subtraction
  // leaves 0.0000001 behind and the caller reports an impossible weight.
  const r = T.plateBreakdown(65, { units: 'kg' });
  assert.ok(r.ok, `left over ${r.leftover}`);
  assert.equal(r.achievable, 65);
});

test('plate maths says so when a weight cannot be made', () => {
  const r = T.plateBreakdown(21, { units: 'kg', plates: [25, 20, 15, 10, 5] });
  assert.equal(r.ok, false, 'no plate pair makes 21kg');
  assert.equal(r.achievable, 20, 'and it says what you CAN make');
});

test('a weight below the empty bar is reported, not silently loaded', () => {
  const r = T.plateBreakdown(15, { units: 'kg' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'under_bar');
});

test('only bar movements get a plate calculator', () => {
  assert.ok(T.usesBar(T.byId('bb_bench')));
  assert.ok(T.usesBar(T.byId('ez_curl')));
  assert.ok(!T.usesBar(T.byId('db_bench')));
  assert.ok(!T.usesBar(T.byId('lat_pulldown')));
});

// ---- warm-ups ----------------------------------------------------------------------------------

test('a compound gets a real ramp, ascending, finishing under the working weight', () => {
  const sets = T.warmupSets(100, T.byId('bb_bench'));
  assert.ok(sets.length >= 3, `only ${sets.length} warm-up sets`);
  for (let i = 1; i < sets.length; i++) assert.ok(sets[i].weightKg > sets[i - 1].weightKg, 'ramp must ascend');
  assert.ok(sets[sets.length - 1].weightKg < 100, 'the last warm-up is not the working set');
  assert.ok(sets[0].reps > sets[sets.length - 1].reps, 'reps come down as the weight goes up');
});

test('isolation work gets one easy set at most, not a ramp', () => {
  assert.ok(T.warmupSets(30, T.byId('db_lateral')).length <= 1);
  assert.equal(T.warmupSets(8, T.byId('db_lateral')).length, 0, 'nothing needs warming up for an 8kg lateral raise');
});

test('a warm-up ramp never prescribes less than an empty bar', () => {
  const sets = T.warmupSets(40, T.byId('bb_bench'));
  for (const s of sets) assert.ok(s.weightKg >= 20, `${s.weightKg}kg is less than the bar`);
});

test('warm-ups do not repeat the same weight twice', () => {
  for (const w of [30, 45, 60, 100, 200]) {
    const sets = T.warmupSets(w, T.byId('back_squat'));
    const weights = sets.map(s => s.weightKg);
    assert.equal(new Set(weights).size, weights.length, `${w}kg produced a duplicate rung: ${weights.join(', ')}`);
  }
});

// ---- tempo and coach notation ------------------------------------------------------------------

test('every generated exercise carries a tempo', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  for (const s of block.sessions) {
    for (const e of s.exercises) {
      assert.ok(/^[0-9X]{4}$/i.test(e.target.tempo), `${e.exerciseId} has tempo "${e.target.tempo}"`);
    }
  }
});

test('stretch-biased movements get a slower lowering than the rest', () => {
  assert.equal(T.defaultTempo(T.byId('rdl'))[0], '3', 'RDL is lengthened-biased, so it lowers slowly');
  assert.equal(T.defaultTempo(T.byId('leg_extension'))[0], '2');
});

test('tempo reads back as a sentence, and nonsense is rejected', () => {
  const p = T.tempoParts('3110');
  assert.ok(/3 seconds down/.test(p.text));
  assert.ok(/1 at the stretch/.test(p.text));
  assert.equal(T.tempoParts('nope'), null);
  assert.ok(/fast/.test(T.tempoParts('20X0').text));
});

test('an imported tempo survives, and a rubbish one falls back to the default', () => {
  const { template } = T.importTemplate({ days: [{ name: 'A', exercises: [
    { name: 'Bench Press', sets: 3, tempo: '3110' },
    { name: 'Lat Pulldown', sets: 3, tempo: 'banana' },
  ] }] });
  assert.equal(template[0].exercises[0].target.tempo, '3110');
  assert.ok(/^[0-9X]{4}$/.test(template[0].exercises[1].target.tempo));
});

test('session codes read like a coach wrote them', () => {
  // Plain list: A1, B1, C1.
  assert.deepEqual(T.sessionCodes([{}, {}, {}]), ['A1', 'B1', 'C1']);
  // A superset pair shares its letter and numbers within it.
  assert.deepEqual(
    T.sessionCodes([{ superset: 'g1' }, { superset: 'g1' }, {}]),
    ['A1', 'A2', 'B1']);
  // Two separate supersets get separate letters.
  assert.deepEqual(
    T.sessionCodes([{ superset: 'g1' }, { superset: 'g1' }, { superset: 'g2' }, { superset: 'g2' }]),
    ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(T.sessionCodes([]), []);
});

test('tempo survives being shared and adopted', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4 });
  const tpl = T.templateOf(block);
  assert.ok(/^[0-9X]{4}$/i.test(tpl[0].exercises[0].target.tempo));
  const { block: adopted } = T.adoptTemplate(tpl, { weeks: 4, targets: T.defaultTargets() });
  assert.ok(/^[0-9X]{4}$/i.test(T.weekSessions(adopted, 1)[0].exercises[0].target.tempo));
});

// ---- personal records --------------------------------------------------------------------------

test('a first-ever set is not a record', () => {
  // Everything is a "best" when there is nothing to beat. Celebrating that is meaningless and it
  // would fire on every movement of someone's first session.
  assert.equal(T.prKind(100, 5, T.bestBefore([], 'bb_bench', '2026-08-01')), null);
});

test('a heavier lift than ever before is a weight record', () => {
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }];
  const best = T.bestBefore(logs, 'bb_bench', '2026-08-01');
  const pr = T.prKind(105, 3, best);
  assert.equal(pr.kind, 'weight');
  assert.ok(/heaviest/i.test(pr.label));
});

test('more reps at the same weight is its own record', () => {
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }];
  const pr = T.prKind(100, 7, T.bestBefore(logs, 'bb_bench', '2026-08-01'));
  assert.equal(pr.kind, 'reps');
  assert.ok(/most reps/i.test(pr.label));
});

test('a better estimated 1RM counts even when the bar was lighter', () => {
  // 100x5 gives ~116.7. 95x8 gives ~120.3: lighter bar, better set.
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }];
  const pr = T.prKind(95, 8, T.bestBefore(logs, 'bb_bench', '2026-08-01'));
  assert.equal(pr.kind, 'e1rm');
});

test('repeating exactly what you did last time is not a record', () => {
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }];
  assert.equal(T.prKind(100, 5, T.bestBefore(logs, 'bb_bench', '2026-08-01')), null);
  // And a hair under must not squeak through on floating point.
  assert.equal(T.prKind(100, 5, T.bestBefore(logs, 'bb_bench', '2026-08-01')), null);
});

test('the session being logged is excluded from its own history', () => {
  // Without this a set can never be a record, because it is already in the list it is compared to.
  const log = { id: 'today', dateISO: '2026-08-01', sets: [{ exerciseId: 'bb_bench', weightKg: 120, reps: 5, done: true }] };
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }, log];
  const best = T.bestBefore(logs, 'bb_bench', log.dateISO, log.id);
  assert.equal(best.weightKg, 100);
  assert.ok(T.prKind(120, 5, best));
});

test('five identical sets report one record, not five', () => {
  const log = {
    id: 'today', dateISO: '2026-08-01',
    sets: Array.from({ length: 5 }, () => ({ exerciseId: 'bb_bench', weightKg: 110, reps: 5, done: true, type: 'work' })),
  };
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }, log];
  const prs = T.prsInLog(logs, log);
  assert.equal(prs.length, 1, `reported ${prs.length} records for the same weight five times`);
  assert.equal(prs[0].setIndex, 0, 'and it is the first set that earned it');
});

test('warm-ups and unticked sets can never be records', () => {
  const log = {
    id: 'today', dateISO: '2026-08-01',
    sets: [
      { exerciseId: 'bb_bench', weightKg: 500, reps: 1, done: true, type: 'warmup' },
      { exerciseId: 'bb_bench', weightKg: 500, reps: 1, done: false, type: 'work' },
    ],
  };
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true }] }, log];
  assert.deepEqual(T.prsInLog(logs, log), []);
});

test('records are found across several movements in one session', () => {
  const log = {
    id: 'today', dateISO: '2026-08-01',
    sets: [
      { exerciseId: 'bb_bench', weightKg: 110, reps: 5, done: true, type: 'work' },
      { exerciseId: 'back_squat', weightKg: 150, reps: 5, done: true, type: 'work' },
    ],
  };
  const logs = [{
    id: 'a', dateISO: '2026-07-01', sets: [
      { exerciseId: 'bb_bench', weightKg: 100, reps: 5, done: true },
      { exerciseId: 'back_squat', weightKg: 140, reps: 5, done: true },
    ],
  }, log];
  const prs = T.prsInLog(logs, log);
  assert.equal(prs.length, 2);
  assert.deepEqual(prs.map(p => p.exerciseId).sort(), ['back_squat', 'bb_bench']);
});

// ---- the character sheet -----------------------------------------------------------------------

const liftLog = (dateISO, sets) => ({ id: 'l' + dateISO, dateISO, sets: sets.map(([exerciseId, weightKg, reps]) => ({ exerciseId, weightKg, reps, done: true, type: 'work' })) });

test('an empty log gives an empty character sheet, not a broken one', () => {
  const s = T.statSheet([], { bodyweightKg: 80 });
  assert.equal(s.str, 0);
  assert.equal(s.pow, 0);
  assert.equal(s.overall, 0);
});

test('every stat stays between 0 and 100 however silly the input', () => {
  const s = T.statSheet([liftLog('2026-08-01', [['back_squat', 500, 5], ['deadlift', 600, 5], ['bb_bench', 400, 5], ['pullup', 200, 5]])], { bodyweightKg: 60 });
  for (const k of ['str', 'pow', 'end', 'bal', 'overall']) {
    assert.ok(s[k] >= 0 && s[k] <= 100, `${k} came out at ${s[k]}`);
  }
});

test('strength is relative to bodyweight, so the same bar means more on a lighter lifter', () => {
  const log = [liftLog('2026-08-01', [['back_squat', 140, 5]])];
  const light = T.statSheet(log, { bodyweightKg: 60 });
  const heavy = T.statSheet(log, { bodyweightKg: 110 });
  assert.ok(light.str > heavy.str, 'a 140kg squat is a bigger deal at 60kg bodyweight');
});

test('missing a whole movement pattern costs you strength rather than being ignored', () => {
  const squatOnly = T.statSheet([liftLog('2026-08-01', [['back_squat', 150, 5]])], { bodyweightKg: 80 });
  const rounded = T.statSheet([liftLog('2026-08-01', [
    ['back_squat', 150, 5], ['deadlift', 180, 5], ['bb_bench', 110, 5], ['pullup', 90, 5],
  ])], { bodyweightKg: 80 });
  assert.ok(rounded.str > squatOnly.str, 'not squatting IS part of the answer to "how strong are you"');
});

test('balance punishes a chest-and-arms week and rewards a spread one', () => {
  // Four sets of each, so both weeks carry real volume and the only difference is the spread.
  const four = pairs => liftLog('2026-08-01', pairs.flatMap(p => [p, p, p, p]));
  const narrow = T.statSheet([four([['bb_bench', 100, 8], ['db_incline', 30, 10], ['bb_curl', 40, 10]])], { bodyweightKg: 80 });
  const spread = T.statSheet([four([
    ['bb_bench', 100, 8], ['back_squat', 120, 8], ['lat_pulldown', 70, 10], ['rdl', 100, 10],
    ['db_lateral', 12, 15], ['face_pull', 20, 15], ['standing_calf', 60, 12], ['cable_crunch', 40, 15],
  ])], { bodyweightKg: 80 });
  assert.ok(spread.bal > narrow.bal, `spread ${spread.bal} should beat narrow ${narrow.bal}`);
});

test('balance moves for someone training everything a little, rather than sitting at zero', () => {
  // The flaw the band-counting version had: a beginner covering the whole body at low volume scored
  // exactly zero, so the one stat they could actually raise looked broken.
  const light = T.statSheet([liftLog('2026-08-01', [
    ['bb_bench', 40, 10], ['back_squat', 50, 10], ['lat_pulldown', 40, 10], ['rdl', 40, 10],
    ['db_lateral', 6, 15], ['standing_calf', 30, 15], ['cable_crunch', 20, 15],
  ])], { bodyweightKg: 80 });
  assert.ok(light.bal > 0, 'covering the body at low volume must not read as zero');
  assert.ok(light.bal < 70, 'but it should not read as well balanced either');
});

test('overall is the average, so one huge stat cannot carry the sheet', () => {
  const s = T.statSheet([liftLog('2026-08-01', [['deadlift', 250, 1]])], { bodyweightKg: 80 });
  assert.ok(s.pow > s.overall, 'a big single lifts power but not the whole dinosaur');
  assert.ok(s.overall < 60);
});

test('warm-ups never count toward the character sheet', () => {
  const withWarmup = {
    id: 'w', dateISO: '2026-08-01',
    sets: [{ exerciseId: 'back_squat', weightKg: 300, reps: 5, done: true, type: 'warmup' }],
  };
  assert.equal(T.statSheet([withWarmup], { bodyweightKg: 80 }).str, 0);
});

test('working up to a heavy top set reports one record, not one per rung', () => {
  // 95, 110, 125 each beat the old best of 62.5. Nobody says "I set three bench records today".
  const log = {
    id: 'today', dateISO: '2026-08-01',
    sets: [95, 110, 125].map(w => ({ exerciseId: 'bb_bench', weightKg: w, reps: 10, done: true, type: 'work' })),
  };
  const logs = [{ id: 'a', dateISO: '2026-07-01', sets: [{ exerciseId: 'bb_bench', weightKg: 62.5, reps: 10, done: true }] }, log];
  const prs = T.prsInLog(logs, log);
  assert.equal(prs.length, 1, `reported ${prs.length}`);
  assert.equal(prs[0].value, 125, 'and it is the heaviest one that counts');
});

test('one record each is still reported for two different movements', () => {
  const log = {
    id: 'today', dateISO: '2026-08-01',
    sets: [
      { exerciseId: 'bb_bench', weightKg: 95, reps: 10, done: true, type: 'work' },
      { exerciseId: 'bb_bench', weightKg: 110, reps: 10, done: true, type: 'work' },
      { exerciseId: 'back_squat', weightKg: 160, reps: 5, done: true, type: 'work' },
    ],
  };
  const logs = [{
    id: 'a', dateISO: '2026-07-01', sets: [
      { exerciseId: 'bb_bench', weightKg: 62.5, reps: 10, done: true },
      { exerciseId: 'back_squat', weightKg: 140, reps: 5, done: true },
    ],
  }, log];
  assert.equal(T.prsInLog(logs, log).length, 2);
});

// ---- deloads, taken when earned ------------------------------------------------------------------

test('the default block is four building weeks, not three and a light one', () => {
  // The survey evidence puts deloads at roughly every 4 to 8 weeks and describes them as preplanned
  // OR autoregulated. Baking one into every fourth week sits at the frequent end of that range and
  // spends a productive week whether or not anything has accumulated.
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  assert.equal(block.shape, 'build4');
  assert.ok(!block.sessions.some(s => s.deload), 'no deload week by default');
});

test('the fixed three-and-a-light rhythm is still available for anyone who wants it', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build3-deload1' });
  assert.ok(T.weekSessions(block, 4).every(s => s.deload));
});

test('a clean block gets no deload recommendation', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });
  // Every session done, weights climbing, effort steady.
  const logs = block.sessions.map((s, i) => ({
    id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(6 + i).padStart(2, '0'),
    sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, () => ({
      exerciseId: e.exerciseId, weightKg: 50 + i * 2.5, reps: 10, rir: 2, done: true, type: 'work',
    }))),
  }));
  const a = T.deloadAdvice(block, logs, T.defaultTargets(), {});
  assert.equal(a.needed, false, `recommended a deload for: ${a.reasons.map(r => r.text).join(' ')}`);
  assert.ok(/start the next block/i.test(a.advice));
});

test('stalled lifts plus a deficit earn a deload', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });
  // Same weights every session, so the lifts have plainly stopped moving.
  const logs = block.sessions.map((s, i) => ({
    id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(6 + i).padStart(2, '0'),
    sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, () => ({
      exerciseId: e.exerciseId, weightKg: 60, reps: 8, rir: 2, done: true, type: 'work',
    }))),
  }));
  const a = T.deloadAdvice(block, logs, T.defaultTargets(), { inDeficit: true });
  assert.equal(a.needed, true);
  assert.ok(a.reasons.some(r => r.key === 'stalled'));
  assert.ok(a.reasons.some(r => r.key === 'deficit'), 'dieting is the multiplier nobody else can see');
});

test('effort creeping up across a block is picked up on its own', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });
  // Same weights, but RIR falls from 3 to 0: the same work is costing more.
  const logs = block.sessions.map((s, i) => ({
    id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(6 + i).padStart(2, '0'),
    sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, () => ({
      exerciseId: e.exerciseId, weightKg: 60, reps: 8,
      rir: i < block.sessions.length / 2 ? 3 : 0, done: true, type: 'work',
    }))),
  }));
  const a = T.deloadAdvice(block, logs, T.defaultTargets(), {});
  assert.ok(a.reasons.some(r => r.key === 'effort'), `reasons were: ${a.reasons.map(r => r.key).join(', ')}`);
});

test('one soft signal on its own is never enough to spend a training week', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });
  const logs = block.sessions.map((s, i) => ({
    id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(6 + i).padStart(2, '0'),
    sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, () => ({
      exerciseId: e.exerciseId, weightKg: 50 + i * 2.5, reps: 10, rir: 2, done: true, type: 'work',
    }))),
  }));
  const a = T.deloadAdvice(block, logs, T.defaultTargets(), { inDeficit: true });
  assert.equal(a.needed, false, 'a deficit alone should not cost you a week');
});

test('an empty block does not claim you need a deload', () => {
  const block = T.generateBlock({ daysPerWeek: 3, weeks: 4, startISO: '2026-07-06' });
  const a = T.deloadAdvice(block, [], T.defaultTargets(), {});
  assert.equal(a.needed, false);
});

// ---- training to the day you are actually having --------------------------------------------------

const sampleSession = () => T.weekSessions(T.generateBlock({ daysPerWeek: 4, weeks: 4 }), 1)[0];

test('a recovered day is left alone', () => {
  const a = T.readinessAdjust(sampleSession(), 85);
  assert.equal(a.action, 'none');
});

test('no readiness data means no opinion, rather than a guess', () => {
  assert.equal(T.readinessAdjust(sampleSession(), null).action, 'none');
  assert.equal(T.readinessAdjust(sampleSession(), null).level, 'unknown');
});

test('a middling day softens the effort but keeps every movement', () => {
  const a = T.readinessAdjust(sampleSession(), 58);
  assert.equal(a.action, 'soften');
  assert.equal(a.rirDelta, 1, 'one more rep left in the tank');
  assert.deepEqual(a.drop, [], 'nothing comes out of a merely average day');
});

test('a rough day trims accessories and never the main lift', () => {
  const session = sampleSession();
  const a = T.readinessAdjust(session, 30);
  assert.equal(a.action, 'trim');
  assert.ok(a.drop.length > 0, 'something should come off');
  assert.ok(!a.drop.some(d => d.index === 0), 'the first movement is the one you came for');
  // And what comes off is accessory work, not a compound.
  const ordered = session.exercises.slice().sort((x, y) => x.order - y.order);
  for (const d of a.drop) {
    const ex = T.byId(ordered[d.index].exerciseId);
    assert.ok(['isolation', 'core'].includes(ex.pattern), `${ex.name} is not an accessory`);
  }
});

test('a session with nothing but compounds is softened rather than gutted', () => {
  const session = { exercises: [
    { exerciseId: 'back_squat', order: 0, target: { sets: 3 } },
    { exerciseId: 'bb_bench', order: 1, target: { sets: 3 } },
  ] };
  const a = T.readinessAdjust(session, 25);
  assert.deepEqual(a.drop, [], 'there is no accessory work to take off');
  assert.ok(a.rirDelta >= 1, 'so the effort eases instead');
  assert.ok(a.text.length > 20);
});

test('an empty session cannot be trimmed', () => {
  assert.equal(T.readinessAdjust({ exercises: [] }, 20).action, 'none');
});
