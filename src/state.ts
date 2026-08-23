// Shared mutable state that spans modules. World/camera state lives on the single
// `S` object so any module can read+write S.foo without ES live-binding issues
// (the object reference is constant; only its properties change). SUN/LT are
// likewise objects mutated in place.
import { INIT_ZOOM } from './constants'
import type { BType, Building, Enemy, Pt, Pulse, ResNode, V3 } from './types'

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
  // generic particles: [x, y, vx, vy, life, "r,g,b"] in world space; life 1 -> 0 as it fades
  parts: [] as [number, number, number, number, number, string][],
  resource: 0,
  rps: 0, // resources per second earned by active miners (HUD readout)
  tool: 'S' as BType,
  mode: 'select' as 'select' | 'build', // build mode shows a placement preview
  sel: null as Building | null, // selected building
  linking: false, // 'z' armed: next click on an in-range link sets sel's route
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

// Day/night. LT is live-tunable via the dev Leva panel (see dev.js). Time-of-day:
//  - dayLen: seconds per full day   - autoDay: auto-advance vs scrub
//  - dayT: 0..1 time of day (0=midnight, .25=dawn, .5=noon, .75=dusk)
// Sun-shape params (defaults = the previously hardcoded values in lighting.ts):
//  - lean: horizontal x-lean of the light   - depth: z component
//  - drop/dropUp: vertical drop at low sun / extra at noon
//  - amb/ambDay: ambient floor / extra by day   - diff: diffuse gain
export const LT = ((globalThis as any).LT ||= {
  dayLen: 60,
  autoDay: true,
  dayT: 0.35,
  lean: 2.25,
  depth: 2.3,
  drop: 0.1,
  dropUp: 0,
  amb: 0.4,
  ambDay: 0.32,
  diff: 1.6,
  // drop-shadow shape/opacity
  shFloor: 0.73, // min sun height for shadows (higher = shorter night shadow)
  shLean: 1.5, // horizontal spread of the shadow
  shLen: 1.5, // how much longer shadows get as the sun lowers
  shAlpha: 0.2, // base shadow opacity
  // resource crystal patch generation (sunflower layout, read by reset() in game.ts)
  patchN: 150, // total number of patches in the world
  patchSpacing: 90, // base ring spacing; actual radius = spacing·i^0.7 (spreads with distance)
  patchMin: 3, // fewest crystals per patch
  patchMax: 6, // most crystals per patch
  patchSpread: 105, // scatter radius around each patch center
})

// Derived sun state, recomputed each frame from LT.dayT by computeSun().
export const SUN = {
  dir: [0, -1, 0] as V3, // direction light travels (points down at noon)
  col: [1, 1, 1] as V3, // light color multiplier (warm/cool by time)
  amb: 0.4, // ambient level (bright day, dark night)
  up: 1, // sun height 0..1 (used for shadow length + sky)
}

resize()
