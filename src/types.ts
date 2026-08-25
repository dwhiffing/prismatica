// Shared types for the game. (V3 and EType live in models.ts and are re-exported
// here so game code has a single import point for types.)
import type { EType, V3 } from './models'
export type { EType, V3 } from './models'

// building types the player can place
export type BType = 'S' | 'L' | 'M' | 'T'

export interface Pt {
  x: number
  y: number
}
export interface Building extends Pt {
  t: BType
  e: number // stored energy
  hp: number
  cd: number // cooldown timer
  bp?: number // build power remaining (>0 = under construction); undefined/0 = complete
  fx?: Enemy | null // tower beam target
  fxt?: number // tower beam fx timer
  mn?: ResNode | null // miner: node being mined
  mp?: number // miner: phase timer
  sh?: number // miner: shots left on the current energy charge
  ni?: number // round-robin index for cycling through neighbors when relaying energy
  route?: Building | null // forced relay target (set via 'z'); overrides round-robin
  chain?: Building | null // tower: next tower in the laser chain (set via 'z')
  rv?: boolean // fog: this finished building has been recorded into S.revealed
  load?: number // link: energy units passed through this second (reset each tick); over
  // LINK_MAX it overloads — excess is burned and the link draws red until the next reset
  crystalCol?: number // if set: world color crystal; ORs this color bit into passing energy (4=R,2=G,1=B)
  ek?: EType // entity model override (used by color crystals to render a crystal instead of link)
  rush?: boolean // "rush build": in-range links were rerouted to feed this; cleared when built
  filt?: number // link color filter: 0=any(yellow), else only energy with this bit (4=R,2=G,1=B)
}
export interface ResNode extends Pt {
  amt: number // resources remaining
  cap: number // full resource capacity (amt at spawn)
  k: EType // which rock model: 'rockLarge', 'rockMedium', 'rockSmall'
  ds?: number // displayed scale 0..1, eases toward amt/cap (smooth shrink as depleted)
  ry?: number // random Y rotation (radians) so crystals don't all face the same way
}
export interface Enemy extends Pt {
  hp: number
  target: Building | null
}
export interface Pulse {
  x: number
  y: number
  tx: number
  ty: number
  p: number // 0..1 progress along the hop
  len: number // world length of the hop (for constant-speed travel)
  dst: Building // the node this pulse is arriving at (routed further, or consumed)
  col: number // energy color bitmask (4=R,2=G,1=B; 0=uncolored)
}

// --- render types ---
export type Face = { v: V3[]; c: string; d: number; a?: number } // world verts, color, depth key, alpha
export type Mesh = { faces: [number, number, number, number][]; verts: V3[] }
