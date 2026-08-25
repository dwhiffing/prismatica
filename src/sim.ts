// Simulation: energy routing, per-second tick, and the per-frame world update
// (towers, miners, enemies, pulses). Pure logic — no drawing.
import { CHAIN_DMG, CHAIN_RANGE, CHARGE, ENEMIES, ESPEED, LINK_MAX, LINK_RANGE, MINE_RANGE, PSPEED, R, TOWER_RANGE } from './constants'
import { near, rnd } from './core'
import { S, SPAWN, V } from './state'
import { drawUI } from './ui'
import type { Building, Pt, ResNode } from './types'

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

// spawn a pulse from `from` to `to`, carrying an energy color.
function hop(from: Pt, to: Building, col = 0) {
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  S.pulses.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, p: 0, len, dst: to, col })
}

// can building `o` receive energy of color `col`? A link forwards (or builds while under
// construction); anything else must still WANT a unit — excluding full miners/towers and
// finished solars. A link's color filter (filt) also rejects energy lacking that component.
const accepts = (o: Building, col: number) => (o.t === 'L' || wants(o)) && (!o.filt || col & o.filt)
// relay a unit onward FROM `node`, preserving its energy color.
function relay(node: Building, col = 0) {
  // forced route always wins, as long as the target is alive, in range, and can receive
  const rt = node.route
  if (rt && S.buildings.includes(rt) && accepts(rt, col) && near(node, rt, LINK_RANGE)) {
    hop(node, rt, col)
    return
  }
  // never relay back against an established directed connection: if o routes to us (o->node),
  // don't send energy the other way (node->o).
  const ns = S.buildings.filter((o) => o !== node && o.route !== node && accepts(o, col) && near(node, o, LINK_RANGE))
  if (!ns.length) return
  node.ni = ((node.ni || 0) + 1) % ns.length
  hop(node, ns[node.ni], col)
}

const validChain = (a: Building) =>
  a.chain && S.buildings.includes(a.chain) && !building(a.chain) && near(a, a.chain, TOWER_RANGE)
    ? a.chain
    : null
export const chainHead = (t: Building): Building => {
  let head = t, g = 0
  for (;;) {
    const prev = S.buildings.find((o) => o.t === 'T' && o.chain === head && S.buildings.includes(o))
    if (!prev || ++g > 99) break
    head = prev
  }
  return head
}
export const towerChainLen = (t: Building): number => {
  let n = 1, cur: Building | null = chainHead(t), g = 0
  while (cur && cur.chain && S.buildings.includes(cur.chain) && ++g < 99) { n++; cur = cur.chain }
  return n
}

// per-second tick: emit energy, advance the threat level, spawn enemies far from spawn.
// Threat level = minutes elapsed (0 at start). During level L, exactly L enemies spawn,
// spread evenly across that minute (nothing spawns at level 0).
function tick() {
  for (const b of S.buildings) b.load = 0 // reset per-second link throughput counters
  // every finished solar emits a unit into a neighbour (cycled round-robin)
  for (const b of S.buildings) if (b.t === 'S' && !building(b)) relay(b)
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
  // color crystals (crystalCol set) are indestructible world fixtures — never target them
  const ts = S.buildings.filter((b) => !b.crystalCol)
  return ts.length ? ts[(rnd() * ts.length) | 0] : null
}

let acc = 0 // fixed-timestep accumulator for the 1s tick
// advance the whole simulation by dt seconds.
export function stepSim(dt: number) {
  S.t += dt
  acc += dt
  while (acc >= 1) { acc -= 1; tick() }

  // Construction: `bp` counts down as energy arrives (one chunk per unit). When it
  // hits 0 the building is complete — clear bp so it becomes solid and operational.
  for (const b of S.buildings) if (b.bp === 0) {
    b.bp = undefined
    // a rush-built target: undo the temporary reroutes that fed it, then clear the flag
    if (b.rush) { for (const o of S.buildings) if (o.route === b) o.route = null; b.rush = false }
  }

  // ease each crystal's displayed scale toward its amt-based size (shrinks to 0)
  for (const n of S.nodes) {
    const target = n.amt / n.cap // shrink toward 0 as it depletes
    n.ds = (n.ds || 0) + (target - (n.ds || 0)) * Math.min(1, dt * 4)
  }

  // towers fire at enemies in range
  for (const b of S.buildings) {
    if (building(b)) continue // under construction — doesn't operate yet
    if (b.t === 'T') {
      b.cd -= dt
      // only the chain head fires; solo towers (chain of 1) fire normally
      if (b.cd <= 0 && b.e > 0 && !S.buildings.some((o) => o.t === 'T' && !building(o) && validChain(o) === b)) {
        const len = towerChainLen(b)
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
      const mp = (b.mp || 0) + dt
      b.mp = mp
      // spawn mining sparks off the crystal, but ONLY while the beam is near full (mp in
      // the middle of the cut). Spawning during the fade-out tail would birth particles
      // that then outlive the vanished beam — the "burst after the beam is gone".
      if (mp > 0.15 && mp < 0.7 && rnd() < dt * 30) spawnParts(b.mn.x, b.mn.y, 1, 50, '255,238,140')
      if (mp >= 1) {
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

  // pulses travel at constant world-speed. On arrival at dst: color crystals tint the
  // energy (OR their color bit in) then relay; consumers keep it; links forward it.
  for (const p of S.pulses) {
    p.p += (dt * PSPEED) / (p.len || 1)
    if (p.p >= 1 && p.dst) {
      const d = p.dst
      const inCol = p.col
      // energy in the pulse's own color, for particle bursts when it's destroyed
      const col = inCol ? `${inCol & 4 ? 255 : 60},${inCol & 2 ? 255 : 60},${inCol & 1 ? 255 : 60}` : '255,238,140'
      // target was SOLD mid-flight (no longer in the world): the energy is lost — burst it
      if (!S.buildings.includes(d)) { spawnParts(d.x, d.y, 8, 60, col); p.dst = null as never; continue }
      if (d.crystalCol != null) {
        // color crystal: OR in the crystal's color bit (same color twice is a no-op by OR),
        // then relay onward. Subject to the same overload cap as regular links (excess burns).
        if ((d.load = (d.load || 0) + 1) <= LINK_MAX) relay(d, inCol | d.crystalCol)
        else spawnParts(d.x, d.y, 8, 60, col)
      } else if (wants(d)) {
        feed(d) // consumer keeps it (or it builds the building)
      // otherwise it's a finished link (forward), or a miner/tower that filled up while the
      // pulse was in flight — bounce the surplus onward. finished solars are never targeted
      // (canReceive excludes them), so no type check needed.
      } else if (!building(d)) {
        // links overload: count energy passing through this second. Once a link exceeds
        // LINK_MAX it turns red (hot) and BURNS the excess instead of relaying — a sink so
        // energy that never lands doesn't circulate forever.
        // over cap: BURN it (turns red) — the lost energy bursts into particles
        if (d.t === 'L' && (d.load = (d.load || 0) + 1) > LINK_MAX) { spawnParts(d.x, d.y, 8, 60, col); continue }
        relay(d, inCol) // carry color through regular links
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
