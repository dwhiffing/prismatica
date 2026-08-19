import { writeFileSync, mkdirSync } from 'fs';
import { gzipAsync } from '@gfx/zopfli';
import { bundle } from './bundle.js';

const LIMIT = 13 * 1024; // 13k = 13312 bytes
mkdirSync('dist', { recursive: true });

// bundle + minify + inline
const html = await bundle({ minify: true });
writeFileSync('dist/index.html', html);

// gzip via zopfli: same format as gzip -9, but a better encoder (~250 bytes smaller)
const gz = Buffer.from(await gzipAsync(Buffer.from(html), { numiterations: 100 }));
writeFileSync('dist/index.html.gz', gz);

// report
const used = gz.length;
const left = LIMIT - used;
const pct = ((used / LIMIT) * 100).toFixed(1);
const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
console.log(`
  html (raw)   ${html.length.toLocaleString()} bytes
  html (gzip)  ${used.toLocaleString()} bytes
  [${bar}] ${pct}% of 13,312
  ${left >= 0 ? `\x1b[32m✓ ${left.toLocaleString()} bytes left\x1b[0m` : `\x1b[31m✗ OVER by ${(-left).toLocaleString()} bytes\x1b[0m`}
`);
