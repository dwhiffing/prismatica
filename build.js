import { writeFileSync, mkdirSync } from 'fs';
import { deflateAsync } from '@gfx/zopfli';
import { bundle } from './bundle.js';

const LIMIT = 13 * 1024; // 13k = 13312 bytes (js13k measures the ZIP)
mkdirSync('dist', { recursive: true });

// bundle + minify + inline
const html = await bundle({ minify: true });
writeFileSync('dist/index.html', html);

// --- build a minimal ZIP (js13k requires a .zip; its size is what counts) ---
// zopfli raw DEFLATE for the single entry, then hand-assemble the ZIP records.
const NAME = 'index.html';
const data = Buffer.from(html);
const comp = Buffer.from(await deflateAsync(data, { numiterations: 100 })); // raw DEFLATE
const crc = crc32(data);
const name = Buffer.from(NAME);

// local file header (sig 0x04034b50) + name + compressed data
const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);   // version needed
local.writeUInt16LE(0, 6);    // flags
local.writeUInt16LE(8, 8);    // method: deflate
local.writeUInt16LE(0, 10);   // mod time
local.writeUInt16LE(0x21, 12); // mod date (nonzero, arbitrary)
local.writeUInt32LE(crc, 14);
local.writeUInt32LE(comp.length, 18); // compressed size
local.writeUInt32LE(data.length, 22); // uncompressed size
local.writeUInt16LE(name.length, 26);
local.writeUInt16LE(0, 28);   // extra len

// central directory header (sig 0x02014b50)
const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(20, 4);  // version made by
central.writeUInt16LE(20, 6);  // version needed
central.writeUInt16LE(0, 8);   // flags
central.writeUInt16LE(8, 10);  // method
central.writeUInt16LE(0, 12);  // mod time
central.writeUInt16LE(0x21, 14); // mod date
central.writeUInt32LE(crc, 16);
central.writeUInt32LE(comp.length, 20);
central.writeUInt32LE(data.length, 24);
central.writeUInt16LE(name.length, 28);
// remaining fields (extra/comment/disk/attrs/offset) stay 0 except offset:
central.writeUInt32LE(0, 42);  // offset of local header

const centralWithName = Buffer.concat([central, name]);

// end of central directory (sig 0x06054b50)
const localWithData = Buffer.concat([local, name, comp]);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(1, 8);   // entries on this disk
eocd.writeUInt16LE(1, 10);  // total entries
eocd.writeUInt32LE(centralWithName.length, 12); // central dir size
eocd.writeUInt32LE(localWithData.length, 16);   // central dir offset

const zip = Buffer.concat([localWithData, centralWithName, eocd]);
writeFileSync('dist/game.zip', zip);

// report (measure the ZIP)
const used = zip.length;
const left = LIMIT - used;
const pct = ((used / LIMIT) * 100).toFixed(1);
const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
console.log(`
  html (raw)   ${html.length.toLocaleString()} bytes
  zip          ${used.toLocaleString()} bytes
  [${bar}] ${pct}% of 13,312
  ${left >= 0 ? `\x1b[32m✓ ${left.toLocaleString()} bytes left\x1b[0m` : `\x1b[31m✗ OVER by ${(-left).toLocaleString()} bytes\x1b[0m`}
`);

// CRC32 (standard IEEE polynomial) for the ZIP entry.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
