#!/usr/bin/env node
/* Turn the two written Macrosaurus programmes into the templates the app ships.
 *
 * WHY A TOOL AND NOT A PASTE. The programmes are spreadsheets, and a spreadsheet re-typed by hand
 * is a spreadsheet with a typo in it. This reads them the same way the app reads an uploaded one
 * (Training.blocksFromGrid) and prints the constant, so what ships is what the sheet says and
 * re-running it after an edit to the sheet is one command rather than an afternoon.
 *
 * WHICH WEEK. The sheets run twelve weeks and their movements, sets, rep ranges and rests are the
 * same in every one of them. What changes is effort: week 1 (and week 7) is an intro week a rep or
 * two further from failure, weeks 2-6 are the working prescription, and weeks 8-12 are that again
 * with intensity techniques laid over it. The app's block is four weeks and does not have a week to
 * give away to a ramp-in, so the template is the WORKING week - every last set all-out from session
 * one. Techniques belong to the block after this one; see Training.applyTechniques.
 *
 *   node tools/gen-programmes.mjs <4day.xlsx> <5day.xlsx> > /tmp/programmes.js
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Training = require('../app/training.js');

function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not an xlsx');
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
    const e = entries[name]; if (!e) return '';
    const lnameLen = dv.getUint16(e.localOff + 26, true);
    const lextraLen = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + e.compSize);
    return new TextDecoder().decode(e.method === 0 ? raw : inflateRawSync(raw));
  };
}

function readSheet(path) {
  const read = unzip(new Uint8Array(readFileSync(path)));
  const shared = [];
  read('xl/sharedStrings.xml').replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => {
    let s = ''; si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, t) => { s += t; return ''; });
    shared.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    return '';
  });
  const xml = read('xl/worksheets/sheet1.xml');
  const rows = [];
  xml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
    const cells = [];
    rowXml.replace(/<c([^>]*?)\/>|<c([^>]*?)>([\s\S]*?)<\/c>/g, (__, selfAttrs, attrs, inner) => {
      const a = selfAttrs || attrs || '';
      const ref = (a.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      let col = 0;
      for (let i = 0; i < ref.length; i++) col = col * 26 + (ref.charCodeAt(i) - 64);
      const v = ((inner || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inlineT = ((inner || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      const text = inlineT != null ? inlineT : (v == null ? '' : (/t="s"/.test(a) ? (shared[+v] || '') : v));
      while (cells.length < Math.max(0, col - 1)) cells.push('');
      cells.push(String(text));
      return '';
    });
    rows.push(cells);
    return '';
  });
  return rows;
}

// The working week, as a template: one week of days, each movement carrying everything the author
// wrote against it. WEEK is the week of the sheet to take - 2, the first of the working weeks.
const WEEK = 2;
function templateFrom(path) {
  const res = Training.blocksFromGrid(readSheet(path), { splitAt: Infinity });
  if (!res) throw new Error('not a programme: ' + path);
  if (res.unknown.length) throw new Error('unknown movements, add them to the library first: ' + res.unknown.join(', '));
  const block = res.blocks[0];
  // templateOf reads week 1, so hand it a block whose week 1 IS the working week.
  const week = block.sessions.filter(s => s.week === WEEK).map(s => Object.assign({}, s, { week: 1 }));
  return { template: Training.templateOf(Object.assign({}, block, { sessions: week })), days: res.daysPerWeek };
}

// Everything that is null, empty or rederivable is dropped: the template is read back by
// blockFromTemplate, which fills those in itself, and thirty kilobytes of "technique": null in the
// shipped bundle is thirty kilobytes every phone downloads to learn nothing.
function compact(template) {
  return template.map(day => ({
    name: day.name, kind: day.kind, dayOfWeek: day.dayOfWeek,
    exercises: day.exercises.map(e => {
      const o = { exerciseId: e.exerciseId, target: e.target };
      if (e.target.tempo == null) delete e.target.tempo;
      if (e.choice) o.choice = e.choice;
      if (e.alts && e.alts.length) o.alts = e.alts;
      if (e.technique) o.technique = e.technique;
      if (e.warmups != null) o.warmups = e.warmups;
      if (e.planNote) o.planNote = e.planNote;
      if (e.sourceName) o.sourceName = e.sourceName;
      return o;
    }),
  }));
}

const [four, five] = process.argv.slice(2);
if (!four || !five) { console.error('usage: node tools/gen-programmes.mjs <4day.xlsx> <5day.xlsx>'); process.exit(1); }
const a = templateFrom(four), b = templateFrom(five);
const out = [
  { key: 'mac4', name: 'Macrosaurus Default 4 Day', daysPerWeek: a.days, template: compact(a.template) },
  { key: 'mac5', name: 'Macrosaurus 5 Day', daysPerWeek: b.days, template: compact(b.template) },
];
// One day per line: readable enough to diff when a sheet changes, compact enough not to add a
// thousand lines to the engine.
console.log('[' + out.map(p => '\n  { key: ' + JSON.stringify(p.key) + ', name: ' + JSON.stringify(p.name)
  + ', daysPerWeek: ' + p.daysPerWeek + ', template: [\n'
  + p.template.map(d => '    ' + JSON.stringify(d)).join(',\n') + '\n  ] }').join(',') + '\n]');
