'use strict';
// Rotating a movement between blocks.
//
// The engine owns every judgement here, which is the point: an app that swaps your squat because a
// model felt like it is exactly the failure these tests exist to make impossible. What is asserted
// is the shape of the ADVICE, not a preference about training: that a lift which moved is never
// taken off you, that the number of changes cannot run away, that a candidate really does the same
// job, and that a rotation does not erase the history behind it.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../app/training.js');

// One block, run start to finish. `flat` names the movements whose weight never moves, so a test can
// say "this one stalled" without hand-writing thirty sets.
function ranBlock(opts) {
  opts = opts || {};
  const block = T.generateBlock({ daysPerWeek: 4, weeks: 4, shape: 'build4' });
  block.startISO = '2026-07-01';
  const logs = [];
  const priorBlocks = opts.priorBlocks == null ? 2 : opts.priorBlocks;
  // Earlier blocks, so blocksRunOn has something to count. Only their exercise ids matter.
  for (let b = 0; b < priorBlocks; b++) {
    (block.sessions || []).slice(0, 8).forEach((s, i) => {
      logs.push({
        id: 'p' + b + i, blockId: 'prior' + b, sessionId: 'p' + b + 's' + i,
        dateISO: '2026-0' + (3 + b) + '-' + String(1 + i).padStart(2, '0'),
        sets: (s.exercises || []).map(e => ({ exerciseId: e.exerciseId, done: true, reps: 8, rir: 2, weightKg: 50 })),
      });
    });
  }
  const flat = {}; (opts.flat || []).forEach(id => { flat[id] = 1; });
  (block.sessions || []).forEach((s, i) => {
    if (opts.skip && opts.skip(s, i)) return;
    const sets = [];
    (s.exercises || []).forEach((e, j) => {
      const climbing = !flat[e.exerciseId] && !(opts.flatFirst && j === 0);
      for (let k = 0; k < (e.target.sets || 3); k++) {
        sets.push({ exerciseId: e.exerciseId, done: true, reps: 8, rir: 2, weightKg: climbing ? 40 + s.week * 5 : 60 });
      }
    });
    logs.push({ id: 'l' + i, blockId: block.id, sessionId: s.id, dateISO: '2026-07-' + String(1 + i).padStart(2, '0'), sets });
  });
  return { block, logs, targets: T.defaultTargets({}) };
}
const plan = (o) => { const r = ranBlock(o); return T.rotationPlan(r.block, r.logs, r.targets, { custom: null }); };
const byName = (p, re) => p.lifts.filter(l => re.test(l.name));

// ---- what a rotation is allowed to be ----------------------------------------------------------

test('a candidate does the same job: same pattern, same lead muscle', () => {
  for (const id of ['back_squat', 'db_incline', 'bb_bench', 'rdl', 'lat_pulldown', 'bb_row']) {
    const base = T.byId(id);
    for (const c of T.sameJob(id, { limit: 4 })) {
      const ex = T.byId(c.id);
      assert.equal(ex.pattern, base.pattern, `${c.name} is a different pattern to ${base.name}`);
      assert.ok((ex.primary || []).includes((base.primary || [])[0]),
        `${c.name} does not train ${base.primary[0]}, so it is a different exercise rather than another way of doing this one`);
      assert.notEqual(c.id, id);
    }
  }
});

test('the same movement on different kit is what gets offered first', () => {
  // The case people actually arrive with, named in their own words: three blocks of incline
  // dumbbell press, and they want the Smith or the machine version of it.
  const names = T.sameJob('db_incline', { limit: 3 }).map(c => c.name);
  assert.ok(names.some(n => /machine/i.test(n)), 'a guided version should be on the shortlist: ' + names.join(', '));
  assert.ok(names.every(n => /incline|press/i.test(n)), 'and all of them should still be presses: ' + names.join(', '));
});

test('a rotation you cannot add weight to is never the first answer', () => {
  // Press-ups train the same muscles in the same pattern and score well on every other axis. They
  // are still the wrong answer for somebody rotating a loaded press, because next week has nowhere
  // to go, and a block that cannot progress is not a block.
  const first = T.sameJob('db_incline', { limit: 4, equipment: ['dumbbell', 'bodyweight'] })[0];
  assert.ok(!/press-up/i.test(first.name), 'a bodyweight movement led the shortlist: ' + first.name);
});

test('one answer per movement, not the same suggestion twice', () => {
  const out = T.sameJob('bb_row', { limit: 4 });
  const families = out.map(c => T.baseOf(c.id));
  assert.equal(new Set(families).size, families.length, 'a grip variant doubled up with its parent: ' + out.map(c => c.name).join(', '));
});

test('nothing in the gym that does the job means nothing is recommended', () => {
  const p = T.rotationPlan(...(() => { const r = ranBlock(); return [r.block, r.logs, r.targets]; })(), { equipment: ['band'] });
  assert.ok(p.lifts.every(l => l.candidates.length || l.verdict === 'keep'),
    'a lift with nowhere to go was still marked as worth changing');
});

// ---- what the engine will and will not take off you --------------------------------------------

test('a lift that moved is never offered for rotation', () => {
  const p = plan({ flatFirst: true });
  p.lifts.filter(l => l.deltaPct > 3).forEach(l => {
    assert.equal(l.on, false, `${l.name} went up ${l.deltaPct}% and was still switched on`);
    assert.equal(l.verdict, 'keep', `${l.name} went up ${l.deltaPct}% and was not marked as one to keep`);
  });
});

test('one block in, nothing is worth rotating yet', () => {
  // A movement you have run once has not proved anything, in either direction. Rotating on that is
  // the churn the research warns about, not a decision.
  const p = plan({ priorBlocks: 0, flatFirst: true });
  assert.equal(p.offered, 0, 'a first-block movement was offered for rotation');
});

test('a stalled lift after three blocks is worth changing', () => {
  const p = plan({ flatFirst: true });
  assert.ok(p.offered >= 1, 'nothing was offered despite stalled lifts across three blocks');
  const on = p.lifts.filter(l => l.on);
  on.forEach(l => {
    assert.ok(l.candidates.length, `${l.name} was switched on with nothing to switch to`);
    assert.ok(l.reasons.length, `${l.name} was switched on without saying why`);
  });
});

test('the number of changes is capped, and the ones over the line are still shown', () => {
  const p = plan({ flatFirst: true });
  const on = p.lifts.filter(l => l.on);
  const mains = on.filter(l => l.role !== 'accessory').length;
  const acc = on.filter(l => l.role === 'accessory').length;
  assert.ok(mains <= p.caps.main, `${mains} main lifts switched on against a cap of ${p.caps.main}`);
  assert.ok(acc <= p.caps.accessory, `${acc} accessories switched on against a cap of ${p.caps.accessory}`);
  // Capped, not hidden: anything held back has to still be on the list with the cap given as the reason.
  const capped = p.lifts.filter(l => l.reasons.some(r => r.key === 'cap'));
  capped.forEach(l => assert.equal(l.verdict, 'your-call', `${l.name} was dropped rather than offered as a choice`));
});

test('the anchor lift is never switched on for you, however it reads', () => {
  // Rotating the heaviest skilled movement of a pattern costs the skill AND the only long-run signal
  // there is. It stays available, because a dead squat is a real reason, but it is never automatic.
  const p = plan({ flatFirst: true });
  const anchors = p.lifts.filter(l => l.role === 'anchor');
  assert.ok(anchors.length, 'no anchor was identified at all');
  anchors.forEach(l => assert.equal(l.on, false, `${l.name} is an anchor and was switched on automatically`));
});

test('an anchor is the most skilled movement of its pattern, not just the first one listed', () => {
  const p = plan({});
  p.lifts.filter(l => l.role === 'anchor').forEach(a => {
    const rivals = p.lifts.filter(l => l.pattern === a.pattern && l.role !== 'accessory' && l.exerciseId !== a.exerciseId);
    rivals.forEach(r => assert.ok(T.skillOf(T.byId(a.exerciseId)) >= T.skillOf(T.byId(r.exerciseId)),
      `${r.name} is a more skilled ${a.pattern} than the anchor ${a.name}`));
  });
});

test('every lift in the block gets a verdict, so any of them can be changed on purpose', () => {
  // The wizard is meant to answer "I want to change this one", not only "what does the app want".
  const r = ranBlock();
  const p = T.rotationPlan(r.block, r.logs, r.targets, {});
  const planned = new Set();
  T.templateOf(r.block).forEach(d => (d.exercises || []).forEach(e => planned.add(e.exerciseId)));
  planned.forEach(id => assert.ok(p.lifts.some(l => l.exerciseId === id), `${id} is in the block but got no verdict`));
});

// ---- applying it ------------------------------------------------------------------------------

test('applying a rotation changes that movement and leaves the rest exactly as it was', () => {
  const r = ranBlock({ flatFirst: true });
  const p = T.rotationPlan(r.block, r.logs, r.targets, {});
  const pick = p.lifts.filter(l => l.on)[0];
  assert.ok(pick, 'nothing to apply');
  const out = T.applyRotation(r.block, [{ day: pick.day, index: pick.index, from: pick.exerciseId, to: pick.candidates[0].id }],
    { targets: r.targets, startISO: '2026-08-01' });
  const before = T.templateOf(r.block), after = T.templateOf(out.block);
  assert.equal(after[pick.day].exercises[pick.index].exerciseId, pick.candidates[0].id);
  let changed = 0;
  before.forEach((d, di) => (d.exercises || []).forEach((e, ei) => {
    if (e.exerciseId !== after[di].exercises[ei].exerciseId) changed++;
  }));
  assert.equal(changed, 1, 'applying one rotation changed ' + changed + ' movements');
});

test('a rotation records what became what', () => {
  const r = ranBlock({ flatFirst: true });
  const p = T.rotationPlan(r.block, r.logs, r.targets, {});
  const pick = p.lifts.filter(l => l.on)[0];
  const out = T.applyRotation(r.block, [{ day: pick.day, index: pick.index, from: pick.exerciseId, to: pick.candidates[0].id }],
    { targets: r.targets, startISO: '2026-08-01' });
  assert.equal(out.rotations.length, 1);
  assert.equal(out.rotations[0].from, pick.exerciseId);
  assert.equal(out.rotations[0].to, pick.candidates[0].id);
});

test('volume changes ride along rather than building a second block', () => {
  const r = ranBlock({ flatFirst: true });
  const cap = T.styleOf(r.block.style).maxSets || 99;
  // A movement with room under the style's own per-movement ceiling, because a set added above that
  // ceiling is discarded by the build and would prove nothing either way.
  const t0 = T.templateOf(r.block);
  let day = -1, index = -1;
  t0.forEach((d, di) => (d.exercises || []).forEach((e, ei) => {
    if (day < 0 && e.target.sets < cap) { day = di; index = ei; }
  }));
  assert.ok(day >= 0, 'every movement is already at the ceiling, so there is nothing to test');
  const before = t0[day].exercises[index].target.sets;
  const out = T.applyRotation(r.block, [], {
    targets: r.targets, startISO: '2026-08-01',
    also: [{ kind: 'sets', day: day, index: index, from: before, to: before + 1 }],
  });
  assert.equal(T.templateOf(out.block)[day].exercises[index].target.sets, before + 1);
});

test('more work is never proposed above the ceiling the build would clamp it to', () => {
  // The landmarks style tops out at five sets a movement. Offering a sixth is offering work that
  // silently does not happen, which is worse than not offering it.
  const r = ranBlock({ flatFirst: true });
  const cap = T.styleOf(r.block.style).maxSets || 99;
  const plan = T.rerunPlan(r.block, r.logs, r.targets, null);
  plan.changes.filter(c => c.kind === 'sets').forEach(c => {
    assert.ok(c.to <= cap, `proposed ${c.to} sets on a style that clamps at ${cap}`);
  });
});

// ---- the history behind a rotated lift ---------------------------------------------------------

test('a rotated lift keeps one continuous history, with the change marked', () => {
  // If a rotation restarts the history then every rotation reads as losing your progress, and nobody
  // rotates anything ever again.
  const logs = [
    { dateISO: '2026-06-01', sets: [{ exerciseId: 'db_bench', done: true, reps: 8, weightKg: 40 }] },
    { dateISO: '2026-06-08', sets: [{ exerciseId: 'db_bench', done: true, reps: 8, weightKg: 42.5 }] },
    { dateISO: '2026-07-01', sets: [{ exerciseId: 'smith_bench', done: true, reps: 8, weightKg: 70 }] },
  ];
  const rotations = [{ from: 'db_bench', to: 'smith_bench', dateISO: '2026-06-25' }];
  const h = T.familyHistory(logs, 'smith_bench', null, rotations);
  assert.equal(h.length, 3, 'the history stopped at the rotation');
  assert.deepEqual(h.map(r => r.dateISO), ['2026-06-01', '2026-06-08', '2026-07-01'], 'out of date order');
  assert.equal(h[0].changed, false);
  assert.equal(h[2].changed, true, 'the point where the movement changed is not marked');
  // Readable from either end, because somebody looking up the old lift wants the same run.
  assert.equal(T.familyHistory(logs, 'db_bench', null, rotations).length, 3);
});

test('a chain of rotations reads end to end', () => {
  const rotations = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  assert.deepEqual(T.rotationChain(rotations, 'a'), ['a', 'b', 'c']);
  assert.deepEqual(T.rotationChain(rotations, 'c'), ['a', 'b', 'c']);
  assert.deepEqual(T.rotationChain(rotations, 'b'), ['a', 'b', 'c']);
});

test('a rotation that loops back on itself terminates', () => {
  // Rotate A to B this block and back to A the next, which is a thing people really do.
  const rotations = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }];
  const chain = T.rotationChain(rotations, 'a');
  assert.ok(chain.length <= 2, 'a loop ran away: ' + chain.join(','));
  assert.ok(chain.includes('a') && chain.includes('b'));
});

test('with no rotations recorded, a lift is just itself', () => {
  const logs = [{ dateISO: '2026-06-01', sets: [{ exerciseId: 'db_bench', done: true, reps: 8, weightKg: 40 }] }];
  assert.equal(T.familyHistory(logs, 'db_bench', null, []).length, 1);
  assert.equal(T.familyHistory(logs, 'db_bench', null, null).length, 1);
});
