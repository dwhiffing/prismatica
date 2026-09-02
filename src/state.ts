// Shared mutable state that spans modules. World/camera state lives on the single
// `S` object so any module can read+write S.foo without ES live-binding issues
// (the object reference is constant; only its properties change). SUN/LT are
// likewise objects mutated in place.
import { INIT_ZOOM } from './constants'
import type { BType, Building, Enemy, Pt, Pulse, ResNode, Shot, V3 } from './types'

// --- canvas / viewport ---
export const C = document.getElementById('c') as HTMLCanvasElement
export const X = C.getContext('2d')!
export const H = document.getElementById('h') as HTMLDivElement
export const V = { W: 0, Hh: 0 } // viewport size (updated on resize)
export function resize() {
  V.W = C.width = innerWidth
  V.Hh = C.height = innerHeight
}

// --- world + camera + interaction state ---
export const S = {
  buildings: [] as Building[],
  nodes: [] as ResNode[],
  enemies: [] as Enemy[],
  pulses: [] as Pulse[],
  // deferred colored-orb releases (from re-entering upgrade mode): [delay-secs, sourceBuilding,
  // colorBitmask]. Staggered so the released orbs don't all fire at once. Drained in stepSim.
  emits: [] as [number, Building, number][],
  shots: [] as Shot[], // flying tower projectiles (bullets & rockets; lasers are instant)
  // generic particles: [x, y, vx, vy, life, "r,g,b", size?] in world space; life 1 -> 0 as it
  // fades. Optional 7th elem scales the drawn glow (default 1; big for rocket explosions).
  parts: [] as [number, number, number, number, number, string, number?][],
  resource: 0,
  rps: 0, // resources per second earned by active miners (HUD readout)
  tool: 'S' as BType,
  mode: 'select' as 'select' | 'build', // build mode shows a placement preview
  sel: null as Building | null, // selected building
  chainFrom: null as Building | null, // source of an active drag-to-connect (preview line)
  mouse: null as Pt | null, // last cursor screen pos (for build preview)
  spawnT: 0, // enemies already spawned in the current threat level
  threat: 0, // threat level: +1 each minute; level N spawns N enemies over that minute
  t: 0, // elapsed seconds
  revealed: [] as Pt[], // world points permanently uncovered by fog of war (grows only)
  ZOOM: INIT_ZOOM, // camera zoom (scroll wheel to change; clamped MIN_ZOOM..MAX_ZOOM)
  camX: 0,
  camY: 0, // world-space point centered on screen
  muteState: +(localStorage.m ?? 2), // 0=muted, 1=sfx only (no music), 2=all sound; persisted
}
export const SPAWN: Pt = { x: 0, y: 0 } // player origin

// Day/night + resource-field tuning. `dayT` is the only field mutated at runtime (the
// day/night cycle advances it, see game.ts loop); the rest are fixed. The old sun/shadow
// tuning knobs (lean/depth/drop/amb/sh*) are now inlined as literals at their single use
// sites in lighting.ts / render.ts, since the dev Leva panel that tuned them is gone.
//  - dayT: 0..1 time of day (0=midnight, .25=dawn, .5=noon, .75=dusk)
export const LT = {
  dayLen: 60,
  dayT: 0.35,
  // resource crystal patch generation (sunflower layout, read by reset() in game.ts)
  patchN: 150, // total number of patches in the world
  patchSpacing: 100, // base ring spacing; actual radius = spacing·i^0.7 (spreads with distance)
  patchMin: 6, // fewest crystals per patch
  patchMax: 12, // most crystals per patch
  patchSpread: 150, // scatter radius around each patch center
}

// Derived sun state, recomputed each frame from LT.dayT by computeSun().
export const SUN = {
  dir: [0, -1, 0] as V3, // direction light travels (points down at noon)
  col: [1, 1, 1] as V3, // light color multiplier (warm/cool by time)
  amb: 0.4, // ambient level (bright day, dark night)
  up: 1, // sun height 0..1 (used for shadow length + sky)
}

resize()
