import {
  BUILD,
  COST,
  LINK_RANGE,
  MAX_ZOOM,
  MIN_ZOOM,
  MINE_RANGE,
  NODE_AMT,
  R,
  TOWER_RANGE,
} from './constants'
import { canPlace, nearest, rnd, setSeed, unproject } from './core'
import { computeSun } from './lighting'
import { render } from './render'
import { inMinimap, mmToWorld } from './minimap'
import { miscSounds } from './sounds'
import { C, H, LT, resize, S, SPAWN, V } from './state'
import { cycleSpec, devPulse, ejectSpec, relay, spawnEnemy, stepSim } from './sim'
import { drawUI } from './ui'
import { playMusic, renderMusic, toggleMute, zzfx, zzfxX } from './zzfx'
import type { BType, Building, EType } from './types'

addEventListener('resize', resize)

// render the music buffers right away (pure math, no gesture needed). Playback needs a
// resumed AudioContext, so it starts on the first user gesture — buffers are ready by then.
renderMusic()

// PRISMATICA as stroke paths — one entry per letter, "|"-separated. Each letter is one or more
// comma-separated strokes; each stroke is a run of grid cells (base-15 chars 0-9a-e, cell = x+y*3
// on the 3×5 grid). A link is placed at every cell used; consecutive cells in a stroke are wired
// (route) so energy traces the drawn stroke. This one blob replaces the old FONT+WIRES pair.
const GLYPHS = 'c601576|c601576ae|012,17d,cde|2137bdc|c60428e|c63158e,678|012,17d|012,17d,cde|2139de|c63158e,678'.split('|')
export let isMenu = true // true while the title is showing (drives pre-start pulse flow)
export let trans = 0
// page-load intro: seconds since load. Held black for the first INTRO_HOLD, then the black
// fades out over the next second (see render). Purely a load-in flourish.
export let intro = 0
export const INTRO_HOLD = 0.5
function titleScreen() {
  LT.dayT = .1
  const cols = GLYPHS.length * 3 - 1
  S.ZOOM = (V.W * .9 / (cols * 2 * 18))
  // place a link at every cell of every stroke (base-15 chars 0-9a-e = grid cell x+y*3), wiring
  // consecutive cells so energy traces the stroke. Cells shared between strokes get a stacked
  // duplicate link — invisible (same spot) and harmless on the title, cheaper than deduping.
  GLYPHS.forEach((glyph, li) => {
    const strokes = glyph.split(',')
    strokes.forEach((stroke, si) => {
      let prev: Building | null = null
      for (const ch of stroke) {
        const b = parseInt(ch, 15), X = (li * 3 + (b % 3) - cols / 2) * 18, Y = (((b / 3) | 0) - 2) * 17
        const dot = mkB('L', SPAWN.x + X + Y, SPAWN.y + Y - X)
        S.buildings.push(dot)
        if (prev) prev.route = dot
        else if (stroke.length > 1 || si === 0) dot.emit = 1
        prev = dot
      }
      if (prev && stroke.length > 1) prev.drain = 1
    })
  })
  setSeed(15)
  for (let i = 0; i < 50; i++) {
    const rad = LT.patchSpacing * i ** 0.5, a = i * GOLDEN
    spawnPatch(SPAWN.x + Math.cos(a) * rad, SPAWN.y + Math.sin(a) * rad)
  }
  // ring hugging the word: 15 miners/lasers spread by EQUAL ARC LENGTH around a tight
  // world-space ellipse (long in X, short in Y). Walk the ellipse in tiny angle steps,
  // dropping a building each time the accumulated arc passes a 1/15-of-perimeter slot.
  let px = 281, py = 0, arc = 0, k = 0
  for (let a = 0; a < 7; a += .01) {
    const X = -9 + Math.cos(a) * 290, Y = Math.sin(a) * 86
    arc += Math.hypot(X - px, Y - py); px = X; py = Y
    if (arc >= 84.7 * k && k < 15) { S.buildings.push({ ...mkB('MT'[k++ % 2] as BType, SPAWN.x + X + Y, SPAWN.y + Y - X), e: 99, mp: rnd() * 1.5 }) }
  }
  setSeed(0)
}

// build a Building record with the shared defaults (energy 0, no cooldown)
const mkB = (t: BType, x: number, y: number, bp?: number): Building => ({ t, x, y, e: 0, cd: 0, bp, ry: rnd() * Math.PI  })

// in build mode with a Link or Tower selected, a click-drag lays a whole line of them
// spaced at that tool's max connect range (see onpointerup).
const lineTool = () => S.mode === 'build' && S.tool === 'L'

const VARIANTS: [EType, number][] = [['rockSmall', NODE_AMT * 0.35], ['rockMedium', NODE_AMT * 0.65], ['rockMedium', NODE_AMT * 0.65], ['rockLarge', NODE_AMT]]
const CRYSTALS = 400 // color crystals scattered across the map at world reset
// crystal model for a given remaining size (3=big N, 2=med N2, 1=small N3)
export const ekOf = (csz: number): EType => (['N3', 'N2', 'N'] as EType[])[csz - 1]
// sunflower (phyllotaxis) patch layout: patch i sits at angle i·GOLDEN and radius
// spacing·i^0.7. The i^0.7 makes successive rings spread apart with distance, so clusters
// thin out the further you get from spawn. Golden-angle rotation never self-overlaps, so
// no patch-center dedup / min-gap bookkeeping is needed. World is a fixed LT.patchN patches.
const GOLDEN = 2.399963 // radians (~137.5°)
// outer extent of the generated field — used by the minimap to frame the world.
export const worldRadius = () => LT.patchSpacing * (LT.patchN - 1) ** 0.7 + LT.patchSpread

function spawnPatch(cx: number, cy: number) {
  const r = () => (rnd() - rnd()) * LT.patchSpread
  for (let i = 0; i < LT.patchMin + ((rnd() * (LT.patchMax - LT.patchMin + 1)) | 0); i++) {
    const [k, cap] = VARIANTS[(rnd() * 4) | 0]
    const x = cx + r(), y = cy + r()
    if (S.buildings.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (R[b.t] + R[k]) ** 2)) continue
    if (S.nodes.some((n) => n.amt > 0 && (n.x - x) ** 2 + (n.y - y) ** 2 < (R[n.k] + R[k]) ** 2)) continue
    S.nodes.push({ x, y, amt: cap, cap, k, ds: 1, ry: (rnd() - 0.5) * 1.5 })
  }
}

function reset() {
  S.enemies = []; S.pulses = []; S.parts = []; S.shots = []; S.emits = []; S.resource = 70; S.t = 0
  S.wave = 0; S.queue = []; S.spawnT = 0; S.won = 0
  SPAWN.x = V.W / 2; SPAWN.y = V.Hh / 2; S.camX = SPAWN.x; S.camY = SPAWN.y
  LT.dayT = .35; 
  S.buildings = [mkB('S', SPAWN.x - 35, SPAWN.y), mkB('S', SPAWN.x + 35, SPAWN.y),
    ...[0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3; return mkB('L', SPAWN.x + Math.cos(a) * 22, SPAWN.y + Math.sin(a) * 22) })]
  S.nodes = []
  // lay color crystals on their own golden-angle spiral (like the rock field): each step turns
  // ~137.5°, so the layout is even and never clusters — and cycling color by i%3 means the three
  // colors interleave, keeping same-color crystals far apart. Radius grows with i, and SIZE grows
  // with distance: size 1 near spawn, 2 mid-field, 3 out at the rim. Each recolors up to `csz`
  // energy units, shrinking a step per use, then depletes away.
  const wr = worldRadius()
  for (let i = 0; i < CRYSTALS; i++) {
    const rad = 160 + (wr - 160) * (i / CRYSTALS) ** 0.85, a = i * GOLDEN
    const csz = Math.min(3, 1 + (rad / wr * 3 | 0)) // 1 near spawn -> 3 at the rim
    S.buildings.push({ ...mkB('L', SPAWN.x + Math.cos(a) * rad, SPAWN.y + Math.sin(a) * rad),
      crystalCol: [4, 2, 1][i % 3], csz, ek: ekOf(csz) })
  }
  // lay the sunflower: patch 0 at spawn, each next one rotated by GOLDEN and pushed out
  // by spacing·i^0.7 (rings spread with distance → clusters thin out further from spawn).
  for (let i = 0; i < LT.patchN; i++) {
    const rad = LT.patchSpacing * i ** 0.7, a = i * GOLDEN
    spawnPatch(SPAWN.x + Math.cos(a) * rad, SPAWN.y + Math.sin(a) * rad)
  }
}

// tear the game world down and rebuild the title screen (used on game over, under the black
// fade). Mirrors the fresh-load path: origin-centered camera, empty world, then titleScreen().
function toTitle() {
  S.enemies = []; S.pulses = []; S.parts = []; S.shots = []; S.emits = []; S.buildings = []; S.nodes = []
  S.sel = null; S.mode = 'select'; S.mouse = null; S.chainFrom = null
  SPAWN.x = SPAWN.y = S.camX = S.camY = 0
  // reset input state: game over can fire mid-press (selling the last building), and a stale
  // `dragging`/hold-timer would carry into the next game as a "sticky" cursor.
  dragging = didDrag = mmDrag = false; chainSrc = null
  if (towerHold != null) { clearTimeout(towerHold); towerHold = null }
  intro = 0 // replay the black fade-in (like page load) so the menu fades up from black
  isMenu = true
  titleScreen()
}

// --- input: scroll to zoom, drag to pan, click to select/place ---
// canvas backing store matches CSS pixels 1:1, so client coords are already in
// backing-store space.
const mx = (e: { clientX: number }) => e.clientX
const my = (e: { clientY: number }) => e.clientY

// scroll wheel zooms toward the cursor: zoom about the world point under the pointer so
// it stays fixed on screen (clamped to MIN_ZOOM..MAX_ZOOM).
C.onwheel = (e: WheelEvent) => {
  e.preventDefault()
  if (isMenu) return
  // zoom by the MAGNITUDE of deltaY, not just its sign, so a scroll wheel (few big deltas) and a
  // touchpad (many small deltas) cover the same total zoom for the same physical scroll. The
  // exponential (2**x) composes: N small steps == one step of their summed delta. Clamp the
  // per-event delta so a giant wheel notch can't jump too far.
  const d = Math.max(-100, Math.min(100, e.deltaY))
  const before = unproject(mx(e), my(e))
  S.ZOOM = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, S.ZOOM * 2 ** (-d * .0022)))
  const after = unproject(mx(e), my(e))
  S.camX += before.x - after.x // keep the world point under the cursor fixed
  S.camY += before.y - after.y
}

let downX = 0,
  downY = 0,
  panX = 0,
  panY = 0,
  dragging = false,
  didDrag = false,
  mmDrag = false
// double-click-and-drag to zoom: a 2nd press within DBL_MS of the last release starts a
// zoom-drag — dragging up zooms in, down zooms out, about the press point. lastUp = time of the
// last pointerup; zoomDrag = true while a zoom-drag is in progress; zoomY0 = the press's screen Y.
let lastUp = -1, zoomDrag = false, zoomY0 = 0
const DBL_MS = 150
let chainSrc: Building | null = null // link/tower the current drag started on (drag-to-chain)
let lastBuilt: { x: number; y: number } | null = null // last spot a drag-line building was placed
// pressing on an ALREADY-SELECTED tower arms this hold-timer: a long press (500ms) ejects the
// tower's spec/energy; a quick release before it fires instead cycles the color order. A drag
// cancels it (that's a pan/chain, not a press). Set in onpointerdown, cleared on move/up.
let towerHold: ReturnType<typeof setTimeout> | null = null
// place one building of the current tool if affordable and not blocked; true if placed
const tryBuild = (x: number, y: number) => {
  if (S.resource < COST[S.tool] || !canPlace(S.tool, x, y)) return false
  S.resource -= COST[S.tool]
  S.buildings.push(mkB(S.tool, x, y, BUILD[S.tool]))
  drawUI()
  return true
}
let audioOn = 0 // set after the first user gesture (needed to start music)
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return

  // first user gesture: unlock + start the music. On the title this is a click all its own
  // (return so nothing else happens — the NEXT title click starts the transition). In-game
  // (SKIPTITLE), fall through so this same click still builds/selects/pans as normal —
  // otherwise the first press per load would be silently swallowed.
  if (!audioOn) { audioOn = 1; zzfxX.resume(); playMusic(); if (isMenu) return }
  // while on the title, clicks never select/build/pan — they only kick off the start
  // transition (once).
  if (isMenu) { if (!trans) trans = 0.0001; return }
  // DOUBLE-TAP-DRAG ZOOM (touch only — desktop zooms with the scroll wheel): a 2nd press soon
  // after the last release starts a zoom-drag; the move handler zooms by vertical drag. Bail.
  if (e.pointerType === 'touch' && performance.now() - lastUp < DBL_MS) {
    zoomDrag = true; zoomY0 = my(e); downX = mx(e); downY = my(e)
    C.setPointerCapture(e.pointerId)
    return
  }
  downX = mx(e)
  downY = my(e)
  panX = S.camX
  panY = S.camY
  dragging = true
  didDrag = false
  mmDrag = MINIMAP && inMinimap(downX, downY)
  // if the press lands on an existing link, a drag re-routes it toward another link
  // (instead of panning) — see onpointerup.
  const dp = unproject(downX, downY)
  // SELL mode: tapping (or, via onpointermove, dragging over) a building demolishes it. `dragging`
  // is already set above, so a drag keeps selling; no pan/build/select happens.
  if (S.mode === 'sell') { sellAt(dp); C.setPointerCapture(e.pointerId); return }
  chainSrc = S.mode === 'select' ? nearest(dp, (b) => b.t === 'L') : null
  // press on the already-selected tower: arm the long-press eject (a quick release cycles instead)
  if (S.mode === 'select' && S.sel && S.sel.t === 'T' && S.sel.bp == null && nearest(dp, (b) => b === S.sel)) {
    const tgt = S.sel
    towerHold = setTimeout(() => { towerHold = null; ejectSpec(tgt); drawUI() }, 500)
  }
  // build-mode L/T: drop the first building of the line here; onpointermove adds more,
  // one per max-range step, as the cursor moves away.
  lastBuilt = null
  if (lineTool() && tryBuild(dp.x, dp.y)) lastBuilt = dp
  if (mmDrag) {
    const w = mmToWorld(downX, downY)
    S.camX = w.x
    S.camY = w.y
    panX = S.camX
    panY = S.camY
  }
  C.setPointerCapture(e.pointerId)
}
C.onpointermove = (e: PointerEvent) => {
  S.mouse = { x: mx(e), y: my(e) }
  // zoom-drag (from a double-click): vertical movement zooms about the original press point.
  // Drag UP (y decreasing) zooms in, DOWN zooms out. Re-baseline zoomY0 each move for a smooth
  // continuous rate.
  if (zoomDrag) {
    const dy = zoomY0 - my(e); zoomY0 = my(e)
    const before = unproject(downX, downY)
    S.ZOOM = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, S.ZOOM * (1 + dy * .01)))
    const after = unproject(downX, downY)
    S.camX += before.x - after.x; S.camY += before.y - after.y // keep the press point fixed
    return
  }
  if (!dragging) return
  // sell mode: dragging over buildings demolishes each one it passes
  if (S.mode === 'sell') { sellAt(unproject(mx(e), my(e))); return }
  if (mmDrag) {
    const w = mmToWorld(mx(e), my(e))
    S.camX = w.x
    S.camY = w.y
    return
  }
  const dx = mx(e) - downX,
    dy = my(e) - downY
  if (!didDrag && dx * dx + dy * dy > 25) { didDrag = true; if (towerHold != null) { clearTimeout(towerHold); towerHold = null } } // a drag is a pan/chain, not a long-press
  // build-mode L/T drag: place a new building every time the cursor gets a full max-range
  // step past the last one placed (loop in case it jumped several steps in one frame).
  if (didDrag && lineTool()) {
    const w = unproject(mx(e), my(e))
    // spacing: just under max connect range so neighbours reliably link
    const step = (S.tool === 'T' ? TOWER_RANGE : LINK_RANGE) * 0.9
    while (lastBuilt) {
      const ex = w.x - lastBuilt.x, ey = w.y - lastBuilt.y, d = Math.hypot(ex, ey)
      if (d < step) break
      const nx = lastBuilt.x + (ex / d) * step, ny = lastBuilt.y + (ey / d) * step
      // a failed placement (unaffordable or blocked) ends the whole drag-chain here
      if (!tryBuild(nx, ny)) { lastBuilt = null; dragging = false; break }
      lastBuilt = { x: nx, y: ny }
    }
    return
  }
  // once an on-a-link drag is moving, expose its source so render draws a preview line.
  // If the cursor reaches another link, route to it right now and continue FROM there —
  // no need to release between links.
  if (didDrag && chainSrc) {
    // first frame of the drag: clear the source's existing connection (we're re-routing it)
    if (!S.chainFrom) chainSrc.route = null
    S.chainFrom = chainSrc
    const w = unproject(mx(e), my(e))
    // only links within LINK_RANGE of the source can be chained — energy won't flow across a
    // longer gap, so a further link would just be a dead connection.
    const tgt = nearest(w, (b) => b !== chainSrc && b.t === 'L'
      && (b.x - chainSrc!.x) ** 2 + (b.y - chainSrc!.y) ** 2 <= LINK_RANGE ** 2)
    if (tgt) {
      if (tgt.route === chainSrc) tgt.route = null // can't have opposing links (A->B and B->A)
      chainSrc.route = tgt
      chainSrc = S.chainFrom = tgt // advance the routing chain to the target
      S.sel = tgt
    }
  }
  // a drag that lays a line (build-mode L/T tool) or extends a chain (started on an existing
  // L/T) does NOT pan — and neither does any drag in BUILD mode (a tool is selected to place).
  if (didDrag && S.mode !== 'build' && !chainSrc) {
    const dXmZ = dx / S.ZOOM,
      dXpZ = dy / (0.5 * S.ZOOM)
    S.camX = panX - (dXpZ + dXmZ) / 2
    S.camY = panY - (dXpZ - dXmZ) / 2
  }
}
C.onpointerup = (e: PointerEvent) => {
  if (e.button || isMenu) return // no select/build on release while the title is up
  C.releasePointerCapture?.(e.pointerId)
  const now = performance.now()
  // a zoom-drag ends here; skip normal release logic. Record lastUp either way so the NEXT press
  // can detect a double-click.
  if (zoomDrag) { zoomDrag = false; lastUp = now; return }
  lastUp = now
  dragging = false
  mmDrag = false
  S.chainFrom = null // end any preview line
  if (S.mode === 'sell') return // sell happened on down/move; nothing to do on release
  const p = unproject(mx(e), my(e))
  // the LINE tool laid its buildings live during the drag — nothing to commit on release.
  if (lineTool()) { if (!e.shiftKey) S.mode = 'select'; return }
  // BUILD mode (single-building tool): commit at the RELEASE point regardless of drag, so you can
  // press on a blocked spot, drag to a valid one, and it builds on pointer up (dropped if still
  // blocked/unaffordable). Build mode doesn't pan, so the drag is purely repositioning.
  if (S.mode === 'build') {
    if (S.resource < COST[S.tool] || !canPlace(S.tool, p.x, p.y)) return // unaffordable or blocked
    zzfx(...miscSounds[0])
    S.resource -= COST[S.tool]
    S.buildings.push(mkB(S.tool, p.x, p.y, BUILD[S.tool]))
    if (!e.shiftKey) S.mode = 'select' // hold shift to keep placing
    drawUI()
    return
  }
  // select mode: a drag (pan/chain) already did its work live; only a plain click selects.
  if (didDrag) return
  zzfx(...miscSounds[0])
  {
    // a pending tower-hold means this press was a quick CLICK on the already-selected tower
    // (the long-press eject never fired) -> cycle its color order. Consume the click either way.
    if (towerHold != null) {
      clearTimeout(towerHold); towerHold = null
      if (S.sel && S.sel.t === 'T') { cycleSpec(S.sel); drawUI() }
      return
    }
    const hit = nearest(p, () => true)
    // clicking an ALREADY-SELECTED finished link cycles its color filter: any->R->G->B->any.
    if (hit && hit === S.sel && hit.bp == null && hit.t === 'L' && !hit.crystalCol) {
      hit.filt = [4, 0, 1, , 2][hit.filt || 0] // cycle any(0)->R(4)->G(2)->B(1)->any
    }
    S.sel = hit
  }
}
C.onpointerleave = () => {
  S.mouse = null
}
// right-click: cancel build mode / deselect
C.oncontextmenu = (e: MouseEvent) => {
  e.preventDefault()
  S.mode = 'select'
  S.sel = null
  drawUI()
}

addEventListener('keydown', (e: KeyboardEvent) => {
  // 1-4 pick a build tool (S/L/M/T) and enter build mode
  const ti = '1234'.indexOf(e.key)
  if (ti >= 0) {
    S.tool = 'SLMT'[ti] as BType
    S.mode = 'build'
    S.sel = null // deselect any building when starting a build
    drawUI()
    return
  }
  // 'm': cycle the mute state (muted / music only / all sound)
  if (e.key === 'm') {
    toggleMute()
    return
  }
  // 'd': toggle sell mode (same as the HUD Sell button) — then tap/drag buildings to demolish
  if (e.key === 'd') { S.mode = S.mode === 'sell' ? 'select' : 'sell'; S.sel = null; drawUI() }
})
// sell `b`, refunding half its build cost. Color crystals are indestructible world fixtures and
// never sell. Selling a DEPLETED miner (no live crystal in range) sells EVERY depleted miner at
// once — a one-tap cleanup of spent mining sites; any other building sells just itself.
function sellBuilding(b: Building) {
  if (b.crystalCol != null) return
  const starved = (o: Building) => o.t === 'M' &&
    !S.nodes.some((n) => n.amt > 0 && (n.x - o.x) ** 2 + (n.y - o.y) ** 2 < MINE_RANGE ** 2)
  const doomed = starved(b) ? S.buildings.filter(starved) : [b]
  for (const o of doomed) S.resource += COST[o.t] / 2
  S.buildings = S.buildings.filter((o) => !doomed.includes(o))
}
// sell whatever sellable building is under world point `p` (sell-mode tap/drag). Skips crystals.
function sellAt(p: { x: number; y: number }) {
  const b = nearest(p, (o) => o.crystalCol == null)
  if (b) { sellBuilding(b); if (S.sel === b) S.sel = null; drawUI() }
}

// --- main loop ---
let last = performance.now()
let relayT = 0, enemyT = 0 // title interval timers: energy spray + enemy spawn
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  intro += dt // page-load fade-in timer (render draws black for INTRO_HOLD then fades it out)
  // game-world time scales with the HUD speed control (paused..3x); UI fades below use real dt.
  const sdt = dt * S.speed
  stepSim(sdt)
  // advance the day/night clock, but move 3x SLOWER through the daytime half (dayT .25..75, sun
  // up) so days last 3x longer while nights keep their length.
  const day = LT.dayT > .25 && LT.dayT < .75
  LT.dayT = (LT.dayT + sdt / LT.dayLen * (day ? 1 / 3 : 1)) % 1

  // interval-based (not random): spray energy through the letters every 0.25s, spawn a
  // drifting enemy for the towers every 0.8s.
  if (isMenu) {
    if ((relayT -= dt) <= 0) { relayT = .1; S.buildings.forEach((b) => b.emit && relay(b, 0)) }
    if ((enemyT -= dt) <= 0) { enemyT = .8; spawnEnemy() }
  }
  // GAME OVER: once in-game, if the player has lost every building they own (only the
  // indestructible color crystals remain), snap straight back to the title — no fade.
  if (!isMenu && !trans && !S.buildings.some((b) => b.crystalCol == null)) {
    H.innerHTML = '' // hide the toolbar/HUD
    toTitle()
  }
  // start transition fade: advance trans (1 phase per ~1.3s). Cross 1 → swap the title out for
  // the freshly-reset game under the full-black cover; render draws the fade from `trans`.
  if (trans > 0 && trans < 2) {
    const was = trans < 1
    trans = Math.min(2, trans + dt / 1.3) // ~1.3s cover (0→1) + ~1.3s reveal (1→2)
    if (was && trans >= 1) { isMenu = false; reset() }
    if (trans >= 2) trans = 0 // fade complete: idle so the next start-click can fire
  }
  computeSun(LT.dayT)
  render()
  requestAnimationFrame(loop)
}

// SKIPTITLE (injected by bundle.js): true in dev to boot straight into the game, skipping the
// title/menu. Injected as a literal so the dead branch folds away entirely in release.
declare const SKIPTITLE: boolean
if (SKIPTITLE) { isMenu = false; LT.dayT = .35; reset(); drawUI() }
else titleScreen()
requestAnimationFrame(loop)
// dev: expose reset() on window as regen() to re-run world generation from the console
// (DEV is defined false in the release build, so this is stripped by minification)
declare const DEV: boolean
declare const MINIMAP: boolean // injected by bundle.js; false => threat arrows, minimap DCE'd
if (DEV) (globalThis as any).regen = reset

// ---- dev tools (DEVTOOLS injected by bundle.js) --------------------------------------
// A single flag-gated block for in-editor debugging shortcuts. When DEVTOOLS is false the
// literal folds the branch away and the whole block is dead-code-eliminated from the build,
// so nothing here ships. Add more dev shortcuts inside this handler.
declare const DEVTOOLS: boolean
if (DEVTOOLS) {
  addEventListener('keydown', (ev: KeyboardEvent) => {
    if (!S.mouse) return
    const w = unproject(S.mouse.x, S.mouse.y)
    // 'z x c v b n': spawn enemy kind 0..5 (normal/shield/shielder/fast/summoner/boss) at cursor
    const ei = 'zxcvbn'.indexOf(ev.key)
    if (ei >= 0) spawnEnemy(ei, w.x, w.y)
    // 'q w e r t y u': fire a red/green/blue/cyan/yellow/magenta/white energy pulse at the
    // cursor. It flies to the nearest thing in range that accepts the color, else fizzles.
    const ki = 'qwertyu'.indexOf(ev.key)
    if (ki >= 0) devPulse(w.x, w.y, [4, 2, 1, 3, 6, 5, 7][ki])
  })
}
