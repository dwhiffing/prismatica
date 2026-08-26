import { createServer } from 'http'
import { watch } from 'fs'
import { bundle } from './bundle.js'

const PORT = 3000
const RELOAD = `<script>new EventSource('/esb').onmessage=()=>location.reload()</script>`

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
    // add the live-reload client after the game script
    html = out.replace('</script>', '</script>' + RELOAD)
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
