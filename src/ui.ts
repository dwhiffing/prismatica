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
    // sell toggle: highlighted (class 'a') while sell mode is active
    `<b class="${S.mode === 'sell' ? 'a' : ''}" data-t="d">Sell</b>` +
    `<b data-t="_">Res:${S.resource | 0} (+${Math.ceil(S.rps)}/s)</b>` +
    // wave readout: a countdown until wave 1, then "Wave N/WIN", then a win banner.
    `<b data-t="_">${S.won ? 'YOU WIN!' : S.wave ? `Wave ${S.wave}/${WAVE_WIN}` : `Wave 1 in ${Math.ceil(WAVE1_DELAY - S.t)}s`}</b>` +
    `<b data-t="s">${S.speed}x</b>`
}

H.onclick = (e: MouseEvent) => {
  const k = (e.target as HTMLElement).dataset.t
  if (!k || k === '_') return
  if (k === 's') S.speed = (S.speed+1) % 4 // cycle speed
  else if (k === 'd') S.mode = S.mode === 'sell' ? 'select' : 'sell' // toggle sell mode
  else if (S.mode === 'build' && S.tool === k) S.mode = 'select' // toggle off
  else {
    S.tool = k as BType
    S.mode = 'build'
    S.sel = null
  }
  drawUI()
}
