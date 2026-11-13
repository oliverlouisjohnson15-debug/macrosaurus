'use strict';
// The programmes as the Train tab's front door: a filterable grid of cards, each opening a preview of
// its whole week, with one button to start it.
const { test } = require('node:test');
const assert = require('node:assert');
const { app, mount, accountWith } = require('./helpers/app.js');

const A = app();
const T = A.Training;

function emptyAccount() {
  const db = accountWith();
  db.training.blocks = [];
  return db;
}

test('every shipped programme has a card, and a card opens the whole week', () => {
  let picked = null;
  const ui = mount(A.ProgrammeGallery, { db: emptyAccount(), onPick: (k) => { picked = k; } });
  try {
    for (const p of T.PROGRAMMES) assert.ok(ui.has(p.name), p.name + ' has a card: ' + ui.text.slice(0, 300));
    ui.click("Quinton Pulliam's Split");
    assert.ok(ui.has('Legs (Quad Focus)'), 'the preview lists the days: ' + ui.text.slice(0, 300));
    assert.ok(ui.has('Pendulum squat or Back squat'), 'and says an either/or line is one');
    assert.ok(ui.has('4 × 8-12') || ui.has('4 × 8–12'), 'with the written set counts: ' + ui.text.slice(-600));
    ui.click("Start Quinton Pulliam's Split");
    assert.equal(picked, 'qp5', 'starting it hands over the programme');
  } finally { ui.unmount(); }
});

test('the filters narrow the grid and All brings everything back', () => {
  const ui = mount(A.ProgrammeGallery, { db: emptyAccount(), onPick() {} });
  try {
    ui.click('4 days');
    assert.ok(ui.has('Raptor'));
    assert.ok(!ui.has('T-Rex'), 'five-day plans are filtered out');
    ui.click('Machines');
    assert.ok(ui.has('Stego') && !ui.has('Raptor'));
    ui.click('All');
    for (const p of T.PROGRAMMES) assert.ok(ui.has(p.name), p.name);
  } finally { ui.unmount(); }
});

test('every programme says who it is for', () => {
  for (const p of T.PROGRAMMES) {
    const s = T.programmeSummary(p.key);
    assert.ok(s.about && s.about.length > 40, p.name + ' needs an about line');
    assert.ok(s.setting, p.name + ' needs a setting');
  }
});
