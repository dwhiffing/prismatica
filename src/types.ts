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
  dead?: number // set when an enemy reaches it — one hit destroys a building (then filtered out)
  cd: number // cooldown timer
  bp?: number // build power remaining (>0 = under construction); undefined/0 = complete
  fx?: Enemy | null // tower beam target
  fxt?: number // tower beam fx timer
  mn?: ResNode | null // miner: node being mined
  mp?: number // miner: phase timer
  sh?: number // miner: shots left on the current energy charge
  ni?: number // round-robin index for cycling through neighbors when relaying energy
  hist?: Building[] // tower: the buildings the colored orb it holds passed through (incl. this tower).
  // Saved on absorption so an EJECTED orb keeps its history and routes toward towers it hasn't been in.
  sk?: number // solar night-halving toggle: emits only on ticks where this flips to 1
  route?: Building | null // forced relay target (set via 'z'); overrides round-robin
  // --- upgrade system (towers) ---
  // A tower absorbs colored energy (up to 3 units) as it fires; the ordered colors it holds
  // spell out its spec. cols = absorbed color-indices (0..6) in arrival order; perm = which of
  // weapon/bonus are DERIVED from cols by applyCols(): slot 0 -> weapon, slot 1 -> bonus (tap to
  // swap which is which). A tower with <2 cols keeps absorbing colored energy.
  cols?: number[] // absorbed color-indices in arrival order (length 0..2)
  perm?: number // 0 = as-absorbed, 1 = weapon/bonus swapped
  weapon?: number // 0..6 weapon type (derived: cols[perm?1:0]); undefined = peashooter
  bonus?: number // 0..6 bonus type + bullet tint (derived); undefined = none
  beamA?: number // red-laser weapon: continuous-beam intensity 0..1 (ramps up, fades on empty)
  chainT?: Enemy[] // white chain-laser: enemies zapped near the primary target this tick (side beams)
  load?: number // link: energy units passed through this second (reset each tick); over
  // LINK_MAX it overloads — excess is burned and the link draws red until the next reset
  crystalCol?: number // if set: world color crystal; ORs this color bit into passing energy (4=R,2=G,1=B)
  csz?: number // color crystal size 1..3 = colorings left; each successful recolor decrements it
  // (and steps the model N->N2->N3); at 0 the crystal is depleted and removed.
  ek?: EType // entity model override (color crystals render a crystal model, stepped by size)
  drain?: number // title menu only: energy arriving here is consumed (never forwarded/bounced)
  emit?: number // title menu only: this dot is its letter's sole energy source (see spray)
  ry?: number // random Y rotation (radians) so towers don't all face the same way
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
  hp0?: number // spawn hp (max), for fire's "dies at 10%" threshold
  k?: number // kind: 0 normal, 1 shield, 2 shielder, 3 fast, 4 summoner, 5 boss
  sh?: number // current shield hp (shield/shielded enemies); absorbs damage before hp
  sh0?: number // max shield (for regen cap by a shielder)
  hurtT?: number // seconds of shield-regen immunity remaining after taking damage (0.5 on hit)
  spd?: number // per-kind movement speed override (fast=high, boss/summoner=low)
  spin?: number // body spin rate (rad/sec about Y); sign = CW/CCW, randomized per enemy at spawn
  face?: number // fast enemies: Y-yaw pointing along their movement (instead of spinning)
  ai?: number // per-kind AI timer (summoner: spawn cooldown; boss: move/pause phase)
  target?: Building | null
  kx?: number // knockback velocity (world units/sec); decays each frame — a shove, not a teleport
  ky?: number
  // --- element afflictions (each a remaining-seconds timer; 0/undefined = not affected) ---
  slowT?: number // cyan bonus: movement halved (also legacy slow-rocket)
  dotT?: number // magenta bonus: damage over time
}
// a flying projectile from a tower (bullets & rockets; lasers are instant beams, no shot).
export interface Shot extends Pt {
  vx: number
  vy: number
  target: Enemy | null // homing target (rocket) or lead-aim reference (bullet); may die mid-flight
  tx: number // world aim point (bullet: lead-predicted or wide-miss point)
  ty: number
  rocket?: boolean // true = rocket (homing arc + smoke + explosion), else bullet
  dmg: number // damage on hit (0 = a bullet that missed — still flies, deals nothing)
  kb: number // knockback distance applied to the enemy on hit
  age: number // seconds alive (drives the rocket's up-first launch arc)
  life?: number // bullet: seconds it flies before expiring — with speed, sets its RANGE
  st?: number // rocket smoke-trail spawn accumulator
  slow?: number // seconds of slow this rocket applies on hit (slow-rocket variant)
  big?: boolean // long-range rocket (faster; drawn a touch larger)
  col: string // "r,g,b" tint for the orb, its trail, and (rockets) the explosion
  elem?: number // the firing tower's BONUS color (0..6), carrying its affliction to enemies hit
  sz?: number // visual size multiplier for the drawn orb (flamethrower puffs are big)
  pierce?: number // railgun: hits remaining before the shot is consumed (passes through enemies)
  bounce?: number // bouncing shot: bounces remaining (redirected to a new enemy on each hit)
  straight?: boolean // grenade: an explosive shot that flies straight (no homing) then detonates
  hits?: Enemy[] // piercing shot: enemies already damaged, so it hits each only once
  shieldMul?: number // how hard this shot hits shields (pea/MG .25 weak; others 1 normal). default 1
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
  avoid?: Building // a building the next relays must not deliver to (pushes ejected energy away)
  avoidN?: number // hops of `avoid` remaining: decremented each relay, avoid drops at 0
  hist?: Building[] // recent buildings this pulse passed through; colored energy avoids revisiting them
}

// --- render types ---
export type Face = { v: V3[]; c: string; d: number; a?: number } // world verts, color, depth key, alpha
export type Mesh = { faces: [number, number, number, number][]; verts: V3[] }
