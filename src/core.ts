// Shared core: dimetric projection + small world queries used by sim, render, input.
import { ISO, R, YSCALE } from './constants'
import { S, V } from './state'
import type { BType, Building, Pt } from './types'

// project world (x=east, y=up, z=south) to screen
export function iso(x: number, y: number, z: number): [number, number] {
  const sx = (x - z - (S.camX - S.camY)) * S.ZOOM
  const sy = (x + z - (S.camX + S.camY)) * ISO * S.ZOOM - y * YSCALE * S.ZOOM
  return [V.W / 2 + sx, V.Hh / 2 + sy]
}
// depth key: larger = farther back (drawn first)
export function depth(x: number, y: number, z: number) {
  return x + z + y * 0.5
}
// screen -> ground world coords (inverse iso at y=0)
export function unproject(mx: number, my: number): Pt {
  const xmz = (mx - V.W / 2) / S.ZOOM + (S.camX - S.camY) // x - z
  const xz = (my - V.Hh / 2) / (ISO * S.ZOOM) + (S.camX + S.camY) // x + z
  return { x: (xz + xmz) / 2, y: (xz - xmz) / 2 }
}

// rnd(): Math.random by default. Set a non-zero `seed` (via setSeed) for a deterministic
// sequence — used to make the title's mineral scatter identical every load. setSeed(0)
// restores true randomness for gameplay. The seeded path is a sin-hash: fract(sin(seed++)·1e4),
// which is cheaper (short literals, reuses Math.sin/floor) than an LCG and well-distributed.
let seed = 0
export const setSeed = (n: number) => { seed = n }
export function rnd() {
  if (!seed) return Math.random()
  const x = Math.sin(seed++) * 1e4
  return x - Math.floor(x)
}
export function dist2(a: Pt, b: Pt) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}
export function near(a: Pt, b: Pt, r: number) {
  return dist2(a, b) < r * r
}
// can a building of type `t` be placed at (x,y) without overlapping an existing
// building or a live resource node? (circle overlap using the R collision radii)
export function canPlace(t: BType, x: number, y: number): boolean {
  const p = { x, y }
  for (const b of S.buildings) if (dist2(p, b) < (R[t] + R[b.t]) ** 2) return false
  for (const n of S.nodes) if (n.amt > 0 && dist2(p, n) < (R[t] + R[n.k]) ** 2) return false
  return true
}
// nearest building to `from` passing `pred`, within max distance² `maxD2`
export function nearest(from: Pt, pred: (b: Building) => boolean, maxD2: number): Building | null {
  let best: Building | null = null
  for (const b of S.buildings) {
    if (!pred(b)) continue
    const d = dist2(from, b)
    if (d < maxD2) {
      maxD2 = d
      best = b
    }
  }
  return best
}
