#!/usr/bin/env node
// Agent Control Room: the Habblaud office and the Agent Flow graph on one screen.
//
// 1. Makes sure both are running: starts Docker Desktop and the Habblaud container, and Agent Flow, when missing.
// 2. Opens a proxy on 127.0.0.1 only. The room page lives at /control-room/ and everything else goes to Habblaud.
//    Habblaud sends X-Frame-Options: DENY; the proxy turns it into SAMEORIGIN so the room (same origin) can embed it.
//    Third-party sites still can't.
// 3. Agent Flow is embedded straight from its own address (it sends no X-Frame-Options).
//
// Neither project is modified: updating Habblaud or Agent Flow doesn't break the room.

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

const CONFIG = {
  port: Number(process.env.ACR_PORT) || 4800,
  open: !args.includes('--no-open'),
  habblaud: {
    port: Number(process.env.HABBLAUD_PORT) || 4747,
    dir: process.env.HABBLAUD_DIR || path.join(os.homedir(), 'habblaud'),
    container: 'habblaud',
    image: 'habblaud:local',
  },
  agentFlow: {
    port: Number(process.env.AGENT_FLOW_PORT) || 3001,
    // Local build (pnpm run build:app in a clone next to this folder); without it, `npx agent-flow-app`.
    app: process.env.AGENT_FLOW_APP || path.join(HERE, '..', 'agent-flow', 'app', 'dist', 'app.js'),
    // Watched folder: Claude Code sessions opened in it (or in its subfolders) show up in the graph.
    workspace: process.env.AGENT_FLOW_WORKSPACE || os.homedir(),
  },
}

const ROOM_URL = `http://localhost:${CONFIG.port}${ROOM_PATH}`
const AGENT_FLOW_ORIGIN = `http://127.0.0.1:${CONFIG.agentFlow.port}`

// ─── Helpers ────────────────────────────────────────────────────────────────

const log = (who, msg) => console.log(`[${who}] ${msg}`)
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

/** On Windows a child started through a shell (npx) leaves node running underneath: kill the whole tree. */
function killTree(child) {
  if (IS_WIN) run('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill()
}

// ─── Habblaud (Docker) ──────────────────────────────────────────────────────

const dockerOk = () => run('docker', ['info', '--format', '{{.ServerVersion}}']).status === 0

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

async function ensureHabblaud() {
  const { port, dir, container, image } = CONFIG.habblaud
  const healthy = () => isUp(port, '/api/health')
  if (await healthy()) return log('habblaud', `already running (port ${port})`)

  if (!dockerOk()) {
    log('habblaud', 'Docker is not running, opening Docker Desktop...')
    if (!startDockerDesktop() || !(await waitFor(async () => dockerOk(), 180_000, 3000))) {
      return log('habblaud', "couldn't reach Docker. Open Docker Desktop and run the room again.")
    }
  }

  if (run('docker', ['container', 'inspect', container]).status === 0) {
    log('habblaud', 'starting the container...')
    run('docker', ['start', container], { stdio: 'inherit' })
  } else if (fs.existsSync(path.join(dir, 'package.json'))) {
    // No container yet: Habblaud's own script writes the compose override with your accounts and starts it.
    const hasImage = run('docker', ['image', 'inspect', image]).status === 0
    log('habblaud', `no container; starting it from ${dir} (npm run docker:up)...`)
    run('npm', ['run', 'docker:up', ...(hasImage ? ['--', '--no-build'] : [])], { cwd: dir, stdio: 'inherit', shell: true, timeout: 900_000 })
  } else {
    return log('habblaud', `Habblaud not found in ${dir} (set HABBLAUD_DIR)`)
  }

  if (await waitFor(healthy, 90_000)) log('habblaud', `running (port ${port})`)
  else log('habblaud', 'the container started, but /api/health did not answer within 90 s')
}

// ─── Agent Flow ─────────────────────────────────────────────────────────────

/** Only the process the room started; an Agent Flow that was already running is left alone. */
let agentFlowChild = null

async function ensureAgentFlow() {
  const { port, app, workspace } = CONFIG.agentFlow
  if (await isUp(port)) return log('agent-flow', `already running (port ${port})`)

  const flags = ['--no-open', '--port', String(port)]
  const local = fs.existsSync(app)
  log('agent-flow', local ? `starting ${app}` : 'no local build found, starting it with npx agent-flow-app')

  const opts = {
    cwd: workspace,
    env: { ...process.env, AGENT_FLOW_TELEMETRY: process.env.AGENT_FLOW_TELEMETRY ?? 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  if (local) agentFlowChild = spawn(process.execPath, [app, ...flags], opts)
  // npx is a .cmd on Windows, so it needs a shell; the whole command goes as one string (only fixed words and the port).
  else if (IS_WIN) agentFlowChild = spawn(`npx -y agent-flow-app ${flags.join(' ')}`, { ...opts, shell: true })
  else agentFlowChild = spawn('npx', ['-y', 'agent-flow-app', ...flags], opts)
  for (const stream of [agentFlowChild.stdout, agentFlowChild.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => chunk.split(/\r?\n/).filter(Boolean).forEach((line) => log('agent-flow', line)))
  }
  agentFlowChild.on('exit', (code) => {
    log('agent-flow', `stopped (code ${code})`)
    agentFlowChild = null
  })

  // npx may need to download the package the first time.
  if (await waitFor(() => isUp(port), local ? 20_000 : 120_000, 500)) log('agent-flow', `running (port ${port}, watching ${workspace})`)
  else log('agent-flow', 'did not answer in time')
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
    agentFlow: { up: agentFlow, url: `${AGENT_FLOW_ORIGIN}/` },
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
  log('room', 'Ctrl+C closes the room (the Habblaud container keeps running).')
})

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  server.close()
  const child = agentFlowChild
  if (child) {
    // Agent Flow removes its discovery file (~/.claude/agent-flow) when it exits on its own; a forced kill leaves it
    // behind. On Windows Ctrl+C already reached it (same console); elsewhere, pass it on. Force only if it hangs.
    if (!IS_WIN) child.kill('SIGINT')
    const exited = await Promise.race([new Promise((r) => child.once('exit', () => r(true))), sleep(2000).then(() => false)])
    if (!exited) killTree(child)
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// Closing the console window (Windows) or the terminal.
process.on('SIGHUP', shutdown)
