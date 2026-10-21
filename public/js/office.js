// The vector office: one room per project (the project's cwd), a desk for each of its agents, and the shared areas.
// Agents at work sit at their desk with a gesture per state (lime ring and code on the screens; thinking bubble; raised
// hand and orange ring when they need you; red screen on an error). Idle agents leave the desk for the kitchen.
// Pan with the mouse, zoom with the wheel or the buttons; "follow" keeps the selected agent in the middle.

import { DEFS, TOP_AREAS, TOP_WALLS, BOTTOM_AREAS, BOTTOM_WALLS, kanban, plant } from './office-art.js'
import { appearance, seated, standing } from './avatar.js'
import { $, esc, clamp, textWidth, rng, pick, parseToolTitle } from './util.js'
import { t, plural } from './i18n.js'
import { state, update, look, agents, rooms, accountStyle, hexA, focusAgent, atDesk } from './store.js'

const COLS = [24, 310, 596]
const ROOM_W = 280
const BASE_H = 244 // a project row: 238 of room + the glass wall
const DESK_ROW = 106
const SEAT_X = [46, 160]
const FIRST_ROW = 256
/** Standing spots in the kitchen for idle agents; more of them stand in the corridor. */
const KITCHEN = [[384, 108], [522, 116], [410, 186], [484, 188], [548, 188], [352, 172]]
const SANS = "'Geist', ui-sans-serif, system-ui, sans-serif"
const MONO = "'Geist Mono', ui-monospace, monospace"

let host = null
let svg = null
const layer = {}
let plan = null
/** Desk of each agent per room (roomId → Map(agentId → seat index)), kept while the agent is around. */
const seatsByRoom = new Map()
/** Where each drawn agent is (SVG units), for follow and "locate". */
const positions = new Map()
let view = null
let autoFit = true
let fitBox = { x: 0, y: -4, w: 900, h: 846 }
let handlers = {}

// ─── Setup and camera ───────────────────────────────────────────────────────

export function initOffice(h) {
  handlers = h
  host = $('office-vector')
  host.innerHTML = `<svg viewBox="0 -4 900 846" preserveAspectRatio="xMidYMid meet" role="img">${DEFS}<g id="o-building"></g><g id="o-desks"></g><g id="o-standing"></g><g id="o-walls"></g><g id="o-labels"></g></svg>`
  svg = host.querySelector('svg')
  for (const k of ['building', 'desks', 'standing', 'walls', 'labels']) layer[k] = svg.querySelector(`#o-${k}`)

  new ResizeObserver(() => {
    if (!host.clientWidth) return
    if (autoFit || !view) fit()
    else reshape()
  }).observe(host)

  host.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
  }, { passive: false })

  let drag = null
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false, target: e.target }
    host.setPointerCapture(e.pointerId)
  })
  host.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    host.classList.add('panning')
    const k = view.w / host.clientWidth
    view = { ...view, x: drag.view.x - dx * k, y: drag.view.y - dy * k }
    autoFit = false
    if (state.follow) update({ follow: false })
    apply()
  })
  const end = () => {
    if (!drag) return
    host.classList.remove('panning')
    if (!drag.moved) {
      const hit = drag.target.closest?.('[data-agent]')
      if (hit) handlers.select?.(hit.dataset.agent)
    }
    drag = null
  }
  host.addEventListener('pointerup', end)
  host.addEventListener('pointercancel', end)

  $('zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]')
    if (!b) return
    const r = host.getBoundingClientRect()
    if (b.dataset.zoom === 'fit') {
      autoFit = true
      if (state.follow) update({ follow: false })
      fit()
    } else zoomAt(b.dataset.zoom === 'in' ? 1.25 : 0.8, r.left + r.width / 2, r.top + r.height / 2)
  })

  // Names are measured to size the labels: draw again once Geist has loaded.
  document.fonts?.ready.then(() => renderOffice(true))
}

function fitView() {
  const cw = host.clientWidth || 900
  const ch = host.clientHeight || 600
  const pad = 0.02
  const b = { x: fitBox.x - fitBox.w * pad, y: fitBox.y - fitBox.h * pad, w: fitBox.w * (1 + 2 * pad), h: fitBox.h * (1 + 2 * pad) }
  const s = Math.min(cw / b.w, ch / b.h)
  const w = cw / s
  const h = ch / s
  return { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h }
}

function fit() {
  view = fitView()
  apply()
}

/** Keeps the center and the zoom when the pane changes size. */
function reshape() {
  const cw = host.clientWidth
  const ch = host.clientHeight
  const cx = view.x + view.w / 2
  const cy = view.y + view.h / 2
  const w = view.w
  const h = (w * ch) / cw
  view = { x: cx - w / 2, y: cy - h / 2, w, h }
  apply()
}

function zoomAt(factor, clientX, clientY) {
  if (!view) return
  const r = host.getBoundingClientRect()
  const fw = fitView().w
  const w = clamp(view.w / factor, fw / 6, fw * 1.4)
  const f = view.w / w
  const px = view.x + ((clientX - r.left) / r.width) * view.w
  const py = view.y + ((clientY - r.top) / r.height) * view.h
  view = { x: px - (px - view.x) / f, y: py - (py - view.y) / f, w, h: (view.h * w) / view.w }
  autoFit = false
  apply()
}

function apply() {
  svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`)
  $('zoom-level').textContent = `${Math.round((fitView().w / view.w) * 100)}%`
}

/** Smoothly centers the camera on a point, at a zoom (×fit) when given. */
let anim = 0
function centerOn([x, y], zoom) {
  const fw = fitView()
  const w = zoom ? fw.w / zoom : view.w
  const h = (w * host.clientHeight) / Math.max(1, host.clientWidth)
  const target = { x: x - w / 2, y: y - h / 2, w, h }
  cancelAnimationFrame(anim)
  const step = () => {
    const k = 0.18
    view = {
      x: view.x + (target.x - view.x) * k,
      y: view.y + (target.y - view.y) * k,
      w: view.w + (target.w - view.w) * k,
      h: view.h + (target.h - view.h) * k,
    }
    apply()
    if (Math.abs(target.x - view.x) + Math.abs(target.y - view.y) + Math.abs(target.w - view.w) > 0.5) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

/** Zooms to an agent (sidebar "Locate"). */
export function locate(id) {
  const p = positions.get(id)
  if (!p) return false
  autoFit = false
  centerOn(p, 2.2)
  return true
}

// ─── Plan: rooms, rows and desks ────────────────────────────────────────────

/** Agents that own a desk in a room: every main agent (idle ones keep theirs) and, optionally, working subagents. */
function deskOwners(roomId, list) {
  return list.filter((a) => a.roomId === roomId && a.status !== 'done' && (a.kind !== 'sub' || (state.showSubs && atDesk(a))))
}

function assignSeats(roomId, owners) {
  let seats = seatsByRoom.get(roomId)
  if (!seats) seatsByRoom.set(roomId, (seats = new Map()))
  const ids = new Set(owners.map((a) => a.id))
  for (const id of [...seats.keys()]) if (!ids.has(id)) seats.delete(id)
  const used = new Set(seats.values())
  for (const a of [...owners].sort((x, y) => (x.kind === 'sub') - (y.kind === 'sub') || x.startedAt - y.startedAt)) {
    if (seats.has(a.id)) continue
    let i = 0
    while (used.has(i)) i++
    seats.set(a.id, i)
    used.add(i)
  }
  return seats
}

function makePlan(list) {
  const rs = [...rooms()].sort((a, b) => a.slot - b.slot)
  const cells = rs.map((room) => {
    const owners = deskOwners(room.id, list)
    const seats = assignSeats(room.id, owners)
    const maxSeat = Math.max(-1, ...seats.values())
    const deskRows = Math.max(2, Math.ceil((maxSeat + 1) / 2))
    return { room, owners, seats, deskRows }
  })
  while (cells.length === 0 || cells.length % 3) cells.push({ room: null, owners: [], seats: new Map(), deskRows: 2 })

  const rows = []
  let top = FIRST_ROW
  for (let i = 0; i < cells.length; i += 3) {
    const group = cells.slice(i, i + 3)
    const deskRows = Math.max(...group.map((c) => c.deskRows))
    const h = BASE_H + (deskRows - 2) * DESK_ROW
    group.forEach((c, k) => Object.assign(c, { x: COLS[k], top, h, deskRows }))
    rows.push({ top, h, cells: group })
    top += h + 6
  }
  const yC = rows.at(-1).top + rows.at(-1).h
  const yB = yC + 54
  const key = rows.map((r) => r.cells.map((c) => `${c.room?.id ?? '-'}:${c.room?.name ?? ''}:${c.deskRows}`).join('|')).join('/')
  return { rows, yC, yB, dy: yB - 554, bottom: yB + 230, key }
}

const seatPos = (cell, i) => [cell.x + SEAT_X[i % 2], cell.top + 48 + Math.floor(i / 2) * DESK_ROW]

// ─── Building (floors, decor, walls) ────────────────────────────────────────

function buildingSVG(p) {
  let s = `<rect x="16" y="16" width="868" height="${p.bottom - 16}" rx="18" fill="#0f1114" filter="url(#o-bld)"/>${TOP_AREAS}`
  s += `<rect x="24" y="196" width="852" height="60" fill="url(#o-conc)"/>`
  s += `<rect x="24" y="${p.yC - 6}" width="852" height="60" fill="url(#o-conc)"/>`
  p.rows.forEach((row) => {
    s += `<rect x="24" y="${row.top}" width="852" height="${row.h}" fill="url(#o-carpet)"/>`
    row.cells.forEach((c) => {
      s += `<rect x="${c.x}" y="${row.top}" width="${ROOM_W}" height="30" fill="url(#o-wallg)"/>`
      if (!c.room) {
        s += `<text x="${c.x + ROOM_W / 2}" y="${row.top + row.h / 2 + 4}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="#2a2f37">${esc(t('freeRoom'))}</text>`
        return
      }
      s += kanban(c.x + 108, row.top + 5, c.room.seed >>> 0)
      s += plant(c.x + 258, row.top + 62, 0.95)
      const r = rng(c.room.seed >>> 0)
      if (r() < 0.6) s += plant(c.x + 22, row.top + row.h - 14, 0.72)
      if (r() < 0.5) s += `<ellipse cx="${c.x + 86}" cy="${row.top + row.h - 33}" rx="21" ry="4" fill="#000" opacity="0.35"/><ellipse cx="${c.x + 86}" cy="${row.top + row.h - 44}" rx="20" ry="14" fill="${pick(r, ['#2f5a4c', '#4b3f63', '#6a5640', '#3d4a63'])}"/>`
    })
    s += `<path d="M24 ${row.top + 29.5}H876" stroke="#2a2f37" stroke-width="1"/><rect x="24" y="${row.top + 30}" width="852" height="12" fill="url(#o-ao)"/>`
  })
  s += plant(44, 246, 0.62) + plant(856, 246, 0.62) + plant(44, p.yB - 10, 0.62) + plant(856, p.yB - 10, 0.62)
  s += `<g transform="translate(0 ${p.dy})">${BOTTOM_AREAS}</g>`
  // Clip paths for the glow of each project room.
  s += `<defs>${p.rows.flatMap((row) => row.cells.map((c, k) => `<clipPath id="o-room-${row.top}-${k}"><rect x="${c.x}" y="${row.top}" width="${ROOM_W}" height="${row.h - 6}"/></clipPath>`)).join('')}</defs>`
  return s
}

function wallsSVG(p) {
  let s = `<g fill="#353b45">${TOP_WALLS}`
  p.rows.forEach((row) => {
    s += `<rect x="24" y="${row.top - 6}" width="852" height="6"/>`
    s += `<rect x="304" y="${row.top - 6}" width="6" height="${row.h + 6}"/><rect x="590" y="${row.top - 6}" width="6" height="${row.h + 6}"/>`
  })
  s += `<g transform="translate(0 ${p.dy})">${BOTTOM_WALLS}</g></g>`
  let glass = ''
  let shine = ''
  p.rows.forEach((row) => {
    const y = row.top + row.h - 6
    for (const x of COLS) {
      glass += `<rect x="${x}" y="${y}" width="216" height="5"/><rect x="${x + 266}" y="${y}" width="14" height="5"/>`
      shine += `M${x} ${y + 0.5}H${x + 216}M${x + 266} ${y + 0.5}H${x + 280}`
    }
  })
  s += `<g fill="#2a3442" opacity="0.95">${glass}</g><path d="${shine}" stroke="#8592a6" stroke-width="1" opacity="0.5"/>`
  s += `<rect x="20" y="20" width="860" height="${p.yB + 226 - 20}" rx="14" fill="none" stroke="#3a414c" stroke-width="8"/>`
  const area = (x, y, label) => {
    const w = Math.ceil(textWidth(label, `600 11px ${SANS}`)) + 24
    return `<rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="#0f1115" stroke="#2e333b"/><text x="${x + w / 2}" y="${y + 12.5}" text-anchor="middle" fill="#c9cdd3">${esc(label)}</text>`
  }
  const yb = p.yB - 12
  s += `<g font-family="${SANS}" font-size="11" font-weight="600">` +
    area(34, 11, t('reception')) + area(320, 11, t('kitchen')) + area(606, 11, t('infra')) +
    area(34, yb, t('lounge')) + area(400, yb, t('reviewRoom')) + area(650, yb, t('focus')) + area(782, yb, t('restrooms')) +
    `</g>`
  return s
}

// ─── Desks and agents ───────────────────────────────────────────────────────

const LINE_COLORS = ['#8ab4ff', '#f5c97a', '#c9cdd3', '#c8f560', '#5f6670', '#e6e8eb']

function leftScreen(seed, dim) {
  const r = rng(seed)
  let s = ''
  ;[-23.5, -20, -16.5, -13].forEach((y, i) => {
    const x = 13 + Math.round(r() * 3)
    const w = 6 + Math.round(r() * 10)
    s += `<rect x="${x}" y="${y}" width="${w}" height="1.6" rx="0.8" fill="${dim ? '#5f6670' : pick(r, LINE_COLORS)}"/>`
    if (i % 2 === 0 && r() < 0.7) s += `<rect x="${x + w + 2}" y="${y}" width="${4 + Math.round(r() * 6)}" height="1.6" rx="0.8" fill="${dim ? '#5f6670' : pick(r, LINE_COLORS)}"/>`
  })
  return s
}

function rightScreen(l, seed) {
  const r = rng(seed ^ 0x9e37)
  if (l === 'thinking') return `<circle class="cr-d1" cx="47" cy="-16.5" r="1.6" fill="#8ab4ff"/><circle class="cr-d2" cx="53" cy="-16.5" r="1.6" fill="#8ab4ff"/><circle class="cr-d3" cx="59" cy="-16.5" r="1.6" fill="#8ab4ff"/>`
  if (l === 'waiting')
    return `<rect x="42.5" y="-24" width="21" height="14.5" rx="1.2" fill="#ff9a4d"/><rect x="45" y="-21.5" width="12" height="1.6" rx="0.8" fill="#0a0b0d"/><rect x="45" y="-18" width="16" height="1.4" rx="0.7" fill="#0a0b0d" opacity="0.55"/><rect x="45" y="-14" width="7" height="2.6" rx="1" fill="#0a0b0d"/><rect x="54" y="-14" width="7" height="2.6" rx="1" fill="#0a0b0d" opacity="0.4"/>`
  if (l === 'error')
    return `<rect x="41" y="-26" width="24" height="18.5" rx="1.2" fill="#2a1416"/><rect x="43" y="-23.5" width="16" height="1.6" rx="0.8" fill="#ff5d5d"/><rect x="45" y="-20" width="12" height="1.6" rx="0.8" fill="#ff5d5d" opacity="0.85"/><rect x="45" y="-16.5" width="14" height="1.6" rx="0.8" fill="#ff5d5d" opacity="0.85"/><rect x="43" y="-13" width="9" height="1.6" rx="0.8" fill="#5f6670"/>`
  if (l === 'shell')
    return `<rect x="43" y="-23.5" width="3" height="1.6" rx="0.8" fill="#c8f560"/><rect x="48" y="-23.5" width="10" height="1.6" rx="0.8" fill="#e6e8eb"/><rect x="43" y="-20" width="14" height="1.6" rx="0.8" fill="#5f6670"/><rect x="43" y="-16.5" width="11" height="1.6" rx="0.8" fill="#5f6670"/><rect class="cr-blink" x="43" y="-12" width="3" height="2.4" fill="#c8f560"/>`
  const a = 8 + Math.round(r() * 8)
  return (
    `<rect x="43" y="-23.5" width="3" height="1.6" rx="0.8" fill="#c8f560"/><rect x="48" y="-23.5" width="${a}" height="1.6" rx="0.8" fill="#e6e8eb"/>` +
    `<rect x="43" y="-20" width="${10 + Math.round(r() * 6)}" height="1.6" rx="0.8" fill="#5f6670"/>` +
    `<rect x="45" y="-16.5" width="${8 + Math.round(r() * 6)}" height="1.6" rx="0.8" fill="${r() < 0.5 ? '#c8f560' : '#ff5d5d'}" opacity="0.85"/>` +
    `<rect class="cr-blink" x="43" y="-10" width="3" height="2.4" fill="#c8f560"/>`
  )
}

/** A small object on the desk, by the agent's seed: a rubber duck, headphones or a mug (or nothing). */
function deskThing(seed) {
  switch (seed % 5) {
    case 0: return `<ellipse cx="11" cy="11" rx="4.2" ry="3" fill="#f5c97a"/><circle cx="13" cy="7.6" r="2.4" fill="#f5c97a"/><path d="M15 7.4L17.6 8L15 8.8Z" fill="#ff9a4d"/>`
    case 1: return `<path d="M4 13a4.5 4.5 0 0 1 9 0" stroke="#3a414d" stroke-width="2" fill="none"/><rect x="3" y="12" width="3" height="4" rx="1" fill="#3a414d"/><rect x="11" y="12" width="3" height="4" rx="1" fill="#3a414d"/>`
    case 2: return `<rect x="63" y="5" width="6" height="7" rx="1.5" fill="#e6e8eb"/>`
    default: return ''
  }
}

const RING = {
  working: '<ellipse cx="38" cy="50" rx="34" ry="12" fill="#c8f560" fill-opacity="0.09" stroke="#c8f560" stroke-opacity="0.85" stroke-width="1.6"/>',
  shell: '<ellipse cx="38" cy="50" rx="32" ry="11" fill="#c8f560" fill-opacity="0.07" stroke="#c8f560" stroke-opacity="0.6" stroke-width="1.4"/>',
  thinking: '<ellipse cx="38" cy="50" rx="32" ry="11" fill="#c8f560" fill-opacity="0.06" stroke="#c8f560" stroke-opacity="0.55" stroke-width="1.4"/>',
  waiting: '<ellipse cx="38" cy="50" rx="34" ry="12" fill="#ff9a4d" fill-opacity="0.1" stroke="#ff9a4d" stroke-opacity="0.85" stroke-width="1.6"/><ellipse class="cr-ring" cx="38" cy="50" rx="34" ry="12" fill="none" stroke="#ff9a4d" stroke-width="1.6"/>',
  error: '<ellipse cx="38" cy="50" rx="34" ry="12" fill="#ff5d5d" fill-opacity="0.1" stroke="#ff5d5d" stroke-opacity="0.85" stroke-width="1.6"/>',
}
const STATE_COLOR = { working: '#c8f560', shell: '#c8f560', thinking: '#c8f560', waiting: '#ff9a4d', error: '#ff5d5d', idle: '#7d8590', done: '#7d8590' }

function busyDesk(a, l, selected) {
  const ap = appearance(a)
  const seed = a.seed >>> 0
  let s = RING[l] ?? RING.working
  if (selected) s += `<ellipse cx="38" cy="50" rx="42" ry="16" fill="none" stroke="${STATE_COLOR[l]}" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 4"/>`
  s += `<ellipse cx="38" cy="54" rx="13" ry="3.5" fill="#000" opacity="0.35"/><use href="#o-desk"/>`
  s += leftScreen(seed, l === 'waiting') + rightScreen(l, seed) + deskThing(seed)
  s += seated(ap, l === 'waiting' ? 'raise' : 'type') + `<use href="#o-back"/>`
  if (l === 'waiting') s += `<circle class="cr-ring" cx="38" cy="-33" r="7.5" fill="none" stroke="#ff9a4d" stroke-width="1.5"/><circle cx="38" cy="-33" r="7.5" fill="#ff9a4d"/><text x="38" y="-29" text-anchor="middle" font-family="${SANS}" font-size="11" font-weight="800" fill="#0a0b0d">!</text>`
  if (l === 'error') s += `<circle cx="38" cy="-33" r="7.5" fill="#ff5d5d"/><path d="M35 -36L41 -30M41 -36L35 -30" stroke="#0a0b0d" stroke-width="1.8" stroke-linecap="round"/>`
  if (l === 'thinking') s += `<rect x="52" y="-2" width="24" height="12" rx="6" fill="#0f1115" stroke="#8ab4ff" stroke-opacity="0.6"/><circle cx="50" cy="12.5" r="1.7" fill="#0f1115" stroke="#8ab4ff" stroke-opacity="0.6"/><circle class="cr-d1" cx="58.5" cy="4" r="1.5" fill="#8ab4ff"/><circle class="cr-d2" cx="64" cy="4" r="1.5" fill="#8ab4ff"/><circle class="cr-d3" cx="69.5" cy="4" r="1.5" fill="#8ab4ff"/>`
  s += `<rect class="o-hit" x="-4" y="-34" width="84" height="92"/>`
  return s
}

const restDesk = `<use href="#o-desk"/><text x="23" y="-13.5" text-anchor="middle" font-family="${MONO}" font-size="7" font-weight="600" fill="#262b33">&gt;_</text><use href="#o-chair"/>`

// ─── Labels ─────────────────────────────────────────────────────────────────

function badgeSVG(accountId, x, y, size = 12) {
  const st = accountStyle(accountId)
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="3.5" fill="${hexA(st.color, 0.14)}" stroke="${hexA(st.color, 0.5)}"/>` +
    `<text x="${x + size / 2}" y="${y + size * 0.775}" text-anchor="middle" font-size="${size === 12 ? 8.5 : 9.5}" font-weight="700" fill="${st.color}">${esc(st.short)}</text>`
  )
}

/**
 * Small pill under an agent: dot, name, account and, when it matters, the state. Returns its width and a function
 * that draws it at a given left edge (labels side by side are pushed apart before they are drawn).
 */
function pill(a, l, cx, top, extra) {
  const nameW = textWidth(a.name, `600 11.5px ${SANS}`)
  const extraText = extra ?? (l === 'waiting' ? t('needsYouShort') : '')
  const extraW = extraText ? textWidth(extraText, `500 11px ${SANS}`) + 7 : 0
  const w = Math.ceil(17 + nameW + 6 + 12 + extraW + 9)
  const color = STATE_COLOR[l] ?? '#7d8590'
  const waiting = l === 'waiting'
  const stroke = waiting ? 'stroke="#ff9a4d" stroke-opacity="0.7"' : l === 'idle' || l === 'done' ? 'stroke="#2e333b"' : `stroke="${color}" stroke-opacity="0.45"`
  return {
    x: Math.round(cx - w / 2),
    w,
    draw: (x) => {
      const bx = x + 17 + nameW + 6
      return (
        `<g class="o-label" data-agent="${esc(a.id)}"><rect x="${x}" y="${top}" width="${w}" height="18" rx="9" fill="${waiting ? '#1d1510' : '#0f1115'}" ${stroke}/>` +
        `<circle cx="${x + 10}" cy="${top + 9}" r="3" fill="${color}"/>` +
        `<text x="${x + 17}" y="${top + 13}" font-size="11.5" fill="${l === 'idle' || l === 'done' ? '#c9cdd3' : '#f3f4f1'}">${esc(a.name)}</text>` +
        badgeSVG(a.account, bx, top + 3) +
        (extraText ? `<text x="${bx + 18}" y="${top + 13}" font-size="11" font-weight="500" fill="${waiting ? '#ff9a4d' : '#a1a7b0'}">${esc(extraText)}</text>` : '') +
        `</g>`
      )
    },
  }
}

/** What the selected agent is doing, for its big label: "$ git status", "Editing App.tsx"... */
function nowText(a, l) {
  if (l === 'waiting') {
    if (!a.permission?.title) return t('needsYouShort')
    const { tool, arg } = parseToolTitle(a.permission.title)
    return /^(Bash|PowerShell)$/i.test(tool) ? `$ ${arg}` : a.permission.title
  }
  if (l === 'thinking') return `${t('thinking').toLowerCase()}…`
  if (l === 'shell') return a.shells?.[0]?.label ?? t('shell')
  const act = a.activity
  if (!act) return ''
  if (['run', 'test', 'git'].includes(act.kind) && act.detail) return `$ ${act.detail}`
  return act.text ?? ''
}

function fitText(text, font, max) {
  if (textWidth(text, font) <= max) return text
  let s = text
  while (s.length > 1 && textWidth(`${s}…`, font) > max) s = s.slice(0, -1)
  return `${s}…`
}

/** The selected agent's label: name and what it is doing right now, with a blinking cursor. */
function mainLabel(a, l, cx, top) {
  const nameW = textWidth(a.name, `600 13px ${SANS}`)
  const cmdFont = `500 11px ${MONO}`
  const cmd = fitText(nowText(a, l), cmdFont, 190)
  const cmdW = textWidth(cmd, cmdFont)
  const w = Math.ceil(Math.max(140, 20 + nameW + 6 + 15 + 12, 12 + cmdW + 10 + 12))
  const color = STATE_COLOR[l] ?? '#c8f560'
  const live = ['working', 'shell', 'thinking'].includes(l)
  return {
    x: Math.round(cx - w / 2),
    w,
    draw: (x) => {
      // The notch stays over the agent even when the label was pushed aside.
      const nx = clamp(cx, x + 14, x + w - 14)
      return (
        `<g class="o-label o-label-main" data-agent="${esc(a.id)}">` +
        `<path d="M${nx - 5} ${top}L${nx} ${top - 5.5}L${nx + 5} ${top}Z" fill="#0f1115" stroke="${color}" stroke-opacity="0.6"/>` +
        `<rect x="${x}" y="${top}" width="${w}" height="40" rx="9" fill="#0f1115" stroke="${color}" stroke-opacity="0.6"/>` +
        `<rect x="${nx - 4.5}" y="${top - 1}" width="9" height="2.2" fill="#0f1115"/>` +
        `<circle cx="${x + 12}" cy="${top + 12}" r="3.5" fill="${color}"/>` +
        `<text x="${x + 20}" y="${top + 16.5}" font-size="13" fill="#f3f4f1">${esc(a.name)}</text>` +
        badgeSVG(a.account, x + 20 + nameW + 6, top + 5.5, 15) +
        `<text x="${x + 12}" y="${top + 33}" font-family="${MONO}" font-size="11" font-weight="500" fill="${color}">${esc(cmd)}</text>` +
        (live ? `<rect class="cr-blink" x="${x + 12 + cmdW + 3}" y="${top + 24.5}" width="5.5" height="10" fill="${color}"/>` : '') +
        `</g>`
      )
    },
  }
}

/** Pushes labels of the same row apart (left to right) so neighbors never overlap, then draws them. */
function placeLabels(groups) {
  let out = ''
  for (const specs of groups.values()) {
    specs.sort((p, q) => p.x - q.x)
    let end = -Infinity
    for (const sp of specs) {
      sp.x = Math.max(sp.x, end + 6)
      end = sp.x + sp.w
    }
    for (const sp of specs) out += sp.draw(sp.x)
  }
  return out
}

function roomPill(cell, row) {
  const room = cell.room
  const list = cell.owners
  const busy = list.filter((a) => atDesk(a))
  const waiting = busy.some((a) => look(a) === 'waiting')
  const working = busy.some((a) => ['working', 'thinking', 'shell', 'error'].includes(look(a)))
  const color = waiting ? '#ff9a4d' : working ? '#c8f560' : '#7d8590'
  const stroke = waiting || working ? `stroke="${color}" stroke-opacity="0.5"` : 'stroke="#2e333b"'
  const name = fitText(room.name, `600 11px ${SANS}`, 190)
  const n = String(list.filter((a) => a.kind !== 'sub').length + list.filter((a) => a.kind === 'sub').length)
  const nameW = textWidth(name, `600 11px ${SANS}`)
  const w = Math.ceil(19 + nameW + 8 + 18 + 6)
  const x = cell.x + 10
  const y = row.top - 13
  return (
    `<g><title>${esc(room.path)}</title><rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="#0f1115" ${stroke}/>` +
    `<circle cx="${x + 11}" cy="${y + 9}" r="3" fill="${color}"/><text x="${x + 19}" y="${y + 13}" fill="#f3f4f1">${esc(name)}</text>` +
    `<rect x="${x + w - 24}" y="${y + 3}" width="18" height="12" rx="6" fill="#1b1f25"/><text x="${x + w - 15}" y="${y + 12.5}" text-anchor="middle" font-size="9.5" fill="#c9cdd3">${n}</text></g>`
  )
}

// ─── Render ─────────────────────────────────────────────────────────────────

const cacheKeys = {}
function setLayer(name, key, html) {
  if (cacheKeys[name] === key) return
  cacheKeys[name] = key
  layer[name].innerHTML = html
}

export function renderOffice(force = false) {
  if (!svg) return
  if (force) for (const k of Object.keys(cacheKeys)) delete cacheKeys[k]
  host.classList.toggle('no-names', !state.showNames)
  const list = agents()
  const p = makePlan(list)
  const selected = focusAgent()?.id ?? null
  if (!plan || plan.key !== p.key) {
    fitBox = { x: 0, y: -4, w: 900, h: p.bottom + 16 }
    if (autoFit && host.clientWidth) fit()
  }
  plan = p
  setLayer('building', `${p.key}|${document.fonts?.status}`, buildingSVG(p))
  setLayer('walls', `${p.key}|${document.fonts?.status}`, wallsSVG(p))

  positions.clear()
  let glow = ''
  let desks = ''
  let labels = ''
  /** Agent labels by row (desk row y, or a band of the kitchen), placed together so they don't overlap. */
  const rowsOfLabels = new Map()
  const addLabel = (key, spec) => {
    if (!rowsOfLabels.has(key)) rowsOfLabels.set(key, [])
    rowsOfLabels.get(key).push(spec)
  }
  let deskKey = ''
  let labelKey = `${selected}|${state.showNames}|`

  for (const row of p.rows) {
    row.cells.forEach((cell, k) => {
      const clip = `o-room-${row.top}-${k}`
      const bySeat = new Map([...cell.seats].map(([id, i]) => [i, cell.owners.find((a) => a.id === id)]))
      for (let i = 0; i < cell.deskRows * 2; i++) {
        const [x, y] = seatPos(cell, i)
        const a = bySeat.get(i)
        if (a && atDesk(a)) {
          const l = look(a)
          const sel = a.id === selected
          deskKey += `${a.id}:${l}:${sel}:${x},${y}:${a.seed};`
          if (l !== 'shell') glow += `<g clip-path="url(#${clip})"><circle cx="${x + 38}" cy="${y - 16}" r="60" fill="url(#${l === 'waiting' ? 'o-go' : l === 'error' ? 'o-gr' : 'o-gl'})"/></g>`
          desks += `<g class="o-agent" data-agent="${esc(a.id)}" transform="translate(${x} ${y})">${busyDesk(a, l, sel)}</g>`
          positions.set(a.id, [x + 38, y + 20])
          const labelText = sel ? nowText(a, l) : ''
          labelKey += `${a.id}:${l}:${a.name}:${labelText}:${x},${y};`
          addLabel(`d${y}`, sel ? mainLabel(a, l, x + 38, y + 62) : pill(a, l, x + 38, y + 58))
        } else {
          deskKey += `-:${x},${y};`
          desks += `<g transform="translate(${x} ${y})">${restDesk}</g>`
        }
      }
      if (cell.room) {
        labels += roomPill(cell, row)
        labelKey += `${cell.room.id}:${cell.owners.map((a) => look(a)).join(',')};`
      }
    })
  }

  // Idle main agents go to the kitchen; when it is full, to the corridor.
  const idle = list.filter((a) => a.kind !== 'sub' && !atDesk(a) && a.status !== 'done').sort((a, b) => a.startedAt - b.startedAt)
  let standingHTML = ''
  idle.forEach((a, i) => {
    const [x, y] = i < KITCHEN.length ? KITCHEN[i] : [70 + ((i - KITCHEN.length) % 11) * 74, p.yC + 42]
    const sel = a.id === selected
    const ring = sel ? 'stroke="#c9cdd3" stroke-opacity="0.8" stroke-dasharray="3 3"' : 'stroke="#7d8590" stroke-opacity="0.55"'
    standingHTML += `<g class="o-agent" data-agent="${esc(a.id)}" transform="translate(${x} ${y})"><ellipse cx="0" cy="0" rx="20" ry="6" fill="#7d8590" fill-opacity="0.12" ${ring} stroke-width="1.2"/>${standing(appearance(a), i < KITCHEN.length ? 'cup' : null)}<rect class="o-hit" x="-16" y="-60" width="32" height="66"/></g>`
    positions.set(a.id, [x, y - 24])
    labelKey += `${a.id}:idle:${a.name}:${x},${y};`
    addLabel(`s${Math.round(y / 30)}`, sel ? mainLabel(a, 'idle', x, y + 12) : pill(a, 'idle', x, y + 8, t('break')))
  })

  setLayer('desks', `${deskKey}|${glow.length}`, glow + desks)
  setLayer('standing', idle.map((a) => `${a.id}:${a.id === selected}`).join('|') + `|${p.key}`, standingHTML)
  labels += placeLabels(rowsOfLabels)
  setLayer('labels', `${labelKey}|${document.fonts?.status}`, `<g font-family="${SANS}" font-size="11" font-weight="600">${labels}</g>`)

  renderChrome(list, p)
  if (state.follow && selected && positions.has(selected) && document.getElementById('office').dataset.view === 'vector') {
    const pos = positions.get(selected)
    const last = renderOffice.lastFollow
    if (!last || last[0] !== pos[0] || last[1] !== pos[1] || renderOffice.lastSel !== selected) {
      renderOffice.lastFollow = pos
      renderOffice.lastSel = selected
      autoFit = false
      centerOn(pos, Math.max(1.6, fitView().w / view.w))
    }
  } else {
    renderOffice.lastFollow = null
  }
}

/** Pane header (projects · agents), the follow button and the legend in the corner. */
function renderChrome(list, p) {
  const roomsWithAgents = p.rows.flatMap((r) => r.cells).filter((c) => c.room).length
  $('office-sub').textContent = t('officeSub', { p: plural('projects', roomsWithAgents), a: plural('agents', list.length) })
  const sel = focusAgent()
  const btn = $('follow')
  btn.hidden = !sel
  if (sel) {
    btn.setAttribute('aria-pressed', String(state.follow))
    $('follow-text').textContent = t(state.follow ? 'following' : 'follow', sel.name)
  }
  const count = (fn) => list.filter(fn).length
  const working = count((a) => ['working', 'thinking', 'shell', 'error'].includes(look(a)))
  const waiting = count((a) => look(a) === 'waiting')
  const idle = count((a) => look(a) === 'idle')
  const legend = $('office-legend')
  const html = list.length
    ? `<span><span class="dot dot-lime"></span>${t('legendWorking')}<b>${working}</b></span>` +
      `<span><span class="dot dot-attention"></span>${t('legendWaiting')}<b>${waiting}</b></span>` +
      `<span><span class="dot"></span>${t('legendIdle')}<b>${idle}</b></span>`
    : ''
  if (legend._html !== html) {
    legend._html = html
    legend.innerHTML = html
  }
}
