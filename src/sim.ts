// Simulation: energy routing, per-second tick, and the per-frame world update
// (towers, miners, enemies, pulses). Pure logic — no drawing.
import { CHAIN_DMG, CHAIN_RANGE, CHARGE, ENEMIES, ESPEED, LINK_RANGE, MINE_RANGE, PSPEED, R, TOWER_RANGE } from './constants'
import { near, rnd } from './core'
import { S, SPAWN, V } from './state'
import { drawUI } from './ui'
import type { Building, Pt, ResNode } from './types'

const HOPS = 12 // a unit of energy dissipates after this many relays without landing

// is this building still under construction? (bp defined until the progress bar
// finishes animating — bp===0 means paid but not yet visually complete)
const building = (o: Building) => o.bp !== undefined
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

// spawn a pulse from `from` to `to`, carrying a hop budget. `startT` staggers it.
function hop(from: Pt, to: Building, hb: number, startT = 0): number {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  S.pulses.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, p: 0, delay: startT, len, dst: to, hb })
  return len / PSPEED
}

// a neighbour that can receive a relayed unit: anything that keeps energy
// (consumers + under-construction buildings) or forwards it (finished links).
// excludes finished solars (they emit, never receive).
const canReceive = (o: Building) => o.t !== 'S' || building(o)
// relay a unit onward FROM `node`: cycle through its in-range neighbours (round
// robin via ni) and hop to the next one. `hb` is the remaining hop budget; energy
// dissipates at 0. `startT` staggers the pulse after the previous hop.
function relay(node: Building, hb: number, startT = 0) {
  if (hb <= 0) return
  // forced route (set via 'z') always wins, as long as the target is alive & in range
  const rt = node.route
  if (rt && S.buildings.includes(rt) && near(node, rt, LINK_RANGE)) {
    hop(node, rt, hb - 1, startT)
    return
  }
  const ns = S.buildings.filter((o) => o !== node && canReceive(o) && near(node, o, LINK_RANGE))
  if (!ns.length) return
  node.ni = ((node.ni || 0) + 1) % ns.length
  hop(node, ns[node.ni], hb - 1, startT)
}

function emitEnergy() {
  // every finished solar emits a unit into a neighbour (cycled round-robin)
  for (const b of S.buildings) if (b.t === 'S' && !building(b)) relay(b, HOPS)
}

// per-second tick: emit energy, advance the threat level, spawn enemies far from spawn.
// Threat level = minutes elapsed (0 at start). During level L, exactly L enemies spawn,
// spread evenly across that minute (nothing spawns at level 0).
function tick() {
  emitEnergy()
  const level = Math.floor(S.t / 60)
  if (level !== S.threat) {
    S.threat = level // new minute -> new level; reset this level's spawn counter
    S.spawnT = 0
  }
  if (ENEMIES && level > 0 && S.buildings.length) {
    const into = S.t - level * 60 // seconds into the current level's minute
    const due = Math.floor((into / 60) * level + 0.5) // enemies that should have spawned by now
    while (S.spawnT < due) {
      S.spawnT++
      let x = 0,
        y = 0,
        tries = 0
      do {
        x = rnd() * V.W
        y = rnd() * V.Hh
        tries++
      } while (near({ x, y }, SPAWN, 260) && tries < 20)
      S.enemies.push({ x, y, hp: 6, target: null })
    }
  }
  drawUI()
}

function pickTarget(): Building | null {
  return S.buildings.length ? S.buildings[(rnd() * S.buildings.length) | 0] : null
}

let acc = 0 // fixed-timestep accumulator for the 1s tick
// advance the whole simulation by dt seconds.
export function stepSim(dt: number) {
  S.t += dt
  acc += dt
  while (acc >= 1) {
    acc -= 1
    tick()
  }

  // Construction: `bp` counts down as energy arrives (one chunk per unit). When it
  // hits 0 the building is complete — clear bp so it becomes solid and operational.
  for (const b of S.buildings) if (b.bp === 0) b.bp = undefined

  // ease each crystal's displayed scale toward its amt-based size (shrinks to 0)
  for (const n of S.nodes) {
    const target = n.amt / n.cap // shrink toward 0 as it depletes
    n.ds = (n.ds || 0) + (target - (n.ds || 0)) * Math.min(1, dt * 4)
  }

  // laser chains: a tower is the HEAD of its chain if no other (finished, in-range)
  // tower chains INTO it. Only the head fires; its range & damage scale with the number
  // of towers in the chain (walk `chain` pointers from the head, with a cycle guard).
  const validChain = (a: Building) =>
    a.chain && S.buildings.includes(a.chain) && !building(a.chain) && near(a, a.chain, TOWER_RANGE)
      ? a.chain
      : null
  const isHead = (b: Building) =>
    !S.buildings.some((o) => o.t === 'T' && !building(o) && validChain(o) === b)
  const chainLen = (head: Building) => {
    let n = 1,
      cur: Building | null = head,
      guard = 0
    while (cur && (cur = validChain(cur)) && ++guard < 99) n++
    return n
  }

  // towers fire at enemies in range
  for (const b of S.buildings) {
    if (building(b)) continue // under construction — doesn't operate yet
    if (b.t === 'T') {
      b.cd -= dt
      // only the chain head fires; solo towers (chain of 1) fire normally
      if (b.cd <= 0 && b.e > 0 && isHead(b)) {
        const len = chainLen(b)
        const range = TOWER_RANGE * (1 + CHAIN_RANGE * (len - 1))
        const en = S.enemies.find((e) => near(b, e, range))
        if (en) {
          en.hp -= 3 + CHAIN_DMG * (len - 1)
          b.e -= 1
          b.cd = 0.4
          b.fx = en
          b.fxt = 0.1
        }
      }
    }
    if (b.fxt && b.fxt > 0) b.fxt -= dt
  }

  // miners: 1s mine (earning 1 resource/sec, granted continuously) then 0.5s recharge;
  // 1 energy = 2 shots
  S.rps = 0 // resources/sec from all currently-mining miners (for the HUD)
  for (const b of S.buildings) {
    if (b.t !== 'M' || building(b)) continue // skip non-miners and those under construction
    if (b.mn) {
      // accrue 1 resource/sec to the player, but drain the crystal 3x faster so veins
      // run out 3x sooner (income stays the same; resources are scarcer)
      const take = Math.min(b.mn.amt / 3, dt)
      b.mn.amt -= take * 3
      S.resource += take
      S.rps += 1 // this miner is actively earning 1/sec this frame
      b.mp = (b.mp || 0) + dt
      if (b.mp >= 1) {
        b.mn = null
        b.mp = 0.5
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
  S.enemies = S.enemies.filter((e) => e.hp > 0)

  // enemies home in on a target building, destroy on contact, then repick
  for (const e of S.enemies) {
    if (!e.target || e.target.hp <= 0 || !S.buildings.includes(e.target)) e.target = pickTarget()
    const tg = e.target
    if (!tg) continue
    const dx = tg.x - e.x,
      dy = tg.y - e.y,
      d = Math.hypot(dx, dy) || 1
    e.x += (dx / d) * ESPEED * dt
    e.y += (dy / d) * ESPEED * dt
    if (d < R[tg.t] + R.E) tg.hp = 0
  }
  S.buildings = S.buildings.filter((b) => b.hp > 0)

  // pulses travel at constant world-speed after their stagger delay. On arrival at
  // dst: if it wants the unit, keep it; otherwise relay onward (or dissipate).
  for (const p of S.pulses) {
    if (p.delay > 0) p.delay -= dt
    else p.p += (dt * PSPEED) / (p.len || 1)
    if (p.p >= 1 && p.dst) {
      if (wants(p.dst)) feed(p.dst) // consumer keeps it (or it builds the building)
      else if (p.dst.t === 'L' && !building(p.dst)) relay(p.dst, p.hb) // only a finished LINK forwards
      // else: a full/unwilling consumer just drops it (consumers never bounce energy on)
      p.dst = null as unknown as Building // handled once
    }
  }
  S.pulses = S.pulses.filter((p) => p.p < 1)
}
