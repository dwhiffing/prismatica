import {
  BUILD,
  COST,
  LINK_RANGE,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_AMT,
  R,
  TOWER_RANGE,
} from './constants'
import { canPlace, near, nearest, rnd, setSeed, unproject } from './core'
import { computeSun } from './lighting'
import { render } from './render'
import { inMinimap, mmToWorld } from './minimap'
import { miscSounds } from './sounds'
import { C, LT, resize, S, SPAWN, V } from './state'
import { devPulse, enterUpgrade, relay, spawnEnemy, spawnParts, stepSim } from './sim'
import { drawUI } from './ui'
import { playMusic, renderMusic, toggleMute, zzfx, zzfxX } from './zzfx'
import type { BType, Building, EType } from './types'

addEventListener('resize', resize)

// render the music buffers right away (pure math, no gesture needed). Playback needs a
// resumed AudioContext, so it starts on the first user gesture — buffers are ready by then.
renderMusic()

// PRISMATICA as stroke paths — one entry per letter, "|"-separated. Each letter is one or more
// comma-separated strokes; each stroke is a run of grid cells (base-15 chars 0-9a-e, cell = x+y*3
// on the 3×5 grid). A link is placed at every cell used; consecutive cells in a stroke are wired
// (route) so energy traces the drawn stroke. This one blob replaces the old FONT+WIRES pair.
const GLYPHS = 'c601576|c601576ae|012,17d,cde|2137bdc|c60428e|c63158e,678|012,17d|012,17d,cde|2139de|c63158e,678'.split('|')
export let titling = true // true while the title is showing (drives pre-start pulse flow)
export let trans = 0
// page-load intro: seconds since load. Held black for the first INTRO_HOLD, then the black
// fades out over the next second (see render). Purely a load-in flourish.
export let intro = 0
export const INTRO_HOLD = 0.5
function titleScreen() {
  LT.dayT = .1
  const cols = GLYPHS.length * 3 - 1
  S.ZOOM = (V.W * .9 / (cols * 2 * 18))
  // place a link at every cell of every stroke (base-15 chars 0-9a-e = grid cell x+y*3), wiring
  // consecutive cells so energy traces the stroke. Cells shared between strokes get a stacked
  // duplicate link — invisible (same spot) and harmless on the title, cheaper than deduping.
  GLYPHS.forEach((glyph, li) => {
    const strokes = glyph.split(',')
    strokes.forEach((stroke, si) => {
      let prev: Building | null = null
      for (const ch of stroke) {
        const b = parseInt(ch, 15), X = (li * 3 + (b % 3) - cols / 2) * 18, Y = (((b / 3) | 0) - 2) * 17
        const dot = mkB('L', SPAWN.x + X + Y, SPAWN.y + Y - X)
        S.buildings.push(dot)
        if (prev) prev.route = dot
        else if (stroke.length > 1 || si === 0) dot.emit = 1
        prev = dot
      }
      if (prev && stroke.length > 1) prev.drain = 1
    })
  })
  setSeed(15)
  for (let i = 0; i < 50; i++) {
    const rad = LT.patchSpacing * i ** 0.5, a = i * GOLDEN
    spawnPatch(SPAWN.x + Math.cos(a) * rad, SPAWN.y + Math.sin(a) * rad)
  }
  // ring hugging the word: 15 miners/lasers spread by EQUAL ARC LENGTH around a tight
  // world-space ellipse (long in X, short in Y). Walk the ellipse in tiny angle steps,
  // dropping a building each time the accumulated arc passes a 1/15-of-perimeter slot.
  let px = 281, py = 0, arc = 0, k = 0
  for (let a = 0; a < 7; a += .01) {
    const X = -9 + Math.cos(a) * 290, Y = Math.sin(a) * 86
    arc += Math.hypot(X - px, Y - py); px = X; py = Y
    if (arc >= 84.7 * k && k < 15) { S.buildings.push({ ...mkB('MT'[k++ % 2] as BType, SPAWN.x + X + Y, SPAWN.y + Y - X), e: 99, mp: rnd() * 1.5 }) }
  }
  setSeed(0)
}

// build a Building record with the shared defaults (energy 0, no cooldown)
const mkB = (t: BType, x: number, y: number, bp?: number): Building => ({ t, x, y, e: 0, cd: 0, bp })

// in build mode with a Link or Tower selected, a click-drag lays a whole line of them
// spaced at that tool's max connect range (see onpointerup).
const lineTool = () => S.mode === 'build' && (S.tool === 'L' || S.tool === 'T')

const VARIANTS: [EType, number][] = [['rockSmall', NODE_AMT * 0.35], ['rockMedium', NODE_AMT * 0.65], ['rockMedium', NODE_AMT * 0.65], ['rockLarge', NODE_AMT]]
// sunflower (phyllotaxis) patch layout: patch i sits at angle i·GOLDEN and radius
// spacing·i^0.7. The i^0.7 makes successive rings spread apart with distance, so clusters
// thin out the further you get from spawn. Golden-angle rotation never self-overlaps, so
// no patch-center dedup / min-gap bookkeeping is needed. World is a fixed LT.patchN patches.
const GOLDEN = 2.399963 // radians (~137.5°)
// outer extent of the generated field — used by the minimap to frame the world.
export const worldRadius = () => LT.patchSpacing * (LT.patchN - 1) ** 0.7 + LT.patchSpread

function spawnPatch(cx: number, cy: number) {
  const r = () => (rnd() - rnd()) * LT.patchSpread
  for (let i = 0; i < LT.patchMin + ((rnd() * (LT.patchMax - LT.patchMin + 1)) | 0); i++) {
    const [k, cap] = VARIANTS[(rnd() * 4) | 0]
    const x = cx + r(), y = cy + r()
    if (S.buildings.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (R[b.t] + R[k]) ** 2)) continue
    if (S.nodes.some((n) => n.amt > 0 && (n.x - x) ** 2 + (n.y - y) ** 2 < (R[n.k] + R[k]) ** 2)) continue
    S.nodes.push({ x, y, amt: cap, cap, k, ds: 1, ry: (rnd() - 0.5) * 1.5 })
  }
}

function reset() {
  S.enemies = []; S.pulses = []; S.parts = []; S.shots = []; S.emits = []; S.resource = 70; S.t = 0; S.spawnT = 0; S.revealed = []
  SPAWN.x = V.W / 2; SPAWN.y = V.Hh / 2; S.camX = SPAWN.x; S.camY = SPAWN.y
  LT.dayT = .35; 
  S.buildings = [mkB('S', SPAWN.x - 35, SPAWN.y), mkB('S', SPAWN.x + 35, SPAWN.y),
    ...[0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3; return mkB('L', SPAWN.x + Math.cos(a) * 22, SPAWN.y + Math.sin(a) * 22) })]
  S.nodes = []
  // spawn RGB color crystals equidistant from spawn; they act as world-fixed color links
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
    const crystalCol = [4, 2, 1][i], ek = (['crystalR', 'crystalG', 'crystalB'] as EType[])[i]
    S.buildings.push({ ...mkB('L', SPAWN.x + Math.cos(a) * 195, SPAWN.y + Math.sin(a) * 195), crystalCol, ek })
  }
  // lay the sunflower: patch 0 at spawn, each next one rotated by GOLDEN and pushed out
  // by spacing·i^0.7 (rings spread with distance → clusters thin out further from spawn).
  for (let i = 0; i < LT.patchN; i++) {
    const rad = LT.patchSpacing * i ** 0.7, a = i * GOLDEN
    spawnPatch(SPAWN.x + Math.cos(a) * rad, SPAWN.y + Math.sin(a) * rad)
  }
}

// --- input: scroll to zoom, drag to pan, click to select/place ---
// canvas backing store matches CSS pixels 1:1, so client coords are already in
// backing-store space.
const mx = (e: { clientX: number }) => e.clientX
const my = (e: { clientY: number }) => e.clientY

// scroll wheel zooms toward the cursor: zoom about the world point under the pointer so
// it stays fixed on screen (clamped to MIN_ZOOM..MAX_ZOOM).
C.onwheel = (e: WheelEvent) => {
  e.preventDefault()
  if (titling) return
  const before = unproject(mx(e), my(e))
  S.ZOOM = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, S.ZOOM * (e.deltaY < 0 ? 1.02 : 1 / 1.02)))
  const after = unproject(mx(e), my(e))
  S.camX += before.x - after.x // keep the world point under the cursor fixed
  S.camY += before.y - after.y
}

let downX = 0,
  downY = 0,
  panX = 0,
  panY = 0,
  dragging = false,
  didDrag = false,
  mmDrag = false
let chainSrc: Building | null = null // link/tower the current drag started on (drag-to-chain)
let lastBuilt: { x: number; y: number } | null = null // last spot a drag-line building was placed
// place one building of the current tool if affordable and not blocked; true if placed
const tryBuild = (x: number, y: number) => {
  if (S.resource < COST[S.tool] || !canPlace(S.tool, x, y)) return false
  S.resource -= COST[S.tool]
  S.buildings.push(mkB(S.tool, x, y, BUILD[S.tool]))
  drawUI()
  return true
}
let audioOn = 0 // set after the first user gesture (needed to start music)
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return

  // first user gesture: unlock + start the music. On the title this is a click all its own
  // (return so nothing else happens — the NEXT title click starts the transition). In-game
  // (SKIPTITLE), fall through so this same click still builds/selects/pans as normal —
  // otherwise the first press per load would be silently swallowed.
  if (!audioOn) { audioOn = 1; zzfxX.resume(); playMusic(); if (titling) return }
  // while on the title, clicks never select/build/pan — they only kick off the start
  // transition (once).
  if (titling) { if (!trans) trans = 0.0001; return }
  downX = mx(e)
  downY = my(e)
  panX = S.camX
  panY = S.camY
  dragging = true
  didDrag = false
  mmDrag = MINIMAP && inMinimap(downX, downY)
  // if the press lands on an existing link, a drag re-routes it toward another link
  // (instead of panning) — see onpointerup.
  const dp = unproject(downX, downY)
  chainSrc = S.mode === 'select' ? nearest(dp, (b) => b.t === 'L', 12 * 12) : null
  // build-mode L/T: drop the first building of the line here; onpointermove adds more,
  // one per max-range step, as the cursor moves away.
  lastBuilt = null
  if (lineTool() && tryBuild(dp.x, dp.y)) lastBuilt = dp
  if (mmDrag) {
    const w = mmToWorld(downX, downY)
    S.camX = w.x
    S.camY = w.y
    panX = S.camX
    panY = S.camY
  }
  C.setPointerCapture(e.pointerId)
}
C.onpointermove = (e: PointerEvent) => {
  S.mouse = { x: mx(e), y: my(e) }
  if (!dragging) return
  if (mmDrag) {
    const w = mmToWorld(mx(e), my(e))
    S.camX = w.x
    S.camY = w.y
    return
  }
  const dx = mx(e) - downX,
    dy = my(e) - downY
  if (!didDrag && dx * dx + dy * dy > 25) didDrag = true
  // build-mode L/T drag: place a new building every time the cursor gets a full max-range
  // step past the last one placed (loop in case it jumped several steps in one frame).
  if (didDrag && lineTool()) {
    const w = unproject(mx(e), my(e))
    // spacing: just under max connect range so neighbours reliably link
    const step = (S.tool === 'T' ? TOWER_RANGE : LINK_RANGE) * 0.9
    while (lastBuilt) {
      const ex = w.x - lastBuilt.x, ey = w.y - lastBuilt.y, d = Math.hypot(ex, ey)
      if (d < step) break
      const nx = lastBuilt.x + (ex / d) * step, ny = lastBuilt.y + (ey / d) * step
      // a failed placement (unaffordable or blocked) ends the whole drag-chain here
      if (!tryBuild(nx, ny)) { lastBuilt = null; dragging = false; break }
      lastBuilt = { x: nx, y: ny }
    }
    return
  }
  // once an on-a-link drag is moving, expose its source so render draws a preview line.
  // If the cursor reaches another link, route to it right now and continue FROM there —
  // no need to release between links.
  if (didDrag && chainSrc) {
    // first frame of the drag: clear the source's existing connection (we're re-routing it)
    if (!S.chainFrom) chainSrc.route = null
    S.chainFrom = chainSrc
    const w = unproject(mx(e), my(e))
    const tgt = nearest(w, (b) => b !== chainSrc && b.t === 'L', 8 * 8)
    if (tgt) {
      if (tgt.route === chainSrc) tgt.route = null // can't have opposing links (A->B and B->A)
      chainSrc.route = tgt
      chainSrc = S.chainFrom = tgt // advance the routing chain to the target
      S.sel = tgt
    }
  }
  // a drag that lays a line (build-mode L/T tool) or extends a chain (started on an
  // existing L/T) does NOT pan the camera — every other drag pans as before.
  if (didDrag && !lineTool() && !chainSrc) {
    const dXmZ = dx / S.ZOOM,
      dXpZ = dy / (0.5 * S.ZOOM)
    S.camX = panX - (dXpZ + dXmZ) / 2
    S.camY = panY - (dXpZ - dXmZ) / 2
  }
}
C.onpointerup = (e: PointerEvent) => {
  if (e.button || titling) return // no select/build on release while the title is up
  dragging = false
  mmDrag = false
  S.chainFrom = null // end any preview line
  C.releasePointerCapture?.(e.pointerId)
  const p = unproject(mx(e), my(e))
  // any drag (pan, chain-connect, or build-line) did its work live in onpointermove —
  // nothing to place on release. Only a non-drag click reaches the build/select logic.
  if (didDrag) return
  // L/T tools already placed their (single) building on pointerdown — see there.
  if (lineTool()) { if (!e.shiftKey) S.mode = 'select'; return }
  zzfx(...miscSounds[0])
  if (S.mode === 'build') {
    if (S.resource < COST[S.tool]) return
    if (!canPlace(S.tool, p.x, p.y)) return // blocked: would overlap another building/node
    S.resource -= COST[S.tool]
    S.buildings.push(mkB(S.tool, p.x, p.y, BUILD[S.tool]))
    if (!e.shiftKey) S.mode = 'select' // hold shift to keep placing
    drawUI()
  } else {
    const hit = nearest(p, () => true, 12 * 12)
    // clicking an ALREADY-SELECTED building acts on it:
    if (hit && hit === S.sel) {
      // under construction -> RUSH it: reroute every in-range link to feed it (sim clears
      // these when it completes).
      if (hit.bp != null) {
        hit.rush = true
        for (const b of S.buildings)
          if (b.t === 'L' && b !== hit && near(b, hit, LINK_RANGE)) b.route = hit
      // a finished link -> cycle its color filter: yellow(any) -> R -> G -> B -> yellow
      } else if (hit.t === 'L' && !hit.crystalCol) {
        hit.filt = [4, 0, 1, , 2][hit.filt || 0] // cycle any(0)->R(4)->G(2)->B(1)->any
      }
    }
    S.sel = hit
  }
}
C.onpointerleave = () => {
  S.mouse = null
}
// right-click: cancel build mode / deselect
C.oncontextmenu = (e: MouseEvent) => {
  e.preventDefault()
  S.mode = 'select'
  S.sel = null
  drawUI()
}

addEventListener('keydown', (e: KeyboardEvent) => {
  // 1-4 pick a build tool (S/L/M/T) and enter build mode
  const ti = '1234'.indexOf(e.key)
  if (ti >= 0) {
    S.tool = 'SLMT'[ti] as BType
    S.mode = 'build'
    S.sel = null // deselect any building when starting a build
    drawUI()
    return
  }
  // 'm': cycle the mute state (muted / music only / all sound)
  if (e.key === 'm') {
    toggleMute()
    return
  }
  // 'd': sell the selected building, refunding half its build cost
  if (e.key === 'd' && S.sel) {
    S.resource += COST[S.sel.t] / 2
    S.buildings = S.buildings.filter((b) => b !== S.sel)
    S.sel = null
    drawUI()
  }
  // 'f': put the selected tower into UPGRADE MODE. It stops firing and waits for 3 colored
  // orbs (weapon/element/bonus). If it was already upgraded, this releases its stored energy
  // and clears its config so it can be re-specced.
  if (e.key === 'f' && S.sel && S.sel.t === 'T' && S.sel.bp == null) {
    if (S.sel.e > 0) spawnParts(S.sel.x, S.sel.y, 8, 60, '255,238,140') // release stored (uncolored) charge
    enterUpgrade(S.sel) // releases held colored orbs, then puts it in upgrade mode
    drawUI()
  }
})

// --- main loop ---
let last = performance.now()
let relayT = 0, enemyT = 0 // title interval timers: energy spray + enemy spawn
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  intro += dt // page-load fade-in timer (render draws black for INTRO_HOLD then fades it out)
  stepSim(dt)
  LT.dayT = (LT.dayT + dt / LT.dayLen) % 1

  // interval-based (not random): spray energy through the letters every 0.25s, spawn a
  // drifting enemy for the towers every 0.8s.
  if (titling) {
    if ((relayT -= dt) <= 0) { relayT = .1; S.buildings.forEach((b) => b.emit && relay(b, 0)) }
    if ((enemyT -= dt) <= 0) { enemyT = .8; spawnEnemy() }
  }
  // start transition: advance trans (1s per phase). Cross 1 → swap title out for the game
  // under the full-black cover; render draws the fade from `trans` (see render).
  if (trans > 0 && trans < 2) {
    const was = trans < 1
    trans = Math.min(2, trans + dt / 1.3) // ~1.3s cover (0→1) + ~1.3s reveal (1→2)
    // cross into black: swap the title for the freshly-reset game (dayT back to morning)
    if (was && trans >= 1) { titling = false; reset(); }
  }
  computeSun(LT.dayT)
  render()
  requestAnimationFrame(loop)
}

// SKIPTITLE (injected by bundle.js): true in dev to boot straight into the game, skipping the
// title/menu. Injected as a literal so the dead branch folds away entirely in release.
declare const SKIPTITLE: boolean
if (SKIPTITLE) { titling = false; LT.dayT = .35; reset(); drawUI() }
else titleScreen()
requestAnimationFrame(loop)
// dev: expose reset() on window as regen() to re-run world generation from the console
// (DEV is defined false in the release build, so this is stripped by minification)
declare const DEV: boolean
declare const MINIMAP: boolean // injected by bundle.js; false => threat arrows, minimap DCE'd
if (DEV) (globalThis as any).regen = reset

// ---- dev tools (DEVTOOLS injected by bundle.js) --------------------------------------
// A single flag-gated block for in-editor debugging shortcuts. When DEVTOOLS is false the
// literal folds the branch away and the whole block is dead-code-eliminated from the build,
// so nothing here ships. Add more dev shortcuts inside this handler.
declare const DEVTOOLS: boolean
if (DEVTOOLS) {
  addEventListener('keydown', (ev: KeyboardEvent) => {
    if (!S.mouse) return
    const w = unproject(S.mouse.x, S.mouse.y)
    // 'x': spawn an enemy at the cursor
    if (ev.key === 'x') S.enemies.push({ x: w.x, y: w.y, hp: 10, hp0: 10 })
    // 'q w e r t y u': fire a red/green/blue/cyan/yellow/magenta/white energy pulse at the
    // cursor. It flies to the nearest thing in range that accepts the color, else fizzles.
    const ki = 'qwertyu'.indexOf(ev.key)
    if (ki >= 0) devPulse(w.x, w.y, [4, 2, 1, 3, 6, 5, 7][ki])
  })
}
