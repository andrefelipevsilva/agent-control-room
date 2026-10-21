// Top bar counters and the sidebar: search, account chips, "needs you", projects with their agents, and the
// accounts' usage limits.

import { $, esc, clock, until, setHTML, parseToolTitle, shellMarkup, ICON } from './util.js'
import { t, plural } from './i18n.js'
import { avatarHTML } from './avatar.js'
import {
  state, update, now, look, agents, accounts, filtered, grouped, roomById, accountBadge, accountStyle, focusAgent,
} from './store.js'

let actions = {}

export function initSidebar(handlers) {
  actions = handlers
  const search = $('search')
  search.addEventListener('input', () => update({ query: search.value }))
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = ''
      update({ query: '' })
      search.blur()
    }
  })

  $('counters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]')
    if (!b) return
    const f = b.dataset.filter
    update({ status: f === 'all' || state.status === f ? 'all' : f })
  })

  $('account-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-account]')
    if (b) update({ account: b.dataset.account })
  })

  $('side').addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-project]')
    if (toggle) {
      const id = toggle.dataset.project
      const closed = state.closedProjects.includes(id) ? state.closedProjects.filter((x) => x !== id) : [...state.closedProjects, id]
      return update({ closedProjects: closed })
    }
    const locate = e.target.closest('[data-locate]')
    if (locate) return actions.locate?.(locate.dataset.locate)
    const flow = e.target.closest('[data-see-flow]')
    if (flow) return actions.seeInFlow?.(flow.dataset.seeFlow)
    const row = e.target.closest('[data-agent]')
    if (row) actions.select?.(row.dataset.agent)
  })
}

const ringFor = (a) => ({ working: 'ring-working', thinking: 'ring-working', shell: 'ring-working', waiting: 'ring-waiting', error: 'ring-error' })[look(a)] ?? ''

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t('ago', `${s}s`)
  const m = Math.round(s / 60)
  return t('ago', m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`)
}

/** The agent's current step, as the sidebar and the flow picker show it. */
export function activityLine(a, { selected = false } = {}) {
  const l = look(a)
  const text = esc(a.activity?.text ?? '')
  if (l === 'waiting') return `<span class="act act-waiting"><span class="dot dot-attention"></span><span class="t">${esc(a.waitingFor ? capital(a.waitingFor) : a.activity?.text ?? t('needsYouShort'))}</span></span>`
  if (l === 'error') return `<span class="act act-error"><span class="dot" data-style="background:#ff5d5d"></span><span class="t">${text}</span></span>`
  if (l === 'thinking') return `<span class="act act-working"><span class="dot dot-lime"></span><span class="t">${t('thinking')}</span><span class="dots"><i class="cr-d1"></i><i class="cr-d2"></i><i class="cr-d3"></i></span></span>`
  if (l === 'working') return `<span class="act act-working">${selected ? ICON.spinner : '<span class="dot dot-lime"></span>'}<span class="t">${text}</span></span>`
  if (l === 'shell') return `<span class="act act-working">${ICON.terminal}<span class="t">${esc(a.shells?.[0]?.label ?? t('shell'))}</span></span>`
  if (l === 'done') return `<span class="act act-idle">${ICON.check}<span class="t">${text || t('done')}</span></span>`
  return `<span class="act act-idle">${ICON.cup}<span class="t">${t('idleKitchen')}</span></span>`
}

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Time shown next to the name: how long in the current state, or the state when nothing is running. */
function timeLabel(a) {
  const l = look(a)
  if (l === 'idle') return t('idle')
  if (l === 'done') return t('done')
  return clock(now() - (a.statusSince ?? a.startedAt))
}

function roleLabel(a) {
  if (a.kind === 'sub') return a.role || ''
  return t('main')
}

function agentRow(a, selectedId) {
  const l = look(a)
  const sel = a.id === selectedId
  const cls = ['agent-row', a.kind === 'sub' ? 'sub' : '', l === 'idle' || l === 'done' ? 'dim' : ''].join(' ')
  return (
    `<button type="button" class="${cls}" data-agent="${esc(a.id)}" aria-current="${sel}">` +
    avatarHTML(a, { ring: ringFor(a) }) +
    `<span class="who"><span class="who-line"><span class="who-name">${esc(a.name)}</span>${accountBadge(a.account).html}` +
    `<span class="who-role">${esc(roleLabel(a))}</span><span class="who-time">${timeLabel(a)}</span></span>` +
    (a.title ? `<span class="who-sub">${esc(a.title)}</span>` : '') +
    `${activityLine(a, { selected: sel })}</span></button>`
  )
}

/** The pending command, as "$ npm run db:migrate" when it is a shell command. */
export function pendingCommand(a) {
  if (a.permission?.title) {
    const { tool, arg } = parseToolTitle(a.permission.title)
    if (/^(Bash|PowerShell|shell)$/i.test(tool)) return shellMarkup(arg)
    return `<span class="fn">${esc(tool)}</span> <span class="str">${esc(arg)}</span>`
  }
  const step = [...(a.recent ?? [])].reverse().find((x) => x.detail && x.kind !== 'prompt' && x.kind !== 'think')
  if (!step) return ''
  return ['run', 'test', 'git'].includes(step.kind) ? shellMarkup(step.detail) : `<span class="str">${esc(step.detail)}</span>`
}

function needCard(a) {
  const room = roomById(a.roomId)
  const cmd = pendingCommand(a)
  const what = a.waitingFor ? capital(a.waitingFor) : t('needsYouShort')
  return (
    `<div class="need"><div class="need-head">${avatarHTML(a, { size: 'avatar-md' })}` +
    `<div class="who"><div class="who-line"><span class="who-name">${esc(a.name)}</span>${accountBadge(a.account).html}` +
    `<span class="who-time">${ago(now() - (a.permission?.createdAt ?? a.statusSince))}</span></div>` +
    `<span class="who-sub">${esc(what)}${room ? ` · ${esc(room.name)}` : ''}</span></div></div>` +
    (cmd ? `<code class="cmd">${cmd}</code>` : '') +
    `<div class="need-actions"><button type="button" class="btn btn-attention" data-see-flow="${esc(a.id)}">${t('seeInFlow')}${ICON.arrowOut}</button>` +
    `<button type="button" class="btn" data-locate="${esc(a.id)}">${ICON.target}${t('locate')}</button></div></div>`
  )
}

function limitRow(label, win, stale) {
  if (!win || typeof win.utilization !== 'number') return ''
  const pct = Math.max(0, Math.min(100, Math.round(win.utilization)))
  const level = pct >= 80 ? 'crit' : pct >= 50 ? 'warn' : ''
  const reset = win.resetsAt ? `↺ ${until(win.resetsAt - now())}` : ''
  return (
    `<div class="limit ${level}${stale ? ' stale' : ''}"><span>${label}</span>` +
    `<span class="bar"><i data-style="width:${pct}%"></i></span><span class="pct">${pct}%</span><span class="reset">${reset}</span></div>`
  )
}

function accountsHTML() {
  const list = accounts().filter((acc) => acc.sessions > 0 || acc.usage || agents().some((a) => a.account === acc.id))
  return list
    .map((acc, i) => {
      const s = accountStyle(acc.id)
      const provider = s.provider === 'codex' ? 'OpenAI' : `Claude${acc.plan ? ` ${acc.plan}` : ''}`
      const u = acc.usage
      const stale = acc.usageStatus === 'stale'
      const rows = u && !u.noQuota ? limitRow('5h', u.fiveHour, stale) + limitRow(t('week'), u.sevenDay, stale) : ''
      return (
        (i ? '<div class="account-sep" aria-hidden="true"></div>' : '') +
        `<div class="account-head">${accountBadge(acc.id, 'acct-lg').html}<span class="account-name">${esc(s.name)}</span>` +
        `<span class="account-provider">${esc(provider)}${stale ? ` · ${t('stale')}` : ''}</span></div>` +
        (rows || `<div class="limit-none">${t('noUsage')}</div>`)
      )
    })
    .join('')
}

export function renderSidebar() {
  const all = agents()
  const count = (fn) => all.filter(fn).length
  const working = count((a) => ['working', 'thinking', 'error', 'shell'].includes(look(a)))
  const waiting = count((a) => look(a) === 'waiting')

  // Top bar
  const pill = $('live-pill')
  pill.dataset.state = state.connection
  $('live-text').textContent = t(state.connection === 'live' ? 'live' : state.connection === 'down' ? 'offline' : 'connecting')
  $('count-all').textContent = String(all.length)
  $('count-all-label').textContent = t(all.length === 1 ? 'agent' : 'agents')
  $('count-working').textContent = String(working)
  $('count-waiting').textContent = String(waiting)
  const waitBtn = document.querySelector('.counter[data-filter="waiting"]')
  waitBtn.hidden = waiting === 0
  for (const b of document.querySelectorAll('.counter[data-filter]')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter !== 'all' && b.dataset.filter === state.status))
  }

  // Account chips (only when there is more than one account to tell apart)
  const accIds = accounts().map((acc) => acc.id).filter((id) => all.some((a) => a.account === id))
  const chips = accIds.length > 1
    ? `<button type="button" class="chip chip-all" data-account="all" aria-pressed="${state.account === 'all'}">${t('all')}<span class="n">${all.length}</span></button>` +
      accIds.map((id) => `<button type="button" class="chip" data-account="${esc(id)}" aria-pressed="${state.account === id}">${accountBadge(id).html}${esc(accountStyle(id).name)}<span class="n">${all.filter((a) => a.account === id).length}</span></button>`).join('')
    : ''
  setHTML($('account-chips'), chips)
  if (state.account !== 'all' && !accIds.includes(state.account) && state.snapshot) update({ account: 'all' })

  // Needs you
  const selectedId = focusAgent()?.id ?? null
  const needs = filtered().filter((a) => look(a) === 'waiting').sort((a, b) => (a.statusSince ?? 0) - (b.statusSince ?? 0))
  $('needs-section').hidden = needs.length === 0
  $('needs-count').textContent = String(needs.length)
  setHTML($('needs'), needs.map(needCard).join(''))

  // Projects
  const groups = grouped(filtered())
  $('projects-count').textContent = String(groups.length)
  let html = ''
  if (!all.length) {
    html = `<div class="empty"><b>${t('noAgentsTitle')}</b><br>${t('noAgentsHint')}</div>`
  } else if (!groups.length) {
    html = `<div class="empty">—</div>`
  } else {
    html = groups
      .map(({ room, agents: list }) => {
        const closed = state.closedProjects.includes(room.id)
        const swatch = list.some((a) => look(a) === 'waiting') ? 'alert' : list.some((a) => ['working', 'thinking', 'shell'].includes(look(a))) ? 'on' : ''
        return (
          `<div class="project${closed ? ' closed' : ''}"><button type="button" class="project-head" data-project="${esc(room.id)}" title="${esc(room.path)}" aria-expanded="${!closed}">` +
          `${ICON.chevron}<span class="project-swatch ${swatch}"></span><span class="project-name">${esc(room.name)}</span><span class="project-n">${list.length}</span></button>` +
          list.map((a) => agentRow(a, selectedId)).join('') +
          `</div>`
        )
      })
      .join('')
  }
  setHTML($('projects'), html)

  setHTML($('accounts'), accountsHTML())
}

/** Re-renders the clocks once a second without waiting for a new snapshot. */
export function tickSidebar() {
  renderSidebar()
}

export { plural }
