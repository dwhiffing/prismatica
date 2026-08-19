// Grid — tiny base-building/defense prototype (dimetric low-poly 3D).
// Entry point: wires input, the reset, and the main loop (sim + render).
import {
  BUILD,
  COST,
  LINK_RANGE,
  NODE_AMT,
  R,
  RES,
  TOWER_RANGE,
} from './constants'
import { canPlace, near, nearest, rnd, unproject } from './core'
import { computeSun } from './lighting'
import { render } from './render'
import { clickSound } from './sounds'
import { C, LT, resize, S, SPAWN, V } from './state'
import { stepSim } from './sim'
import { drawUI } from './ui'
import { playMusic, toggleMute, zzfx, zzfxX } from './zzfx'
import type { BType, Building, EType, Pt } from './types'

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

function reset() {
  S.enemies = []
  S.pulses = []
  S.resource = 70 // START — enough for a couple of miners
  S.t = 0
  S.spawnT = 0
  SPAWN.x = V.W / 2
  SPAWN.y = V.Hh / 2
  S.camX = V.W / 2
  S.camY = V.Hh / 2
  // start with two solar generators flanking the origin, plus 3 links arranged in an
  // equilateral triangle centered on the origin. circumradius 22 -> side ~38 < LINK_RANGE
  // (40), so every link is in range of the others and of the flanking solars.
  const TR = 22 // triangle circumradius
  S.buildings = [
    mkB('S', SPAWN.x - 35, SPAWN.y),
    mkB('S', SPAWN.x + 35, SPAWN.y),
    ...[0, 1, 2].map((i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3 // first vertex points up
      return mkB('L', SPAWN.x + Math.cos(a) * TR, SPAWN.y + Math.sin(a) * TR)
    }),
  ]
  // resource crystals grow in PATCHES: a few cluster centers, each seeded with several
  // crystals scattered around it (like ore veins). Each crystal is one of 3 variants
  // (small/medium/large model) with a matching resource count. Weighted 25/50/25 by
  // listing medium twice, so medium crystals are most common.
  const VARIANTS: [EType, number][] = [
    ['N3', NODE_AMT * 0.35],
    ['N2', NODE_AMT * 0.65],
    ['N2', NODE_AMT * 0.65],
    ['N', NODE_AMT],
  ]
  S.nodes = []
  // patch #0 is guaranteed near spawn (within 60) so the player always starts by a vein;
  // the rest keep patchGap from every existing center (spawn seeds the list).
  const centers: Pt[] = [{ x: SPAWN.x, y: SPAWN.y }]
  for (let p = 0; p < LT.patches; p++) {
    let cx = 0,
      cy = 0
    if (p === 0) {
      const a = rnd() * Math.PI * 2 // guaranteed patch: a random point within 60 of spawn
      const d = 160 + rnd() * 30
      cx = SPAWN.x + Math.cos(a) * d
      cy = SPAWN.y + Math.sin(a) * d
    } else {
      // pick a center at least patchGap from every existing one; bounded retries so an
      // over-large gap just degrades gracefully instead of looping forever
      for (let tries = 0; tries < 30; tries++) {
        cx = 120 + rnd() * (V.W - 240)
        cy = 120 + rnd() * (V.Hh - 240)
        if (
          centers.every(
            (c) => (c.x - cx) ** 2 + (c.y - cy) ** 2 >= LT.patchGap ** 2,
          )
        )
          break
      }
    }
    centers.push({ x: cx, y: cy })
    const count = LT.patchMin + ((rnd() * (LT.patchMax - LT.patchMin + 1)) | 0)
    for (let i = 0; i < count; i++) {
      const [k, cap] = VARIANTS[(rnd() * 4) | 0] // pick a size variant (medium weighted 2x)
      const x = cx + (rnd() - rnd()) * LT.patchSpread, // cluster around the patch center
        y = cy + (rnd() - rnd()) * LT.patchSpread
      // skip crystals that would overlap a starting building (radius sum)
      if (
        S.buildings.some(
          (b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (R[b.t] + R[k]) ** 2,
        )
      )
        continue
      S.nodes.push({ x, y, amt: cap, cap, k, ds: 1 })
    }
  }
}

// --- input: scroll to zoom, drag to pan, click to select/place ---
// pointer events report CSS pixels, but the canvas backing store is scaled by RES, so
// convert client coords into backing-store space before projecting/using them.
const mx = (e: { clientX: number }) => e.clientX * RES
const my = (e: { clientY: number }) => e.clientY * RES
// C.onwheel = (e: WheelEvent) => {
//   e.preventDefault()
//   const before = unproject(mx(e), my(e))
//   S.ZOOM = Math.min(, Math.max(1, S.ZOOM * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
//   const after = unproject(mx(e), my(e))
//   S.camX += before.x - after.x // keep the world point under the cursor fixed
//   S.camY += before.y - after.y
// }

let downX = 0,
  downY = 0,
  panX = 0,
  panY = 0,
  dragging = false,
  didDrag = false
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return // non-primary buttons handled elsewhere
  downX = mx(e)
  downY = my(e)
  panX = S.camX
  panY = S.camY
  dragging = true
  didDrag = false
  C.setPointerCapture(e.pointerId)
}
C.onpointermove = (e: PointerEvent) => {
  S.mouse = { x: mx(e), y: my(e) }
  if (!dragging) return
  const dx = mx(e) - downX,
    dy = my(e) - downY
  if (!didDrag && dx * dx + dy * dy > 25 * RES * RES) didDrag = true // ~5 CSS px threshold
  if (didDrag) {
    // map screen delta since press to a world-space camera shift (ISO baked in)
    const dXmZ = dx / S.ZOOM,
      dXpZ = dy / (0.5 * S.ZOOM) // ISO = 0.5
    S.camX = panX - (dXpZ + dXmZ) / 2
    S.camY = panY - (dXpZ - dXmZ) / 2
  }
}
C.onpointerup = (e: PointerEvent) => {
  if (e.button) return
  dragging = false
  C.releasePointerCapture?.(e.pointerId)
  if (didDrag) return // it was a pan, not a click
  zzfx(...clickSound)
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
    // select nearest building within pick radius; else nearest crystal node
    S.sel = nearest(p, () => true, 12 * 12)
    S.selN = null
    if (!S.sel) {
      let bd = 26 * 26
      for (const n of S.nodes)
        if (n.amt > 0) {
          const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2
          if (d < bd) {
            bd = d
            S.selN = n
          }
        }
    }
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
  S.selN = null
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
    S.sel = S.selN = null // deselect any building/node when starting a build
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
if (DEV) (globalThis as any).regen = reset
