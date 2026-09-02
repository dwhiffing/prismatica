// Off-screen threat arrows: for every enemy not currently on screen, draw a small red
// triangle pinned to the screen edge, pointing toward it. A lightweight alternative to
// the minimap — no world/minimap coordinate transforms, no click-to-pan. Drop it by
// removing the drawThreat() call in render().
import { REVEAL } from './constants'
import { iso, near } from './core'
import { S, V, X } from './state'

declare const FOG: boolean // injected by bundle.js (see render.ts)
const M = 50 // inset from the screen edge (px)

export function drawThreat() {
  const cx = V.W / 2, cy = V.Hh / 2
  X.fillStyle = '#f00'
  for (const e of S.enemies) {
    const [sx, sy] = iso(e.x, 0, e.y)
    // on screen already? no arrow needed
    if (sx >= 0 && sx <= V.W && sy >= 0 && sy <= V.Hh) continue
    // with fog on, only warn about enemies within sight of a living building — ones lost in the
    // fog stay unknown. (FOG is a build-time literal, so this whole check DCEs when off.)
    if (FOG && !S.buildings.some((b) => b.bp == null && near(e, b, REVEAL))) continue
    // direction from screen center to the enemy; clamp the arrow tip to the edge inset
    const dx = sx - cx, dy = sy - cy
    const a = Math.atan2(dy, dx)
    // scale the center->enemy ray so it lands on the inset rectangle's border
    const s = Math.min((cx - M) / Math.abs(dx), (cy - M) / Math.abs(dy))
    const tx = cx + dx * s, ty = cy + dy * s
    // triangle pointing outward along `a`
    X.beginPath()
    X.moveTo(tx + Math.cos(a) * 9, ty + Math.sin(a) * 9)
    X.lineTo(tx + Math.cos(a + 2.5) * 7, ty + Math.sin(a + 2.5) * 7)
    X.lineTo(tx + Math.cos(a - 2.5) * 7, ty + Math.sin(a - 2.5) * 7)
    X.fill()
  }
}
