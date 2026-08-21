// Procedural, tileable dirt ground texture, generated once at startup.
// Soft large-scale blotches (radial gradients) over fine per-pixel grit. Every
// element is drawn with wrap-around copies so the tile repeats seamlessly.
import { GROUND } from './constants'

export const GTS = 512 // tile size

export function makeGround(X: CanvasRenderingContext2D): CanvasPattern {
  const GT = document.createElement('canvas')
  GT.width = GT.height = GTS
  const gx = GT.getContext('2d')!
  // base + fine brightness grit
  const img = gx.createImageData(GTS, GTS)
  const d = img.data
  for (let i = 0; i < GTS * GTS; i++) {
    const v = 1 + (Math.random() - 0.5) * 0.14
    const j = i * 4
    d[j] = GROUND[0] * v
    d[j + 1] = GROUND[1] * v
    d[j + 2] = GROUND[2] * v
    d[j + 3] = 255
  }
  gx.putImageData(img, 0, 0)
  // soft light/dark blotches for large-scale variation, tiled via wrap copies
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * GTS,
      cy = Math.random() * GTS,
      r = 100 + Math.random() * 120
    const a = 0.03 + Math.random() * 0.04
    const col = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(180,140,110,${a})`
    for (const wx of [0, GTS, -GTS])
      for (const wy of [0, GTS, -GTS]) {
        const g = gx.createRadialGradient(cx + wx, cy + wy, 0, cx + wx, cy + wy, r)
        g.addColorStop(0, col)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        gx.fillStyle = g
        gx.fillRect(cx + wx - r, cy + wy - r, r * 2, r * 2)
      }
  }
  return X.createPattern(GT, 'repeat')!
}
