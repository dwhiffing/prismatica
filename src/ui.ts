// Toolbar / HUD: the top button strip and resource readout.
import { COST } from './constants'
import { H, S } from './state'
import type { BType } from './types'

const TOOLS: [BType, string][] = [
  ['S', 'Solar'],
  ['L', 'Link'],
  ['M', 'Miner'],
  ['T', 'Tower'],
]

export function drawUI() {
  H.innerHTML =
    `<b class="${S.mode === 'select' ? 'a' : ''}" data-t="X">Select</b>` +
    TOOLS.map(
      ([k, n]) =>
        `<b class="${S.mode === 'build' && S.tool === k ? 'a' : ''}" data-t="${k}">${n} $${COST[k]}</b>`,
    ).join('') +
    `<b data-t="_">Res:${S.resource | 0} (+${S.rps | 0}/s)</b>` +
    `<b data-t="_">Threat:${S.threat}</b>`
}

H.onclick = (e: MouseEvent) => {
  const k = (e.target as HTMLElement).dataset.t
  if (!k || k === '_') return
  if (k === 'X') S.mode = 'select'
  else if (S.mode === 'build' && S.tool === k) S.mode = 'select' // toggle off
  else {
    S.tool = k as BType
    S.mode = 'build'
    S.sel = null
    S.selN = null
  }
  drawUI()
}
