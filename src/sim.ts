// Simulation: energy routing, per-second tick, and the per-frame world update
// (towers, miners, enemies, pulses). Pure logic — no drawing.
import { BSPEED, BUILD, BULLET_LIFE, CHARGE, ENEMIES, ESPEED, KB_BULLET, KB_DECAY, KB_ROCKET, LASER_OFF, LASER_ON, LINK_MAX, LINK_RANGE, MINE_ON, MINE_OFF, MINE_RANGE, PSPEED, R, RSPEED, SHIELDER_RANGE, SPAWN_GAP, TOWER_GAIN, TOWER_RANGE, WAVE1_DELAY, WAVE_WIN } from './constants'
import { near, rnd } from './core'
import { S, SPAWN, SUN, V } from './state'
import { drawUI } from './ui'
import type { Building, Enemy, Pt, ResNode, Shot } from './types'
import { ekOf, isMenu } from './game'
import { zzfx } from './zzfx'
import { basicHitSound, basicShootSound, bounceShootSound, buildingProgressSound, completeBuildingSound, coneSound, enemyDestroySound, energyConvertSound, laserSound, mgShootSound, mineSound, railShootSound, rocketShootSound, towerAbsorbEnergySound, towerEjectEnergySound } from './sounds'

// energy color bitmask (4=R,2=G,1=B) -> upgrade index 0..6: green,red,blue,yellow,cyan,magenta,white
const COLIDX: Record<number, number> = { 2: 0, 4: 1, 1: 2, 6: 3, 3: 4, 5: 5, 7: 6 }
// upgrade index 0..6 -> energy color bitmask (inverse of COLIDX; for releasing held orbs)
const IDXCOL = [2, 4, 1, 6, 3, 5, 7]
// derive weapon + bonus from a tower's (up to 2) absorbed colors. slot 0 -> WEAPON (type + head
// glow), slot 1 -> BONUS (effect + base glow + bullet tint). perm 0 = as-absorbed, 1 = swapped.
export function applyCols(b: Building) {
  const cs = b.cols || [], sw = b.perm ? 1 : 0
  b.weapon = cs[sw]; b.bonus = cs[sw ^ 1] // undefined where cs has no color
}
// color index (0..6) -> "r,g,b" tint (matches the render PIPRGB order).
const ECOL = ['68,255,102', '255,68,68', '68,136,255', '238,238,68', '68,255,255', '255,68,255', '255,255,255']
// a shot's color: the BONUS color tint if the tower has one, else the weapon's default.
const shotCol = (b: Building, def: string) => b.bonus != null ? ECOL[b.bonus] : def

// is this building still under construction? (bp defined until the progress bar
// finishes animating — bp===0 means paid but not yet visually complete)
const building = (o: Building) => o.bp != null
// does this building want to KEEP an arriving unit? under construction (owes build
// power), a miner that has no energy queued (never stockpiles), or a tower below full
// charge. links never keep it.
const wants = (o: Building) =>
  building(o) ? (o.bp as number) > 0 : o.e < (o.t === 'T' ? CHARGE : o.t === 'M' ? 1 : 0)
// apply one unit that has arrived: build it, or store it. A TOWER gains only TOWER_GAIN power per
// energy unit (so it takes several units to charge up), while miners/others store the full unit.
function feed(o: Building) {
  if (building(o)) {
    (o.bp as number) -= 1
    // per build-unit tick; pitch rises with progress (base 100 -> ~180 near done). Completion
    // sound covers the last unit, so only play while still building (bp > 0).
    if (o.bp) playAt(buildingProgressSound(700 - (1 - o.bp / BUILD[o.t]) * 600), o.x, o.y)
  }
  else o.e += o.t === 'T' ? TOWER_GAIN : 1
}

// spawn `n` particles at (x,y) flying out in random directions at up to `spd`
// world-units/sec, tinted "r,g,b" `col`. Generic — reuse for any burst (mining, hits,
// explosions) by varying n / spd / col.
export function spawnParts(x: number, y: number, n: number, spd: number, col: string) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, s = spd * (0.5 + rnd() * 0.5)
    S.parts.push([x, y, Math.cos(a) * s, Math.sin(a) * s, 1, col])
  }
}

// explosion sound volume 0..1 by how close (x,y) is to the CENTER of the screen (the camera
// point): full at center, ramping DOWN TO ZERO at the screen edge (~V.W/2 px out) so anything you
// pan away from goes silent. Distance is world units × zoom (screen px), framing-relative.
function centerVol(x: number, y: number) {
  const d = Math.hypot(x - S.camX, y - S.camY) * S.ZOOM // world dist -> screen px from center
  return Math.max(0, 1 - d / (V.W / 2))
}
// play a positional sound (a zzfx param array) at world (x,y): its volume (param 0) is scaled by
// proximity to screen center, and it's skipped entirely once fully off-screen (silent). On the
// TITLE the ambient combat/mining sounds play at 25% so the menu isn't loud. Use for any
// world-located effect so panning away quiets it.
export function playAt(sound: (number | undefined)[], x: number, y: number) {
  const v = centerVol(x, y) * (isMenu ? .25 : 1)
  if (v) zzfx((sound[0] as number || 1) * v, ...sound.slice(1))
  return v // truthy = actually audible (on-screen), so callers can cap concurrent plays
}
// a death explosion at (x,y): one big fading core particle plus a spray of debris flying out.
// Shared by dying enemies and destroyed buildings. Sound is quieter the further from screen center.
function explode(x: number, y: number) {
  S.parts.push([x, y, 0, 0, 1, '255,90,60', 6]) // big explosion core
  spawnParts(x, y, 12, 110, '255,120,60')       // debris flying out
  playAt(enemyDestroySound, x, y)
}
// remove dead enemies (hp<=0), exploding each. Returns the survivors.
function killDead() {
  for (const e of S.enemies) if (e.hp <= 0) explode(e.x, e.y)
  S.enemies = S.enemies.filter((e) => e.hp > 0)
}

// spawn a pulse from `from` to `to`, carrying an energy color. `avoid` (a building the relays must
// NOT deliver back to) rides along for `avoidN` more hops — used to push just-ejected energy away.
function hop(from: Pt, to: Building, col = 0, avoid?: Building, avoidN = 0) {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  S.pulses.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, p: 0, len, dst: to, col, avoid, avoidN })
}

// does a tower still have room to absorb a colored energy unit (fewer than 3 specced)? Must be
// FINISHED — an under-construction tower can't take colors (it still owes uncolored build energy).
const towerRoom = (o: Building) => o.t === 'T' && !building(o) && (o.cols?.length || 0) < 2
// can building `o` receive energy of color `col`? A link forwards (or builds while under
// construction). COLORED energy is only ever CONSUMED by a tower with spec room — and it takes
// it regardless of firing charge, so a fully-charged tower still upgrades. UNCOLORED energy
// goes to anything that WANTS a unit (excludes full miners/towers and finished solars). Colored
// energy is never lost — it routes onward (relayed by links, recolored by crystals) to a tower.
const accepts = (o: Building, col: number) =>
  col ? o.t === 'L' || towerRoom(o) : o.t === 'L' || wants(o)
// relay a unit onward FROM `node`, preserving its energy color. `avoid` (if given) is excluded
// from every candidate — used so just-ejected energy at its first link never routes back to the
// tower that released it.
export function relay(node: Building, col = 0, avoid?: Building, avoidN = 0) {
  if (node.drain) return // title drain node: energy arrives and is consumed, never forwarded
  // the avoid only applies while hops remain; each forward hop carries one fewer, so ejected
  // energy shuns its source tower for avoidN hops then may return.
  const av = avoidN > 0 ? avoid : undefined, n = Math.max(0, avoidN - 1)
  const ok = (o: Building) => o !== node && o !== av && accepts(o, col) && near(node, o, LINK_RANGE)
  // PRIORITY: an in-range consumer that actually NEEDS this unit (under construction, or a
  // miner/tower below charge — anything non-link that accepts + keeps it) wins over the forced
  // route. A `route` steers surplus energy, but a building waiting to be built or powered should
  // never be starved just because this link is aimed elsewhere.
  const needy = S.buildings.filter((o) => o.t !== 'L' && ok(o))
  if (needy.length) { node.ni = ((node.ni || 0) + 1) % needy.length; hop(node, needy[node.ni], col, av, n); return }
  // forced route next, as long as the target is alive, in range, can receive, and isn't avoided
  const rt = node.route
  if (rt && rt !== av && S.buildings.includes(rt) && accepts(rt, col) && near(node, rt, LINK_RANGE)) {
    hop(node, rt, col, av, n)
    return
  }
  // never relay back against an established directed connection: if o routes to us (o->node),
  // don't send energy the other way (node->o).
  const ns = S.buildings.filter((o) => o.route !== node && ok(o))
  if (ns.length) { node.ni = ((node.ni || 0) + 1) % ns.length; hop(node, ns[node.ni], col, av, n); return }
  // dead end. UNCOLORED energy just stops (it's cheap fuel). COLORED energy is precious and must
  // never be lost, so bounce it to the nearest acceptor anywhere — even back the way it came, even
  // out of range — so it keeps circulating until something consumes it.
  if (col) bounceColor(node, col, av, n)
}
// last-resort re-home for colored energy with no in-range forward target: hop it to the nearest
// building (any range, ignoring directed-connection rules) that can still accept this color.
// `avoid` is excluded and rides `avoidN` more hops, so ejected energy keeps shunning its source.
function bounceColor(from: Building, col: number, avoid?: Building, avoidN = 0) {
  let best: Building | null = null, bd = Infinity
  for (const o of S.buildings) {
    if (o === from || o === avoid) continue
    const dd = (o.x - from.x) ** 2 + (o.y - from.y) ** 2
    if (dd < bd && accepts(o, col)) { bd = dd; best = o }
  }
  if (best) hop(from, best, col, avoid, avoidN) // else: no acceptor exists anywhere — nothing we can do
}


// per-second tick: reset link counters + emit solar energy (daylight only). Wave spawning
// runs per-frame in stepSim (see updateWaves), not here.
function tick() {
  for (const b of S.buildings) b.load = 0 // reset per-second link throughput counters
  // each finished solar SCHEDULES its once-per-second emission after a random 0-250ms delay
  // (stored in b.cd, counted down in stepSim) so the solars don't all pulse in lockstep. In
  // daylight every tick emits; at night each solar runs at HALF speed — it emits every OTHER tick
  // (toggling b.sk), deterministically (no randomness).
  for (const b of S.buildings) if (b.t === 'S' && !building(b)) {
    if (SUN.up > 0) { b.sk = 0; b.cd = rnd() * .25 + .001 }
    else if ((b.sk = b.sk ? 0 : 1)) b.cd = rnd() * .25 + .001 // night: emit on alternate ticks
  }
  if (!isMenu) drawUI()
}

// WAVE MACHINE (per-frame). Grace period until WAVE1_DELAY, then wave 1 begins. Each wave's
// roster (waveRoster) is queued and drained one enemy every SPAWN_GAP seconds; once the queue
// is empty AND every enemy is dead, the next wave begins. Clearing wave WAVE_WIN wins the game.
function updateWaves(dt: number) {
  if (!ENEMIES || S.won || !S.buildings.length) return
  if (S.wave === 0) { // grace period before the first wave
    if (S.t >= WAVE1_DELAY) startWave(1)
    return
  }
  // drain the spawn queue at a steady cadence
  if (S.queue.length) {
    if ((S.spawnT -= dt) <= 0) { S.spawnT = SPAWN_GAP; spawnEnemy(S.queue.pop()) }
    return
  }
  // queue empty + board clear -> advance (or win after the final wave)
  if (!S.enemies.length) {
    if (S.wave >= WAVE_WIN) S.won = 1
    else startWave(S.wave + 1)
  }
}
export function startWave(n: number) {
  S.wave = n
  S.queue = waveRoster(n)
  S.spawnT = 0 // first enemy spawns right away
}

// per-kind base stats: [hp, shield, speed, mass]. kind 0 normal .. 5 boss. A shield enemy carries
// half its total as shield; a shielder has lots of hp and no shield; fast is frail+quick;
// summoner/boss are tanky+slow. MASS scales knockback resistance — a hit's shove distance is
// divided by mass, so heavier enemies barely move (boss) and light ones fly (fast).
const EKIND: [number, number, number, number][] = [
  [12, 0, ESPEED, 1],       // 0 normal
  [12, 6, ESPEED, 1.5],     // 1 shield (12 base hp + a 6 shield; heavier with its shield)
  [40, 0, ESPEED * .4, 3],  // 2 shielder (high hp)
  [2, 0, ESPEED * 2.2, .5], // 3 fast (light — flies far when hit)
  [16, 0, ESPEED * .5, 3],  // 4 summoner
  [240, 0, ESPEED * .5, 7], // 5 boss (barely shoved)
]
// TODO: tweak me
// kind, starting from wave, base count, per wave increment
// kinds: 0 normal, 1 shield, 2 shielder, 3 fast(swarm), 4 summoner, 5 boss.
const WAVES: [number, number, number, number][] = [
  [0, 1, 3, .6],   // normals — the staple, always present, grows steadily
  [3, 2, 1, .5],   // fast swarms from wave 2 (each spawns 4)
  [1, 4, 1, .35],  // shielded from wave 4
  [2, 6, 1, .2],   // shielders from wave 6
  [4, 9, 1, .15],  // summoners from wave 9
  [5, 12, 1, .1],  // bosses from wave 12 (rare, slow ramp)
]
// build the list of enemy kinds to spawn for wave `n` (n >= 1), from the WAVES table.
function waveRoster(n: number): number[] {
  const out: number[] = []
  for (const [k, from, base, per] of WAVES)
    if (n >= from) for (let i = (base + (n - from) * per) | 0; i-- > 0;) out.push(k)
  return out
}
// spawn an enemy of kind `k` at a random point on the ring (or at x,y if given, e.g. summons).
export function spawnEnemy(k = 0, x?: number, y?: number) {
  const [hp, sh, spd] = EKIND[k]
  if (x == null) { const a = rnd() * Math.PI * 2; x = SPAWN.x + Math.cos(a) * 500; y = SPAWN.y + Math.sin(a) * 500 }
  const swarm = k === 3 ? 4 : 1 // fast enemies come in swarms
  for (let i = 0; i < swarm; i++)
    S.enemies.push({ x: x + (i ? (rnd() - .5) * 30 : 0), y: y! + (i ? (rnd() - .5) * 30 : 0),
      hp, hp0: hp, sh, sh0: sh, k, spd, spin: (k === 3 ? 0 : 1) * (rnd() < .5 ? -1 : 1) }) // random CW/CCW
}

// dev: fire a colored energy pulse from (x,y) toward a building that accepts this color.
// Prefers the nearest upgrading tower (so orbs reliably land during testing); otherwise the
// nearest accepting building. Searches a generous radius; does nothing if none in range.
export function devPulse(x: number, y: number, col: number) {
  const from = { x, y }
  const R2 = 120 * 120 // generous dev search radius
  const d2 = (o: Building) => (o.x - x) ** 2 + (o.y - y) ** 2
  const pick = (pred: (o: Building) => boolean) => {
    let best: Building | null = null, bd = R2
    for (const o of S.buildings) { const dd = d2(o); if (dd < bd && pred(o)) { bd = dd; best = o } }
    return best
  }
  const target = pick(towerRoom) || pick((o) => !!accepts(o, col))
  if (target) hop(from, target, col)
}

// emit one released colored orb from `b` (staggered spec eject): re-home it to the nearest OTHER
// accepting building, and mark `b` as avoided so the first link it reaches routes it AWAY from
// the tower rather than straight back in. Colored energy is never lost — it circulates.
function emitOrb(b: Building, col: number) {
  if (S.buildings.includes(b)) bounceColor(b, col, b, 5) // shun the source tower for 5 hops
}

// HOLD F: eject everything the tower holds and reset it to a bare peashooter. Its absorbed
// colors are released back into the world as orbs (150ms stagger so they don't clump), and its
// stored uncolored charge bursts as particles — nothing is silently lost.
export function ejectSpec(b: Building) {
  if (!b.cols?.length) return // nothing to eject
  zzfx(...towerEjectEnergySound)
  // eject the BONUS color first (the color currently in the 2nd/bonus slot), then the weapon.
  const bi = b.cols.length > 1 ? (b.perm ? 0 : 1) : 0
  S.emits.push([0, b, IDXCOL[b.cols.splice(bi, 1)[0]]]) // release that color as an orb
  b.perm = 0 // color set changed — reset the permutation so the remaining color is the weapon
  applyCols(b) // re-derive weapon/bonus from the shortened stack
}

// TAP (with 2 colors): swap which color is weapon vs bonus. A no-op with fewer than 2, or when
// both colors are identical (swapping would change nothing).
export function cycleSpec(b: Building) {
  const cs = b.cols
  if ((cs?.length || 0) < 2 || cs![0] === cs![1]) return
  b.perm = b.perm ? 0 : 1
  applyCols(b)
}

function pickTarget(): Building | null {
  // color crystals (crystalCol set) are indestructible world fixtures — never target them
  const ts = S.buildings.filter((b) => !b.crystalCol)
  return ts.length ? ts[(rnd() * ts.length) | 0] : null
}

// pick which enemy a tower fires at, among those within `range`, by targeting `mode`:
// 0 closest (default), 1 furthest, 2 most hp, 3 least hp, 4 random. A per-mode "score" is
// derived and the max wins; distance modes negate for closest.
function pickEnemy(b: Building, range: number, mode = 0, preferShield = false): Enemy | null {
  let inR = S.enemies.filter((e) => near(b, e, range))
  if (!inR.length) return null
  // lasers prefer shielded targets (they're strong vs shields): if any shielded enemy is in
  // range, target only those; otherwise fall through to normal targeting.
  if (preferShield) { const sh = inR.filter((e) => e.sh! > 0); if (sh.length) inR = sh }
  if (mode === 4) return inR[(rnd() * inR.length) | 0] // random
  const score = (e: Enemy) => {
    const d2 = (e.x - b.x) ** 2 + (e.y - b.y) ** 2
    return mode === 1 ? d2 : mode === 2 ? e.hp : mode === 3 ? -e.hp : -d2 // furthest/most/least/closest
  }
  // HP modes (2/3) break ties RANDOMLY among all enemies sharing the extreme hp; distance
  // modes (0/1) just take the single extreme.
  const best = Math.max(...inR.map(score))
  const ties = inR.filter((e) => score(e) === best)
  return ties[(rnd() * ties.length) | 0]
}

// the enemy's current velocity (toward its target building at ESPEED), for lead-aiming.
function enemyVel(e: Enemy): [number, number] {
  const tg = e.target
  if (!tg) return [0, 0]
  const dx = tg.x - e.x, dy = tg.y - e.y, d = Math.hypot(dx, dy) || 1
  return [(dx / d) * ESPEED, (dy / d) * ESPEED]
}

// spawn one leading bullet toward enemy `e`. `dmg`/`acc`/`spread`/`spd`/`life` shape it. It
// flies straight in the aimed direction until it hits an enemy or `life` seconds pass — so
// range = spd * life. Misses aim wide. (shotgun reuses this for its pellets.)
function bullet(b: Building, e: Enemy, dmg: number, acc: number, spread: number, col: string, spd = BSPEED, life = BULLET_LIFE) {
  const [evx, evy] = enemyVel(e)
  const dist = Math.hypot(e.x - b.x, e.y - b.y)
  const t = dist / spd
  let tx = e.x + evx * t, ty = e.y + evy * t
  const hit = rnd() < acc
  const wide = hit ? spread : spread + 60 // a rolled miss adds a big offset
  tx += (rnd() - 0.5) * wide; ty += (rnd() - 0.5) * wide
  const d = Math.hypot(tx - b.x, ty - b.y) || 1
  const sh: Shot = {
    x: b.x, y: b.y, vx: (tx - b.x) / d * spd, vy: (ty - b.y) / d * spd,
    target: e, tx, ty, dmg: hit ? dmg : 0, kb: KB_BULLET, age: 0, life, col: shotCol(b, col), elem: b.bonus,
  }
  S.shots.push(sh); return sh
}

// PEASHOOTER (default, pre-upgrade): gray leading shot, always accurate.
function firePea(b: Building, e: Enemy, dmg: number) {
  playAt(basicShootSound, b.x, b.y) // quiet if off-screen
  bullet(b, e, dmg, 1, 0, '255,200,140', BSPEED * .5, BULLET_LIFE * 2).shieldMul = .25 // 50% slower (2x life keeps range); weak vs shields
}

// FLAMETHROWER (weapon 0, green): a spray of big, slow, short-lived puffs that PASS THROUGH
// enemies, damaging each once — a close-range cone of flame. (Element AoE comes in Phase 3.)
function fireCone(b: Building, e: Enemy, dmg: number) {
  playAt(coneSound, b.x, b.y) // quiet if off-screen
  for (let i = 0; i < 3; i++) {
    const s = bullet(b, e, dmg, 1, 20, '255,200,140', BSPEED * (.25 + rnd() * .1), .8) // uncolored-energy color when no element
    s.pierce = 99; s.hits = []; s.sz = 4; s.kb = 0 // pass through, drawn big, no knockback
  }
}

// MACHINE GUN (weapon 2, blue): a single fast, long-range, low-accuracy bullet.
function fireMG(b: Building, e: Enemy, dmg: number) {
  playAt(mgShootSound, b.x, b.y)
  const s = bullet(b, e, dmg, .8, 4, '255,200,140', BSPEED * 1.4, .8) // uncolored-energy color
  s.kb = KB_BULLET * .4; s.shieldMul = .25 // low knockback; weak vs shields
}

// RAILGUN (weapon 3, yellow): an INSTANT hitscan ray. It fires a straight line from the tower
// toward the target out to full range, damaging every enemy the line passes through, then draws a
// beam that fades out over time (no travelling bullet).
function fireRail(b: Building, e: Enemy, dmg: number) {
  playAt(railShootSound, b.x, b.y)
  const col = shotCol(b, '255,200,140') // uncolored-energy color when no element
  const rng = TOWER_RANGE * wepRng(b) // full targeting range (green bonus extends it too)
  const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1
  const ux = dx / d, uy = dy / d // unit direction toward the target
  const ex = b.x + ux * rng, ey = b.y + uy * rng // ray endpoint at max range
  for (const en of S.enemies) {
    // perpendicular distance from the enemy to the ray line, only if it's ahead of the tower
    const t = (en.x - b.x) * ux + (en.y - b.y) * uy
    if (t >= 0 && t <= rng && Math.hypot(en.x - b.x - ux * t, en.y - b.y - uy * t) < R.E + 4) {
      hurt(en, dmg, b.bonus); knockback(en, b.x, b.y, KB_BULLET)
    }
  }
  S.rays.push([b.x, b.y, ex, ey, 1, col])
}

// BOUNCE (weapon 4, cyan): a slow projectile that ricochets to a new nearby enemy on each hit.
function fireBounce(b: Building, e: Enemy, dmg: number) {
  playAt(bounceShootSound, b.x, b.y)
  const s = bullet(b, e, dmg, 1, 0, '255,200,140', BSPEED * .25, 1.5) // uncolored color; life 1.5 = short range
  s.bounce = 4; s.kb = KB_BULLET * .5 // 50% less knockback
}

// ROCKET spawn helper: `dmg`/`kb`/`col` shape it; `big` = long-range (faster, larger);
// `straight` = a grenade (flies straight at the target, no homing) that still explodes.
function rocket(b: Building, e: Enemy, dmg: number, kb: number, big: boolean, col: string, straight = false) {
  playAt(rocketShootSound, b.x, b.y)
  const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1
  const sp = big ? RSPEED * 1.7 : RSPEED
  S.shots.push({
    // homing rockets launch straight up then curve in; a grenade flies straight at the target.
    x: b.x, y: b.y, vx: straight ? dx / d * sp : 0, vy: straight ? dy / d * sp : -sp,
    target: e, tx: e.x, ty: e.y, rocket: true, dmg, kb, age: 0, big, col: shotCol(b, col), straight, elem: b.bonus,
  })
}

// shove an enemy away from (fx,fy) — a decaying velocity impulse (slides back over ~0.5s,
// not an instant teleport). kb is the intended total slide distance; with the KB_DECAY
// exponential falloff, an initial velocity of kb*KB_DECAY integrates to ~that distance.
function knockback(e: Enemy, fx: number, fy: number, kb: number) {
  // divide the shove by the enemy's MASS (per-kind, from EKIND) — a live shield DOUBLES it (half
  // the knockback) — so heavy/shielded enemies barely move and light ones fly.
  kb /= EKIND[e.k || 0][3] * (e.sh! > 0 ? 2 : 1)
  const dx = e.x - fx, dy = e.y - fy, d = Math.hypot(dx, dy) || 1
  e.kx = (e.kx || 0) + (dx / d) * kb * KB_DECAY
  e.ky = (e.ky || 0) + (dy / d) * kb * KB_DECAY
}

const AFFLICT = 3 // base affliction duration (seconds) a bonus status lasts after a hit
// deal `dmg` to enemy `e` and apply the firing tower's BONUS affliction (a color index, or
// undefined = none): cyan (4) slows on hit, magenta (5) applies damage-over-time.
function hurt(e: Enemy, dmg: number, bonus?: number, shieldMul = 1) {
  e.hurtT = .5 // just damaged -> immune to shielder shield-regen for 500ms
  // shield: absorbs the WHOLE hit before hp. shieldMul scales the hit vs shields: laser 1.5 (strong),
  // pea/MG bullets .25 (weak penetration), everything else 1 (normal). Damage does NOT overflow to
  // hp on the hit that breaks it; the bonus affliction is blocked while any shield remains.
  if (e.sh && e.sh > 0) {
    e.sh = Math.max(0, e.sh - dmg * shieldMul)
    return
  }
  e.hp -= dmg
  // cyan (4) slows, magenta (5) applies DoT; white (6) applies BOTH.
  if (bonus === 4 || bonus === 6) e.slowT = AFFLICT
  if (bonus === 5 || bonus === 6) e.dotT = AFFLICT
}

// weapon table, indexed by Building.weapon (0..6 = green,red,blue,yellow,cyan,magenta,white).
// rng = range multiplier of TOWER_RANGE; cd = fire cooldown (projectile weapons); dmg = damage
// per hit (projectiles) OR per SECOND (beam); tgt = targeting mode (0 closest, 1 furthest, 2
// most hp, 3 least hp, 4 random); beam = continuous laser (handled inline in stepSim, no fire);
// eng = energy cost multiplier (relative — higher = drains energy faster). PEASHOOTER (a tower
// with no weapon yet) uses PEA below.
type Weapon = { rng: number; cd: number; dmg: number; eng: number; tgt?: number; beam?: boolean; chain?: number; chainN?: number; fire?: (b: Building, e: Enemy, dmg: number) => void }
const PEA: Weapon = { rng: .75, cd: 1.05, dmg: 3, eng: 1, fire: firePea } // dmg 3 kills a 12-hp normal in 4 hits
const WEP: Weapon[] = [
  { rng: .55, cd: .2, dmg: .3, eng: .15, fire: fireCone },                        // 0 green — flamethrower (rapid, cheap, short range)
  { rng: .7, cd: .4, dmg: 15, eng: .7, tgt: 3, beam: true },                      // 1 red — laser (a full blast drains a whole CHARGE·eng)
  { rng: .6, cd: .2, dmg: 1.5, eng: .15, fire: fireMG },                           // 2 blue — machine gun (cheap, rapid, short range)
  { rng: .7, cd: 1.5, dmg: 12, eng: 3, tgt: 1, fire: fireRail },                   // 3 yellow — railgun (pierce, slow, high energy)
  { rng: .6, cd: 1.8, dmg: 6, eng: .6, fire: fireBounce },                          // 4 cyan — bouncing (cheap)
  { rng: 2, cd: 2, dmg: 5, eng: 2, tgt: 1, fire: (b, e, dmg) => rocket(b, e, dmg, KB_ROCKET * .35, true, '255,120,255') }, // 5 magenta — homing rocket
  { rng: .7, cd: .4, dmg: 10, eng: 1, tgt: 3, beam: true, chain: 60, chainN: 3 }, // 6 white — chain laser: beam walks target->nearest->nearest, up to chainN hops of chain range
]
// a tower's stats: its upgraded weapon, or the peashooter default.
const wepOf = (b: Building) => b.weapon != null ? WEP[b.weapon] : PEA
// does the tower's bonus grant effect `i`? A WHITE bonus (idx 6) grants EVERY effect at once,
// so each per-effect check is `bonus === i || bonus === 6`.
const hasB = (b: Building, i: number) => b.bonus === i || b.bonus === 6
// fire-rate factor from the bonus (BLUE = idx 2, or white): shorter cooldowns / laser downtime.
const fireRateMod = (b: Building) => hasB(b, 2) ? .5 : 1
// damage factor: a RED bonus (idx 1, or white) deals +50% damage.
const dmgMod = (b: Building) => hasB(b, 1) ? 1.5 : 1
// effective per-shot energy cost: the weapon's eng, halved by a YELLOW bonus (idx 3, or white).
const engOf = (b: Building) => wepOf(b).eng * (hasB(b, 3) ? .5 : 1)
// firing-range multiplier = the weapon's rng, +50% with a GREEN bonus (idx 0, or white). Used by
// the firing code and the render range ring, so they always agree.
export const wepRng = (b: Building) => wepOf(b).rng * (hasB(b, 0) ? 1.5 : 1)
// does this tower have enough energy to actually fire? (a beam needs enough for a brief burst,
// matching the laser start-gate below; a projectile weapon needs its full per-shot cost.) Drives
// the lit-head rendering.
export const canFireE = (b: Building) => b.e >= (wepOf(b).beam ? CHARGE / LASER_ON * engOf(b) * .3 : engOf(b))

let acc = 0 // fixed-timestep accumulator for the 1s tick
// advance the whole simulation by dt seconds.
export function stepSim(dt: number) {
  S.t += dt
  acc += dt
  while (acc >= 1) { acc -= 1; tick() }
  if (!isMenu) updateWaves(dt)

  // solars: count down each one's random emit-delay (b.cd, set in tick); when it crosses 0, emit
  // its unit and park cd at -1 so it won't re-fire until the next tick reschedules it.
  for (const b of S.buildings) if (b.t === 'S' && b.cd > 0) { b.cd -= dt; if (b.cd <= 0) { b.cd = -1; relay(b) } }

  // fire any staggered orb-releases whose delay has elapsed (see ejectSpec)
  for (const em of S.emits) em[0] -= dt
  for (const em of S.emits) if (em[0] <= 0) emitOrb(em[1], em[2])
  S.emits = S.emits.filter((em) => em[0] > 0)

  // Construction: `bp` counts down as energy arrives (one chunk per unit). When it hits 0 the
  // building is complete — clear bp (becomes solid/operational) and play the completion sound.
  for (const b of S.buildings) if (b.bp === 0) { b.bp = undefined; playAt(completeBuildingSound, b.x, b.y) }

  // ease each crystal's displayed scale toward its amt-based size. While it still has resources
  // it only shrinks down to 25% (full=1 -> nearly-empty=0.25); once fully depleted it eases to 0
  // and vanishes past the render's cutoff — so a mined-out crystal pops out at 25%, not fades to
  // a speck.
  for (const n of S.nodes) {
    const target = n.amt > 0 ? 0.25 + 0.75 * n.amt / n.cap : 0
    n.ds = (n.ds || 0) + (target - (n.ds || 0)) * Math.min(1, dt * 4)
  }

  // towers fire at enemies in range
  for (const b of S.buildings) {
    if (building(b)) continue // under construction — doesn't operate yet
    if (b.t === 'T') { // towers always fire (spec derives from absorbed colors; peashooter until then)
      const w = wepOf(b) // the tower's weapon stats (or peashooter default)
      if (w.beam) {
        // LASER (continuous beam): fires for up to LASER_ON seconds, then cools down for LASER_OFF
        // (reduced by the fire-rate bonus). Energy drains per firing tick, rated so a FULL blast
        // consumes a whole charge (CHARGE) — and it fires as long as it has any energy.
        // `cd` is the phase timer: >=0 counts UP through the firing window; on reaching LASER_ON it
        // flips to a negative cooldown that counts back UP to 0.
        const cd = b.cd || 0
        const cooling = cd < 0
        const rng = TOWER_RANGE * wepRng(b) // green bonus extends range
        // LOCK targeting for the duration of a blast: mid-blast (cd>0) keep hitting the current
        // target as long as it's alive and in range — so hp-based modes don't rapidly cycle as
        // the beam whittles the enemy down. Only re-pick when STARTING a blast or the lock is
        // lost (target died / left range).
        const locked = cd > 0 && b.fx && b.fx.hp > 0 && S.enemies.includes(b.fx) && near(b, b.fx, rng)
          ? b.fx : null
        // can fire this tick? not cooling, and either mid-blast with any energy left, OR starting a
        // fresh blast with enough for a brief burst. The old gate wanted HALF a charge to START,
        // but a blast leaves less than that behind, so the tower stranded energy and idled every
        // cycle despite having power. Gate on ~0.3s of beam drain instead — a real burst, no trickle.
        const startE = CHARGE / LASER_ON * engOf(b) * .3
        const canFire = !cooling && b.e > 0 && (cd > 0 || b.e >= startE)
        const en = canFire ? locked || pickEnemy(b, rng, w.tgt, true) : null // laser: prefer shielded
        if (en) {
          if (cd <= 0) playAt(laserSound, b.x, b.y) // fresh blast begins -> fire sound (quiet if off-screen)
          b.fx = en
          b.beamA = Math.min(1, (b.beamA || 0) + dt * 6) // ramp on
          b.e = Math.max(0, b.e - CHARGE / LASER_ON * engOf(b) * dt) // drain per tick; yellow bonus halves it
          const bd = w.dmg * dmgMod(b) * dt
          hurt(en, bd, b.bonus, 1.5) // laser is STRONG vs shields (×1.5); red bonus +50% dmg
          // CHAIN LASER (white): the beam WALKS from enemy to enemy — target -> nearest other within
          // w.chain -> nearest to THAT, etc. — up to w.chainN extra links. Each hop is half damage.
          // b.chainT records the ordered path (excluding the primary) so render draws A->B->C beams.
          if (w.chain) {
            const path: Enemy[] = [], seen = [en]
            let cur = en
            while (path.length < w.chainN!) {
              let best: Enemy | null = null, bd2 = w.chain! * w.chain!
              for (const o of S.enemies) if (!seen.includes(o)) {
                const dd = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2
                if (dd < bd2) { bd2 = dd; best = o } // nearest within jump range of the CURRENT link
              }
              if (!best) break
              hurt(best, bd * .5, b.bonus, 1.5); path.push(best); seen.push(best); cur = best
            }
            b.chainT = path
          }
          if (cd + dt >= LASER_ON) b.cd = -LASER_OFF * fireRateMod(b) // firing window over -> cool
          else b.cd = cd + dt
        } else {
          b.beamA = Math.max(0, (b.beamA || 0) - dt * 4) // fade off (cooling, empty, or no target)
          b.chainT = undefined // no chain beams while not firing
          // advance the downtime back toward 0; a not-firing hot timer bleeds off too.
          b.cd = cooling ? Math.min(0, cd + dt) : Math.max(0, cd - dt * 2)
        }
      } else {
        // projectile weapon: fire on cooldown, but only once it has banked the FULL shot cost
        // (engOf, yellow-bonus-reduced) — so a weapon like the railgun can't fire on a trickle.
        b.cd -= dt
        const eng = engOf(b)
        if (b.cd <= 0 && b.e >= eng) {
          const en = pickEnemy(b, TOWER_RANGE * wepRng(b), w.tgt) // green bonus extends range
          if (en) {
            b.e -= eng
            b.cd = w.cd * fireRateMod(b) // blue bonus shortens the cooldown (faster fire)
            w.fire!(b, en, w.dmg * dmgMod(b)) // red bonus +50% dmg
          }
        }
      }
    }
    if (b.fxt && b.fxt > 0) b.fxt -= dt
  }

  // miners: fire the laser for MINE_ON seconds, then MINE_OFF recharge; 1 energy = 2 shots.
  // The extraction rate DURING firing is (MINE_ON+MINE_OFF)/MINE_ON per sec, so a full cycle
  // averages exactly 1 resource/sec regardless of how long the beam fires.
  const MRATE = (MINE_ON + MINE_OFF) / MINE_ON
  let mining = 0 // miners actively earning THIS frame (instantaneous rate, flickers as they cycle)
  let mineSfx = 0 // audible mining sounds started this frame — capped so a big field isn't a wall of noise
  for (const b of S.buildings) {
    if (b.t !== 'M' || building(b)) continue // skip non-miners and those under construction
    if (b.mn) {
      // accrue while firing, but drain the crystal 1.5x faster so veins run out sooner. Income is
      // HALF the extraction (cycle-averages to 0.5/sec per miner); the crystal still drains at 1.5x.
      const take = Math.min(b.mn.amt / 1.5, MRATE * dt)
      b.mn.amt -= take * 1.5
      S.resource += take * .5
      mining += MRATE * .5 // this miner earns MRATE/2/sec this frame (averages 0.5/sec over the cycle)
      const mp = (b.mp || 0) + dt
      b.mp = mp
      // spawn mining sparks off the crystal, but ONLY while the beam is near full (mp in
      // the middle of the cut). Spawning during the fade-out tail would birth particles
      // that then outlive the vanished beam — the "burst after the beam is gone".
      if (mp > 0.15 && mp < MINE_ON - .3 && rnd() < dt * 30) spawnParts(b.mn.x, b.mn.y, 1, 50, '255,238,140')
      if (mp >= MINE_ON) {
        b.mn = null
        b.mp = MINE_OFF
      }
    } else {
      b.mp = (b.mp || 0) - dt
      if (b.mp <= 0 && (b.sh || b.e > 0)) {
        const n = S.nodes.find((n: ResNode) => n.amt > 0 && near(b, n, MINE_RANGE))
        if (n) {
          if (!b.sh) {
            b.e -= 1
            b.sh = 2
          }
          b.sh--
          b.mn = n
          b.mp = 0
          // miner starts a mining pulse (quiet if off-screen; silent on title). Cap at 3 audible
          // plays per frame so a big miner field doesn't stack into a wall of noise.
          if (mineSfx < 3 && playAt(mineSound, b.x, b.y)) mineSfx++ // plays on title too (25% via playAt)
        }
      }
    }
  }
  // HUD income: smooth the flickering per-frame miner count toward a ~5s rolling average so the
  // "+N/s" readout is steady instead of jumping as miners cycle mining<->recharge.
  S.rps += (mining - S.rps) * Math.min(1, dt / 5)
  killDead()

  // enemies home in on a target building, destroy on contact, then repick. A slowed enemy
  // (hit by a slow-rocket) crawls at half speed until its slowT timer runs out.
  for (const e of S.enemies) {
    // apply + decay any knockback velocity (a shove that slides out over ~0.5s)
    if (e.kx || e.ky) {
      e.x += (e.kx || 0) * dt; e.y += (e.ky || 0) * dt
      const decay = Math.max(0, 1 - dt * KB_DECAY)
      e.kx = (e.kx || 0) * decay; e.ky = (e.ky || 0) * decay
    }
    if (e.hurtT! > 0) e.hurtT! -= dt // recently-damaged shield-regen immunity timer
    // bonus afflictions: magenta DoT deals damage over time; cyan slow is applied to movement below.
    if (e.dotT && e.dotT > 0) { e.hp -= 5 * dt; e.dotT -= dt } // magenta bonus: damage over time
    // affliction ambience: while slow (cyan/4) or DoT (magenta/5) is active, emit occasional
    // particles in that bonus's color that float up and fade (tuple's 8th slot = rise flag).
    const aff = e.slowT! > 0 ? 4 : e.dotT! > 0 ? 5 : -1
    if (aff >= 0 && rnd() < dt * 8)
      S.parts.push([e.x + (rnd() - .5) * 8, e.y + (rnd() - .5) * 8, 0, 0, 1, ECOL[aff], aff === 5 ? 1 : .5, 1]) // DoT particles 2x larger
    // SHIELDER (k=2): regenerate shields on nearby normal/shield/fast enemies (granting one to
    // those that have none) up to a shield-enemy's max (EKIND[1][1]). Skips shielders/summoners/boss.
    if (e.k === 2) for (const o of S.enemies) if ((o.k! < 2 || o.k === 3) && !(o.hurtT! > 0) && near(e, o, SHIELDER_RANGE) && (o.sh || 0) < EKIND[1][1]) {
      o.sh0 = EKIND[1][1] // give it a shield capacity so the bar/tint reads
      o.sh = Math.min(EKIND[1][1], (o.sh || 0) + 1.5 * dt)
    }
    // SUMMONER (k=4): spawn a fast-enemy swarm every ~3s at its position.
    if (e.k === 4) { e.ai = (e.ai || 0) - dt; if (e.ai <= 0) { e.ai = 3; spawnEnemy(3, e.x, e.y) } }
    if (!e.target || e.target.dead || !S.buildings.includes(e.target)) e.target = pickTarget()
    const tg = e.target
    if (!tg) continue
    let spd = (e.spd || ESPEED) * (e.slowT && e.slowT > 0 ? .1 : 1) // cyan bonus: slow by 90%
    if (e.slowT) e.slowT -= dt
    // BOSS (k=5): move in bursts — advance ~1s, then pause ~1s (ai < 0 = paused phase).
    if (e.k === 5) { e.ai = ((e.ai || 0) + dt) % 2; if (e.ai > 1) spd = 0 }
    // SUMMONER (k=4): hangs back — stops advancing once fairly close to the NEAREST tower.
    if (e.k === 4 && S.buildings.some((o) => o.t === 'T' && Math.hypot(o.x - e.x, o.y - e.y) < 100)) spd = 0
    const dx = tg.x - e.x,
      dy = tg.y - e.y,
      d = Math.hypot(dx, dy) || 1
    e.x += (dx / d) * spd * dt
    e.y += (dy / d) * spd * dt
    if (e.k === 3) {
      // fast: ease toward the heading it's moving (turn the short way across the ±π wrap),
      // so a direction change tweens into the new facing instead of snapping.
      const want = Math.atan2(dy, dx)
      let df = want - (e.face ?? want)
      df -= Math.round(df / (2 * Math.PI)) * 2 * Math.PI // wrap to (-π, π]
      e.face = (e.face ?? want) + df * Math.min(1, dt * 8) // ~8 rad/s ease
    }
    // separation: push apart from any other enemy within the separation radius so they spread
    // out instead of stacking up. Push strength scales with overlap depth.
    for (const o of S.enemies) if (o !== e && !(e.k === 4 && o.k === 3)) { // summoners ignore the fast swarm they spawn
      const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy)
      const min = R.E * 4
      if (od < min && od > 0) {
        const push = (min - od) / min * ESPEED * 3 * dt // stronger the more they overlap
        e.x += (ox / od) * push; e.y += (oy / od) * push
      }
    }
    if (d < R[tg.t] + R.E) tg.dead = 1 // one hit destroys a building
  }
  // destroyed buildings explode like enemies
  for (const b of S.buildings) if (b.dead) explode(b.x, b.y)
  S.buildings = S.buildings.filter((b) => !b.dead)

  // tower projectiles (bullets & rockets). Bullets fly to a fixed aim point; rockets steer:
  // an up-first launch that eases into homing, overshooting the target before curving back.
  for (const p of S.shots) {
    p.age += dt
    const tgt = p.target && S.enemies.includes(p.target) ? p.target : null
    if (p.rocket && !p.straight) {
      // aim point: the live enemy (or last-known tx/ty). Blend from the launch-up velocity
      // into homing over ~0.5s, then add extra steering at the end so it overshoots and
      // curves back in. `age` drives the phase; steer harder as it ages.
      const ax = tgt ? tgt.x : p.tx, ay = tgt ? tgt.y : p.ty
      if (tgt) { p.tx = ax; p.ty = ay }
      const dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy) || 1
      const homing = Math.min(1, p.age / 0.5) // 0=pure launch-up, 1=fully homing
      // steer velocity toward the desired heading; stronger turn as it homes (overshoot
      // emerges from the lag between actual and desired velocity)
      const turn = 0.06 + homing * 0.14
      p.vx += ((dx / d) * RSPEED - p.vx) * turn
      p.vy += ((dy / d) * RSPEED - p.vy) * turn
      // renormalize to constant speed so it doesn't stall
      const sp = RSPEED / (Math.hypot(p.vx, p.vy) || 1)
      p.vx *= sp; p.vy *= sp
      // trail: tinted to the rocket's own color
      p.st = (p.st || 0) + dt
      if (p.st > 0.02) { p.st = 0; spawnParts(p.x, p.y, 1, 12, p.col) }
    }
    if (p.straight) { // grenade smoke trail (homing rockets trail in their own branch above)
      p.st = (p.st || 0) + dt
      if (p.st > 0.02) { p.st = 0; spawnParts(p.x, p.y, 1, 12, p.col) }
    }
    p.x += p.vx * dt; p.y += p.vy * dt
    // hit detection. A homing rocket detonates on contact with its target; a grenade/bullet hits
    // WHATEVER enemy it flies into (a piercing shot ignores enemies already in its `hits` list).
    const rocketHit = p.rocket && !p.straight && tgt && near(tgt, p, R.E + 4)
    const bulletHit = (!p.rocket || p.straight) && p.dmg
      ? S.enemies.find((e) => near(e, p, R.E + 4) && !p.hits?.includes(e)) : null
    // pierce: damage the enemy but keep flying (until pierce runs out). NOT for rockets/grenades.
    if (bulletHit && p.pierce && !p.rocket) {
      hurt(bulletHit, p.dmg, p.elem, p.shieldMul);
      knockback(bulletHit, p.x, p.y, p.kb)
      spawnParts(p.x, p.y, 4, 60, p.col)
      p.hits!.push(bulletHit)
      if (--p.pierce <= 0) p.age = 9
      continue
    }
    const spent = p.rocket
      ? (rocketHit || bulletHit || p.age > 4) // rockets/grenades: contact or time out
      : (bulletHit || p.age > p.life!) // bullets: hit anything, or expire after `life` (= range)
    if (spent) {
      if (p.rocket) {
        // explosion: one big fading particle + a burst of sparks, all in the rocket's color;
        // splash dmg + knockback to everything in the blast.
        S.parts.push([p.x, p.y, 0, 0, 1, p.col, p.big ? 7 : 5])
        spawnParts(p.x, p.y, p.big ? 14 : 10, 90, p.col)
        for (const e of S.enemies) if (near(e, p, p.big ? 44 : 34)) {
          hurt(e, p.dmg, p.elem); knockback(e, p.x, p.y, p.kb)
        }
      } else if (bulletHit) {
        // pellet/bullet connects with the enemy it struck
        hurt(bulletHit, p.dmg, p.elem, p.shieldMul);
        if (bulletHit.hp>0) playAt(basicHitSound, p.x, p.y) // quiet if off-screen
        knockback(bulletHit, p.x, p.y, p.kb)
        spawnParts(p.x, p.y, 4, 60, p.col)
        // bounce: redirect to a new nearby enemy (or a random direction if none) instead of dying
        if (p.bounce && p.bounce > 0) {
          p.bounce--
          p.dmg *= .8 // 20% less damage on each subsequent hit
          p.hits = [bulletHit] // exclude ONLY the just-hit enemy from the next hit (no twice in a row)
          const nxt = S.enemies.find((e) => e !== bulletHit && near(e, p, 90))
          const sp = Math.hypot(p.vx, p.vy)
          if (nxt) {
            const dx = nxt.x - p.x, dy = nxt.y - p.y, d = Math.hypot(dx, dy) || 1
            p.vx = dx / d * sp; p.vy = dy / d * sp
          } else {
            const a = rnd() * Math.PI * 2 // no target: fly off in a random direction
            p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp
          }
          p.life = p.age + (p.life || 0) // extend life so it survives to the next enemy (without
          continue                       // resetting age, which would snap its height back to the muzzle)
        }
      }
      p.age = 9 // mark for removal
    }
  }
  S.shots = S.shots.filter((p) => p.age < 9)
  killDead()

  // pulses travel at constant world-speed. On arrival at dst: color crystals tint the
  // energy (OR their color bit in) then relay; consumers keep it; links forward it.
  for (const p of S.pulses) {
    p.p += (dt * PSPEED) / (p.len || 1)
    if (p.p >= 1 && p.dst) {
      const d = p.dst
      const inCol = p.col
      // energy in the pulse's own color, for particle bursts when it's destroyed
      const col = inCol ? `${inCol & 4 ? 255 : 60},${inCol & 2 ? 255 : 60},${inCol & 1 ? 255 : 60}` : '255,238,140'
      // target was SOLD mid-flight (no longer in the world). Uncolored energy is lost (burst it);
      // colored energy must never be lost, so re-home it to the nearest acceptor from here.
      if (!S.buildings.includes(d)) {
        if (inCol) bounceColor(d, inCol, p.avoid, p.avoidN); else spawnParts(d.x, d.y, 8, 60, col)
        p.dst = null as never; continue
      }
      if (d.crystalCol != null) {
        // COLOR CRYSTAL: if it can add its color to this energy (its bit isn't already set) and
        // it still has charge (csz>0), recolor the energy, relay it on, and spend one size — the
        // model steps down (N->N2->N3) and the crystal is removed once drained to 0. Energy that
        // it can't recolor (already that color, or crystal spent) just relays through unchanged.
        const canColor = d.csz! > 0 && !(inCol & d.crystalCol)
        if (canColor) playAt(energyConvertSound, d.x, d.y) // energy was recolored by the crystal
        relay(d, canColor ? inCol | d.crystalCol : inCol, p.avoid, p.avoidN) // recolor only if it can; else pass through
        if (canColor && --d.csz! <= 0) S.buildings = S.buildings.filter((b) => b !== d)
        else if (canColor) d.ek = ekOf(d.csz!)
      } else if (inCol && towerRoom(d)) {
        // COLORED energy into a tower with spec room: append its color-index to the tower's
        // ordered spec and re-derive weapon/elem/bonus. The tower keeps firing throughout.
        ;(d.cols = d.cols || []).push(COLIDX[inCol])
        applyCols(d)
        spawnParts(d.x, d.y, 10, 70, col) // absorb burst in the orb's color
        playAt(towerAbsorbEnergySound, d.x, d.y)
      } else if (wants(d) && !inCol) {
        feed(d) // consumer keeps UNCOLORED energy (charge/build); colored energy is never eaten
      // otherwise it's a finished link (forward), or a miner/tower that filled up while the
      // pulse was in flight — bounce the surplus onward. finished solars are never targeted
      // (canReceive excludes them), so no type check needed.
      } else if (!building(d)) {
        // links overload: count energy passing through this second. Once a link exceeds LINK_MAX
        // it turns red (hot) and BURNS excess UNCOLORED energy — a sink so stray fuel doesn't
        // circulate forever. COLORED energy is never burned (it's precious): it always relays on,
        // overloaded or not, so it can never be lost.
        if (d.t === 'L' && !inCol && (d.load = (d.load || 0) + 1) > LINK_MAX) { spawnParts(d.x, d.y, 8, 60, col); continue }
        relay(d, inCol, p.avoid, p.avoidN) // carry color through regular links; avoid pushes ejected energy on
      }
      p.dst = null as unknown as Building // handled once
    }
  }
  S.pulses = S.pulses.filter((p) => p.p < 1)

  // particles drift outward, slow down (dt is capped so 1-dt*3 stays positive), and fade
  for (const q of S.parts) {
    const drag = 1 - dt * 3
    q[0] += q[2] * dt
    q[1] += q[3] * dt
    q[2] *= drag
    q[3] *= drag
    q[4] -= dt * 4
  }
  S.parts = S.parts.filter((q) => q[4] > 0)
  // fade railgun rays out (life 1 -> 0 over ~0.5s), then drop the dead ones
  for (const r of S.rays) r[4] -= dt * 2
  S.rays = S.rays.filter((r) => r[4] > 0)
}
