// Rendering: 3D face projection, shadows, ground, and the top-level render().
import {
  BUILD,
  CHARGE,
  COST,
  LINK_MAX,
  LINK_RANGE,
  LOD_ZOOM,
  MINE_ON,
  MINE_RANGE,
  R,
  REVEAL,
  SHIELDER_RANGE,
  TOWER_RANGE,
} from './constants'
import { canPlace, depth, iso, unproject } from './core'
import type { BType } from './types'
import { GTS, makeGround } from './ground'
import { hull, meshOf, norm, rotate } from './geometry'
import { shade } from './lighting'
import { drawMinimap } from './minimap'
import { drawThreat } from './threat'
// off-screen awareness toggle, injected by bundle.js (esbuild `define`). true = corner
// minimap, false = edge threat arrows. As a literal, the dead branch + module DCE out.
declare const MINIMAP: boolean
// fog-of-war toggle, injected by bundle.js. As a literal, the whole fog pass DCEs when off.
declare const FOG: boolean
import { ENTITIES, type Entity } from './models'
import { LT, S, SUN, V, X } from './state'
import { canFireE, wepRng } from './sim'
import { intro, INTRO_HOLD, isMenu, trans } from './game'
import type { Enemy, Face, V3 } from './types'

// upgrade-orb color by color-index 0..6: green, red, blue, yellow, cyan, magenta, white.
// PIPCOL = hex (pips + body tint); PIPRGB = "r,g,b" (for glow, which wants an rgb string).
const PIPCOL = ['#4f6', '#f44', '#48f', '#ee4', '#4ff', '#f4f', '#fff']
const PIPRGB = ['68,255,102', '255,68,68', '68,136,255', '238,238,68', '68,255,255', '255,68,255', '255,255,255']
// enemy draw scale by kind: boss huge, summoner/shielder bigger, fast small, else normal.
const ESCALE = [.8, .8, 1.4, .6, 1.3, 1.5]
const escale = (e: Enemy) => ESCALE[e.k || 0]
// enemy MODEL by kind: normal(0) & shielded(1) share 'E'; shielder/fast/summoner/boss get their
// own E2..E4. (All are clones of E for now — differentiate the model data in models.ts.)
const EMODEL = ['E', 'E', 'E2', 'E3', 'E4', 'E'] as const
const emodel = (e: Enemy) => ENTITIES[EMODEL[e.k || 0]]
// tint an enemy's whole body. A live shield wins (bright cyan), else the active bonus affliction:
// slowed (steel-blue) or damage-over-time (magenta); none = base color.
const enemyTint = (e: Enemy) =>
  e.sh! > 0 ? '#4ff'
    : e.slowT! > 0 ? '#34abeb' : e.dotT! > 0 ? PIPCOL[5] : undefined
// strength (0..1) of an enemy's body tint. Shield tint fades with remaining shield HP —
// 25% floor as soon as sh>0, up to full at max shield — so a nearly-broken shield reads faint.
const enemyTintA = (e: Enemy) => e.sh! > 0 ? .25 + .75 * e.sh! / e.sh0! : 1
// parse #rgb OR #rrggbb to a packed 0xrrggbb int (short form's nibbles doubled).
const hexN = (h: string) => h.length === 4
  ? parseInt(h[1] + h[1] + h[2] + h[2] + h[3] + h[3], 16)
  : parseInt(h.slice(1), 16)
// blend override `o` toward base `b` by strength t (t=1 => full override) as #rrggbb, which
// shade()/tint() re-parse. Handles both hex lengths (the shield tint is #rgb, but enemy base
// colors can be #rrggbb).
const mixHex = (o: string, b: string, t: number): string => {
  const A = hexN(o), B = hexN(b)
  const c = (s: number) => Math.round((B >> s & 255) + ((A >> s & 255) - (B >> s & 255)) * t)
  return '#' + (1 << 24 | c(16) << 16 | c(8) << 8 | c(0)).toString(16).slice(1) // toString(16) reserved
}

function tp(pts: [number, number][]) { pts.forEach(([x, y], i) => i ? X.lineTo(x, y) : X.moveTo(x, y)) }
function xv([x, y, z]: V3, sp: { scl: number; rot: V3 }) { return rotate([x * sp.scl, y * sp.scl, z * sp.scl], sp.rot) }
function beam(ax: number, ay: number, bx: number, by: number) { X.beginPath(); X.moveTo(ax, ay); X.lineTo(bx, by); X.stroke() }

function entityFaces(
  ent: Entity,
  gx: number,
  gz: number,
  s: number,
  out: Face[],
  override?: string | (string | undefined)[], // tint EVERY spline this color, OR an array to tint
  // each spline by index (per-spline tint, e.g. a tower's weapon/elem colors on splines 0/1)
  swapGreen?: string, // recolor only the miner's green (#4f8) spline (starved indicator)
  yaw = 0, // whole-model rotation about Y (random per crystal so they don't all face alike)
  ta = 1, // override strength 0..1: <1 blends the override toward each spline's own color
) {
  const yc = Math.cos(yaw), ys = Math.sin(yaw)
  ent.splines.forEach((sp, si) => {
    const m = meshOf(sp.geo)
    const ov = Array.isArray(override) ? override[si] : override // per-spline color, or one for all
    const col = ov
      ? (ta < 1 ? mixHex(ov, sp.mat.col, ta) : ov)
      : (swapGreen && sp.mat.col === '#4f8' ? swapGreen : sp.mat.col)
    for (const f of m.faces) {
      const wv: V3[] = f.map((i) => {
        const lv = xv(m.verts[i], sp)
        // local model-space point, then yaw it about Y before scale/translate to ground
        const lx = lv[0] + sp.off[0], lz = lv[2] + sp.off[2]
        // entity scale s, drop onto ground; clamp y>=0 so sub-surface geometry is cut off
        return [
          gx + (lx * yc - lz * ys) * s,
          Math.max(0, (lv[1] + sp.off[1]) * s),
          gz + (lx * ys + lz * yc) * s,
        ] as V3
      })
      const ax = wv[1][0] - wv[0][0],
        ay = wv[1][1] - wv[0][1],
        az = wv[1][2] - wv[0][2]
      const bx = wv[2][0] - wv[0][0],
        by = wv[2][1] - wv[0][1],
        bz = wv[2][2] - wv[0][2]
      const n = norm([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx])
      let cx = 0,
        cy = 0,
        cz = 0
      for (const v of wv) {
        cx += v[0]
        cy += v[1]
        cz += v[2]
      }
      cx /= wv.length
      cy /= wv.length
      cz /= wv.length
      out.push({
        v: wv,
        c: shade(col, n, sp.mat.amb, sp.mat.dif),
        d: depth(cx, cy, cz),
        a: sp.mat.a,
      })
    }
  })
}

function fillFace(f: Face) {
  X.fillStyle = f.c
  X.globalAlpha = f.a! // 1 for opaque materials, <1 for translucent (crystals)
  X.beginPath()
  tp(f.v.map(v => iso(v[0], v[1], v[2])))
  X.fill()
}

// ground-plane ring (range indicator) as a projected ellipse.
function groundRing(
  gx: number,
  gy: number,
  r: number,
  c: string,
  alpha = 0.1,
  lw = 1,
) {
  X.strokeStyle = c
  X.globalAlpha = alpha
  X.lineWidth = lw
  X.beginPath()
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const [sx, sy] = iso(gx + Math.cos(a) * r, 0, gy + Math.sin(a) * r)
    i ? X.lineTo(sx, sy) : X.moveTo(sx, sy)
  }
  X.stroke()
  X.globalAlpha = 1
  X.lineWidth = 1
}

// construction ring: `n` even chunks laid on the GROUND plane (projected through iso,
// so the far/top edge foreshortens correctly). chunk boundaries divide the ground-plane
// angle evenly. first `done` chunks light green, the rest dark green.
function chunkRing(gx: number, gy: number, r: number, n: number, done: number, col = '#7fb', empty = '#161') {
  const slot = (Math.PI * 2) / n
  const gap = Math.min(slot * 0.4, 0.15) // constant angular gap between chunks
  const seg = Math.max(2, Math.ceil((slot - gap) / 0.25)) // enough segments to stay smooth
  X.lineWidth = 4
  for (let k = 0; k < n; k++) {
    X.strokeStyle = k < done ? col : empty
    X.beginPath()
    const a0 = k * slot + gap / 2 - Math.PI / 2
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (slot - gap)
      const [sx, sy] = iso(gx + Math.cos(a) * r, 0, gy + Math.sin(a) * r)
      i ? X.lineTo(sx, sy) : X.moveTo(sx, sy)
    }
    X.stroke()
  }
  X.lineWidth = 1
}

// draw a building's range rings: a shared yellow link ring for every energy building, plus
// a green mine ring (miners) or red shoot ring (towers). `rng` scales the tower ring by the
// selected weapon's range multiplier so the ring updates when the weapon changes.
function drawRanges(t: BType, gx: number, gy: number, alpha = 0.5, rng = 1) {
  groundRing(gx, gy, LINK_RANGE, '#fd4', alpha, 2) // yellow: energy link range (all)
  if (t === 'M') groundRing(gx, gy, MINE_RANGE, '#4f6', alpha, 2) // green: mine range
  if (t === 'T') groundRing(gx, gy, TOWER_RANGE * rng, '#f66', alpha, 2) // red: shoot range
}

// project an entity's vertices onto the ground along the light, then hull them
// into the outer silhouette. Recomputed each frame so the shadow moves smoothly.
function shadowPoints(ent: Entity, L: V3): [number, number][] {
  const pts: [number, number][] = []
  for (const sp of ent.splines) {
    const m = meshOf(sp.geo)
    for (const v of m.verts) {
      const lv = xv(v, sp)
      const wy = lv[1] + sp.off[1]
      const t = -wy / L[1]
      pts.push([lv[0] + sp.off[0] + L[0] * t, lv[2] + sp.off[2] + L[2] * t])
    }
  }
  return hull(pts)
}

// add one entity's drop-shadow silhouette (convex hull projected along the light) as a
// sub-path to the CURRENT path — no fill. All shadows are collected into a single path
// and filled once (see render) so overlaps merge flat instead of stacking darker.
function addShadow(ent: Entity, gx: number, gz: number, s: number) {
  const su = Math.max(0.73, SUN.up) // floor (0.73) so night keeps a short cast shadow
  const a = (LT.dayT - 0.25) * Math.PI * 2
  const L = norm([
    -Math.cos(a) * 1.5 * su, // shLean 1.5
    -(0.5 + 1.5 * (1 - su)), // shLen 1.5
    0.7 * su,
  ])
  const pts = shadowPoints(ent, L)
  if (pts.length < 3) return
  tp(pts.map(p => iso(gx + p[0] * s, 0, gz + p[1] * s)))
}

// outline an entity's on-screen silhouette. By default all splines merge into ONE convex hull.
// With perSpline, each spline is hulled separately (its distinct pieces show) — used for towers.
function entityOutline(ent: Entity, gx: number, gz: number, s: number, col: string, lw = 2, alpha = 1, perSpline = false, yaw = 0) {
  const yc = Math.cos(yaw), ys = Math.sin(yaw)
  const proj = (sp: typeof ent.splines[0]) => meshOf(sp.geo).verts.map((v): [number, number] => {
    const lv = xv(v, sp)
    const lx = lv[0] + sp.off[0], lz = lv[2] + sp.off[2] // yaw about Y, matching entityFaces()
    return iso(gx + (lx * yc - lz * ys) * s, Math.max(0, (lv[1] + sp.off[1]) * s), gz + (lx * ys + lz * yc) * s)
  })
  X.strokeStyle = col
  X.globalAlpha = alpha
  X.lineWidth = lw
  X.lineJoin = 'round'
  X.beginPath()
  if (perSpline) {
    for (const sp of ent.splines) { const h = hull(proj(sp)); if (h.length >= 3) { tp(h); X.closePath() } }
  } else {
    const h = hull(ent.splines.flatMap(proj)); if (h.length >= 3) { tp(h); X.closePath() }
  }
  X.stroke()
  X.lineWidth = 1
  X.globalAlpha = 1
}

// project a ground point to screen at a given up-height (for lasers/pulses/labels)
function g(gx: number, gy: number, yUp = 0): [number, number] {
  return iso(gx, yUp, gy)
}

// viewport cull: is a ground point on (or near) screen? MARG covers a model's on-screen
// height/footprint so tall entities near an edge aren't clipped early. Scales with zoom.
function onScreen(o: { x: number; y: number }): boolean {
  const [sx, sy] = iso(o.x, 0, o.y)
  const m = 40 * S.ZOOM
  return sx > -m && sx < V.W + m && sy > -m && sy < V.Hh + m
}

// LOD fallback: a flat colored square at a ground point (used when zoomed far out)
function dot(gx: number, gy: number, c: string, m = 1, h = 0) {
  const [sx, sy] = iso(gx, h, gy) // h lifts the dot off the ground (e.g. links sit low otherwise)
  X.fillStyle = c
  X.fillRect(sx - 2 * m, sy - 2 * m, 4 * m, 4 * m)
}


// a miner with no live crystal in mining range is "starved" (shown by recoloring its
// green part purple + a purple origin glow instead of the green mining laser).
const starved = (b: { x: number; y: number }) =>
  !S.nodes.some((n) => n.amt > 0 && (n.x - b.x) ** 2 + (n.y - b.y) ** 2 < MINE_RANGE ** 2)

const GPAT = makeGround(X) // procedural tileable dirt texture
// offscreen buffer the fog-of-war pass is composited on (see render)
const FC = FOG ? document.createElement('canvas') : (0 as never)
const FX = FOG ? FC.getContext('2d')! : (0 as never)

export function render() {
  const { buildings, nodes, enemies, pulses } = S
  // textured dirt ground, scaled+anchored to the world, then multiplied by sky light
  const gl = Math.min(1.2, 0.35 + 0.65 * SUN.amb * 2)
  X.save()
  const [ax0, ay0] = iso(0, 0, 0)
  const tile = GTS * S.ZOOM
  X.translate(((ax0 % tile) + tile) % tile, ((ay0 % tile) + tile) % tile)
  X.scale(S.ZOOM, S.ZOOM)
  X.fillStyle = GPAT
  X.fillRect(-GTS, -GTS, V.W / S.ZOOM + GTS * 2, V.Hh / S.ZOOM + GTS * 2)
  X.restore()
  X.globalCompositeOperation = 'multiply'
  X.fillStyle = `rgb(${Math.min(255, 255 * gl * SUN.col[0]) | 0},${Math.min(255, 255 * gl * SUN.col[1]) | 0},${Math.min(255, 255 * gl * SUN.col[2]) | 0})`
  X.fillRect(0, 0, V.W, V.Hh)
  X.globalCompositeOperation = 'source-over'

  if (S.sel && !buildings.includes(S.sel)) S.sel = null // selection was destroyed

  // Two levers keep the frame cheap with hundreds of entities:
  //  - viewport cull (onScreen): off-screen entities are skipped everywhere.
  //  - LOD dots: when zoomed far out, everything draws as a flat colored dot instead of a
  //    3D mesh, and shadows are skipped — a lathed mesh + shade() + global depth-sort per
  //    entity is wasted when each is only a few pixels.
  const DOTS = S.ZOOM < LOD_ZOOM
  // range rings: only for the selected building (placement preview shows its own).
  if (S.sel) drawRanges(S.sel.t, S.sel.x, S.sel.y, 0.5, S.sel.t === 'T' ? wepRng(S.sel) : 1)
  // construction progress ring (green chunks). Silhouette outlines (selected crystal +
  // buildings) are drawn later, on top of their models.
  for (const b of buildings)
    if (b.bp != null)
      chunkRing(b.x, b.y, R[b.t] + 5, BUILD[b.t], BUILD[b.t] - b.bp)
  // shielder enemies (kind 2): cyan ground ring marking the radius they regen shields within.
  if (!DOTS) for (const e of enemies)
    if (e.k === 2 && onScreen(e)) groundRing(e.x, e.y, SHIELDER_RANGE, '#4ff', 0.4, 2)
  // soft radial glow at screen (ax,ay): `c` is the "r,g,b" body, `k` scales opacity, `sc` scales
  // the radius. Defined at render scope (above the model pass) so the tower BONUS aura can paint
  // BEHIND the towers; the later pulse/beam/miner glows reuse it.
  const rad = 7 * S.ZOOM // glow radius (shared by chain beams, energy pulses, miner lasers)
  // core: if given, hold FULL opacity out to that radius fraction (a solid-core look, for bounce
  // bullets); otherwise the default soft falloff (0.2·k at 23% of the radius).
  const glow = (ax: number, ay: number, c: string, k = 1, sc = 1, core = 0) => {
    const r = rad * sc
    const grd = X.createRadialGradient(ax, ay, 0, ax, ay, r)
    grd.addColorStop(0, `rgba(${c},${k})`)
    grd.addColorStop(core || 0.23, `rgba(${c},${core ? k : 0.2 * k})`)
    grd.addColorStop(1, `rgba(${c},0)`)
    X.fillStyle = grd
    X.fillRect(ax - r, ay - r, r * 2, r * 2)
  }
  if (DOTS) {
    // map-legend dot colors by building type (distinct from the 3D model palette COL)
    for (const n of nodes)
      if ((n.ds || 0) > 0.02 && onScreen(n)) dot(n.x, n.y, '#987', R[n.k] * .3 * n.ds! * (n.k === 'rockSmall' ? .6 : n.k === 'rockLarge' ? 1.2 : 1)) // dot sized by rock size (× shrink)
    for (const b of buildings)
      if (b.bp == null && onScreen(b)) {
        if (b.crystalCol != null) { // color crystal: a circle in its color
          const [sx, sy] = iso(b.x, 0, b.y)
          X.fillStyle = b.crystalCol === 4 ? '#f66' : b.crystalCol === 2 ? '#6f6' : '#66f'
          X.beginPath(); X.arc(sx, sy, 3, 0, 7); X.fill()
        } else if (b.t === 'T') { // any tower: 2 SPEC dots (weapon | bonus) — empty slots white border
          const [sx, sy] = iso(b.x, 20, b.y), orbs = [b.weapon, b.bonus]
          const pos: [number, number][] = [[-5, 0], [5, 0]]
          X.lineWidth = 1
          for (let i = 0; i < 2; i++) {
            const x = sx + pos[i][0] - 3, y = sy + pos[i][1] - 3
            if (orbs[i] != null) { X.fillStyle = PIPCOL[orbs[i]!]; X.fillRect(x, y, 6, 6) }
            else { X.strokeStyle = '#fff'; X.strokeRect(x + .5, y + .5, 5, 5) }
          }
        } else
          dot(b.x, b.y, b.t === 'S' ? '#a4f' : b.t === 'L' ? '#ff4' : b.t === 'M' ? '#4f8' : '#F84', b.t === 'S' ? 2 : b.t === 'M' ? 1.5 : 1, b.t === 'L' || b.t === 'M' ? 8 : 0) // solars 2x; miners 1.5x; links+miners lifted
      }
    for (const e of enemies) // enemies: a 45°-rotated square (diamond)
      if (onScreen(e)) { const [sx, sy] = iso(e.x, 0, e.y), r = 2.5; X.fillStyle = '#f00'; X.save(); X.translate(sx, sy); X.rotate(Math.PI / 4); X.fillRect(-r, -r, r * 2, r * 2); X.restore() }
  } else {
    // cast drop shadows: collect every silhouette into ONE path, then fill once so
    // cast drop shadows: collect every silhouette into ONE path, then fill once so
    // overlapping shadows merge into a single flat region (no darker overlaps).
    X.fillStyle = '#000'
    X.globalAlpha = 0.2 + 0.06 * SUN.up // shAlpha 0.2
    X.beginPath()
    for (const n of nodes)
      if ((n.ds || 0) > 0.02 && onScreen(n)) addShadow(ENTITIES[n.k], n.x, n.y, n.ds!)
    for (const b of buildings)
      if (b.bp == null && onScreen(b)) addShadow(ENTITIES[b.ek ?? b.t], b.x, b.y, 1)
    for (const e of enemies)
      if (onScreen(e)) addShadow(ENTITIES.E, e.x, e.y, escale(e)*(e.k === 2 || e.k ===3 ? .5:1))
    X.fill('nonzero') // nonzero winding: overlaps count as inside, filled uniformly
    X.globalAlpha = 1

    // tower auras, painted BEHIND the tower model (drawn just below): the BONUS (3rd orb) color
    // as an on-ground pool at the base (squashed 40% vertically), and the WEAPON (1st orb) color
    // as a glow up at the muzzle — where the laser fires from (height 20).
    for (const b of buildings)
      if (b.t === 'T' && canFireE(b)) { // towers without enough energy to fire cast no ambient glow
        if (b.bonus != null) {
          const [ax, ay] = g(b.x, b.y, 0)
          X.save(); X.translate(ax, ay); X.scale(1, .6) // 40% vertical squash into a ground pool
          glow(0, 0, PIPRGB[b.bonus], 1.05, 2) // 50% brighter (k .7 -> 1.05)
          X.restore()
        }
        if (b.weapon != null) { const [ax, ay] = g(b.x, b.y, 20); glow(ax, ay, PIPRGB[b.weapon], 1.05, 1.2) }
      }

    // collect faces (skip under-construction buildings — those draw at half opacity)
    const faces: Face[] = []
    for (const n of nodes)
      if ((n.ds || 0) > 0.02 && onScreen(n)) entityFaces(ENTITIES[n.k], n.x, n.y, n.ds!, faces, undefined, undefined, n.ry)
    for (const b of buildings)
      if (b.bp == null && onScreen(b))
        entityFaces(ENTITIES[b.ek ?? b.t], b.x, b.y, 1, faces,
          // overloaded link flashes red; a link is tinted yellow. A TOWER is always GREY at its base
          // (spline 0); its head (spline 1) is tinted by the WEAPON color, darkened when unpowered.
          b.crystalCol != null ? (b.crystalCol === 4 ? '#f66' : b.crystalCol === 2 ? '#6f6' : '#66f')
            : b.load! > LINK_MAX ? '#f33'
            : b.t === 'L' ? '#ee4'
            : b.t === 'T' ? ['#888', mixHex(b.weapon != null ? PIPCOL[b.weapon] : '#ffc88c', '#000', canFireE(b) ? 1 : .35)] : undefined,
          b.t === 'M' && starved(b) ? '#a4f' : undefined, b.ry)
    for (const e of enemies)
      // fast enemies face their heading (e.face); all others spin (spin·t).
      if (onScreen(e)) entityFaces(emodel(e), e.x, e.y, escale(e), faces, enemyTint(e), undefined, e.k === 3 ? e.face || 0 : (e.spin || 0) * S.t, enemyTintA(e))
    faces.sort((a, b) => a.d - b.d)
    for (const f of faces) fillFace(f)
    X.globalAlpha = 1 // reset after translucent (crystal) faces
  }

  // under-construction buildings: draw a white silhouette outline (the model itself
  // stays invisible; the chunk ring shows build progress on the ground)
  if (!DOTS) {
    for (const b of buildings) // towers outline per-spline; other buildings as one merged hull
      if (b.bp != null && onScreen(b)) entityOutline(ENTITIES[b.ek ?? b.t], b.x, b.y, 1, '#fff', 2, 1, b.t === 'T', b.ry)
    // selected building: white silhouette outline on top of its (already-drawn) model
    if (S.sel && S.sel.bp == null) entityOutline(ENTITIES[S.sel.ek ?? S.sel.t], S.sel.x, S.sel.y, 1, '#fff', 2, 1, S.sel.t === 'T', S.sel.ry)
  }

  // build-mode placement preview: translucent model + range ring under the cursor
  if (S.mode === 'build' && S.mouse) {
    const p = unproject(S.mouse.x, S.mouse.y)
    // blocked if unaffordable OR overlapping an existing building/node
    const ok = S.resource >= COST[S.tool] && canPlace(S.tool, p.x, p.y)
    if (ok) drawRanges(S.tool, p.x, p.y, 0.4)
    else groundRing(p.x, p.y, LINK_RANGE, '#f44', 0.3, 1) // blocked: red hint

    // connection preview: lines to what this building would link with in range
    if (ok) {
      const line = (tx: number, ty: number, col: string) => {
        const [ax, ay] = iso(p.x, 4, p.y),
          [bx, by] = iso(tx, 4, ty)
        X.strokeStyle = col
        X.globalAlpha = 0.6
        beam(ax, ay, bx, by)
        X.globalAlpha = 1
      }
      const inR = (o: { x: number; y: number }, r: number) =>
        (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < r * r
      const energy = S.tool === 'S' || S.tool === 'L'
      for (const b of S.buildings) {
        // solar/link connect to every energy building; miner/tower connect to solar/link
        const connects = energy || b.t === 'S' || b.t === 'L'
        if (connects && inR(b, LINK_RANGE)) line(b.x, b.y, '#fd4') // yellow link line
      }
      // miners also show green lines to crystals they could mine
      if (S.tool === 'M')
        for (const n of S.nodes)
          if (n.amt > 0 && inR(n, MINE_RANGE)) line(n.x, n.y, '#4f6')
    }

    const pf: Face[] = []
    // tower preview: tip (spline 1) uses the uncolored-energy color, matching a placed uncolored tower
    entityFaces(ENTITIES[S.tool], p.x, p.y, 1, pf, ok ? (S.tool === 'T' ? [undefined, '#ffc88c'] : undefined) : '#844')
    pf.sort((a, b) => a.d - b.d)
    X.globalAlpha = 0.45
    for (const f of pf) fillFace(f)
    X.globalAlpha = 1
  }

  // forced-route lines: animated dashed blue "marching ants" from source to target
  X.strokeStyle = '#4af'
  X.lineWidth = 2
  X.setLineDash([6, 6])
  X.lineDashOffset = -S.t * 12 // marches along the line over time
  if (!isMenu && !DOTS) for (const b of buildings)
    if (b.route && buildings.includes(b.route)) {
      const [ax, ay] = g(b.x, b.y, 6),
        [bx, by] = g(b.route.x, b.route.y, 6)
      beam(ax, ay, bx, by)
    }
  // drag-to-connect preview: dashed line from the source building to the cursor
  if (S.chainFrom && S.mouse) {
    const c = unproject(S.mouse.x, S.mouse.y)
    const [ax, ay] = g(S.chainFrom.x, S.chainFrom.y, 6), [bx, by] = g(c.x, c.y)
    beam(ax, ay, bx, by)
  }
  X.setLineDash([])
  X.lineWidth = 1

  // energy pulses: colored glowing orbs — color encodes the energy's RGB bitmask.
  // Index 0 = uncolored (warm dim white), 1-7 = B/G/GB/R/RB/RG/RGB via bitmask.
  const PCOLS = [
    ['255,200,140', 1, 0.4], // 0: uncolored (~44% more transparent than colored)
    ['20,90,255', 1, 1],     // 1: B
    ['62,255,62', 1, 1],     // 2: G
    ['0,255,255', 1, 1],     // 3: GB/cyan
    ['255,62,62', 1, 1],     // 4: R
    ['255,0,255', 1, 1],     // 5: RB/magenta
    ['255,255,0', 1, 1],     // 6: RG/yellow
    ['255,255,255', 1, 1],   // 7: RGB/white
  ] as const
  for (const p of pulses) {
    const x = p.x + (p.tx - p.x) * p.p, y = p.y + (p.ty - p.y) * p.p
    const [sx, sy] = g(x, y, 8)
    const [c, k, sc] = PCOLS[p.col & 7]
    // zoomed far out: a small colored square per pulse (glows would be an illegible smear) —
    // colored energy draws 3x3 to stand out, uncolored stays a single pixel.
    if (DOTS) { const w = p.col & 7 ? 3 : 1; X.fillStyle = `rgb(${c})`; X.fillRect((sx | 0) - (w >> 1), (sy | 0) - (w >> 1), w, w) }
    else glow(sx, sy, c, k, sc)
  }

  // tower + miner beams use the UNCOLORED energy look (warm dim white, = PCOLS[0])
  const UNCOL = '255,238,140'
  // LASER beam (weapon 1): a thick hitscan beam. Tinted by the tower's ELEMENT (or red if none).
  // Its intensity is beamA (ramps up while firing, fades as energy runs out) — driving beam
  // alpha and the muzzle/impact glow.
  for (const b of buildings)
    if (b.t === 'T' && b.beamA && b.beamA > 0.01 && b.fx) {
      const hex = b.bonus != null ? PIPCOL[b.bonus] : '#ffc88c' // bonus color tints the beam; else uncolored
      const rgb = b.bonus != null ? PIPRGB[b.bonus] : '255,200,140'
      const [ax, ay] = g(b.x, b.y, 20), [bx, by] = g(b.fx.x, b.fx.y, 7)
      X.strokeStyle = hex; X.lineWidth = 4; X.globalAlpha = b.beamA
      glow(ax, ay, rgb, b.beamA, 1.3) // muzzle glow
      beam(ax, ay, bx, by)
      glow(bx, by, rgb, b.beamA, 0.8) // impact flare
      // chain laser: the beam WALKS from link to link — primary -> A -> B -> ... — so draw each
      // segment from the previous point to the next, thinner than the main beam.
      if (b.chainT) { X.lineWidth = 2; let px = bx, py = by; for (const o of b.chainT) { const [cx, cy] = g(o.x, o.y, 7); beam(px, py, cx, cy); glow(cx, cy, rgb, b.beamA, 0.6); px = cx; py = cy } }
    }
  X.globalAlpha = 1
  X.lineWidth = 2
  X.strokeStyle = '#feb'
  // miner lasers: fade in over the first 300ms and out over the last 300ms of the 1s cut.
  // An uncolored glow (same soft radial style as energy pulses) pulses at the laser origin.
  // (strokeStyle/lineWidth still '#feb'/2 from the tower loop above)
  for (const b of buildings)
    if (b.t === 'M' && b.bp == null) {
      const [ax, ay] = g(b.x, b.y, 13)
      if (b.mn) {
        const mp = b.mp || 0
        const a = Math.max(0, Math.min(1, Math.min(mp, MINE_ON - mp) / 0.3)) // fade in/out over the firing window
        const [bx, by] = g(b.mn.x, b.mn.y, 3) // impact ~20% lower on the rock (was 6)
        glow(ax, ay, UNCOL, a) // origin glow
        glow(bx, by, UNCOL, a, 0.8) // impact glow at the crystal (half size)
        X.globalAlpha = a // beam
        beam(ax, ay, bx, by)
      } else if (starved(b)) {
        // idle with no reachable crystal: pulse a purple "starved" glow at the origin
        glow(ax, ay, '180,110,255')
      }
    }
  // railgun rays: an instant hitscan beam from tower to max range that fades out (life 1 -> 0).
  for (const r of S.rays) {
    const [ax, ay] = g(r[0], r[1], 20), [bx, by] = g(r[2], r[3], 7)
    X.strokeStyle = `rgb(${r[5]})`; X.lineWidth = 3; X.globalAlpha = r[4]
    glow(ax, ay, r[5], r[4], 1.1) // muzzle flash
    beam(ax, ay, bx, by)
    X.globalAlpha = 1
  }
  X.lineWidth = 2
  // enemy health bar: ONE bar above each enemy. Red HP fill (hp/hp0) over a dark track, with
  // the cyan shield drawn as a LAYER ON TOP of it (sh/sh0, same bar). Hidden at full hp & no
  // shield so undamaged normals stay clean; hidden when zoomed out to DOTS or on the title.
  if (!DOTS && !isMenu) for (const e of enemies) {
    // show the bar if the enemy is hurt OR carries a shield (shielded units always show it).
    if (!onScreen(e) || (e.hp >= (e.hp0 || 1) && !e.sh0)) continue
    const w = 14 * escale(e), [cx, cy] = g(e.x, e.y, 22 * escale(e)), bx = cx - w / 2
    X.globalAlpha = 1
    X.fillStyle = '#400'; X.fillRect(bx, cy, w, 3)                                    // track
    X.fillStyle = '#f44'; X.fillRect(bx, cy, w * Math.max(0, e.hp) / (e.hp0 || 1), 3) // hp
    if (e.sh! > 0) { X.fillStyle = '#4ff'; X.fillRect(bx, cy, w * e.sh! / e.sh0!, 3) } // shield on top
  }
  // tower energy: a subtle yellow bar (enemy-health-bar style) over a dark track, shown for EVERY
  // finished tower while below full charge — so a just-built tower shows its meter right away and
  // you can watch it charge (and lasers show their drain/recharge as they fire).
  X.globalAlpha = 1
  for (const b of buildings)
    if (b.t === 'T' && b.bp == null && b.e < CHARGE && onScreen(b)) {
      const [cx, cy] = g(b.x, b.y, 26), bx = cx - 7
      X.fillStyle = '#960'; X.fillRect(bx, cy, 14, 3)                 // dark track (20% lighter than #430)
      X.fillStyle = '#fe4'; X.fillRect(bx, cy, 14 * b.e / CHARGE, 3)     // yellow energy
    }
  // spec pips: 2 slots above the SELECTED tower (only) — weapon | bonus, tinted by each color;
  // empty slots draw a white outline. Tapping swaps which color is weapon vs bonus. (Zoomed-out
  // DOTS mode shows a tower's colors via its dot instead, so pips are hidden there.)
  X.globalAlpha = 1 // reset: prior particle/pulse glows leave alpha <1, which would blink the pips
  {
    const b = S.sel
    if (!DOTS && b && b.t === 'T' && b.bp == null) {
      const orbs = [b.weapon, b.bonus] // weapon | bonus (undefined = empty)
      const [cx, cy] = g(b.x, b.y, 30)
      const pos: [number, number][] = [[-5, 0], [5, 0]]
      X.lineWidth = 1
      for (let i = 0; i < 2; i++) {
        const x = cx + pos[i][0] - 3, y = cy + pos[i][1] - 3
        if (orbs[i] != null) { X.fillStyle = PIPCOL[orbs[i]!]; X.fillRect(x, y, 6, 6) }
        else { X.strokeStyle = '#fff'; X.strokeRect(x + .5, y + .5, 5, 5) } // empty: white border
      }
    }
  }
  // tower projectiles — orb, trail, and explosion all carry the shot's color (s.col), which is
  // the tower's element tint (or the weapon default when it has no element).
  for (const s of S.shots) {
    // launch from the TOP of the tower (~20) like the laser, then settle to the projectile's
    // travel height over the first ~0.15s so it reads as fired from the muzzle, not the base.
    // ease from muzzle height (20) down to travel height over the first ~36 world-units of FLIGHT
    // (distance-based, not time-based) so slow bullets descend at the same angle as fast ones.
    const base = s.rocket ? 8 : 5, travelled = Math.hypot(s.vx, s.vy) * s.age
    const h = base + (20 - base) * Math.max(0, 1 - travelled / 36)
    const [sx, sy] = g(s.x, s.y, h)
    // bounce: starts at .6, shrinking a diminishing amount per hit (.85^hits, hits = 4 - remaining)
    let a = 1, sc = s.rocket ? (s.big ? 1 : 0.8) : s.bounce ? .6 * .85 ** (4 - s.bounce) : 0.5
    if (s.sz) {
      // flame puff: translucent, grows small->big over its life, then fades to 0 after 80%.
      const f = Math.min(1, s.age / (s.life || 1))
      sc = s.sz * (0.25 + 0.75 * f) // small -> big
      a = .35 * (f < 0.8 ? 1 : (1 - f) / 0.2) // low opacity; full then fade over the last 20%
    }
    // bounce bullet: a bigger solid core (full color out to 40% of the radius) reads as mostly core
    glow(sx, sy, s.col, a, sc, s.bounce ? 0.4 : 0)
  }
  // generic particles: little glows fading as they fly out (mining sparks, explosions, smoke).
  // An affliction "rise" particle (q[7]) floats UP as it fades — its draw height climbs with age.
  for (const q of S.parts) {
    const [sx, sy] = g(q[0], q[1], q[7] ? 6 + (1 - q[4]) * 24 : 6)
    glow(sx, sy, q[5], q[4], 0.5 * (q[6] || 1)) // 7th elem scales size (big rocket explosions)
  }
  X.globalAlpha = 1
  X.lineWidth = 1

  // fog of war: one dark shape covering the screen with a circular CUTOUT at each
  // building, filled even-odd so the already-drawn world shows through the holes and only
  // the unrevealed area is darkened. REVEAL is a world distance, so scale by zoom.
  if (FOG) {
    // Fog of war tied to LIVING buildings: each frame, punch a soft circular cutout at every
    // finished building's current position out of a black offscreen buffer (destination-out, so
    // overlaps merge cleanly), then blit it over the scene. Sight follows your buildings — sell
    // or lose one and its area goes dark again. REVEAL is a world distance, so scale by zoom.
    if (FC.width !== V.W || FC.height !== V.Hh) { FC.width = V.W; FC.height = V.Hh }
    FX.clearRect(0, 0, V.W, V.Hh)
    FX.fillStyle = '#000'
    FX.fillRect(0, 0, V.W, V.Hh)
    FX.globalCompositeOperation = 'destination-out'
    const rr = REVEAL * S.ZOOM
    for (const b of buildings) {
      if (b.bp != null || b.crystalCol != null) continue // skip under-construction + color crystals
      const [sx, sy] = iso(b.x, 0, b.y)
      const gr = FX.createRadialGradient(sx, sy, 0, sx, sy, rr)
      gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)')
      FX.fillStyle = gr
      FX.beginPath(); FX.arc(sx, sy, rr, 0, 7); FX.fill()
    }
    FX.globalCompositeOperation = 'source-over'
    X.drawImage(FC, 0, 0)
  }

  if (false) drawMinimap()
  if (false) drawThreat()

  // one full-screen black fill for both fades: the start-transition (trans 0→1 covers the
  // title, 1→2 reveals the game) and the page-load intro (hold black INTRO_HOLD, then fade out).
  const f = Math.min(1, Math.max(trans < 1 ? trans : 2 - trans, INTRO_HOLD + 1 - intro))
  if (f > 0) { X.globalAlpha = f; X.fillStyle = '#000'; X.fillRect(0, 0, V.W, V.Hh); X.globalAlpha = 1 }
}
