// ============================================================
//  Entities & Splines — model data for the game.
//  This whole file is round-tripped by tools/model-editor.html.
//  An Entity is composed of 1+ Splines. Each Spline has geometry
//  (a lathe profile) + a material, placed by offset/rotation/scale.
// ============================================================
export type V3 = [number, number, number]
export type EType = 'S' | 'L' | 'M' | 'T' | 'rockLarge' | 'rockMedium' | 'rockSmall' | 'crystalR' | 'crystalG' | 'crystalB' | 'E'

export interface Geo { profile: [number, number][]; seg: number }
export interface Material { col: string; amb: number; dif: number; a?: number }
export interface Spline {
  geo: Geo
  mat: Material
  off: V3
  rot: V3
  scl: number
}
export interface Entity { name: string; splines: Spline[] }

const sp = (
  profile: [number, number][], seg: number, col: string,
  off: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scl = 1, amb = 0.3, dif = 0.59, a = 1,
): Spline => ({ geo: { profile, seg }, mat: { col, amb, dif, a }, off, rot, scl })

// shared crystal profile — the RGB color crystals are identical but for their tint
const CRY: [number, number][] = [[3.5, 0], [4.5, 14.5], [0, 21]]

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
    sp([[2, 0], [1.5, 12], [0, 14]], 8, '#4f8', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2, 0], [1.5, 8], [0, 10]], 8, '#d1d3ca', [3, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2, 0], [1.5, 8], [0, 10]], 8, '#d1d3ca', [0, 0, 3], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2, 0], [1.5, 8], [0, 10]], 8, '#d1d3ca', [0, 0, -3], [0, 0, 0], 1, 0.3, 0.59),
    sp([[2, 0], [1.5, 8], [0, 10]], 10, '#d1d3ca', [-3, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
  T: { name: 'tower', splines: [
    sp([[0, 0], [6, 0], [2, 8], [2, 22], [0, 22]], 4, '#66bdff', [0, 0, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
  rockLarge: { name: 'rock-large', splines: [
    sp([[0, 0], [4.5, 3], [4.5, 8.5], [0, 11.5]], 6, '#afb295', [-3.5, 1, -2.5], [0.8, 0, -1], 1.15, 0.3, 0.59),
    sp([[0, 0], [1.5, 0], [2.5, 3], [0, 4.5]], 5, '#afb295', [5.5, 0, -3.5], [0, 0.1, 0], 1, 0.3, 0.59),
    sp([[0, 0], [1.5, 0], [2, 2.5], [0, 4]], 3, '#afb295', [0, 0, -4.5], [0, 0.6, 0.2], 0.55, 0.3, 0.59),
  ] },
  rockMedium: { name: 'rock-medium', splines: [
    sp([[0, 0], [1, 0], [1.5, 1.5], [0, 4]], 5, '#afb295', [-4, 0, 0], [0, 0, 0], 1.1, 0.3, 0.59),
    sp([[0, 0], [3, 0], [2.5, 7.5], [0, 9.5]], 6, '#afb295', [1, -1, 0], [0, 0.4, 0], 1.2, 0.3, 0.59),
  ] },
  rockSmall: { name: 'rock-small', splines: [
    sp([[2, 0], [2.5, 3], [0, 4]], 7, '#afb295', [0, 1, 0], [0, 0, 1.6], 1, 0.3, 0.59),
  ] },
  crystalR: { name: 'crystal-r', splines: [sp(CRY, 5, '#ff5555',[0,0,0],[0,0,0],1,1,.5,0.7)] },
  crystalG: { name: 'crystal-g', splines: [sp(CRY, 5, '#55ff55',[0,0,0],[0,0,0],1,1,.5,0.7)] },
  crystalB: { name: 'crystal-b', splines: [sp(CRY, 5, '#5555ff',[0,0,0],[0,0,0],1,1,.5,0.7)] },
  E: { name: 'enemy', splines: [
    sp([[4, 12], [0, 14]], 16, '#ff243a', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[5, 11], [4, 12]], 16, '#560101', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
    sp([[0, 5], [8, 9.5], [5, 11]], 16, '#ff243a', [0, -2, 0], [0, 0, 0], 1, 0.3, 0.59),
  ] },
}
