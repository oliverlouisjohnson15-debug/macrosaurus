#!/usr/bin/env node
/* Where the exercise library is thin, as a number rather than a feeling.
 *
 * WHY THIS AND NOT AN IMPORT. The obvious way to "cover more exercises" is to pull an open database
 * in. There is a good one - yuhonas/free-exercise-db, 873 movements, public domain - and it does not
 * survive contact with this model:
 *
 *   - 94 of its movements give their primary mover as "shoulders". Every volume number this app
 *     computes depends on telling front, side and rear delts apart, because that is the difference
 *     between a lateral raise, an overhead press and a face pull. "Shoulders" cannot be mapped;
 *     it can only be re-decided by hand, which is the work the import was meant to save.
 *   - It has no notion of where in the range a movement loads (len/mid/sho), which is half of what
 *     makes a good min-max accessory.
 *   - Of the 538 entries that are strength work on kit we model, 143 are already here and most of
 *     the rest are grip permutations of them ("Barbell Bench Press - Medium Grip") or magazine
 *     oddities ("Anti-Gravity Press", "Alternate Heel Touchers"). Importing it would triple the
 *     library and halve how well any of it is described.
 *
 * So it is a list to CHECK against, not to copy from. Run with --against-fedb and it fetches the
 * thing and reports what it has that we do not, per muscle, for a person to accept or reject. Every
 * row that ends up in TABLE is attributed by hand, which is why the attributions are any good.
 *
 *   node tools/exercise-gaps.mjs                 # the matrix, and the thin cells
 *   node tools/exercise-gaps.mjs --against-fedb  # ...plus what an open database has that we do not
 */
import { createRequire } from 'node:module';
const Training = createRequire(import.meta.url)('../app/training.js');

const KIT = ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'ez', 'kettlebell', 'trapbar', 'bodyweight', 'band'];
// What each muscle should have before the library can honestly say it covers it. Not a guess: the
// generator picks per muscle per day and refuses to repeat a movement inside a block, so a muscle
// with four options across a twelve-session block is a muscle it runs out of. TOTAL is the floor for
// that; GUIDED is how many must be on kit you can take to failure on your own, because that is what
// this method asks for first and what most people's gym actually has.
const WANT = { total: 12, guided: 5 };
const GUIDED = { machine: 1, cable: 1, smith: 1 };

const all = Training.all();
const rows = Training.MUSCLES.map(m => {
  const prim = all.filter(e => (e.primary || []).includes(m));
  return {
    m, label: Training.MUSCLE_LABEL[m], total: prim.length,
    guided: prim.filter(e => GUIDED[e.equipment]).length,
    byKit: Object.fromEntries(KIT.map(k => [k, prim.filter(e => e.equipment === k).length])),
  };
});

const head = 'muscle'.padEnd(13) + KIT.map(k => k.slice(0, 4).padStart(5)).join('') + '  total guided';
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows) {
  const thin = r.total < WANT.total || r.guided < WANT.guided;
  console.log(r.label.padEnd(13) + KIT.map(k => String(r.byKit[k] || '').padStart(5)).join('')
    + String(r.total).padStart(7) + String(r.guided).padStart(7) + (thin ? '   <- thin' : ''));
}
const thin = rows.filter(r => r.total < WANT.total || r.guided < WANT.guided);
console.log('\n' + all.length + ' movements. ' + thin.length + ' muscles below ' + WANT.total
  + ' movements or ' + WANT.guided + ' on guided kit' + (thin.length ? ': ' + thin.map(r => r.label).join(', ') : '.'));

if (!process.argv.includes('--against-fedb')) process.exit(0);

// The open database, as a second opinion. Its muscle names are coarser than ours, so anything it
// files under "shoulders" is listed on its own and NOT mapped - guessing which delt head it meant is
// the whole reason this is a report rather than an import.
const MAP = {
  chest: 'ch', lats: 'lt', 'middle back': 'ub', traps: 'ub', 'lower back': 'lb', biceps: 'bi',
  triceps: 'tr', forearms: 'fa', abdominals: 'ab', quadriceps: 'qu', hamstrings: 'ha', glutes: 'gl',
  adductors: 'ad', abductors: 'gl', calves: 'ca',
};
const res = await fetch('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json');
const db = await res.json();
const strength = db.filter(e => ['strength', 'powerlifting'].includes(e.category))
  .filter(e => !['other', 'foam roll', 'medicine ball', 'exercise ball'].includes(e.equipment));
const missing = {};
let unmappable = 0;
for (const e of strength) {
  const r = Training.resolveDetail(e.name, []);
  if (r && ['exact', 'alias', 'strong'].includes(r.how)) continue;
  const m = MAP[e.primaryMuscles[0]];
  if (!m) { unmappable++; continue; }
  (missing[m] = missing[m] || []).push(e.name);
}
console.log('\n--- what free-exercise-db has that we do not ---');
console.log(unmappable + ' of its movements name a muscle group we cannot map (mostly "shoulders"), and are left out.');
for (const r of rows) {
  const list = missing[r.m] || [];
  if (!list.length) continue;
  console.log('\n' + r.label + ' (' + list.length + '):');
  console.log('   ' + list.slice(0, 25).join(', ') + (list.length > 25 ? ', ...' : ''));
}
