// Live office state from Habblaud's stream (/api/stream, reached through the room's proxy) plus the viewer's own
// choices (selected agent, filters). Habblaud sends a full snapshot on every change, at most every ~200 ms.

import { saved, esc } from './util.js'

const UI_KEY = 'agent-control-room:ui'

const listeners = new Set()
let scheduled = false

/** Calls fn after every change, once per animation frame at most. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    for (const fn of listeners) fn(state)
  })
}

const ui = saved.get(UI_KEY, {})

export const state = {
  connection: 'connecting', // connecting | live | down
  snapshot: null,
  /** Server clock minus ours: Habblaud's timestamps are converted with it. */
  skew: 0,
  feed: [],
  selected: typeof ui.selected === 'string' ? ui.selected : null,
  account: typeof ui.account === 'string' ? ui.account : 'all',
  status: 'all', // all | working | waiting
  query: '',
  follow: ui.follow === true,
  closedProjects: Array.isArray(ui.closedProjects) ? ui.closedProjects : [],
  showNames: ui.showNames !== false,
  showSubs: ui.showSubs !== false,
  /** Reviewing the session in the flow: { t, playing, speed }, or null when live. */
  review: null,
  sound: ui.sound === true,
}

function persist() {
  const { selected, account, follow, closedProjects, showNames, showSubs, sound } = state
  saved.set(UI_KEY, { selected, account, follow, closedProjects, showNames, showSubs, sound })
}

/** Changes UI state and re-renders. */
export function update(patch) {
  Object.assign(state, patch)
  persist()
  emit()
}

/** Current time on Habblaud's clock. */
export const now = () => Date.now() + state.skew

// ─── Stream ─────────────────────────────────────────────────────────────────

let source = null
let retryTimer = 0

export function connect() {
  clearTimeout(retryTimer)
  source?.close()
  source = new EventSource('/api/stream')
  source.addEventListener('snapshot', (e) => {
    try {
      const snap = JSON.parse(e.data)
      state.snapshot = snap
      if (typeof snap.serverTime === 'number') state.skew = snap.serverTime - Date.now()
      state.connection = 'live'
      emit()
    } catch {}
  })
  source.addEventListener('feed', (e) => {
    try {
      state.feed = [...state.feed, ...JSON.parse(e.data)].slice(-200)
    } catch {}
  })
  source.onopen = () => {
    if (state.connection !== 'live') {
      state.connection = state.snapshot ? 'live' : 'connecting'
      emit()
    }
  }
  source.onerror = () => {
    // EventSource retries on its own (Habblaud sends retry: 2000); show it while it does.
    state.connection = 'connecting'
    emit()
    if (source.readyState === EventSource.CLOSED) retryTimer = setTimeout(connect, 3000)
  }
}

// ─── Derived data ───────────────────────────────────────────────────────────

/** What the room shows for an agent: working, thinking, waiting, error, shell, idle, done or offline. */
export function look(agent) {
  if (!agent) return 'offline'
  const s = agent.status
  if (s === 'waiting' || agent.permission) return 'waiting'
  if (s === 'working') {
    if (agent.activity?.error) return 'error'
    if (agent.activity?.kind === 'think') return 'thinking'
    return 'working'
  }
  return s // shell | idle | done | offline
}

/** Busy at the desk (anything but idle, done and offline). */
export const atDesk = (agent) => ['working', 'thinking', 'waiting', 'error', 'shell'].includes(look(agent))

export const agents = () => (state.snapshot?.agents ?? []).filter((a) => a.status !== 'offline')
export const rooms = () => state.snapshot?.rooms ?? []
export const accounts = () => state.snapshot?.accounts ?? []
export const agentById = (id) => (state.snapshot?.agents ?? []).find((a) => a.id === id) ?? null
export const roomById = (id) => rooms().find((r) => r.id === id) ?? null

// Account colors from the brand palette: Claude accounts in warm/pastel tones, Codex in the code-fn blue.
const CLAUDE_COLORS = ['#f5c97a', '#d7b3ff', '#7fd8c8', '#ff8fb1', '#c9cdd3']
const CODEX_COLOR = '#8ab4ff'

export function accountStyle(id) {
  const list = accounts()
  const acc = list.find((a) => a.id === id)
  if (!acc) return { short: '?', name: id ?? '', provider: 'claude', color: '#a1a7b0' }
  const provider = acc.provider ?? 'claude'
  let color = CODEX_COLOR
  if (provider !== 'codex') {
    const claudes = list.filter((a) => (a.provider ?? 'claude') !== 'codex')
    color = CLAUDE_COLORS[Math.max(0, claudes.indexOf(acc)) % CLAUDE_COLORS.length]
  }
  const short = provider === 'codex' && /^[A-Z]$/.test(acc.short) && list.filter((a) => a.provider === 'codex').length === 1 ? 'X' : acc.short
  return { short, name: provider === 'codex' && short === 'X' ? 'Codex' : acc.name, provider, color }
}

/** Account badge markup (a letter in the account color). */
export function accountBadge(id, size = '') {
  const s = accountStyle(id)
  const style = `color:${s.color};background:${hexA(s.color, 0.14)};border-color:${hexA(s.color, 0.45)}`
  return { html: `<span class="acct ${size}" data-style="${style}" title="${esc(s.name)}">${esc(s.short)}</span>`, style: s }
}

export function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Agents that pass the sidebar filters (account, status chip, search). */
export function filtered() {
  const q = state.query.trim().toLowerCase()
  return agents().filter((a) => {
    if (state.account !== 'all' && a.account !== state.account) return false
    if (state.status === 'working' && !['working', 'thinking', 'error', 'shell'].includes(look(a))) return false
    if (state.status === 'waiting' && look(a) !== 'waiting') return false
    if (!q) return true
    const room = roomById(a.roomId)
    return [a.name, a.title, a.role, room?.name, accountStyle(a.account).name].some((v) => v && v.toLowerCase().includes(q))
  })
}

/** Rooms with their agents (mains first, each followed by its subagents), in the order Habblaud gave them. */
export function grouped(list) {
  const out = []
  for (const room of [...rooms()].sort((a, b) => a.slot - b.slot)) {
    const inRoom = list.filter((a) => a.roomId === room.id)
    if (!inRoom.length) continue
    const mains = inRoom.filter((a) => a.kind !== 'sub' || !inRoom.some((m) => m.id === a.parentId))
    const ordered = []
    for (const m of mains.sort((a, b) => a.startedAt - b.startedAt)) {
      ordered.push(m)
      for (const s of inRoom.filter((a) => a.parentId === m.id).sort((a, b) => a.startedAt - b.startedAt)) ordered.push(s)
    }
    out.push({ room, agents: ordered })
  }
  return out
}

/** The selected agent, or the most relevant one when nothing (or someone gone) is selected. */
export function focusAgent() {
  const sel = agentById(state.selected)
  if (sel && sel.status !== 'offline') return sel
  const list = agents()
  const rank = (a) => ({ waiting: 0, working: 1, thinking: 1, error: 1, shell: 2, idle: 3, done: 4 })[look(a)] ?? 5
  const pick = [...list].filter((a) => a.kind !== 'sub').sort((a, b) => rank(a) - rank(b) || b.lastEventAt - a.lastEventAt)[0] ?? list[0] ?? null
  // The pick sticks: the flow should not jump to another agent on its own when states change.
  if (pick) {
    state.selected = pick.id
    persist()
  }
  return pick
}
