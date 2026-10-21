// The flow pane: one agent at a time (picked in the header, or by clicking it anywhere). "Graph" is the session as a
// git graph: each step a point on the agent's line, subagents branch off and come back. "Files", "Chat" and "Cost"
// are other cuts of the same session, and "Agent Flow" is Agent Flow's original graph.
// Steps come from the Claude Code transcript (read by the room server, /control-room/session); for sessions it can't
// read (Codex) they come from Habblaud's activity history.

import { $, esc, clock, dur, tokens, money, hhmm, setHTML, ICON, shellMarkup } from './util.js'
import { t, locale } from './i18n.js'
import { avatarHTML } from './avatar.js'
import { activityLine, pendingCommand } from './sidebar.js'
import { state, now, look, agents, grouped, roomById, accountBadge, accountStyle, focusAgent } from './store.js'

const TABS = ['graph', 'files', 'chat', 'cost', 'agentflow']
const SHOW_LAST = 10
const POLL_MS = 1500

let handlers = {}
let persist = () => {}
let agentFlow = { url: () => null, up: () => false }

/** agentId → { supported, data, rev, at } */
const sessions = new Map()
const expanded = new Set()
let loading = null
let pickerOpen = false
/** agentId → last fetch attempt, so a failing fetch is not retried in a tight loop. */
const attempts = new Map()

export function initFlow(h, save, af) {
  handlers = h
  persist = save
  agentFlow = af
  $('flow-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]')
    if (b) setFlowTab(b.dataset.tab)
  })
  $('picker-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    pickerOpen = !pickerOpen
    renderPicker()
  })
  $('picker-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-agent]')
    if (!b) return
    pickerOpen = false
    handlers.select?.(b.dataset.agent)
    renderPicker()
  })
  document.addEventListener('click', (e) => {
    if (pickerOpen && !$('picker-list').contains(e.target)) {
      pickerOpen = false
      renderPicker()
    }
  })
  $('flow-native').addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]')
    if (more) {
      expanded.add(more.dataset.more)
      renderFlow()
    }
  })
  setInterval(refresh, POLL_MS)
}

export function setFlowTab(tab, save = true) {
  if (!TABS.includes(tab)) tab = 'graph'
  const flow = $('flow')
  flow.dataset.tab = tab
  for (const b of $('flow-tabs').querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab))
  if (tab === 'agentflow') loadAgentFlow()
  if (save) persist()
  renderFlow()
}

function loadAgentFlow() {
  const frame = $('frame-agentFlow')
  const url = agentFlow.url()
  if (!frame.getAttribute('src') && url && agentFlow.up()) frame.src = url
}

/** The session data of the agent the flow shows (the play bar reads it too). */
export function currentSession() {
  const a = focusAgent()
  return a ? { agent: a, ...(sessions.get(a.id) ?? {}) } : null
}

// ─── Loading ────────────────────────────────────────────────────────────────

async function refresh() {
  const a = focusAgent()
  if (!a || loading === a.id || document.hidden) return
  if ($('flow').dataset.tab === 'agentflow') return loadAgentFlow()
  if (Date.now() - (attempts.get(a.id) ?? 0) < POLL_MS - 100) return
  attempts.set(a.id, Date.now())
  const cur = sessions.get(a.id)
  loading = a.id
  try {
    if (cur?.supported === false) {
      // Habblaud's history (≤200 activities) for sessions the room can't read.
      if (cur.at && Date.now() - cur.at < 3000) return
      const res = await fetch(`/api/agents/${encodeURIComponent(a.id)}`, { cache: 'no-store' })
      const detail = res.ok ? await res.json() : null
      sessions.set(a.id, { supported: false, at: Date.now(), data: fromHistory(detail?.history ?? a.recent ?? []) })
    } else {
      const q = new URLSearchParams({ agent: a.id })
      if (cur?.rev) q.set('rev', cur.rev)
      const res = await fetch(`session?${q}`, { cache: 'no-store' })
      const body = res.ok ? await res.json() : { supported: false }
      if (body.supported === false) sessions.set(a.id, { supported: false, at: 0, data: fromHistory(a.recent ?? []) })
      else if (!body.same) sessions.set(a.id, { supported: true, rev: body.rev, at: Date.now(), data: body })
    }
  } catch {
  } finally {
    loading = null
  }
  if (sessions.size > 30) sessions.delete(sessions.keys().next().value)
  renderFlow()
}

/** Habblaud activities → the same step shape the transcript gives. */
function fromHistory(list) {
  const events = list.filter((x) => x.kind !== 'wait').map((x) => {
    if (x.kind === 'done') return { k: 'note', t: x.at, text: x.text }
    if (x.kind === 'prompt') return { k: 'user', t: x.at, text: x.detail ?? x.text }
    if (x.kind === 'think') return { k: 'think', t: x.at, dur: x.durationMs ?? null, text: '' }
    if (x.kind === 'respond') return { k: 'text', t: x.at, text: x.detail ?? x.text }
    if (x.kind === 'delegate') return { k: 'sub', t: x.at, type: x.tool ?? '', desc: x.detail ?? x.text, status: 'ok', dur: x.durationMs }
    return {
      k: 'tool',
      t: x.at,
      tool: x.tool ?? x.kind,
      label: x.tool ?? x.kind,
      arg: x.detail ?? x.text,
      kind: ['run', 'test', 'git'].includes(x.kind) ? 'shell' : ['edit', 'write', 'read'].includes(x.kind) ? 'file' : x.kind,
      status: x.error ? 'err' : 'ok',
      dur: x.durationMs,
    }
  })
  return { events, total: events.length, ticks: events.map((e) => [e.t, e.k === 'tool' ? 'tool' : e.k]), files: [], startedAt: events[0]?.t ?? null, historyOnly: true }
}

// ─── Header: agent picker ───────────────────────────────────────────────────

function renderPicker() {
  const a = focusAgent()
  const btn = $('picker-btn')
  setHTML(btn, a ? `${avatarHTML(a, { size: 'avatar-sm', ring: ringFor(a) })}<span class="label">${esc(a.name)}</span>${ICON.chevron}` : '')
  btn.setAttribute('aria-expanded', String(pickerOpen))
  const list = $('picker-list')
  list.hidden = !pickerOpen
  if (!pickerOpen) return
  const html = grouped(agents())
    .map(({ room, agents: items }) =>
      `<div class="section-k">${esc(room.name)}</div>` +
      items
        .map((x) =>
          `<button type="button" class="picker-item" role="option" data-agent="${esc(x.id)}" aria-selected="${x.id === a?.id}">` +
          `${avatarHTML(x, { size: 'avatar-sm', ring: ringFor(x) })}<span class="who"><span class="who-line"><span class="who-name">${esc(x.name)}</span>${accountBadge(x.account).html}<span class="who-role">${esc(x.kind === 'sub' ? x.role : t('main'))}</span></span>${activityLine(x)}</span></button>`,
        )
        .join(''),
    )
    .join('')
  setHTML(list, html)
}

const ringFor = (a) => ({ working: 'ring-working', thinking: 'ring-working', shell: 'ring-working', waiting: 'ring-waiting', error: 'ring-error' })[look(a)] ?? ''

// ─── Graph ──────────────────────────────────────────────────────────────────

const CONTEXT_MAX = (model) => (/haiku/i.test(model ?? '') ? 200_000 : 1_000_000)

function sessionCard(a, data) {
  const acc = accountStyle(a.account)
  const role = a.kind === 'sub' ? a.role : t('main')
  const ctx = data?.context ?? 0
  const max = Math.max(CONTEXT_MAX(data?.model ?? a.model), ctx)
  const pct = max ? Math.min(100, (ctx / max) * 100) : 0
  const cost = typeof data?.cost === 'number' ? data.cost : a.stats?.costUSD
  const folder = data?.cwd ?? roomById(a.roomId)?.path ?? ''
  const started = data?.startedAt ?? a.startedAt
  return (
    `<div class="card"><div class="card-head">${avatarHTML(a, { size: 'avatar-lg', ring: ringFor(a) })}` +
    `<div class="card-who"><div class="card-name"><b>${esc(a.name)}</b>${accountBadge(a.account).html}<span>${esc(role)} · ${esc(acc.name)}</span></div>` +
    (a.title ? `<div class="card-title">${esc(a.title)}</div>` : '') +
    `</div><div class="card-clock">${ICON.clock}${clock(now() - started)}</div></div>` +
    `<div class="card-stats">` +
    (ctx
      ? `<div class="stat"><span class="stat-k">${t('context')}</span><span class="stat-bar"><span class="bar"><i data-style="width:${pct.toFixed(1)}%"></i></span><span class="stat-v">${tokens(ctx, locale)} / ${tokens(max, locale)}</span></span></div>`
      : '') +
    (typeof cost === 'number' ? `<div class="stat"><span class="stat-k">${t('cost')}</span><span class="stat-v">${money(cost, locale)}</span></div>` : '') +
    `<div class="stat"><span class="stat-k">${t('folder')}</span><span class="stat-v" title="${esc(folder)}">${esc(folder)}</span></div>` +
    `</div></div>`
  )
}

const rail = (line = '', node = '') => `<div class="g-rail" aria-hidden="true"><div class="g-line ${line}"></div>${node}</div>`

const TOOL_ICON = { shell: ICON.terminal, file: ICON.file, search: ICON.search, web: ICON.globe }

function toolStep(ev) {
  const err = ev.status === 'err'
  const isFile = ev.kind === 'file'
  const label = ev.tool === 'PowerShell' ? 'PWSH' : String(ev.label ?? ev.tool ?? '').toUpperCase()
  const arg = ev.kind === 'shell' ? esc(ev.arg) : esc(ev.arg)
  const lines = (ev.add ? `<span class="step-add">+${ev.add}</span>` : '') + (ev.del ? `<span class="step-del">−${ev.del}</span>` : '')
  const took = ev.kind === 'shell' && ev.dur != null && ev.status !== 'run' ? `<span class="step-dur">${err ? ICON.cross : ICON.check}${dur(ev.dur)}</span>` : err ? `<span class="step-dur">${ICON.cross}</span>` : ''
  const title = err && ev.error ? ` title="${esc(ev.error)}"` : ev.desc ? ` title="${esc(ev.desc)}"` : ''
  return (
    `<div class="step${err ? ' err' : ''}"${title}><span class="step-ic">${TOOL_ICON[ev.kind] ?? ICON.tool}</span>` +
    `<span class="step-tool">${esc(label)}</span><span class="step-arg${isFile ? ' path' : ''}">${arg}</span>${lines}${took}` +
    `<span class="step-time">${hhmm(ev.t)}</span></div>`
  )
}

function subStep(ev) {
  const nTools = ev.tools ?? null
  const running = ev.status === 'run' || (ev.status === 'bg' && !ev.bgDone)
  const tags = [
    nTools != null ? `<span class="tag">${nTools === 1 ? t('tools1') : t('tools', nTools)}</span>` : '',
    ev.tok ? `<span class="tag">${tokens(ev.tok, locale)} tok</span>` : '',
    running
      ? `<span class="tag">${ICON.spinner}${t('running')}</span>`
      : ev.status === 'err'
        ? `<span class="tag">${ICON.cross}${esc(ev.error ?? '')}</span>`
        : `<span class="tag">${ICON.check}${t('backToMain')}</span>`,
  ].join('')
  return (
    `<div class="g-row"><div class="g-rail" aria-hidden="true"><div class="g-line"></div>` +
    `<svg class="g-branch-in" width="36" height="20" viewBox="0 0 36 20" fill="none"><path d="M14 0C14 11 30 7 30 20" stroke="#8ab4ff" stroke-width="2" stroke-opacity="0.75"/></svg>` +
    `<div class="g-branch-line"></div>` +
    (running ? '' : `<svg class="g-branch-out" width="36" height="20" viewBox="0 0 36 20" fill="none"><path d="M30 0C30 13 14 9 14 20" stroke="#8ab4ff" stroke-width="2" stroke-opacity="0.75"/></svg>`) +
    `<div class="g-node branch"></div></div>` +
    `<div class="g-body pl"><div class="bubble sub"><div class="bubble-head">${ICON.branch}${t('subagent')} · ${esc(ev.type)}<span class="meta">${ev.dur != null ? dur(ev.dur) : ''}</span></div>` +
    (ev.desc ? `<div class="bubble-text">${esc(ev.desc)}</div>` : '') +
    `<div class="tags">${tags}</div></div></div></div>`
  )
}

function eventRow(ev, isLast, live) {
  if (ev.k === 'sub') return subStep(ev)
  if (ev.k === 'user') {
    return `<div class="g-row">${rail('', '<div class="g-node you"></div>')}<div class="g-body"><div class="bubble you"><div class="bubble-head">${ICON.user}${t('you')}<span class="meta">${hhmm(ev.t)}</span></div><div class="bubble-text">${esc(ev.text)}</div></div></div></div>`
  }
  if (ev.k === 'think') {
    const meta = [ev.dur != null ? dur(ev.dur) : '', ev.tok ? `${tokens(ev.tok, locale)} tok` : ''].filter(Boolean).join(' · ')
    const thinkingNow = isLast && live
    return (
      `<div class="g-row">${rail(thinkingNow ? 'live' : '', `<div class="g-node${thinkingNow ? ' live' : ''}"></div>`)}<div class="g-body"><div class="bubble think${thinkingNow ? ' live' : ''}">` +
      `<div class="bubble-head">${ICON.chat}${t('thinkingStep')}${thinkingNow ? '<span class="dots"><i class="cr-d1"></i><i class="cr-d2"></i><i class="cr-d3"></i></span>' : ''}<span class="meta">${meta || hhmm(ev.t)}</span></div>` +
      (ev.text ? `<div class="bubble-text clamp">${esc(ev.text)}</div>` : '') +
      `</div></div></div>`
    )
  }
  if (ev.k === 'text') {
    return `<div class="g-row">${rail('', '<div class="g-node"></div>')}<div class="g-body"><div class="bubble"><div class="bubble-head">${ICON.reply}${t('reply')}<span class="meta">${hhmm(ev.t)}</span></div><div class="bubble-text clamp">${esc(ev.text)}</div></div></div></div>`
  }
  if (ev.k === 'note') return `<div class="g-row">${rail('', '<div class="g-node dim"></div>')}<div class="g-body"><div class="tail">— ${esc(ev.text)}</div></div></div>`
  return `<div class="g-row">${rail('', `<div class="g-node${ev.status === 'err' ? ' err' : ''}"></div>`)}<div class="g-body">${toolStep(ev)}</div></div>`
}

/** The running tool at the end: live, or waiting for your permission. */
function liveRow(a, ev, l) {
  if (l === 'waiting') {
    const cmd = pendingCommand(a) || (ev.kind === 'shell' ? shellMarkup(ev.arg) : esc(ev.arg))
    return (
      `<div class="g-row">${rail('live', '<div class="g-node live"></div>')}<div class="g-body"><div class="bubble wait">` +
      `<div class="bubble-head">${ICON.hand}${t('permission')} · ${esc(ev.label ?? ev.tool)} · ${t('waitingYou')}<span class="meta">${clock(now() - (a.permission?.createdAt ?? a.statusSince))}</span></div>` +
      `<div class="bubble-cmd">${cmd}</div><div class="bubble-text">${t('answerInTerminal')}</div></div></div></div>`
    )
  }
  const isShell = ev.kind === 'shell'
  return (
    `<div class="g-row">${rail('live-dashed', '<div class="g-node live"></div>')}<div class="g-body"><div class="bubble live">` +
    `<div class="bubble-head">${TOOL_ICON[ev.kind] ?? ICON.tool}${esc(ev.label ?? ev.tool)} · ${t('running')}${ICON.spinner}<span class="meta">${dur(now() - ev.t)}</span></div>` +
    `<div class="bubble-cmd">${isShell ? shellMarkup(ev.arg) : `<span class="${ev.kind === 'file' ? 'str' : ''}">${esc(ev.arg)}</span>`}</div>` +
    (isShell && ev.desc ? `<div class="bubble-path">${ICON.folder}<span>${esc(ev.desc)}</span></div>` : '') +
    `</div></div></div>` +
    `<div class="g-row"><div class="g-rail" aria-hidden="true"><div class="g-line live-dashed top-half"></div></div><div class="g-body"><div class="tail"><span class="cursor cr-blink"></span>${isShell ? t('waitingOutput') : t('running')}</div></div></div>`
  )
}

function graphHTML(a, entry) {
  if (!entry?.data) return `<div class="empty">${t('loading')}</div>`
  const data = entry.data
  const cursor = state.review?.t ?? null
  let events = cursor == null ? data.events : data.events.filter((e) => e.t <= cursor)
  if (!events.length) return sessionCard(a, data) + `<div class="empty">${t('noSteps')}</div>`
  const l = look(a)
  const live = cursor == null && ['working', 'thinking', 'waiting', 'shell', 'error'].includes(l)
  const last = events.at(-1)
  const lastRunning = live && last.k === 'tool' && last.status === 'run'
  const body = lastRunning ? events.slice(0, -1) : events
  const showAll = expanded.has(a.id)
  const hidden = showAll ? 0 : Math.max(0, body.length - SHOW_LAST)
  const shown = body.slice(hidden)
  const totalHidden = hidden + Math.max(0, (data.total ?? events.length) - data.events.length)
  let html = sessionCard(a, data) + `<div class="graph">`
  if (totalHidden) {
    const from = body[0]?.t
    const to = body[hidden - 1]?.t ?? from
    html += `<div class="g-row">${rail('dashed', '<div class="g-node dim"></div>')}<div class="g-body"><button type="button" class="more" data-more="${esc(a.id)}"${hidden ? '' : ' disabled'}>${ICON.chevron}${t('showEarlier', totalHidden)}<span class="step-time">${from ? `${hhmm(from)} → ${hhmm(to)}` : ''}</span></button></div></div>`
  }
  shown.forEach((ev, i) => (html += eventRow(ev, i === shown.length - 1 && !lastRunning, live && l === 'thinking')))
  if (lastRunning) html += liveRow(a, last, l)
  else if (live && l === 'waiting') html += liveRow(a, { kind: 'other', label: a.permission?.tool ?? '', arg: '' }, l)
  if (data.historyOnly) html += `<p class="cost-note">${t('readOnlyHistory')}</p>`
  return html + `</div>`
}

// ─── Files, chat, cost ──────────────────────────────────────────────────────

function filesHTML(entry) {
  const files = entry?.data?.files ?? []
  if (!files.length) return `<div class="empty">${entry?.data ? t('filesEmpty') : t('loading')}</div>`
  return (
    `<div class="list">` +
    files
      .map((f) => {
        const ops = [f.reads ? (f.reads === 1 ? t('read1') : t('reads', f.reads)) : '', f.edits ? (f.edits === 1 ? t('edit1') : t('edits', f.edits)) : ''].filter(Boolean).join(' · ')
        return `<div class="file-row" title="${esc(f.path)}"><span class="path">${esc(f.path)}</span><span class="ops">${ops}</span><span class="step-add">${f.add ? `+${f.add}` : ''}</span><span class="step-del">${f.del ? `−${f.del}` : ''}</span></div>`
      })
      .join('') +
    `</div>`
  )
}

function chatHTML(entry) {
  const msgs = (entry?.data?.events ?? []).filter((e) => e.k === 'user' || e.k === 'text')
  if (!msgs.length) return `<div class="empty">${entry?.data ? t('chatEmpty') : t('loading')}</div>`
  return (
    `<div class="list">` +
    msgs
      .map((m) =>
        m.k === 'user'
          ? `<div class="bubble you"><div class="bubble-head">${ICON.user}${t('you')}<span class="meta">${hhmm(m.t)}</span></div><div class="bubble-text">${esc(m.text)}</div></div>`
          : `<div class="bubble"><div class="bubble-head">${ICON.reply}${t('reply')}<span class="meta">${hhmm(m.t)}</span></div><div class="bubble-text">${esc(m.text)}</div></div>`,
      )
      .join('') +
    `</div>`
  )
}

function costHTML(a, entry) {
  const data = entry?.data
  const u = data?.usage
  const cost = typeof data?.cost === 'number' ? data.cost : a.stats?.costUSD
  const tile = (k, v) => `<div class="cost-tile"><span class="stat-k">${k}</span><span class="big">${v}</span></div>`
  let html = `<div class="cost-grid">`
  if (typeof cost === 'number') html += tile(t('cost'), money(cost, locale))
  if (data?.context) html += tile(t('context'), tokens(data.context, locale))
  if (u) {
    html += tile(t('tokensIn'), tokens(u.input, locale)) + tile(t('tokensOut'), tokens(u.output, locale))
    html += tile(t('cacheRead'), tokens(u.cacheRead, locale)) + tile(t('cacheWrite'), tokens(u.cacheWrite, locale))
  } else if (a.stats) {
    html += tile(t('tokensIn'), tokens(a.stats.tokensIn, locale)) + tile(t('tokensOut'), tokens(a.stats.tokensOut, locale))
  }
  const add = data?.lines?.add || a.stats?.linesAdded
  const del = data?.lines?.del || a.stats?.linesRemoved
  if (add || del) html += `<div class="cost-tile"><span class="stat-k">+/−</span><span class="big"><span class="step-add">+${add ?? 0}</span> <span class="step-del">−${del ?? 0}</span></span></div>`
  html += `</div>`
  // The agent and its subagents, by Habblaud's cost per agent.
  const family = agents().filter((x) => x.id === a.id || x.parentId === a.id)
  if (family.length > 1) {
    html += `<div class="section-k">${t('byAgent')}</div><div class="list">` +
      family.map((x) => `<div class="cost-row"><span class="k">${esc(x.name)} · ${esc(x.kind === 'sub' ? x.role : t('main'))}</span><span class="v">${tokens((x.stats?.tokensIn ?? 0) + (x.stats?.tokensOut ?? 0), locale)} tok</span><span class="v">${typeof x.stats?.costUSD === 'number' ? money(x.stats.costUSD, locale) : '—'}</span></div>`).join('') +
      `</div>`
  }
  return html + `<p class="cost-note">${t('costNote')}</p>`
}

// ─── Render ─────────────────────────────────────────────────────────────────

let lastKey = ''
export function renderFlow() {
  renderPicker()
  const tab = $('flow').dataset.tab
  if (tab === 'agentflow') return
  const host = $('flow-native')
  const a = focusAgent()
  if (!a) {
    setHTML(host, `<div class="empty"><b>${t(agents().length ? 'noAgentTitle' : 'noAgentsTitle')}</b>${agents().length ? '' : `<br>${t('noAgentsHint')}`}</div>`)
    return
  }
  const entry = sessions.get(a.id)
  if (!entry && loading !== a.id) queueMicrotask(refresh)
  const html =
    tab === 'files' ? filesHTML(entry) : tab === 'chat' ? chatHTML(entry) : tab === 'cost' ? costHTML(a, entry) : graphHTML(a, entry)
  // Stay pinned to the bottom (latest step) unless the viewer scrolled up.
  const key = `${a.id}|${tab}`
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40
  const changed = setHTML(host, html)
  if (changed && (atBottom || key !== lastKey) && tab !== 'cost' && tab !== 'files') host.scrollTop = host.scrollHeight
  if (key !== lastKey && (tab === 'cost' || tab === 'files')) host.scrollTop = 0
  lastKey = key
}

