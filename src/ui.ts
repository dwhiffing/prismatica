// Toolbar / HUD: the top button strip and resource readout.
import { COST, WAVE1_DELAY, WAVE_WIN } from './constants'
import { H, S } from './state'
import type { BType } from './types'

const TOOLS: [BType, string][] = [
  ['L', 'Link'],
  ['M', 'Miner'],
  ['T', 'Tower'],
  ['S', 'Solar'],
]

export function drawUI() {
  H.innerHTML =
    TOOLS.map(
      ([k, n]) =>
        `<b class="${S.mode === 'build' && S.tool === k ? 'a' : ''}" data-t="${k}">${n} $${COST[k]}</b>`,
    ).join('') +
    `<b data-t="_">Res:${S.resource | 0} (+${S.rps | 0}/s)</b>` +
    // wave readout: a countdown until wave 1, then "Wave N/WIN", then a win banner.
    `<b data-t="_">${S.won ? 'YOU WIN!' : S.wave ? `Wave ${S.wave}/${WAVE_WIN}` : `Wave 1 in ${Math.ceil(WAVE1_DELAY - S.t)}s`}</b>`
}

H.onclick = (e: MouseEvent) => {
  const k = (e.target as HTMLElement).dataset.t
  if (!k || k === '_') return
  if (S.mode === 'build' && S.tool === k) S.mode = 'select' // toggle off
  else {
    S.tool = k as BType
    S.mode = 'build'
    S.sel = null
  }
  drawUI()
}
