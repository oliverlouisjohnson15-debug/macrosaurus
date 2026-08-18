#!/usr/bin/env node
/* The library's naming grammar, as something a machine checks rather than something people remember.
 *
 * WHY. Three hundred and seventy movements written by several hands over a year drift: "Chest press
 * machine" beside "Machine shrug", "DB Incline Press" beside "Incline dumbbell press", "Tricep"
 * beside "Triceps". Every one of those costs twice - once when somebody scans a picker looking for a
 * movement under the wrong words, and once when the resolver has to guess which of two spellings a
 * coach's spreadsheet meant.
 *
 * THE GRAMMAR
 *   1. Sentence case. First word capitalised, the rest lower, except proper nouns and acronyms
 *      (Romanian, Nordic, Kelso, Zottman, Copenhagen, Pallof, Bayesian, EZ, JM, T-bar, Y-raise).
 *   2. Words in full. No DB, BB, KB, alt., mach., tricep. Abbreviations live in SHORTHAND, which is
 *      what somebody TYPES; they are not what a movement is called.
 *   3. Kit before the movement: "[modifier] [equipment] [movement]" - "Incline dumbbell press",
 *      "Low-to-high cable fly", "Machine chest press". Never trailing, because "Chest press machine"
 *      and "Machine chest press" are the same movement filed under two different first letters.
 *   4. One space between words, no trailing punctuation, no " - " qualifier: a grip or an angle that
 *      needs saying goes in brackets - "Lat pulldown (V-bar)".
 *
 * WHAT IT WILL NOT DO. It renames; it never merges. Two entries that look like one movement are
 * REPORTED and left alone, because deciding that a close-grip pulldown is really a neutral-grip one
 * is exactly the judgement that does not belong in a script.
 *
 *   node tools/name-style.mjs            # report
 *   node tools/name-style.mjs --fix      # rewrite the names in app/training.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const Training = createRequire(import.meta.url)('../app/training.js');

// Words that keep their capital: people's names, places, and acronyms that are not words.
const PROPER = new Set(['romanian', 'nordic', 'kelso', 'zottman', 'copenhagen', 'pallof', 'bayesian',
  'bulgarian', 'arnold', 'zercher', 'jefferson', 'cuban', 'turkish', 'swiss', 'meadows', 'pendlay',
  'larsen', 'spoto', 'anderson', 'poliquin', 'jm', 'ez', 'rdl', 'ohp', 'gvt', 'tke']);
// Acronyms and hyphenated forms whose caps are part of the name.
const SHAPED = { 't-bar': 'T-bar', 'v-bar': 'V-bar', 'y-raise': 'Y-raise', 'y-raises': 'Y-raises',
  'x-body': 'X-body', 'jm': 'JM', 'ez': 'EZ', 'ez-bar': 'EZ-bar', 'rdl': 'RDL',
  // A single letter in a movement's name is the SHAPE your arms make, not a word: the Y raise, the
  // T raise, the W raise. Lower-cased it reads as a typo.
  y: 'Y', t: 'T', x: 'X', w: 'W', a: 'A' };
// Words that describe HOW rather than WHAT, and so sit in front of the kit: "Seated machine dip",
// not "Machine seated dip". This is the difference between the grammar reading like English and
// reading like a database.
const MODIFIER = new Set(['seated', 'standing', 'lying', 'prone', 'supine', 'kneeling', 'incline',
  'decline', 'flat', 'single-arm', 'one-arm', '1-arm', 'close-grip', 'wide-grip', 'neutral-grip',
  'reverse-grip', 'reverse', 'bent-over', 'leaning', 'high', 'low', 'half', 'deficit', 'paused',
  'weighted', 'assisted', 'alternating', 'unilateral', 'b-stance', 'split', 'chest-supported',
  'behind-the-back', 'overhead', 'bent-knee', 'straight-arm', 'cross-body']);
// Abbreviations that are input, never a name.
const EXPAND = { db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', kb: 'kettlebell', bw: 'bodyweight',
  alt: 'alternating', mach: 'machine', tricep: 'triceps', bicep: 'biceps', flye: 'fly', flyes: 'flies' };
const KIT = ['smith machine', 'smith', 'machine', 'cable', 'dumbbell', 'barbell', 'kettlebell', 'band', 'EZ-bar', 'EZ'];

// Case is decided per word, and a word can be wrapped in brackets or trailed by a comma, so the
// punctuation is peeled off and put back rather than defeating the lookup - which is how
// "(V-bar)" came out as "(v-bar)".
function titleWord(w, i) {
  const m = String(w).match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
  const [, lead, core, tail] = m;
  if (!core) return w;
  const bare = core.toLowerCase();
  let out;
  // A single letter hyphenated onto the front is the shape of the bar or of the movement - the
  // V-squat, the T-bar row, the X-body curl - and it is a capital wherever it appears.
  if (/^[a-z]-/.test(bare)) out = bare.charAt(0).toUpperCase() + bare.slice(1);
  else if (SHAPED[bare]) out = SHAPED[bare];
  else if (PROPER.has(bare)) out = bare.charAt(0).toUpperCase() + bare.slice(1);
  else if (i === 0) out = bare.charAt(0).toUpperCase() + bare.slice(1);
  else out = bare;
  return lead + out + tail;
}

export function styled(name) {
  let s = String(name).replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  // Kit at the end reads backwards: it is the first thing you scan for and the last thing written.
  const tail = new RegExp('\\s+(' + KIT.join('|') + ')$', 'i');
  const m = s.match(tail);
  if (m) {
    // In front of the movement, but BEHIND anything describing how it is done: the grammar is
    // [modifier] [equipment] [movement], which is what makes "Incline dumbbell press" read right.
    const rest = s.slice(0, s.length - m[0].length).split(' ');
    let at = 0;
    while (at < rest.length && MODIFIER.has(rest[at].toLowerCase())) at++;
    rest.splice(at, 0, m[1]);
    s = rest.join(' ').replace(/\s+/g, ' ').trim();
  }
  return s.split(' ').map((w, i) => {
    // Expand inside a hyphenated word too, so "DB-row" is not left half abbreviated.
    const parts = w.split('-').map(p => EXPAND[p.toLowerCase().replace(/[^a-z]/g, '')] || p);
    return parts.join('-');
  }).join(' ').split(' ').map(titleWord).join(' ');
}

const all = Training.all();
const changes = all.map(e => ({ e, to: styled(e.name) })).filter(c => c.to !== c.e.name);

// Two entries that would end up with the same words are the same movement written twice. Reported,
// never merged: which id survives decides whose logged history survives, and that is a person's
// decision about their own training rather than a script's.
// Kit set aside, everything else in the SAME ORDER, and the equipment field agreeing. Sorting the
// words instead - which is the obvious way to write this - reports "Low-to-high cable fly" and
// "High-to-low cable fly" as one movement, and they are two.
const key = (e) => String(styled(e.name)).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter(Boolean).filter(w => !/^(smith|machine|cable|dumbbell|barbell|kettlebell|band)$/.test(w))
  .map(w => w.replace(/s$/, '')).join(' ') + ' | ' + e.equipment;
const after = new Map();
for (const e of all) {
  const k = key(e);
  if (!after.has(k)) after.set(k, []);
  after.get(k).push(e);
}
const dupes = [...after.values()].filter(g => g.length > 1);

if (process.argv.includes('--fix')) {
  const path = 'app/training.js';
  let src = readFileSync(path, 'utf8');
  let done = 0;
  for (const { e, to } of changes) {
    const needle = "'" + e.id + '|' + e.name + '|';
    if (src.indexOf(needle) === -1) { console.error('  ! not a TABLE row, left alone: ' + e.id + ' (' + e.name + ')'); continue; }
    src = src.replace(needle, "'" + e.id + '|' + to + '|');
    done++;
  }
  writeFileSync(path, src);
  console.log('renamed ' + done + ' of ' + changes.length);
} else {
  console.log(changes.length + ' of ' + all.length + ' names are not in house style\n');
  for (const { e, to } of changes) console.log('  ' + e.name.padEnd(38) + ' -> ' + to);
  console.log('\n' + dupes.length + ' movements are written twice (reported, never merged):');
  for (const g of dupes) console.log('  ' + g.map(e => e.name + ' [' + e.id + ']').join('   ==   '));
}
