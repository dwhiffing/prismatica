// Corner minimap: a fixed box (bottom-left) showing crystals/buildings/enemies as dots
// plus the current camera viewport, and click-to-pan hit-testing. Self-contained so it
// can be dropped by removing the drawMinimap() call in render() and the two input hooks
// (inMinimap / mmToWorld) in game.ts.
import { ISO } from './constants'
import { worldRadius } from './game'
import { S, SPAWN, V, X } from './state'
import type { Pt } from './types'

const MM = 150, MM_M = 10
function mmRect() { return { x: MM_M, y: V.Hh - MM - MM_M, w: MM, h: MM } }
function w2i(x: number, y: number): [number, number] { return [x - y, x + y] }
function i2w(x: number, y: number): [number, number] { return [(y + x) / 2, (y - x) / 2] }
function worldBounds() {
  const [sx, sy] = w2i(SPAWN.x, SPAWN.y)
  const h = Math.SQRT2 * worldRadius() + Math.max(V.W / (2 * S.ZOOM), V.Hh / (2 * ISO * S.ZOOM))
  return { x0: sx - h, y0: sy - h, x1: sx + h, y1: sy + h }
}
function w2m(wx: number, wy: number, b: ReturnType<typeof worldBounds>, r: ReturnType<typeof mmRect>): [number, number] {
  const [ix, iy] = w2i(wx, wy)
  return [r.x + ((ix - b.x0) / (b.x1 - b.x0)) * r.w, r.y + ((iy - b.y0) / (b.y1 - b.y0)) * r.h]
}
export function mmToWorld(sx: number, sy: number): Pt {
  const r = mmRect(), b = worldBounds()
  const [wx, wy] = i2w(b.x0 + ((sx - r.x) / r.w) * (b.x1 - b.x0), b.y0 + ((sy - r.y) / r.h) * (b.y1 - b.y0))
  return { x: wx, y: wy }
}
export function inMinimap(sx: number, sy: number): boolean {
  const r = mmRect()
  return sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h
}
function drawDots(items: { x: number; y: number }[], color: string, b: ReturnType<typeof worldBounds>, r: ReturnType<typeof mmRect>) {
  X.fillStyle = color
  for (const it of items) { const [px, py] = w2m(it.x, it.y, b, r); X.fillRect(px - 1.5, py - 1.5, 3, 3) }
}
export function drawMinimap() {
  const r = mmRect(), b = worldBounds()
  X.save()
  X.globalAlpha = 0.7; X.fillStyle = '#111'; X.fillRect(r.x, r.y, r.w, r.h)
  X.globalAlpha = 1; X.strokeStyle = '#555'; X.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
  X.beginPath(); X.rect(r.x, r.y, r.w, r.h); X.clip()
  drawDots(S.nodes.filter(n => n.amt > 0), '#0ff', b, r)
  drawDots(S.buildings, '#0f0', b, r)
  drawDots(S.enemies, '#f00', b, r)
  const u = S.camX - S.camY, v = S.camX + S.camY, uh = V.W / (2 * S.ZOOM), vh = V.Hh / (2 * ISO * S.ZOOM)
  X.strokeStyle = '#fff'; X.beginPath()
  for (let i = 0; i < 4; i++) {
    const cu = u + (i === 1 || i === 2 ? uh : -uh), cv = v + (i === 2 || i === 3 ? vh : -vh)
    const [px, py] = w2m((cv + cu) / 2, (cv - cu) / 2, b, r)
    if (i === 0) X.moveTo(px, py); else X.lineTo(px, py)
  }
  X.closePath(); X.stroke(); X.restore()
}
