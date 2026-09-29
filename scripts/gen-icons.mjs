// Generates the simple placeholder app icons (public/icons/*.png) with no dependencies. The
// output is committed; run `node scripts/gen-icons.mjs` only to regenerate it. The design is
// abstract (three rising gold bars on a dark tile): no lettering, no brand, no personal data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BACKGROUND = [26, 26, 26];
const GOLD = [201, 162, 39];

/**
 * @param {number} size
 * @param {number} pad fraction of the tile kept empty on every side (larger for maskable)
 * @returns {Buffer} RGBA pixels
 */
function draw(size, pad) {
  const pixels = Buffer.alloc(size * size * 4);
  const inner = size * (1 - 2 * pad);
  const left = size * pad;
  const bottom = size * (1 - pad);
  const barWidth = inner / 5;
  const heights = [0.4, 0.65, 0.9];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = BACKGROUND;
      heights.forEach((h, i) => {
        const bx0 = left + barWidth * 0.5 + i * barWidth * 1.5;
        const bx1 = bx0 + barWidth;
        if (x >= bx0 && x < bx1 && y >= bottom - inner * h && y < bottom) color = GOLD;
      });
      const at = (y * size + x) * 4;
      pixels[at] = color[0] ?? 0;
      pixels[at + 1] = color[1] ?? 0;
      pixels[at + 2] = color[2] ?? 0;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * @param {number} size
 * @param {Buffer} rgba
 * @returns {Buffer}
 */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0.14],
  ['icon-512.png', 512, 0.14],
  ['icon-512-maskable.png', 512, 0.3],
]) {
  writeFileSync(join(OUT, String(name)), encodePng(Number(size), draw(Number(size), Number(pad))));
}
process.stdout.write('gen-icons: wrote public/icons/*.png\n');
