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
    S.buildings.push({ ...mkB('L', SPAWN.x + Math.cos(a) * 65, SPAWN.y + Math.sin(a) * 65), crystalCol, ek, hp: 9999 })
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
  S.ZOOM = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, S.ZOOM * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
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
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return
  downX = mx(e)
  downY = my(e)
  panX = S.camX
  panY = S.camY
  dragging = true
  didDrag = false
  mmDrag = MINIMAP && inMinimap(downX, downY)
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
  if (didDrag) {
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
  C.releasePointerCapture?.(e.pointerId)
  if (didDrag) return
  zzfx(...miscSounds[0])
  const p = unproject(mx(e), my(e))
  if (S.mode === 'build') {
    if (S.resource < COST[S.tool]) return
    if (!canPlace(S.tool, p.x, p.y)) return // blocked: would overlap another building/node
    S.resource -= COST[S.tool]
    S.buildings.push(mkB(S.tool, p.x, p.y, BUILD[S.tool]))
    if (!e.shiftKey) S.mode = 'select' // hold shift to keep placing
    drawUI()
  } else if (S.linking && S.sel) {
    // linking armed. For an energy building (S/L): click an in-range LINK to set its
    // relay route. For a tower (T): click an in-range TOWER to set its laser chain.
    // Either way, select the target and stay armed so you can chain further.
    const src = S.sel
    const isT = src.t === 'T'
    const tgt = nearest(
      p,
      (b) =>
        b !== src &&
        b.t === (isT ? 'T' : 'L') &&
        near(src, b, isT ? TOWER_RANGE : LINK_RANGE),
      24 * 24,
    )
    if (tgt) {
      if (isT) src.chain = tgt
      else src.route = tgt
      S.sel = tgt // select the new target; keep S.linking armed to chain
    }
  } else {
    // select nearest building within pick radius
    S.sel = nearest(p, () => true, 12 * 12)
  }
}
C.onpointerleave = () => {
  S.mouse = null
}
// right-click: cancel linking mode first, else cancel build mode / deselect
C.oncontextmenu = (e: MouseEvent) => {
  e.preventDefault()
  if (S.linking) {
    S.linking = false // cancel arming without changing the current route
    return
  }
  S.mode = 'select'
  S.sel = null
  drawUI()
}

// 'z': for a selected solar/link toggle its relay route; for a tower toggle its laser
// chain. If it already has a target, clear it; else arm linking mode for the next click.
addEventListener('keydown', (e: KeyboardEvent) => {
  // 1-4 pick a build tool (S/L/M/T) and enter build mode
  const ti = '1234'.indexOf(e.key)
  if (ti >= 0) {
    S.tool = (['S', 'L', 'M', 'T'] as BType[])[ti]
    S.mode = 'build'
    S.sel = null // deselect any building when starting a build
    S.linking = false
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
    S.linking = false
    drawUI()
    return
  }
  if (e.key !== 'z') return
  const s = S.sel
  if (!s || (s.t !== 'S' && s.t !== 'L' && s.t !== 'T')) return
  const linked = s.t === 'T' ? s.chain : s.route
  if (linked) {
    if (s.t === 'T') s.chain = null
    else s.route = null // unset existing target
  } else S.linking = !S.linking // toggle arming
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
