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

// A real five-day plan exported from a coaching app, which is where the failures below came from.
// Every movement carries the coach's own tag, and that one stray token was enough to make five of
// the thirty-one vanish and three more resolve to the wrong machine.
test('a coach tag in front of every movement does not cost the plan its movements', () => {
  const cases = [
    ['CAM - SMITH MACHINE INCLINE PRESS', 'machine_incline'],
    ['CAM - DECLINE CHEST FLY', 'cable_fly_high'],
    ['CAM - DB SEATED SHOULDER PRESS', 'db_ohp'],
    ['CAM - FRENCH PRESS (OHTX)', 'overhead_ez'],
    ['CAM - CABLE TRICEP PUSHDOWN', 'bar_pushdown'],
    ['CAM - MACHINE PREACHER CURL', 'machine_preacher'],
    ['CAM - HANGING LEG RAISES', 'hanging_leg_raise'],
    ['CAM - MACHINE ADDUCTION', 'hip_adduction'],
    ['CAM - PENDULUM SQUAT', 'pendulum_squat'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(T.resolve(input), expected, `"${input}" resolved to ${T.resolve(input)}`);
  }
});

test('the tag can be an en dash or an em dash, and a hyphenated movement survives either way', () => {
  assert.equal(T.resolve('CAM – PENDULUM SQUAT'), 'pendulum_squat');
  assert.equal(T.resolve('TW — Leg Press'), 'leg_press');
  // The spaces around the separator are what make the strip safe. These have none, so they stay.
  assert.equal(T.resolve('T-Bar Row'), 'tbar_row');
  assert.equal(T.resolve('Low-to-high cable fly'), 'cable_fly_low');
});

test('a rare word outweighs a common one, so the specific movement wins', () => {
  // Both of these used to tie on a flat token count and fall to whichever sat earlier in the table.
  assert.equal(T.resolve('ALTERNATING DUMBBELL HAMMER CURL'), 'hammer_curl', 'not a plain dumbbell curl');
  assert.equal(T.resolve('SPLIT SQUAT SMITH MACHINE'), 'split_squat', 'not a bilateral Smith squat');
  // A plain "hamstring curl" in a machine-based plan is the machine, not a Nordic.
  assert.equal(T.resolve('HAMSTRING CURL'), 'lying_leg_curl');
});

test('an imported plan can be run exactly as its author wrote it', () => {
  // The whole point of importing someone's plan: two hard sets is the prescription, not an
  // undercooked version of ours to be topped up to four by week three.
  const { template } = T.importTemplate({
    days: [{ name: 'Day 1', exercises: [
      { name: 'CAM - SMITH MACHINE INCLINE PRESS', sets: 2, repLow: 6, tempo: '2110' },
      { name: 'CAM - MACHINE LAT PULLDOWN', sets: 2, repLow: 8, tempo: '2110' },
    ] }],
  });
  const block = T.blockFromTemplate(template, { weeks: 4, shape: 'as-written', targets: T.defaultTargets(), source: 'import' });
  for (let w = 1; w <= 4; w++) {
    const s = T.weekSessions(block, w)[0];
    assert.deepEqual(s.exercises.map(e => e.target.sets), [2, 2], `week ${w} was rewritten`);
    assert.equal(s.deload, false, `week ${w} became a deload the plan never asked for`);
    assert.deepEqual(s.exercises.map(e => e.target.tempo), ['2110', '2110'], `week ${w} lost the tempo`);
  }
  // And the effort target holds steady rather than being walked in a week at a time.
  const rirs = [1, 2, 3, 4].map(w => T.weekSessions(block, w)[0].exercises[0].target.rir);
  assert.equal(new Set(rirs).size, 1, `RIR moved across the block: ${rirs}`);
});

test('the app still periodises its OWN blocks', () => {
  // As-written is for imports. Nothing here may leak into a block the app generated.
  const { template } = T.importTemplate({
    days: [{ name: 'Upper', exercises: [{ name: 'Bench Press', sets: 2 }, { name: 'Lat Pulldown', sets: 2 }] }],
  });
  const built = T.blockFromTemplate(template, { weeks: 4, shape: 'build3-deload1', targets: T.defaultTargets() });
  const w1 = T.weekSessions(built, 1)[0].exercises[0].target.sets;
  const w3 = T.weekSessions(built, 3)[0].exercises[0].target.sets;
  assert.ok(w3 > w1, `a generated block should still build: ${w1} -> ${w3}`);
});

// ---- naming a day --------------------------------------------------------------------------------
// "DAY 1" is what a coaching app exports and it tells you nothing standing in the gym.

test('a day with no name of its own is named for what it trains', () => {
  const { template } = T.importTemplate({ days: [
    { name: 'Day 1', exercises: [
      { name: 'Smith Machine Incline Press', sets: 2 }, { name: 'Decline Chest Fly', sets: 2 },
      { name: 'Machine Lat Pulldown', sets: 2 }, { name: 'T-Bar Row', sets: 3 },
    ] },
    { name: 'Day 2', exercises: [{ name: 'Pendulum Squat', sets: 2 }, { name: 'Leg Extension', sets: 2 }] },
  ] });
  assert.equal(template[0].name, 'Day 1 - Chest and back');
  assert.equal(template[1].name, 'Day 2 - Legs');
});

test('the regions are named in the order a person says them', () => {
  // Back carries more volume here than chest, but nobody says "back and chest".
  const { template } = T.importTemplate({ days: [{ name: 'Day 1', exercises: [
    { name: 'Bench Press', sets: 2 }, { name: 'Lat Pulldown', sets: 3 }, { name: 'T-Bar Row', sets: 3 },
  ] }] });
  assert.equal(template[0].name, 'Day 1 - Chest and back');
});

test('a name its author gave meaning to is never overwritten', () => {
  ['Upper A', 'Push', 'Legs', 'Chest and tris', 'Heavy day'].forEach(n => {
    const { template } = T.importTemplate({ days: [{ name: n, exercises: [{ name: 'Bench Press', sets: 3 }] }] });
    assert.equal(template[0].name, n, `"${n}" was relabelled`);
  });
});

test('assistance work does not get a day named after it', () => {
  // Every row and pulldown feeds the biceps. That does not make a back day an arm day, which is why
  // dayFocus counts primary movers only.
  const day = { exercises: [
    { exerciseId: 'lat_pulldown', target: { sets: 3 } },
    { exerciseId: 'tbar_row', target: { sets: 3 } },
    { exerciseId: 'seated_cable_row', target: { sets: 3 } },
  ] };
  assert.equal(T.dayFocus(day), 'Back');
});

// ---- did we match the right kit? -------------------------------------------------------------------

test('a movement matched to equipment the plan did not ask for is reported', () => {
  const { mismatches } = T.importTemplate({ days: [{ name: 'Day 2', exercises: [
    { name: 'CAM - SPLIT SQUAT SMITH MACHINE', sets: 1 },
    { name: 'CAM - PENDULUM SQUAT', sets: 2 },
  ] }] });
  assert.equal(mismatches.length, 1);
  assert.ok(mismatches[0].said.includes('smith'));
  assert.equal(mismatches[0].got, 'dumbbell');
});

test('a plate-loaded machine matching a cable stack is not worth flagging', () => {
  // "Machine lat pulldown" against the cable pulldown is the same movement on the same line.
  const { mismatches } = T.importTemplate({ days: [{ name: 'A', exercises: [{ name: 'Machine Lat Pulldown', sets: 2 }] }] });
  assert.deepEqual(mismatches, []);
});

test('a shaky match is separated from a certain one', () => {
  const { loose } = T.importTemplate({ days: [{ name: 'A', exercises: [
    { name: 'Bench Press', sets: 3 },                 // exact
    { name: 'CAM - FRENCH PRESS (OHTX)', sets: 2 },   // rescued by a leading-words alias
  ] }] });
  assert.equal(loose.length, 1);
  assert.match(loose[0].name, /FRENCH PRESS/);
});

test('the week the source was showing is carried through', () => {
  const r = T.importTemplate({ week_label: 'Week 4 (08/10/26 - 08/15/26)', days: [{ name: 'A', exercises: [{ name: 'Bench Press', sets: 3 }] }] });
  assert.equal(r.weekLabel, 'Week 4 (08/10/26 - 08/15/26)');
  assert.equal(T.importTemplate({ days: [{ name: 'A', exercises: [{ name: 'Bench Press', sets: 3 }] }] }).weekLabel, null);
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

test('intensity is a choice, not a constant: moderate keeps the old floor and starting volume', () => {
  const hi = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const mod = T.generateBlock({ daysPerWeek: 4, weeks: 4, intensity: 'moderate' });
  assert.equal(hi.intensity, 'high', 'defaults to high when nothing is asked for');
  assert.equal(mod.intensity, 'moderate');
  const rirAt = (block, w) => T.weekSessions(block, w)[0].exercises[0].target.rir;
  assert.equal(rirAt(hi, 4), 0, 'high reaches true failure by the last building week');
  assert.equal(rirAt(mod, 4), 1, 'moderate keeps a rep in reserve');
  const isoOf = (block) => T.weekSessions(block, 1).flatMap(s => s.exercises)
    .find(e => T.byId(e.exerciseId).pattern === 'isolation').target;
  assert.deepEqual([isoOf(hi).repLow, isoOf(hi).repHigh], [8, 12]);
  assert.deepEqual([isoOf(mod).repLow, isoOf(mod).repHigh], [10, 15]);
});

test('nextBlock carries the intensity forward unless told otherwise', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, intensity: 'moderate' });
  const review = { adherence: 100, stalled: [], coverage: { rows: [] } };
  const targets = T.defaultTargets({ experience: 'intermediate' });
  const kept = T.nextBlock(block, review, targets, {});
  assert.equal(kept.intensity, 'moderate');
  const overridden = T.nextBlock(block, review, targets, { intensity: 'high' });
  assert.equal(overridden.intensity, 'high');
});

test('addExerciseToSession honours the intensity it is given, defaults to high', () => {
  const session = { week: 4, exercises: [] };
  const withoutIntensity = T.addExerciseToSession(session, 'db_lateral', null, 'a');
  assert.equal(withoutIntensity.target.sets, 2);
  assert.equal(withoutIntensity.target.rir, 0, 'high has no floor by week 4');
  const session2 = { week: 4, exercises: [] };
  const moderate = T.addExerciseToSession(session2, 'db_lateral', null, 'b', 'moderate');
  assert.equal(moderate.target.sets, 3);
  assert.equal(moderate.target.rir, 1, 'moderate keeps its floor of 1');
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

test('an unreadable movement is auto-created, never silently dropped', () => {
  const { template, unresolved, newCustom } = T.importTemplate({
    days: [{ name: 'Day 1', exercises: [
      { name: 'Bench Press', sets: 3 },
      { name: 'the special thing coach showed me', sets: 3, muscle: ['tr'], equipment: 'cable', pattern: 'isolation' },
    ] }],
  });
  assert.equal(template[0].exercises.length, 2, 'the plan keeps everything the source had');
  assert.equal(unresolved.length, 1, 'still flagged, just not dropped');
  assert.equal(unresolved[0].name, 'the special thing coach showed me');
  assert.equal(unresolved[0].dayName, 'Day 1');
  const auto = template[0].exercises[1];
  assert.equal(auto.check, 'auto');
  assert.equal(newCustom.length, 1);
  assert.deepEqual(newCustom[0].primary, ['tr']);
  assert.equal(newCustom[0].equipment, 'cable');
  assert.equal(newCustom[0].pattern, 'isolation');
  assert.ok(newCustom[0].custom && newCustom[0].auto);
});

test('a movement with no muscle guess at all still mints something rather than failing', () => {
  const { template, newCustom } = T.importTemplate({ days: [{ name: 'Mystery', exercises: [{ name: 'qqqq', sets: 3 }] }] });
  assert.equal(template.length, 1, 'the day survives even on a totally unrecognised name');
  assert.equal(template[0].exercises.length, 1);
  assert.equal(newCustom.length, 1);
  assert.ok(newCustom[0].primary.length > 0, 'never mints an exercise with no primary muscle at all');
});

test('the same unresolved name twice mints one custom exercise, not two', () => {
  const { template, newCustom } = T.importTemplate({
    days: [{ name: 'A', exercises: [{ name: 'Dirty 30s', sets: 2 }] }, { name: 'B', exercises: [{ name: 'Dirty 30s', sets: 2 }] }],
  });
  assert.equal(newCustom.length, 1, 'the second occurrence reuses the first mint');
  assert.equal(template[0].exercises[0].exerciseId, template[1].exercises[0].exerciseId);
});

// ---- the draft basket --------------------------------------------------------------------------
// Collecting several screenshots into one block. The bug these pin down was real and quiet: five
// screenshots went in and four days came out, because the basket was keyed on the day's NAME alone
// and phone screenshots of a plan very often all call themselves "Day 1".

const shot = (name, dayName) => ({ ref: { kind: 'file', name }, days: [{ name: dayName, kind: 'full', exercises: [] }] });

test('five screenshots that all name their day the same still land as five days', () => {
  const days = [];
  ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'].forEach(f => {
    const s = shot(f, 'Day 1');
    T.mergeDraftDays(days, s.days, s.ref);
  });
  assert.equal(days.length, 5, 'a day from a different screenshot must never overwrite another');
  assert.equal(new Set(days.map(d => d.name)).size, 5, 'and the five must be tellable apart');
  assert.deepEqual(days.map(d => d.dayOfWeek), [0, 1, 2, 3, 4]);
});

test('re-importing the same file replaces the day it gave last time rather than doubling it', () => {
  const days = [];
  T.mergeDraftDays(days, [{ name: 'Upper A', exercises: [{ id: 'x' }] }], { kind: 'file', name: 'upper.png' });
  T.mergeDraftDays(days, [{ name: 'Upper A', exercises: [{ id: 'y' }, { id: 'z' }] }], { kind: 'file', name: 'upper.png' });
  assert.equal(days.length, 1, 'the corrected read replaces the first one');
  assert.equal(days[0].exercises.length, 2);
});

test('days from different sources keep their own provenance', () => {
  const days = [];
  T.mergeDraftDays(days, [{ name: 'Push', exercises: [] }], { kind: 'file', name: 'mon.png' });
  T.mergeDraftDays(days, [{ name: 'Push', exercises: [] }], { kind: 'link', url: 'https://example.com/p/1' });
  T.mergeDraftDays(days, [{ name: 'Push', exercises: [] }], { kind: 'paste' });
  assert.equal(days.length, 3);
  assert.deepEqual(days.map(d => d.sourceRef.kind), ['file', 'link', 'paste']);
});

test('a pasted plan re-pasted replaces itself, since there is only ever one paste', () => {
  const days = [];
  T.mergeDraftDays(days, [{ name: 'Legs', exercises: [] }], { kind: 'paste' });
  T.mergeDraftDays(days, [{ name: 'Legs', exercises: [] }], { kind: 'paste' });
  assert.equal(days.length, 1);
});

test('one screenshot holding a whole week keeps every day of it', () => {
  const days = [];
  const week = ['Mon', 'Tue', 'Wed', 'Thu'].map(n => ({ name: n, exercises: [] }));
  T.mergeDraftDays(days, week, { kind: 'file', name: 'week.png' });
  assert.equal(days.length, 4);
  assert.deepEqual(days.map(d => d.name), ['Mon', 'Tue', 'Wed', 'Thu']);
});

test('disambiguated names do not collide with a day already called that', () => {
  const days = [];
  T.mergeDraftDays(days, [{ name: 'Push', exercises: [] }], { kind: 'file', name: 'a.png' });
  T.mergeDraftDays(days, [{ name: 'Push (2)', exercises: [] }], { kind: 'file', name: 'b.png' });
  T.mergeDraftDays(days, [{ name: 'Push', exercises: [] }], { kind: 'file', name: 'c.png' });
  assert.equal(days.length, 3);
  assert.equal(new Set(days.map(d => d.name.toLowerCase().replace(/[^a-z0-9]/g, ''))).size, 3);
});

test('one screenshot read as two same-named sessions keeps both', () => {
  // Same source, same read. These are two days, not a day and a correction of it, so neither the
  // count nor the second session may be swallowed.
  const days = [];
  T.mergeDraftDays(days, [{ name: 'Day 1', exercises: [] }, { name: 'Day 1', exercises: [] }], { kind: 'file', name: 'both.png' });
  assert.equal(days.length, 2);
});

test('days collected from separate screenshots do not share exercise ids', () => {
  // Each screenshot is its own parse, so importTemplate numbers every one of them as day zero. The
  // ids that come out are what a logged set points back at to find its line in the plan, so two days
  // carrying the same ids is a real collision, not a cosmetic one.
  const days = [];
  ['a.png', 'b.png'].forEach(f => {
    const { template } = T.importTemplate({ days: [{ name: 'Day ' + f[0], exercises: [
      { name: 'Bench Press', sets: 2 }, { name: 'Lat Pulldown', sets: 2 },
    ] }] });
    T.mergeDraftDays(days, template, { kind: 'file', name: f });
  });
  const ids = days.reduce((a, d) => a.concat(d.exercises.map(e => e.id)), []);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
});

// ---- what a finished block is allowed to teach -----------------------------------------------------
// tuneTargets moves somebody's own landmarks after a block they actually ran. The danger is that a
// style whose numbers ARE the method gets talked out of them one block at a time.

const reviewWith = (rows, stalled) => ({
  adherence: 90, coverage: { rows: rows }, stalled: stalled || [],
});

test('a block cannot raise the min-max caps, however well it went', () => {
  const targets = T.defaultTargets({ style: 'minmax' });
  const before = JSON.parse(JSON.stringify(targets));
  const rows = T.MUSCLES.map(m => ({ muscle: m, band: 'high' }));
  const after = T.tuneTargets(targets, reviewWith(rows), { style: 'minmax' });
  for (const m of T.MUSCLES) {
    assert.ok(after[m].mav <= before[m].mav, `${T.MUSCLE_LABEL[m]} mav crept from ${before[m].mav} to ${after[m].mav}`);
    assert.ok(after[m].mrv <= before[m].mrv, `${T.MUSCLE_LABEL[m]} mrv crept up`);
  }
  // The volume model is unchanged: there, tolerating a high week IS information worth keeping.
  const lt = T.defaultTargets({});
  const ltAfter = T.tuneTargets(lt, reviewWith(rows));
  assert.ok(ltAfter.ch.mav > lt.ch.mav === false || ltAfter.ch.mav >= lt.ch.mav);
});

test('a stall still takes volume away on either style', () => {
  const targets = T.defaultTargets({ style: 'minmax' });
  const before = targets.ch.mrv;
  const after = T.tuneTargets(targets, reviewWith([{ muscle: 'ch', band: 'over' }], [{ exerciseId: 'bb_bench' }]), { style: 'minmax' });
  assert.ok(after.ch.mrv < before, 'a muscle that stalled at its ceiling should get a lower one');
});

test('only the muscles a block moved are learned from it', () => {
  const before = T.defaultTargets({});
  const after = T.tuneTargets(before, reviewWith([{ muscle: 'ch', band: 'high' }]));
  const learned = T.targetChanges(before, after);
  assert.deepEqual(Object.keys(learned), ['ch'], 'saving all seventeen would stamp numbers nobody learned');
  assert.equal(learned.ch.mav, before.ch.mav + 2);
  assert.deepEqual(T.targetChanges(before, before), {}, 'a block that taught nothing writes nothing');
});

test('the two styles read their landmarks from their own table', () => {
  // The scale is the point: six sets is a full week of chest on one model and a third of one on the
  // other, so a ceiling learned at failure must never be applied to the model that stops short.
  const mm = T.defaultTargets({ style: 'minmax', volumeTargets: { ch: { mev: 4, mav: 6, mrv: 8 } } });
  const lm = T.defaultTargets({ volumeTargets: {} });
  assert.equal(mm.ch.mrv, 8);
  assert.ok(lm.ch.mrv > 15, 'the volume model keeps its own ceiling, untouched by the other');
});

// ---- a block, stored small --------------------------------------------------------------------
// Weeks two onward are week one repeated, so a block is packed for storage and expanded on read.
// The property that matters more than the ratio: nothing is ever stored in a form we cannot
// reproduce exactly, because a block that comes back subtly different is somebody's training history
// pointing at lines that no longer exist.

const roundTrips = (block, label) => {
  const packed = T.packBlock(block);
  assert.deepEqual(T.unpackBlock(packed), block, label + ': did not come back identical');
  return packed;
};

test('every kind of block packs losslessly', () => {
  const blocks = {
    'generated min-max': T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 }),
    'generated volume model': T.generateBlock({ daysPerWeek: 4, weeks: 4 }),
    'as written': T.generateBlock({ daysPerWeek: 3, weeks: 4, shape: 'as-written' }),
    'one week only': T.generateBlock({ daysPerWeek: 2, weeks: 1 }),
  };
  for (const label of Object.keys(blocks)) {
    const packed = roundTrips(blocks[label], label);
    if (blocks[label].weeks > 1) {
      assert.ok(packed.packed, label + ': should have packed');
      assert.ok(JSON.stringify(packed).length < JSON.stringify(blocks[label]).length * 0.75, label + ': not worth it');
    }
  }
});

test('a week somebody edited by hand survives the round trip', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 });
  // Week three: a different movement, a different prescription, a session moved to another day, and
  // a movement removed outright. None of that is week one any more.
  const w3 = block.sessions.filter(s => s.week === 3);
  w3[0].exercises[0].exerciseId = 'db_curl';
  w3[0].exercises[1].target.sets = 1;
  w3[0].dayOfWeek = 6;
  w3[1].exercises.pop();
  const packed = T.packBlock(block);
  // The removed movement makes week three structurally different, so it declines to pack rather
  // than guessing - and what it hands back is the block, untouched.
  assert.deepEqual(T.unpackBlock(packed), block);
});

test('a week that differs only in its numbers still packs', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 });
  const w3 = block.sessions.filter(s => s.week === 3);
  w3[0].exercises[0].target.sets = 1;
  w3[0].exercises[0].technique = 'Myo-reps';
  w3[0].name = 'Upper A (heavy)';
  const packed = roundTrips(block, 'edited numbers');
  assert.ok(packed.packed);
});

test('packing is safe to run twice, and unpacking on an old block does nothing', () => {
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const once = T.packBlock(block);
  assert.deepEqual(T.packBlock(once), once, 'packing a packed block must not double-wrap it');
  assert.deepEqual(T.unpackBlock(block), block, 'a block saved before any of this reads unchanged');
  assert.deepEqual(T.unpackBlocks([block, once]).map(b => b.sessions.length), [block.sessions.length, block.sessions.length]);
});

test('the ids logs point at come back exactly', () => {
  // The whole reason for the verification step. A logged set stores the session id and the line id
  // it belongs to; a block that comes back with different ids is a history that points nowhere.
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 });
  const idsOf = (b) => b.sessions.map(s => s.id + ':' + s.exercises.map(e => e.id).join(','));
  assert.deepEqual(idsOf(T.unpackBlock(T.packBlock(block))), idsOf(block));
});

// ---- what a second block adds ---------------------------------------------------------------------
// On a style with no sets left to give, the progression between blocks is a technique on the last
// set of about four movements in ten. The rules below are about what is safe to fail twice on.

test('a second min-max block is the first one plus techniques, and nothing else', () => {
  const first = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  assert.equal(T.hasTechniques(first), false, 'the first block runs plain');
  const review = { adherence: 90, coverage: { rows: [] }, stalled: [] };
  const second = T.nextBlock(first, review, T.defaultTargets({ style: 'minmax' }), {});
  assert.ok(T.hasTechniques(second), 'the second earns them');
  const setsIn = (b) => b.sessions.filter(s => s.week === 1).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
  const movesIn = (b) => b.sessions.filter(s => s.week === 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
  assert.equal(setsIn(second), setsIn(first), 'and adds nothing else: not a set, not a week, not a rep');
  assert.deepEqual(movesIn(second), movesIn(first), 'the same movements, in the same order');
  assert.equal(second.weeks, first.weeks);
  // A third block is plain again: twelve weeks is two blocks, not an endless ramp.
  const third = T.nextBlock(second, review, T.defaultTargets({ style: 'minmax' }), {});
  assert.equal(T.hasTechniques(third), false);
});

test('techniques land on about four movements in ten, never on the opener', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5, sessionMinutes: 60 });
  T.applyTechniques(block, {});
  for (const s of T.weekSessions(block, 1)) {
    const items = s.exercises.slice().sort((a, b) => a.order - b.order);
    assert.ok(!items[0].technique, `${s.name} put one on the movement the session is built around`);
    const n = items.filter(e => e.technique).length;
    assert.ok(n <= Math.floor(items.length * 0.45), `${s.name}: ${n} of ${items.length}`);
  }
  const all = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises), []);
  const share = all.filter(e => e.technique).length / all.length;
  assert.ok(share > 0.25 && share < 0.5, `${Math.round(share * 100)}% carried one`);
});

test('nothing you could be pinned under gets a technique', () => {
  for (const id of ['back_squat', 'bb_bench', 'rdl', 'bb_ohp', 'db_bench']) {
    assert.equal(T.techniqueFor(T.byId(id)), null, `${T.byId(id).name} must not carry one`);
  }
  // A bodyweight compound is fine - the published programmes put partials on the pull-up.
  assert.ok(T.techniqueFor(T.byId('pullup')));
  // Guided kit takes drop sets, grip work takes a hold, and core work takes nothing at all: there
  // is no rep to extend on a plank and no weight to drop.
  assert.equal(T.techniqueFor(T.byId('machine_press')), 'drop');
  assert.equal(T.techniqueFor(T.byId('wrist_curl')), 'hold');
  assert.equal(T.techniqueFor(T.byId('plank')), null);
  assert.equal(T.techniqueFor(T.byId('cable_crunch')), null);
});

// ---- sharing a block that stays the block ----------------------------------------------------------

test('a published block carries its style, its open slots and its techniques', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 });
  T.applyTechniques(block, {});
  block.sessions.forEach(s => { if (s.exercises[1]) s.exercises[1].choice = { key: 'squat', label: 'Squat', options: ['back_squat', 'hack_squat'] }; });
  const payload = T.templatePayload(block);
  assert.equal(T.templateStyle(payload), 'minmax');
  const days = T.templateDays(payload);
  assert.equal(days.length, 5);
  assert.ok(days.some(d => d.exercises.some(e => e.technique)), 'techniques travel');
  assert.ok(days.some(d => d.exercises.some(e => e.choice)), 'so does a slot the author left open');
  assert.ok(days.some(d => d.exercises.some(e => e.target.rirLast != null)), 'and the effort pair');
});

test('a block published before styles existed still reads', () => {
  const legacy = T.templateOf(T.generateBlock({ daysPerWeek: 4, weeks: 4 }));
  assert.ok(Array.isArray(legacy));
  assert.deepEqual(T.templateDays(legacy), legacy, 'a bare array is the old shape and must keep working');
  assert.equal(T.templateStyle(legacy), null);
});

test('adopting a min-max block builds it as one', () => {
  const block = T.generateBlock({ style: 'minmax', shape: 'minmax6', weeks: 6, daysPerWeek: 5 });
  const payload = T.templatePayload(block);
  const { block: mine } = T.adoptTemplate(T.templateDays(payload), {
    style: T.templateStyle(payload), weeks: 6, shape: 'minmax6',
    targets: T.defaultTargets({ style: 'minmax' }),
  });
  assert.equal(mine.style, 'minmax');
  const sets = mine.sessions.reduce((a, s) => a.concat(s.exercises.map(e => e.target.sets)), []);
  assert.ok(sets.every(n => n <= 2), 'and stays inside the method it was written for');
});

// ---- the warm-ups the author asked for --------------------------------------------------------------

test('a stated warm-up count wins, and takes the sets nearest the working weight', () => {
  const squat = T.byId('back_squat');
  const full = T.warmupSets(100, squat);
  assert.equal(full.length, 4);
  const two = T.warmupSets(100, squat, { count: 2 });
  assert.equal(two.length, 2);
  assert.deepEqual(two.map(x => x.weightKg), full.slice(-2).map(x => x.weightKg), 'the heavy end, not the light end');
  assert.deepEqual(T.warmupSets(30, T.byId('cable_curl'), { count: 0 }), [], 'nought means nought');
  assert.equal(T.warmupSets(100, squat, { count: 9 }).length, 4, 'and it cannot ask for more rungs than exist');
});

test('a block file keeps the warm-up counts it was written with', () => {
  const doc = {
    macrosaurus: 'blocks', version: 1,
    blocks: [{ name: 'P', weeks: 1, daysPerWeek: 1, style: 'minmax', sessions: [{ week: 1, dayOfWeek: 0, name: 'Lower', kind: 'lower', exercises: [
      { exerciseId: 'back_squat', order: 0, warmups: 3, target: { sets: 2, repLow: 6, repHigh: 8, rir: 1, rirLast: 0 } },
      { exerciseId: 'leg_extension', order: 1, warmups: 0, target: { sets: 2, repLow: 8, repHigh: 10, rir: 0, rirLast: 0 } },
    ] }] }],
  };
  const b = T.blocksFromFile(doc, {}).blocks[0];
  assert.equal(b.sessions[0].exercises[0].warmups, 3);
  assert.equal(b.sessions[0].exercises[1].warmups, 0);
});

// ---- a plan you already own, as a file ------------------------------------------------------------
// The other way in: a programme somebody bought, converted once by tools/minmax-import.mjs and
// loaded straight into their own blocks. No model, no guessing, nothing published.

const fileDoc = () => ({
  macrosaurus: 'blocks', version: 1,
  blocks: [{
    name: 'A programme', weeks: 2, daysPerWeek: 2, style: 'minmax', shape: 'as-written',
    sessions: [1, 2].flatMap(w => [
      { week: w, dayOfWeek: 0, name: 'Upper', kind: 'upper', exercises: [
        { exerciseId: 'machine_press', order: 0, sourceName: 'Machine Chest Press',
          alts: ['smith_bench', 'db_bench'], planNote: '1 second pause at the bottom.',
          technique: w === 2 ? 'Two Drop Sets (~25% per)' : null,
          target: { sets: 2, repLow: 8, repHigh: 10, rir: 1, rirLast: 0, restSec: 240 } },
        { exerciseId: 'nothing_like_this', order: 1, sourceName: 'Invented Machine', target: { sets: 2 } },
      ] },
      { week: w, dayOfWeek: 1, name: 'Lower', kind: 'lower', exercises: [
        { exerciseId: 'back_squat', order: 0, sourceName: 'Squat (Your Choice)',
          choice: { key: 'squat', label: 'Squat - your choice', options: ['back_squat', 'hack_squat', 'pendulum_squat'] },
          target: { sets: 2, repLow: 6, repHigh: 8, rir: 1, rirLast: 0, restSec: 240 } },
      ] },
    ]),
  }],
});

test('a block file loads exactly as written, and says what it could not place', () => {
  const res = T.blocksFromFile(fileDoc(), {});
  assert.equal(res.blocks.length, 1);
  const b = res.blocks[0];
  assert.equal(b.weeks, 2);
  assert.equal(b.style, 'minmax');
  assert.equal(b.shape, 'as-written', 'a plan you own is not ours to periodise');
  const press = b.sessions[0].exercises[0];
  assert.deepEqual([press.target.sets, press.target.repLow, press.target.repHigh, press.target.rir, press.target.rirLast, press.target.restSec],
    [2, 8, 10, 1, 0, 240], 'every number comes off the file');
  assert.equal(press.planNote, '1 second pause at the bottom.');
  assert.deepEqual(press.alts, ['smith_bench', 'db_bench']);
  assert.ok(res.problems.some(p => /Invented Machine/.test(p)), 'and a movement the library lacks is named, not dropped in silence');
});

test('nothing loaded from a file is published, started or able to collide', () => {
  const a = T.blocksFromFile(fileDoc(), {}).blocks[0];
  const b = T.blocksFromFile(fileDoc(), {}).blocks[0];
  assert.notEqual(a.id, b.id, 'the same file loaded twice must not overwrite itself');
  const ids = [a, b].flatMap(x => x.sessions.flatMap(s => s.exercises.map(e => e.id)));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(a.shared, false);
  assert.equal(a.startISO, null, 'loading a plan is not starting it');
  assert.equal(a.source, 'file');
});

test('a slot the plan left open is a choice, and picking moves every week of it', () => {
  const b = T.blocksFromFile(fileDoc(), {}).blocks[0];
  const choices = T.blockChoices(b);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].label, 'Squat - your choice');
  assert.deepEqual(choices[0].options, ['back_squat', 'hack_squat', 'pendulum_squat']);
  assert.equal(choices[0].picked, 'back_squat');
  const moved = T.applyChoice(b, 'squat', 'pendulum_squat');
  assert.equal(moved, 2, 'both weeks, not just the one in front of you');
  assert.ok(b.sessions.every(s => s.exercises.every(e => !e.choice || e.exerciseId === 'pendulum_squat')));
  // A generated block leaves nothing open: it has already made the pick.
  assert.deepEqual(T.blockChoices(T.generateBlock({ style: 'minmax', daysPerWeek: 5, weeks: 6 })), []);
});

test('a block file cannot smuggle in numbers the app would not accept', () => {
  const doc = fileDoc();
  doc.blocks[0].sessions[0].exercises[0].target = { sets: 99, repLow: 0, repHigh: 900, rir: 12, restSec: 99999 };
  doc.blocks[0].sessions[0].dayOfWeek = 40;
  const b = T.blocksFromFile(doc, {}).blocks[0];
  const e = b.sessions[0].exercises[0];
  assert.ok(e.target.sets <= T.SETS_MAX && e.target.repHigh <= T.REPS_MAX && e.target.rir <= T.RIR_MAX);
  assert.ok(b.sessions[0].dayOfWeek >= 0 && b.sessions[0].dayOfWeek <= 6);
});

// ---- min-max ------------------------------------------------------------------------------------
// The house method: four to ten hard sets a muscle a week, one or two per movement, every one of them
// to failure, on kit that makes failing safe. Everything below is a rule of the method rather than a
// preference, so each of these is a thing that must not drift.

const minmax = (opts) => T.generateBlock(Object.assign({
  style: 'minmax', daysPerWeek: 5, weeks: 6, shape: 'minmax6', sessionMinutes: 60,
  targets: T.defaultTargets({ style: 'minmax' }),
}, opts || {}));

test('no muscle is programmed more than ten hard sets a week', () => {
  for (const days of [2, 3, 4, 5, 6]) {
    const block = minmax({ daysPerWeek: days });
    for (let w = 1; w <= 6; w++) {
      const vol = T.blockWeekVolume(block, w);
      // The ceiling is the whole method and applies to everything.
      for (const m of T.MUSCLES) {
        assert.ok(vol[m] <= 10, `${T.MUSCLE_LABEL[m]} got ${vol[m]} sets in week ${w} on ${days} days`);
      }
      // The floor is about the muscle GROUPS somebody trains on purpose, and it is only claimable
      // from four days up: seven movements at two sets, twice a week, cannot reach seventeen
      // muscles, and pretending otherwise would mean breaking one of the caps to do it. Forearms,
      // lower back and the adductors take what falls out of everything else, as they always have.
      if (days >= 4) {
        for (const m of ['ch', 'lt', 'ub', 'sd', 'bi', 'tr', 'qu', 'ha', 'gl']) {
          assert.ok(vol[m] >= 4, `${T.MUSCLE_LABEL[m]} got ${vol[m]} sets in week ${w} on ${days} days`);
        }
      }
    }
  }
});

test('no movement is ever prescribed more than two working sets', () => {
  const block = minmax();
  for (const s of block.sessions) {
    for (const e of s.exercises) {
      assert.ok(e.target.sets >= 1 && e.target.sets <= 2, `${T.byId(e.exerciseId).name} got ${e.target.sets} sets`);
    }
  }
});

test('the last set of every movement is the all-out one', () => {
  // Not every set: the published programmes stop the FIRST set of a two-set compound a rep short,
  // because the cost of failing a squat is a squat you have to get out from under. The last set is
  // always the one taken to failure, and on isolation both of them are.
  const block = minmax({ shape: 'minmax6' });
  for (const s of block.sessions) {
    for (const e of s.exercises) {
      const ex = T.byId(e.exerciseId);
      const intro = s.week === 1;
      if (intro) {
        assert.ok(e.target.rirLast >= 1, `${ex.name} in the intro week should stop short, got ${e.target.rirLast}`);
      } else {
        assert.equal(e.target.rirLast, 0, `${s.name} week ${s.week}: ${ex.name} last set at ${e.target.rirLast} RIR`);
        assert.ok(e.target.rir <= 1, `${ex.name} first set at ${e.target.rir} RIR`);
        if (ex.pattern === 'isolation') assert.equal(e.target.rir, 0, `${ex.name} is isolation: both sets go`);
      }
    }
  }
});

test('the block is six weeks and opens on an easier one', () => {
  const block = minmax({ shape: 'minmax6', weeks: 6 });
  assert.equal(block.weeks, 6);
  const heaviest = (w) => T.weekSessions(block, w).reduce((a, s) => a.concat(s.exercises), [])
    .reduce((a, e) => a + e.target.rir + e.target.rirLast, 0);
  assert.ok(heaviest(1) > heaviest(2), 'week one sits further from failure than week two');
  assert.equal(heaviest(2), heaviest(6), 'and weeks two to six are all as hard as each other');
});

test('the last week is the first week: the progression is not in the plan', () => {
  const block = minmax();
  const setsIn = (w) => T.weekSessions(block, w).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
  assert.equal(setsIn(6), setsIn(1), 'sets must not climb on a style with nothing to add');
});

test('the week is five sessions inside seven days, with the rest days where they belong', () => {
  const block = minmax({ daysPerWeek: 5 });
  const week = T.weekSessions(block, 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  assert.deepEqual(week.map(s => s.dayOfWeek), [0, 1, 3, 4, 5], 'upper, lower, rest, upper, lower, arms, rest');
  assert.deepEqual(week.map(s => s.kind), ['upper', 'lower', 'upper', 'lower', 'arms']);
});

test('a session is five to nine movements, as the published weeks run', () => {
  for (const mins of [40, 60, 80]) {
    const block = minmax({ sessionMinutes: mins });
    for (const s of T.weekSessions(block, 1)) {
      assert.ok(s.exercises.length >= 5 && s.exercises.length <= 9, `${s.name} has ${s.exercises.length} movements at ${mins} minutes`);
    }
  }
});

test('the five day week is the published cadence, and the four day week is its own shape', () => {
  const five = T.weekSessions(minmax({ daysPerWeek: 5 }), 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  assert.deepEqual(five.map(s => s.kind), ['upper', 'lower', 'upper', 'lower', 'arms']);
  assert.deepEqual(five.map(s => s.dayOfWeek), [0, 1, 3, 4, 5]);
  // Four days is full body, a gap, then upper, lower, arms - not upper/lower twice.
  const four = T.weekSessions(minmax({ daysPerWeek: 4 }), 1).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  assert.deepEqual(four.map(s => s.kind), ['full', 'upper', 'lower', 'arms']);
  assert.deepEqual(four.map(s => s.dayOfWeek), [0, 3, 4, 5]);
});

test('a muscle meets both rep windows across the week', () => {
  // The first exposure is the heavier one and the second is the higher-rep one. Same movements,
  // same sets, a different corner of the range - variation that costs no volume.
  const sessions = T.weekSessions(minmax({ daysPerWeek: 5 }), 2).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const windows = sessions.map(s => {
    const main = s.exercises.filter(e => T.byId(e.exerciseId).pattern !== 'core')[0];
    return main.target.repLow + '-' + main.target.repHigh;
  });
  assert.deepEqual(windows.slice(0, 4), ['6-8', '6-8', '8-10', '8-10']);
});

test('the rep windows are the two the method runs on', () => {
  const block = minmax();
  for (const s of T.weekSessions(block, 1)) {
    for (const e of s.exercises) {
      const ex = T.byId(e.exerciseId);
      if (ex.pattern === 'core') continue;
      const window = e.target.repLow + '-' + e.target.repHigh;
      assert.ok(window === '6-8' || window === '8-10', `${ex.name} got ${window}`);
    }
  }
});

test('most of the plan is kit you can fail on safely', () => {
  const block = minmax();
  const all = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => T.byId(e.exerciseId))), []);
  const guided = all.filter(x => ['machine', 'cable', 'smith', 'trapbar'].includes(x.equipment));
  assert.ok(guided.length / all.length >= 0.7, `only ${guided.length} of ${all.length} movements are guided`);
  // And the volume model must be untouched by any of this.
  const plain = T.generateBlock({ daysPerWeek: 4, weeks: 4 });
  const plainAll = T.weekSessions(plain, 1).reduce((a, s) => a.concat(s.exercises.map(e => T.byId(e.exerciseId))), []);
  assert.ok(plainAll.some(x => x.equipment === 'barbell'), 'the volume model still reaches for a barbell');
});

test('a block built before styles existed still behaves the way it was built', () => {
  const legacy = T.generateBlock({ daysPerWeek: 4, weeks: 4, intensity: 'high' });
  assert.equal(legacy.style, null);
  const setsIn = (w) => T.weekSessions(legacy, w).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
  assert.ok(setsIn(3) > setsIn(1), 'the volume model still adds a set a week');
  const w1 = T.weekSessions(legacy, 1)[0].exercises[0];
  assert.ok(w1.target.rir > 0, 'and still starts short of failure');
});

// ---- min-max progression -------------------------------------------------------------------------
// Dynamic double progression off the top set. A set taken to genuine failure has already told you
// what a percentage table was guessing at, so there are three outcomes and no arithmetic.

const hack = () => T.byId('hack_squat');
const window69 = { sets: 2, repLow: 6, repHigh: 8, rir: 1, rirLast: 0 };
const didSet = (w, r) => [{ done: true, type: 'work', weightKg: w, reps: r }];

test('hitting the top of the window puts the weight up by the smallest jump the kit allows', () => {
  const p = T.progressExercise(window69, didSet(100, 9), hack(), { style: 'minmax' });
  assert.equal(p.action, 'load');
  assert.equal(p.weightKg, 105, 'lower body moves in fives');
  const upper = T.progressExercise(window69, didSet(100, 9), T.byId('bb_bench'), { style: 'minmax' });
  assert.equal(upper.weightKg, 102.5, 'upper body in 2.5s');
});

test('landing inside the window holds the weight and asks for one more rep', () => {
  const p = T.progressExercise(window69, didSet(100, 7), hack(), { style: 'minmax' });
  assert.equal(p.action, 'reps');
  assert.equal(p.weightKg, 100);
  assert.ok(/\b8\b/.test(p.reason), `should name the rep to beat: ${p.reason}`);
});

test('missing the floor takes ten percent off', () => {
  const p = T.progressExercise(window69, didSet(100, 4), hack(), { style: 'minmax' });
  assert.equal(p.action, 'lighter');
  assert.equal(p.weightKg, 90);
});

test('three identical sessions is a plateau, and the answer is a different movement', () => {
  const flat = [{ topWeight: 100, topReps: 7 }, { topWeight: 100, topReps: 7 }, { topWeight: 100, topReps: 7 }];
  const p = T.progressExercise(window69, didSet(100, 7), hack(), { style: 'minmax', history: flat });
  assert.equal(p.action, 'swap');
  assert.ok(p.stalled);
  // A rep either side is somebody still moving, and not worth interrupting for.
  const moving = [{ topWeight: 100, topReps: 7 }, { topWeight: 100, topReps: 8 }, { topWeight: 100, topReps: 8 }];
  assert.equal(T.minmaxPlateau(moving), null);
  const subs = T.substituteFor('hack_squat', { style: 'minmax' });
  assert.ok(subs.length > 0 && subs.every(x => x.id !== 'hack_squat'), 'and something to swap it for');
});

test('a two-set compound keeps its weight, because set one stopped a rep short', () => {
  const log = [{ dateISO: '2026-08-01', sets: [{ exerciseId: 'hack_squat', done: true, type: 'work', weightKg: 100, reps: 7 }] }];
  const pre = T.prefillSets({ exerciseId: 'hack_squat', target: window69 }, log, [], { style: 'minmax' });
  assert.equal(pre.sets.length, 2);
  assert.equal(pre.sets[0].weightKg, 100);
  assert.equal(pre.sets[1].weightKg, 100, 'the second set is the all-out one, at the same weight');
  assert.ok(!pre.sets[1].backOff);
  assert.equal(pre.sets[0].targetRir, 1, 'set one stops a rep short');
  assert.equal(pre.sets[1].targetRir, 0, 'set two goes');
});

test('when both sets go to failure the second one is backed off', () => {
  // Isolation: failing a cable curl costs nothing, so the plan asks for failure twice - and a second
  // all-out set at the same load lands three reps under the window.
  assert.equal(T.backOffLoad(100, hack()), 85);
  const both = { sets: 2, repLow: 8, repHigh: 10, rir: 0, rirLast: 0 };
  const log = [{ dateISO: '2026-08-01', sets: [{ exerciseId: 'cable_curl', done: true, type: 'work', weightKg: 40, reps: 9 }] }];
  const pre = T.prefillSets({ exerciseId: 'cable_curl', target: both }, log, [], { style: 'minmax' });
  assert.equal(pre.sets[0].weightKg, 40);
  assert.equal(pre.sets[1].weightKg, T.backOffLoad(40, T.byId('cable_curl')));
  assert.equal(pre.sets[1].backOff, true);
});

test('the volume model keeps the progression it always had', () => {
  const p = T.progressExercise({ sets: 3, repLow: 8, repHigh: 12, rir: 2 },
    [{ done: true, type: 'work', weightKg: 100, reps: 12, rir: 2 }], T.byId('bb_bench'));
  assert.equal(p.action, 'load');
  assert.ok(p.weightKg > 100);
  const held = T.prefillSets({ exerciseId: 'bb_bench', target: { sets: 3, repLow: 8, repHigh: 12, rir: 2 } },
    [{ dateISO: '2026-08-01', sets: [{ exerciseId: 'bb_bench', done: true, type: 'work', weightKg: 100, reps: 10, rir: 2 }] }], []);
  assert.equal(held.sets[0].weightKg, 0, 'it has never put a number in the weight box, and still does not');
  assert.ok(!held.sets[0].backOff);
});

// ---- a brought plan as inspiration ---------------------------------------------------------------
// What somebody brings is a set of choices worth keeping (the movements, the rep ranges, what the
// plan was built around) wrapped around a set that is not (how many days it was photographed across,
// how many sets its author needed, whether it trains everything twice a week). The day count belongs
// to the person answering the wizard, not to the source.

// A plan as a coach might write it: five sessions, chest-led, with movements the library knows.
const broughtFive = () => [
  { name: 'Day 1 - Push', kind: 'full', exercises: [
    { exerciseId: 'bb_bench', order: 0, target: { sets: 4, repLow: 5, repHigh: 8, rir: 2, restSec: 180, tempo: '3110' } },
    { exerciseId: 'db_incline', order: 1, target: { sets: 4, repLow: 8, repHigh: 12, rir: 2, restSec: 120, tempo: '3110' } },
  ] },
  { name: 'Day 2 - Pull', kind: 'full', exercises: [
    { exerciseId: 'lat_pulldown', order: 0, target: { sets: 4, repLow: 8, repHigh: 12, rir: 2, restSec: 120, tempo: null } },
  ] },
  { name: 'Day 3 - Legs', kind: 'full', exercises: [
    { exerciseId: 'back_squat', order: 0, target: { sets: 4, repLow: 5, repHigh: 8, rir: 2, restSec: 180, tempo: null } },
  ] },
  { name: 'Day 4 - Push', kind: 'full', exercises: [
    { exerciseId: 'cable_fly', order: 0, target: { sets: 3, repLow: 12, repHigh: 15, rir: 1, restSec: 90, tempo: null } },
  ] },
  { name: 'Day 5 - Arms', kind: 'full', exercises: [
    { exerciseId: 'ez_curl', order: 0, target: { sets: 3, repLow: 10, repHigh: 12, rir: 1, restSec: 90, tempo: null } },
  ] },
];

test('every movement a test plan names is one the library actually has', () => {
  // Guards the fixture below: an id the library dropped would make these tests pass for the wrong
  // reason, since a brought movement nothing resolves is simply not in the pool.
  for (const d of broughtFive()) {
    for (const e of d.exercises) assert.ok(T.byId(e.exerciseId), `unknown exercise id ${e.exerciseId}`);
  }
});

test('a plan brought across five days builds at the day count the person asked for', () => {
  for (const days of [3, 4, 6]) {
    const block = T.blockFromSource(broughtFive(), { daysPerWeek: days, weeks: 4 });
    assert.equal(T.weekSessions(block, 1).length, days, `asked for ${days} days`);
    assert.equal(block.daysPerWeek, days);
  }
});

test('the movements somebody brought are the ones the block reaches for', () => {
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4 });
  const ids = new Set(T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []));
  const brought = ['bb_bench', 'db_incline', 'lat_pulldown', 'back_squat', 'cable_fly', 'ez_curl'];
  const kept = brought.filter(id => ids.has(id));
  assert.ok(kept.length >= 5, `only ${kept.length} of the brought movements survived: ${[...ids].join(', ')}`);
});

test('a brought movement keeps the rep range and tempo its author wrote', () => {
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4 });
  const bench = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises), []).filter(e => e.exerciseId === 'bb_bench')[0];
  assert.ok(bench, 'the plan opened on a bench press, so the block should too');
  assert.equal(bench.target.repLow, 5);
  assert.equal(bench.target.repHigh, 8);
  assert.equal(bench.target.tempo, '3110', 'the tempo is part of the prescription, not decoration');
});

test('the sets and the effort are ours, not the plan we read them from', () => {
  // The author wrote 4 sets at 2 RIR. Ours starts on intensity and walks proximity to failure down
  // week by week, which is the whole reason this is a build rather than a photocopy.
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4, intensity: 'high' });
  const setsIn = (w) => T.weekSessions(block, w).reduce((a, s) => a + s.exercises.reduce((x, e) => x + e.target.sets, 0), 0);
  const w1 = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises), []);
  const w3 = T.weekSessions(block, 3).reduce((a, s) => a.concat(s.exercises), []);
  assert.ok(setsIn(3) > setsIn(1), 'volume has to climb across the block, which the author never wrote');
  assert.ok(w1[0].target.rir > w3[0].target.rir, 'and so does effort');
});

test('as brought means as brought: the day count and the numbers stay the author"s', () => {
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 3, weeks: 4, shape: 'as-written' });
  assert.equal(T.weekSessions(block, 1).length, 5, 'their five days survive a day count that disagrees');
  const bench = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises), []).filter(e => e.exerciseId === 'bb_bench')[0];
  assert.equal(bench.target.sets, 4, 'and their set counts survive with them');
  const last = T.weekSessions(block, 4).reduce((a, s) => a.concat(s.exercises), []).filter(e => e.exerciseId === 'bb_bench')[0];
  assert.equal(last.target.sets, 4, 'all four weeks, unprogressed, because that is what was asked for');
});

test('an inspired block still answers to the volume landmarks', () => {
  // The point of building rather than copying: no muscle may sit past what the person can recover
  // from, however hard the plan that inspired it went at one of them.
  const targets = T.defaultTargets({ experience: 'intermediate' });
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4, targets: targets });
  for (let w = 1; w <= 4; w++) {
    const cov = T.coverage(T.blockWeekVolume(block, w), targets);
    assert.equal(cov.overs.length, 0, `week ${w} ran past MRV for ${cov.overs.map(r => r.muscle).join(', ')}`);
  }
});

test('a plan built around one muscle carries that priority into the block', () => {
  // Chest is the only thing this plan does at volume, so a block inspired by it should not quietly
  // hand chest the same share as everything else.
  const chestPlan = [{ name: 'Chest', kind: 'full', exercises: [
    { exerciseId: 'bb_bench', order: 0, target: { sets: 6, repLow: 6, repHigh: 10 } },
    { exerciseId: 'db_incline', order: 1, target: { sets: 6, repLow: 8, repHigh: 12 } },
    { exerciseId: 'cable_fly', order: 2, target: { sets: 6, repLow: 12, repHigh: 15 } },
  ] }];
  const insp = T.inspirationFrom(chestPlan, {});
  assert.ok(insp.emphasis.includes('ch'), `chest should read as the priority, got ${insp.emphasis.join(', ')}`);
  const targets = T.defaultTargets({ experience: 'intermediate' });
  const plain = T.blockWeekVolume(T.generateBlock({ daysPerWeek: 4, weeks: 4, targets: targets }), 1);
  const inspired = T.blockWeekVolume(T.blockFromSource(chestPlan, { daysPerWeek: 4, weeks: 4, targets: targets }), 1);
  assert.ok(inspired.ch >= plain.ch, `chest got ${inspired.ch} sets against ${plain.ch} for a block built from nothing`);
});

test('kit you do not have is not chosen just because the plan you brought used it', () => {
  // A brought movement is a preference, never an override: a barbell plan read into a dumbbell-only
  // gym has to come back doing something the person can actually do.
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4, equipment: ['dumbbell', 'cable', 'machine', 'bodyweight'] });
  const ids = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
  for (const id of ids) {
    const ex = T.byId(id);
    assert.ok(['dumbbell', 'cable', 'machine', 'bodyweight'].includes(ex.equipment), `${ex.name} needs kit that is not there`);
  }
});

// ---- lenient with movements, strict about duplicates ---------------------------------------------
// The two halves of the same wish: keep everything somebody brought, however long the list, and never
// let one movement appear twice because two screenshots spelled it differently.

test('a plan with more movements than a split would pick keeps all of them', () => {
  const big = [
    { name: 'Push', kind: 'full', exercises: [
      { exerciseId: 'bb_bench', order: 0, target: { sets: 4, repLow: 6, repHigh: 8 } },
      { exerciseId: 'db_incline', order: 1, target: { sets: 3, repLow: 8, repHigh: 12 } },
      { exerciseId: 'cable_fly', order: 2, target: { sets: 3, repLow: 12, repHigh: 15 } },
      { exerciseId: 'db_lateral', order: 3, target: { sets: 4, repLow: 12, repHigh: 15 } },
      { exerciseId: 'rope_pushdown', order: 4, target: { sets: 3, repLow: 10, repHigh: 12 } },
    ] },
    { name: 'Pull', kind: 'full', exercises: [
      { exerciseId: 'lat_pulldown', order: 0, target: { sets: 4, repLow: 8, repHigh: 12 } },
      { exerciseId: 'seated_cable_row', order: 1, target: { sets: 3, repLow: 10, repHigh: 12 } },
      { exerciseId: 'face_pull', order: 2, target: { sets: 3, repLow: 12, repHigh: 15 } },
      { exerciseId: 'ez_curl', order: 3, target: { sets: 3, repLow: 10, repHigh: 12 } },
      { exerciseId: 'hammer_curl', order: 4, target: { sets: 3, repLow: 10, repHigh: 12 } },
    ] },
    { name: 'Legs', kind: 'full', exercises: [
      { exerciseId: 'back_squat', order: 0, target: { sets: 4, repLow: 5, repHigh: 8 } },
      { exerciseId: 'rdl', order: 1, target: { sets: 3, repLow: 8, repHigh: 10 } },
      { exerciseId: 'leg_press', order: 2, target: { sets: 3, repLow: 10, repHigh: 15 } },
      { exerciseId: 'leg_extension', order: 3, target: { sets: 3, repLow: 12, repHigh: 15 } },
      { exerciseId: 'standing_calf', order: 4, target: { sets: 4, repLow: 10, repHigh: 15 } },
    ] },
  ];
  for (const d of big) for (const e of d.exercises) assert.ok(T.byId(e.exerciseId), `unknown id ${e.exerciseId}`);
  // Three days, sixty minutes: a split of its own would pick about six movements a session and the
  // other half of their plan would quietly not exist.
  const block = T.blockFromSource(big, { daysPerWeek: 3, weeks: 4, sessionMinutes: 60 });
  const inBlock = new Set(T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []));
  const missing = block.brought.filter(id => !inBlock.has(id));
  assert.equal(block.brought.length, 15);
  assert.deepEqual(missing, [], `brought movements left out: ${missing.join(', ')}`);
  assert.deepEqual(block.broughtSpare, []);
});

test('being lenient never means doing a movement twice', () => {
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4 });
  const ids = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
  assert.equal(new Set(ids).size, ids.length, `the same movement twice in one week: ${ids.join(', ')}`);
  // And not under two names either: the library holds one entry per movement, so a name collision
  // here would mean two entries the app thinks are different lifts.
  const names = ids.map(id => T.byId(id).name);
  assert.equal(new Set(names).size, names.length);
});

test('a movement needing kit the gym has not got is set aside, not forced in', () => {
  const block = T.blockFromSource(broughtFive(), { daysPerWeek: 4, weeks: 4, equipment: ['dumbbell', 'cable', 'machine', 'bodyweight'] });
  assert.ok(block.broughtSpare.includes('bb_bench'), 'a barbell bench in a gym with no barbell cannot go in');
  const ids = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
  assert.ok(!ids.includes('bb_bench'), 'and it must not sneak in anyway');
});

test('the same movement spelled two ways is one movement in the library', () => {
  // What five screenshots of one programme actually do: each parse is blind to the others, so the
  // coach's own name for a machine arrives in a different word order every time.
  const a = T.importTemplate({ days: [{ name: 'Day 1', exercises: [
    { name: 'Zercher Yoke Carry Sled XR7', sets: 3, muscle: ['qu'], equipment: 'machine', pattern: 'compound' },
  ] }] });
  const b = T.importTemplate({ days: [{ name: 'Day 2', exercises: [
    { name: 'Yoke Zercher Sled Carry XR7', sets: 3, muscle: ['qu'], equipment: 'machine', pattern: 'compound' },
  ] }] });
  assert.equal(a.newCustom.length, 1);
  assert.equal(b.newCustom.length, 1);
  const merged = T.mergeCustom([], a.newCustom.concat(b.newCustom));
  assert.equal(merged.custom.length, 1, 'one movement, one entry');
  T.remapDays(b.template, merged.map);
  assert.equal(b.template[0].exercises[0].exerciseId, merged.custom[0].id, 'and the day points at the one that survived');
});

test('a minted guess that turns out to be a real library movement defers to it', () => {
  const minted = [{ id: 'cu_auto_press_bench_barbell', name: 'Press bench barbell', equipment: 'barbell', pattern: 'compound', primary: ['ch'], custom: true, auto: true }];
  const merged = T.mergeCustom([], minted);
  assert.equal(merged.custom.length, 0, 'the library already describes it properly');
  assert.equal(merged.map.cu_auto_press_bench_barbell, 'bb_bench');
});

test('one parse that names a movement twice mints it once', () => {
  const res = T.importTemplate({ days: [
    { name: 'Day 1', exercises: [{ name: 'Zercher Yoke Carry Sled XR7', sets: 3, muscle: ['qu'], equipment: 'machine', pattern: 'compound' }] },
    { name: 'Day 2', exercises: [{ name: 'Yoke Zercher Sled Carry XR7', sets: 3, muscle: ['qu'], equipment: 'machine', pattern: 'compound' }] },
  ] });
  assert.equal(res.newCustom.length, 1);
  assert.equal(res.template[0].exercises[0].exerciseId, res.template[1].exercises[0].exerciseId);
});

// ---- overlapping screenshots -------------------------------------------------------------------
// The other half of the same bug, from the other direction: five screenshots going in and EIGHT days
// coming out. Phone shots of a coaching app overlap, so the tail of Tuesday rides along under the top
// of Wednesday and Tuesday arrives twice from two files that have never been read before. Name
// disambiguation turned the second reading into "Push (2)" and the week grew past seven days, which
// is not a week any more: nothing in the app can put a session on the eighth day.

const ex = (id, n) => ({ exerciseId: id, id: id + '_' + n, target: { sets: 3 } });
const session = (name, ids) => ({ name: name, kind: 'full', exercises: ids.map((id, i) => ex(id, i)) });

test('a session caught in two overlapping screenshots lands as one day, not two', () => {
  const days = [];
  // Shot two catches the whole of Tuesday. Shot three catches its last two movements above the whole
  // of Wednesday, so Tuesday comes back a second time with only part of itself.
  T.mergeDraftDays(days, [session('Day 2', ['bb_bench', 'db_incline', 'cable_fly', 'lateral_raise'])], { kind: 'file', name: 'shot2.png' });
  T.mergeDraftDays(days, [session('Day 2', ['cable_fly', 'lateral_raise']), session('Day 3', ['back_squat', 'leg_curl', 'leg_press'])], { kind: 'file', name: 'shot3.png' });
  assert.equal(days.length, 2, 'the repeated session must merge rather than become "Day 2 (2)"');
  assert.equal(days[0].exercises.length, 4, 'and the fuller reading of it is the one kept');
  assert.deepEqual(days.map(d => d.name), ['Day 2', 'Day 3']);
});

test('the fuller reading wins even when it arrives second', () => {
  const days = [];
  T.mergeDraftDays(days, [session('Push', ['bb_bench', 'lateral_raise'])], { kind: 'file', name: 'a.png' });
  T.mergeDraftDays(days, [session('Push', ['bb_bench', 'lateral_raise', 'cable_fly', 'triceps_pushdown'])], { kind: 'file', name: 'b.png' });
  assert.equal(days.length, 1);
  assert.equal(days[0].exercises.length, 4);
  assert.equal(days[0].sourceRef.name, 'b.png', 'the day now belongs to the shot that saw all of it');
});

test('two different days that share their staples are still two days', () => {
  // Upper A and Upper B share a bench and a row and are not the same session. Collapsing them would
  // lose a session nobody would notice was missing, which is worse than an extra day to delete.
  const days = [];
  T.mergeDraftDays(days, [session('Upper A', ['bb_bench', 'bb_row', 'lateral_raise', 'ez_curl'])], { kind: 'file', name: 'a.png' });
  T.mergeDraftDays(days, [session('Upper B', ['bb_bench', 'bb_row', 'rear_delt_fly', 'triceps_pushdown'])], { kind: 'file', name: 'b.png' });
  assert.equal(days.length, 2);
});

test('two sessions that happen to be named the same are not merged on the name alone', () => {
  const days = [];
  T.mergeDraftDays(days, [session('Day 1', ['bb_bench', 'db_incline', 'cable_fly'])], { kind: 'file', name: 'a.png' });
  T.mergeDraftDays(days, [session('Day 1', ['back_squat', 'leg_curl', 'leg_press'])], { kind: 'file', name: 'b.png' });
  assert.equal(days.length, 2, 'nothing in common means nothing to merge');
});

test('a basket bigger than a week never puts a session on an eighth day', () => {
  // Eight distinct sessions is a lot, but the app must still be able to schedule every one of them:
  // dayOfWeek 7 is off the end of the weekday labels and off the end of the schedule.
  const days = [];
  for (let i = 0; i < 8; i++) {
    T.mergeDraftDays(days, [session('Day ' + (i + 1), ['ex_' + i + '_a', 'ex_' + i + '_b'])], { kind: 'file', name: i + '.png' });
  }
  assert.equal(days.length, 8);
  assert.ok(days.every(d => d.dayOfWeek >= 0 && d.dayOfWeek <= 6), 'every day has to fall inside the week');
});

test('a block built from more days than a week holds keeps every session inside the week', () => {
  const template = [];
  for (let i = 0; i < 8; i++) template.push(session('Day ' + (i + 1), ['ex_' + i + '_a', 'ex_' + i + '_b']));
  const block = T.blockFromTemplate(template, { weeks: 1 });
  const dows = T.weekSessions(block, 1).map(s => s.dayOfWeek);
  assert.equal(dows.length, 8, 'nothing is dropped');
  assert.ok(dows.every(d => d >= 0 && d <= 6), `a session landed off the week: ${dows}`);
});

test('a day that programmes one movement twice keeps both lines apart', () => {
  // A heavy T-bar row and a back-off T-bar row is an ordinary way to write a session, and the two
  // carry different prescriptions. They must not collapse into each other anywhere.
  const { template } = T.importTemplate({ days: [{ name: 'Day 1', exercises: [
    { name: 'T-Bar Row', sets: 2, repLow: 6 },
    { name: 'T-Bar Row', sets: 1, repLow: 8 },
  ] }] });
  const days = T.mergeDraftDays([], template, { kind: 'file', name: 'a.png' });
  assert.equal(days[0].exercises.length, 2);
  assert.notEqual(days[0].exercises[0].id, days[0].exercises[1].id);
  const block = T.blockFromTemplate(days, { weeks: 4, shape: 'as-written', targets: T.defaultTargets() });
  const s = T.weekSessions(block, 1)[0];
  assert.equal(s.exercises.length, 2);
  assert.notEqual(s.exercises[0].id, s.exercises[1].id);
  assert.deepEqual(s.exercises.map(e => e.target.sets), [2, 1], 'the two prescriptions must stay distinct');
});

test('collected days become a block with every day intact', () => {
  // The end of the journey the bug broke: five screenshots in, five sessions in week 1.
  const days = [];
  ['a', 'b', 'c'].forEach(f => {
    const { template } = T.importTemplate({ days: [{ name: 'Day 1', exercises: [{ name: 'Bench Press', sets: 3 }] }] });
    T.mergeDraftDays(days, template, { kind: 'file', name: f + '.png' });
  });
  const block = T.blockFromTemplate(days, { weeks: 4, targets: T.defaultTargets(), source: 'import' });
  assert.equal(T.weekSessions(block, 1).length, 3);
});

// ---- running the same block again ----------------------------------------------------------------
// The alternative to generating a fresh block: keep the plan somebody chose and change what did not
// work in it. What it proposes is what the evidence supports proposing, and nothing more.

function ranBlock(opts) {
  opts = opts || {};
  const { template } = T.importTemplate({ days: [
    { name: 'Day 1', exercises: [{ name: 'Bench Press', sets: 2, repLow: 6 }, { name: 'Lat Pulldown', sets: 2, repLow: 8 }] },
    { name: 'Day 2', exercises: [{ name: 'Back Squat', sets: 2, repLow: 8 }] },
  ] });
  const targets = T.defaultTargets();
  const block = T.blockFromTemplate(template, { weeks: 4, shape: 'as-written', targets, name: 'Coach block', startISO: '2026-07-06', source: 'import' });
  const logs = [];
  const weeks = opts.weeks == null ? 4 : opts.weeks;
  for (let w = 1; w <= weeks; w++) {
    T.weekSessions(block, w).forEach((s, si) => {
      logs.push({
        id: 'l' + w + si, dateISO: '2026-07-' + String(6 + (w - 1) * 7 + si).padStart(2, '0'),
        blockId: block.id, sessionId: s.id, name: s.name,
        sets: s.exercises.flatMap(e => Array.from({ length: e.target.sets }, (_, i) => ({
          exerciseId: e.exerciseId, itemId: e.id, setIndex: i, done: true, reps: 8,
          // Bench never moves; everything else climbs.
          weightKg: e.exerciseId === 'bb_bench' ? 60 : 50 + w * 2.5,
        }))),
      });
    });
  }
  return { block, logs, targets };
}

test('a lift that stopped moving is the one it proposes changing', () => {
  const { block, logs, targets } = ranBlock();
  const plan = T.rerunPlan(block, logs, targets, []);
  const swaps = plan.changes.filter(c => c.kind === 'swap');
  assert.equal(swaps.length, 1, 'only the stalled lift should be swapped');
  assert.equal(swaps[0].from, 'bb_bench');
  assert.notEqual(swaps[0].to, 'bb_bench');
  assert.ok(swaps[0].why.length > 20, 'a proposal without a reason is not a proposal');
});

test('lifts that moved are named and left alone', () => {
  const { block, logs, targets } = ranBlock();
  const plan = T.rerunPlan(block, logs, targets, []);
  const kept = plan.changes.filter(c => c.kind === 'keep').map(c => c.from);
  assert.ok(kept.includes('lat_pulldown'), 'a lift that progressed should be kept, and said to be kept');
  assert.ok(!plan.changes.some(c => c.kind === 'swap' && c.from === 'lat_pulldown'));
});

test('a block you barely ran is never given more work', () => {
  // Under about 70 percent finished, the plan was too big for the life around it. Adding to it is
  // the one change that cannot help.
  const { block, logs, targets } = ranBlock({ weeks: 1 });
  const plan = T.rerunPlan(block, logs, targets, []);
  assert.equal(plan.canGrow, false);
  assert.equal(plan.changes.filter(c => c.kind === 'sets').length, 0);
  assert.match(plan.headline, /smaller/);
});

test('nothing proposed pushes a muscle past its ceiling', () => {
  const { block, logs, targets } = ranBlock();
  const plan = T.rerunPlan(block, logs, targets, []);
  const next = T.applyRerun(block, plan.changes.filter(c => c.kind !== 'keep'), { targets, custom: [] });
  for (let w = 1; w <= 4; w++) {
    const over = T.coverage(T.blockWeekVolume(next, w), targets).rows.filter(r => r.band === 'over');
    assert.deepEqual(over.map(r => r.label), [], `week ${w} of the rerun went over MRV`);
  }
});

test('turning every proposal down gives back the plan you already had', () => {
  const { block, logs, targets } = ranBlock();
  const same = T.applyRerun(block, [], { targets, custom: [] });
  assert.deepEqual(
    T.weekSessions(same, 1).map(s => s.exercises.map(e => e.exerciseId + ':' + e.target.sets)),
    T.weekSessions(block, 1).map(s => s.exercises.map(e => e.exerciseId + ':' + e.target.sets)),
    'declining everything must not quietly change the block'
  );
});

test('a rerun keeps the shape it was run under', () => {
  // An imported plan stays as written on its second run too, rather than quietly acquiring the
  // app's own periodisation on the way through.
  const { block, logs, targets } = ranBlock();
  const next = T.applyRerun(block, T.rerunPlan(block, logs, targets, []).changes.filter(c => c.kind !== 'keep'), { targets, custom: [] });
  assert.equal(next.shape, 'as-written');
  const setsPerWeek = [1, 2, 3, 4].map(w => T.weekSessions(next, w)[0].exercises.map(e => e.target.sets).join(','));
  assert.equal(new Set(setsPerWeek).size, 1, `as-written was lost across the rerun: ${setsPerWeek}`);
  assert.equal(next.previousBlockId, block.id);
});

test('each run of a block says which run it is', () => {
  assert.equal(T.nextRunName("Cam Kissel's Program"), "Cam Kissel's Program, run 2");
  assert.equal(T.nextRunName("Cam Kissel's Program, run 2"), "Cam Kissel's Program, run 3");
  assert.equal(T.nextRunName("Cam Kissel's Program, run 9"), "Cam Kissel's Program, run 10");
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

// ---- naming a block ------------------------------------------------------------------------------
// Every generated block used to be called "4-week growth block", so three of them were three
// identically-named blocks. Everything needed to tell them apart is known when they are built.

test('a generated block is named for its shape, its days and what it brings up', () => {
  const targets = T.defaultTargets();
  const name = o => T.generateBlock(Object.assign({ weeks: 4, targets }, o)).name;
  assert.equal(name({ daysPerWeek: 4, goal: 'hypertrophy' }), 'Upper/lower, 4 days');
  assert.equal(name({ daysPerWeek: 6, goal: 'hypertrophy' }), 'Push pull legs, 6 days');
  assert.equal(name({ daysPerWeek: 3, goal: 'hypertrophy' }), 'Full body, 3 days');
  assert.equal(name({ daysPerWeek: 4, goal: 'strength' }), 'Upper/lower, 4 days, for strength');
  assert.equal(name({ daysPerWeek: 4, goal: 'hypertrophy', emphasis: ['sd', 'fd'] }), 'Upper/lower, 4 days, shoulders up');
});

test('two blocks that differ only in emphasis get different names', () => {
  // The whole point: the thing that tells them apart has to reach the name.
  const targets = T.defaultTargets();
  const a = T.generateBlock({ weeks: 4, targets, daysPerWeek: 4, goal: 'hypertrophy', emphasis: ['ch'] });
  const b = T.generateBlock({ weeks: 4, targets, daysPerWeek: 4, goal: 'hypertrophy', emphasis: ['qu', 'ha'] });
  assert.notEqual(a.name, b.name);
});

test('a name never lists more than two body parts', () => {
  // A name reciting four body parts has stopped being a name.
  const targets = T.defaultTargets();
  const n = T.generateBlock({ weeks: 4, targets, daysPerWeek: 4, goal: 'hypertrophy', emphasis: ['ch', 'bi', 'tr', 'qu', 'ca'] }).name;
  assert.ok(n.split(' and ').length <= 2, n);
  assert.ok(n.length < 46, `too long to sit on a card: "${n}"`);
});

test('an imported plan keeps the name its author gave it', () => {
  const { template } = T.importTemplate({ days: [{ name: 'Day 1', exercises: [{ name: 'Bench Press', sets: 3 }] }] });
  const b = T.blockFromTemplate(template, { weeks: 4, targets: T.defaultTargets(), name: "Cam Kissel's Program" });
  assert.equal(b.name, "Cam Kissel's Program");
});

// ---- the movement's own name ---------------------------------------------------------------------
// An imported movement has two names. The library's match is what the maths counts; the plan's own
// words are what the person reads, because it is their coach's session.

test('a movement keeps the words its plan used, tidied', () => {
  const cases = [
    ['CAM - SPLIT SQUAT SMITH MACHINE', 'Smith machine split squat'],
    ['CAM - MACHINE REAR DELT FLY', 'Machine rear delt fly'],
    ['CAM - ALTERNATING DUMBBELL HAMMER CURL', 'Alternating dumbbell hammer curl'],
    ['CAM - FRENCH PRESS (OHTX)', 'French press'],
    ['CAM - T-BAR ROW (MEGA MASS)', 'T-bar row'],
    ['CAM - DB SEATED SHOULDER PRESS', 'Dumbbell seated shoulder press'],
    ['Leg curl machine', 'Machine leg curl'],
    ['Bench Press', 'Bench press'],
  ];
  for (const [input, expected] of cases) assert.equal(T.tidyName(input), expected, `"${input}"`);
});

test('the source name reaches the imported item, and the library match stays underneath', () => {
  const { template } = T.importTemplate({ days: [{ name: 'Day 2', exercises: [
    { name: 'CAM - SPLIT SQUAT SMITH MACHINE', sets: 1, repLow: 6 },
  ] }] });
  const it = template[0].exercises[0];
  assert.equal(it.sourceName, 'Smith machine split squat');
  assert.equal(it.exerciseId, 'split_squat', 'the maths still counts a real library movement');
});

test('only a movement worth a second look is marked', () => {
  // A screen that says "counted as" on every line says nothing. Kit the library has no version of,
  // and a match that only just cleared the threshold. Nothing else.
  const names = ['CAM - SMITH MACHINE INCLINE PRESS', 'CAM - MACHINE LAT PULLDOWN', 'CAM - T-BAR ROW (MEGA MASS)',
    'CAM - HANGING LEG RAISES', 'CAM - LEG EXTENSIONS', 'CAM - SPLIT SQUAT SMITH MACHINE',
    'CAM - FRENCH PRESS (OHTX)', 'CAM - MACHINE REAR DELT FLY'];
  const { template } = T.importTemplate({ days: [{ name: 'D', exercises: names.map(n => ({ name: n, sets: 2, repLow: 8 })) }] });
  const marked = template[0].exercises.filter(e => e.check).map(e => e.sourceName);
  assert.deepEqual(marked.sort(), ['French press', 'Machine rear delt fly', 'Smith machine split squat'].sort());
});

test('a plural is not a substitution worth flagging', () => {
  const { template } = T.importTemplate({ days: [{ name: 'D', exercises: [
    { name: 'CAM - HANGING LEG RAISES', sets: 2 }, { name: 'CAM - LEG EXTENSIONS', sets: 2 },
    { name: 'CAM - T-BAR ROW (MEGA MASS)', sets: 2 },
  ] }] });
  assert.deepEqual(template[0].exercises.map(e => e.check), [null, null, null]);
});

test('a movement nothing could place is kept on its own day, auto-created not dropped', () => {
  const { template } = T.importTemplate({ days: [{ name: 'Day 3', exercises: [
    { name: 'CAM - MACHINE LATERAL RAISE', sets: 2 },
    { name: 'the finisher coach showed me', sets: 2 },
  ] }] });
  assert.equal(template[0].exercises.length, 2, 'both movements ride with the day, including the guessed one');
  assert.deepEqual(template[0].missing, [], 'missing is always empty now - nothing is ever left off a day');
  assert.equal(template[0].exercises[1].check, 'auto');
});

// ---- a variation of a movement you already have ---------------------------------------------------
// "Wide grip T-bar row" is a T-bar row. The hard part of adding a movement is saying what it trains,
// and a variation of something in the library trains what that trains.

test('a variation inherits everything but its name', () => {
  const v = T.variationOf('tbar_row', 'Wide grip T-bar row');
  const p = T.byId('tbar_row');
  assert.equal(v.name, 'Wide grip T-bar row');
  assert.deepEqual(v.primary, p.primary);
  assert.deepEqual(v.secondary, p.secondary);
  assert.equal(v.equipment, p.equipment);
  // Pattern and profile decide warm-up ramps and which gaps it can fill. A wide-grip row is still a
  // horizontal pull, so guessing "isolation" would quietly mis-file it.
  assert.equal(v.pattern, p.pattern);
  assert.equal(v.profile, p.profile);
  assert.equal(v.variantOf, 'tbar_row');
});

test('a variation of nothing, or of nothing named, is refused', () => {
  assert.equal(T.variationOf('tbar_row', '   '), null);
  assert.equal(T.variationOf('no_such_exercise', 'Whatever'), null);
});

test('a variation still counts toward volume, exactly as its parent would', () => {
  const v = Object.assign({ id: 'cu_wide' }, T.variationOf('tbar_row', 'Wide grip T-bar row'));
  const day = [{ exercises: [{ exerciseId: 'cu_wide', target: { sets: 3 } }] }];
  const asParent = [{ exercises: [{ exerciseId: 'tbar_row', target: { sets: 3 } }] }];
  assert.deepEqual(T.plannedVolume(day, [v]), T.plannedVolume(asParent, []));
});

// ---- changing a movement for the rest of a block --------------------------------------------------

function blockWithRows() {
  const { template } = T.importTemplate({ days: [
    { name: 'Day 1', exercises: [{ name: 'T-Bar Row', sets: 2 }, { name: 'Lat Pulldown', sets: 2 }] },
    { name: 'Day 4', exercises: [{ name: 'T-Bar Row', sets: 2 }] },
  ] });
  return T.blockFromTemplate(template, { weeks: 4, shape: 'as-written', targets: T.defaultTargets() });
}

test('a swap applied to the block never rewrites a week already trained', () => {
  // Those weeks are a record of what actually happened. Editing them to match a decision made
  // afterwards would make the history lie about what was lifted.
  const block = blockWithRows();
  const changed = T.swapInBlock(block, 'tbar_row', 'cu_wide', 2);
  assert.equal(changed, 6, 'weeks 2 to 4, both days each');
  assert.deepEqual(T.weekSessions(block, 1).map(s => s.exercises.map(e => e.exerciseId)),
    [['tbar_row', 'lat_pulldown'], ['tbar_row']], 'week 1 was already trained and must be untouched');
  for (const w of [2, 3, 4]) {
    const ids = T.weekSessions(block, w).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
    assert.ok(!ids.includes('tbar_row'), `week ${w} still has the old movement`);
    assert.ok(ids.includes('cu_wide'), `week ${w} did not get the new one`);
  }
});

test('a swap leaves every other movement alone', () => {
  const block = blockWithRows();
  T.swapInBlock(block, 'tbar_row', 'cu_wide', 1);
  const pulldowns = block.sessions.reduce((a, s) => a + s.exercises.filter(e => e.exerciseId === 'lat_pulldown').length, 0);
  assert.equal(pulldowns, 4, 'the other movement is not ours to touch');
});

test('the question knows how many sessions it is asking about', () => {
  // Asked in the abstract it is unanswerable; "changes 6 sessions from this week on" is a decision.
  const block = blockWithRows();
  assert.equal(T.swapReach(block, 'tbar_row', 1), 8);
  assert.equal(T.swapReach(block, 'tbar_row', 2), 6);
  assert.equal(T.swapReach(block, 'tbar_row', 4), 2);
  assert.equal(T.swapReach(block, 'not_in_here', 1), 0, 'nothing to ask about');
});

// ---- bringing an older block up to date -----------------------------------------------------------
// A block built before a rule existed does not get the rule retroactively.

function oldStyleBlock() {
  const { template } = T.importTemplate({ days: [
    { name: 'Day 1', exercises: [{ name: 'Bench Press', sets: 2 }, { name: 'Lat Pulldown', sets: 2 }] },
    { name: 'Day 2', exercises: [{ name: 'Back Squat', sets: 2 }, { name: 'Leg Extension', sets: 2 }] },
  ] });
  template.forEach((d, i) => { d.name = 'Day ' + (i + 1); });   // as an older import left them
  const b = T.blockFromTemplate(template, { weeks: 4, shape: 'build3-deload1', targets: T.defaultTargets(), source: 'import', startISO: '2026-08-03' });
  b.name = '4-week growth block';
  return b;
}

test('it offers exactly what can be repaired from the block itself', () => {
  const kinds = T.blockFixes(oldStyleBlock(), []).map(f => f.kind);
  assert.deepEqual(kinds.sort(), ['asWritten', 'blockName', 'dayName', 'dayName'].sort());
});

test('a block already built the new way has nothing to offer', () => {
  const { template } = T.importTemplate({ days: [{ name: 'Upper A', exercises: [{ name: 'Bench Press', sets: 2 }] }] });
  const b = T.blockFromTemplate(template, { weeks: 4, shape: 'as-written', targets: T.defaultTargets(), source: 'import', name: "Cam's plan" });
  assert.deepEqual(T.blockFixes(b, []), []);
});

test('repairing a block never re-mints an id', () => {
  // Logged sessions and logged sets point back at these. Rebuilding the block to tidy its names
  // would cost the history the repair was supposed to be tidying.
  const b = oldStyleBlock();
  const before = JSON.stringify(b.sessions.map(s => [s.id, s.exercises.map(e => e.id)]));
  T.applyBlockFixes(b, ['dayName', 'blockName', 'asWritten'], []);
  assert.equal(JSON.stringify(b.sessions.map(s => [s.id, s.exercises.map(e => e.id)])), before);
});

test('as-written copies week one across and drops the deload', () => {
  const b = oldStyleBlock();
  T.applyBlockFixes(b, ['asWritten'], []);
  const perWeek = [1, 2, 3, 4].map(w => T.weekSessions(b, w).map(s => s.exercises.map(e => e.target.sets).join('/')).join(' '));
  assert.equal(new Set(perWeek).size, 1, `weeks still differ: ${perWeek}`);
  assert.ok(!b.sessions.some(s => s.deload), 'a deload its author never wrote');
  assert.equal(b.shape, 'as-written');
});

test('each repair can be taken on its own', () => {
  const b = oldStyleBlock();
  T.applyBlockFixes(b, ['dayName'], []);
  assert.equal(b.sessions[0].name, 'Day 1 - Chest and back');
  assert.equal(b.name, '4-week growth block', 'nothing else was touched');
  assert.equal(b.shape, 'build3-deload1', 'nothing else was touched');
});

// ---- trainingSummary: the one shape the buddy reads training from -------------------------------
// Everything buddy-side (the chat snapshot, the Today coach line, the session sign-off) reads this,
// so a wrong field here is the buddy contradicting the Train tab out loud.

function sessionLog(dateISO, over) {
  return Object.assign({
    id: 'log_' + dateISO, dateISO, name: 'Upper A', blockId: null, sessionId: null,
    sets: [
      { exerciseId: 'bb_bench', weightKg: 80, reps: 5, done: true, type: 'work' },
      { exerciseId: 'bb_bench', weightKg: 80, reps: 5, done: true, type: 'work' },
    ],
  }, over || {});
}

test('trainingSummary reads an empty training slice without inventing anything', () => {
  const s = T.trainingSummary({}, '2026-08-09');
  assert.equal(s.everTrained, false);
  assert.equal(s.sessions, 0);
  assert.equal(s.trainedToday, false);
  assert.equal(s.daysSinceSession, null, 'never trained is not "0 days ago"');
  assert.equal(s.block, null);
  assert.deepEqual(s.stalledLifts, []);
});

test('trainingSummary counts the recent windows and dates the last session', () => {
  const s = T.trainingSummary({
    logs: [sessionLog('2026-08-09'), sessionLog('2026-08-06'), sessionLog('2026-07-20'), sessionLog('2026-05-01')],
  }, '2026-08-09');
  assert.equal(s.trainedToday, true);
  assert.equal(s.daysSinceSession, 0);
  assert.equal(s.sessionsLast7, 2, 'today and three days ago');
  assert.equal(s.sessionsLast28, 3, 'the May session is outside the window');
  assert.equal(s.sessions, 4, 'but it still counts toward the lifetime total');
  assert.equal(s.tonnageLast7Kg, 1600, '2 sessions x 2 sets x 80kg x 5 reps');
});

test('trainingSummary dates a lapse from the last session, not from today', () => {
  const s = T.trainingSummary({ logs: [sessionLog('2026-08-01')] }, '2026-08-09');
  assert.equal(s.trainedToday, false);
  assert.equal(s.daysSinceSession, 8);
  assert.equal(s.sessionsLast7, 0);
});

test('trainingSummary reports the running block the way the Train tab picks it', () => {
  const b = T.generateBlock({ daysPerWeek: 3, weeks: 4, targets: T.defaultTargets() });
  b.id = 'blk1'; b.name = 'Summer growth'; b.startISO = '2026-08-03';   // week 1 starts the Monday
  const wk1 = T.weekSessions(b, 1);
  const s = T.trainingSummary({
    blocks: [b],
    logs: [sessionLog('2026-08-04', { blockId: 'blk1', sessionId: wk1[0].id })],
  }, '2026-08-05');
  assert.equal(s.block.name, 'Summer growth');
  assert.equal(s.block.week, 1);
  assert.equal(s.block.weeks, 4);
  assert.equal(s.block.sessionsThisWeek, wk1.length);
  assert.equal(s.block.doneThisWeek, 1);
  assert.equal(s.block.nextSession, wk1[1].name, 'the first session this week without a log');
  assert.equal(s.block.finished, false);
});

test('trainingSummary ignores archived and unstarted blocks', () => {
  const a = T.generateBlock({ daysPerWeek: 3, weeks: 4, targets: T.defaultTargets() });
  a.id = 'old'; a.startISO = '2026-06-01'; a.archived = true;
  const b = T.generateBlock({ daysPerWeek: 3, weeks: 4, targets: T.defaultTargets() });
  b.id = 'draft'; b.startISO = null;
  assert.equal(T.trainingSummary({ blocks: [a, b], logs: [] }, '2026-08-09').block, null);
});

test('trainingSummary only names a stall backed by three sessions in the last month', () => {
  const flat = (d) => sessionLog(d, { sets: [{ exerciseId: 'bb_bench', weightKg: 80, reps: 5, done: true, type: 'work' }] });
  const two = T.trainingSummary({ logs: [flat('2026-08-01'), flat('2026-08-05')] }, '2026-08-09');
  assert.deepEqual(two.stalledLifts, [], 'two flat sessions is not yet a stall');
  const three = T.trainingSummary({ logs: [flat('2026-08-01'), flat('2026-08-05'), flat('2026-08-08')] }, '2026-08-09');
  assert.deepEqual(three.stalledLifts, ['Barbell bench press']);
});

test('trainingSummary does not call a rising lift stalled', () => {
  const up = (d, kg) => sessionLog(d, { sets: [{ exerciseId: 'bb_bench', weightKg: kg, reps: 5, done: true, type: 'work' }] });
  const s = T.trainingSummary({ logs: [up('2026-08-01', 80), up('2026-08-05', 85), up('2026-08-08', 90)] }, '2026-08-09');
  assert.deepEqual(s.stalledLifts, []);
});

// ---- editing a planned session, without starting it ---------------------------------------------
// The only way to change tonight's plan used to be to start the session, which stamps a start time
// and leaves a phantom log behind. These are the operations that made that unnecessary.

function planned() {
  return {
    id: 's1', week: 2, name: 'Upper A', dayOfWeek: 3,
    exercises: [
      { id: 'i1', exerciseId: 'bb_bench', order: 0, target: { sets: 4, repLow: 6, repHigh: 10, rir: 2, restSec: 150 } },
      { id: 'i2', exerciseId: 'bb_row', order: 1, target: { sets: 4, repLow: 6, repHigh: 10, rir: 2, restSec: 150 } },
      { id: 'i3', exerciseId: 'db_lateral', order: 2, target: { sets: 3, repLow: 12, repHigh: 15, rir: 1, restSec: 90 } },
    ],
  };
}
const ids = (s) => T.sessionItems(s).map(e => e.id);

test('moveExercise reorders and renumbers densely', () => {
  const s = planned();
  assert.equal(T.moveExercise(s, 'i3', -1), true);
  assert.deepEqual(ids(s), ['i1', 'i3', 'i2']);
  assert.deepEqual(T.sessionItems(s).map(e => e.order), [0, 1, 2], 'order must match the list on screen');
});

test('moveExercise refuses to walk off either end', () => {
  const s = planned();
  assert.equal(T.moveExercise(s, 'i1', -1), false);
  assert.equal(T.moveExercise(s, 'i3', 1), false);
  assert.deepEqual(ids(s), ['i1', 'i2', 'i3'], 'and changes nothing when it refuses');
});

test('moveExercise survives an import with duplicate order values', () => {
  const s = planned();
  s.exercises.forEach(e => { e.order = 0; });   // what a sloppy import leaves behind
  T.moveExercise(s, 'i1', 1);
  assert.deepEqual(T.sessionItems(s).map(e => e.order), [0, 1, 2]);
});

test('toggleSuperset pairs a movement with the next one, and unpairs both', () => {
  const s = planned();
  assert.equal(T.toggleSuperset(s, 'i1'), true);
  const g = T.sessionItems(s)[0].supersetGroup;
  assert.ok(g);
  assert.equal(T.sessionItems(s)[1].supersetGroup, g, 'the pair shares one group');
  assert.equal(T.sessionItems(s)[2].supersetGroup, undefined);
  assert.equal(T.toggleSuperset(s, 'i2'), true, 'either leg breaks it');
  assert.ok(!T.sessionItems(s)[0].supersetGroup);
  assert.ok(!T.sessionItems(s)[1].supersetGroup);
});

test('toggleSuperset has nothing to pair the last movement with', () => {
  assert.equal(T.toggleSuperset(planned(), 'i3'), false);
});

test('toggleSuperset will not steal a leg out of an existing pair', () => {
  const s = planned();
  T.toggleSuperset(s, 'i2');                     // i2 + i3 are now a pair
  assert.equal(T.toggleSuperset(s, 'i1'), false, 'i2 is spoken for');
});

test('a superset breaks when its legs stop being adjacent', () => {
  // The pair IS the promise "these two back to back". Moving one away makes the label a lie.
  const s = planned();
  T.toggleSuperset(s, 'i1');
  T.moveExercise(s, 'i1', 2);                    // one leg walks to the bottom of the session
  assert.deepEqual(ids(s), ['i2', 'i3', 'i1']);
  assert.ok(T.sessionItems(s).every(e => !e.supersetGroup), 'the broken pair is cleared, not left lying');
});

test('removing one leg of a superset clears the orphan', () => {
  const s = planned();
  T.toggleSuperset(s, 'i1');
  T.removeExerciseFromSession(s, 'i2');
  assert.deepEqual(ids(s), ['i1', 'i3']);
  assert.ok(!T.sessionItems(s)[0].supersetGroup, 'one movement is not a superset');
});

test('addExerciseToSession prescribes a compound differently from an isolation', () => {
  const s = planned();
  const c = T.addExerciseToSession(s, 'back_squat');
  assert.equal(c.target.repLow, 6);
  assert.equal(c.target.restSec, 150);
  assert.equal(c.target.rir, 2, 'week 2 leaves 2 in the tank');
  const i = T.addExerciseToSession(s, 'db_lateral');
  assert.equal(i.target.repLow, 8);
  assert.equal(i.target.restSec, 120);
  assert.equal(T.sessionItems(s).length, 5);
  assert.deepEqual(T.sessionItems(s).map(e => e.order), [0, 1, 2, 3, 4]);
});

test('addExerciseToSession refuses a movement the library does not have', () => {
  assert.equal(T.addExerciseToSession(planned(), 'not_a_real_movement'), null);
});

test('setExerciseTarget clamps every field it is given', () => {
  const s = planned();
  assert.equal(T.setExerciseTarget(s, 'i1', { sets: 99 }).sets, T.SETS_MAX);
  assert.equal(T.setExerciseTarget(s, 'i1', { sets: 0 }).sets, T.SETS_MIN);
  assert.equal(T.setExerciseTarget(s, 'i1', { rir: 12 }).rir, T.RIR_MAX);
  assert.equal(T.setExerciseTarget(s, 'i1', { rir: -3 }).rir, 0);
  assert.equal(T.setExerciseTarget(s, 'i1', { restSec: 5 }).restSec, 15);
});

test('setExerciseTarget keeps the rep range the right way round', () => {
  const s = planned();
  // Dragging the bottom of the range past the top pushes the top with it, and vice versa, so nobody
  // is ever shown "12-8 reps" and left to work out what it means.
  let t = T.setExerciseTarget(s, 'i1', { repLow: 14 });
  assert.equal(t.repLow, 14); assert.equal(t.repHigh, 14);
  t = T.setExerciseTarget(s, 'i1', { repHigh: 8 });
  assert.equal(t.repHigh, 8); assert.equal(t.repLow, 8);
});

test('setExerciseTarget leaves fields it was not given alone', () => {
  const s = planned();
  const t = T.setExerciseTarget(s, 'i1', { sets: 5 });
  assert.equal(t.repLow, 6); assert.equal(t.repHigh, 10); assert.equal(t.rir, 2); assert.equal(t.restSec, 150);
});

test('setSessionDay moves one week only, and rejects a day that is not one', () => {
  const s = planned();
  assert.equal(T.setSessionDay(s, 4), true);
  assert.equal(s.dayOfWeek, 4);
  assert.equal(T.setSessionDay(s, 7), false);
  assert.equal(T.setSessionDay(s, -1), false);
  assert.equal(s.dayOfWeek, 4, 'a rejected move changes nothing');
});

test('sessionsOnDay names what is already there without blocking a two-a-day', () => {
  const b = T.generateBlock({ daysPerWeek: 3, weeks: 4, targets: T.defaultTargets() });
  const wk = T.weekSessions(b, 1);
  T.setSessionDay(wk[1], wk[0].dayOfWeek);
  const clash = T.sessionsOnDay(b, 1, wk[0].dayOfWeek, wk[1].id);
  assert.deepEqual(clash, [wk[0].name]);
  assert.deepEqual(T.sessionsOnDay(b, 1, wk[0].dayOfWeek, wk[0].id), [wk[1].name], 'and it is symmetric');
});

// ---- generated variations -----------------------------------------------------------------------
// A wide-grip T-bar row is its own lift with its own history and its own best. These are generated
// from the movement they came from rather than typed into TABLE, which buys consistency and costs
// two specific hazards: a typo'd parent silently produces nothing, and a generated name can collide
// with a hand-written one and quietly steal imports off it. Both are asserted here.

const VARIANTS = () => T.EXERCISES.filter(e => e.variantOf);
const HANDWRITTEN = () => T.EXERCISES.filter(e => !e.variantOf);

test('every movement listed for variations actually exists', () => {
  // Without this, a renamed or mistyped id skips silently and the variations just never appear.
  const missing = Object.keys(T.VARIANTS_FOR).filter(id => !T.byId(id));
  assert.deepEqual(missing, [], `VARIANTS_FOR names movements that are not in the library: ${missing}`);
});

test('every axis listed for a movement actually exists, and every option on it', () => {
  for (const [pid, axes] of Object.entries(T.VARIANTS_FOR)) {
    for (const [axisId, only] of Object.entries(axes)) {
      const opts = T.VARIANT_AXES[axisId];
      assert.ok(opts, `${pid} asks for an axis that does not exist: ${axisId}`);
      if (only === 1) continue;
      for (const o of only) {
        assert.ok(opts.some(x => x.id === o), `${pid} asks ${axisId} for an option it has not got: ${o}`);
      }
    }
  }
});

test('no axis is defined and then never used', () => {
  const used = new Set(Object.values(T.VARIANTS_FOR).flatMap(a => Object.keys(a)));
  const dead = Object.keys(T.VARIANT_AXES).filter(a => !used.has(a));
  assert.deepEqual(dead, [], `dead axes: ${dead}`);
});

test('variations inherit the movement they came from and change only the emphasis', () => {
  for (const v of VARIANTS()) {
    const p = T.byId(v.variantOf);
    assert.ok(p, `${v.id} has no parent`);
    assert.equal(v.pattern, p.pattern, `${v.id} changed its movement pattern`);
    assert.equal(v.equipment, p.equipment, `${v.id} changed its equipment`);
    assert.equal(v.profile, p.profile, `${v.id} changed its resistance profile`);
    assert.ok(v.primary.length >= 1, `${v.id} works nothing, so it counts for nothing`);
    for (const m of v.secondary) assert.ok(!v.primary.includes(m), `${v.id} lists ${m} twice`);
  }
});

test('a wide grip moves a row off the lats and onto the rear delts', () => {
  const p = T.byId('tbar_row'), w = T.byId('tbar_row__wide');
  assert.ok(p.primary.includes('lt'), 'the parent is a lat movement');
  assert.ok(w.primary.includes('rd'), 'the wide version promotes the rear delts');
  assert.ok(!w.primary.includes('lt'), 'and demotes the lats');
  assert.ok(w.secondary.includes('lt'), 'which are still worked, just not primarily');
});

test('a generated variation never steals a name off a hand-written movement', () => {
  // This is the hammer curl bug: "Dumbbell curl (hammer grip)" scored the same as "Hammer curl" for
  // ALTERNATING DUMBBELL HAMMER CURL, and an import that had resolved correctly for months started
  // landing on the variation instead. Every hand-written name must still resolve to itself.
  for (const e of HANDWRITTEN()) {
    if (T.isCardio(e)) continue;
    assert.equal(T.resolve(e.name), e.id, `"${e.name}" now resolves to a variation instead of itself`);
  }
});

test('variantsOf gives the movement and its ways, from either end', () => {
  const fromParent = T.variantsOf('tbar_row').map(e => e.id);
  assert.equal(fromParent[0], 'tbar_row', 'the plain version leads');
  assert.deepEqual(fromParent.slice(1).sort(), ['tbar_row__neutral', 'tbar_row__underhand', 'tbar_row__wide']);
  // Asking from inside a variation gives the same list, because "swap this grip for another" is
  // asked far more often from a variation than from the plain movement.
  assert.deepEqual(T.variantsOf('tbar_row__wide').map(e => e.id).sort(), fromParent.slice().sort());
});

test('variantsOf is empty for a movement with no variations, rather than a list of one', () => {
  assert.deepEqual(T.variantsOf('bulgarian'), [], 'a lone movement is not "1 variation"');
});

test('baseOf finds the movement behind a variation, and is a no-op otherwise', () => {
  assert.equal(T.baseOf('tbar_row__wide'), 'tbar_row');
  assert.equal(T.baseOf('tbar_row'), 'tbar_row');
  assert.equal(T.baseOf('not_a_thing'), 'not_a_thing');
});

test('a hand-built custom variation is listed alongside the generated ones', () => {
  const custom = [{ id: 'cu_1', name: 'T-bar row (fat grips)', variantOf: 'tbar_row', primary: ['ub'], secondary: [], pattern: 'horizPull', equipment: 'barbell', profile: 'mid', custom: true }];
  const ids = T.variantsOf('tbar_row', custom).map(e => e.id);
  assert.ok(ids.includes('cu_1'), 'your own variation belongs with the built-in ones');
  assert.equal(T.baseOf('cu_1', custom), 'tbar_row');
});

test('variation ids are stable and unique, because history hangs off them', () => {
  const seen = new Set();
  for (const v of VARIANTS()) {
    assert.ok(!seen.has(v.id), `duplicate variation id ${v.id}`);
    seen.add(v.id);
    assert.equal(v.id, v.variantOf + '__' + v.variant, 'the id must stay derivable, or logged sets orphan');
  }
});

test('a list marker is stripped, but a hyphen inside a name is not', () => {
  // Coaches number their plans, so "a) Bench press" and "3 - Deadlift" have to lose their marker.
  assert.equal(T.resolve('a) Bench press'), 'bb_bench');
  assert.equal(T.resolve('B. Back squat'), 'back_squat');
  assert.equal(T.resolve('1. T-bar row'), 'tbar_row');
  // But a hyphen glued to the next word is part of the movement. "B-stance" losing its B used to
  // resolve correctly anyway, purely because "stance" was a rare word in the library; it stopped
  // being rare the moment squats gained stance variations, and the match collapsed to a plain RDL.
  assert.equal(T.resolve('B-stance Romanian deadlift'), 'b_stance_rdl');
});

// ---- the cold start a separate-lift model creates -----------------------------------------------
// Picking a grip for the first time gives it no history of its own. That is correct and intended,
// but a blank row on the way into a session is worse than useless when the number you want is
// sitting right there under the movement it came from.

test('lastReference borrows from the parent movement, and says that it did', () => {
  const logs = [{ id: 'l1', dateISO: '2026-08-01', sets: [
    { exerciseId: 'tbar_row', weightKg: 70, reps: 10, done: true, type: 'work' },
  ] }];
  const r = T.lastReference(logs, 'tbar_row__wide', '2026-08-09');
  assert.equal(r.borrowed, true);
  assert.equal(r.fromId, 'tbar_row', 'the caller needs this to label whose number it is');
  assert.equal(r.best.weightKg, 70);
});

test('lastReference prefers the variation\'s own history the moment it has any', () => {
  const logs = [
    { id: 'l1', dateISO: '2026-08-01', sets: [{ exerciseId: 'tbar_row', weightKg: 70, reps: 10, done: true, type: 'work' }] },
    { id: 'l2', dateISO: '2026-08-05', sets: [{ exerciseId: 'tbar_row__wide', weightKg: 60, reps: 10, done: true, type: 'work' }] },
  ];
  const r = T.lastReference(logs, 'tbar_row__wide', '2026-08-09');
  assert.equal(r.borrowed, false, 'a lighter own number still beats a borrowed heavier one');
  assert.equal(r.best.weightKg, 60);
});

test('lastReference never borrows for a movement that is not a variation', () => {
  const logs = [{ id: 'l1', dateISO: '2026-08-01', sets: [{ exerciseId: 'tbar_row', weightKg: 70, reps: 10, done: true, type: 'work' }] }];
  assert.equal(T.lastReference(logs, 'bb_bench', '2026-08-09'), null);
});

test('borrowing a reference never leaks into personal bests', () => {
  // The whole point of separate lifts: a wide-grip best is a wide-grip best. Doing 70kg on the plain
  // T-bar must not hand the wide-grip version a record it has not earned.
  const logs = [{ id: 'l1', dateISO: '2026-08-01', sets: [{ exerciseId: 'tbar_row', weightKg: 70, reps: 10, done: true, type: 'work' }] }];
  assert.equal(T.bestBefore(logs, 'tbar_row__wide', '2026-08-09').weightKg, 0);
  const prs = T.computePRs(logs);
  assert.ok(!prs['tbar_row__wide'], 'no borrowed record');
});

// ---- search folds variations away unless you ask for one ----------------------------------------

test('a broad search returns movements, not every way of doing them', () => {
  const names = T.search('row', null, 30).map(e => e.name);
  assert.ok(names.includes('T-bar row'));
  assert.ok(!names.some(n => n.includes('(')), `variations leaked into a broad search: ${names.filter(n => n.includes('('))}`);
});

test('naming the grip in the search brings that variation back', () => {
  const names = T.search('t-bar row neutral', null, 10).map(e => e.name);
  assert.deepEqual(names, ['T-bar row (neutral grip)']);
});

test('an empty search shows movements only', () => {
  assert.ok(!T.search('', null, 50).some(e => e.variantOf));
});
