// Toolbar / HUD: the top button strip and resource readout.
import { COST } from './constants'
import { H, S } from './state'
import type { BType } from './types'
import { zzfx } from './zzfx'
import { changeSpeedSound, deselectBuildingTypeSound, selectBuildingTypeSound } from './sounds'

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

// pointerdown (not click): a click needs mousedown+mouseup on the SAME node, but drawUI()
// rebuilds the buttons via innerHTML on every press — so a fast second tap lands on a node
// that gets replaced before its mouseup, and the click is silently dropped. pointerdown fires
// on press alone, so rapid speed-button taps all register.
H.onpointerdown = (e: PointerEvent) => {
  const k = (e.target as HTMLElement).dataset.t
  if (!k) return // readouts / gaps have no data-t
   // cycle speed
  if (k === 's') {
    S.speed = (S.speed+1) % 5 // 0(paused),1,2,3,4x
    zzfx(...changeSpeedSound(140+S.speed*140)) // deselect sound
  }
  else if (k === 'd') {
    // toggle sell mode
    S.mode = S.mode === 'sell' ? 'select' : 'sell' 
    zzfx(...(S.mode === 'select' ? deselectBuildingTypeSound : selectBuildingTypeSound))
  } else if (S.mode === 'build' && S.tool === k) {
    S.mode = 'select' // toggle off
    zzfx(...deselectBuildingTypeSound) // deselect sound
  } else {
    S.tool = k as BType
    S.mode = 'build'
    S.sel = null
    zzfx(...selectBuildingTypeSound) // picked a build tool
  }
  drawUI()
}
