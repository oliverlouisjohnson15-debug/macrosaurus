// Composite the new Macrosaurus T-rex mascot over the old logo in web/og.png.
// Decodes the existing PNG (no deps), paints the old-logo box with the sampled
// background purple, draws the new sprite, and re-encodes. Position via env: OGX/OGY/OGCELL.
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const ART = [
  '..........LLLLL.', '..........BBBBBB', '..........BBPBBB', '..........BBBB..',
  'L.........DBBB..', 'BL.......DBBBB..', 'BBLD.D.DDBBBBB..', 'BBBLLLLLLLBBBB..',
  '.BBBBBBBBBBBBB..', '..BBBBBBBBBBBL..', '..BBBBBBBBBBB...', '..BBBBBBBBBB....',
  '..BBB..BBBB.....', '..BBB..BBB......', '..DDD..BDDD.....',
];
const RGB = { L: [123, 217, 87], B: [70, 185, 74], D: [44, 140, 62], P: [18, 58, 28] };
const GW = ART[0].length, GH = ART.length;

// --- PNG decode (8-bit, non-interlaced; color type 2 RGB or 6 RGBA) ---
function decodePNG(buf) {
  let p = 8; const idat = [];
  let width, height, ctype;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); ctype = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
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

// --- PNG encode (RGBA) ---
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, cr]); }
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const src = decodePNG(readFileSync('web/og.png'));
const { width: W, height: H, bpp, data } = src;
// to RGBA canvas
const cv = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { cv[i * 4] = data[i * bpp]; cv[i * 4 + 1] = data[i * bpp + 1]; cv[i * 4 + 2] = data[i * bpp + 2]; cv[i * 4 + 3] = 255; }
const px = (x, y) => { const o = (y * W + x) * 4; return [cv[o], cv[o + 1], cv[o + 2]]; };
const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; cv[o] = c[0]; cv[o + 1] = c[1]; cv[o + 2] = c[2]; cv[o + 3] = 255; };

// sample background purple from a clear spot below the wordmark
const bg = px(90, 118);
console.log('sampled bg:', bg);

// old-logo box to repaint, and new sprite placement
const cell = +(process.env.OGCELL || 3);
const ox = +(process.env.OGX || 64), oy = +(process.env.OGY || 40);
const boxX0 = 48, boxY0 = 30, boxX1 = 132, boxY1 = 98;
for (let y = boxY0; y < boxY1; y++) for (let x = boxX0; x < boxX1; x++) set(x, y, bg);
for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
  const c = RGB[ART[gy][gx]]; if (!c) continue;
  for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) set(ox + gx * cell + dx, oy + gy * cell + dy, c);
}

writeFileSync('web/og.png', encodePNG(W, H, cv));
console.log(`wrote web/og.png (${W}x${H}), sprite at ${ox},${oy} cell ${cell}`);
