/*
 * gen-anim.mjs — the animation forge.
 *
 * Claude Design authors ONE role-coded 24x24 pose per keyframe (design-exports/keyframes/*.json);
 * this turns each into a finished sprite strip for every species, in that species' own colours, by
 * sampling its 7-role palette out of its existing idle.png. One drawing becomes twenty variants.
 *
 * Roles: O outline · L body light · S body shade · C crest · B belly light · b belly shade · E eye.
 * Props (digits 1-4) carry explicit hex from the JSON — they are things that are not the dinosaur
 * (food, Z's, a bag) and so have no species colour.
 *
 * Also emits app/src/sprite-manifest.js: the generated truth about what is on disk (frame counts,
 * fps/loop, and which variants are missing which strip). app.jsx reads that instead of the old
 * hand-maintained SPRITE_FRAMES / SPRITE_INCOMPLETE_MALE constants, which could drift from reality.
 *
 * Usage: node tools/gen-anim.mjs [--check] [anim...]
 *   --check   validate and rebuild the manifest without writing any PNG
 * No third-party deps: PNG decode/encode via Node's built-in zlib.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';

const N = 24;                       // frame size
const FOOT_ROW = 20;                // the contact line: a grounded pose's lowest ink sits here
const ROLES = 'OLSCBbE';
const SRC_DIR = 'design-exports/keyframes';
const SPECIES = ['doux', 'cole', 'kira', 'kuro', 'loki', 'mono', 'mort', 'nico', 'olaf', 'sena', 'tard', 'vita'];
const PALETTES = ['female', 'male'];

// ---------- PNG decode (8-bit, non-interlaced; RGB or RGBA) ----------
function decodePNG(buf) {
  let p = 8; const idat = []; let width, height, ctype;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); ctype = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp; const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const v = raw[pos++];
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      let r; if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + b; else if (ft === 3) r = v + ((a + b) >> 1); else r = v + paeth(a, b, c);
      out[y * stride + i] = r & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}
// ---------- PNG encode (RGBA) ----------
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4 + 1; const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- palette sampling: pull the 7 roles from a variant's idle.png frame 0 ----------
// Lifted from gen-coma.mjs, which this script supersedes. The art pack uses exactly 7 opaque colours
// per variant, so the roles can be recovered by rank, luminance and hue without any hand mapping.
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360; return h;
}
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function samplePalette(palette, species) {
  const src = `sprites/${palette}/${species}/base/idle.png`;
  if (!existsSync(src)) return null;   // the four incomplete male colourways have no idle to sample
  const img = decodePNG(readFileSync(src));
  const stride = img.width * img.bpp, counts = new Map();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = y * stride + x * img.bpp; const a = img.bpp === 4 ? img.data[o + 3] : 255; if (a < 128) continue;
    const key = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const cols = [...counts.entries()].map(([k, n]) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, n }));
  cols.sort((a, b) => b.n - a.n);
  if (cols.length < 7) throw new Error(`${src}: expected 7 colours, found ${cols.length}`);
  const outline = cols.slice().sort((a, b) => lum(a.r, a.g, a.b) - lum(b.r, b.g, b.b))[0];
  const rest = cols.filter(c => c !== outline);
  const bodyL = rest[0], bodyS = rest[1];
  let low = rest.slice(2);
  const eye = low.slice().sort((a, b) => lum(b.r, b.g, b.b) - lum(a.r, a.g, a.b))[0];
  low = low.filter(c => c !== eye);
  let best = null;
  for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) {
    const d = hueDist(hueOf(low[i].r, low[i].g, low[i].b), hueOf(low[j].r, low[j].g, low[j].b));
    if (!best || d < best.d) best = { d, i, j };
  }
  const pair = [low[best.i], low[best.j]].sort((a, b) => lum(b.r, b.g, b.b) - lum(a.r, a.g, a.b));
  const crest = low.find((_, k) => k !== best.i && k !== best.j);
  const rgb = c => [c.r, c.g, c.b];
  return { O: rgb(outline), L: rgb(bodyL), S: rgb(bodyS), C: rgb(crest), B: rgb(pair[0]), b: rgb(pair[1]), E: rgb(eye) };
}

// ---------- load + validate the authored keyframes ----------
const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h));
  if (!m) throw new Error(`bad prop colour "${h}" (want #rrggbb)`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
function loadAnims() {
  const out = [];
  for (const f of readdirSync(SRC_DIR).filter(f => f.endsWith('.json')).sort()) {
    const a = JSON.parse(readFileSync(`${SRC_DIR}/${f}`, 'utf8'));
    const where = `${SRC_DIR}/${f}`;
    const fail = (m) => { throw new Error(`${where}: ${m}`); };
    if (!a.id) fail('missing id');
    // Batch B and C came back labelled "mood" and "life". Those are not directories on disk — every
    // one of these is the same body rig as idle/move, so they all belong in base/.
    if (a.group && a.group !== 'base') { a._regrouped = a.group; a.group = 'base'; }
    if (!Array.isArray(a.order) || a.order.length < 2 || a.order.length > 6) fail('order must be 2-6 frames');
    const props = {};
    for (const [d, hex] of Object.entries(a.props || {})) props[d] = hex2rgb(hex);
    const byId = new Map(a.keyframes.map(k => [k.id, k]));
    for (const id of a.order) if (!byId.has(id)) fail(`order references keyframe ${id}, which does not exist`);
    const legal = new Set([...ROLES, '.', ...Object.keys(props)]);
    for (const k of a.keyframes) {
      if (!Array.isArray(k.grid) || k.grid.length !== N) fail(`keyframe ${k.id} must have ${N} rows, has ${(k.grid || []).length}`);
      k.grid.forEach((row, y) => {
        if (row.length !== N) fail(`keyframe ${k.id} row ${y} is ${row.length} chars, want ${N}`);
        for (const ch of row) if (!legal.has(ch)) fail(`keyframe ${k.id} row ${y} uses "${ch}", which is not a role or a declared prop`);
      });
      const rows = k.grid.map((r, y) => (/[^.]/.test(r) ? y : -1)).filter(y => y >= 0);
      k._low = Math.max(...rows);
      if (k._low > FOOT_ROW) fail(`keyframe ${k.id} draws below the contact line (lowest ink row ${k._low}, max ${FOOT_ROW})`);
    }
    // Airborne mid-frames are fine (a hop, a stretch); the pose the animation RESTS on must be
    // grounded, or the buddy ends up hovering off the shadow the app draws under it.
    const last = byId.get(a.order[a.order.length - 1]);
    if (last._low !== FOOT_ROW) a._warn = `rests on keyframe ${last.id}, whose feet sit at row ${last._low} not ${FOOT_ROW}`;
    out.push({ ...a, props, byId });
  }
  return out;
}

// ---------- render one strip ----------
function render(anim, pal) {
  const W = N * anim.order.length;
  const buf = Buffer.alloc(W * N * 4);     // all-zero = transparent
  anim.order.forEach((kfId, f) => {
    const grid = anim.byId.get(kfId).grid;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const rgb = pal[ch] || anim.props[ch];
      if (!rgb) continue;
      const q = (y * W + f * N + x) * 4;
      buf[q] = rgb[0]; buf[q + 1] = rgb[1]; buf[q + 2] = rgb[2]; buf[q + 3] = 255;
    }
  });
  return encodePNG(W, N, buf);
}

// ---------- manifest: what is actually on disk, for the app to read ----------
function buildManifest(meta) {
  const frames = {}, present = {}, variants = [];
  for (const palette of PALETTES) for (const species of SPECIES) {
    const key = `${palette}/${species}`;
    if (!existsSync(`sprites/${key}`)) continue;
    variants.push(key);
    present[key] = new Set();
    for (const group of readdirSync(`sprites/${key}`)) {
      for (const f of readdirSync(`sprites/${key}/${group}`)) {
        if (!f.endsWith('.png')) continue;
        const strip = `${group}/${f.slice(0, -4)}`;
        const img = decodePNG(readFileSync(`sprites/${key}/${group}/${f}`));
        const n = img.width / N;
        if (!Number.isInteger(n) || img.height !== N) throw new Error(`sprites/${key}/${strip}.png is ${img.width}x${img.height}, not a 24px strip`);
        if (frames[strip] != null && frames[strip] !== n) throw new Error(`${strip}: ${n} frames in ${key} but ${frames[strip]} elsewhere — frame counts must be uniform`);
        frames[strip] = n;
        present[key].add(strip);
      }
    }
  }
  const all = Object.keys(frames).sort();
  const missing = {};
  for (const v of variants) {
    const gaps = all.filter(s => !present[v].has(s));
    if (gaps.length) missing[v] = gaps;
  }
  return { frames: Object.fromEntries(all.map(s => [s, frames[s]])), meta, missing };
}

// ---------- run ----------
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.filter(a => !a.startsWith('--'));

const anims = loadAnims().filter(a => !only.length || only.includes(a.id));
const regrouped = anims.filter(a => a._regrouped);
if (regrouped.length) console.log(`note: filed under base/ (authored as ${[...new Set(regrouped.map(a => a._regrouped))].join('/')}): ${regrouped.map(a => a.id).join(', ')}`);
for (const a of anims) if (a._warn) console.log(`warn: ${a.id} ${a._warn}`);

let written = 0, skipped = 0;
if (!checkOnly) {
  for (const palette of PALETTES) for (const species of SPECIES) {
    const pal = samplePalette(palette, species);
    if (!pal) { skipped++; continue; }
    for (const a of anims) {
      const dir = `sprites/${palette}/${species}/${a.group}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${a.id}.png`, render(a, pal));
      written++;
    }
  }
  console.log(`wrote ${written} strips (${anims.length} animations x ${written / (anims.length || 1)} variants); ${skipped} variants skipped for want of an idle to sample`);
}

const meta = {};
for (const a of loadAnims()) meta[`${a.group}/${a.id}`] = { fps: a.fps, loop: a.loop !== false };
const manifest = buildManifest(meta);
writeFileSync('sprites/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
writeFileSync('app/src/sprite-manifest.js',
  // No em dash: build.mjs rejects one anywhere in the bundle, and this header ships inside it.
  '// GENERATED by tools/gen-anim.mjs - do not edit. The truth about what is in sprites/.\n' +
  'const SPRITE_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ';\n');
const nStrips = Object.keys(manifest.frames).length;
console.log(`manifest: ${nStrips} distinct strips, ${Object.keys(manifest.missing).length} variants with gaps`);
