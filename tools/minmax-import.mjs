#!/usr/bin/env node
/* Turn a written training spreadsheet into a Macrosaurus block file.
 *
 * WHY THIS EXISTS. The app can already read a plan out of a photograph or a PDF, but that path runs
 * through a model and costs a guess on every line. A spreadsheet does not need guessing: it has
 * columns, and the columns say what they mean. So a plan you own as a spreadsheet deserves an exact
 * import - every set, rep range, RIR and rest read off the sheet, nothing inferred, and the same
 * answer every time it is run.
 *
 * WHAT IT DOES NOT DO. It writes a file. It does not publish anything, and nothing it produces goes
 * into the app's shipped bundle: a plan someone bought is theirs, and the file lands in their own
 * account when they load it. The exercise LIBRARY is a different matter - a movement's name is not
 * anybody's programme, so anything the library did not know is reported here and added to the
 * library properly rather than smuggled into the file.
 *
 * THE SHEET IT EXPECTS (the layout every coaching-app export shares):
 *   col 1  week marker ("Week 3") on its own row, and the day label ("Upper 1") on the row its
 *          first movement sits on
 *   col 2  exercise name          col 3  last-set intensity technique
 *   col 4  warm-up sets           col 5  working sets            col 6  rep range
 *   col 11 RIR on set 1           col 12 RIR on the last set     col 13 rest
 *   col 14 substitution 1         col 15 substitution 2          col 16 notes
 *
 * Rep ranges and warm-up counts come out of Excel as DATES: a spreadsheet reads "6-8" as the 6th of
 * August and stores a serial number. Anything numeric in those two columns is converted back.
 *
 *   node tools/minmax-import.mjs <sheet.xlsx> [--name "The Min-Max Program 5x"] [--out block.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const Training = createRequire(import.meta.url)('../app/training.js');

// ---- reading the workbook ---------------------------------------------------------------------
// An xlsx is a zip of XML. Node can inflate a raw deflate stream, so this needs no dependency:
// walk the central directory, inflate the shared string table and the first worksheet, read cells.
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not an xlsx (no zip directory)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    entries[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))] = { method, compSize, localOff };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const e = entries[name];
    if (!e) return '';
    const lnameLen = dv.getUint16(e.localOff + 26, true);
    const lextraLen = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + e.compSize);
    return new TextDecoder().decode(e.method === 0 ? raw : inflateRawSync(raw));
  };
}

// Excel stores a date as days since 1899-12-30. "6-8" typed into a cell becomes the 6th of August.
function serialToRange(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.getUTCMonth() + 1 + '-' + d.getUTCDate();
}

function readSheet(path) {
  const read = unzip(new Uint8Array(readFileSync(path)));
  const shared = [];
  read('xl/sharedStrings.xml').replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => {
    let s = '';
    si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, t) => { s += t; return ''; });
    shared.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    return '';
  });
  const sheetName = Object.keys({ 'xl/worksheets/sheet1.xml': 1 })[0];
  const xml = read(sheetName);
  if (!xml) throw new Error('no worksheet in ' + path);
  const rows = [];
  xml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
    const cells = [];
    rowXml.replace(/<c([^>]*?)\/>|<c([^>]*?)>([\s\S]*?)<\/c>/g, (__, selfAttrs, attrs, inner) => {
      // The self-closing case FIRST, and non-greedy. A blank-but-styled cell is written
      // `<c r="A14" s="1"/>`, and matching `<c([^>]*)>` against it captures the trailing slash
      // as an attribute and then runs on to the next `</c>` several columns later - swallowing
      // every cell in between and shifting the whole row left. A spreadsheet read that way is
      // not slightly wrong, it is reps in the rest column.
      const a = selfAttrs || attrs || '';
      const ref = (a.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      let col = 0;
      for (let i = 0; i < ref.length; i++) col = col * 26 + (ref.charCodeAt(i) - 64);
      const isShared = /t="s"/.test(a);
      const v = ((inner || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inlineT = ((inner || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      let text = inlineT != null ? inlineT : (v == null ? '' : (isShared ? (shared[+v] || '') : v));
      while (cells.length < Math.max(0, col - 1)) cells.push('');
      cells.push(String(text));
      return '';
    });
    rows.push(cells);
    return '';
  });
  return rows;
}

// ---- reading the plan out of the grid ----------------------------------------------------------
const DATE_COLS = { 4: 1, 6: 1 };            // warm-up sets and rep range, the two Excel mangles
const cellAt = (r, i) => {
  let v = (r[i] == null ? '' : String(r[i])).trim();
  if (DATE_COLS[i] && /^\d+(\.\d+)?$/.test(v) && +v > 20000) v = serialToRange(+v);
  return v;
};
const RANGE = (v) => {
  const m = String(v).match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? { low: +m[1], high: +m[2] } : null;
};

// "This can be a Barbell Back Squat, Barbell Front Squat, Pendulum Squat, Hack Squat, Belt Squat, or
// Smith Machine Squat." - a slot the author left open, and the note is the list of what fills it.
function choiceFrom(name, note, custom) {
  if (!/your choice/i.test(name) && !/^this can be/i.test(note || '')) return null;
  const listed = String(note || '').replace(/^this can be (a|an)\s*/i, '').replace(/\.$/, '')
    .split(/,| or /i).map(x => x.trim()).filter(Boolean);
  const options = [];
  listed.forEach(n => {
    const d = Training.resolveDetail(n, custom);
    if (d && options.indexOf(d.id) === -1) options.push(d.id);
  });
  if (options.length < 2) return null;
  const label = name.replace(/\s*\(your choice\)\s*/i, '').trim() || 'Your choice';
  return { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: label + ' - your choice', options };
}

function parse(rows, opts) {
  const custom = [];
  const unknown = [];
  const resolve = (name) => {
    const d = name ? Training.resolveDetail(name, custom) : null;
    if (!d) { if (name && unknown.indexOf(name) === -1) unknown.push(name); return null; }
    return d.id;
  };
  const weeks = [];
  let week = null, day = null;
  for (const r of rows) {
    const marker = cellAt(r, 1);
    if (/^Week \d+$/.test(marker)) { week = { n: +marker.split(' ')[1], days: [] }; weeks.push(week); day = null; continue; }
    const name = cellAt(r, 2);
    if (!week || !name || name === 'Exercise') continue;
    if (marker && !/^Week/.test(marker)) { day = { name: marker, items: [] }; week.days.push(day); }
    if (!day) { day = { name: 'Day ' + (week.days.length + 1), items: [] }; week.days.push(day); }
    const reps = RANGE(cellAt(r, 6));
    const sets = +cellAt(r, 5) || 1;
    // "0-1", "1-2", "2-4": how many warm-up sets the author wants before the working ones. Their
    // number is better than anything computed from the load, and it is right there in the column.
    const warm = RANGE(cellAt(r, 4));
    const rest = RANGE(String(cellAt(r, 13)).replace(/\s*min.*/i, ''));
    const rirRaw = (i) => { const v = cellAt(r, i); return /^\d+$/.test(v) ? +v : null; };
    const note = cellAt(r, 16);
    const choice = choiceFrom(name, note, custom);
    const id = choice ? choice.options[0] : resolve(name);
    if (!id) continue;
    const alts = [cellAt(r, 14), cellAt(r, 15)]
      .filter(x => x && !/^(n\/a|see notes)$/i.test(x)).map(x => resolve(x)).filter(Boolean);
    day.items.push({
      exerciseId: id, sourceName: name, sets,
      repLow: reps ? reps.low : null, repHigh: reps ? reps.high : null,
      rir: rirRaw(11), rirLast: rirRaw(12),
      restSec: rest ? Math.round(((rest.low + rest.high) / 2) * 60) : null,
      technique: (cellAt(r, 3) && !/^n\/a$/i.test(cellAt(r, 3))) ? cellAt(r, 3) : null,
      warmups: warm ? Math.round((warm.low + warm.high) / 2) : null,
      choice, alts: alts.length ? alts : null, note: note || null,
    });
  }
  return { weeks, unknown };
}

// ---- writing the block -------------------------------------------------------------------------
const KIND = (name) => {
  const n = name.toLowerCase();
  if (n.includes('full')) return 'full';
  if (n.includes('arm') || n.includes('delt')) return 'arms';
  if (n.includes('upper')) return 'upper';
  if (n.includes('lower') || n.includes('leg')) return 'lower';
  return 'full';
};
// Where a week's sessions fall. The sheets say "1-2 Rest Days" between days rather than naming
// weekdays, so this spaces them the way the programme reads: consecutive, with the gaps kept.
const DOW = { 4: [0, 3, 4, 5], 5: [0, 1, 3, 4, 5], 3: [0, 2, 4], 2: [0, 3], 6: [0, 1, 2, 3, 4, 5] };

function toBlock(weeks, opts) {
  const dayCount = weeks[0].days.length;
  const dows = DOW[dayCount] || weeks[0].days.map((_, i) => Math.min(i, 6));
  const sessions = [];
  weeks.forEach((w, wi) => {
    w.days.forEach((d, di) => {
      sessions.push({
        id: 'w' + (wi + 1) + 'd' + di, week: wi + 1, dayOfWeek: dows[di] == null ? Math.min(di, 6) : dows[di],
        name: d.name, kind: KIND(d.name), deload: false,
        exercises: d.items.map((it, ei) => ({
          id: it.exerciseId + '_i' + di + '_' + ei + '_w' + (wi + 1),
          exerciseId: it.exerciseId, order: ei, sourceName: it.sourceName,
          choice: it.choice || undefined, alts: it.alts || undefined,
          technique: it.technique || undefined, planNote: it.note || undefined,
          warmups: it.warmups == null ? undefined : it.warmups,
          target: {
            sets: it.sets,
            repLow: it.repLow || 6, repHigh: it.repHigh || 10,
            rir: it.rir == null ? 1 : it.rir,
            rirLast: it.rirLast == null ? (it.rir == null ? 0 : it.rir) : it.rirLast,
            restSec: it.restSec || 120,
            tempo: null,
          },
        })),
      });
    });
  });
  return {
    id: 'blk_' + opts.slug,
    name: opts.name,
    goal: 'hypertrophy',
    weeks: weeks.length,
    shape: 'as-written',
    style: 'minmax',
    daysPerWeek: dayCount,
    intensity: 'high',
    startISO: null,
    source: 'import',
    sourceRef: { kind: 'file', name: opts.file },
    sessions,
  };
}

// ---- run ---------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const file = args.filter(a => !a.startsWith('--'))[0];
if (!file) { console.error('usage: node tools/minmax-import.mjs <sheet.xlsx> [--name "..."] [--out file.json] [--split 6]'); process.exit(1); }
const argOf = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const name = argOf('name', file.split('/').pop().replace(/\.xlsx$/i, ''));
const splitAt = +argOf('split', 0);

const { weeks, unknown } = parse(readSheet(file), {});
if (!weeks.length) { console.error('no weeks found - is this the right sheet?'); process.exit(1); }
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
// A twelve week programme is two blocks, not one: the app runs a block, reviews it, and starts the
// next. Split where the author does.
const chunks = splitAt > 0 && weeks.length > splitAt
  ? [weeks.slice(0, splitAt), weeks.slice(splitAt)]
  : [weeks];
const blocks = chunks.map((c, i) => toBlock(c, {
  name: chunks.length > 1 ? name + ' - Block ' + (i + 1) : name,
  slug: slug + (chunks.length > 1 ? '_b' + (i + 1) : ''),
  file: file.split('/').pop(),
}));

const out = argOf('out', slug + '.block.json');
writeFileSync(out, JSON.stringify({ macrosaurus: 'blocks', version: 1, blocks }, null, 2));
const week1 = blocks[0].sessions.filter(s => s.week === 1);
console.log(name);
console.log('  ' + weeks.length + ' weeks, ' + weeks[0].days.length + ' days a week, ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
week1.forEach(s => console.log('    ' + s.name + ': ' + s.exercises.length + ' movements, '
  + s.exercises.reduce((a, e) => a + e.target.sets, 0) + ' sets'));
const choices = Training.blockChoices(blocks[0]);
if (choices.length) console.log('  choices left to you: ' + choices.map(c => c.label + ' (' + c.options.length + ' options)').join(', '));
if (unknown.length) {
  console.log('  NOT IN THE LIBRARY (add them to app/training.js, then re-run):');
  unknown.forEach(n => console.log('    ' + n));
}
console.log('  written to ' + out);
