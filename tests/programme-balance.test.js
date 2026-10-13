'use strict';
// Programme balance: what the four programmes train, and what we are and are not allowed to change.
//
// Three of the four are somebody else's work. Their hashes are pinned here, so editing a line of
// Raptor, T-Rex or Brachio fails a test and has to be a decision rather than an accident. Stego is
// ours and is free to move; the numbers below are the review that moved it.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const T = require('../app/training.js');

const hash = (key) => crypto.createHash('sha256').update(JSON.stringify(T.PROGRAMMES.find(p => p.key === key).template)).digest('hex').slice(0, 16);

test('the author programmes are exactly as they were written', () => {
  assert.strictEqual(hash('mac4'), '1142a250e4d19b81');
  assert.strictEqual(hash('mac5'), 'a87e4fa36fd2e9be');
  assert.strictEqual(hash('bb5'), '42a3a13274d24c6d');
});

// Hard sets per muscle in the first week of a block built from a programme.
function weekly(key, additions) {
  const block = T.programmeBlock(key, { additions: !!additions });
  return T.plannedVolume(T.weekSessions(block, 1), []);
}

test('Stego: side and rear delts and quads are up, and biceps are exactly where they were', () => {
  const v = weekly('mach5');
  assert.strictEqual(v.sd, 7);
  assert.strictEqual(v.rd, 7);
  assert.strictEqual(v.qu, 8);
  // The programme writes the preacher curl at 3 sets, and a min-max block caps every line at 2, so the
  // week has always run 10. Putting the 3 back changes nothing in what is run, which is the point.
  assert.strictEqual(v.bi, 10);
});

test('the additions layer: Raptor gets a fly and delts instead of wrist work', () => {
  const off = weekly('mac4', false), on = weekly('mac4', true);
  assert.deepStrictEqual([off.sd, off.rd, off.ch, off.fa], [5, 2.5, 4, 9.5]);
  assert.deepStrictEqual([on.sd, on.rd, on.ch, on.fa], [7, 4.5, 6, 5.5]);
});

test('the additions layer: T-Rex', () => {
  const on = weekly('mac5', true);
  assert.deepStrictEqual([on.sd, on.rd, on.ch, on.fa], [8, 5, 7, 6.5]);
});

test('the additions layer: Brachio gains calves, side delts and a hinge', () => {
  const off = weekly('bb5', false), on = weekly('bb5', true);
  assert.ok(!off.ca, 'no calf work as written');
  assert.deepStrictEqual([on.sd, on.ca, on.ha], [7, 4, 7]);
});

test('turning the layer on never changes the programme itself, and leaves the same block when off', () => {
  const before = hash('bb5');
  const on = T.programmeBlock('bb5', { additions: true });
  assert.strictEqual(hash('bb5'), before);
  assert.strictEqual(on.sourceRef.additions, true);
  const off = T.programmeBlock('bb5', {});
  assert.ok(!off.sourceRef.additions);
  const lines = (b) => T.weekSessions(b, 1).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []);
  assert.strictEqual(lines(off).length, 29 - 0);
  assert.ok(lines(on).length > lines(off).length);
});

test('every added line says it is ours, in the line and in its note', () => {
  const block = T.programmeBlock('mac4', { additions: true });
  const added = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.filter(e => e.addedBy)), []);
  assert.strictEqual(added.length, 3);
  assert.ok(added.every(e => e.addedBy === 'macrosaurus' && /^Not in the original programme/.test(e.planNote)));
  const authors = T.weekSessions(block, 1).reduce((a, s) => a.concat(s.exercises.filter(e => !e.addedBy)), []);
  assert.ok(authors.length > 0 && authors.every(e => !('addedBy' in e)));
});

test('the summary says what the layer does, and a programme with none says nothing', () => {
  const s = T.programmeSummary('bb5');
  assert.ok(s.additions && s.additions.sets === 10 && /calves/i.test(s.additions.note));
  assert.strictEqual(T.programmeSummary('mach5').additions, null);
});

// ---- priority muscle ----------------------------------------------------------------------------

const setsOf = (block) => block.sessions.map(s => s.exercises.reduce((a, e) => a + e.target.sets, 0));

test('a priority muscle gains a set a session, early in it, and the session does not grow', () => {
  const block = T.programmeBlock('mach5', {});
  const before = setsOf(block);
  const out = T.applyPriority(block, 'sd');
  assert.ok(out && out.sessions > 0);
  assert.strictEqual(block.priority, 'sd');
  const v = T.plannedVolume(T.weekSessions(block, 1), []);
  assert.strictEqual(v.sd, 10, 'side delts went 7 to 10 across the three sessions that train them');
  assert.deepStrictEqual(setsOf(block), before, 'a set came off an isolation line in each session');
});

test('the heavy opener stays first, and the priority line sits right behind it', () => {
  const block = T.programmeBlock('mach5', {});
  T.applyPriority(block, 'sd');
  const pull = T.weekSessions(block, 1).filter(s => s.name === 'Pull')[0];
  const ordered = pull.exercises.slice().sort((a, b) => a.order - b.order);
  assert.strictEqual(ordered[0].exerciseId, 'chest_supported_machine_row', 'the opener is untouched');
  assert.ok(ordered[1].priority, 'the priority line is second');
  assert.deepStrictEqual(ordered.map(e => e.order), ordered.map((_, i) => i));
});

test('a muscle the block never trains is refused, and so is a muscle that does not exist', () => {
  const block = T.programmeBlock('mach5', {});
  const before = JSON.stringify(block);
  assert.strictEqual(T.applyPriority(block, 'ob'), null);
  assert.strictEqual(T.applyPriority(block, 'nope'), null);
  assert.strictEqual(JSON.stringify(block), before, 'a refusal changes nothing');
});

// ---- on screen ----------------------------------------------------------------------------------

const { app, mount, accountWith } = require('./helpers/app.js');
const A = app();

function builder(key) {
  const draft = A.Training.programmeBlock(key, { startISO: A.Store.todayISO() });
  const db = accountWith(draft);
  db.training.blocks = [];
  const saves = [];
  const ui = mount(A.BlockBuilder, {
    db, update(fn) { fn(db); }, showToast() {}, isPremium: true, onUpgrade() {},
    blockId: null, draft, clearDraft: false, onBack() {}, onStart() {}, onSchedule() {},
  });
  return { ui, db };
}

test('the additions toggle is offered on an author programme, off, and says what it does', () => {
  const { ui } = builder('bb5');
  try {
    assert.ok(ui.has('Macrosaurus additions'), ui.text.slice(0, 400));
    assert.ok(ui.has('exactly as it was written'));
    assert.ok(!ui.has('Standing calf raise'), 'off: no calf work, as the author wrote it');
  } finally { ui.unmount(); }
});

test('turning the additions on rebuilds the block with the added sets, and off again puts it back', () => {
  const { ui } = builder('bb5');
  const volume = () => +(ui.text.match(/Week 1 volume\s*([\d.]+) sets/) || [])[1];
  try {
    const written = volume();
    assert.ok(written > 0, ui.text.slice(0, 400));
    ui.click('Macrosaurus additions');
    assert.ok(volume() > written + 8, 'about ten sets were added: ' + written + ' to ' + volume());
    ui.click('Macrosaurus additions');
    assert.strictEqual(volume(), written, 'off again, back to the author\'s week');
  } finally { ui.unmount(); }
});

test('Stego has no additions toggle: it is ours', () => {
  const { ui } = builder('mach5');
  try { assert.ok(!ui.has('Macrosaurus additions')); } finally { ui.unmount(); }
});

test('a priority muscle can be chosen from the block, and None puts the block back', () => {
  const { ui } = builder('mach5');
  try {
    assert.ok(ui.has('Priority muscle'));
    ui.click('Priority muscle');
    ui.click('Side delts');
    assert.ok(ui.has('A set more in every session that trains it'), ui.text.slice(0, 500));
    ui.click('Priority muscle');
    ui.click('None');
    assert.ok(ui.has('Optional. Pick a weak point'), 'back to no priority');
  } finally { ui.unmount(); }
});
