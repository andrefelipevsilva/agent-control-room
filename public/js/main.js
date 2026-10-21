// Agent Control Room page: the layout of the two panes (office and flow), keyboard shortcuts, recording mode, and
// the wiring between the sidebar, the office and the flow. The iframes are never moved in the DOM (that would reload
// them): layouts only change classes and CSS variables.

import { $, clamp, saved } from './util.js'
import { t, applyStaticText } from './i18n.js'
import { state, update, subscribe, connect, focusAgent, agentById } from './store.js'
import { initSidebar, renderSidebar } from './sidebar.js'
import { initOffice, renderOffice, locate } from './office.js'
import { initWorld, showWorld, focusInWorld, reloadWorld } from './world.js'
import { initFlow, renderFlow, setFlowTab } from './flow.js'
import { initPlaybar, renderPlaybar } from './playbar.js'

const LAYOUT_KEY = 'agent-control-room:state'
const LAYOUTS = ['side', 'stacked', 'floating']
const MIN_FLOAT = { w: 360, h: 260 }

applyStaticText()

// ─── Layout state (remembered per browser) ──────────────────────────────────

const ratioOr = (v, fallback) => (typeof v === 'number' && v >= 0.15 && v <= 0.85 ? v : fallback)
const s0 = saved.get(LAYOUT_KEY, {})
const layout = {
  layout: LAYOUTS.includes(s0.layout) ? s0.layout : 'side',
  swapped: s0.swapped === true,
  recording: false,
  sideClosed: s0.sideClosed === true,
  maxOffice: false,
  officeView: s0.officeView === 'habblaud' ? 'habblaud' : 'vector',
  ratio: { side: ratioOr(s0.ratio?.side, 0.6), stacked: ratioOr(s0.ratio?.stacked, 0.55) },
  float: s0.float && typeof s0.float.w === 'number' ? s0.float : null,
}

function save() {
  const { layout: l, swapped, sideClosed, officeView, ratio, float } = layout
  saved.set(LAYOUT_KEY, { layout: l, swapped, sideClosed, officeView, ratio, float, flowTab: $('flow').dataset.tab })
}

const stage = $('stage')
const divider = $('divider')
const panes = { office: $('pane-office'), flow: $('pane-flow') }
const floatingPane = () => (layout.swapped ? panes.office : panes.flow)

function defaultFloat(box) {
  const w = Math.round(Math.max(MIN_FLOAT.w, box.width * 0.4))
  const h = Math.round(Math.max(MIN_FLOAT.h, box.height * 0.62))
  return { x: box.width - w - 16, y: box.height - h - 16, w, h }
}

function clampFloat(f, box) {
  const w = clamp(f.w, Math.min(MIN_FLOAT.w, box.width), box.width)
  const h = clamp(f.h, Math.min(MIN_FLOAT.h, box.height), box.height)
  return { w, h, x: clamp(f.x, 0, box.width - w), y: clamp(f.y, 0, box.height - h) }
}

function placeFloat() {
  const floating = layout.layout === 'floating' && !layout.maxOffice ? floatingPane() : null
  for (const pane of Object.values(panes)) {
    pane.classList.toggle('is-floating', pane === floating)
    pane.classList.toggle('is-base', !!floating && pane !== floating)
    if (pane !== floating) pane.style.cssText = ''
  }
  if (!floating) return
  const box = stage.getBoundingClientRect()
  layout.float = clampFloat(layout.float ?? defaultFloat(box), box)
  const { x, y, w, h } = layout.float
  Object.assign(floating.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
}

function applyLayout() {
  const b = document.body
  b.dataset.layout = layout.layout
  b.classList.toggle('swapped', layout.swapped)
  b.classList.toggle('recording', layout.recording)
  b.classList.toggle('side-closed', layout.sideClosed)
  b.classList.toggle('max-office', layout.maxOffice)
  if (layout.layout !== 'floating') stage.style.setProperty('--r', String(layout.ratio[layout.layout]))
  for (const btn of document.querySelectorAll('.top [data-layout]')) btn.setAttribute('aria-pressed', String(btn.dataset.layout === layout.layout))
  $('record').setAttribute('aria-pressed', String(layout.recording))
  $('toggle-side').setAttribute('aria-pressed', String(!layout.sideClosed))
  divider.setAttribute('aria-orientation', layout.layout === 'stacked' ? 'horizontal' : 'vertical')
  divider.setAttribute('aria-valuenow', String(Math.round((layout.ratio[layout.layout] ?? 0.5) * 100)))
  const office = $('office')
  office.dataset.view = layout.officeView
  for (const btn of document.querySelectorAll('[data-view]')) btn.setAttribute('aria-pressed', String(btn.dataset.view === layout.officeView))
  if (layout.officeView === 'habblaud') showWorld()
  placeFloat()
}

function setLayout(l) {
  layout.layout = l
  layout.maxOffice = false
  applyLayout()
  save()
}

function swap() {
  layout.swapped = !layout.swapped
  applyLayout()
  save()
}

let toastTimer = 0
function toast(text) {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

function setRecording(on = !layout.recording) {
  layout.recording = on
  applyLayout()
  if (on) toast(t('recordToast'))
}

function setRatio(v) {
  layout.ratio[layout.layout] = clamp(v, 0.15, 0.85)
  applyLayout()
}

for (const b of document.querySelectorAll('.top [data-layout]')) b.addEventListener('click', () => setLayout(b.dataset.layout))
$('swap').addEventListener('click', swap)
$('record').addEventListener('click', () => setRecording())
$('toggle-side').addEventListener('click', () => {
  layout.sideClosed = !layout.sideClosed
  applyLayout()
  save()
})
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => {
    layout.officeView = b.dataset.view
    applyLayout()
    save()
    renderOffice()
  })
}
document.querySelector('[data-maximize="office"]').addEventListener('click', () => {
  layout.maxOffice = !layout.maxOffice
  applyLayout()
})
$('follow').addEventListener('click', () => update({ follow: !state.follow }))

// Settings popover
const settingsBtn = $('settings-btn')
const settings = $('settings')
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  settings.hidden = !settings.hidden
  settingsBtn.setAttribute('aria-expanded', String(!settings.hidden))
})
document.addEventListener('click', (e) => {
  if (!settings.hidden && !settings.contains(e.target)) {
    settings.hidden = true
    settingsBtn.setAttribute('aria-expanded', 'false')
  }
})
$('opt-names').checked = state.showNames
$('opt-subs').checked = state.showSubs
$('opt-names').addEventListener('change', (e) => update({ showNames: e.target.checked }))
$('opt-subs').addEventListener('change', (e) => update({ showSubs: e.target.checked }))

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
  const k = e.key.toLowerCase()
  if (k === '1' || k === '2' || k === '3') setLayout(LAYOUTS[Number(k) - 1])
  else if (k === 't') swap()
  else if (k === 'g') setRecording()
  else if (k === 'escape' && layout.recording) setRecording(false)
  else if (k === 'escape' && layout.maxOffice) {
    layout.maxOffice = false
    applyLayout()
  } else if (e.key === '/') {
    if (layout.sideClosed) {
      layout.sideClosed = false
      applyLayout()
    }
    $('search').focus()
  } else return
  e.preventDefault()
})

window.addEventListener('resize', placeFloat)

// ─── Dragging: divider, floating pane and its corner ────────────────────────

function draggable(el, { start, move, end }) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, [role="listbox"]') || start(e) === false) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('dragging')
    const onMove = (ev) => move(ev)
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('dragging')
      end?.()
      save()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  })
}

draggable(divider, {
  start: () => layout.layout !== 'floating',
  move: (e) => {
    const box = stage.getBoundingClientRect()
    setRatio(layout.layout === 'side' ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height)
  },
})
divider.addEventListener('dblclick', () => {
  setRatio(0.5)
  save()
})
divider.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -0.02, ArrowUp: -0.02, ArrowRight: 0.02, ArrowDown: 0.02 }[e.key]
  if (!step || layout.layout === 'floating') return
  e.preventDefault()
  e.stopPropagation()
  setRatio(layout.ratio[layout.layout] + step)
  save()
})

for (const pane of Object.values(panes)) {
  let from = null
  const begin = (e) => {
    if (!pane.classList.contains('is-floating')) return false
    from = { px: e.clientX, py: e.clientY, ...layout.float }
  }
  draggable(pane.querySelector('.handle'), {
    start: begin,
    move: (e) => {
      layout.float = { ...layout.float, x: from.x + e.clientX - from.px, y: from.y + e.clientY - from.py }
      placeFloat()
    },
  })
  draggable(pane.querySelector('.corner'), {
    start: begin,
    move: (e) => {
      layout.float = { ...layout.float, w: from.w + e.clientX - from.px, h: from.h + e.clientY - from.py }
      placeFloat()
    },
  })
}

// ─── Selection: sidebar, office and flow stay on the same agent ─────────────

function select(id) {
  if (!agentById(id)) return
  update({ selected: id })
  if (layout.officeView === 'habblaud') focusInWorld(id)
}

const actions = {
  select,
  locate(id) {
    select(id)
    if (layout.officeView === 'habblaud') return focusInWorld(id)
    if (layout.maxOffice === false && layout.layout === 'floating' && layout.swapped) swap()
    requestAnimationFrame(() => locate(id))
  },
  seeInFlow(id) {
    select(id)
    setFlowTab('graph')
    if (layout.maxOffice) {
      layout.maxOffice = false
      applyLayout()
    }
  },
}

const services = { habblaud: null, agentFlow: null }
let agentFlowUrl = null
const agentFlow = { url: () => agentFlowUrl, up: () => services.agentFlow === true }

initSidebar(actions)
initOffice(actions)
initWorld()
initFlow(actions, save, agentFlow)
initPlaybar()

subscribe(() => {
  renderSidebar()
  renderOffice()
  renderFlow()
  renderPlaybar()
})

// Clocks in the sidebar and the flow tick every second even without a new snapshot.
setInterval(() => {
  if (!state.snapshot) return
  renderSidebar()
  renderFlow()
  renderPlaybar()
}, 1000)

// ─── Services: notices while Habblaud or Agent Flow are starting ────────────

function notice(id, key, up, serverDown) {
  const el = $(id)
  el.hidden = up
  if (up) return
  el.querySelector('.notice-title').textContent = serverDown ? t('down') : t(`waiting_${key}`)
  el.querySelector('.notice-hint').textContent = serverDown ? t('downHint') : t(`waitingHint_${key}`)
}

async function poll() {
  let status = null
  try {
    const res = await fetch('status', { cache: 'no-store' })
    if (res.ok) status = await res.json()
  } catch {}
  if (status?.version) $('version').textContent = `v${status.version}`
  const hUp = !!status?.habblaud?.up
  const fUp = !!status?.agentFlow?.up
  if (status?.agentFlow?.url) agentFlowUrl = status.agentFlow.url
  if (status?.agentFlow?.watching) $('watching-note').textContent = t('watching', status.agentFlow.watching)
  // Back after being down: reconnect the stream and reload what was loaded.
  if (hUp && services.habblaud === false) {
    connect()
    reloadWorld()
  }
  if (status) {
    services.habblaud = hUp
    services.agentFlow = fUp
  }
  if (!status) state.connection = 'down'
  notice('office-notice', 'habblaud', hUp, !status)
  notice('flow-notice', 'agentFlow', fUp || $('flow').dataset.tab !== 'agentflow', !status)
  renderFlow()
  setTimeout(poll, 3000)
}

applyLayout()
setFlowTab(s0.flowTab ?? 'graph', false)
connect()
poll()
