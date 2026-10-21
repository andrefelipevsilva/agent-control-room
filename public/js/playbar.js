// The play bar under the panes: the selected agent's session on a timeline (your messages, tools, thinking), live by
// default. Pause freezes the flow where it is, the timeline scrubs it, "Review session" replays it from the start
// at 1×, 2×, 4× or 0.5×, and the live pill brings it back to now.

import { $, esc, clock, setHTML, clamp } from './util.js'
import { t } from './i18n.js'
import { state, update, now } from './store.js'
import { currentSession } from './flow.js'

const SPEEDS = [1, 2, 4, 0.5]
const BINS = 240
let timer = 0
let lastTotal = null
let audio = null

export function initPlaybar() {
  const bar = $('playbar')
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pb]')
    if (!b) return
    const s = range()
    if (!s) return
    const act = b.dataset.pb
    const cur = state.review
    if (act === 'live') return setReview(null)
    if (act === 'pause') return setReview(cur ? { ...cur, playing: !cur.playing } : { t: s.end, playing: false, speed: 1 })
    if (act === 'back') return setReview({ t: Math.max(s.start, (cur?.t ?? s.end) - 10_000), playing: cur?.playing ?? false, speed: cur?.speed ?? 1 })
    if (act === 'speed') {
      const next = (v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length]
      if (cur) return setReview({ ...cur, speed: next(cur.speed) })
      pendingSpeed = next(pendingSpeed)
      return renderPlaybar()
    }
    if (act === 'review') return setReview({ t: s.start, playing: true, speed: cur?.speed ?? pendingSpeed })
    if (act === 'sound') return update({ sound: !state.sound })
  })

  // Scrubbing the timeline.
  bar.addEventListener('pointerdown', (e) => {
    const track = e.target.closest('.pb-track')
    if (!track || e.button !== 0) return
    track.setPointerCapture(e.pointerId)
    scrubbing = true
    const seek = (ev) => {
      const s = range()
      if (!s) return
      const r = track.getBoundingClientRect()
      const k = clamp((ev.clientX - r.left) / r.width, 0, 1)
      const tt = s.start + k * (s.end - s.start)
      setReview(k > 0.995 && !state.review ? null : { t: tt, playing: state.review?.playing ?? false, speed: state.review?.speed ?? 1 })
    }
    seek(e)
    const up = () => {
      scrubbing = false
      track.removeEventListener('pointermove', seek)
      track.removeEventListener('pointerup', up)
    }
    track.addEventListener('pointermove', seek)
    track.addEventListener('pointerup', up)
  })
}

let pendingSpeed = 1
let scrubbing = false
function setReview(review) {
  update({ review })
  clearInterval(timer)
  if (review?.playing) {
    timer = setInterval(() => {
      const s = range()
      const r = state.review
      if (!s || !r || !r.playing) return clearInterval(timer)
      const tt = r.t + 100 * r.speed
      if (tt >= s.end) {
        clearInterval(timer)
        update({ review: null })
      } else update({ review: { ...r, t: tt } })
    }, 100)
  }
}

function range() {
  const cur = currentSession()
  const data = cur?.data
  if (!data) return null
  const ticks = data.ticks ?? []
  const start = data.startedAt ?? ticks[0]?.[0] ?? cur.agent.startedAt
  const end = Math.max(now(), ticks.at(-1)?.[0] ?? 0)
  return start && end > start ? { start, end, ticks, events: data.events ?? [], agent: cur.agent } : null
}

/** One tick per pixel bucket: you > error > tool > thinking. */
function bins(ticks, start, end) {
  const out = new Array(BINS).fill(null)
  const rank = { you: 4, err: 3, tool: 2, think: 1 }
  for (const [tt, kind] of ticks) {
    if (kind === 'end') continue
    const k = kind === 'user' ? 'you' : kind === 'think' ? 'think' : kind === 'err' ? 'err' : 'tool'
    const i = Math.min(BINS - 1, Math.max(0, Math.floor(((tt - start) / (end - start)) * BINS)))
    if (!out[i] || rank[k] > rank[out[i]]) out[i] = k
  }
  return out
}

function beep() {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.04, audio.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12)
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + 0.13)
  } catch {}
}

export function renderPlaybar() {
  const bar = $('playbar')
  // Redrawing would replace the track under the pointer while it is being dragged.
  if (scrubbing) return moveHead(bar)
  const s = range()
  if (!s || $('flow').dataset.tab === 'agentflow') return setHTML(bar, '')
  const r = state.review
  const cursor = r?.t ?? s.end
  const span = s.end - s.start
  const pct = (tt) => clamp(((tt - s.start) / span) * 100, 0, 100)

  // A soft tick for each new step while live, when the sound is on.
  const total = s.ticks.length
  if (state.sound && !r && lastTotal != null && total > lastTotal) beep()
  lastTotal = total

  let marks = ''
  bins(s.ticks, s.start, s.end).forEach((k, i) => {
    if (!k) return
    const left = (i / BINS) * 100
    const future = r && s.start + (i / BINS) * span > cursor
    marks += `<span class="pb-tick ${k === 'tool' ? '' : k}${future ? ' future' : ''}" data-style="left:${left.toFixed(2)}%"></span>`
  })
  // Subagent runs as blue spans on the rail.
  for (const ev of s.events) {
    if (ev.k !== 'sub' || !ev.dur) continue
    const a = pct(ev.t)
    const b = pct(ev.t + ev.dur)
    if (b - a >= 0.3) marks += `<span class="pb-span" data-style="left:${a.toFixed(2)}%;width:${(b - a).toFixed(2)}%"></span>`
  }

  const playIcon = r?.playing === false || !r
    ? (r ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>')
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>'
  const playLabel = r && !r.playing ? t('play') : t('pause')
  const speed = r?.speed ?? pendingSpeed
  const html =
    `<div class="pb-group">` +
    (r
      ? `<button type="button" class="pb-live review" data-pb="live" title="${t('backLive')}"><span class="live-dot"></span>${t('reviewing')}</button>`
      : `<span class="pb-live"><span class="live-dot"></span>${t('live')}</span>`) +
    `<button type="button" class="pb-btn solid" data-pb="pause" aria-label="${playLabel}" title="${playLabel}">${playIcon}</button>` +
    `<button type="button" class="pb-btn" data-pb="back" aria-label="${t('back10')}" title="${t('back10')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 6.5v11L3.5 12zM20 6.5v11L12.5 12z"/></svg></button>` +
    `<span class="pb-clock">${clock(cursor - s.start)}</span></div>` +
    `<div class="pb-track-wrap"><div class="pb-track" role="slider" tabindex="0" aria-label="${esc(t('timelineLabel', s.agent.name, s.ticks.length))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct(cursor))}">` +
    `<span class="pb-rail"></span>${marks}<span class="pb-head${r ? ' review' : ''}" data-style="left:${pct(cursor).toFixed(2)}%"></span></div>` +
    `<div class="pb-legend"><span>${hm(s.start)}</span><span class="keys"><span><i></i>${t('tlYou')}</span><span><i class="tools"></i>${t('tlTools')}</span><span><i class="think"></i>${t('tlThinking')}</span></span><span>${r ? hm(cursor) : t('now')}</span></div></div>` +
    `<div class="pb-group">` +
    `<button type="button" class="pb-btn" data-pb="sound" aria-pressed="${state.sound}" aria-label="${t('sound')}" title="${t('sound')}">${state.sound ? SOUND_ON : SOUND_OFF}</button>` +
    `<button type="button" class="pb-btn pb-speed" data-pb="speed">${String(speed).replace('.', ',')}×</button>` +
    `<button type="button" class="btn btn-lime" data-pb="review"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>${t('review')}</button>` +
    `</div>`
  setHTML(bar, html)
}

function moveHead(bar) {
  const s = range()
  const head = bar.querySelector('.pb-head')
  if (!s || !head) return
  const cursor = state.review?.t ?? s.end
  head.style.left = `${clamp(((cursor - s.start) / (s.end - s.start)) * 100, 0, 100).toFixed(2)}%`
  head.classList.toggle('review', !!state.review)
  const c = bar.querySelector('.pb-clock')
  if (c) c.textContent = clock(cursor - s.start)
}

const hm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const SOUND_ON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
const SOUND_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
