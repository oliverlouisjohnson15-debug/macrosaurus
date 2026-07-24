// One-off generator for the Macrosaurus app/marketing icons. The mark is the buddy's GREEN EGG, taken
// straight from the real sprite pack (sprites/female/olaf/egg/move.png, frame 0), composited onto the
// brand purple tile. No third-party deps: PNG decode/encode via Node's built-in zlib.
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';

const BG = [91, 79, 166]; // #5B4FA6 brand purple
const EGG_SRC = 'sprites/female/olaf/egg/move.png'; // the green egg from the sprite pack

// --- minimal PNG decoder (8-bit, non-interlaced; RGB or RGBA) ---
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
const egg = decodePNG(readFileSync(EGG_SRC));
const F = egg.height;                 // square frames (24x24); frame 0 is the first F columns
const ESTRIDE = egg.width * egg.bpp;

// Composite the green egg (nearest-neighbour, crisp pixels), only its opaque pixels, over the purple tile.
function pixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255; }
  const cell = Math.max(1, Math.floor((size * 0.72) / F));
  const ox = Math.round((size - cell * F) / 2), oy = Math.round((size - cell * F) / 2);
  for (let gy = 0; gy < F; gy++) for (let gx = 0; gx < F; gx++) {
    const o = gy * ESTRIDE + gx * egg.bpp;
    const a = egg.bpp === 4 ? egg.data[o + 3] : 255; if (a < 128) continue;
    const r = egg.data[o], g = egg.data[o + 1], b = egg.data[o + 2];
    for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
      const x = ox + gx * cell + px, y = oy + gy * cell + py;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const q = (y * size + x) * 4; buf[q] = r; buf[q + 1] = g; buf[q + 2] = b; buf[q + 3] = 255;
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

// favicon.ico: an ICO wrapping a 32x32 PNG (supported by all modern browsers), so the
// default /favicon.ico request resolves instead of 404-ing to a stale cached icon.
function encodeICO(size, pngBuf) {
  const dir = Buffer.alloc(6); dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent[0] = size >= 256 ? 0 : size; ent[1] = size >= 256 ? 0 : size; ent[2] = 0; ent[3] = 0;
  ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(pngBuf.length, 8); ent.writeUInt32LE(22, 12);
  return Buffer.concat([dir, ent, pngBuf]);
}
const ico = encodeICO(32, encodePNG(32, pixels(32)));
for (const rel of ['favicon.ico', 'web/favicon.ico']) { writeFileSync(rel, ico); console.log(`wrote ${rel} (${ico.length} bytes, 32x32 ico)`); }
