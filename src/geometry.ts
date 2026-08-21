// Pure geometry helpers: lathe meshing, euler rotation, vector normalize, hull.
import type { Geo } from './models'
import type { Mesh, V3 } from './types'

export function norm([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

// lathe a [radius,height] profile into verts + quad faces (surface of revolution)
export function lathe(profile: [number, number][], seg: number): Mesh {
  const verts: V3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2,
      ca = Math.cos(a),
      sa = Math.sin(a)
    for (const [r, h] of profile) verts.push([r * ca, h, r * sa])
  }
  const faces: [number, number, number, number][] = []
  const P = profile.length
  for (let i = 0; i < seg; i++) {
    const ni = (i + 1) % seg
    for (let j = 0; j < P - 1; j++)
      faces.push([i * P + j, ni * P + j, ni * P + j + 1, i * P + j + 1])
  }
  return { verts, faces }
}

// cache one lathed mesh per Geo object
const meshCache = new WeakMap<object, Mesh>()
export function meshOf(geo: Geo): Mesh {
  let m = meshCache.get(geo)
  if (!m) meshCache.set(geo, (m = lathe(geo.profile, geo.seg)))
  return m
}

// rotate a point by euler (rx, ry, rz)
export function rotate(v: V3, r: V3): V3 {
  let [x, y, z] = v
  const cx = Math.cos(r[0]),
    sx = Math.sin(r[0]) // X
  ;[y, z] = [y * cx - z * sx, y * sx + z * cx]
  const cy = Math.cos(r[1]),
    sy = Math.sin(r[1]) // Y
  ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
  const cz = Math.cos(r[2]),
    sz = Math.sin(r[2]) // Z
  ;[x, y] = [x * cz - y * sz, x * sz + y * cz]
  return [x, y, z]
}

// convex hull (Andrew's monotone chain) — outer silhouette as one ring
export function hull(p: [number, number][]): [number, number][] {
  p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (ps: [number, number][]) => {
    const h: [number, number][] = []
    for (const pt of ps) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], pt) <= 0) h.pop()
      h.push(pt)
    }
    h.pop()
    return h
  }
  const lo = build(p),
    hi = build(p.slice().reverse())
  return lo.concat(hi)
}
