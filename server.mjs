#!/usr/bin/env node
// Agent Control Room: the Habblaud office and the Agent Flow graph on one screen.
//
// 1. Makes sure both are running. Each one is reused when it already answers; otherwise the room runs the unmodified
//    builds in vendor/ with this same Node (Habblaud can also come from its own Docker container, when there is one).
// 2. Opens a proxy on 127.0.0.1 only. The room page lives at /control-room/ and everything else goes to Habblaud.
//    Habblaud sends X-Frame-Options: DENY; the proxy turns it into SAMEORIGIN so the room (same origin) can embed it.
//    Third-party sites still can't.
// 3. Agent Flow is embedded straight from its own address (it sends no X-Frame-Options).

import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync, exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(HERE, 'public')
const ROOM_PATH = '/control-room/'
const IS_WIN = process.platform === 'win32'
const args = process.argv.slice(2)
const argValue = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

const CONFIG = {
  port: Number(process.env.ACR_PORT) || 4800,
  open: !args.includes('--no-open'),
  habblaud: {
    port: Number(process.env.HABBLAUD_PORT) || 4747,
    // auto: the Docker container from Habblaud's own install when Docker is running and the container exists,
    // otherwise the bundled build. "docker" or "bundled" forces one of them.
    mode: (process.env.HABBLAUD_MODE || 'auto').toLowerCase(),
    entry: path.join(HERE, 'vendor', 'habblaud', 'dist', 'server', 'index.js'),
    container: 'habblaud',
  },
  agentFlow: {
    port: Number(process.env.AGENT_FLOW_PORT) || 3001,
    app: process.env.AGENT_FLOW_APP || path.join(HERE, 'vendor', 'agent-flow', 'app.js'),
    // Watched folder: Claude Code sessions opened in it (or in its subfolders) show up in the graph. Without one,
    // the room picks it from your recent sessions (guessWorkspace).
    workspace: argValue('--workspace') || process.env.AGENT_FLOW_WORKSPACE || null,
  },
}

const ROOM_URL = `http://localhost:${CONFIG.port}${ROOM_PATH}`
const AGENT_FLOW_ORIGIN = `http://127.0.0.1:${CONFIG.agentFlow.port}`

// ─── Helpers ────────────────────────────────────────────────────────────────

const log = (who, msg) => console.log(`[${who}] ${msg}`)
/** Logs why a step could not run and reports it as not started. */
const fail = (who, msg) => (log(who, msg), false)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Did the service answer (any status below 500)? */
function isUp(port, pathname = '/') {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode < 500)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

async function waitFor(check, timeoutMs, stepMs = 1000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(stepMs)
  }
  return false
}

const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 20_000, ...opts })

function openBrowser(url) {
  if (IS_WIN) exec(`start "" "${url}"`)
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
}

/** Kills a child and whatever it started (on Windows, killing the parent alone leaves its children running). */
function killTree(child) {
  if (IS_WIN) run('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill()
}

/** Processes the room started, by name. A service that was already running is never touched. */
const children = new Map()

/** Runs a vendored build with this same Node, its output prefixed with the service name. */
function startChild(name, script, scriptArgs, { cwd, env }) {
  const child = spawn(process.execPath, [script, ...scriptArgs], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) =>
      chunk
        .split(/\r?\n/)
        .filter(Boolean)
        // Habblaud already tags its own lines with [habblaud].
        .forEach((line) => (line.startsWith(`[${name}]`) ? console.log(line) : log(name, line))),
    )
  }
  child.on('exit', (code) => {
    log(name, `stopped (code ${code})`)
    children.delete(name)
  })
  children.set(name, child)
}

const missingVendor = (file) => `${file} is missing. Download the repository again, or rebuild it with: node scripts/vendor.mjs`

// ─── Habblaud ───────────────────────────────────────────────────────────────

const dockerOk = () => run('docker', ['info', '--format', '{{.ServerVersion}}']).status === 0
const containerExists = (name) => run('docker', ['container', 'inspect', name]).status === 0

function startDockerDesktop() {
  if (IS_WIN) {
    const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe')
    if (!fs.existsSync(exe)) return false
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  return false
}

async function startHabblaudContainer() {
  const { container } = CONFIG.habblaud
  if (!dockerOk()) {
    log('habblaud', 'Docker is not running, opening Docker Desktop...')
    if (!startDockerDesktop() || !(await waitFor(async () => dockerOk(), 180_000, 3000))) {
      return fail('habblaud', "couldn't reach Docker. Open Docker Desktop and run the room again.")
    }
  }
  if (!containerExists(container)) {
    return fail('habblaud', `no "${container}" container. Install Habblaud with Docker, or use HABBLAUD_MODE=bundled.`)
  }
  log('habblaud', 'starting its Docker container...')
  run('docker', ['start', container], { stdio: 'inherit' })
  return true
}

function startBundledHabblaud() {
  const { port, entry } = CONFIG.habblaud
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 12)) {
    return fail('habblaud', `needs Node.js 22.12 or newer (this one is ${process.versions.node}): https://nodejs.org`)
  }
  if (!fs.existsSync(entry)) return fail('habblaud', missingVendor(entry))
  log('habblaud', `starting the bundled build (port ${port})...`)
  startChild('habblaud', entry, [], {
    cwd: HERE,
    env: {
      HABBLAUD_PORT: String(port),
      HABBLAUD_HOST: process.env.HABBLAUD_HOST ?? '127.0.0.1',
      // New versions arrive with this repository; Habblaud's own update notice would point at another folder.
      HABBLAUD_UPDATE_CHECK: process.env.HABBLAUD_UPDATE_CHECK ?? '0',
    },
  })
  return true
}

async function ensureHabblaud() {
  const { port, mode, container } = CONFIG.habblaud
  const healthy = () => isUp(port, '/api/health')
  if (await healthy()) return log('habblaud', `already running (port ${port})`)

  const useDocker = mode === 'docker' || (mode === 'auto' && dockerOk() && containerExists(container))
  const started = useDocker ? await startHabblaudContainer() : startBundledHabblaud()
  if (!started) return

  if (await waitFor(healthy, useDocker ? 90_000 : 30_000)) log('habblaud', `running (port ${port})`)
  else log('habblaud', `did not answer on port ${port} in time`)
}

// ─── Agent Flow ─────────────────────────────────────────────────────────────

const RECENT_SESSION_MS = 7 * 24 * 3600 * 1000

/** The `cwd` a Claude Code transcript was recorded in (from its first lines), or null. */
function transcriptCwd(file) {
  let text = ''
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(256 * 1024)
    text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0))
    fs.closeSync(fd)
  } catch {
    return null
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"')) continue
    try {
      const cwd = JSON.parse(line).cwd
      if (typeof cwd === 'string' && cwd) return cwd
    } catch {}
  }
  return null
}

/**
 * Folder for Agent Flow to watch when none was given. Agent Flow follows a single folder tree, so this looks at the
 * Claude Code sessions used in the last week (~/.claude/projects) and takes the folder of the latest one, or a parent
 * of it when the parent covers more of them. Drive roots are left out (Agent Flow can't watch one), and so are
 * sessions in the temp folder. Example: sessions in D:\work, D:\work\app and D:\work\site → D:\work.
 */
function guessWorkspace() {
  const projects = path.join(os.homedir(), '.claude', 'projects')
  const fold = (p) => (IS_WIN ? p.toLowerCase() : p)
  const isUnder = (child, parent) => fold(child) === fold(parent) || fold(child).startsWith(fold(path.join(parent, path.sep)))
  const recent = []
  let dirs = []
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return os.homedir()
  }
  for (const d of dirs) {
    const dir = path.join(projects, d.name)
    let newest = null
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const mtime = fs.statSync(path.join(dir, f)).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { file: path.join(dir, f), mtime }
      }
    } catch {
      continue
    }
    if (!newest || Date.now() - newest.mtime > RECENT_SESSION_MS) continue
    const cwd = transcriptCwd(newest.file)
    if (!cwd || !fs.existsSync(cwd) || isUnder(cwd, os.tmpdir())) continue
    recent.push({ cwd: path.resolve(cwd), mtime: newest.mtime })
  }
  if (!recent.length) return os.homedir()

  recent.sort((a, b) => b.mtime - a.mtime)
  let best = null
  let bestCount = 0
  // From the latest session's folder upwards: a parent wins only when it covers more recent sessions.
  for (let p = recent[0].cwd; path.parse(p).root !== p; p = path.dirname(p)) {
    const count = recent.filter((r) => isUnder(r.cwd, p)).length
    if (count > bestCount) {
      best = p
      bestCount = count
    }
  }
  return best ?? os.homedir()
}

/** Folder the Agent Flow started by the room is watching (unknown when it was already running). */
let watchedFolder = null

async function ensureAgentFlow() {
  const { port, app } = CONFIG.agentFlow
  if (await isUp(port)) return log('agent-flow', `already running (port ${port})`)
  if (!fs.existsSync(app)) return log('agent-flow', missingVendor(app))

  const workspace = path.resolve(CONFIG.agentFlow.workspace ?? guessWorkspace())
  watchedFolder = workspace
  log('agent-flow', `starting the bundled build (port ${port}), watching ${workspace}`)
  if (!CONFIG.agentFlow.workspace) log('agent-flow', 'picked from your recent sessions; to change it: start.cmd --workspace <folder>')
  startChild('agent-flow', app, ['--no-open', '--port', String(port)], {
    cwd: workspace,
    env: { AGENT_FLOW_TELEMETRY: process.env.AGENT_FLOW_TELEMETRY ?? 'false' },
  })
  if (await waitFor(() => isUp(port), 20_000, 500)) log('agent-flow', `running (port ${port})`)
  else log('agent-flow', `did not answer on port ${port} in time`)
}

// ─── Room page (/control-room/) ─────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const ROOM_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // The room embeds Habblaud (same origin) and Agent Flow; the room itself can't be embedded.
  'Content-Security-Policy':
    `default-src 'self'; frame-src 'self' ${AGENT_FLOW_ORIGIN}; frame-ancestors 'none'; ` +
    "img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
}

let statusCache = { at: 0, value: null }

async function status() {
  if (statusCache.value && Date.now() - statusCache.at < 1000) return statusCache.value
  const [habblaud, agentFlow] = await Promise.all([isUp(CONFIG.habblaud.port, '/api/health'), isUp(CONFIG.agentFlow.port)])
  const value = {
    habblaud: { up: habblaud, url: '/' },
    agentFlow: { up: agentFlow, url: `${AGENT_FLOW_ORIGIN}/`, watching: watchedFolder },
  }
  statusCache = { at: Date.now(), value }
  return value
}

async function serveRoom(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    return res.end()
  }
  if (pathname === `${ROOM_PATH}status`) {
    const body = JSON.stringify(await status())
    res.writeHead(200, { ...ROOM_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(body)
  }

  let rel
  try {
    rel = pathname === ROOM_PATH ? 'index.html' : decodeURIComponent(pathname.slice(ROOM_PATH.length))
  } catch {
    rel = ''
  }
  const file = path.resolve(PUBLIC_DIR, rel)
  if (!rel || !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404, ROOM_HEADERS)
    return res.end('not found')
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, ROOM_HEADERS)
      return res.end('not found')
    }
    res.writeHead(200, { ...ROOM_HEADERS, 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(req.method === 'HEAD' ? undefined : data)
  })
}

// ─── Proxy to Habblaud ──────────────────────────────────────────────────────

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']

function proxyToHabblaud(req, res) {
  // The original Host (localhost:<room port>) is kept: Habblaud accepts localhost on any port, and its
  // "this computer only" checks (Origin equal to Host, Sec-Fetch-Site same-origin) still apply.
  const upstream = http.request(
    { host: '127.0.0.1', port: CONFIG.habblaud.port, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      const headers = { ...up.headers }
      for (const h of HOP_BY_HOP) delete headers[h]
      if (headers['x-frame-options']) headers['x-frame-options'] = 'SAMEORIGIN'
      res.writeHead(up.statusCode, up.statusMessage, headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`Habblaud is not running (127.0.0.1:${CONFIG.habblaud.port}).`)
  })
  // Tab closed in the middle of a stream (SSE): drop the Habblaud connection too.
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

function proxyUpgrade(req, socket, head) {
  const up = net.connect(CONFIG.habblaud.port, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    up.write(raw + '\r\n')
    if (head.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
}

// ─── Start ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname === ROOM_PATH.slice(0, -1)) {
    res.writeHead(301, { Location: ROOM_PATH })
    return res.end()
  }
  if (pathname.startsWith(ROOM_PATH)) return void serveRoom(req, res, pathname)
  proxyToHabblaud(req, res)
})
server.on('upgrade', proxyUpgrade)
// Habblaud's streams (SSE) stay open indefinitely.
server.requestTimeout = 0

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  log('room', `port ${CONFIG.port} is already in use (room open in another window?). Opening ${ROOM_URL}`)
  if (CONFIG.open) openBrowser(ROOM_URL)
  setTimeout(() => process.exit(0), 500)
})

server.listen(CONFIG.port, '127.0.0.1', async () => {
  log('room', `ready at ${ROOM_URL}`)
  if (CONFIG.open) openBrowser(ROOM_URL)
  await Promise.all([ensureHabblaud(), ensureAgentFlow()])
  log('room', 'Ctrl+C closes the room and what it started (a Habblaud Docker container keeps running).')
})

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  server.close()
  // Both clean up when they exit on their own (Agent Flow removes its discovery file in ~/.claude/agent-flow; a
  // forced kill leaves it behind). On Windows Ctrl+C already reached them (same console); elsewhere, pass it on.
  // Force only the ones that hang.
  await Promise.all(
    [...children.values()].map(async (child) => {
      if (!IS_WIN) child.kill('SIGINT')
      const exited = await Promise.race([new Promise((r) => child.once('exit', () => r(true))), sleep(2000).then(() => false)])
      if (!exited) killTree(child)
    }),
  )
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// Closing the console window (Windows) or the terminal.
process.on('SIGHUP', shutdown)
