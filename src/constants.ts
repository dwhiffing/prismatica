// Tunable constants for the game. (Mutable runtime state like ZOOM/camera lives in
// game.ts; these are compile-time constants.)
import type { BType, EType, V3 } from './types'

// --- gameplay ranges (world units) ---
export const LINK_RANGE = 40 // energy transfer range — same for every energy building
export const MINE_RANGE = 70 // miner -> resource node (green ring)
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
  N: 8,
  N2: 7,
  N3: 6,
  E: 5,
} // pick/collision radii
export const COST: Record<BType, number> = { S: 30, L: 5, M: 20, T: 25 } // resource cost to place
export const BUILD: Record<BType, number> = { S: 25, L: 2, M: 5, T: 10 } // energy to construct
export const CHARGE = 5 // energy a miner/tower stores at full charge
export const NODE_AMT = 50 // starting resources in a crystal node
export const ENEMIES = true // master switch: set false to disable enemy spawns
export const ESPEED = 10 // enemy speed px/s

// --- energy routing ---
export const PSPEED = 100 // energy pulse travel speed, world-units/sec (constant across hops)

// --- camera / projection ---
export const RES = 1 // render resolution scale: backing store is this × the window, then
// CSS stretches it to full size (lower = chunkier pixels, cheaper to draw)
export const ISO = 0.7 // vertical squash toward 1 = more overhead (0.5 = 2:1 dimetric)
export const YSCALE = 0.8 // height exaggeration on screen

// --- lighting colors (0..1 rgb) ---
export const C_NIGHT: V3 = [0.55, 0.62, 1.0] // cool moonlight (bright enough to read at night)
export const C_GOLDEN: V3 = [1.0, 0.6, 0.32] // warm dawn/dusk
export const C_NOON: V3 = [1.0, 0.98, 0.9] // bright neutral
export const GROUND: V3 = [88, 58, 38] // base brown earth (rgb 0..255)
