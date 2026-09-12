// Tunable constants for the game. (Mutable runtime state like the camera lives on
// S in state.ts; these are compile-time constants.)
import type { BType, EType, V3 } from './types'

// --- gameplay ranges (world units) ---
export const LINK_RANGE = 50 // energy transfer range — same for every energy building
export const MINE_RANGE = 30 // miner -> resource node (green ring)
// miner cycle: fire the laser for MINE_ON seconds, then MINE_OFF recharge. The extraction rate
// during firing is scaled so the FULL cycle averages exactly 1 resource/sec (see the miner loop).
export const MINE_ON = 2
export const MINE_OFF = 0.5
export const TOWER_RANGE = 112 // tower -> enemy base range (red ring). was 150, -25%
// tower weapon tuning (wep: 0=laser, 1=bullet, 2=rocket)
export const BSPEED = 240 // bullet travel speed (world units/sec)
export const BULLET_LIFE = 0.6 // seconds a bullet flies before expiring — range = BSPEED * this
export const RSPEED = 130 // rocket travel speed (world units/sec)
export const KB_BULLET = 8 // enemy knockback distance on a bullet hit
export const KB_ROCKET = 25 // enemy knockback distance on a rocket blast
export const KB_DECAY = 8 // knockback velocity decay rate (higher = shorter, snappier slide)
// laser fires continuously: energy/sec drained while beaming, then a firing/cooldown cycle —
// fires for LASER_ON seconds, then must cool for LASER_OFF (shortened by the fire-rate bonus).
export const LASER_DRAIN = 2
export const LASER_ON = 1.5
export const LASER_OFF = 1

// --- entity sizes / economy ---
export const R: Record<EType, number> = {
  S: 10,
  L: 4,
  M: 5,
  T: 3,
  rockLarge: 6,
  rockMedium: 5,
  rockSmall: 4,
  N: 6,
  N2: 5,
  N3: 4,
  E: 5, E2: 5, E3: 5, E4: 5 // enemy kinds share a collision radius
} // pick/collision radii
export const COST: Record<BType, number> = { S: 40, L: 3, M: 15, T: 20 } // resource cost to place
export const BUILD: Record<BType, number> = { S: 25, L: 2, M: 8, T: 12 } // energy to construct
export const CHARGE = 5 // energy a miner/tower stores at full charge
export const TOWER_GAIN = .5 // power a tower gains per delivered energy unit (so it takes several)
export const NODE_AMT = 250 // starting resources in a crystal node
export const ENEMIES = true // master switch: set false to disable enemy spawns
// DEV ONLY master switch: set false to turn OFF every dev-mode feature in a dev build — the debug
// keys, free/fog toggles, AND booting straight into the game — so the dev build behaves like release
// (shows the title, no debug shortcuts). No effect on release, which never has these anyway.
export const DEV_FEATURES = true
// DEV ONLY: set false to boot to the TITLE even in a dev build (overrides SKIPTITLE). No effect on
// release, which always shows the title. Flip this instead of editing bundle.js.
export const DEV_SKIP_TITLE = false
export const ESPEED = 5 // enemy speed px/s
export const SHIELDER_RANGE = 60 // shielder (kind 2): radius it regens shields on nearby enemies
// --- waves ---
export const WAVE1_DELAY = 60 // seconds of grace before wave 1 spawns
export const WAVE_WIN = 50 // clear this many waves to win
export const SPAWN_GAP = 0.6 // seconds between individual enemy spawns within a wave

// --- energy routing ---
export const PSPEED = 25 // energy pulse travel speed, world-units/sec (constant across hops)
export const LINK_MAX = 12 // energy a link can pass per second; excess overloads it (turns red, burned)

// --- camera / projection ---
export const ISO = 0.7 // vertical squash toward 1 = more overhead (0.5 = 2:1 dimetric)
export const YSCALE = 0.8 // height exaggeration on screen
// scroll-wheel zoom: starting level and the range it clamps to
export const INIT_ZOOM = 3
export const MIN_ZOOM = .5
export const MAX_ZOOM = 3
// below this zoom, entities draw as flat dots (no 3D mesh / shadows) for performance
export const LOD_ZOOM = 1
// fog of war: world-space radius each building reveals through the darkness
export const REVEAL = 180

// --- lighting colors (0..1 rgb) ---
export const C_NIGHT: V3 = [0.55, 0.62, 1.0] // cool moonlight (bright enough to read at night)
export const C_GOLDEN: V3 = [1.0, 0.6, 0.32] // warm dawn/dusk
export const C_NOON: V3 = [1.0, 0.98, 0.9] // bright neutral
export const GROUND: V3 = [77, 44, 24] // base brown earth (rgb 0..255)
