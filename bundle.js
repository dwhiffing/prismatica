import { build } from 'esbuild';
import { readFileSync } from 'fs';

// Bundle src/game.ts and inline it into src/index.html.
// minify=false for fast dev builds; true for the size-checked release build.
export async function bundle({ minify = true } = {}) {
  const res = await build({
    entryPoints: ['./src/game.ts'],
    bundle: true,
    minify,
    format: 'iife',
    target: 'es2020',
    // DEV is true only for the non-minified dev build; DEV-guarded code (e.g. exposing
    // regen() to the Leva panel) is dead-code-eliminated from the minified release.
    define: { DEV: String(!minify) },
    write: false,
  });
  const js = res.outputFiles[0].text.trim();
  return readFileSync('src/index.html', 'utf8').replace('__JS__', js);
}
