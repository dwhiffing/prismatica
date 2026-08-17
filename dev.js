import { createServer } from 'http';
import { watch } from 'fs';
import { bundle } from './bundle.js';

const PORT = 3000;
const RELOAD = `<script>new EventSource('/esb').onmessage=()=>location.reload()</script>`;

// Dev-only Leva lighting panel. Defines window.LT BEFORE the game script (so the
// game's `LT ||= {...}` adopts this object), then a Leva panel mutates it live.
// Loaded from CDN — never part of the shipped game bundle.
const LEVA = `
<script>window.LT={dir:[-0.4,1,0.6],amb:0.45,dif:0.55};</script>
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
  import { useControls, folder, Leva } from 'leva';
  const e = React.createElement;
  function Panel() {
    const v = useControls({
      lighting: folder({
        dirX: { value: LT.dir[0], min: -1, max: 1, step: 0.05 },
        dirY: { value: LT.dir[1], min: -1, max: 1, step: 0.05 },
        dirZ: { value: LT.dir[2], min: -1, max: 1, step: 0.05 },
        ambient: { value: LT.amb, min: 0, max: 1, step: 0.01 },
        diffuse: { value: LT.dif, min: 0, max: 1, step: 0.01 },
      })
    });
    // write straight into the object the game reads each frame
    LT.dir = [v.dirX, v.dirY, v.dirZ]; LT.amb = v.ambient; LT.dif = v.diffuse;
    return null;
  }
  createRoot(document.getElementById('leva-root')).render(e(React.Fragment, null, e(Leva, { collapsed: false }), e(Panel)));
</script>`;

let html = '';
let clients = [];

createServer((req, res) => {
  if (req.url === '/esb') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}).listen(PORT, () => console.log(`\n  dev server → http://localhost:${PORT}\n`));

async function build() {
  try {
    const out = await bundle({ minify: false });
    // add reload client after the game script first (while out has only the game
    // <script>), then prepend Leva before it so window.LT exists before the game runs.
    html = out.replace('</script>', '</script>' + RELOAD)
              .replace('<script>', LEVA + '<script>');
    clients.forEach(c => c.write('data: reload\n\n'));
    console.log('  rebuilt', new Date().toISOString().slice(11, 19));
  } catch (e) {
    console.error('  build error:', e.message);
  }
}

let timer;
watch('src', { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(build, 50); // debounce editor multi-writes
});

build();
