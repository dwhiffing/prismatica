// Grid — tiny base-building/defense prototype (dimetric low-poly 3D).
// Building types: solar(S), link(L), miner(M), tower(T). Plus resource nodes(N) & enemies(E).
const C = document.getElementById('c') as HTMLCanvasElement;
const X = C.getContext('2d')!;
const H = document.getElementById('h') as HTMLDivElement;
let W: number, Hh: number;
function resize() { W = C.width = innerWidth; Hh = C.height = innerHeight; }
addEventListener('resize', resize); resize();

// --- config ---
const LINK_RANGE = 120;   // solar->link and link->consumer transfer range
const MINE_RANGE = 90;    // miner -> resource node
const TOWER_RANGE = 150;  // tower -> enemy

type BType = 'S' | 'L' | 'M' | 'T';
type EType = BType | 'N' | 'E';

interface Pt { x: number; y: number; }
interface Building extends Pt {
  t: BType; e: number; hp: number; cd: number;
  fx?: Enemy | null; fxt?: number; // tower beam fx
  mn?: ResNode | null; mp?: number; sh?: number; // miner: target node, phase timer, shots left on charge
}
interface ResNode extends Pt { amt: number; }
interface Enemy extends Pt { hp: number; target: Building | null; }
interface Pulse { x: number; y: number; tx: number; ty: number; p: number; delay: number; len: number; }

const R: Record<EType, number> = { S: 14, L: 9, M: 12, T: 12, N: 16, E: 9 };
const COL: Record<EType, string> = { S: '#fd4', L: '#4cf', M: '#4f8', T: '#f66', N: '#c9f', E: '#f2a' };
const COST: Record<BType, number> = { S: 30, L: 5, M: 20, T: 25 };
const START = 70;    // enough for a generator + two miners (30 + 2*20)
const GRACE = 30;    // seconds of peace before enemies spawn
const ESPEED = 10;   // enemy speed px/s

// ============================================================
//  3D: dimetric-iso software renderer with lathed models + flat shading
// ============================================================
type V3 = [number, number, number];
type Face = { v: V3[]; c: string; d: number }; // world-space verts, color, depth key

// Camera: dimetric 2:1. World (x, y, z): x,z = ground plane, y = up (height).
const ISO = 0.5;   // vertical squash (2:1 dimetric)
const YSCALE = 0.9; // height exaggeration on screen
let ZOOM = 0.55; // shrink the projected field so the diamond fits on screen (scroll to change)
let camX = 0, camY = 0; // world-space point centered on screen
// project world (x=east, y=up, z=south) to screen
function iso(x: number, y: number, z: number): [number, number] {
  const sx = ((x - z) - (camX - camY)) * ZOOM;
  const sy = ((x + z) - (camX + camY)) * ISO * ZOOM - y * YSCALE * ZOOM;
  return [W / 2 + sx, Hh / 2 + sy];
}
// depth: larger = farther back (drawn first). farther = smaller x+z... invert.
function depth(x: number, y: number, z: number) { return (x + z) + y * 0.5; }

function norm(v: V3): V3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
// Live-tunable lighting. In production these keep their defaults; the dev server's
// Leva panel writes to window.LT to adjust them at runtime (see dev.js).
const LT = ((globalThis as any).LT ||= { dir: [-0.4, 1, 0.6], amb: 0.45, dif: 0.55 });
function shade(base: string, n: V3): string {
  const L = norm(LT.dir as V3);
  const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2]; // n·light in [-1,1]
  const b = LT.amb + LT.dif * Math.max(0, d);        // ambient + diffuse ramp
  return tint(base, b);
}
// scale a #rgb / #rrggbb hex by factor f
function tint(hex: string, f: number): string {
  let r: number, g: number, bl: number;
  if (hex.length === 4) { r = parseInt(hex[1], 16) * 17; g = parseInt(hex[2], 16) * 17; bl = parseInt(hex[3], 16) * 17; }
  else { r = parseInt(hex.slice(1, 3), 16); g = parseInt(hex.slice(3, 5), 16); bl = parseInt(hex.slice(5, 7), 16); }
  const c = (n: number) => Math.min(255, n * f) | 0;
  return `rgb(${c(r)},${c(g)},${c(bl)})`;
}

// --- lathe: profile of [radius, height] spun into a mesh of quad faces ---
type Model = { faces: [number, number, number, number][]; verts: V3[] };
function lathe(profile: [number, number][], seg: number): Model {
  const verts: V3[] = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const [r, h] of profile) verts.push([r * ca, h, r * sa]);
  }
  const faces: [number, number, number, number][] = [];
  const P = profile.length;
  for (let i = 0; i < seg; i++) {
    const ni = (i + 1) % seg;
    for (let j = 0; j < P - 1; j++) {
      faces.push([i * P + j, ni * P + j, ni * P + j + 1, i * P + j + 1]);
    }
  }
  return { verts, faces };
}

// crystal formation: [offsetX, offsetZ, scale, rotationY] per crystal in a node
const CRYSTALS: [number, number, number, number][] = [
  [0, 0, 1, 0],          // main, centered
  [-3, 3, 0.65, 0.9],    // smaller, front-left, twisted
  [3, -4, 0.5, -1.9],    // smallest, back-right, tilted the other way
];

// model profiles: [radius, height]. All radially lathed.
const MODELS: Record<EType, Model> = {
  S: lathe([[0, 0], [10, 0], [11, 4], [8, 9], [4, 13], [0, 15]], 10),        // solar dome
  L: lathe([[0, 0], [3, 0], [4, 3], [3, 12], [5, 14], [0, 15]], 6),          // link pylon
  M: lathe([[0, 0], [9, 0], [9, 5], [5, 7], [3, 9], [2, 16], [0, 18]], 8),   // miner drill
  T: lathe([[0, 0], [8, 0], [8, 6], [5, 8], [5, 18], [3, 19], [3, 22], [0, 22]], 8), // tower barrel
  N: lathe([[0,0],[3.5,0],[4.5,14.5],[0,21]], 5),                    // crystal (5-sided)
  E: lathe([[0, 0], [7, 4], [8, 8], [5, 12], [0, 14]], 7),                    // enemy blob
};

// --- state ---
let buildings: Building[] = [];
let nodes: ResNode[] = [];
let enemies: Enemy[] = [];
let pulses: Pulse[] = [];
let resource = 0;
let tool: BType = 'S';
let mode: 'select' | 'build' = 'select'; // build mode shows a placement preview
let sel: Building | null = null;         // currently selected building
let mouse: Pt | null = null;             // last cursor screen pos (for build preview)
let spawnT = 0, t = 0;

// the range a building projects (0 = none), used for rings + selection highlight
function rangeOf(t: BType) { return t === 'M' ? MINE_RANGE : t === 'T' ? TOWER_RANGE : (t === 'S' || t === 'L') ? LINK_RANGE : 0; }

const SPAWN: Pt = { x: 0, y: 0 }; // player origin
function reset() {
  buildings = []; enemies = []; pulses = []; resource = START; t = 0; spawnT = 0;
  SPAWN.x = W / 2; SPAWN.y = Hh / 2;
  camX = W / 2; camY = Hh / 2;
  nodes = [];
  for (let i = 0; i < 8; i++)
    nodes.push({ x: 60 + rnd() * (W - 120), y: 60 + rnd() * (Hh - 120), amt: 500 });
}
function rnd() { return Math.random(); }
function dist2(a: Pt, b: Pt) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function near(a: Pt, b: Pt, r: number) { return dist2(a, b) < r * r; }

// --- toolbar ---
const TOOLS: [BType, string][] = [['S', 'Solar'], ['L', 'Link'], ['M', 'Miner'], ['T', 'Tower']];
function drawUI() {
  H.innerHTML =
    `<b class="${mode === 'select' ? 'a' : ''}" data-t="X">Select</b>` +
    TOOLS.map(([k, n]) =>
      `<b class="${mode === 'build' && tool === k ? 'a' : ''}" data-t="${k}">${n} $${COST[k]}</b>`).join('') +
    `<b data-t="_">Res:${resource | 0}</b>`;
}
H.onclick = (e: MouseEvent) => {
  const k = (e.target as HTMLElement).dataset.t;
  if (!k || k === '_') return;
  if (k === 'X') { mode = 'select'; }
  else if (mode === 'build' && tool === k) { mode = 'select'; } // toggle off
  else { tool = k as BType; mode = 'build'; sel = null; }
  drawUI();
};
drawUI();

// screen click -> ground world coords. We keep gameplay in the old x/y plane,
// so we invert the iso projection to get placement on the ground.
function unproject(mx: number, my: number): Pt {
  // invert iso at ground (y=0):
  //   sxScreen = ((x-z) - (camX-camY)) * ZOOM
  //   syScreen = ((x+z) - (camX+camY)) * ISO * ZOOM
  const xmz = (mx - W / 2) / ZOOM + (camX - camY);   // x - z
  const xz = (my - Hh / 2) / (ISO * ZOOM) + (camX + camY); // x + z
  const x = (xz + xmz) / 2, z = (xz - xmz) / 2;
  return { x, y: z };
}

// scroll to zoom, keeping the world point under the cursor fixed
C.onwheel = (e: WheelEvent) => {
  e.preventDefault();
  const before = unproject(e.clientX, e.clientY);
  ZOOM = Math.min(4, Math.max(0.1, ZOOM * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  const after = unproject(e.clientX, e.clientY);
  camX += before.x - after.x;    // recenter so cursor stays over the same world point
  camY += before.y - after.y;
};

// --- pointer: drag to pan, click to select (select mode) or place (build mode) ---
let downX = 0, downY = 0, panX = 0, panY = 0, dragging = false, didDrag = false;
C.onpointerdown = (e: PointerEvent) => {
  if (e.button) return; // ignore non-primary buttons (right-click handled separately)
  downX = e.clientX; downY = e.clientY;
  panX = camX; panY = camY; dragging = true; didDrag = false;
  C.setPointerCapture(e.pointerId);
};
C.onpointermove = (e: PointerEvent) => {
  mouse = { x: e.clientX, y: e.clientY };
  if (!dragging) return;
  const dx = e.clientX - downX, dy = e.clientY - downY;
  if (!didDrag && dx * dx + dy * dy > 25) didDrag = true; // 5px threshold
  if (didDrag) {
    // pan: map the screen delta since press to a world-space camera shift.
    // from iso: sx=((x-z)-(camX-camY))*ZOOM ; sy=((x+z)-(camX+camY))*ISO*ZOOM
    // so d(x-z)=dx/ZOOM, d(x+z)=dy/(ISO*ZOOM); camX-camY and camX+camY shift by the same.
    const dXmZ = dx / ZOOM, dXpZ = dy / (ISO * ZOOM);
    camX = panX - (dXpZ + dXmZ) / 2;
    camY = panY - (dXpZ - dXmZ) / 2;
  }
};
C.onpointerup = (e: PointerEvent) => {
  if (e.button) return; // right/middle release handled elsewhere
  dragging = false;
  C.releasePointerCapture?.(e.pointerId);
  if (didDrag) return; // it was a pan, not a click
  const p = unproject(e.clientX, e.clientY);
  if (mode === 'build') {
    if (resource < COST[tool]) return;
    resource -= COST[tool];
    buildings.push({ t: tool, x: p.x, y: p.y, e: 0, hp: 20, cd: 0 });
    if (!e.shiftKey) mode = 'select'; // hold shift to keep placing
    drawUI();
  } else {
    // select nearest building within a small pick radius
    let best: Building | null = null, bd = 24 * 24;
    for (const b of buildings) { const d = dist2(b, p); if (d < bd) { bd = d; best = b; } }
    sel = best;
  }
};
C.onpointerleave = () => { mouse = null; };
// right-click: cancel build mode / deselect, back to plain select mode
C.oncontextmenu = (e: MouseEvent) => {
  e.preventDefault();
  mode = 'select'; sel = null; drawUI();
};

// --- energy routing ---
// Links don't store energy: a unit arriving at a link is immediately forwarded.
// It seeks the nearest consumer (miner/tower) that needs power; failing that it
// bounces to the nearest other link, hopping until it lands on a consumer or dies.
const MAXHOPS = 12;      // give up after this many link bounces (prevents infinite loops)
const PSPEED = 200;      // energy pulse travel speed, world-units/sec (constant across hops)

// spawn a pulse hop and return the time (s) it takes to travel, so the next hop
// can be delayed to start exactly when this one arrives (constant-speed chain).
function hop(from: Pt, to: Pt, startT: number): number {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  pulses.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, p: 0, delay: startT, len });
  return len / PSPEED;
}

// deliver one unit that is currently sitting on `from` (a link or solar).
// `startT` is when this hop should begin (seconds from now).
function deliver(from: Building, hops: number, startT: number) {
  // consumers (miner/tower) in range that still need energy
  let best: Building | null = null, bd = 1e9;
  for (const o of buildings) {
    if ((o.t === 'M' || o.t === 'T') && o.e < 1 && near(from, o, LINK_RANGE)) {
      const d = dist2(from, o); if (d < bd) { bd = d; best = o; }
    }
  }
  if (best) { best.e += 1; hop(from, best, startT); return; }

  if (hops >= MAXHOPS) return; // energy dissipates — no consumer reachable

  // no consumer here: bounce to nearest other link (may bounce back and forth
  // between two links until it finds a consumer or MAXHOPS runs out)
  let link: Building | null = null; bd = 1e9;
  for (const o of buildings) {
    if (o.t === 'L' && o !== from && near(from, o, LINK_RANGE)) {
      const d = dist2(from, o); if (d < bd) { bd = d; link = o; }
    }
  }
  if (link) { const dt = hop(from, link, startT); deliver(link, hops + 1, startT + dt); }
}

function emitEnergy() {
  // each solar emits one unit to a random nearby consumer/link, then it routes onward
  for (const b of buildings) {
    if (b.t !== 'S') continue;
    const dests = buildings.filter(o =>
      (o.t === 'L' || o.t === 'M' || o.t === 'T') && near(b, o, LINK_RANGE));
    if (!dests.length) continue;
    const to = dests[(rnd() * dests.length) | 0];
    const dt = hop(b, to, 0);            // solar -> first destination
    if (to.t === 'L') deliver(to, 1, dt); // link forwards it when the pulse arrives
    else to.e += 1;                       // consumer keeps it
  }
}

// --- per-second tick ---
function tick() {
  emitEnergy();
  if (t >= GRACE && buildings.length && ++spawnT % 4 === 0) {
    let x = 0, y = 0, tries = 0;
    do { x = rnd() * W; y = rnd() * Hh; tries++; }
    while (near({ x, y }, SPAWN, 260) && tries < 20);
    enemies.push({ x, y, hp: 6, target: null });
  }
  drawUI();
}

function pickTarget(): Building | null {
  return buildings.length ? buildings[(rnd() * buildings.length) | 0] : null;
}

// --- main loop ---
let last = performance.now(), acc = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt; t += dt;
  while (acc >= 1) { acc -= 1; tick(); }

  for (const b of buildings) {
    if (b.t === 'T') {
      b.cd -= dt;
      if (b.cd <= 0 && b.e > 0) {
        const en = enemies.find(e => near(b, e, TOWER_RANGE));
        if (en) { en.hp -= 3; b.e -= 1; b.cd = 0.4; b.fx = en; b.fxt = 0.1; }
      }
    }
    if (b.fxt && b.fxt > 0) b.fxt -= dt;
  }

  for (const b of buildings) {
    if (b.t !== 'M') continue;
    if (b.mn) {
      b.mp = (b.mp || 0) + dt;
      if (b.mp >= 0.5) {
        if (b.mn.amt > 0) { b.mn.amt -= 1; resource += 1; }
        b.mn = null; b.mp = 0.5;
      }
    } else {
      b.mp = (b.mp || 0) - dt;
      if (b.mp <= 0 && (b.sh || b.e > 0)) {
        const n = nodes.find((n: ResNode) => n.amt > 0 && near(b, n, MINE_RANGE));
        if (n) {
          if (!b.sh) { b.e -= 1; b.sh = 2; }
          b.sh--;
          b.mn = n; b.mp = 0;
        }
      }
    }
  }
  enemies = enemies.filter(e => e.hp > 0);

  for (const e of enemies) {
    if (!e.target || e.target.hp <= 0 || !buildings.includes(e.target)) e.target = pickTarget();
    const tg = e.target; if (!tg) continue;
    const dx = tg.x - e.x, dy = tg.y - e.y, d = Math.hypot(dx, dy) || 1;
    e.x += dx / d * ESPEED * dt; e.y += dy / d * ESPEED * dt;
    if (d < R[tg.t] + R.E) { tg.hp = 0; }
  }
  buildings = buildings.filter(b => b.hp > 0);

  // pulses wait out their stagger delay, then travel at constant world-speed
  for (const p of pulses) {
    if (p.delay > 0) p.delay -= dt;
    else p.p += dt * PSPEED / (p.len || 1);
  }
  pulses = pulses.filter(p => p.p < 1);

  render();
  requestAnimationFrame(loop);
}

// ---- 3D render helpers ----
// push an entity's lathed model (at ground x=gx, z=gy, scaled) as shaded faces
function meshFaces(m: Model, gx: number, gz: number, s: number, base: string, out: Face[], yoff = 0, rotY = 0) {
  const cr = Math.cos(rotY), sr = Math.sin(rotY);
  for (const f of m.faces) {
    const wv: V3[] = f.map(i => {
      const v = m.verts[i];
      const vx = v[0] * s, vz = v[2] * s; // rotate around vertical axis before placing
      return [gx + vx * cr - vz * sr, yoff + v[1] * s, gz + vx * sr + vz * cr] as V3;
    });
    // face normal (from first 3 verts)
    const ax = wv[1][0] - wv[0][0], ay = wv[1][1] - wv[0][1], az = wv[1][2] - wv[0][2];
    const bx = wv[2][0] - wv[0][0], by = wv[2][1] - wv[0][1], bz = wv[2][2] - wv[0][2];
    let n: V3 = norm([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
    // face center depth
    let cx = 0, cy = 0, cz = 0;
    for (const v of wv) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= wv.length; cy /= wv.length; cz /= wv.length;
    out.push({ v: wv, c: shade(base, n), d: depth(cx, cy, cz) });
  }
}

function fillFace(f: Face) {
  X.fillStyle = f.c; X.beginPath();
  for (let i = 0; i < f.v.length; i++) {
    const [sx, sy] = iso(f.v[i][0], f.v[i][1], f.v[i][2]);
    if (i === 0) X.moveTo(sx, sy); else X.lineTo(sx, sy);
  }
  X.closePath(); X.fill();
}

// draw a ground-plane ring (range indicator) as a projected ellipse
function groundRing(gx: number, gy: number, r: number, c: string, alpha = .1, lw = 1) {
  X.strokeStyle = c; X.globalAlpha = alpha; X.lineWidth = lw; X.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 2;
    const [sx, sy] = iso(gx + Math.cos(a) * r, 0, gy + Math.sin(a) * r);
    if (i === 0) X.moveTo(sx, sy); else X.lineTo(sx, sy);
  }
  X.stroke(); X.globalAlpha = 1; X.lineWidth = 1;
}
// project a ground point to screen (helper for lasers/pulses)
function g(gx: number, gy: number, yUp = 0): [number, number] { return iso(gx, yUp, gy); }

function render() {
  X.fillStyle = '#0a0e12'; X.fillRect(0, 0, W, Hh);

  if (sel && !buildings.includes(sel)) sel = null; // selection was destroyed

  // ground rings (drawn flat first). selected building's range is brighter.
  for (const b of buildings) {
    const r = rangeOf(b.t);
    if (r) groundRing(b.x, b.y, r, COL[b.t], b === sel ? .5 : .1, b === sel ? 2 : 1);
  }
  // white selection ring hugging the selected building's base
  if (sel) groundRing(sel.x, sel.y, R[sel.t] + 5, '#fff', .9, 2);
  // spawn marker
  groundRing(SPAWN.x, SPAWN.y, 10, '#456');

  // collect all model faces, depth-sort, paint (painter's algorithm)
  const faces: Face[] = [];
  // resource node = a formation of 3 crystals, each offset/scaled/rotated slightly
  for (const n of nodes) if (n.amt > 0) {
    const g = 0.4 + 0.6 * n.amt / 500; // overall growth from remaining amount
    for (const [dx, dz, cs, rot] of CRYSTALS)
      meshFaces(MODELS.N, n.x + dx * g, n.y + dz * g, cs * g, COL.N, faces, 0, rot);
  }
  for (const b of buildings)
    meshFaces(MODELS[b.t], b.x, b.y, 1, COL[b.t], faces);
  for (const e of enemies)
    meshFaces(MODELS.E, e.x, e.y, 1, COL.E, faces);

  faces.sort((a, b) => a.d - b.d);
  for (const f of faces) fillFace(f);

  // build-mode placement preview: translucent model + range ring under the cursor
  if (mode === 'build' && mouse) {
    const p = unproject(mouse.x, mouse.y);
    const ok = resource >= COST[tool];
    const r = rangeOf(tool);
    if (r) groundRing(p.x, p.y, r, ok ? COL[tool] : '#f44', .3, 1);
    const pf: Face[] = [];
    meshFaces(MODELS[tool], p.x, p.y, 1, ok ? COL[tool] : '#844', pf);
    pf.sort((a, b) => a.d - b.d);
    X.globalAlpha = .45;
    for (const f of pf) fillFace(f);
    X.globalAlpha = 1;
  }

  // energy pulses (small glowing dots travelling along the ground)
  X.fillStyle = '#ff8'; X.globalAlpha = .8;
  for (const p of pulses) {
    const x = p.x + (p.tx - p.x) * p.p, y = p.y + (p.ty - p.y) * p.p;
    const [sx, sy] = g(x, y, 8);
    X.beginPath(); X.arc(sx, sy, 3, 0, 7); X.fill();
  }
  X.globalAlpha = 1;

  // tower beams
  X.strokeStyle = '#f88'; X.lineWidth = 2;
  for (const b of buildings) if (b.t === 'T' && b.fxt && b.fxt > 0 && b.fx) {
    const [ax, ay] = g(b.x, b.y, 20), [bx, by] = g(b.fx.x, b.fx.y, 7);
    X.beginPath(); X.moveTo(ax, ay); X.lineTo(bx, by); X.stroke();
  }
  // miner lasers
  X.strokeStyle = COL.M;
  for (const b of buildings) if (b.t === 'M' && b.mn) {
    const [ax, ay] = g(b.x, b.y, 16), [bx, by] = g(b.mn.x, b.mn.y, 6);
    X.beginPath(); X.moveTo(ax, ay); X.lineTo(bx, by); X.stroke();
  }
  X.lineWidth = 1;

  // energy counts as small labels above buildings
  X.fillStyle = '#fff'; X.textAlign = 'center';
  for (const b of buildings) if (b.e > 0) {
    const [sx, sy] = g(b.x, b.y, 26);
    X.fillText('' + b.e, sx, sy);
  }
  X.textAlign = 'left';
}

reset();
drawUI();
requestAnimationFrame(loop);
