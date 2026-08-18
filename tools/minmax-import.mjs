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
 * WHAT IS LEFT IN HERE. Only the xlsx reader - the zip, the shared string table, the cells. Reading
 * a PROGRAMME out of the grid is Training.blocksFromGrid, in the engine, because the app has to do
 * exactly that too: a sheet uploaded in the wizard is read by the same code as a sheet passed here,
 * so the two cannot drift into two different opinions about what column 13 means. See that function
 * for the layout expected and for the Excel-turns-"6-8"-into-a-date business.
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

// ---- run ---------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const file = args.filter(a => !a.startsWith('--'))[0];
if (!file) { console.error('usage: node tools/minmax-import.mjs <sheet.xlsx> [--name "..."] [--out file.json] [--split 6]'); process.exit(1); }
const argOf = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const name = argOf('name', file.split('/').pop().replace(/\.xlsx$/i, ''));
const splitAt = +argOf('split', 0);
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);

// The reading itself lives in the engine, as Training.blocksFromGrid, because the APP has to do it
// too: uploading the sheet in the wizard reads it exactly by the same code that runs here. Two
// implementations of "what does column 13 mean" is one of them being wrong and nobody noticing.
// A twelve week programme is two blocks, not one - the app runs a block, reviews it, starts the
// next - so --split says where the author's programme divides.
const res = Training.blocksFromGrid(readSheet(file), {
  name, fileName: file.split('/').pop(), idPrefix: 'blk_' + slug,
  splitAt: splitAt > 0 ? splitAt : Infinity,
});
if (!res) { console.error('no weeks found - is this the right sheet?'); process.exit(1); }
const { blocks, unknown } = res;

const out = argOf('out', slug + '.block.json');
writeFileSync(out, JSON.stringify({ macrosaurus: 'blocks', version: 1, blocks }, null, 2));
const week1 = blocks[0].sessions.filter(s => s.week === 1);
console.log(name);
console.log('  ' + res.weeks + ' weeks, ' + res.daysPerWeek + ' days a week, ' + blocks.length + ' block' + (blocks.length > 1 ? 's' : ''));
week1.forEach(s => console.log('    ' + s.name + ': ' + s.exercises.length + ' movements, '
  + s.exercises.reduce((a, e) => a + e.target.sets, 0) + ' sets'));
const choices = Training.blockChoices(blocks[0]);
if (choices.length) console.log('  choices left to you: ' + choices.map(c => c.label + ' (' + c.options.length + ' options)').join(', '));
if (unknown.length) {
  console.log('\n  ' + unknown.length + ' movement' + (unknown.length > 1 ? 's were' : ' was') + ' not in the library. Each got an entry guessed from its name - worth adding properly:');
  unknown.forEach(n => console.log('    ' + n));
}
