// Small helpers shared by the room's modules.

/** Escapes text for HTML and SVG markup. Everything that comes from a session (names, titles, commands) goes through it. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const $ = (id) => document.getElementById(id)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 32-bit FNV-1a, the same hash Habblaud uses for room seeds. */
export function hash32(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic pseudo-random sequence from a seed (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const pick = (r, list) => list[Math.floor(r() * list.length) % list.length]

/** 26:46, or 1:04:12 past an hour. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

/** Short duration: 4s, 1m12s, 2h10. */
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** Countdown to a reset: 4h25, 6d14h, 12min. */
export function until(ms) {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

/** 3,1k / 8,4k / 1,2M in the page's number format. */
export function tokens(n, locale) {
  const v = Number(n) || 0
  if (v < 1000) return String(Math.round(v))
  const fmt = (x) => x.toLocaleString(locale, { maximumFractionDigits: x < 10 ? 1 : 0 })
  if (v < 1e6) return `${fmt(v / 1000)}k`
  return `${fmt(v / 1e6)}M`
}

export function money(usd, locale) {
  const v = Number(usd) || 0
  return `US$ ${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** HH:MM in local time. */
export const hhmm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Last path segment, for both separators. */
export const basename = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''

let measureCtx = null
/** Text width in CSS px for a canvas font string (labels in the SVG office are sized with it). */
export function textWidth(text, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/**
 * The room's CSP has no 'unsafe-inline' for styles, so markup carries dynamic styles in data-style and this applies
 * them through the CSSOM (allowed) after the markup is in the page.
 */
export function hydrate(root) {
  for (const el of root.querySelectorAll('[data-style]')) {
    el.style.cssText = el.dataset.style
    el.removeAttribute('data-style')
  }
  return root
}

/** Sets innerHTML only when it changed (keeps focus, hover and running CSS animations), then hydrates it. */
export function setHTML(el, html) {
  if (el._html === html) return false
  // Keyboard focus survives the swap when the focused element carries a data key the new markup also has.
  const active = el.contains(document.activeElement) ? document.activeElement : null
  const key = active && [...active.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-style')
  el._html = html
  el.innerHTML = html
  hydrate(el)
  if (key) el.querySelector(`[${key.name}="${CSS.escape(key.value)}"]`)?.focus()
  return true
}

/** Read and write a JSON value in localStorage without ever throwing. */
export const saved = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  },
}

/** Splits a shell command into "$ <fn> args" markup. */
export function shellMarkup(cmd) {
  const text = String(cmd ?? '').replace(/\s+/g, ' ').trim()
  const m = text.match(/^(\S+)(.*)$/)
  if (!m) return ''
  return `<span class="p">$ </span><span class="fn">${esc(m[1])}</span>${esc(m[2])}`
}

/** Pulls the argument out of a Claude Code style title: "Bash(npm test)" → { tool: "Bash", arg: "npm test" }. */
export function parseToolTitle(title) {
  const m = String(title ?? '').match(/^([\w.:-]+)\((.*)\)$/s)
  return m ? { tool: m[1], arg: m[2] } : { tool: '', arg: String(title ?? '') }
}

export const ICON = {
  spinner: '<svg class="spinner cr-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  cup: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/></svg>',
  chevron: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  arrowOut: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8.5 7H17v8.5"/></svg>',
  target: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  clock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/></svg>',
  terminal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7l5 5-5 5M12 18h7"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/></svg>',
  tool: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5a4 4 0 0 0-5.3 5.1L4 16.8V20h3.2l5.2-5.2a4 4 0 0 0 5.1-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  branch: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-4 4.8-10.4 6.3"/></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
  reply: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16v10H8l-4 4z"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8f560" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff5d5d" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  hand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.9-2.6L3.8 14.8a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg>',
}
