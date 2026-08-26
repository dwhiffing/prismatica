import { build } from 'esbuild';
import { readFileSync } from 'fs';

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
  'some', 'find', 'sort', 'includes', 'slice', 'indexOf', 'set',
  // canvas 2d context + gradients/patterns
  'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect',
  'strokeRect', 'rect', 'clip', 'save', 'restore', 'translate', 'scale', 'rotate',
  'arc', 'fillText', 'textAlign', 'setLineDash', 'lineDashOffset', 'lineCap',
  'lineJoin', 'createRadialGradient', 'createLinearGradient', 'addColorStop', 'createPattern', 'getImageData',
  'putImageData', 'getChannelData', 'data', 'drawImage', 'clearRect',
  // canvas / dom element + window + events
  'width', 'height', 'getElementById', 'getContext', 'createElement', 'innerHTML', 'onclick', 'dataset',
  'appendChild', 'remove', 'cssText', 'body', 'opacity',
  'target', 'style', 'clientX', 'clientY', 'button', 'key', 'shiftKey', 'pointerId',
  'setPointerCapture', 'releasePointerCapture', 'preventDefault', 'deltaY',
  'onpointerdown', 'onpointermove', 'onpointerup', 'onpointerleave', 'oncontextmenu',
  'onwheel',
  // WebAudio
  'createBuffer', 'createBufferSource', 'createGain', 'destination', 'connect',
  'disconnect', 'start', 'resume', 'loop', 'buffer', 'gain', 'value',
  // localStorage key + HTML data-t attribute
  'm', 't',
  // building/entity type codes: keys of R/COST/BUILD/ENTITIES/COL, but ALSO the runtime
  // string values of BType/EType (R[b.t], ENTITIES[n.k], data-t attrs). The record keys
  // must stay literal so the string-keyed lookups still resolve.
  'S', 'L', 'M', 'T', 'N', 'N2', 'N3', 'E', 'X', '_',
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
    define: { DEV: String(!minify), MINIMAP: 'false', FOG: 'true', DEVTOOLS: String(!minify) },
    write: false,
  });
  const js = res.outputFiles[0].text.trim();
  return readFileSync('src/index.html', 'utf8').replace('__JS__', js);
}
