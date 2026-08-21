import { createServer } from 'http'
import { watch } from 'fs'
import { bundle } from './bundle.js'

const PORT = 3000
const RELOAD = `<script>new EventSource('/esb').onmessage=()=>location.reload()</script>`

// Dev-only Leva lighting panel. The game's own \`LT ||= {...}\` (src/state.ts) is the
// single source of default values — it creates window.LT when the game script runs
// (which is before this module script executes). We just read/mutate window.LT here,
// so tunable defaults live in ONE place. Loaded from CDN — never in the shipped game.
const LEVA = `
<script type="importmap">{"imports":{
  "react":"https://esm.sh/react@18.2.0",
  "react-dom":"https://esm.sh/react-dom@18.2.0",
  "react-dom/client":"https://esm.sh/react-dom@18.2.0/client",
  "leva":"https://esm.sh/leva@0.9.35?deps=react@18.2.0,react-dom@18.2.0"
}}</script>
<div id="leva-root"></div>
<script type="module">
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { useControls, folder, Leva, button } from 'leva';
  const e = React.createElement;
  const LT = window.LT; // single source of defaults: src/state.ts
  function Panel() {
    const [v, set] = useControls(() => ({
      'time of day': folder({
        auto: { value: LT.autoDay },
        dayLen: { value: LT.dayLen, min: 5, max: 300, step: 1, label: 'day length (s)' },
        time: { value: LT.dayT, min: 0, max: 1, step: 0.001, label: 'time (0=midnight)' },
        noon: button(() => set({ time: 0.5, auto: false })),
        dusk: button(() => set({ time: 0.78, auto: false })),
        night: button(() => set({ time: 0.0, auto: false })),
      }),
      sun: folder({
        lean:   { value: LT.lean,   min: 0, max: 3, step: 0.05, label: 'horiz lean (x)' },
        depth:  { value: LT.depth,  min: 0, max: 3, step: 0.05, label: 'depth (z)' },
        drop:   { value: LT.drop,   min: 0.1, max: 3, step: 0.05, label: 'vert drop' },
        dropUp: { value: LT.dropUp, min: 0, max: 2, step: 0.05, label: 'vert drop @ noon' },
        amb:    { value: LT.amb,    min: 0, max: 1, step: 0.01, label: 'ambient floor' },
        ambDay: { value: LT.ambDay, min: 0, max: 1, step: 0.01, label: 'ambient +day' },
        diff:   { value: LT.diff,   min: 0, max: 4, step: 0.05, label: 'diffuse gain' },
      }, { collapsed: true }),
      shadows: folder({
        shFloor: { value: LT.shFloor, min: 0, max: 1, step: 0.01, label: 'night floor' },
        shLean:  { value: LT.shLean,  min: 0, max: 4, step: 0.05, label: 'horiz spread' },
        shLen:   { value: LT.shLen,   min: 0, max: 6, step: 0.05, label: 'length @ low sun' },
        shAlpha: { value: LT.shAlpha, min: 0, max: 1, step: 0.01, label: 'opacity' },
      }, { collapsed: true }),
      resources: folder({
        patchN:       { value: LT.patchN,       min: 1, max: 300, step: 1, label: 'patch count' },
        patchSpacing: { value: LT.patchSpacing, min: 20, max: 300, step: 5, label: 'ring spacing' },
        patchMin:    { value: LT.patchMin,    min: 1, max: 60,  step: 1, label: 'min per patch' },
        patchMax:    { value: LT.patchMax,    min: 1, max: 60,  step: 1, label: 'max per patch' },
        patchSpread: { value: LT.patchSpread, min: 10, max: 400, step: 5, label: 'spread radius' },
        regenerate:  button(() => window.regen && window.regen()),
      }, { collapsed: true }),
    }));
    // time-of-day (mirror auto dayT back into the slider)
    LT.autoDay = v.auto; LT.dayLen = v.dayLen;
    if (!v.auto) LT.dayT = v.time;               // scrub mode: slider drives the game
    else if (Math.abs(v.time - LT.dayT) > 0.002) set({ time: LT.dayT }); // auto: follow game
    // sun-shape params -> live into the object the game reads each frame
    LT.lean = v.lean; LT.depth = v.depth; LT.drop = v.drop; LT.dropUp = v.dropUp;
    LT.amb = v.amb; LT.ambDay = v.ambDay; LT.diff = v.diff;
    // drop-shadow params
    LT.shFloor = v.shFloor; LT.shLean = v.shLean; LT.shLen = v.shLen; LT.shAlpha = v.shAlpha;
    // resource-generation params (take effect on the next regenerate / reset)
    LT.patchN = v.patchN; LT.patchSpacing = v.patchSpacing; LT.patchMin = v.patchMin; LT.patchMax = v.patchMax; LT.patchSpread = v.patchSpread;
    return null;
  }
  createRoot(document.getElementById('leva-root')).render(e(React.Fragment, null, e(Leva, { collapsed: false }), e(Panel)));
</script>`

let html = ''
let clients = []

createServer((req, res) => {
  if (req.url === '/esb') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('\n')
    clients.push(res)
    req.on('close', () => {
      clients = clients.filter((c) => c !== res)
    })
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(html)
}).listen(PORT, () =>
  console.log(`\n  dev server → http://localhost:${PORT}\n`),
)

async function build() {
  try {
    const out = await bundle({ minify: false })
    // add reload client after the game script first (while out has only the game
    // <script>), then prepend Leva before it so window.LT exists before the game runs.
    html = out
      .replace('</script>', '</script>' + RELOAD)
      .replace('<script>', LEVA + '<script>')
    clients.forEach((c) => c.write('data: reload\n\n'))
    console.log('  rebuilt', new Date().toISOString().slice(11, 19))
  } catch (e) {
    console.error('  build error:', e.message)
  }
}

let timer
watch('src', { recursive: true }, () => {
  clearTimeout(timer)
  timer = setTimeout(build, 50) // debounce editor multi-writes
})

build()
