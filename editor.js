// Static server for the model editor. Serves the repo root with no-cache
// headers so the editor always fetches the freshest src/models.ts, and accepts
// POST /save to write src/models.ts back to disk (powers the editor's cmd+s).
import { createServer } from 'http'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { extname, join, normalize } from 'path'

const PORT = 4200
const ROOT = process.cwd()
const MODELS = join(ROOT, 'src/models.ts')
const TYPES = { '.html': 'text/html', '.ts': 'text/plain', '.js': 'text/javascript', '.json': 'application/json' }

createServer((req, res) => {
  // save endpoint: body is the full models.ts contents
  if (req.method === 'POST' && req.url === '/save') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        writeFileSync(MODELS, body)
        console.log('  saved src/models.ts (' + body.length + ' bytes)')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    })
    return
  }
  const rel = decodeURIComponent((req.url || '/').split('?')[0])
  let path = normalize(join(ROOT, rel))
  if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden') }
  try {
    if (statSync(path).isDirectory()) path = join(path, 'tools/model-editor.html')
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    })
    res.end(readFileSync(path))
  } catch {
    res.writeHead(404); res.end('not found')
  }
}).listen(PORT, () =>
  console.log(`\n  model editor → http://localhost:${PORT}/tools/model-editor.html\n  (serves repo root; always reads the latest src/models.ts)\n`),
)
