// Grid — tiny base-building/defense prototype (dimetric low-poly 3D).
// Entry point: wires input, the reset, and the main loop (sim + render).
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
import { canPlace, near, nearest, rnd, unproject } from './core'
import { computeSun } from './lighting'
import { render } from './render'
import { inMinimap, mmToWorld } from './minimap'
import { miscSounds } from './sounds'
import { C, LT, resize, S, SPAWN, V } from './state'
import { stepSim } from './sim'
import { drawUI } from './ui'
import { playMusic, toggleMute, zzfx, zzfxX } from './zzfx'
import type { BType, Building, EType } from './types'

addEventListener('resize', resize)

// start the looped music on the first user gesture — browsers keep the AudioContext
// suspended until an interaction, so "on load" music must begin here.
let audioOn = false
function startAudio() {
  if (audioOn) return
  audioOn = true
  zzfxX.resume()
  playMusic()
}
addEventListener('pointerdown', startAudio)
addEventListener('keydown', startAudio)

// build a Building record with the shared defaults (energy 0, hp 20, no cooldown)
const mkB = (t: BType, x: number, y: number, bp?: number): Building => ({ t, x, y, e: 0, hp: 20, cd: 0, bp })

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
  S.enemies = []; S.pulses = []; S.parts = []; S.resource = 70; S.t = 0; S.spawnT = 0; S.revealed = []
  SPAWN.x = V.W / 2; SPAWN.y = V.Hh / 2; S.camX = SPAWN.x; S.camY = SPAWN.y
  S.buildings = [mkB('S', SPAWN.x - 35, SPAWN.y), mkB('S', SPAWN.x + 35, SPAWN.y),
    ...[0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3; return mkB('L', SPAWN.x + Math.cos(a) * 22, SPAWN.y + Math.sin(a) * 22) })]
  S.nodes = []
  // spawn RGB color crystals equidistant from spawn; they act as world-fixed color links
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
    const [crystalCol, ek] = ([[4, 'crystalR'], [2, 'crystalG'], [1, 'crystalB']] as [number, EType][])[i]
    S.buildings.push({ ...mkB('L', SPAWN.x + Math.cos(a) * 195, SPAWN.y + Math.sin(a) * 195), crystalCol, ek, hp: 9999 })
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
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return
  downX = mx(e)
  downY = my(e)
  panX = S.camX
  panY = S.camY
  dragging = true
  didDrag = false
  mmDrag = MINIMAP && inMinimap(downX, downY)
  // if the press lands on an existing link/tower, a drag extends a chain of that type
  // (instead of panning) — see onpointerup.
  const dp = unproject(downX, downY)
  chainSrc = S.mode === 'select' ? nearest(dp, (b) => b.t === 'L' || b.t === 'T', 12 * 12) : null
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
  // If the cursor reaches another same-type building, connect to it right now and continue
  // the chain FROM there — no need to release between links.
  if (didDrag && chainSrc) {
    // first frame of the drag: clear the source's existing connection (we're re-routing it)
    if (!S.chainFrom) { if (chainSrc.t === 'T') chainSrc.chain = null; else chainSrc.route = null }
    S.chainFrom = chainSrc
    const w = unproject(mx(e), my(e))
    const tgt = nearest(w, (b) => b !== chainSrc && b.t === chainSrc!.t, 8 * 8)
    if (tgt) {
      if (chainSrc.t === 'T') chainSrc.chain = tgt
      else {
        if (tgt.route === chainSrc) tgt.route = null // can't have opposing links (A->B and B->A)
        chainSrc.route = tgt
      }
      chainSrc = S.chainFrom = tgt // advance the chain to the target
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
  if (e.button) return
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
    S.tool = (['S', 'L', 'M', 'T'] as BType[])[ti]
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
})

// --- main loop ---
let last = performance.now()
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  stepSim(dt)
  // advance time of day, then recompute the sun for this frame
  if (LT.autoDay) LT.dayT = (LT.dayT + dt / LT.dayLen) % 1
  computeSun(LT.dayT)
  render()
  requestAnimationFrame(loop)
}

reset()
drawUI()
requestAnimationFrame(loop)
// dev: let the Leva panel re-run world generation after tweaking resource params
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
  addEventListener('keydown', (e: KeyboardEvent) => {
    // 'e': spawn an enemy at the cursor
    if (e.key === 'e' && S.mouse) {
      const w = unproject(S.mouse.x, S.mouse.y)
      S.enemies.push({ x: w.x, y: w.y, hp: 6, target: null })
    }
  })
}
