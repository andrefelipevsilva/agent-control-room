// Reads a Claude Code session transcript (~/.claude/projects/<project>/<session>.jsonl, or a subagent's file under
// <session>/subagents/) and turns it into the steps the room's flow shows: your messages, thinking, replies, tool
// calls with their duration and +/- lines, and subagents as branches with their tool count and tokens.
// Files are read incrementally (only the bytes added since the last read) and kept parsed for a few sessions.

import fs from 'node:fs'
import path from 'node:path'

// API prices in US$ per million tokens: input, output and cache read (cache writes cost 1.25x input for 5 minutes and
// 2x for 1 hour). Used only when the transcript has no cost of its own; the page labels it an estimate.
const PRICES = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.25],
  [/fable|mythos/, 10, 50, 1],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus-(5|4-[5-9])/, 5, 25, 0.5],
  [/opus/, 15, 75, 1.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-5/, 0.1, 0.5, 0.01],
  [/haiku/, 1, 5, 0.1],
]

function messageCost(model, u) {
  const p = PRICES.find(([re]) => re.test(model ?? ''))
  if (!p) return null
  const [, inp, out, read] = p
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = (u.cache_creation_input_tokens ?? 0) - w1h
  const fast = u.speed === 'fast' ? 2 : 1
  return (
    fast *
    ((u.input_tokens ?? 0) * inp + (u.output_tokens ?? 0) * out + w5m * inp * 1.25 + w1h * inp * 2 + (u.cache_read_input_tokens ?? 0) * read) /
    1e6
  )
}

const MAX_EVENTS = 400
const MAX_TICKS = 3000
const KEEP_SESSIONS = 8
const SESSION_ID = /^[0-9a-f-]{8,64}$/i
const AGENT_ID = /^[\w-]{1,64}$/

/** sessionId (+ subagent id) → absolute transcript path, found once per config dir. */
const located = new Map()
/** transcript path → parsed state. Insertion order doubles as LRU. */
const parsed = new Map()

/** Finds the transcript of a main session or of one of its subagents inside a Claude config dir. */
export function locate(configDir, sessionId, subagentId = null) {
  if (!SESSION_ID.test(sessionId) || (subagentId && !AGENT_ID.test(subagentId))) return null
  const key = `${configDir}|${sessionId}|${subagentId ?? ''}`
  const hit = located.get(key)
  if (hit && fs.existsSync(hit)) return hit
  const projects = path.join(configDir, 'projects')
  let dirs = []
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return null
  }
  for (const d of dirs) {
    const file = subagentId
      ? path.join(projects, d.name, sessionId, 'subagents', `agent-${subagentId}.jsonl`)
      : path.join(projects, d.name, `${sessionId}.jsonl`)
    if (fs.existsSync(file)) {
      located.set(key, file)
      return file
    }
  }
  return null
}

function freshState(file) {
  return {
    file,
    offset: 0,
    partial: '',
    rev: 0,
    startedAt: null,
    cwd: null,
    model: null,
    events: [],
    ticks: [],
    pending: new Map(), // tool_use_id → event
    files: new Map(), // path → { path, reads, edits, add, del, at }
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    seenMessages: new Map(), // message.id → usage counted
    context: 0,
    cost: null,
    costEstimate: 0,
    costUnknown: false,
    linesAdded: 0,
    linesRemoved: 0,
  }
}

/** The parsed session, brought up to date with whatever was appended since the last call. */
export function read(file) {
  let st = parsed.get(file)
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!st || stat.size < st.offset) st = freshState(file)
  parsed.delete(file)
  parsed.set(file, st)
  while (parsed.size > KEEP_SESSIONS) parsed.delete(parsed.keys().next().value)

  if (stat.size > st.offset) {
    const fd = fs.openSync(file, 'r')
    try {
      const chunk = Buffer.alloc(1 << 20)
      while (st.offset < stat.size) {
        const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, stat.size - st.offset), st.offset)
        if (n <= 0) break
        st.offset += n
        const text = st.partial + chunk.toString('utf8', 0, n)
        const lines = text.split('\n')
        st.partial = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) ingest(st, line)
      }
    } finally {
      fs.closeSync(fd)
    }
    st.rev++
  }
  return st
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const clip = (s, n) => {
  const v = String(s ?? '')
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

function relPath(st, p) {
  if (!p) return ''
  const abs = String(p)
  if (st.cwd) {
    const rel = path.relative(st.cwd, abs)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replaceAll('\\', '/')
  }
  return abs.replaceAll('\\', '/')
}

/** Short label of a tool and its main argument. */
function describe(st, name, input = {}) {
  const tool = name.startsWith('mcp__') ? name.split('__').pop() : name
  const label = tool.replace(/_/g, ' ')
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { label, arg: clip(oneLine(input.command), 240), kind: 'shell', desc: clip(oneLine(input.description), 120) }
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return { label, arg: relPath(st, input.file_path ?? input.notebook_path), kind: 'file', path: input.file_path ?? input.notebook_path }
    case 'Grep':
      return { label, arg: clip(`${input.pattern ?? ''}${input.path ? `  ${relPath(st, input.path)}` : ''}`, 200), kind: 'search' }
    case 'Glob':
      return { label, arg: clip(input.pattern, 200), kind: 'search' }
    case 'WebFetch':
      return { label, arg: clip(input.url, 200), kind: 'web' }
    case 'WebSearch':
      return { label, arg: clip(input.query, 200), kind: 'web' }
    case 'Skill':
      return { label, arg: clip(input.skill, 120), kind: 'other' }
    case 'TodoWrite':
      return { label, arg: `${Array.isArray(input.todos) ? input.todos.length : 0}`, kind: 'plan' }
    case 'AskUserQuestion':
      return { label, arg: clip(oneLine(input.questions?.[0]?.question), 200), kind: 'ask' }
    case 'ToolSearch':
      return { label, arg: clip(String(input.query ?? '').replace(/^select:/, ''), 200), kind: 'search' }
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string' && v.trim())
      return { label, arg: clip(oneLine(first ?? ''), 200), kind: name.startsWith('mcp__') ? 'mcp' : 'other' }
    }
  }
}

function countPatch(patch) {
  let add = 0
  let del = 0
  for (const hunk of Array.isArray(patch) ? patch : []) {
    for (const l of hunk.lines ?? []) {
      if (l.startsWith('+')) add++
      else if (l.startsWith('-')) del++
    }
  }
  return { add, del }
}

function touchFile(st, abs, at, what, add = 0, del = 0) {
  if (!abs) return
  const key = String(abs)
  const f = st.files.get(key) ?? { path: relPath(st, key), reads: 0, edits: 0, add: 0, del: 0, at }
  if (what === 'read') f.reads++
  else f.edits++
  f.add += add
  f.del += del
  f.at = at
  st.files.set(key, f)
}

function push(st, ev) {
  st.events.push(ev)
  st.ticks.push([ev.t, ev.k === 'tool' ? (ev.status === 'err' ? 'err' : 'tool') : ev.k])
  if (st.events.length > MAX_EVENTS * 3) st.events.splice(0, st.events.length - MAX_EVENTS * 2)
  if (st.ticks.length > MAX_TICKS) st.ticks.splice(0, st.ticks.length - MAX_TICKS)
}

/** User text that is really a harness note (reminders, command output, notifications), not something you typed. */
function isNoise(text) {
  const s = text.trimStart()
  return /^<(local-command-stdout|local-command-stderr|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr)/.test(s) || s.startsWith('Caveat:')
}

function userText(text) {
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>(?:[\s\S]*?<command-args>([^<]*)<\/command-args>)?/)
  if (cmd) return `${cmd[1].trim()}${cmd[2] ? ` ${cmd[2].trim()}` : ''}`
  return text.trim()
}

function ingest(st, line) {
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  const at = o.timestamp ? Date.parse(o.timestamp) : null
  if (at && !st.startedAt) st.startedAt = at
  if (o.cwd && !st.cwd) st.cwd = o.cwd
  if (o.type === 'cost-state') {
    if (typeof o.totalCostUSD === 'number') st.cost = o.totalCostUSD
    if (typeof o.totalLinesAdded === 'number') st.linesAdded = o.totalLinesAdded
    if (typeof o.totalLinesRemoved === 'number') st.linesRemoved = o.totalLinesRemoved
    return
  }
  if (o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) return
  const msg = o.message ?? {}
  const t = at ?? Date.now()

  if (o.type === 'assistant') {
    if (msg.model && msg.model !== '<synthetic>') st.model = msg.model
    const u = msg.usage
    if (u && msg.id && !st.seenMessages.has(msg.id)) {
      st.seenMessages.set(msg.id, true)
      st.usage.input += u.input_tokens ?? 0
      st.usage.output += u.output_tokens ?? 0
      st.usage.cacheRead += u.cache_read_input_tokens ?? 0
      st.usage.cacheWrite += u.cache_creation_input_tokens ?? 0
      const c = messageCost(msg.model, u)
      if (c == null) st.costUnknown = true
      else st.costEstimate += c
      if (st.seenMessages.size > 5000) st.seenMessages.delete(st.seenMessages.keys().next().value)
    }
    if (u) st.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const text = clip(b.thinking ?? '', 600)
        const ms = typeof o.thinkingDurationMs === 'number' ? o.thinkingDurationMs : null
        const tok = u?.output_tokens_details?.thinking_tokens ?? null
        // Claude Code writes one thinking block over several lines of the same message (duration on one, text on
        // another): they are one step.
        const prev = st.events.at(-1)
        if (prev?.k === 'think' && msg.id && prev.mid === msg.id) {
          if (text) prev.text = text
          if (ms != null && (prev.dur == null || ms > prev.dur)) prev.dur = ms
          if (tok != null) prev.tok = tok
        } else {
          push(st, { k: 'think', mid: msg.id, t, dur: ms, tok, text })
        }
      } else if (b.type === 'text' && b.text?.trim()) {
        push(st, { k: 'text', t, text: clip(b.text.trim(), 2000) })
      } else if (b.type === 'tool_use') {
        const input = b.input ?? {}
        if (b.name === 'Agent' || b.name === 'Task') {
          const ev = { k: 'sub', id: b.id, t, type: input.subagent_type || 'general-purpose', desc: clip(oneLine(input.description), 120), status: 'run', bg: input.run_in_background === true }
          st.pending.set(b.id, ev)
          push(st, ev)
        } else {
          const d = describe(st, b.name, input)
          const ev = { k: 'tool', id: b.id, t, tool: b.name, label: d.label, arg: d.arg, kind: d.kind, desc: d.desc, status: 'run' }
          if (b.name === 'Read') touchFile(st, d.path, t, 'read')
          st.pending.set(b.id, ev)
          push(st, ev)
        }
      }
    }
    return
  }

  // user
  if (o.isMeta) return
  const content = msg.content
  if (typeof content === 'string') {
    if (!content.trim() || isNoise(content)) return
    if (/^\[Request interrupted/.test(content)) return push(st, { k: 'note', t, text: 'interrupted' })
    return push(st, { k: 'user', t, text: clip(userText(content), 2000) })
  }
  const texts = []
  for (const b of Array.isArray(content) ? content : []) {
    if (b.type === 'tool_result') {
      const ev = st.pending.get(b.tool_use_id)
      if (!ev) continue
      st.pending.delete(b.tool_use_id)
      const r = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {}
      ev.dur = Math.max(0, t - ev.t)
      ev.status = b.is_error ? 'err' : 'ok'
      if (ev.k === 'sub') {
        if (r.isAsync || r.status === 'async_launched') ev.status = 'bg'
        if (typeof r.totalToolUseCount === 'number') ev.tools = r.totalToolUseCount
        if (typeof r.totalTokens === 'number') ev.tok = r.totalTokens
        if (typeof r.totalDurationMs === 'number') ev.dur = r.totalDurationMs
        if (r.agentId) ev.agentId = String(r.agentId)
      } else {
        if (b.is_error) ev.error = clip(oneLine(typeof b.content === 'string' ? b.content : b.content?.[0]?.text), 200)
        if (r.structuredPatch || r.type === 'create') {
          let { add, del } = countPatch(r.structuredPatch)
          if (r.type === 'create' && !add && typeof r.content === 'string') add = r.content.split('\n').length
          ev.add = add
          ev.del = del
          touchFile(st, r.filePath ?? ev.arg, t, 'edit', add, del)
        }
        if (r.interrupted) ev.status = 'err'
      }
      st.ticks.push([t, 'end'])
    } else if (b.type === 'text' && b.text?.trim() && !isNoise(b.text)) {
      texts.push(b.text.trim())
    }
  }
  if (texts.length) push(st, { k: 'user', t, text: clip(userText(texts.join('\n')), 2000) })
}

/** Light stats of a subagent's own transcript: tool calls, tokens, first and last time. */
export function subagentStats(file) {
  const st = read(file)
  if (!st) return null
  const tools = st.events.filter((e) => e.k === 'tool').length
  const tok = st.usage.input + st.usage.output + st.usage.cacheRead + st.usage.cacheWrite
  const last = st.events.at(-1)?.t ?? st.startedAt
  return { tools, tok, dur: st.startedAt && last ? last - st.startedAt : null, running: st.pending.size > 0 }
}

/** What the room's page gets for one session. */
export function view(st, { subagentFile } = {}) {
  const events = st.events.slice(-MAX_EVENTS)
  // Subagents: fill tools/tokens from their own transcripts when the main one does not have them (background runs).
  for (const ev of events) {
    if (ev.k !== 'sub' || !ev.agentId || !subagentFile) continue
    const f = subagentFile(ev.agentId)
    if (!f) continue
    const s = subagentStats(f)
    if (!s) continue
    if (ev.tools == null || ev.status === 'bg') ev.tools = s.tools
    if (ev.tok == null || ev.status === 'bg') ev.tok = s.tok
    if (ev.status === 'bg') ev.dur = s.dur
    if (ev.status === 'bg' && !s.running && s.tools > 0) ev.bgDone = true
  }
  return {
    rev: st.rev,
    startedAt: st.startedAt,
    cwd: st.cwd,
    model: st.model,
    context: st.context,
    usage: st.usage,
    // Claude Code's own total when the transcript has it; otherwise the estimate from the token counts.
    cost: st.cost ?? (st.costEstimate > 0 ? st.costEstimate : null),
    costEstimated: st.cost == null,
    lines: { add: st.linesAdded, del: st.linesRemoved },
    total: st.events.length,
    events,
    ticks: st.ticks,
    files: [...st.files.values()].sort((a, b) => b.at - a.at).slice(0, 200),
  }
}
