// One-off generator for the Macrosaurus app/marketing icons from the mascot sprite.
// Draws the exact PixelDino grid (see app/src/app.jsx) onto a purple tile and writes
// PNGs with no third-party deps (manual PNG encode via Node's built-in zlib).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ART = [
  '..........LLLLL.',
  '..........BBBBBB',
  '..........BBPBBB',
  '..........BBBB..',
  'L.........DBBB..',
  'BL.......DBBBB..',
  'BBLD.D.DDBBBBB..',
  'BBBLLLLLLLBBBB..',
  '.BBBBBBBBBBBBB..',
  '..BBBBBBBBBBBL..',
  '..BBBBBBBBBBB...',
  '..BBBBBBBBBB....',
  '..BBB..BBBB.....',
  '..BBB..BBB......',
  '..DDD..BDDD.....',
];
const RGB = {
  L: [123, 217, 87], B: [70, 185, 74], D: [44, 140, 62], P: [18, 58, 28],
};
const BG = [91, 79, 166]; // #5B4FA6 brand purple
const W = ART[0].length, H = ART.length;

function pixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255; }
  const cell = Math.floor((size * 0.8) / Math.max(W, H));
  const ox = Math.round((size - cell * W) / 2), oy = Math.round((size - cell * H) / 2);
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    const c = RGB[ART[gy][gx]]; if (!c) continue;
    for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
      const x = ox + gx * cell + px, y = oy + gy * cell + py;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const o = (y * size + x) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
  return buf;
}

// --- minimal PNG encoder ---
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const targets = { 192: ['icon-192.png', 'web/icon-192.png'], 512: ['icon-512.png', 'web/icon-512.png'] };
for (const size of [192, 512]) {
  const png = encodePNG(size, pixels(size));
  for (const rel of targets[size]) { writeFileSync(rel, png); console.log(`wrote ${rel} (${png.length} bytes, ${size}x${size})`); }
}
