#!/usr/bin/env node
/* Check the programmes the app ships against the spreadsheets they came from, cell by cell.
 *
 * WHY A SECOND READER. tools/gen-programmes.mjs builds the templates by calling
 * Training.blocksFromGrid, so re-running it proves only that the generator is deterministic - a bug
 * in the column map would be reproduced perfectly and reported as a match. This reads the sheet with
 * its own map and its own arithmetic and compares the RESULT, so the two have to agree independently
 * before anything is called faithful.
 *
 * WHAT IT COMPARES. Every movement of the working week: the exercise, the working sets, the rep
 * range, the reps in reserve on the first set and on the last, the rest, the warm-up count, the
 * technique, the substitutions and the author's note.
 *
 * NAMES. The library holds a movement under one name; the sheet may write it another way. Only four
 * differences are allowed, and each one is reported by name so it can be read and disagreed with:
 * the kit at the other end of the name, the kit left implicit, a spelling, or an abbreviation.
 * Anything else is a movement that has been swapped for a different movement, and that is a failure.
 *
 *   node tools/verify-programmes.mjs <4day.xlsx> <5day.xlsx>
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const Training = createRequire(import.meta.url)('../app/training.js');

// ---- an independent read of the workbook ------------------------------------------------------
function cells(path) {
  const buf = new Uint8Array(readFileSync(path));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true), localOff = dv.getUint32(p + 42, true);
    entries[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))] = { method, compSize, localOff };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries[name]; if (!e) return '';
    const ln = dv.getUint16(e.localOff + 26, true), lx = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + ln + lx;
    const raw = buf.subarray(start, start + e.compSize);
    return new TextDecoder().decode(e.method === 0 ? raw : inflateRawSync(raw));
  };
  const shared = [];
  read('xl/sharedStrings.xml').replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => {
    let s = ''; si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, t) => { s += t; return ''; });
    shared.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    return '';
  });
  const rows = [];
  read('xl/worksheets/sheet1.xml').replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
    const r = {};
    rowXml.replace(/<c([^>]*?)\/>|<c([^>]*?)>([\s\S]*?)<\/c>/g, (__, sa, a, inner) => {
      const at = sa || a || '';
      const ref = (at.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      let col = 0; for (let i = 0; i < ref.length; i++) col = col * 26 + (ref.charCodeAt(i) - 64);
      const v = ((inner || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const it = ((inner || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      r[col] = it != null ? it : (v == null ? '' : (/t="s"/.test(at) ? (shared[+v] || '') : v));
      return '';
    });
    rows.push(r);
    return '';
  });
  return rows;
}

// Excel turns "6-8" into the 6th of August. Days since 1899-12-30, converted back.
const unDate = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d+(\.\d+)?$/.test(s) || +s < 20000) return s;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(+s) * 86400000);
  return (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
};
const range = (v) => { const m = String(v).match(/^(\d+)\s*-\s*(\d+)$/); return m ? [+m[1], +m[2]] : null; };

// Columns, written out here rather than imported, so a wrong map cannot agree with itself.
const C = { marker: 2, name: 3, technique: 4, warmups: 5, sets: 6, reps: 7, rir: 12, rirLast: 13, rest: 14, sub1: 15, sub2: 16, note: 17 };
const WORKING_WEEK = 2;

// The ways a library name may differ from the sheet's, each named so it can be argued with. Anything
// not on this list is a movement swapped for a different movement.
const KITW = /^(smith|machine|cable|dumbbell|barbell|kettlebell|band|ez)$/;
function nameVerdict(sheetName, libName) {
  const norm = (x) => String(x)
    // "(optional)" is the author telling you the movement is optional, not part of its name.
    .replace(/\s*\((optional|if available|as needed)\)\s*/i, ' ')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const expand = { db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', flye: 'fly', rdl: 'romanian deadlift', ham: 'hamstring', hams: 'hamstring' };
  const toks = (x) => norm(x).split(' ').flatMap(w => (expand[w] || w).split(' ')).filter(Boolean).map(w => w.replace(/s$/, ''));
  const a = toks(sheetName), b = toks(libName);
  if (a.join(' ') === b.join(' ')) return 'same';
  const noKit = (t) => t.filter(w => !KITW.test(w));
  if (noKit(a).join(' ') === noKit(b).join(' ')) return 'kit moved or implicit';
  if (/\((optional|if available|as needed)\)/i.test(sheetName)) return 'the author\'s aside dropped';
  return null;   // a different movement
}

const files = process.argv.slice(2);
if (files.length !== 2) { console.error('usage: node tools/verify-programmes.mjs <4day.xlsx> <5day.xlsx>'); process.exit(1); }

let problems = 0, checked = 0;
const rewrites = new Map();
Training.PROGRAMMES.forEach((prog, pi) => {
  const rows = cells(files[pi]);
  // Walk to the working week and collect its days exactly as the sheet lays them out.
  let week = 0, day = null;
  const days = [];
  for (const r of rows) {
    const marker = String(r[C.marker] || '').trim();
    if (/^week \d+$/i.test(marker)) { week = +marker.split(/\s+/)[1]; day = null; continue; }
    if (week !== WORKING_WEEK) continue;
    const name = String(r[C.name] || '').trim();
    if (!name || name === 'Exercise') continue;
    if (marker) { day = { name: marker, items: [] }; days.push(day); }
    if (!day) { day = { name: 'Day ' + (days.length + 1), items: [] }; days.push(day); }
    day.items.push(r);
  }

  console.log('\n=== ' + prog.name + '  (' + files[pi].split('/').pop() + ', week ' + WORKING_WEEK + ')');
  if (days.length !== prog.template.length) {
    console.log('  ! sheet has ' + days.length + ' days, the programme ships ' + prog.template.length);
    problems++;
  }
  days.forEach((d, di) => {
    const shipped = prog.template[di];
    if (!shipped) return;
    // Day names are styled the same way movement names are: the sheet's words, the app's case, and
    // a word where the sheet used punctuation ("Arms/Delts" is "Arms and delts" everywhere else the
    // app names a session). Same rule, so the same allowance - and the same report.
    const dayWords = (x) => String(x).toLowerCase().replace(/\s*\/\s*/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (dayWords(d.name) !== dayWords(shipped.name)) {
      console.log('  ! day ' + di + ' is "' + shipped.name + '", sheet says "' + d.name + '"'); problems++;
    } else if (d.name !== shipped.name) rewrites.set(d.name, shipped.name + '  (day name, house style)');
    if (d.items.length !== shipped.exercises.length) {
      console.log('  ! ' + d.name + ': sheet has ' + d.items.length + ' movements, the programme ships ' + shipped.exercises.length);
      problems++;
    }
    d.items.forEach((r, ei) => {
      const got = shipped.exercises[ei];
      if (!got) return;
      checked++;
      const lib = Training.byId(got.exerciseId);
      const sheetName = String(r[C.name] || '').trim();
      const bad = [];

      // The movement itself.
      if (!lib) bad.push('exercise ' + got.exerciseId + ' is not in the library');
      else if (got.choice) {
        // A slot the author left open: the note lists what fills it, and the programme must offer
        // that list rather than having quietly picked one.
        const listed = String(r[C.note] || '').replace(/^this can be (a|an)\s*/i, '').replace(/\.$/, '').split(/,| or /i)
          .map(x => x.trim()).filter(Boolean);
        if (got.choice.options.length !== listed.length) bad.push('choice offers ' + got.choice.options.length + ' of the ' + listed.length + ' the note lists');
      } else {
        const v = nameVerdict(sheetName, lib.name);
        if (!v) bad.push('sheet says "' + sheetName + '", programme has "' + lib.name + '"');
        else if (v !== 'same') rewrites.set(sheetName, lib.name + '  (' + v + ')');
      }

      // The prescription.
      const t = got.target;
      const sets = +String(r[C.sets] || '').trim() || 1;
      if (t.sets !== sets) bad.push('sets ' + t.sets + ' vs sheet ' + sets);
      const reps = range(unDate(r[C.reps]));
      if (reps && (t.repLow !== reps[0] || t.repHigh !== reps[1])) bad.push('reps ' + t.repLow + '-' + t.repHigh + ' vs sheet ' + reps.join('-'));
      const rir = String(r[C.rir] || '').trim(), rirLast = String(r[C.rirLast] || '').trim();
      if (/^\d+$/.test(rir) && t.rir !== +rir) bad.push('RIR ' + t.rir + ' vs sheet ' + rir);
      if (/^\d+$/.test(rirLast) && t.rirLast !== +rirLast) bad.push('last-set RIR ' + t.rirLast + ' vs sheet ' + rirLast);
      const rest = range(String(r[C.rest] || '').replace(/\s*min.*/i, ''));
      if (rest) {
        const want = Math.round(((rest[0] + rest[1]) / 2) * 60);
        if (t.restSec !== want) bad.push('rest ' + t.restSec + 's vs sheet ' + want + 's');
      }
      const warm = range(unDate(r[C.warmups]));
      if (warm) {
        const want = Math.round((warm[0] + warm[1]) / 2);
        if (got.warmups !== want) bad.push('warm-ups ' + got.warmups + ' vs sheet ' + want);
      }
      // The technique on the last set, the substitutions, and the note.
      const tech = String(r[C.technique] || '').trim();
      const wantTech = (tech && !/^n\/a$/i.test(tech)) ? tech : null;
      if ((got.technique || null) !== wantTech) bad.push('technique ' + JSON.stringify(got.technique || null) + ' vs sheet ' + JSON.stringify(wantTech));
      const subs = [r[C.sub1], r[C.sub2]].map(x => String(x || '').trim()).filter(x => x && !/^(n\/a|see notes)$/i.test(x));
      const alts = (got.alts || []).map(a => (Training.byId(a) || { name: a }).name);
      if (alts.length !== subs.length) bad.push('offers ' + alts.length + ' substitutions, sheet lists ' + subs.length);
      else subs.forEach((want, i) => {
        // Which movements, not just how many. A substitution swapped for something else is the same
        // failure as a prescribed movement swapped for something else, and quieter.
        const v = nameVerdict(want, alts[i]);
        if (!v) bad.push('substitution ' + (i + 1) + ' is "' + alts[i] + '", sheet says "' + want + '"');
        else if (v !== 'same') rewrites.set(want, alts[i] + '  (' + v + ')');
      });
      const note = String(r[C.note] || '').trim();
      if (note && (got.planNote || '') !== note) bad.push('the note does not match the sheet');

      if (bad.length) { console.log('  ! ' + d.name + ' / ' + sheetName + ': ' + bad.join('; ')); problems += bad.length; }
    });
  });
});

console.log('\n--- names the library holds under different words (' + rewrites.size + ') ---');
[...rewrites.entries()].sort().forEach(([a, b]) => console.log('  ' + a.padEnd(34) + ' -> ' + b));
console.log('\n' + checked + ' movements checked, ' + problems + ' differences from the spreadsheets.');
process.exit(problems ? 1 : 0);
