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
  route?: Building | null // forced relay target (set via 'z'); overrides round-robin
  // --- upgrade system (towers) ---
  // A tower absorbs colored energy (up to 3 units) as it fires; the ordered colors it holds
  // spell out its spec. cols = absorbed color-indices (0..6) in arrival order; perm = which of
  // the 6 orderings is currently applied (tap F to cycle). weapon/elem/bonus are DERIVED from
  // cols[perm] by applyCols(): 1st slot -> weapon, 2nd -> elem, 3rd -> bonus (fewer than 3 held
  // = partial spec). A tower with <3 cols keeps absorbing colored energy.
  cols?: number[] // absorbed color-indices in arrival order (length 0..3)
  perm?: number // 0..5: index into PERMS, the ordering applied to cols (F cycles it)
  weapon?: number // 0..6 weapon type (derived: cols[perm][0]); undefined = peashooter
  elem?: number // 0..6 element (derived: cols[perm][1]); undefined = none
  bonus?: number // 0..6 bonus (derived: cols[perm][2]); undefined = none
  beamA?: number // red-laser weapon: continuous-beam intensity 0..1 (ramps up, fades on empty)
  load?: number // link: energy units passed through this second (reset each tick); over
  // LINK_MAX it overloads — excess is burned and the link draws red until the next reset
  crystalCol?: number // if set: world color crystal; ORs this color bit into passing energy (4=R,2=G,1=B)
  csz?: number // color crystal size 1..3 = colorings left; each successful recolor decrements it
  // (and steps the model N->N2->N3); at 0 the crystal is depleted and removed.
  ek?: EType // entity model override (color crystals render a crystal model, stepped by size)
  filt?: number // link color filter: 0=any(yellow), else only energy with this bit (4=R,2=G,1=B)
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
  acidT?: number // green acid: damage over time
  fireT?: number // red fire: dies at 10% hp; explodes on death
  wetT?: number // blue water: takes +10% damage
  stunT?: number // yellow lightning: can't move (re-applied on each hit while affected)
  slowT?: number // cyan cold: movement halved (also legacy slow-rocket)
  arcT?: number // magenta arcane: damage taken is shared to nearby arcane-affected enemies
  convT?: number // white converted: flees its target instead of advancing
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
  elem?: number // the firing tower's element (0..6), applied to enemies this shot damages
  sz?: number // visual size multiplier for the drawn orb (flamethrower puffs are big)
  pierce?: number // railgun: hits remaining before the shot is consumed (passes through enemies)
  bounce?: number // bouncing shot: bounces remaining (redirected to a new enemy on each hit)
  straight?: boolean // grenade: an explosive shot that flies straight (no homing) then detonates
  hits?: Enemy[] // piercing shot: enemies already damaged, so it hits each only once
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
  avoid?: Building // a building the next relay must not deliver to (pushes ejected energy away)
}

// --- render types ---
export type Face = { v: V3[]; c: string; d: number; a?: number } // world verts, color, depth key, alpha
export type Mesh = { faces: [number, number, number, number][]; verts: V3[] }
