// Day/night lighting: sun arc, color temperature, and per-face flat shading.
import { C_GOLDEN, C_NIGHT, C_NOON } from './constants'
import { norm } from './geometry'
import { SUN } from './state'
import type { V3 } from './types'

// linear blend of two rgb (0..1) vectors
function mix(a: V3, b: V3, t: number): V3 {
  return a.map((v, i) => v + (b[i] - v) * t) as V3
}

// recompute SUN from the time of day (0..1). Called once per frame.
export function computeSun(dayT: number) {
  // sun arc: angle around the day. 0=midnight (below), .5=noon (above).
  const a = (dayT - 0.25) * Math.PI * 2 // dawn at 0 rad rising
  const up = Math.sin(a) // -1 (deep night) .. +1 (noon)
  SUN.up = Math.max(0, up)
  // Light travels downward but kept OBLIQUE (never straight down) so vertical/side
  // faces catch it at differing angles and read as distinct facets instead of a
  // flat fill. Strong, roughly-constant horizontal lean; vertical drop is clamped.
  const vy = -0.1 // vertical drop, never 0 (was LT.drop + LT.dropUp·max(0,up), dropUp=0)
  SUN.dir = norm([-Math.cos(a) * 2.25, vy, 2.3]) // lean 2.25, depth 2.3
  // day factor eases through a twilight band around the horizon so dusk blends
  // into night instead of snapping. 0 = full night, 1 = well above horizon.
  const TW = 0.54 // half-width of the dawn/dusk twilight band (sun-height units); wide = long sunrise/sunset
  const dayF = Math.max(0, Math.min(1, (up + TW) / (2 * TW)))
  // temperature: moonlit night -> golden low sun -> neutral noon
  const warm = Math.min(1, Math.max(0, up) * 2.2)
  const daytimeCol = mix(C_GOLDEN, C_NOON, Math.max(0, Math.min(1, (warm - 0.3) / 0.7)))
  SUN.col = mix(C_NIGHT, daytimeCol, dayF)
  // ambient eases through twilight too: moonlit floor + extra by day
  SUN.amb = 0.4 + 0.32 * dayF // amb 0.4 + ambDay 0.32·dayF
}

// shade a face: diffuse from SUN.dir tinted by SUN.col + ambient, combined with
// the spline material's own ambient/diffuse strengths.
export function shade(base: string, n: V3, amb: number, dif: number): string {
  const L = SUN.dir // direction light travels; face is lit if it points toward -L
  const d = Math.max(0, -(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]))
  const lit = amb * SUN.amb * 1.6 + dif * d * (0.35 + 0.65 * SUN.up) // diff 1.6
  return tint(base, lit, SUN.col)
}

// scale a #rgb / #rrggbb hex by brightness f and multiply by light color lc (0..1)
function tint(hex: string, f: number, lc: V3 = [1, 1, 1]): string {
  let r: number, g: number, bl: number
  if (hex.length === 4) {
    r = parseInt(hex[1], 16) * 17
    g = parseInt(hex[2], 16) * 17
    bl = parseInt(hex[3], 16) * 17
  } else {
    r = parseInt(hex.slice(1, 3), 16)
    g = parseInt(hex.slice(3, 5), 16)
    bl = parseInt(hex.slice(5, 7), 16)
  }
  const c = (n: number, l: number) => Math.min(255, n * f * l) | 0
  return `rgb(${c(r, lc[0])},${c(g, lc[1])},${c(bl, lc[2])})`
}
