import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { minify as terser } from 'terser';
import { Packer } from 'roadroller';

// Property names that reach a Web/DOM/builtin API (or an HTML data-* attribute) and
// therefore MUST NOT be renamed by mangleProps. Everything NOT in this closed set is
// one of our own game-object properties (S.buildings, Building.chain, Spline.geo, …)
// and is safe to mangle to a single char. Adding a new external API call? Add its
// property here or the release build will silently break. `t` is reserved because
// ui.ts reads the `data-t` HTML attribute via `dataset.t`.
const RESERVE = new RegExp('^(' + [
  // Math / Array / String / Object builtins
  'length', 'min', 'max', 'abs', 'sin', 'cos', 'tan', 'atan2', 'sqrt', 'hypot', 'sign', 'floor',
  'round', 'ceil', 'PI', 'SQRT2', 'random', 'from', 'push', 'pop', 'map', 'filter',
  'some', 'find', 'findIndex', 'sort', 'includes', 'slice', 'indexOf', 'set',
  'forEach', 'split', 'join', 'concat', 'reverse', 'get', 'toString', 'isArray', // Array/String/WeakMap methods
  // canvas 2d context + gradients/patterns
  'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect',
  'strokeRect', 'rect', 'clip', 'save', 'restore', 'translate', 'scale', 'rotate',
  'arc', 'fillText', 'textAlign', 'setLineDash', 'lineDashOffset', 'lineCap',
  'lineJoin', 'createRadialGradient', 'createLinearGradient', 'addColorStop', 'createPattern', 'getImageData',
  'putImageData', 'createImageData', 'getChannelData', 'data', 'drawImage', 'clearRect',
  // canvas / dom element + window + events
  'width', 'height', 'getElementById', 'getContext', 'createElement', 'innerHTML', 'onclick', 'dataset',
  'appendChild', 'remove', 'cssText', 'body', 'opacity',
  'target', 'style', 'clientX', 'clientY', 'button', 'key', 'shiftKey', 'pointerId',
  'setPointerCapture', 'releasePointerCapture', 'preventDefault', 'deltaY',
  'onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel', 'onpointerleave', 'oncontextmenu',
  'onwheel',
  // WebAudio
  'createBuffer', 'createBufferSource', 'createGain', 'destination', 'connect',
  'disconnect', 'start', 'resume', 'loop', 'buffer', 'gain', 'value',
  // timing
  'now',
  // localStorage key + HTML data-t attribute
  'm', 't',
  // building/entity type codes: keys of R/COST/BUILD/ENTITIES/COL, but ALSO the runtime
  // string values of BType/EType (R[b.t], ENTITIES[n.k], data-t attrs). The record keys
  // must stay literal so the string-keyed lookups still resolve.
  'S', 'L', 'M', 'T', 'E', 'X', '_',
  // EType model keys (ENTITIES/R lookups via literal strings n.k / b.ek)
  'rockLarge', 'rockMedium', 'rockSmall', 'N', 'N2', 'N3', 'E2', 'E3', 'E4', 
].join('|') + ')$');

// Bundle src/game.ts and inline it into src/index.html.
// minify=false for fast dev builds; true for the size-checked release build.
export async function bundle({ minify = true } = {}) {
  const res = await build({
    entryPoints: ['./src/game.ts'],
    bundle: true,
    minify,
    format: 'iife',
    // es2022 lets esbuild emit logical-assignment (&&=, ??=), class fields, etc. — a bit
    // more compact than es2020. Every browser that runs a canvas game supports it.
    target: 'es2022',
    // Rename every game-object property (anything not in RESERVE) to a short name. Only
    // in the minified release build — dev keeps readable names. Saves ~300 gzipped bytes.
    ...(minify ? { mangleProps: /.*/, reserveProps: RESERVE } : {}),
    // DEV is true only for the non-minified dev build; DEV-guarded code (e.g. exposing
    // regen() on window for the console) is dead-code-eliminated from the minified release.
    // MINIMAP: true = corner minimap, false = edge threat arrows. Injected as a literal so
    // the unused one (and its whole module) is dead-code-eliminated. FLIP IT HERE.
    // DEVTOOLS: in-editor debug shortcuts (e.g. press 'e' to spawn an enemy at the cursor).
    // Injected as a literal so the whole dev-tools block is dead-code-eliminated when off.
    // Defaults on for the dev build, off for release; flip the release value here to test.
    // SKIPTITLE: dev boots straight into the game (skips the title/menu); always false in release.
    define: { DEV: String(!minify), MINIMAP: 'false', FOG: 'true', DEVTOOLS: String(!minify), SKIPTITLE: String(!minify) },
    write: false,
  });
  let js = res.outputFiles[0].text.trim();
  // Release only: a second minify pass with Terser on esbuild's output. esbuild is fast but
  // conservative; Terser's multi-pass compressor (with the unsafe-math/arrow transforms that
  // are safe for this self-contained game) squeezes another ~580 gzipped bytes out. Dev skips
  // it to keep rebuilds instant. Property names are already mangled by esbuild (mangleProps);
  // toplevel var mangling here shortens the remaining local/global identifiers.
  if (minify) {
    const out = await terser(js, {
      compress: { passes: 3, unsafe: true, unsafe_math: true, unsafe_arrows: true, booleans_as_integers: true },
      mangle: { toplevel: true },
      format: { comments: false },
    });
    if (out.error) throw out.error;
    js = out.code;
    // Release only: Roadroller re-packs the minified JS with a context-mixing arithmetic
    // coder into a tiny self-extracting `eval` payload. It beats gzip/DEFLATE on JS by ~1KB
    // here; the resulting HTML is still gzipped by build.js for the size check. Skipped in
    // dev (it's slow and would obscure stack traces). Set ROADROLLER=0 to bypass for debugging.
    if (process.env.ROADROLLER !== '0') {
      const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], {});
      await packer.optimize(1);
      const { firstLine, secondLine } = packer.makeDecoder();
      js = firstLine + secondLine;
    }
  }
  // Use a replacer FUNCTION, not a string: a string replacement interprets `$&`, `$'`, `$$`
  // etc., and the minified/packed code contains `$` chars, which would corrupt the output
  // (and can leave `__JS__` un-substituted). A function returns `js` verbatim.
  return readFileSync('src/index.html', 'utf8').replace('__JS__', () => js);
}
