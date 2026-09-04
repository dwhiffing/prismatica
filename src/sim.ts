// Simulation: energy routing, per-second tick, and the per-frame world update
// (towers, miners, enemies, pulses). Pure logic — no drawing.
import { BSPEED, BULLET_LIFE, CHARGE, ENEMIES, ESPEED, KB_BULLET, KB_DECAY, KB_ROCKET, LASER_DRAIN, LASER_OFF, LASER_ON, LINK_MAX, LINK_RANGE, MINE_ON, MINE_OFF, MINE_RANGE, PSPEED, R, RSPEED, SHIELDER_RANGE, SPAWN_GAP, TOWER_RANGE, WAVE1_DELAY, WAVE_WIN } from './constants'
import { near, rnd } from './core'
import { S, SPAWN, SUN } from './state'
import { drawUI } from './ui'
import type { Building, Enemy, Pt, ResNode, Shot } from './types'
import { ekOf, isMenu } from './game'

// energy color bitmask (4=R,2=G,1=B) -> upgrade index 0..6: green,red,blue,yellow,cyan,magenta,white
const COLIDX: Record<number, number> = { 2: 0, 4: 1, 1: 2, 6: 3, 3: 4, 5: 5, 7: 6 }
// upgrade index 0..6 -> energy color bitmask (inverse of COLIDX; for releasing held orbs)
const IDXCOL = [2, 4, 1, 6, 3, 5, 7]
// the 6 orderings of 3 slots. Tapping F steps a tower's `perm` through these, re-slotting its
// absorbed colors into weapon/elem/bonus — so any of the 3! assignments is reachable.
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
// derive weapon/elem/bonus from a tower's absorbed colors, reordered by its current perm.
// Only slots that actually have a color are set; the rest clear (partial spec applies as-is).
export function applyCols(b: Building) {
  const cs = b.cols || [], o = PERMS[b.perm || 0]
  b.weapon = cs[o[0]]; b.elem = cs[o[1]]; b.bonus = cs[o[2]] // undefined where cs has no color
}
// element (0..6) -> projectile "r,g,b" tint (matches the render PIPRGB order).
const ECOL = ['68,255,102', '255,68,68', '68,136,255', '238,238,68', '68,255,255', '255,68,255', '255,255,255']
// a shot's color: the firing tower's element tint if it has one, else the weapon's default.
const shotCol = (b: Building, def: string) => b.elem != null ? ECOL[b.elem] : def

// is this building still under construction? (bp defined until the progress bar
// finishes animating — bp===0 means paid but not yet visually complete)
const building = (o: Building) => o.bp != null
// does this building want to KEEP an arriving unit? under construction (owes build
// power), a miner that has no energy queued (never stockpiles), or a tower below full
// charge. links never keep it.
const wants = (o: Building) =>
  building(o) ? (o.bp as number) > 0 : o.e < (o.t === 'T' ? CHARGE : o.t === 'M' ? 1 : 0)
// apply one unit that has arrived: build it, or store it.
function feed(o: Building) {
  if (building(o)) (o.bp as number) -= 1
  else o.e += 1
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

// a death explosion at (x,y): one big fading core particle plus a spray of debris flying out.
// Shared by dying enemies and destroyed buildings.
function explode(x: number, y: number) {
  S.parts.push([x, y, 0, 0, 1, '255,90,60', 6]) // big explosion core
  spawnParts(x, y, 12, 110, '255,120,60')       // debris flying out
}
// remove dead enemies (hp<=0), exploding each. Returns the survivors.
function killDead() {
  for (const e of S.enemies) if (e.hp <= 0) explode(e.x, e.y)
  S.enemies = S.enemies.filter((e) => e.hp > 0)
}

// spawn a pulse from `from` to `to`, carrying an energy color. `avoid` (a building the next relay
// must NOT deliver back to) rides along one hop — used to push just-ejected energy away.
function hop(from: Pt, to: Building, col = 0, avoid?: Building) {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  S.pulses.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, p: 0, len, dst: to, col, avoid })
}

// does a tower still have room to absorb a colored energy unit (fewer than 3 specced)? Must be
// FINISHED — an under-construction tower can't take colors (it still owes uncolored build energy).
const towerRoom = (o: Building) => o.t === 'T' && !building(o) && (o.cols?.length || 0) < 3
// can building `o` receive energy of color `col`? A link forwards (or builds while under
// construction). COLORED energy is only ever CONSUMED by a tower with spec room — and it takes
// it regardless of firing charge, so a fully-charged tower still upgrades. UNCOLORED energy
// goes to anything that WANTS a unit (excludes full miners/towers and finished solars). A
// link's color filter (filt) rejects energy lacking that component. Colored energy is never
// lost — it routes onward (relayed by links, recolored by crystals) until it finds a tower.
const accepts = (o: Building, col: number) =>
  (!o.filt || col & o.filt) &&
  (col ? o.t === 'L' || towerRoom(o) : o.t === 'L' || wants(o))
// relay a unit onward FROM `node`, preserving its energy color. `avoid` (if given) is excluded
// from every candidate — used so just-ejected energy at its first link never routes back to the
// tower that released it.
export function relay(node: Building, col = 0, avoid?: Building) {
  if (node.drain) return // title drain node: energy arrives and is consumed, never forwarded
  const ok = (o: Building) => o !== node && o !== avoid && accepts(o, col) && near(node, o, LINK_RANGE)
  // PRIORITY: an in-range consumer that actually NEEDS this unit (under construction, or a
  // miner/tower below charge — anything non-link that accepts + keeps it) wins over the forced
  // route. A `route` steers surplus energy, but a building waiting to be built or powered should
  // never be starved just because this link is aimed elsewhere.
  const needy = S.buildings.filter((o) => o.t !== 'L' && ok(o))
  if (needy.length) { node.ni = ((node.ni || 0) + 1) % needy.length; hop(node, needy[node.ni], col); return }
  // forced route next, as long as the target is alive, in range, can receive, and isn't avoided
  const rt = node.route
  if (rt && rt !== avoid && S.buildings.includes(rt) && accepts(rt, col) && near(node, rt, LINK_RANGE)) {
    hop(node, rt, col)
    return
  }
  // never relay back against an established directed connection: if o routes to us (o->node),
  // don't send energy the other way (node->o).
  const ns = S.buildings.filter((o) => o.route !== node && ok(o))
  if (ns.length) { node.ni = ((node.ni || 0) + 1) % ns.length; hop(node, ns[node.ni], col); return }
  // dead end. UNCOLORED energy just stops (it's cheap fuel). COLORED energy is precious and must
  // never be lost, so bounce it to the nearest acceptor anywhere — even back the way it came, even
  // out of range — so it keeps circulating until something consumes it.
  if (col) bounceColor(node, col, avoid)
}
// last-resort re-home for colored energy with no in-range forward target: hop it to the nearest
// building (any range, ignoring directed-connection rules) that can still accept this color.
// `avoid` is excluded (and rides one more hop, so the first LINK the orb reaches sends it away).
function bounceColor(from: Building, col: number, avoid?: Building) {
  let best: Building | null = null, bd = Infinity
  for (const o of S.buildings) {
    if (o === from || o === avoid) continue
    const dd = (o.x - from.x) ** 2 + (o.y - from.y) ** 2
    if (dd < bd && accepts(o, col)) { bd = dd; best = o }
  }
  if (best) hop(from, best, col, avoid) // else: no acceptor exists anywhere — nothing we can do
}


// per-second tick: reset link counters + emit solar energy (daylight only). Wave spawning
// runs per-frame in stepSim (see updateWaves), not here.
function tick() {
  for (const b of S.buildings) b.load = 0 // reset per-second link throughput counters
  // every finished solar emits a unit into a neighbour (cycled round-robin) — but only in
  // daylight: solars are photovoltaic, so they go dark when the sun is below the horizon.
  if (SUN.up > 0) for (const b of S.buildings) if (b.t === 'S' && !building(b)) relay(b)
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
function startWave(n: number) {
  S.wave = n
  S.queue = waveRoster(n)
  S.spawnT = 0 // first enemy spawns right away
}

// per-kind base stats: [hp, shield, speed]. kind 0 normal .. 5 boss. A shield enemy carries
// half its total as shield; a shielder has lots of hp and no shield; fast is frail+quick;
// summoner/boss are tanky+slow.
const EKIND: [number, number, number][] = [
  [6, 0, ESPEED],       // 0 normal
  [6, 6, ESPEED],       // 1 shield (normal hp, plus a shield on top)
  [20, 0, ESPEED * .4], // 2 shielder (no shield of its own, high hp; slow)
  [2, 0, ESPEED * 2.2], // 3 fast (swarm)
  [16, 0, ESPEED * .5], // 4 summoner (hangs back)
  [80, 0, ESPEED * .5], // 5 boss (huge hp, slow, pauses — see movement)
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
  if (S.buildings.includes(b)) bounceColor(b, col, b)
}

// HOLD F: eject everything the tower holds and reset it to a bare peashooter. Its absorbed
// colors are released back into the world as orbs (150ms stagger so they don't clump), and its
// stored uncolored charge bursts as particles — nothing is silently lost.
export function ejectSpec(b: Building) {
  let delay = 0
  for (const idx of b.cols || []) {
    S.emits.push([delay, b, IDXCOL[idx]])
    delay += 0.15 // 150ms stagger between released orbs
  }
  if (b.e > 0) spawnParts(b.x, b.y, 8, 60, '255,238,140') // release stored (uncolored) charge
  b.cols = []
  b.perm = 0
  b.e = 0
  applyCols(b) // clears weapon/elem/bonus
}

// TAP F (with 2+ colors): step to the next ordering that changes the weapon/elem/bonus
// arrangement. Colors always stay PACKED into the leading slots — with 2 colors they only ever
// swap between weapon+elem (slot 2 stays empty), never spilling a color into bonus. A candidate
// perm is only valid if every trailing (empty) slot maps to an empty color. Identical
// arrangements (repeat colors) are skipped; all-same colors make it a no-op.
export function cycleSpec(b: Building) {
  const cs = b.cols, n = cs?.length || 0
  if (n < 2) return
  const packed = (p: number) => PERMS[p].every((src, slot) => slot < n || src >= n) // no color past slot n-1
  const key = (p: number) => { const o = PERMS[p]; return cs![o[0]] + ',' + cs![o[1]] + ',' + cs![o[2]] }
  const start = b.perm || 0, cur = key(start)
  let np = start
  for (let i = 0; i < 5; i++) {
    np = (np + 1) % 6
    if (packed(np) && key(np) !== cur) break // valid packing + a distinct arrangement
  }
  b.perm = packed(np) ? np : start // no distinct packed perm found (e.g. all-same) — stay put
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
function pickEnemy(b: Building, range: number, mode = 0): Enemy | null {
  const inR = S.enemies.filter((e) => near(b, e, range))
  if (!inR.length) return null
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
    target: e, tx, ty, dmg: hit ? dmg : 0, kb: KB_BULLET, age: 0, life, col: shotCol(b, col), elem: b.elem,
  }
  S.shots.push(sh); return sh
}

// PEASHOOTER (default, pre-upgrade): gray leading shot, always accurate.
function firePea(b: Building, e: Enemy, dmg: number) {
  bullet(b, e, dmg, 1, 0, '200,200,200')
}

// FLAMETHROWER (weapon 0, green): a spray of big, slow, short-lived puffs that PASS THROUGH
// enemies, damaging each once — a close-range cone of flame. (Element AoE comes in Phase 3.)
function fireCone(b: Building, e: Enemy, dmg: number) {
  for (let i = 0; i < 3; i++) {
    const s = bullet(b, e, dmg, 1, 20, '120,255,120', BSPEED * (.25 + rnd() * .1), .8)
    s.pierce = 99; s.hits = []; s.sz = 4; s.kb = 0 // pass through, drawn big, no knockback
  }
}

// MACHINE GUN (weapon 2, blue): a single fast, long-range, low-accuracy bullet.
function fireMG(b: Building, e: Enemy, dmg: number) {
  bullet(b, e, dmg, .8, 4, '120,180,255', BSPEED * 1.4, .8)
}

// RAILGUN (weapon 3, yellow): a fast hitscan-like shot that PIERCES — it keeps flying and
// damages every enemy it passes through (each once, tracked in `hits`).
function fireRail(b: Building, e: Enemy, dmg: number) {
  const s = bullet(b, e, dmg, 1, 0, '238,238,120', BSPEED * 2.5, .6)
  s.pierce = 99; s.hits = []
}

// BOUNCE (weapon 4, cyan): a slow projectile that ricochets to a new nearby enemy on each hit.
function fireBounce(b: Building, e: Enemy, dmg: number) {
  bullet(b, e, dmg, 1, 0, '120,255,255', BSPEED * .5, 3).bounce = 3
}

// ROCKET spawn helper: `dmg`/`kb`/`col` shape it; `big` = long-range (faster, larger);
// `straight` = a grenade (flies straight at the target, no homing) that still explodes.
function rocket(b: Building, e: Enemy, dmg: number, kb: number, big: boolean, col: string, straight = false) {
  const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1
  const sp = big ? RSPEED * 1.7 : RSPEED
  S.shots.push({
    // homing rockets launch straight up then curve in; a grenade flies straight at the target.
    x: b.x, y: b.y, vx: straight ? dx / d * sp : 0, vy: straight ? dy / d * sp : -sp,
    target: e, tx: e.x, ty: e.y, rocket: true, dmg, kb, age: 0, big, col: shotCol(b, col), straight, elem: b.elem,
  })
}

// shove an enemy away from (fx,fy) — a decaying velocity impulse (slides back over ~0.5s,
// not an instant teleport). kb is the intended total slide distance; with the KB_DECAY
// exponential falloff, an initial velocity of kb*KB_DECAY integrates to ~that distance.
function knockback(e: Enemy, fx: number, fy: number, kb: number) {
  if (e.k === 5) kb *= .15 // boss: heavy knockback resistance (barely shoved)
  const dx = e.x - fx, dy = e.y - fy, d = Math.hypot(dx, dy) || 1
  e.kx = (e.kx || 0) + (dx / d) * kb * KB_DECAY
  e.ky = (e.ky || 0) + (dy / d) * kb * KB_DECAY
}

const AFFLICT = 3 // base affliction duration (seconds) an element status lasts after a hit
// deal `dmg` to enemy `e` and apply the tower's element (0..6, or undefined = no element).
// water (2) amplifies damage; the rest set a status timer. arcane (5) shares the damage to
// nearby arcane-affected enemies; lightning (3) restuns on hit; fire (1) kills at 10% hp.
function hurt(e: Enemy, dmg: number, elem?: number, laser?: boolean) {
  e.hurtT = .5 // just damaged -> immune to shielder shield-regen for 500ms
  if (e.wetT) dmg *= 1.1 // water: +10% damage taken
  // shield: absorbs the WHOLE hit before hp — resistant to bullets (×0.25), weak to lasers
  // (×1.5). Damage does NOT overflow to hp on the hit that breaks it; elements are blocked
  // while any shield remains.
  if (e.sh && e.sh > 0) {
    e.sh = Math.max(0, e.sh - dmg * (laser ? 1.5 : .25))
    return
  }
  e.hp -= dmg
  if (elem === 0) e.acidT = AFFLICT              // acid: damage over time (ticked in the loop)
  else if (elem === 1) e.fireT = AFFLICT         // fire: dies early + explodes (loop)
  else if (elem === 2) e.wetT = AFFLICT          // water
  else if (elem === 3) e.stunT = .3               // lightning: 300ms stun each hit
  else if (elem === 4) e.slowT = AFFLICT         // cold: slow
  else if (elem === 5) {
    e.arcT = AFFLICT                             // arcane: mark, and share this hit to neighbours
    for (const o of S.enemies) if (o !== e && o.arcT && near(o, e, 60)) o.hp -= dmg * .5
  } else if (elem === 6) e.convT = AFFLICT       // converted: flees
}

// weapon table, indexed by Building.weapon (0..6 = green,red,blue,yellow,cyan,magenta,white).
// rng = range multiplier of TOWER_RANGE; cd = fire cooldown (projectile weapons); dmg = damage
// per hit (projectiles) OR per SECOND (beam); tgt = targeting mode (0 closest, 1 furthest, 2
// most hp, 3 least hp, 4 random); beam = continuous laser (handled inline in stepSim, no fire);
// eng = energy cost multiplier (relative — higher = drains energy faster). PEASHOOTER (a tower
// with no weapon yet) uses PEA below.
type Weapon = { rng: number; cd: number; dmg: number; eng: number; tgt?: number; beam?: boolean; fire?: (b: Building, e: Enemy, dmg: number) => void }
const PEA: Weapon = { rng: 1, cd: .7, dmg: 4, eng: 1, fire: firePea }
const WEP: Weapon[] = [
  { rng: .55, cd: .15, dmg: .4, eng: .4, fire: fireCone },                           // 0 green — flamethrower (rapid, cheap, short range)
  { rng: 1.2, cd: .4, dmg: 12, eng: 1, tgt: 3, beam: true },                         // 1 red — laser (blast costs LASER_DRAIN*eng*LASER_ON = 3, ≤ CHARGE)
  { rng: 1.2, cd: .18, dmg: 2, eng: .5, fire: fireMG },                                // 2 blue — machine gun (cheap, rapid)
  { rng: 1.6, cd: .9, dmg: 6, eng: 2, tgt: 1, fire: fireRail },                      // 3 yellow — railgun (pierce, high energy)
  { rng: 1.2, cd: .8, dmg: 4, eng: .6, fire: fireBounce },                           // 4 cyan — bouncing (cheap)
  { rng: 2.5, cd: 1.3, dmg: 6, eng: 1, tgt: 1, fire: (b, e, dmg) => rocket(b, e, dmg, KB_ROCKET, true, '255,120,255') }, // 5 magenta — homing rocket
  { rng: 1.4, cd: 1, dmg: 6, eng: 1, tgt: 2, fire: (b, e, dmg) => rocket(b, e, dmg, KB_ROCKET, false, '230,230,230', true) }, // 6 white — grenade (straight, explodes)
]
// a tower's stats: its upgraded weapon, or the peashooter default.
const wepOf = (b: Building) => b.weapon != null ? WEP[b.weapon] : PEA
// fire-rate factor from the bonus (blue bonus = idx 2): shorter cooldowns / laser downtime.
// 1 = normal; <1 = faster. (Full bonus system lands in Phase 4; this hook is ready now.)
const fireRateMod = (b: Building) => b.bonus === 2 ? .5 : 1
// a tower's actual firing range = TOWER_RANGE * this (for the range ring).
export const wepRng = (b: Building) => wepOf(b).rng

let acc = 0 // fixed-timestep accumulator for the 1s tick
// advance the whole simulation by dt seconds.
export function stepSim(dt: number) {
  S.t += dt
  acc += dt
  while (acc >= 1) { acc -= 1; tick() }
  if (!isMenu) updateWaves(dt)

  // fire any staggered orb-releases whose delay has elapsed (see ejectSpec)
  for (const em of S.emits) em[0] -= dt
  for (const em of S.emits) if (em[0] <= 0) emitOrb(em[1], em[2])
  S.emits = S.emits.filter((em) => em[0] > 0)

  // Construction: `bp` counts down as energy arrives (one chunk per unit). When it
  // hits 0 the building is complete — clear bp so it becomes solid and operational.
  for (const b of S.buildings) if (b.bp === 0) b.bp = undefined

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
        // LASER (continuous beam): fires for LASER_ON seconds, then must cool down for LASER_OFF
        // seconds (reduced by the fire-rate bonus) before it can fire again. Energy is spent as a
        // single lump only WHEN A BLAST ENDS — the beam fires for free, then bills at overheat, so
        // a blast needs `blastCost` banked up front. `cd` is the phase timer: >=0 counts UP through
        // the firing window; on reaching LASER_ON it deducts the cost and flips to a negative
        // cooldown that counts back UP to 0.
        const cd = b.cd || 0
        const cooling = cd < 0
        const blastCost = LASER_DRAIN * w.eng * LASER_ON
        const rng = TOWER_RANGE * w.rng
        // LOCK targeting for the duration of a blast: mid-blast (cd>0) keep hitting the current
        // target as long as it's alive and in range — so hp-based modes don't rapidly cycle as
        // the beam whittles the enemy down. Only re-pick when STARTING a blast or the lock is
        // lost (target died / left range).
        const locked = cd > 0 && b.fx && b.fx.hp > 0 && S.enemies.includes(b.fx) && near(b, b.fx, rng)
          ? b.fx : null
        const en = cooling || (cd <= 0 && b.e < blastCost) ? null
          : locked || pickEnemy(b, rng, w.tgt)
        if (en) {
          b.fx = en
          b.beamA = Math.min(1, (b.beamA || 0) + dt * 6) // ramp on
          hurt(en, w.dmg * dt, b.elem, true) // laser damage type (weak vs shields)
          if (cd + dt >= LASER_ON) { b.e = Math.max(0, b.e - blastCost); b.cd = -LASER_OFF * fireRateMod(b) } // blast ends: pay + cool
          else b.cd = cd + dt
        } else {
          b.beamA = Math.max(0, (b.beamA || 0) - dt * 4) // fade off (cooling, empty, or no target)
          // advance the downtime back toward 0; a not-firing hot timer bleeds off too.
          b.cd = cooling ? Math.min(0, cd + dt) : Math.max(0, cd - dt * 2)
        }
      } else {
        // projectile weapon: fire on cooldown, spending energy scaled by the weapon's eng cost.
        b.cd -= dt
        if (b.cd <= 0 && b.e > 0) {
          const en = pickEnemy(b, TOWER_RANGE * w.rng, w.tgt)
          if (en) {
            b.e = Math.max(0, b.e - w.eng)
            b.cd = w.cd
            w.fire!(b, en, w.dmg)
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
  for (const b of S.buildings) {
    if (b.t !== 'M' || building(b)) continue // skip non-miners and those under construction
    if (b.mn) {
      // accrue at MRATE resource/sec while firing (cycle-averages to 1/sec), but drain the crystal
      // 3x faster so veins run out 3x sooner (income stays the same; resources are scarcer)
      const take = Math.min(b.mn.amt / 3, MRATE * dt)
      b.mn.amt -= take * 3
      S.resource += take
      mining += MRATE // this miner earns MRATE/sec this frame (averages 1/sec over the cycle)
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
    // element status ticks: decay every timer; acid deals damage over time; fire makes the
    // enemy die once below 10% hp (killDead then explodes it).
    if (e.acidT && e.acidT > 0) { e.hp -= 2 * dt; e.acidT -= dt }
    if (e.fireT && e.fireT > 0) { e.fireT -= dt; if (e.hp < (e.hp0 || 6) * .1) e.hp = 0 }
    if (e.wetT) e.wetT -= dt
    if (e.arcT) e.arcT -= dt
    // affliction ambience: while any element is active, emit occasional particles in that
    // element's color that float up and fade (tuple's 8th slot = rise flag). First active wins.
    const aff = e.acidT! > 0 ? 0 : e.fireT! > 0 ? 1 : e.wetT! > 0 ? 2 : e.stunT! > 0 ? 3
      : e.slowT! > 0 ? 4 : e.arcT! > 0 ? 5 : e.convT! > 0 ? 6 : -1
    if (aff >= 0 && rnd() < dt * 8)
      S.parts.push([e.x + (rnd() - .5) * 8, e.y + (rnd() - .5) * 8, 0, 0, 1, ECOL[aff], .5, 1])
    if (e.stunT && e.stunT > 0) { e.stunT -= dt; continue } // lightning: frozen in place this frame
    // SHIELDER (k=2): regenerate shields on nearby normal/shield enemies (granting one to
    // normals, which have none) up to a shield-enemy's max (EKIND[1][1]).
    if (e.k === 2) for (const o of S.enemies) if (o.k! < 2 && !(o.hurtT! > 0) && near(e, o, SHIELDER_RANGE) && (o.sh || 0) < EKIND[1][1]) {
      o.sh0 = EKIND[1][1] // give it a shield capacity so the bar/tint reads
      o.sh = Math.min(EKIND[1][1], (o.sh || 0) + 1.5 * dt)
    }
    // SUMMONER (k=4): spawn a fast-enemy swarm every ~3s at its position.
    if (e.k === 4) { e.ai = (e.ai || 0) - dt; if (e.ai <= 0) { e.ai = 3; spawnEnemy(3, e.x, e.y) } }
    if (!e.target || e.target.dead || !S.buildings.includes(e.target)) e.target = pickTarget()
    const tg = e.target
    if (!tg) continue
    let spd = (e.spd || ESPEED) * (e.slowT && e.slowT > 0 ? .5 : 1)
    if (e.slowT) e.slowT -= dt
    // BOSS (k=5): move in bursts — advance ~1s, then pause ~1s (ai < 0 = paused phase).
    if (e.k === 5) { e.ai = ((e.ai || 0) + dt) % 2; if (e.ai > 1) spd = 0 }
    // SUMMONER (k=4): hangs back — stops advancing once fairly close to its target.
    if (e.k === 4 && Math.hypot(tg.x - e.x, tg.y - e.y) < 200) spd = 0
    // converted (white): flee the target instead of advancing toward it.
    const dir = e.convT && e.convT > 0 ? -1 : 1
    if (e.convT) e.convT -= dt
    const dx = tg.x - e.x,
      dy = tg.y - e.y,
      d = Math.hypot(dx, dy) || 1
    e.x += (dx / d) * spd * dt * dir
    e.y += (dy / d) * spd * dt * dir
    if (e.k === 3) {
      // fast: ease toward the heading it's moving (turn the short way across the ±π wrap),
      // so a direction change tweens into the new facing instead of snapping.
      const want = Math.atan2(dy * dir, dx * dir)
      let df = want - (e.face ?? want)
      df -= Math.round(df / (2 * Math.PI)) * 2 * Math.PI // wrap to (-π, π]
      e.face = (e.face ?? want) + df * Math.min(1, dt * 8) // ~8 rad/s ease
    }
    // separation: push apart from any other enemy within the separation radius so they spread
    // out instead of stacking up. Push strength scales with overlap depth.
    for (const o of S.enemies) if (o !== e) {
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
      hurt(bulletHit, p.dmg, p.elem); knockback(bulletHit, p.x, p.y, p.kb)
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
        hurt(bulletHit, p.dmg, p.elem); knockback(bulletHit, p.x, p.y, p.kb)
        spawnParts(p.x, p.y, 4, 60, p.col)
        // bounce: redirect to a new nearby enemy instead of dying, until bounces run out
        if (p.bounce && p.bounce > 0) {
          const nxt = S.enemies.find((e) => e !== bulletHit && near(e, p, 90))
          if (nxt) {
            p.bounce--
            const dx = nxt.x - p.x, dy = nxt.y - p.y, d = Math.hypot(dx, dy) || 1
            const sp = Math.hypot(p.vx, p.vy)
            p.vx = dx / d * sp; p.vy = dy / d * sp
            p.age = 0 // reset life so it survives to the next enemy
            continue
          }
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
        if (inCol) bounceColor(d, inCol); else spawnParts(d.x, d.y, 8, 60, col)
        p.dst = null as never; continue
      }
      if (d.crystalCol != null) {
        // COLOR CRYSTAL: if it can add its color to this energy (its bit isn't already set) and
        // it still has charge (csz>0), recolor the energy, relay it on, and spend one size — the
        // model steps down (N->N2->N3) and the crystal is removed once drained to 0. Energy that
        // it can't recolor (already that color, or crystal spent) just relays through unchanged.
        const canColor = d.csz! > 0 && !(inCol & d.crystalCol)
        relay(d, canColor ? inCol | d.crystalCol : inCol, p.avoid) // recolor only if it can; else pass through
        if (canColor && --d.csz! <= 0) S.buildings = S.buildings.filter((b) => b !== d)
        else if (canColor) d.ek = ekOf(d.csz!)
      } else if (inCol && towerRoom(d)) {
        // COLORED energy into a tower with spec room: append its color-index to the tower's
        // ordered spec and re-derive weapon/elem/bonus. The tower keeps firing throughout.
        ;(d.cols = d.cols || []).push(COLIDX[inCol])
        applyCols(d)
        spawnParts(d.x, d.y, 10, 70, col) // absorb burst in the orb's color
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
        relay(d, inCol, p.avoid) // carry color through regular links; avoid pushes ejected energy on
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
}
