// "Habblaud" view of the office: Habblaud's own living world (people walking around, the kitchen, ping-pong,
// friendships and rivalries), embedded from the same origin through the room's proxy with its panels hidden, so only
// the world shows. The room drives its camera through the global Habblaud exposes (window.habblaud.world).

import { $ } from './util.js'

const PREFS_KEY = 'habblaud:prefs'
let frame = null

export function initWorld() {
  frame = $('frame-habblaud')
  frame.addEventListener('load', hidePanels)
}

/** Loads the world the first time it is shown. */
export function showWorld() {
  if (frame.getAttribute('src')) return
  // Same origin as the room, so the room can set Habblaud's preferences before it starts: panels closed and no
  // seasonal theme (the neon rooms read better without it).
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, sidebarOpen: false, feedOpen: false, theme: 'none' }))
  } catch {}
  frame.src = '/'
}

export function reloadWorld() {
  if (frame.getAttribute('src')) frame.src = '/'
}

/** Hides Habblaud's top bar, sidebar and feed: the room already shows all of that. */
function hidePanels() {
  let tries = 0
  const tick = () => {
    try {
      const ui = frame.contentDocument?.getElementById('ui')
      if (ui) {
        ui.style.display = 'none'
        frame.contentWindow.habblaud?.world?.setViewInsets?.({ top: 0, right: 0, bottom: 0, left: 0 })
        return
      }
    } catch {
      return
    }
    if (++tries < 40) setTimeout(tick, 250)
  }
  tick()
}

/** Points Habblaud's camera at an agent and keeps following it. */
export function focusInWorld(id) {
  try {
    frame.contentWindow?.habblaud?.world?.focusAgent?.(id, { follow: true })
  } catch {}
}
