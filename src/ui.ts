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

// class=a when active, else nothing (highlights the current tool / sell / etc.)
const act = (on: boolean) => on ? 'class=a ' : ''
export function drawUI() {
  // bottom bar (#b, space-between): time control | build tools | sell. Top-right (#t): readouts.
  // Readout <b>s carry no data-t, so the click handler ignores them (missing key === no-op).
  const wave = `Wave ${S.wave}`
  H.innerHTML =
    `<div id=b><div><b data-t=s>${S.speed}x</b></div><div>` +
    TOOLS.map(([k, n]) => `<b ${act(S.mode === 'build' && S.tool === k)}data-t=${k}>${n}<br>$${COST[k]}</b>`).join('') +
    `</div><div><b ${act(S.mode === 'sell')}data-t=d>Sell</b></div></div>` +
    `<div id=t><b>$${S.resource | 0} (+${Math.ceil(S.rps)}/s)</b><b>${wave}</b></div>`
}

H.onclick = (e: MouseEvent) => {
  const k = (e.target as HTMLElement).dataset.t
  if (!k) return // readouts / gaps have no data-t
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
