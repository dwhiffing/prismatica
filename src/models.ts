// ============================================================
//  Entities & Splines — model data for the game.
//  This whole file is round-tripped by tools/model-editor.html.
//  An Entity is composed of 1+ Splines. Each Spline has geometry
//  (a lathe profile) + a material, placed by offset/rotation/scale.
// ============================================================
export type V3 = [number, number, number]
export type EType = 'S' | 'L' | 'M' | 'T' | 'N' | 'N2' | 'N3' | 'E'

export interface Geo { profile: [number, number][]; seg: number }
export interface Material { col: string; amb: number; dif: number }
export interface Spline {
  geo: Geo
  mat: Material
  off: V3
  rot: V3
  scl: number
}
export interface Entity { name: string; splines: Spline[] }

export const COL: Record<EType, string> = {
  S: '#fd4', L: '#4cf', M: '#4f8', T: '#f66', N: '#c9f', N2: '#c9f', N3: '#c9f', E: '#f2a',
}

const sp = (
  profile: [number, number][], seg: number, col: string,
  off: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scl = 1, amb = 0.3, dif = 0.59,
): Spline => ({ geo: { profile, seg }, mat: { col, amb, dif }, off, rot, scl })

export const ENTITIES: Record<EType, Entity> = {
  S: { name: 'solar', splines: [
    sp([[10, 2], [10, 5], [8.5, 8.5], [6.5, 11], [3.5, 12.5]], 10, '#c342ff', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[11.5, 0], [11, 2], [10, 2]], 10, '#A9A98B', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[3.5, 12.5], [3.5, 13.5], [1.5, 14.5], [0, 14.5]], 10, '#A9A98B', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
  L: { name: 'link', splines: [
    sp([[0, 1], [3, 7], [0, 14]], 12, '#fcff42', [0, 0, 0], [0, 0, 0], 1, 0.63, 1),
  ] },
  M: { name: 'miner', splines: [
    sp([[2.5, 11.5], [2, 16], [0, 18]], 8, '#4f8', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2.5, 0], [2, 12.5], [0, 14.5]], 8, '#d1d3ca', [3, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2.5, 0], [2, 12.5], [0, 14.5]], 8, '#d1d3ca', [0, 0, 3], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2.5, 0], [2, 12.5], [0, 14.5]], 8, '#d1d3ca', [0, 0, -3], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2.5, 0], [2, 12.5], [0, 14.5]], 10, '#d1d3ca', [-3, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
  T: { name: 'tower', splines: [
    sp([[0, 0], [6, 0], [2, 8], [2, 22], [0, 22]], 4, '#66bdff', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
  N: { name: 'crystal', splines: [
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [0, 0, 0], [0, 0, 0], 1.1, 0.3, 0.59),
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [2.5, 0, 3.5], [2.1, 1.1, 2.1], 0.75, 0.3, 0.59),
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [2.5, 0, -2.5], [1.8, -2, -2], 0.4, 0.3, 0.59),
  ] },
  N2: { name: 'crystal-med', splines: [
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [0, 0, 0], [-0.4, 0, 0.1], 0.7, 0.3, 0.59),
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [-0.5, 0, 2.5], [0.3, 0, -0.1], 0.5, 0.3, 0.59),
  ] },
  N3: { name: 'crystal-small', splines: [
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [0, 0, 0], [0, 0, 0.2], 0.4, 0.3, 0.59),
    sp([[0, 0], [3.5, 0], [4.5, 14.5], [0, 21]], 5, '#99eeff', [1.5, 0, 0], [0, 0, -0.3], 0.3, 0.3, 0.59),
  ] },
  E: { name: 'enemy', splines: [
    sp([[4, 12], [0, 14]], 16, '#ff243a', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[5, 11], [4, 12]], 16, '#560101', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[0, 5], [8, 9.5], [5, 11]], 16, '#ff243a', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
}
