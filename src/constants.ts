// Tunable constants for the game. (Mutable runtime state like the camera lives on
// S in state.ts; these are compile-time constants.)
import type { BType, EType, V3 } from './types'

// --- gameplay ranges (world units) ---
export const LINK_RANGE = 50 // energy transfer range — same for every energy building
export const MINE_RANGE = 30 // miner -> resource node (green ring)
export const TOWER_RANGE = 112 // tower -> enemy base range (red ring). was 150, -25%
// laser-chain bonuses: each extra tower in a chain adds this fraction of the base range
// and this much flat damage to the chain HEAD (the tower that actually fires).
export const CHAIN_RANGE = 0.35 // +35% base range per extra chained tower
export const CHAIN_DMG = 2 // +2 damage per extra chained tower

// --- entity sizes / economy ---
export const R: Record<EType, number> = {
  S: 10,
  L: 4,
  M: 5,
  T: 6,
  rockLarge: 6,
  rockMedium: 5,
  rockSmall: 4,
  crystalR: 5,
  crystalG: 5,
  crystalB: 5,
  E: 5,
} // pick/collision radii
export const COST: Record<BType, number> = { S: 30, L: 5, M: 20, T: 25 } // resource cost to place
export const BUILD: Record<BType, number> = { S: 25, L: 2, M: 8, T: 12 } // energy to construct
export const CHARGE = 5 // energy a miner/tower stores at full charge
export const NODE_AMT = 250 // starting resources in a crystal node
export const ENEMIES = true // master switch: set false to disable enemy spawns
export const ESPEED = 10 // enemy speed px/s

// --- energy routing ---
export const PSPEED = 50 // energy pulse travel speed, world-units/sec (constant across hops)
export const LINK_MAX = 12 // energy a link can pass per second; excess overloads it (turns red, burned)

// --- camera / projection ---
export const ISO = 0.7 // vertical squash toward 1 = more overhead (0.5 = 2:1 dimetric)
export const YSCALE = 0.8 // height exaggeration on screen
// scroll-wheel zoom: starting level and the range it clamps to
export const INIT_ZOOM = 3
export const MIN_ZOOM = .2
export const MAX_ZOOM = 3
// below this zoom, entities draw as flat dots (no 3D mesh / shadows) for performance
export const LOD_ZOOM = .8
// fog of war: world-space radius each building reveals through the darkness
export const REVEAL = 180

// --- lighting colors (0..1 rgb) ---
export const C_NIGHT: V3 = [0.55, 0.62, 1.0] // cool moonlight (bright enough to read at night)
export const C_GOLDEN: V3 = [1.0, 0.6, 0.32] // warm dawn/dusk
export const C_NOON: V3 = [1.0, 0.98, 0.9] // bright neutral
export const GROUND: V3 = [77, 44, 24] // base brown earth (rgb 0..255)
