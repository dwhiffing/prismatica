// Rendering: 3D face projection, shadows, ground, and the top-level render().
import {
  BUILD,
  CHAIN_RANGE,
  COST,
  LINK_RANGE,
  MINE_RANGE,
  R,
  TOWER_RANGE,
} from './constants'
import { canPlace, depth, iso, unproject } from './core'
import type { BType } from './types'
import { GROUND_TILE, makeGround } from './ground'
import { hull, meshOf, norm, rotate } from './geometry'
import { shade } from './lighting'
import { COL, ENTITIES, type Entity } from './models'
import { LT, S, SPAWN, SUN, V, X } from './state'
import type { Building, Face, V3 } from './types'

// push all of an entity's splines (each lathed, transformed by its own
// scale/rotation/offset, then the entity ground pos + uniform scale s) as shaded
// faces. `override` replaces every spline color (used for build preview).
function entityFaces(
  ent: Entity,
  gx: number,
  gz: number,
  s: number,
  out: Face[],
  override?: string,
) {
  for (const sp of ent.splines) {
    const m = meshOf(sp.geo)
    const col = override || sp.mat.col
    for (const f of m.faces) {
      const wv: V3[] = f.map((i) => {
        const lv = rotate(
          [
            m.verts[i][0] * sp.scl,
            m.verts[i][1] * sp.scl,
            m.verts[i][2] * sp.scl,
          ],
          sp.rot,
        )
        // entity scale s, drop onto ground; clamp y>=0 so sub-surface geometry is cut off
        return [
          gx + (lv[0] + sp.off[0]) * s,
          Math.max(0, (lv[1] + sp.off[1]) * s),
          gz + (lv[2] + sp.off[2]) * s,
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
      })
    }
  }
}

function fillFace(f: Face) {
  X.fillStyle = f.c
  X.beginPath()
  for (let i = 0; i < f.v.length; i++) {
    const [sx, sy] = iso(f.v[i][0], f.v[i][1], f.v[i][2])
    if (i === 0) X.moveTo(sx, sy)
    else X.lineTo(sx, sy)
  }
  X.closePath()
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
function chunkRing(gx: number, gy: number, r: number, n: number, done: number) {
  const slot = (Math.PI * 2) / n
  const gap = Math.min(slot * 0.4, 0.15) // constant angular gap between chunks
  const seg = Math.max(2, Math.ceil((slot - gap) / 0.25)) // enough segments to stay smooth
  X.lineWidth = 4
  for (let k = 0; k < n; k++) {
    X.strokeStyle = k < done ? '#7fb' : '#161'
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

// draw a building's range rings: a shared yellow link ring for every energy
// building, plus a green mine ring (miners) or red shoot ring (towers). `tRange`
// overrides the tower ring radius (used to show a chain head's enhanced range).
function drawRanges(t: BType, gx: number, gy: number, alpha = 0.5, tRange = TOWER_RANGE) {
  groundRing(gx, gy, LINK_RANGE, '#fd4', alpha, 2) // yellow: energy link range (all)
  if (t === 'M') groundRing(gx, gy, MINE_RANGE, '#4f6', alpha, 2) // green: mine range
  if (t === 'T') groundRing(gx, gy, tRange, '#f66', alpha, 2) // red: shoot range
}

// project an entity's vertices onto the ground along the light, then hull them
// into the outer silhouette. Recomputed each frame so the shadow moves smoothly.
function shadowPoints(ent: Entity, L: V3): [number, number][] {
  const pts: [number, number][] = []
  for (const sp of ent.splines) {
    const m = meshOf(sp.geo)
    for (const v of m.verts) {
      const lv = rotate([v[0] * sp.scl, v[1] * sp.scl, v[2] * sp.scl], sp.rot)
      const wy = lv[1] + sp.off[1]
      const t = -wy / L[1] // slide along L to y=0
      pts.push([lv[0] + sp.off[0] + L[0] * t, lv[2] + sp.off[2] + L[2] * t])
    }
  }
  return hull(pts)
}

// add one entity's drop-shadow silhouette (convex hull projected along the light) as a
// sub-path to the CURRENT path — no fill. All shadows are collected into a single path
// and filled once (see render) so overlaps merge flat instead of stacking darker.
function addShadow(ent: Entity, gx: number, gz: number, s: number) {
  const su = Math.max(LT.shFloor, SUN.up) // floor so night keeps a short cast shadow
  const a = (LT.dayT - 0.25) * Math.PI * 2
  const L = norm([
    -Math.cos(a) * LT.shLean * su,
    -(0.5 + LT.shLen * (1 - su)),
    0.7 * su,
  ])
  const pts = shadowPoints(ent, L)
  if (pts.length < 3) return
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = iso(gx + pts[i][0] * s, 0, gz + pts[i][1] * s)
    i ? X.lineTo(sx, sy) : X.moveTo(sx, sy)
  }
  X.closePath()
}

// outline an entity's on-screen silhouette: project every vertex to screen space,
// convex-hull them, and stroke the hull. Used to highlight under-construction buildings.
function entityOutline(ent: Entity, gx: number, gz: number, s: number, col: string) {
  const pts: [number, number][] = []
  for (const sp of ent.splines) {
    const m = meshOf(sp.geo)
    for (const v of m.verts) {
      const lv = rotate([v[0] * sp.scl, v[1] * sp.scl, v[2] * sp.scl], sp.rot)
      pts.push(
        iso(gx + (lv[0] + sp.off[0]) * s, Math.max(0, (lv[1] + sp.off[1]) * s), gz + (lv[2] + sp.off[2]) * s),
      )
    }
  }
  const h = hull(pts)
  if (h.length < 3) return
  X.strokeStyle = col
  X.lineWidth = 2
  X.lineJoin = 'round'
  X.beginPath()
  for (let i = 0; i < h.length; i++) i ? X.lineTo(h[i][0], h[i][1]) : X.moveTo(h[i][0], h[i][1])
  X.closePath()
  X.stroke()
  X.lineWidth = 1
}

// project a ground point to screen at a given up-height (for lasers/pulses/labels)
function g(gx: number, gy: number, yUp = 0): [number, number] {
  return iso(gx, yUp, gy)
}

// the HEAD of the laser chain `t` belongs to: walk back along incoming chain links to
// the tower that nothing else chains into. The head is the one that actually fires.
function chainHead(t: Building): Building {
  const bs = S.buildings
  let head = t,
    g = 0
  for (;;) {
    const prev = bs.find((o) => o.t === 'T' && o.chain === head && bs.includes(o))
    if (!prev || ++g > 99) break
    head = prev
  }
  return head
}
// number of towers in the whole chain that `t` belongs to (count forward from the head).
// Matches the sim's head-based chain length so the ring/beam agree with the actual bonus.
function towerChainLen(t: Building): number {
  const bs = S.buildings
  let n = 1,
    cur: Building | null = chainHead(t),
    g = 0
  while (cur && cur.chain && bs.includes(cur.chain) && ++g < 99) {
    n++
    cur = cur.chain
  }
  return n
}

const GPAT = makeGround(X) // procedural tileable dirt texture
const GTS = GROUND_TILE

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
  if (S.selN && S.selN.amt <= 0) S.selN = null // crystal depleted

  // range rings: only for the selected building (placement preview shows its own). A
  // selected tower shows its chain-enhanced firing range.
  if (S.sel) {
    const tR = S.sel.t === 'T' ? TOWER_RANGE * (1 + CHAIN_RANGE * (towerChainLen(S.sel) - 1)) : TOWER_RANGE
    drawRanges(S.sel.t, S.sel.x, S.sel.y, 0.5, tR)
  }
  // construction progress ring (green chunks). The selected building's white
  // silhouette outline is drawn later, on top of its model.
  for (const b of buildings)
    if (b.bp !== undefined)
      chunkRing(b.x, b.y, R[b.t] + 5, BUILD[b.t], BUILD[b.t] - b.bp)
  if (S.selN && S.selN.amt > 0)
    groundRing(S.selN.x, S.selN.y, R[S.selN.k] + 1, '#fff', 1, 6)
  groundRing(SPAWN.x, SPAWN.y, 10, '#456') // spawn marker

  // cast drop shadows: collect every silhouette into ONE path, then fill once so
  // overlapping shadows merge into a single flat region (no darker overlaps).
  X.fillStyle = '#000'
  X.globalAlpha = LT.shAlpha + 0.06 * SUN.up
  X.beginPath()
  for (const n of nodes)
    if ((n.ds || 0) > 0.02) addShadow(ENTITIES[n.k], n.x, n.y, n.ds!)
  for (const b of buildings)
    if (b.bp === undefined) addShadow(ENTITIES[b.t], b.x, b.y, 1) // skip under-construction
  for (const e of enemies) addShadow(ENTITIES.E, e.x, e.y, 1)
  X.fill('nonzero') // nonzero winding: overlaps count as inside, filled uniformly
  X.globalAlpha = 1

  // collect faces (skip under-construction buildings — those draw at half opacity)
  const faces: Face[] = []
  for (const n of nodes)
    if ((n.ds || 0) > 0.02) entityFaces(ENTITIES[n.k], n.x, n.y, n.ds!, faces)
  for (const b of buildings)
    if (b.bp === undefined) entityFaces(ENTITIES[b.t], b.x, b.y, 1, faces)
  for (const e of enemies) entityFaces(ENTITIES.E, e.x, e.y, 1, faces)
  faces.sort((a, b) => a.d - b.d)
  for (const f of faces) fillFace(f)

  // under-construction buildings: draw a white silhouette outline (the model itself
  // stays invisible; the chunk ring shows build progress on the ground)
  for (const b of buildings)
    if (b.bp !== undefined) entityOutline(ENTITIES[b.t], b.x, b.y, 1, '#fff')
  // selected building: white silhouette outline on top of its (already-drawn) model
  if (S.sel && S.sel.bp === undefined) entityOutline(ENTITIES[S.sel.t], S.sel.x, S.sel.y, 1, '#fff')

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
        X.beginPath()
        X.moveTo(ax, ay)
        X.lineTo(bx, by)
        X.stroke()
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
    entityFaces(ENTITIES[S.tool], p.x, p.y, 1, pf, ok ? undefined : '#844')
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
  for (const b of buildings)
    if (b.route && buildings.includes(b.route)) {
      const [ax, ay] = g(b.x, b.y, 6),
        [bx, by] = g(b.route.x, b.route.y, 6)
      X.beginPath()
      X.moveTo(ax, ay)
      X.lineTo(bx, by)
      X.stroke()
    }
  // linking armed: preview line from the selected source to the cursor
  if (S.linking && S.sel && S.mouse) {
    const c = unproject(S.mouse.x, S.mouse.y)
    const [ax, ay] = g(S.sel.x, S.sel.y, 6),
      [bx, by] = g(c.x, c.y, 6)
    X.beginPath()
    X.moveTo(ax, ay)
    X.lineTo(bx, by)
    X.stroke()
  }
  X.setLineDash([])
  X.lineWidth = 1

  const rad = 7 * S.ZOOM // glow radius (shared by chain beams, energy pulses, miner lasers)

  // laser-chain lines: a red beam tower->tower along each chain link. When the chain's
  // HEAD is actively shooting the beam is thick (scales with chain size); idle chains are
  // a thin dim connector. A firing glow sits on every tower — full on the head, half on
  // the rest.
  const chainGlow = (x: number, y: number, k: number) => {
    const [ax, ay] = g(x, y, 18)
    const grd = X.createRadialGradient(ax, ay, 0, ax, ay, rad)
    grd.addColorStop(0, `rgba(255,170,150,${0.9 * k})`)
    grd.addColorStop(0.3, `rgba(255,100,100,${0.25 * k})`)
    grd.addColorStop(1, 'rgba(255,100,100,0)')
    X.fillStyle = grd
    X.fillRect(ax - rad, ay - rad, rad * 2, rad * 2)
  }
  X.strokeStyle = '#f66'
  X.lineCap = 'round'
  for (const b of buildings)
    if (b.t === 'T' && b.chain && buildings.includes(b.chain) && b.bp === undefined) {
      const head = chainHead(b)
      const firing = !!(head.fxt && head.fxt > 0 && head.fx) // whole chain lights up together
      const [ax, ay] = g(b.x, b.y, 18),
        [bx, by] = g(b.chain.x, b.chain.y, 18)
      if (firing) {
        X.globalAlpha = 1
        X.lineWidth = 1.5 + towerChainLen(b) // thicker for bigger chains
        chainGlow(b.x, b.y, b === head ? 1 : 0.5) // head full, others half
        if (!b.chain.chain) chainGlow(b.chain.x, b.chain.y, 0.5) // glow the tail tower too
      } else {
        X.globalAlpha = 0.4
        X.lineWidth = 1.5 // thin idle connector
      }
      X.beginPath()
      X.moveTo(ax, ay)
      X.lineTo(bx, by)
      X.stroke()
    }
  X.globalAlpha = 1
  X.lineCap = 'butt'
  X.lineWidth = 1

  // energy pulses: soft glowing orbs (radial gradient fading to transparent)
  for (const p of pulses) {
    const x = p.x + (p.tx - p.x) * p.p,
      y = p.y + (p.ty - p.y) * p.p
    const [sx, sy] = g(x, y, 8)
    const grd = X.createRadialGradient(sx, sy, 0, sx, sy, rad)
    grd.addColorStop(0, 'rgba(255,255,180,0.9)')
    grd.addColorStop(0.3, 'rgba(255,238,120,0.25)')
    grd.addColorStop(1, 'rgba(255,238,120,0)')
    X.fillStyle = grd
    X.fillRect(sx - rad, sy - rad, rad * 2, rad * 2)
  }

  // tower beams: the head fires at an enemy, with a glow at the tower origin
  X.strokeStyle = '#f88'
  X.lineWidth = 2
  for (const b of buildings)
    if (b.t === 'T' && b.fxt && b.fxt > 0 && b.fx) {
      const [ax, ay] = g(b.x, b.y, 20),
        [bx, by] = g(b.fx.x, b.fx.y, 7)
      const grd = X.createRadialGradient(ax, ay, 0, ax, ay, rad)
      grd.addColorStop(0, 'rgba(255,180,160,0.9)')
      grd.addColorStop(0.3, 'rgba(255,110,110,0.25)')
      grd.addColorStop(1, 'rgba(255,110,110,0)')
      X.fillStyle = grd
      X.fillRect(ax - rad, ay - rad, rad * 2, rad * 2)
      X.beginPath()
      X.moveTo(ax, ay)
      X.lineTo(bx, by)
      X.stroke()
    }
  // miner lasers: fade in over the first 300ms and out over the last 300ms of the 1s cut.
  // A green glow (same soft radial style as energy pulses) pulses at the laser origin.
  X.strokeStyle = COL.M
  for (const b of buildings)
    if (b.t === 'M' && b.mn) {
      const mp = b.mp || 0
      const a = Math.max(0, Math.min(1, Math.min(mp, 1 - mp) / 0.3)) // shared fade
      const [ax, ay] = g(b.x, b.y, 16),
        [bx, by] = g(b.mn.x, b.mn.y, 6)
      // origin glow
      const grd = X.createRadialGradient(ax, ay, 0, ax, ay, rad)
      grd.addColorStop(0, `rgba(150,255,190,${0.9 * a})`)
      grd.addColorStop(0.3, `rgba(80,255,150,${0.25 * a})`)
      grd.addColorStop(1, 'rgba(80,255,150,0)')
      X.fillStyle = grd
      X.fillRect(ax - rad, ay - rad, rad * 2, rad * 2)
      // beam
      X.globalAlpha = a
      X.beginPath()
      X.moveTo(ax, ay)
      X.lineTo(bx, by)
      X.stroke()
    }
  X.globalAlpha = 1
  X.lineWidth = 1

  // energy count labels above powered buildings
  X.fillStyle = '#fff'
  X.textAlign = 'center'
  for (const b of buildings)
    if (b.e > 0) {
      const [sx, sy] = g(b.x, b.y, 26)
      X.fillText('' + b.e, sx, sy)
    }
  // resource count above the selected crystal
  if (S.selN && S.selN.amt > 0) {
    const [sx, sy] = g(S.selN.x, S.selN.y, 24)
    X.fillText('' + Math.ceil(S.selN.amt), sx, sy)
  }
  X.textAlign = 'left'
}
