#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/setup.js
var require_setup = __commonJS({
  "scripts/setup.js"(exports2, module2) {
    "use strict";
    var fs9 = require("fs");
    var path8 = require("path");
    var os4 = require("os");
    var { execFileSync } = require("child_process");
    var DISCOVERY_DIR2 = path8.join(os4.homedir(), ".claude", "agent-flow");
    var HOOK_SCRIPT_PATH = path8.join(DISCOVERY_DIR2, "hook.js");
    var SETTINGS_PATH = path8.join(os4.homedir(), ".claude", "settings.json");
    var HOOK_TIMEOUT_S = 2;
    var HOOK_SAFETY_MARGIN_MS = 500;
    var HOOK_FORWARD_TIMEOUT_MS = 1e3;
    var HOOK_COMMAND_MARKER = "agent-flow/hook.js";
    function resolveNodePath() {
      try {
        const cmd = process.platform === "win32" ? "where" : "command";
        const args2 = process.platform === "win32" ? ["node"] : ["-v", "node"];
        const result = execFileSync(cmd, args2, { encoding: "utf8", timeout: 3e3 }).trim();
        const firstLine = result.split(/\r?\n/)[0].trim();
        if (firstLine)
          return firstLine;
      } catch {
      }
      return "node";
    }
    function getHookScriptContent() {
      return `#!/usr/bin/env node
// Agent Flow hook forwarder v3 \u2014 installed by the Agent Flow setup script.
// Claude Code invokes this as a command hook. It reads a discovery directory to
// find live extension instances, checks their PIDs, and forwards the event via
// HTTP POST. Dead instances are cleaned up automatically.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

setTimeout(() => process.exit(0), ${HOOK_TIMEOUT_S * 1e3 - HOOK_SAFETY_MARGIN_MS});

const DIR = path.join(os.homedir(), '.claude', 'agent-flow');
const IS_WIN = process.platform === 'win32';

function normPath(p) {
  let r = path.resolve(p);
  try { r = fs.realpathSync(r); } catch {}
  return r;
}

function isAlive(pid) {
  if (IS_WIN) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let cwd;
  try { cwd = JSON.parse(input).cwd; } catch { process.exit(0); }
  if (!cwd) process.exit(0);

  const resolvedCwd = normPath(cwd);

  let allFiles;
  try {
    allFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'workspaces.json');
  } catch { process.exit(0); }
  if (!allFiles.length) process.exit(0);

  const matches = [];
  for (const file of allFiles) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } catch { continue; }
    if (!d.workspace || !d.pid || !d.port) continue;

    if (!isAlive(d.pid)) {
      try { fs.unlinkSync(path.join(DIR, file)); } catch {}
      continue;
    }

    const ws = normPath(d.workspace);
    if (resolvedCwd === ws || resolvedCwd.startsWith(ws + path.sep)) {
      matches.push({ d, file, wsLen: ws.length });
    }
  }

  if (!matches.length) process.exit(0);

  matches.sort((a, b) => b.wsLen - a.wsLen);
  const bestLen = matches[0].wsLen;
  const targets = matches.filter(m => m.wsLen === bestLen);

  let pending = targets.length;
  for (const { d } of targets) {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; done(); };
    const req = http.request({
      hostname: '127.0.0.1', port: d.port, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: ${HOOK_FORWARD_TIMEOUT_MS},
    }, res => { res.resume(); res.on('end', finish); });
    req.on('error', finish);
    req.on('timeout', () => { req.destroy(); });
    req.write(input);
    req.end();
  }

  function done() { if (--pending <= 0) process.exit(0); }
});
`;
    }
    function ensureHookScript() {
      if (!fs9.existsSync(DISCOVERY_DIR2)) {
        fs9.mkdirSync(DISCOVERY_DIR2, { recursive: true });
      }
      const script = getHookScriptContent();
      try {
        if (fs9.existsSync(HOOK_SCRIPT_PATH) && fs9.readFileSync(HOOK_SCRIPT_PATH, "utf8") === script) {
          console.log("Hook script already up to date:", HOOK_SCRIPT_PATH);
          return;
        }
      } catch {
      }
      const tmpPath = HOOK_SCRIPT_PATH + `.${process.pid}.tmp`;
      fs9.writeFileSync(tmpPath, script, { mode: 493 });
      fs9.renameSync(tmpPath, HOOK_SCRIPT_PATH);
      console.log("Installed hook script:", HOOK_SCRIPT_PATH);
    }
    var LEGACY_HOOK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/?$/;
    var HOOK_EVENTS = [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "SubagentStart",
      "SubagentStop",
      "Notification",
      "Stop",
      "SessionEnd"
    ];
    function isAgentFlowHook(entry) {
      return !!entry?.hooks?.some(
        (h) => h.command?.replace(/\\/g, "/").includes(HOOK_COMMAND_MARKER) || typeof h.url === "string" && LEGACY_HOOK_URL_RE.test(h.url)
      );
    }
    function readSettings(settingsPath) {
      let raw;
      try {
        raw = fs9.readFileSync(settingsPath, "utf-8");
      } catch (err) {
        if (err.code === "ENOENT")
          return { settings: {} };
        return { error: err.message };
      }
      if (raw.trim() === "")
        return { settings: {} };
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { error: "top-level value is not an object" };
        }
        return { settings: parsed };
      } catch (err) {
        return { error: err.message };
      }
    }
    function writeJsonAtomic(filePath, value) {
      fs9.mkdirSync(path8.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      fs9.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n");
      fs9.renameSync(tmpPath, filePath);
    }
    function configureHooks(settingsPath = SETTINGS_PATH, hookCommand) {
      if (!hookCommand)
        hookCommand = `"${resolveNodePath()}" "${HOOK_SCRIPT_PATH}"`;
      const hookEntry = { hooks: [{ type: "command", command: hookCommand, timeout: HOOK_TIMEOUT_S }] };
      const { settings, error } = readSettings(settingsPath);
      if (error) {
        console.error(`Could not parse ${settingsPath} (${error}).`);
        console.error("Leaving it untouched. Fix the file and run setup again to enable live events.");
        return false;
      }
      const existingHooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
      for (const event of HOOK_EVENTS) {
        const existing = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
        existingHooks[event] = [...existing.filter((entry) => !isAgentFlowHook(entry)), hookEntry];
      }
      settings.hooks = existingHooks;
      writeJsonAtomic(settingsPath, settings);
      console.log("Configured Claude Code hooks in:", settingsPath);
      return true;
    }
    function isAlreadySetup(settingsPath = SETTINGS_PATH, hookScriptPath = HOOK_SCRIPT_PATH) {
      if (!fs9.existsSync(hookScriptPath))
        return false;
      const { settings } = readSettings(settingsPath);
      const hooks = settings?.hooks;
      if (!hooks || typeof hooks !== "object")
        return false;
      return Object.values(hooks).some(
        (entries) => Array.isArray(entries) && entries.some((entry) => isAgentFlowHook(entry))
      );
    }
    function ensureSetup2() {
      if (isAlreadySetup())
        return;
      console.log("Setting up agent hooks...");
      ensureHookScript();
      configureHooks();
      console.log("");
    }
    module2.exports = { ensureSetup: ensureSetup2, isAgentFlowHook, configureHooks, isAlreadySetup };
    if (require.main === module2) {
      const force = process.argv.includes("--force");
      if (!force && isAlreadySetup()) {
        console.log("Agent Flow is already set up. Run with --force to reconfigure.");
        process.exit(0);
      }
      console.log("Setting up Agent Flow...\n");
      ensureHookScript();
      if (!configureHooks())
        process.exit(1);
      console.log("\nDone! New sessions will stream events to Agent Flow.");
    }
  }
});

// scripts/vscode-shim.js
var require_vscode_shim = __commonJS({
  "scripts/vscode-shim.js"(exports2, module2) {
    "use strict";
    var EventEmitter2 = class {
      constructor() {
        this._listeners = [];
      }
      get event() {
        return (listener) => {
          this._listeners.push(listener);
          return { dispose: () => {
            const i = this._listeners.indexOf(listener);
            if (i >= 0)
              this._listeners.splice(i, 1);
          } };
        };
      }
      fire(data) {
        for (const l of this._listeners)
          l(data);
      }
      dispose() {
        this._listeners = [];
      }
    };
    module2.exports = {
      EventEmitter: EventEmitter2,
      workspace: {
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        getConfiguration: () => ({ get: () => void 0 })
      },
      window: {
        showInformationMessage: () => {
        }
      }
    };
  }
});

// extension/src/constants.ts
var INACTIVITY_TIMEOUT_MS = 5 * 60 * 1e3;
var SCAN_INTERVAL_MS = 1e3;
var POLL_FALLBACK_MS = 3e3;
var PERMISSION_DETECT_MS = 5e3;
var ACTIVE_SESSION_AGE_S = 10 * 60;
var DEFAULT_RELAY_PORT = 3001;
var HOOK_SERVER_NOT_STARTED = -1;
var HOOK_MAX_BODY_SIZE = 1024 * 1024;
var WORKSPACE_HASH_LENGTH = 16;
var PREVIEW_MAX = 60;
var ARGS_MAX = 80;
var RESULT_MAX = 200;
var MESSAGE_MAX = 2e3;
var SESSION_LABEL_MAX = 14;
var SESSION_LABEL_TRUNCATED = SESSION_LABEL_MAX - 2;
var DISCOVERY_LABEL_MAX = 40;
var DISCOVERY_LABEL_TAIL = DISCOVERY_LABEL_MAX - 3;
var DISCOVERY_CONTENT_MAX = 100;
var TASK_MAX = 60;
var EDIT_CONTENT_MAX = 500;
var WEB_FETCH_PROMPT_MAX = 200;
var CHILD_NAME_MAX = 30;
var SKILL_NAME_MAX = 40;
var URL_PATH_MAX = 40;
var SESSION_ID_DISPLAY = 8;
var FAILED_RESULT_MAX = 100;
var CHARS_PER_TOKEN = 4;
var MIN_TOKEN_ESTIMATE = 10;
var FALLBACK_TOKEN_ESTIMATE = 200;
var GREP_TOKEN_MULTIPLIER = 0.5;
var DEFAULT_TOKEN_MULTIPLIER = 0.3;
var SYSTEM_PROMPT_BASE_TOKENS = 5e3;
var HASH_PREFIX_MAX = 200;
var HOOK_SERVER_HOST = "127.0.0.1";
var ORCHESTRATOR_NAME = "orchestrator";
var FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];
var PATTERN_TOOLS = ["Glob", "Grep"];
var SUBAGENT_ID_SUFFIX_LENGTH = 6;
function generateSubagentFallbackName(id, index) {
  return `subagent-${id.length > SUBAGENT_ID_SUFFIX_LENGTH ? id.slice(-SUBAGENT_ID_SUFFIX_LENGTH) : index}`;
}
function resolveSubagentChildName(input) {
  return String(input.description || input.subagent_type || "subagent").slice(0, CHILD_NAME_MAX);
}
var SYSTEM_CONTENT_PREFIXES = [
  "This session is being continued",
  "<ide_",
  "<system-reminder",
  "<available-deferred-tools",
  "<command-name",
  "<system_instruction",
  "<task-notification",
  "<local-command-stdout",
  "<local-command-caveat"
];

// app/src/args.ts
function parseArgs(argv) {
  let port = DEFAULT_RELAY_PORT;
  let open = true;
  let verbose2 = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--port" || arg === "-p") && argv[i + 1]) {
      const n = parseInt(argv[i + 1], 10);
      if (!isNaN(n) && n > 0 && n < 65536)
        port = n;
      i++;
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose2 = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: agent-flow [options]

Options:
  -p, --port <number>  Port for the server (default: ${DEFAULT_RELAY_PORT})
  --no-open            Don't open the browser automatically
  -v, --verbose        Show detailed event logs
  -h, --help           Show this help message
`);
      process.exit(0);
    }
  }
  return { port, open, verbose: verbose2 };
}

// app/src/app.ts
var import_setup = __toESM(require_setup());

// app/src/server.ts
var http2 = __toESM(require("http"));
var os3 = __toESM(require("os"));
var path7 = __toESM(require("path"));
var import_child_process = require("child_process");

// scripts/relay.ts
var crypto = __toESM(require("crypto"));
var fs4 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var os2 = __toESM(require("os"));

// extension/src/hook-server.ts
var http = __toESM(require("http"));
var vscode = __toESM(require_vscode_shim());

// extension/src/tool-summarizer.ts
function tailPath(filePath, segments = 2) {
  return String(filePath).split("/").slice(-segments).join("/");
}
function summarizeInput(toolName, input) {
  if (!input) {
    return "";
  }
  switch (toolName) {
    case "Bash":
      return String(input.command || "").slice(0, ARGS_MAX);
    case "Read":
      return tailPath(String(input.file_path || input.path || ""));
    case "Edit":
      return tailPath(String(input.file_path || "")) + " \u2014 edit";
    case "Write":
      return tailPath(String(input.file_path || "")) + " \u2014 write";
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return String(input.pattern || "");
    case "Task":
    case "Agent":
      return String(input.description || input.prompt || "").slice(0, TASK_MAX);
    case "TodoWrite": {
      const todos = input.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        const active = todos.find((t) => t.status === "in_progress");
        const label = active?.activeForm || active?.content || todos[0]?.content || "todos";
        const done = todos.filter((t) => t.status === "completed").length;
        return `${label} (${done}/${todos.length})`.slice(0, ARGS_MAX);
      }
      return "updating todos";
    }
    case "WebSearch":
      return String(input.query || "").slice(0, ARGS_MAX);
    case "WebFetch": {
      const url = String(input.url || "");
      try {
        const u = new URL(url);
        return u.hostname + u.pathname.slice(0, URL_PATH_MAX);
      } catch {
        return url.slice(0, ARGS_MAX);
      }
    }
    case "AskUserQuestion": {
      const questions = input.questions;
      if (Array.isArray(questions) && questions[0]?.question) {
        return String(questions[0].question).slice(0, ARGS_MAX);
      }
      return "asking user...";
    }
    case "Skill":
      return String(input.skill || "").slice(0, SKILL_NAME_MAX);
    case "NotebookEdit":
      return tailPath(String(input.notebook_path || "")) + ` cell ${input.cell_number ?? "?"}`;
    case "exec_command":
      return String(input.cmd || input.command || "").slice(0, ARGS_MAX);
    case "write_stdin":
      return String(input.input || input.stdin || "").slice(0, ARGS_MAX);
    case "update_plan": {
      const items = input.plan;
      if (Array.isArray(items) && items.length > 0) {
        const active = items.find((i) => i.status === "in_progress");
        const label = active?.step || items[0]?.step || "plan";
        const done = items.filter((i) => i.status === "completed").length;
        return `${label} (${done}/${items.length})`.slice(0, ARGS_MAX);
      }
      return "updating plan";
    }
    case "apply_patch":
      return String(input.patch || "").split("\n").slice(0, 3).join(" ").slice(0, ARGS_MAX) || "apply patch";
    default:
      return JSON.stringify(input).slice(0, ARGS_MAX);
  }
}
function summarizeResult(content) {
  if (typeof content === "string") {
    return content.slice(0, RESULT_MAX);
  }
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === "string") {
        return c;
      }
      if (c && typeof c === "object" && "text" in c) {
        return String(c.text);
      }
      return "";
    }).join("\n").slice(0, RESULT_MAX);
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const obj = content;
    if (typeof obj.content === "string") {
      return obj.content.slice(0, RESULT_MAX);
    }
    if (typeof obj.text === "string") {
      return obj.text.slice(0, RESULT_MAX);
    }
    try {
      return JSON.stringify(content).slice(0, RESULT_MAX);
    } catch {
    }
  }
  return String(content || "").slice(0, RESULT_MAX);
}
function extractInputData(toolName, input) {
  if (!input) {
    return void 0;
  }
  try {
    switch (toolName) {
      case "Edit":
        return {
          file_path: String(input.file_path || ""),
          old_string: String(input.old_string || "").slice(0, EDIT_CONTENT_MAX),
          new_string: String(input.new_string || "").slice(0, EDIT_CONTENT_MAX)
        };
      case "TodoWrite":
        return { todos: input.todos };
      case "Write":
        return {
          file_path: String(input.file_path || ""),
          content: String(input.content || "").slice(0, EDIT_CONTENT_MAX)
        };
      case "Bash":
        return {
          command: String(input.command || ""),
          description: String(input.description || "")
        };
      case "Read":
        return {
          file_path: String(input.file_path || input.path || ""),
          offset: typeof input.offset === "number" ? input.offset : void 0,
          limit: typeof input.limit === "number" ? input.limit : void 0
        };
      case "Grep":
        return {
          pattern: String(input.pattern || ""),
          path: String(input.path || ""),
          glob: typeof input.glob === "string" ? input.glob : void 0
        };
      case "Glob":
        return {
          pattern: String(input.pattern || ""),
          path: String(input.path || "")
        };
      case "WebSearch":
        return {
          query: String(input.query || "")
        };
      case "WebFetch":
        return {
          url: String(input.url || ""),
          prompt: String(input.prompt || "").slice(0, WEB_FETCH_PROMPT_MAX)
        };
      case "AskUserQuestion": {
        const qs = input.questions;
        return {
          questions: Array.isArray(qs) ? qs.map((q) => ({
            question: String(q.question || ""),
            options: Array.isArray(q.options) ? q.options.map((o) => String(o.label || "")) : []
          })) : []
        };
      }
      case "exec_command":
        return {
          command: String(input.cmd || input.command || ""),
          workdir: typeof input.workdir === "string" ? input.workdir : void 0
        };
      case "apply_patch":
        return {
          patch: String(input.patch || "").slice(0, EDIT_CONTENT_MAX)
        };
      case "update_plan":
        return { plan: input.plan };
      default:
        return void 0;
    }
  } catch {
    return void 0;
  }
}
function extractFilePath(input) {
  if (!input) {
    return void 0;
  }
  const raw = input.file_path || input.path;
  return typeof raw === "string" ? raw : void 0;
}
function buildDiscovery(toolName, filePath, result) {
  if (!FILE_TOOLS.includes(toolName) || !filePath) {
    return void 0;
  }
  return {
    type: PATTERN_TOOLS.includes(toolName) ? "pattern" : "file",
    label: filePath.length > DISCOVERY_LABEL_MAX ? "..." + filePath.slice(-DISCOVERY_LABEL_TAIL) : filePath,
    content: result.slice(0, DISCOVERY_CONTENT_MAX)
  };
}
function detectError(content) {
  const lower = content.toLowerCase();
  const patterns = [
    "error:",
    "error[",
    "exception:",
    "failed",
    "permission denied",
    "command failed",
    "cannot find",
    "not found",
    "enoent",
    "fatal:",
    "panic:",
    "segfault",
    "syntax error"
  ];
  return patterns.some((p) => lower.includes(p));
}

// extension/src/token-estimator.ts
function estimateTokensFromContent(content) {
  if (typeof content === "string") {
    return Math.max(Math.ceil(content.length / CHARS_PER_TOKEN), MIN_TOKEN_ESTIMATE);
  }
  if (Array.isArray(content)) {
    let total = 0;
    for (const item of content) {
      if (typeof item === "string") {
        total += item.length;
      } else if (item && typeof item === "object" && "text" in item) {
        total += String(item.text || "").length;
      }
    }
    return Math.max(Math.ceil(total / CHARS_PER_TOKEN), MIN_TOKEN_ESTIMATE);
  }
  return FALLBACK_TOKEN_ESTIMATE;
}
function estimateTokensFromText(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
function estimateTokenCost(toolName, result) {
  const baseTokens = Math.ceil(result.length / CHARS_PER_TOKEN);
  if (toolName === "Read") {
    return baseTokens;
  }
  if (toolName === "Grep" || toolName === "Glob") {
    return Math.ceil(baseTokens * GREP_TOKEN_MULTIPLIER);
  }
  return Math.ceil(baseTokens * DEFAULT_TOKEN_MULTIPLIER);
}

// extension/src/logger.ts
var LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
var minLevel = "info";
function setLogLevel(level) {
  if (level in LOG_LEVELS)
    minLevel = level;
}
function shouldLog(level) {
  return (LOG_LEVELS[level] ?? 0) >= (LOG_LEVELS[minLevel] ?? 0);
}
function createLogger(tag) {
  const prefix = `[${tag}]`;
  return {
    debug(...args2) {
      if (shouldLog("debug"))
        console.log(prefix, ...args2);
    },
    info(...args2) {
      if (shouldLog("info"))
        console.log(prefix, ...args2);
    },
    warn(...args2) {
      if (shouldLog("warn"))
        console.warn(prefix, ...args2);
    },
    error(...args2) {
      if (shouldLog("error"))
        console.error(prefix, ...args2);
    }
  };
}

// extension/src/hook-server.ts
var log = createLogger("HookServer");
var HookServer = class {
  server = null;
  port;
  /** Per-session state — cleaned up on SessionEnd/Stop to prevent unbounded growth */
  sessionState = /* @__PURE__ */ new Map();
  _onEvent = new vscode.EventEmitter();
  onEvent = this._onEvent.event;
  constructor(port) {
    this.port = port ?? 0;
  }
  async start() {
    return new Promise((resolve2, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === "POST") {
          let body = "";
          let oversized = false;
          req.on("data", (chunk) => {
            if (oversized)
              return;
            body += chunk.toString();
            if (body.length > HOOK_MAX_BODY_SIZE) {
              oversized = true;
              body = "";
              log.warn("Request body exceeded size limit, discarding");
            }
          });
          req.on("end", () => {
            if (!oversized) {
              try {
                const parsed = JSON.parse(body);
                if (!parsed || typeof parsed !== "object" || !("session_id" in parsed) || !("hook_event_name" in parsed) || typeof parsed.session_id !== "string" || typeof parsed.hook_event_name !== "string") {
                  log.warn("Invalid hook payload: missing session_id or hook_event_name");
                } else {
                  this.handleHook(parsed);
                }
              } catch (e) {
                log.error("Failed to parse payload:", e);
              }
            }
            res.writeHead(200);
            res.end();
          });
        } else {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Agent Visualizer Hook Server");
        }
      });
      this.server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          log.info(`Port ${this.port} in use (another instance owns it) \u2014 skipping hook server`);
          this.server?.close();
          this.server = null;
          resolve2(HOOK_SERVER_NOT_STARTED);
        } else {
          reject(err);
        }
      });
      this.server.listen(this.port, HOOK_SERVER_HOST, () => {
        const addr = this.server.address();
        this.port = addr.port;
        log.info(`Listening on http://127.0.0.1:${this.port}`);
        resolve2(this.port);
      });
    });
  }
  getPort() {
    return this.port;
  }
  getOrCreateSession(sessionId) {
    let state = this.sessionState.get(sessionId);
    if (!state) {
      state = { startTime: Date.now(), agentNames: /* @__PURE__ */ new Map() };
      this.sessionState.set(sessionId, state);
    }
    return state;
  }
  elapsedSeconds(sessionId) {
    const startTime = sessionId ? this.sessionState.get(sessionId)?.startTime ?? Date.now() : Date.now();
    return (Date.now() - startTime) / 1e3;
  }
  handleHook(payload) {
    const eventName = payload.hook_event_name;
    log.debug(eventName, payload.tool_name || payload.agent_type || "");
    switch (eventName) {
      case "SessionStart":
        this.handleSessionStart(payload);
        break;
      case "PreToolUse":
        this.handlePreToolUse(payload);
        break;
      case "PostToolUse":
        this.handlePostToolUse(payload);
        break;
      case "PostToolUseFailure":
        this.handlePostToolUseFailure(payload);
        break;
      case "SubagentStart":
        this.handleSubagentStart(payload);
        break;
      case "SubagentStop":
        this.handleSubagentStop(payload);
        break;
      case "Notification":
        this.handleNotification(payload);
        break;
      case "Stop":
        this.handleStop(payload);
        break;
      case "SessionEnd":
        this.handleSessionEnd(payload);
        break;
    }
  }
  handleSessionStart(payload) {
    this.getOrCreateSession(payload.session_id);
    this.emit({
      time: 0,
      type: "agent_spawn",
      payload: {
        name: ORCHESTRATOR_NAME,
        isMain: true,
        task: `Session ${payload.session_id.slice(0, SESSION_ID_DISPLAY)}`
      }
    }, payload.session_id);
  }
  handlePreToolUse(payload) {
    const agentName = this.resolveAgentName(payload);
    const toolName = payload.tool_name || "unknown";
    const args2 = summarizeInput(toolName, payload.tool_input);
    if (!this.sessionState.has(payload.session_id)) {
      this.handleSessionStart(payload);
    }
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "tool_call_start",
      payload: {
        agent: agentName,
        tool: toolName,
        args: args2,
        preview: `${toolName}: ${args2}`.slice(0, PREVIEW_MAX)
      }
    }, payload.session_id);
  }
  handlePostToolUse(payload) {
    const agentName = this.resolveAgentName(payload);
    const toolName = payload.tool_name || "unknown";
    const result = payload.tool_response ? summarizeResult(payload.tool_response) : "";
    const tokenCost = estimateTokenCost(toolName, result);
    const discovery = buildDiscovery(toolName, extractFilePath(payload.tool_input), result);
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "tool_call_end",
      payload: {
        agent: agentName,
        tool: toolName,
        result: result.slice(0, RESULT_MAX),
        tokenCost,
        ...discovery ? { discovery } : {}
      }
    }, payload.session_id);
  }
  handlePostToolUseFailure(payload) {
    const agentName = this.resolveAgentName(payload);
    const toolName = payload.tool_name || "unknown";
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "tool_call_end",
      payload: {
        agent: agentName,
        tool: toolName,
        result: `[FAILED] ${(payload.tool_response ? summarizeResult(payload.tool_response) : "").slice(0, FAILED_RESULT_MAX)}`,
        tokenCost: 0
      }
    }, payload.session_id);
  }
  handleSubagentStart(payload) {
    const agentType = payload.agent_type || "subagent";
    const agentId = payload.agent_id || "";
    const sessionAgents = this.getOrCreateSession(payload.session_id).agentNames;
    const childName = agentId ? `${agentType}-${agentId.slice(-SUBAGENT_ID_SUFFIX_LENGTH)}` : generateSubagentFallbackName(String(Date.now()), sessionAgents.size + 1);
    sessionAgents.set(agentId, childName);
  }
  handleSubagentStop(payload) {
    const agentId = payload.agent_id || "";
    const sessionAgents = this.sessionState.get(payload.session_id)?.agentNames;
    const childName = sessionAgents?.get(agentId) || "subagent";
    const parentName = this.resolveAgentName(payload);
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "subagent_return",
      payload: { child: childName, parent: parentName, summary: `${payload.agent_type} complete` }
    }, payload.session_id);
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "agent_complete",
      payload: { name: childName }
    }, payload.session_id);
  }
  handleNotification(payload) {
    if (payload.notification_type !== "permission_prompt")
      return;
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "permission_requested",
      payload: {
        agent: ORCHESTRATOR_NAME,
        message: payload.message || "Permission needed",
        title: payload.title || "Permission needed"
      }
    }, payload.session_id);
  }
  handleStop(payload) {
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "agent_complete",
      payload: { name: ORCHESTRATOR_NAME }
    }, payload.session_id);
  }
  handleSessionEnd(payload) {
    this.emit({
      time: this.elapsedSeconds(payload.session_id),
      type: "agent_complete",
      payload: { name: ORCHESTRATOR_NAME, sessionEnd: true }
    }, payload.session_id);
    this.sessionState.delete(payload.session_id);
  }
  // ─── Helpers ─────────────────────────────────────────────────────────────
  resolveAgentName(payload) {
    if (payload.agent_id) {
      const name = this.sessionState.get(payload.session_id)?.agentNames.get(payload.agent_id);
      if (name)
        return name;
    }
    return ORCHESTRATOR_NAME;
  }
  emit(event, sessionId) {
    this._onEvent.fire(sessionId ? { ...event, sessionId } : event);
  }
  dispose() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.sessionState.clear();
    this._onEvent.dispose();
  }
};

// extension/src/protocol.ts
function emitSubagentSpawn(emitter, parent, child, task, sessionId) {
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: "subagent_dispatch",
    payload: { parent, child, task }
  }, sessionId);
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: "agent_spawn",
    payload: { name: child, parent, task }
  }, sessionId);
}

// extension/src/fs-utils.ts
var fs = __toESM(require("fs"));
function readFileChunk(filePath, offset, length) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}
function readNewFileLines(filePath, lastSize, lastTail = "") {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (stat.size < lastSize) {
    return { lines: [], newSize: 0, tail: "" };
  }
  if (stat.size <= lastSize) {
    return null;
  }
  const newContent = lastTail + readFileChunk(filePath, lastSize, stat.size - lastSize);
  const parts = newContent.split(/\r?\n/);
  const tail = parts.pop() ?? "";
  const lines = parts.filter(Boolean);
  return { lines, newSize: stat.size, tail };
}
function foldPathCase(p) {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

// extension/src/transcript-parser.ts
var log2 = createLogger("TranscriptParser");
function isRecord(v) {
  return v !== null && typeof v === "object";
}
function safeText(block) {
  if (!isRecord(block))
    return "";
  return String(block.text || "").trim();
}
function safeThinking(block) {
  if (!isRecord(block))
    return "";
  return String(block.thinking || "").trim();
}
function redactedThinkingSignature(block) {
  if (!isRecord(block))
    return null;
  if (String(block.thinking || "").trim())
    return null;
  const sig = block.signature;
  return typeof sig === "string" && sig.length > 0 ? sig : null;
}
function thinkingHashKey(entryUuid, fallbackSource) {
  return entryUuid ? `thinking:${entryUuid}` : `thinking:${fallbackSource.slice(0, HASH_PREFIX_MAX)}`;
}
var REDACTED_THINKING_LABEL = "Thinking...";
function isRealModelId(model) {
  return typeof model === "string" && model.length > 0 && !model.startsWith("<");
}
function parseAgentToolUseResult(toolUseResult) {
  if (!isRecord(toolUseResult))
    return { isAsync: false };
  return {
    isAsync: toolUseResult.status === "async_launched" || toolUseResult.isAsync === true,
    model: isRealModelId(toolUseResult.resolvedModel) ? toolUseResult.resolvedModel : void 0
  };
}
var TASK_NOTIFICATION_PREFIX = "<task-notification";
function userContentText(content) {
  if (typeof content === "string")
    return content.trim();
  if (!Array.isArray(content))
    return "";
  return content.map(safeText).filter(Boolean).join("\n");
}
function xmlTag(text, tag) {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match)
    return void 0;
  return match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}
function parseTaskNotification(text) {
  if (!text.startsWith(TASK_NOTIFICATION_PREFIX))
    return null;
  const toolUseId = xmlTag(text, "tool-use-id");
  if (!toolUseId)
    return null;
  return {
    toolUseId,
    status: xmlTag(text, "status") || "completed",
    summary: xmlTag(text, "result") || xmlTag(text, "summary") || ""
  };
}
var TranscriptParser = class {
  constructor(delegate) {
    this.delegate = delegate;
  }
  /** Per-subagent dedup state for inline progress events, keyed by parentToolUseID */
  inlineSubagentState = /* @__PURE__ */ new Map();
  /** Maps Agent tool_use ID → resolved child agent name (set in handleToolUse) */
  subagentChildNames = /* @__PURE__ */ new Map();
  /** Background Agent/Task launches waiting for their <task-notification>, keyed by tool_use ID.
   *  Their tool_result only confirms the launch; the real finish arrives later. */
  backgroundSubagents = /* @__PURE__ */ new Map();
  /** Clean up state associated with a completed session to prevent unbounded Map growth.
   *  Pass the session's pending tool_use_ids so we can remove orphaned entries. */
  clearSessionState(pendingToolUseIds, sessionId) {
    for (const toolUseId of pendingToolUseIds) {
      this.inlineSubagentState.delete(toolUseId);
      this.subagentChildNames.delete(toolUseId);
    }
    if (sessionId) {
      for (const [toolUseId, bg] of this.backgroundSubagents) {
        if (bg.sessionId !== sessionId)
          continue;
        this.backgroundSubagents.delete(toolUseId);
        this.subagentChildNames.delete(toolUseId);
        this.inlineSubagentState.delete(toolUseId);
      }
    }
  }
  processTranscriptLine(line, agentName = ORCHESTRATOR_NAME, ctxPending, ctxSeen, sessionId, ctxSeenMessages) {
    let parsed;
    try {
      parsed = JSON.parse(line.trim());
    } catch (err) {
      log2.debug("Skipping unparseable line:", err);
      return;
    }
    if (parsed.type === "progress") {
      this.handleProgressEvent(parsed, sessionId);
      return;
    }
    if (parsed.type !== "user" && parsed.type !== "assistant") {
      return;
    }
    const msg = parsed.message;
    if (!msg) {
      return;
    }
    const entry = {
      sessionId: parsed.sessionId,
      type: parsed.type,
      uuid: parsed.uuid,
      message: msg
    };
    if (entry.type === "user") {
      const notification = parseTaskNotification(userContentText(msg.content));
      if (notification) {
        this.handleTaskNotification(notification, sessionId);
      }
    }
    if (sessionId) {
      this.maybeSetSessionLabel(entry, sessionId);
    }
    const role = msg.role;
    const session = sessionId ? this.delegate.getSession(sessionId) : void 0;
    if (session && entry.type === "assistant" && isRealModelId(msg.model) && session.modelDetectedAgents.get(agentName) !== msg.model) {
      session.modelDetectedAgents.set(agentName, msg.model);
      if (!session.model)
        session.model = msg.model;
      this.delegate.emit({
        time: this.delegate.elapsed(sessionId),
        type: "model_detected",
        payload: { agent: agentName, model: msg.model }
      }, sessionId);
    }
    const seenMsgs = ctxSeenMessages ?? session?.seenMessageHashes;
    if (typeof msg.content === "string" && msg.content.trim()) {
      if (role === "user" || role === "human") {
        const text = msg.content.trim();
        if (!this.isSystemInjectedContent(text)) {
          const hash = entry.uuid ? `user:${entry.uuid}` : `user:${text.slice(0, HASH_PREFIX_MAX)}`;
          if (seenMsgs && seenMsgs.has(hash)) {
          } else {
            seenMsgs?.add(hash);
            if (session) {
              session.contextBreakdown.userMessages += estimateTokensFromText(text);
            }
            this.delegate.emit({
              time: this.delegate.elapsed(sessionId),
              type: "message",
              payload: { agent: agentName, role: "user", content: text.slice(0, MESSAGE_MAX) }
            }, sessionId);
          }
        }
      }
      if (session) {
        this.delegate.emitContextUpdate(agentName, session, sessionId);
      }
      return;
    }
    if (!Array.isArray(msg.content)) {
      return;
    }
    const emitRole = role === "user" || role === "human" ? "user" : "assistant";
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        const toolBlock = block;
        if (ctxSeen.has(toolBlock.id)) {
          continue;
        }
        ctxSeen.add(toolBlock.id);
        this.handleToolUse(toolBlock, agentName, ctxPending, sessionId);
      } else if (block.type === "tool_result") {
        this.handleToolResult(block, agentName, ctxPending, sessionId, parsed.toolUseResult);
      } else if (block.type === "text" && "text" in block) {
        this.handleTextBlock(block, emitRole, entry.uuid, agentName, seenMsgs, session, sessionId);
      } else if (block.type === "thinking" && "thinking" in block) {
        this.handleThinkingBlock(block, entry.uuid, agentName, seenMsgs, session, sessionId);
      }
    }
    if (session) {
      this.delegate.emitContextUpdate(agentName, session, sessionId);
    }
  }
  /** Process a text block — dedup, track tokens, emit message event */
  handleTextBlock(block, emitRole, entryUuid, agentName, seenMsgs, session, sessionId) {
    const text = safeText(block);
    if (!text)
      return;
    if (emitRole === "user" && this.isSystemInjectedContent(text))
      return;
    const hash = entryUuid ? `${emitRole}:${entryUuid}` : `${emitRole}:${text.slice(0, HASH_PREFIX_MAX)}`;
    if (seenMsgs?.has(hash))
      return;
    seenMsgs?.add(hash);
    if (session) {
      if (emitRole === "user") {
        session.contextBreakdown.userMessages += estimateTokensFromText(text);
      } else {
        session.contextBreakdown.reasoning += estimateTokensFromText(text);
      }
    }
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "message",
      payload: { agent: agentName, role: emitRole, content: text.slice(0, MESSAGE_MAX) }
    }, sessionId);
  }
  /** Process a thinking block — dedup, track tokens, emit message event.
   *  Redacted thinking (Opus 4.7+) is shown as a "Thinking..." placeholder. */
  handleThinkingBlock(block, entryUuid, agentName, seenMsgs, session, sessionId) {
    const thinking = safeThinking(block);
    const redactedSig = thinking ? null : redactedThinkingSignature(block);
    if (!thinking && !redactedSig)
      return;
    const hash = thinkingHashKey(entryUuid, thinking || redactedSig || "");
    if (seenMsgs?.has(hash))
      return;
    seenMsgs?.add(hash);
    if (session && thinking) {
      session.contextBreakdown.reasoning += estimateTokensFromText(thinking);
    }
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "message",
      payload: {
        agent: agentName,
        role: "thinking",
        content: thinking ? thinking.slice(0, MESSAGE_MAX) : REDACTED_THINKING_LABEL
      }
    }, sessionId);
  }
  handleToolUse(block, agentName, ctxPending, sessionId) {
    const toolName = block.name;
    const args2 = summarizeInput(toolName, block.input);
    const rawPath = block.input.file_path || block.input.path;
    const filePath = typeof rawPath === "string" ? rawPath : void 0;
    ctxPending.set(block.id, {
      name: toolName,
      args: args2,
      filePath,
      startTime: Date.now()
    });
    if (toolName === "Task" || toolName === "Agent") {
      const childName = resolveSubagentChildName(block.input);
      this.subagentChildNames.set(block.id, childName);
      const session = sessionId ? this.delegate.getSession(sessionId) : void 0;
      if (!session?.spawnedSubagents.has(childName)) {
        session?.spawnedSubagents.add(childName);
        emitSubagentSpawn(this.delegate, agentName, childName, args2, sessionId);
      }
    }
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "tool_call_start",
      payload: {
        agent: agentName,
        tool: toolName,
        args: args2,
        preview: `${toolName}: ${args2}`.slice(0, PREVIEW_MAX),
        inputData: extractInputData(toolName, block.input)
      }
    }, sessionId);
  }
  handleToolResult(block, agentName, ctxPending, sessionId, toolUseResult) {
    const pending = ctxPending.get(block.tool_use_id);
    if (!pending) {
      return;
    }
    const toolName = pending.name;
    const result = summarizeResult(block.content);
    const tokenCost = estimateTokensFromContent(block.content);
    if (sessionId) {
      const session = this.delegate.getSession(sessionId);
      if (session) {
        if (toolName === "Task" || toolName === "Agent") {
          session.contextBreakdown.subagentResults += tokenCost;
        } else {
          session.contextBreakdown.toolResults += tokenCost;
        }
      }
    }
    ctxPending.delete(block.tool_use_id);
    const discovery = buildDiscovery(toolName, pending?.filePath || "", result);
    if (toolName === "Task" || toolName === "Agent") {
      const childName = this.subagentChildNames.get(block.tool_use_id) || pending?.args?.slice(0, CHILD_NAME_MAX) || "subagent";
      const launch = parseAgentToolUseResult(toolUseResult);
      if (launch.model) {
        this.emitSubagentModel(childName, launch.model, sessionId);
      }
      if (launch.isAsync) {
        this.backgroundSubagents.set(block.tool_use_id, { childName, parent: agentName, sessionId });
      } else {
        this.subagentChildNames.delete(block.tool_use_id);
        this.inlineSubagentState.delete(block.tool_use_id);
        this.emitSubagentFinished(childName, agentName, result, sessionId);
      }
    }
    const isError = detectError(result);
    const errorMessage = isError ? result.slice(0, FAILED_RESULT_MAX) : void 0;
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "tool_call_end",
      payload: {
        agent: agentName,
        tool: toolName,
        result: result.slice(0, RESULT_MAX),
        tokenCost,
        ...discovery ? { discovery } : {},
        ...isError ? { isError, errorMessage } : {}
      }
    }, sessionId);
    if (sessionId) {
      const session = this.delegate.getSession(sessionId);
      if (session) {
        this.delegate.emitContextUpdate(agentName, session, sessionId);
      }
    }
  }
  emitSubagentFinished(childName, parent, summary, sessionId) {
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "subagent_return",
      payload: { child: childName, parent, summary: summary.slice(0, ARGS_MAX) }
    }, sessionId);
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "agent_complete",
      payload: { name: childName }
    }, sessionId);
  }
  /** Report a subagent's model from the parent transcript, unless its own
   *  transcript already did. Covers subagents whose file is never tailed. */
  emitSubagentModel(childName, model, sessionId) {
    const session = sessionId ? this.delegate.getSession(sessionId) : void 0;
    if (!session || session.modelDetectedAgents.has(childName))
      return;
    session.modelDetectedAgents.set(childName, model);
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: "model_detected",
      payload: { agent: childName, model }
    }, sessionId);
  }
  handleTaskNotification(notification, sessionId) {
    const bg = this.backgroundSubagents.get(notification.toolUseId);
    if (!bg)
      return;
    this.backgroundSubagents.delete(notification.toolUseId);
    this.subagentChildNames.delete(notification.toolUseId);
    this.inlineSubagentState.delete(notification.toolUseId);
    const summary = notification.status === "completed" ? notification.summary : `[${notification.status}] ${notification.summary}`.trim();
    this.emitSubagentFinished(bg.childName, bg.parent, summary, sessionId);
  }
  /**
   * Handle inline progress events from newer Claude Code versions.
   * These carry subagent transcript entries directly in the main JSONL,
   * keyed by parentToolUseID (the Agent tool_use that spawned the subagent).
   */
  handleProgressEvent(parsed, sessionId) {
    const data = parsed.data;
    if (!isRecord(data) || data.type !== "agent_progress") {
      return;
    }
    const innerEntry = data.message;
    if (!innerEntry?.message) {
      return;
    }
    const parentToolUseID = typeof parsed.parentToolUseID === "string" ? parsed.parentToolUseID : void 0;
    if (!parentToolUseID) {
      return;
    }
    let subState = this.inlineSubagentState.get(parentToolUseID);
    if (!subState) {
      const childName = this.subagentChildNames.get(parentToolUseID) || generateSubagentFallbackName("", this.inlineSubagentState.size + 1);
      subState = {
        agentName: childName,
        pending: /* @__PURE__ */ new Map(),
        seen: /* @__PURE__ */ new Set(),
        seenMessages: /* @__PURE__ */ new Set()
      };
      this.inlineSubagentState.set(parentToolUseID, subState);
      if (sessionId) {
        const session = this.delegate.getSession(sessionId);
        session?.inlineProgressAgents.add(childName);
      }
    }
    const innerLine = JSON.stringify(innerEntry);
    this.processTranscriptLine(innerLine, subState.agentName, subState.pending, subState.seen, sessionId, subState.seenMessages);
  }
  /**
   * Pre-scan existing file content:
   * 1. Build seenToolUseIds dedup set (prevents re-emitting old tool calls)
   * 2. Return all entries for catch-up emission
   */
  prescanExistingContent(filePath, size, session) {
    if (size === 0) {
      return [];
    }
    const catchUpEntries = [];
    try {
      const content = readFileChunk(filePath, 0, size);
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        try {
          const entry = JSON.parse(line.trim());
          if (entry.type === "user" && entry.message) {
            const notification = parseTaskNotification(userContentText(entry.message.content));
            if (notification) {
              this.backgroundSubagents.delete(notification.toolUseId);
            }
          }
          const isUser = entry.message?.role === "user" || entry.message?.role === "human";
          if (entry.message && Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === "tool_use" && block.id) {
                const toolBlock = block;
                session.seenToolUseIds.add(toolBlock.id);
                if (toolBlock.name === "Agent" || toolBlock.name === "Task") {
                  const childName = resolveSubagentChildName(toolBlock.input);
                  session.spawnedSubagents.add(childName);
                  this.subagentChildNames.set(toolBlock.id, childName);
                }
                const args2 = summarizeInput(toolBlock.name, toolBlock.input);
                const rawPath = toolBlock.input.file_path || toolBlock.input.path;
                const filePath2 = typeof rawPath === "string" ? rawPath : void 0;
                session.pendingToolCalls.set(toolBlock.id, { name: toolBlock.name, args: args2, filePath: filePath2, startTime: Date.now() });
              } else if (block.type === "tool_result") {
                const resultBlock = block;
                const childName = resultBlock.tool_use_id ? this.subagentChildNames.get(resultBlock.tool_use_id) : void 0;
                if (childName && parseAgentToolUseResult(entry.toolUseResult).isAsync) {
                  this.backgroundSubagents.set(resultBlock.tool_use_id, { childName, parent: ORCHESTRATOR_NAME, sessionId: session.sessionId });
                }
                if (resultBlock.tool_use_id) {
                  session.pendingToolCalls.delete(resultBlock.tool_use_id);
                }
                session.contextBreakdown.toolResults += estimateTokensFromContent(resultBlock.content);
              } else if (block.type === "text" && "text" in block) {
                const text = safeText(block);
                if (text) {
                  const emitRole = isUser ? "user" : "assistant";
                  const hashKey = entry.uuid ? `${emitRole}:${entry.uuid}` : `${emitRole}:${text.slice(0, HASH_PREFIX_MAX)}`;
                  session.seenMessageHashes.add(hashKey);
                  if (isUser) {
                    session.contextBreakdown.userMessages += estimateTokensFromText(text);
                  } else {
                    session.contextBreakdown.reasoning += estimateTokensFromText(text);
                  }
                }
              } else if (block.type === "thinking" && "thinking" in block) {
                const thinking = safeThinking(block);
                const redactedSig = thinking ? null : redactedThinkingSignature(block);
                if (thinking || redactedSig) {
                  session.seenMessageHashes.add(thinkingHashKey(entry.uuid, thinking || redactedSig || ""));
                  if (thinking) {
                    session.contextBreakdown.reasoning += estimateTokensFromText(thinking);
                  }
                }
              }
            }
          } else if (entry.type === "user" && typeof entry.message?.content === "string") {
            const text = entry.message.content.trim();
            if (text) {
              const hashKey = entry.uuid ? `user:${entry.uuid}` : `user:${text.slice(0, HASH_PREFIX_MAX)}`;
              session.seenMessageHashes.add(hashKey);
              session.contextBreakdown.userMessages += estimateTokensFromText(text);
            }
          }
          if (entry.type === "assistant" && isRealModelId(entry.message?.model) && !session.model) {
            session.model = entry.message.model;
          }
          if (entry.type === "user" || entry.type === "assistant") {
            catchUpEntries.push(entry);
          }
        } catch (err) {
          log2.debug("Skipping unparseable transcript line:", err);
        }
      }
      log2.info(`Pre-scanned ${session.seenToolUseIds.size} existing tool_use IDs, ${catchUpEntries.length} entries total`);
      return catchUpEntries;
    } catch (err) {
      log2.error("Pre-scan failed:", err);
      return [];
    }
  }
  /** Emit message events for pre-existing transcript entries (catch-up on session detection).
   *  Only emits the last user message (the current turn), not the full history. */
  emitCatchUpEntries(entries, session, sessionId) {
    let lastUserIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) {
      return;
    }
    const recentEntries = entries.slice(lastUserIndex);
    for (const entry of recentEntries) {
      const role = entry.type === "user" ? "user" : "assistant";
      const msg = entry.message;
      if (!msg) {
        continue;
      }
      if (typeof msg.content === "string" && msg.content.trim()) {
        const text = msg.content.trim();
        if (this.isSystemInjectedContent(text)) {
          continue;
        }
        this.delegate.emit({
          time: 0,
          type: "message",
          payload: { agent: ORCHESTRATOR_NAME, role, content: text.slice(0, MESSAGE_MAX) }
        }, sessionId);
        continue;
      }
      if (!Array.isArray(msg.content)) {
        continue;
      }
      for (const block of msg.content) {
        if (block.type === "text" && "text" in block) {
          const text = safeText(block);
          if (text && !this.isSystemInjectedContent(text)) {
            this.delegate.emit({
              time: 0,
              type: "message",
              payload: { agent: ORCHESTRATOR_NAME, role, content: text.slice(0, MESSAGE_MAX) }
            }, sessionId);
          }
        }
      }
    }
  }
  /** Extract a human-readable label from the first user message in transcript entries */
  extractSessionLabel(entries, session) {
    if (session.labelSet)
      return;
    for (const entry of entries) {
      if (entry.type !== "user")
        continue;
      const text = this.extractUserMessageText(entry);
      if (text) {
        session.label = this.truncateLabel(text);
        session.labelSet = true;
        return;
      }
    }
  }
  /** Extract text content from a user transcript entry, skipping system-injected tags */
  extractUserMessageText(entry) {
    const msg = entry.message;
    if (!msg)
      return null;
    if (typeof msg.content === "string" && msg.content.trim()) {
      const text = msg.content.trim();
      if (!this.isSystemInjectedContent(text))
        return text;
      return null;
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && "text" in block) {
          const text = safeText(block);
          if (text && !this.isSystemInjectedContent(text))
            return text;
        }
      }
    }
    return null;
  }
  /** Check if text is system-injected context (not a real user/assistant message) */
  isSystemInjectedContent(text) {
    return SYSTEM_CONTENT_PREFIXES.some((prefix) => text.startsWith(prefix));
  }
  /** Truncate to first line, max chars — fits in a tab */
  truncateLabel(text) {
    const firstLine = text.split("\n")[0].trim();
    if (firstLine.length <= SESSION_LABEL_MAX)
      return firstLine;
    return firstLine.slice(0, SESSION_LABEL_TRUNCATED) + "..";
  }
  /** Update session label on first user message and notify the webview */
  maybeSetSessionLabel(entry, sessionId) {
    const session = this.delegate.getSession(sessionId);
    if (!session || session.labelSet)
      return;
    if (entry.type !== "user")
      return;
    const text = this.extractUserMessageText(entry);
    if (!text)
      return;
    session.label = this.truncateLabel(text);
    session.labelSet = true;
    this.delegate.fireSessionLifecycle({ type: "updated", sessionId, label: session.label });
  }
};

// extension/src/subagent-watcher.ts
var fs2 = __toESM(require("fs"));
var path = __toESM(require("path"));

// extension/src/permission-detection.ts
function handlePermissionDetection(delegate, agentName, pendingToolCalls, permState, sessionId, sessionCompleted, checkSessionActivity) {
  if (permState.permissionTimer) {
    clearTimeout(permState.permissionTimer);
    permState.permissionTimer = null;
  }
  if (permState.permissionEmitted) {
    permState.permissionEmitted = false;
    delegate.emit({
      time: delegate.elapsed(sessionId),
      type: "agent_idle",
      payload: { name: agentName }
    }, sessionId);
  }
  const needsPermission = Array.from(pendingToolCalls.values()).some((tc) => tc.name !== "Agent" && tc.name !== "Task");
  if (needsPermission) {
    const snapshotTime = Date.now();
    permState.permissionTimer = setTimeout(() => {
      if (permState.permissionEmitted || sessionCompleted)
        return;
      const stillPending = Array.from(pendingToolCalls.values()).some((tc) => tc.name !== "Agent" && tc.name !== "Task" && tc.startTime <= snapshotTime);
      if (!stillPending)
        return;
      if (checkSessionActivity) {
        const lastActivity = delegate.getLastActivityTime(sessionId);
        if (lastActivity !== void 0) {
          const recentThreshold = Date.now() - PERMISSION_DETECT_MS;
          if (lastActivity > recentThreshold)
            return;
        }
      }
      permState.permissionEmitted = true;
      delegate.emit({
        time: delegate.elapsed(sessionId),
        type: "permission_requested",
        payload: {
          agent: agentName,
          message: "Waiting for permission"
        }
      }, sessionId);
    }, PERMISSION_DETECT_MS);
  }
}

// extension/src/subagent-watcher.ts
var log3 = createLogger("SubagentWatcher");
function resolveNameFromMeta(jsonlPath, fallbackIndex) {
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  try {
    const raw = fs2.readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    const name = resolveSubagentChildName(meta);
    if (name && name !== "subagent")
      return name;
  } catch {
  }
  return generateSubagentFallbackName("", fallbackIndex);
}
function scanSubagentsDir(delegate, parser2, sessionId) {
  const session = delegate.getSession(sessionId);
  if (!session || !session.subagentsDir)
    return;
  if (!session.subagentsDirWatcher && fs2.existsSync(session.subagentsDir)) {
    try {
      session.subagentsDirWatcher = fs2.watch(session.subagentsDir, () => {
        scanSubagentsDir(delegate, parser2, sessionId);
      });
    } catch (err) {
      log3.debug("Subagent dir watch failed:", err);
    }
  }
  const subDir = session.subagentsDir;
  if (!fs2.existsSync(subDir))
    return;
  try {
    const files = fs2.readdirSync(subDir);
    for (const file of files) {
      if (!file.endsWith(".jsonl"))
        continue;
      const filePath = path.join(subDir, file);
      if (session.subagentWatchers.has(filePath))
        continue;
      startWatchingSubagentFile(delegate, parser2, filePath, sessionId);
    }
  } catch (err) {
    log3.debug("Subagent dir scan failed:", err);
  }
}
function startWatchingSubagentFile(delegate, parser2, filePath, sessionId) {
  const session = delegate.getSession(sessionId);
  if (!session)
    return;
  const agentName = resolveNameFromMeta(filePath, session.subagentWatchers.size + 1);
  log3.info(`Tailing subagent: ${path.basename(filePath)} as "${agentName}" (session ${sessionId.slice(0, SESSION_ID_DISPLAY)})`);
  const state = {
    watcher: null,
    fileSize: 0,
    agentName,
    pendingToolCalls: /* @__PURE__ */ new Map(),
    seenToolUseIds: /* @__PURE__ */ new Set(),
    permissionTimer: null,
    permissionEmitted: false,
    spawnEmitted: false
  };
  session.subagentWatchers.set(filePath, state);
  const pendingToolUseIds = /* @__PURE__ */ new Set();
  try {
    const stat = fs2.statSync(filePath);
    if (stat.size > 0) {
      const content = fs2.readFileSync(filePath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim())
          continue;
        try {
          const raw = JSON.parse(line.trim());
          const entry = raw;
          if (raw && typeof raw === "object" && entry.message && Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === "tool_use" && block.id) {
                state.seenToolUseIds.add(block.id);
                pendingToolUseIds.add(block.id);
              } else if (block.type === "tool_result" && block.tool_use_id) {
                pendingToolUseIds.delete(block.tool_use_id);
              }
            }
          }
        } catch {
        }
      }
      state.fileSize = stat.size;
    }
  } catch (err) {
    log3.debug("Subagent initial read failed:", err);
  }
  const alreadySpawned = session.spawnedSubagents.has(agentName);
  state.spawnEmitted = pendingToolUseIds.size > 0 || alreadySpawned;
  if (pendingToolUseIds.size > 0 && !alreadySpawned) {
    session.spawnedSubagents.add(agentName);
    emitSubagentSpawn(delegate, ORCHESTRATOR_NAME, agentName, agentName, sessionId);
  }
  try {
    state.watcher = fs2.watch(filePath, () => {
      readSubagentNewLines(delegate, parser2, filePath, sessionId);
    });
  } catch (err) {
    log3.debug("Subagent file watch failed:", err);
  }
}
function readSubagentNewLines(delegate, parser2, filePath, sessionId) {
  const session = delegate.getSession(sessionId);
  if (!session)
    return;
  const state = session.subagentWatchers.get(filePath);
  if (!state)
    return;
  const result = readNewFileLines(filePath, state.fileSize);
  if (!result)
    return;
  state.fileSize = result.newSize;
  if (session.inlineProgressAgents.has(state.agentName)) {
    delegate.resetInactivityTimer(sessionId);
    return;
  }
  if (!state.spawnEmitted) {
    state.spawnEmitted = true;
    if (!session.spawnedSubagents.has(state.agentName)) {
      session.spawnedSubagents.add(state.agentName);
      emitSubagentSpawn(delegate, ORCHESTRATOR_NAME, state.agentName, state.agentName, sessionId);
    }
  }
  for (const line of result.lines) {
    parser2.processTranscriptLine(line, state.agentName, state.pendingToolCalls, state.seenToolUseIds, sessionId);
  }
  handlePermissionDetection(delegate, state.agentName, state.pendingToolCalls, state, sessionId);
  delegate.resetInactivityTimer(sessionId);
}

// extension/src/codex-session-watcher.ts
var fs3 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var os = __toESM(require("os"));

// extension/src/codex-rollout-parser.ts
var log4 = createLogger("CodexRolloutParser");
function createCodexRolloutState() {
  return {
    model: null,
    cwd: null,
    label: null,
    pendingToolCalls: /* @__PURE__ */ new Map(),
    seenMessageHashes: /* @__PURE__ */ new Set(),
    contextBreakdown: {
      systemPrompt: SYSTEM_PROMPT_BASE_TOKENS,
      userMessages: 0,
      toolResults: 0,
      reasoning: 0,
      subagentResults: 0
    },
    spawnEmitted: false,
    lastEmittedModel: null,
    lastReportedTokens: null,
    reportedContextWindow: null
  };
}
function isRecord2(v) {
  return v !== null && typeof v === "object";
}
function flattenContent(content) {
  if (typeof content === "string")
    return content.trim();
  if (!Array.isArray(content))
    return "";
  return content.map((c) => String(c?.text || "")).join("").trim();
}
var CODEX_PURE_INJECTION_PREFIXES = [
  "# AGENTS.md instructions for",
  // project-level instructions
  "<environment_context>",
  // per-turn environment metadata
  "<turn_aborted>",
  // interruption marker
  "<subagent_notification>"
  // reserved for future subagent support
];
var CODEX_REQUEST_MARKER = "## My request for Codex:";
function extractCodexUserText(raw) {
  const text = raw.trim();
  if (!text)
    return null;
  if (SYSTEM_CONTENT_PREFIXES.some((p) => text.startsWith(p)))
    return null;
  if (CODEX_PURE_INJECTION_PREFIXES.some((p) => text.startsWith(p)))
    return null;
  if (text.startsWith("# Context from my IDE setup:")) {
    const idx = text.indexOf(CODEX_REQUEST_MARKER);
    if (idx < 0)
      return null;
    return text.slice(idx + CODEX_REQUEST_MARKER.length).trim() || null;
  }
  return text;
}
function parseArgsJson(raw) {
  if (!raw)
    return void 0;
  try {
    const parsed = JSON.parse(raw);
    return isRecord2(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function extractOutputString(raw) {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (isRecord2(parsed) && typeof parsed.output === "string")
        return parsed.output;
    } catch {
    }
    return raw;
  }
  if (isRecord2(raw) && typeof raw.output === "string")
    return raw.output;
  return "";
}
function extractPatchFilePath(patch) {
  const m = patch.match(/^\*\*\* (?:Update File|Add File|Delete File):\s*(.+)$/m);
  return m ? m[1].trim() : void 0;
}
var CodexRolloutParser = class {
  constructor(delegate) {
    this.delegate = delegate;
  }
  /** Parse a single JSONL line. Silently skips unparseable/unknown lines. */
  processLine(line, state) {
    const trimmed = line.trim();
    if (!trimmed)
      return;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      return;
    }
    this.ensureSpawned(state);
    switch (record.type) {
      case "session_meta":
        return this.handleSessionMeta(record.payload, state);
      case "turn_context":
        return this.handleTurnContext(record.payload, state);
      case "response_item":
        return this.handleResponseItem(record.payload, state);
      case "event_msg":
        return this.handleEventMsg(record.payload, state);
      case "compacted":
        return this.handleCompacted(record.payload, state);
    }
  }
  // ─── Orchestrator lifecycle ──────────────────────────────────────────────
  ensureSpawned(state) {
    if (state.spawnEmitted)
      return;
    state.spawnEmitted = true;
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "agent_spawn",
      payload: { name: ORCHESTRATOR_NAME, isMain: true, task: "Codex session", runtime: "codex" }
    });
  }
  // ─── session_meta ────────────────────────────────────────────────────────
  handleSessionMeta(payload, state) {
    if (!payload)
      return;
    if (typeof payload.cwd === "string")
      state.cwd = payload.cwd;
    const sys = payload.base_instructions?.text;
    if (typeof sys === "string" && sys.length > 0) {
      state.contextBreakdown.systemPrompt = Math.max(
        estimateTokensFromText(sys),
        SYSTEM_PROMPT_BASE_TOKENS
      );
    }
    this.emitContextUpdate(state);
  }
  // ─── turn_context ────────────────────────────────────────────────────────
  handleTurnContext(payload, state) {
    if (!payload)
      return;
    if (typeof payload.cwd === "string")
      state.cwd = payload.cwd;
    if (typeof payload.model === "string" && payload.model !== state.lastEmittedModel) {
      state.model = payload.model;
      state.lastEmittedModel = payload.model;
      this.delegate.emit({
        time: this.delegate.elapsed(),
        type: "model_detected",
        payload: { agent: ORCHESTRATOR_NAME, model: payload.model }
      });
    }
  }
  // ─── response_item ───────────────────────────────────────────────────────
  handleResponseItem(payload, state) {
    if (!isRecord2(payload))
      return;
    const itemType = payload.type;
    switch (itemType) {
      case "message":
        return this.handleMessage(payload, state);
      case "function_call":
        return this.handleFunctionCall(payload, state);
      case "function_call_output":
        return this.handleFunctionCallOutput(payload, state);
      case "custom_tool_call":
        return this.handleCustomToolCall(payload, state);
      case "custom_tool_call_output":
        return this.handleCustomToolCallOutput(payload, state);
      case "web_search_call":
        return this.handleWebSearchCall(payload);
    }
  }
  handleMessage(payload, state) {
    const role = payload.role;
    if (role !== "user" && role !== "assistant")
      return;
    const rawText = flattenContent(payload.content);
    if (!rawText)
      return;
    const text = role === "user" ? extractCodexUserText(rawText) : rawText;
    if (!text)
      return;
    const hash = `${role}:${text.slice(0, HASH_PREFIX_MAX)}`;
    if (state.seenMessageHashes.has(hash))
      return;
    state.seenMessageHashes.add(hash);
    if (role === "user") {
      state.contextBreakdown.userMessages += estimateTokensFromText(text);
      if (!state.label) {
        state.label = text.slice(0, PREVIEW_MAX);
        this.delegate.setLabel?.(state.label);
      }
    }
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "message",
      payload: {
        agent: ORCHESTRATOR_NAME,
        role,
        content: text.slice(0, MESSAGE_MAX)
      }
    });
    this.emitContextUpdate(state);
  }
  handleFunctionCall(payload, state) {
    const name = payload.name || "unknown";
    const callId = payload.call_id;
    if (!callId)
      return;
    const args2 = parseArgsJson(payload.arguments);
    const argsSummary = summarizeInput(name, args2);
    const filePath = extractFilePath(args2);
    state.pendingToolCalls.set(callId, {
      name,
      args: argsSummary,
      startTime: Date.now(),
      filePath
    });
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "tool_call_start",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tool: name,
        args: argsSummary,
        preview: `${name}: ${argsSummary}`.slice(0, PREVIEW_MAX),
        inputData: extractInputData(name, args2 ?? {})
      }
    });
  }
  handleFunctionCallOutput(payload, state) {
    const callId = payload.call_id;
    if (!callId)
      return;
    const pending = state.pendingToolCalls.get(callId);
    if (!pending)
      return;
    state.pendingToolCalls.delete(callId);
    const output = extractOutputString(payload.output);
    const resultSummary = summarizeResult(output).slice(0, RESULT_MAX);
    const tokenCost = estimateTokenCost(pending.name, output);
    state.contextBreakdown.toolResults += tokenCost;
    const isError = detectError(output);
    const discovery = buildDiscovery(pending.name, pending.filePath, output);
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "tool_call_end",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tool: pending.name,
        result: resultSummary,
        tokenCost,
        ...isError ? { isError: true, errorMessage: resultSummary } : {},
        ...discovery ? { discovery } : {}
      }
    });
    this.emitContextUpdate(state);
  }
  handleCustomToolCall(payload, state) {
    const name = payload.name || "unknown";
    const callId = payload.call_id;
    if (!callId)
      return;
    const rawInput = typeof payload.input === "string" ? payload.input : "";
    const argsSummary = summarizeInput(name, { patch: rawInput });
    const filePath = extractPatchFilePath(rawInput);
    state.pendingToolCalls.set(callId, {
      name,
      args: argsSummary,
      startTime: Date.now(),
      filePath
    });
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "tool_call_start",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tool: name,
        args: argsSummary,
        preview: `${name}: ${argsSummary}`.slice(0, PREVIEW_MAX),
        inputData: extractInputData(name, { patch: rawInput })
      }
    });
  }
  handleCustomToolCallOutput(payload, state) {
    this.handleFunctionCallOutput(payload, state);
  }
  handleWebSearchCall(payload) {
    const query = String(payload.action?.query || "");
    if (!query)
      return;
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "tool_call_start",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tool: "WebSearch",
        args: query,
        preview: `WebSearch: ${query}`.slice(0, PREVIEW_MAX),
        inputData: { query }
      }
    });
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "tool_call_end",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tool: "WebSearch",
        result: payload.status || "completed",
        tokenCost: 0
      }
    });
  }
  // ─── event_msg ───────────────────────────────────────────────────────────
  handleEventMsg(payload, state) {
    if (!isRecord2(payload))
      return;
    switch (payload.type) {
      case "agent_reasoning":
        return this.handleAgentReasoning(payload, state);
      case "token_count":
        return this.handleTokenCount(payload, state);
    }
  }
  /** Codex reports authoritative token usage per turn. Prefer it over our
   *  text-length estimates whenever info is populated.
   *
   *  - `last_token_usage.input_tokens` = size of this turn's prompt = current
   *    context fill (what the gauge should show).
   *  - `total_token_usage.input_tokens` = cumulative across the session — used
   *    for billing, not context fill.
   *  - `model_context_window` = authoritative tokensMax for this model. */
  handleTokenCount(payload, state) {
    const info = payload.info;
    if (!isRecord2(info))
      return;
    if (typeof info.model_context_window === "number" && info.model_context_window > 0) {
      state.reportedContextWindow = info.model_context_window;
    }
    const last = info.last_token_usage;
    if (isRecord2(last) && typeof last.input_tokens === "number" && last.input_tokens > 0) {
      state.lastReportedTokens = last.input_tokens;
      const reasoning = typeof last.reasoning_output_tokens === "number" ? last.reasoning_output_tokens : 0;
      state.contextBreakdown.reasoning = reasoning;
      state.contextBreakdown.userMessages = 0;
      state.contextBreakdown.subagentResults = 0;
      state.contextBreakdown.toolResults = Math.max(
        0,
        last.input_tokens - state.contextBreakdown.systemPrompt - reasoning
      );
    }
    this.emitContextUpdate(state, { authoritative: true });
  }
  handleAgentReasoning(payload, state) {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text)
      return;
    const hash = `thinking:${text.slice(0, HASH_PREFIX_MAX)}`;
    if (state.seenMessageHashes.has(hash))
      return;
    state.seenMessageHashes.add(hash);
    state.contextBreakdown.reasoning += estimateTokensFromText(text);
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "message",
      payload: {
        agent: ORCHESTRATOR_NAME,
        role: "thinking",
        content: text.slice(0, MESSAGE_MAX)
      }
    });
    this.emitContextUpdate(state);
  }
  // ─── compacted ───────────────────────────────────────────────────────────
  handleCompacted(payload, state) {
    if (!payload)
      return;
    let userTokens = 0;
    let toolResultTokens = 0;
    for (const entry of payload.replacement_history ?? []) {
      if (entry?.role === "user") {
        userTokens += estimateTokensFromText(flattenContent(entry.content));
      } else if (entry?.role === "tool" || entry?.type === "tool_result") {
        toolResultTokens += estimateTokensFromText(flattenContent(entry.content));
      }
    }
    state.contextBreakdown.userMessages = userTokens;
    state.contextBreakdown.toolResults = toolResultTokens;
    state.contextBreakdown.reasoning = 0;
    state.contextBreakdown.subagentResults = 0;
    this.emitContextUpdate(state);
    log4.info("Context compacted \u2014 token breakdown reset from replacement_history");
  }
  // ─── Shared helpers ──────────────────────────────────────────────────────
  emitContextUpdate(state, opts = {}) {
    const bd = state.contextBreakdown;
    const estimated = bd.systemPrompt + bd.userMessages + bd.toolResults + bd.reasoning + bd.subagentResults;
    const tokens = state.lastReportedTokens ?? estimated;
    this.delegate.emit({
      time: this.delegate.elapsed(),
      type: "context_update",
      payload: {
        agent: ORCHESTRATOR_NAME,
        tokens,
        breakdown: { ...bd },
        ...state.reportedContextWindow ? { tokensMax: state.reportedContextWindow } : {},
        ...opts.authoritative ? { isAuthoritative: true } : {}
      }
    });
  }
};

// extension/src/typed-event-emitter.ts
var TypedEventEmitter = class {
  listeners = [];
  disposed = false;
  event = (listener) => {
    if (this.disposed)
      return { dispose: () => {
      } };
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0)
          this.listeners.splice(idx, 1);
      }
    };
  };
  fire(data) {
    if (this.disposed)
      return;
    for (const l of [...this.listeners])
      l(data);
  }
  dispose() {
    this.disposed = true;
    this.listeners = [];
  }
};

// extension/src/codex-session-watcher.ts
var log5 = createLogger("CodexSessionWatcher");
var SCAN_DAYS = 3;
var SESSION_ID_FROM_FILENAME = /rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})\.jsonl$/;
function codexHome() {
  return process.env.CODEX_HOME || path2.join(os.homedir(), ".codex");
}
function sessionsRoot() {
  return path2.join(codexHome(), "sessions");
}
function recentSessionDirs(now) {
  const root = sessionsRoot();
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < SCAN_DAYS; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1e3);
    for (const [y, m, day] of [
      [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()],
      [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    ]) {
      const dir = path2.join(
        root,
        String(y),
        String(m).padStart(2, "0"),
        String(day).padStart(2, "0")
      );
      if (!seen.has(dir))
        seen.add(dir);
    }
  }
  return Array.from(seen);
}
function readSessionCwd(filePath) {
  const CHUNK_SIZE = 65536;
  const MAX_FIRST_LINE = 1048576;
  try {
    const fd = fs3.openSync(filePath, "r");
    try {
      const chunks = [];
      let total = 0;
      let end = -1;
      while (total < MAX_FIRST_LINE) {
        const buf = Buffer.alloc(CHUNK_SIZE);
        const read = fs3.readSync(fd, buf, 0, buf.length, total);
        if (read <= 0)
          break;
        const filled = buf.subarray(0, read);
        const newlineAt = filled.indexOf(10);
        chunks.push(filled);
        total += read;
        if (newlineAt >= 0) {
          end = total - read + newlineAt;
          break;
        }
      }
      const data = Buffer.concat(chunks);
      const line = data.subarray(0, end >= 0 ? end : data.length).toString("utf-8");
      const parsed = JSON.parse(line);
      if (parsed.type !== "session_meta")
        return null;
      return typeof parsed.payload?.cwd === "string" ? parsed.payload.cwd : null;
    } finally {
      fs3.closeSync(fd);
    }
  } catch {
    return null;
  }
}
var CodexSessionWatcher = class {
  /** Workspace path used as a cwd filter — Codex sessions are attached only if
   *  their session_meta.cwd matches this path (or is under it). Pass null/undefined
   *  to attach to any Codex session (useful when no workspace is open). */
  constructor(workspace) {
    this.workspace = workspace;
  }
  dirWatchers = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  workspacePath = null;
  scanInterval = null;
  /** One-shot flag so the cwd-mismatch hint is logged at most once per process. */
  cwdMismatchWarned = false;
  _onEvent = new TypedEventEmitter();
  _onSessionDetected = new TypedEventEmitter();
  _onSessionLifecycle = new TypedEventEmitter();
  onEvent = this._onEvent.event;
  onSessionDetected = this._onSessionDetected.event;
  onSessionLifecycle = this._onSessionLifecycle.event;
  isActive() {
    for (const s of this.sessions.values()) {
      if (s.sessionDetected && !s.sessionCompleted)
        return true;
    }
    return false;
  }
  isSessionActive(sessionId) {
    const s = this.sessions.get(sessionId);
    return !!s && s.sessionDetected && !s.sessionCompleted;
  }
  getActiveSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.sessionId,
      label: s.label,
      status: s.sessionCompleted ? "completed" : "active",
      startTime: s.sessionStartTime,
      lastActivityTime: s.lastActivityTime
    }));
  }
  replaySessionStart(sessionIds) {
    for (const [id, session] of this.sessions) {
      if (!session.sessionDetected)
        continue;
      if (sessionIds && !sessionIds.includes(id))
        continue;
      this._onSessionLifecycle.fire({ type: "started", sessionId: id, label: session.label });
    }
  }
  start() {
    if (this.workspace) {
      try {
        this.workspacePath = fs3.realpathSync(this.workspace);
      } catch {
        this.workspacePath = this.workspace;
      }
    }
    this.scanForSessions();
    this.scanInterval = setInterval(() => this.scanForSessions(), SCAN_INTERVAL_MS);
    const root = sessionsRoot();
    if (fs3.existsSync(root)) {
      try {
        const rootWatcher = fs3.watch(root, { recursive: false }, () => this.scanForSessions());
        this.dirWatchers.set(root, rootWatcher);
      } catch (err) {
        log5.debug("Root dir watch failed:", err);
      }
    }
    log5.info(`Watching ${root} for workspace ${this.workspacePath ?? "<any>"}`);
  }
  scanForSessions() {
    const now = /* @__PURE__ */ new Date();
    let skippedByCwd = 0;
    for (const dir of recentSessionDirs(now)) {
      if (!fs3.existsSync(dir))
        continue;
      if (!this.dirWatchers.has(dir)) {
        try {
          const w = fs3.watch(dir, () => this.scanForSessions());
          this.dirWatchers.set(dir, w);
        } catch (err) {
          log5.debug("Dir watch failed:", dir, err);
        }
      }
      let entries;
      try {
        entries = fs3.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.startsWith("rollout-") || !name.endsWith(".jsonl"))
          continue;
        const filePath = path2.join(dir, name);
        if (this.sessions.has(this.sessionIdFor(filePath)))
          continue;
        let stat;
        try {
          stat = fs3.statSync(filePath);
        } catch {
          continue;
        }
        if (stat.size === 0)
          continue;
        const ageS = (Date.now() - stat.mtimeMs) / 1e3;
        if (ageS > ACTIVE_SESSION_AGE_S)
          continue;
        if (this.workspacePath) {
          const cwd = readSessionCwd(filePath);
          if (cwd === null)
            continue;
          const resolvedCwd = this.resolvePath(cwd);
          if (!resolvedCwd || !this.pathMatchesWorkspace(resolvedCwd)) {
            skippedByCwd++;
            continue;
          }
        }
        this.attachSession(filePath, stat);
      }
    }
    if (skippedByCwd > 0 && this.sessions.size === 0 && !this.cwdMismatchWarned) {
      this.cwdMismatchWarned = true;
      log5.warn(
        `Found ${skippedByCwd} recent Codex session(s), but none ran in ${this.workspacePath}. Codex sessions are only shown for the current workspace \u2014 launch the visualizer from the directory where Codex runs (or open that folder in VS Code).`
      );
    }
  }
  sessionIdFor(filePath) {
    const m = path2.basename(filePath).match(SESSION_ID_FROM_FILENAME);
    return m ? m[1] : path2.basename(filePath, ".jsonl");
  }
  resolvePath(p) {
    try {
      return fs3.realpathSync(p);
    } catch {
      return p;
    }
  }
  /** Windows filesystems are case-insensitive and tools disagree on drive-letter
   *  case (VS Code reports `c:\...`, Codex writes `C:\...`) — compare folded there. */
  pathMatchesWorkspace(p) {
    if (!this.workspacePath)
      return true;
    const fold = (s) => process.platform === "win32" ? s.toLowerCase() : s;
    const candidate = fold(p);
    const workspace = fold(this.workspacePath);
    if (candidate === workspace)
      return true;
    return candidate.startsWith(workspace + path2.sep);
  }
  attachSession(filePath, stat) {
    const sessionId = this.sessionIdFor(filePath);
    const label = `Codex ${sessionId.slice(0, SESSION_ID_DISPLAY)}`;
    const parser2 = new CodexRolloutParser({
      emit: (event) => this._onEvent.fire({ ...event, sessionId }),
      elapsed: () => {
        const s = this.sessions.get(sessionId);
        return s ? (Date.now() - s.sessionStartTime) / 1e3 : 0;
      },
      setLabel: (newLabel) => {
        const s = this.sessions.get(sessionId);
        if (!s || !s.label.startsWith("Codex "))
          return;
        s.label = newLabel;
        this._onSessionLifecycle.fire({ type: "updated", sessionId, label: newLabel });
      }
    });
    const session = {
      sessionId,
      filePath,
      fileWatcher: null,
      pollTimer: null,
      inactivityTimer: null,
      fileSize: 0,
      fileTail: "",
      sessionStartTime: stat.birthtimeMs || stat.mtimeMs,
      lastActivityTime: stat.mtimeMs,
      sessionDetected: false,
      sessionCompleted: false,
      label,
      rolloutState: createCodexRolloutState(),
      parser: parser2
    };
    this.sessions.set(sessionId, session);
    this.readNewLines(sessionId);
    session.sessionDetected = true;
    this._onSessionDetected.fire(sessionId);
    this._onSessionLifecycle.fire({ type: "started", sessionId, label });
    try {
      session.fileWatcher = fs3.watch(filePath, () => this.readNewLines(sessionId));
    } catch (err) {
      log5.debug("File watch failed:", filePath, err);
    }
    session.pollTimer = setInterval(() => this.readNewLines(sessionId), POLL_FALLBACK_MS);
    this.resetInactivityTimer(sessionId);
    log5.info(`Attached to session ${sessionId.slice(0, SESSION_ID_DISPLAY)} at ${filePath}`);
  }
  readNewLines(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session)
      return;
    const result = readNewFileLines(session.filePath, session.fileSize, session.fileTail);
    if (!result)
      return;
    session.fileSize = result.newSize;
    session.fileTail = result.tail;
    session.lastActivityTime = Date.now();
    if (session.sessionCompleted) {
      session.sessionCompleted = false;
      this._onSessionLifecycle.fire({ type: "started", sessionId, label: session.label });
      log5.info(`Session ${sessionId.slice(0, SESSION_ID_DISPLAY)} re-activated after idle`);
    }
    for (const line of result.lines) {
      try {
        session.parser.processLine(line, session.rolloutState);
      } catch (err) {
        log5.debug("Parser threw on line:", err);
      }
    }
    this.resetInactivityTimer(sessionId);
  }
  resetInactivityTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session)
      return;
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
    }
    session.inactivityTimer = setTimeout(() => {
      if (session.sessionCompleted)
        return;
      session.sessionCompleted = true;
      this._onEvent.fire({
        time: (Date.now() - session.sessionStartTime) / 1e3,
        type: "agent_complete",
        payload: { name: ORCHESTRATOR_NAME, sessionEnd: true },
        sessionId
      });
      this._onSessionLifecycle.fire({ type: "ended", sessionId, label: session.label });
    }, INACTIVITY_TIMEOUT_MS);
  }
  dispose() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    for (const w of this.dirWatchers.values())
      w.close();
    this.dirWatchers.clear();
    for (const s of this.sessions.values()) {
      s.fileWatcher?.close();
      if (s.pollTimer)
        clearInterval(s.pollTimer);
      if (s.inactivityTimer)
        clearTimeout(s.inactivityTimer);
    }
    this.sessions.clear();
    this._onEvent.dispose();
    this._onSessionDetected.dispose();
    this._onSessionLifecycle.dispose();
  }
};

// scripts/relay.ts
var MAX_EVENT_BUFFER = 5e3;
var DISCOVERY_DIR = path3.join(os2.homedir(), ".claude", "agent-flow");
var CLAUDE_DIR = path3.join(os2.homedir(), ".claude", "projects");
var relayCreated = false;
var verbose = false;
var sessionEventCount = 0;
var observedModels = /* @__PURE__ */ new Set();
function resolveAgentFlowVersion() {
  try {
    if ("0.9.2") {
      return "0.9.2";
    }
  } catch {
  }
  try {
    const pkgPath = path3.join(__dirname, "..", "app", "package.json");
    if (fs4.existsSync(pkgPath)) {
      return JSON.parse(fs4.readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
    }
  } catch {
  }
  return "0.0.0";
}
function log6(...args2) {
  if (verbose)
    console.log(...args2);
}
var sseClients = /* @__PURE__ */ new Set();
function sendSSE(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}

`);
  } catch {
    sseClients.delete(res);
  }
}
function broadcast(data) {
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}

`);
    } catch {
      sseClients.delete(res);
    }
  }
}
var eventBuffer = /* @__PURE__ */ new Map();
function broadcastEvent(event) {
  sessionEventCount++;
  if (event.type === "model_detected") {
    const m = event.payload?.model;
    if (typeof m === "string" && m.length > 0)
      observedModels.add(m);
  }
  const sid = event.sessionId?.slice(0, SESSION_ID_DISPLAY) || "?";
  log6(`[event] ${event.type} (session ${sid})`);
  if (event.sessionId) {
    let buf = eventBuffer.get(event.sessionId) || [];
    buf.push(event);
    if (buf.length > MAX_EVENT_BUFFER) {
      buf = buf.slice(buf.length - MAX_EVENT_BUFFER);
    }
    eventBuffer.set(event.sessionId, buf);
  }
  broadcast(JSON.stringify({ type: "agent-event", event }));
}
function broadcastSessionLifecycle(type, sessionId, label) {
  if (type === "started") {
    broadcast(JSON.stringify({
      type: "session-started",
      session: { id: sessionId, label, status: "active", startTime: Date.now(), lastActivityTime: Date.now() }
    }));
  } else if (type === "ended") {
    broadcast(JSON.stringify({ type: "session-ended", sessionId }));
  } else if (type === "updated") {
    broadcast(JSON.stringify({ type: "session-updated", sessionId, label }));
  }
}
var sessions = /* @__PURE__ */ new Map();
function elapsed(sessionId) {
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session)
      return (Date.now() - session.sessionStartTime) / 1e3;
  }
  return 0;
}
function emitContextUpdate(agentName, session, sessionId) {
  const bd = session.contextBreakdown;
  const total = bd.systemPrompt + bd.userMessages + bd.toolResults + bd.reasoning + bd.subagentResults;
  broadcastEvent({
    time: elapsed(sessionId),
    type: "context_update",
    payload: { agent: agentName, tokens: total, breakdown: { ...bd } },
    sessionId
  });
}
function emitEvent(event, sessionId) {
  broadcastEvent(sessionId ? { ...event, sessionId } : event);
}
var parser = new TranscriptParser({
  emit: emitEvent,
  elapsed,
  getSession: (sessionId) => sessions.get(sessionId),
  fireSessionLifecycle: (event) => broadcastSessionLifecycle(event.type, event.sessionId, event.label),
  emitContextUpdate
});
var watcherDelegate = {
  emit: emitEvent,
  elapsed,
  getSession: (sessionId) => sessions.get(sessionId),
  getLastActivityTime: (sessionId) => sessions.get(sessionId)?.lastActivityTime,
  resetInactivityTimer: (sessionId) => resetInactivityTimer(sessionId)
};
function resetInactivityTimer(sessionId) {
  const session = sessions.get(sessionId);
  if (!session)
    return;
  const wasCompleted = session.sessionCompleted;
  session.lastActivityTime = Date.now();
  session.sessionCompleted = false;
  if (wasCompleted) {
    broadcastEvent({
      time: elapsed(sessionId),
      type: "agent_spawn",
      payload: { name: ORCHESTRATOR_NAME, isMain: true, task: session.label, ...session.model ? { model: session.model } : {} },
      sessionId
    });
    broadcastSessionLifecycle("started", sessionId, session.label);
  }
  if (session.inactivityTimer)
    clearTimeout(session.inactivityTimer);
  session.inactivityTimer = setTimeout(() => {
    if (!session.sessionCompleted && session.sessionDetected) {
      log6(`[session] ${sessionId.slice(0, SESSION_ID_DISPLAY)} inactive`);
      session.sessionCompleted = true;
      broadcastEvent({
        time: elapsed(sessionId),
        type: "agent_complete",
        payload: { name: ORCHESTRATOR_NAME },
        sessionId
      });
      broadcastSessionLifecycle("ended", sessionId, session.label);
    }
  }, INACTIVITY_TIMEOUT_MS);
}
function watchSession(sessionId, filePath) {
  const defaultLabel = `Session ${sessionId.slice(0, SESSION_ID_DISPLAY)}`;
  const session = {
    sessionId,
    filePath,
    fileWatcher: null,
    pollTimer: null,
    fileSize: 0,
    sessionStartTime: Date.now(),
    pendingToolCalls: /* @__PURE__ */ new Map(),
    seenToolUseIds: /* @__PURE__ */ new Set(),
    seenMessageHashes: /* @__PURE__ */ new Set(),
    sessionDetected: false,
    sessionCompleted: false,
    lastActivityTime: Date.now(),
    inactivityTimer: null,
    subagentWatchers: /* @__PURE__ */ new Map(),
    spawnedSubagents: /* @__PURE__ */ new Set(),
    inlineProgressAgents: /* @__PURE__ */ new Set(),
    subagentsDirWatcher: null,
    subagentsDir: null,
    label: defaultLabel,
    labelSet: false,
    model: null,
    modelDetectedAgents: /* @__PURE__ */ new Map(),
    permissionTimer: null,
    permissionEmitted: false,
    contextBreakdown: { systemPrompt: SYSTEM_PROMPT_BASE_TOKENS, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 }
  };
  sessions.set(sessionId, session);
  const stat = fs4.statSync(filePath);
  const catchUpEntries = parser.prescanExistingContent(filePath, stat.size, session);
  session.fileSize = stat.size;
  parser.extractSessionLabel(catchUpEntries, session);
  broadcastSessionLifecycle("started", sessionId, session.label);
  broadcastEvent({
    time: 0,
    type: "agent_spawn",
    payload: { name: ORCHESTRATOR_NAME, isMain: true, task: session.label, ...session.model ? { model: session.model } : {} },
    sessionId
  });
  session.sessionDetected = true;
  emitContextUpdate(ORCHESTRATOR_NAME, session, sessionId);
  parser.emitCatchUpEntries(catchUpEntries, session, sessionId);
  session.fileWatcher = fs4.watch(filePath, (eventType) => {
    if (eventType === "change")
      readNewLines(sessionId);
  });
  session.pollTimer = setInterval(() => {
    readNewLines(sessionId);
    for (const [subPath] of session.subagentWatchers) {
      readSubagentNewLines(watcherDelegate, parser, subPath, sessionId);
    }
    scanSubagentsDir(watcherDelegate, parser, sessionId);
  }, POLL_FALLBACK_MS);
  session.subagentsDir = path3.join(path3.dirname(filePath), sessionId, "subagents");
  scanSubagentsDir(watcherDelegate, parser, sessionId);
  resetInactivityTimer(sessionId);
  log6(`[session] Watching ${sessionId.slice(0, SESSION_ID_DISPLAY)} \u2014 "${session.label}"`);
}
function readNewLines(sessionId) {
  const session = sessions.get(sessionId);
  if (!session)
    return;
  const result = readNewFileLines(session.filePath, session.fileSize);
  if (!result)
    return;
  session.fileSize = result.newSize;
  for (const line of result.lines) {
    parser.processTranscriptLine(line, ORCHESTRATOR_NAME, session.pendingToolCalls, session.seenToolUseIds, sessionId, session.seenMessageHashes);
  }
  handlePermissionDetection(watcherDelegate, ORCHESTRATOR_NAME, session.pendingToolCalls, session, sessionId, session.sessionCompleted, true);
  scanSubagentsDir(watcherDelegate, parser, sessionId);
  resetInactivityTimer(sessionId);
}
function scanForActiveSessions(workspace) {
  if (!fs4.existsSync(CLAUDE_DIR))
    return;
  let resolved = workspace;
  try {
    resolved = fs4.realpathSync(resolved);
  } catch {
  }
  const encoded = resolved.replace(/[^a-zA-Z0-9]/g, "-");
  const dirsToScan = [];
  const encodedFolded = foldPathCase(encoded);
  try {
    for (const dir of fs4.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory())
        continue;
      const nameFolded = foldPathCase(dir.name);
      if (nameFolded === encodedFolded || nameFolded.startsWith(encodedFolded + "-")) {
        dirsToScan.push(path3.join(CLAUDE_DIR, dir.name));
      }
    }
  } catch {
    const projectDir = path3.join(CLAUDE_DIR, encoded);
    if (fs4.existsSync(projectDir))
      dirsToScan.push(projectDir);
  }
  for (const dirPath of dirsToScan) {
    try {
      for (const file of fs4.readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl"))
          continue;
        const filePath = path3.join(dirPath, file);
        const stat = fs4.statSync(filePath);
        const sessionId = path3.basename(file, ".jsonl");
        let newestMtime = stat.mtimeMs;
        const subagentsDir = path3.join(dirPath, sessionId, "subagents");
        try {
          if (fs4.existsSync(subagentsDir)) {
            for (const subFile of fs4.readdirSync(subagentsDir)) {
              if (!subFile.endsWith(".jsonl"))
                continue;
              const subStat = fs4.statSync(path3.join(subagentsDir, subFile));
              if (subStat.mtimeMs > newestMtime)
                newestMtime = subStat.mtimeMs;
            }
          }
        } catch {
        }
        const ageSeconds = (Date.now() - newestMtime) / 1e3;
        if (ageSeconds <= ACTIVE_SESSION_AGE_S && !sessions.has(sessionId)) {
          watchSession(sessionId, filePath);
        }
      }
    } catch {
    }
  }
}
function normalizePath(p) {
  let resolved = path3.resolve(p);
  try {
    resolved = fs4.realpathSync(resolved);
  } catch {
  }
  return resolved;
}
function hashWorkspace(workspace) {
  return crypto.createHash("sha256").update(normalizePath(workspace)).digest("hex").slice(0, WORKSPACE_HASH_LENGTH);
}
var discoveryFilePath = null;
function writeDiscoveryFile(port, workspace) {
  if (!fs4.existsSync(DISCOVERY_DIR))
    fs4.mkdirSync(DISCOVERY_DIR, { recursive: true });
  const hash = hashWorkspace(workspace);
  discoveryFilePath = path3.join(DISCOVERY_DIR, `${hash}-${process.pid}.json`);
  fs4.writeFileSync(discoveryFilePath, JSON.stringify({ port, pid: process.pid, workspace: normalizePath(workspace) }, null, 2) + "\n");
}
function removeDiscoveryFile() {
  if (discoveryFilePath) {
    try {
      fs4.unlinkSync(discoveryFilePath);
    } catch {
    }
  }
}
function resolveRuntimeMode(explicit) {
  if (explicit === "claude" || explicit === "codex" || explicit === "auto")
    return explicit;
  const raw = process.env.AGENT_FLOW_RUNTIME;
  return raw === "claude" || raw === "codex" ? raw : "auto";
}
async function createRelay(options) {
  const { workspace } = options;
  verbose = options.verbose ?? false;
  if (!verbose)
    setLogLevel("warn");
  if (relayCreated) {
    throw new Error("createRelay() can only be called once per process");
  }
  relayCreated = true;
  const mode = resolveRuntimeMode(options.runtime);
  const wantClaude = mode === "claude" || mode === "auto";
  const wantCodex = mode === "codex" || mode === "auto";
  log6(`[relay] Runtime mode: ${mode} (watching: ${[wantClaude && "claude", wantCodex && "codex"].filter(Boolean).join(", ")})`);
  let hookServer = null;
  let scanInterval = null;
  let projectDirWatcher = null;
  if (wantClaude) {
    hookServer = new HookServer();
    const hookPort = await hookServer.start();
    if (hookPort === HOOK_SERVER_NOT_STARTED) {
      throw new Error("Failed to start hook server (port in use)");
    }
    hookServer.onEvent((event) => {
      broadcast(JSON.stringify({ type: "agent-event", event }));
    });
    writeDiscoveryFile(hookPort, workspace);
    scanForActiveSessions(workspace);
    scanInterval = setInterval(() => scanForActiveSessions(workspace), SCAN_INTERVAL_MS);
    const resolved = (() => {
      try {
        return fs4.realpathSync(workspace);
      } catch {
        return workspace;
      }
    })();
    const encoded = resolved.replace(/[^a-zA-Z0-9]/g, "-");
    const projectDir = path3.join(CLAUDE_DIR, encoded);
    if (fs4.existsSync(projectDir)) {
      try {
        projectDirWatcher = fs4.watch(projectDir, (_eventType, filename) => {
          if (filename?.endsWith(".jsonl"))
            scanForActiveSessions(workspace);
        });
      } catch {
      }
    }
  }
  let codexWatcher = null;
  if (wantCodex) {
    codexWatcher = new CodexSessionWatcher(workspace);
    codexWatcher.onEvent((event) => broadcastEvent(event));
    codexWatcher.onSessionLifecycle((lifecycle) => {
      broadcastSessionLifecycle(lifecycle.type, lifecycle.sessionId, lifecycle.label);
    });
    codexWatcher.start();
  }
  const telemetry = options.telemetry;
  const sessionStart = Date.now();
  let relayDisposed = false;
  const relaySessionId = `relay-${process.pid}-${Math.floor(sessionStart / 1e3)}`;
  sessionEventCount = 0;
  const agentFlowVersion = resolveAgentFlowVersion();
  const baseEvent = () => ({
    session_id: relaySessionId,
    agent_flow_version: agentFlowVersion,
    os: os2.platform(),
    arch: os2.arch()
  });
  telemetry?.emit({ ...baseEvent(), event_type: "session_start" });
  process.on("uncaughtException", (err) => {
    try {
      telemetry?.emit({
        ...baseEvent(),
        event_type: "error",
        error_class: err?.constructor?.name ?? "Error"
      });
    } catch {
    }
    console.error(err);
    process.exit(1);
  });
  return {
    handleSSE(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      sseClients.add(res);
      log6(`[sse] Client connected (${sseClients.size} total)`);
      req.on("close", () => {
        sseClients.delete(res);
        log6(`[sse] Client disconnected (${sseClients.size} total)`);
      });
      const sessionList = [];
      for (const session of sessions.values()) {
        if (!session.sessionDetected)
          continue;
        sessionList.push({
          id: session.sessionId,
          label: session.label,
          status: session.sessionCompleted ? "completed" : "active",
          startTime: session.sessionStartTime,
          lastActivityTime: session.lastActivityTime
        });
      }
      if (codexWatcher)
        sessionList.push(...codexWatcher.getActiveSessions());
      if (sessionList.length > 0) {
        sendSSE(res, { type: "session-list", sessions: sessionList });
      }
      const sorted = [...sessionList].sort((a, b) => {
        const aActive = a.status === "active" ? 1 : 0;
        const bActive = b.status === "active" ? 1 : 0;
        if (aActive !== bActive)
          return bActive - aActive;
        return b.lastActivityTime - a.lastActivityTime;
      });
      if (sorted.length > 0) {
        const buffered = eventBuffer.get(sorted[0].id);
        if (buffered) {
          sendSSE(res, { type: "agent-event-batch", events: buffered });
        }
      }
    },
    dispose() {
      if (relayDisposed)
        return;
      relayDisposed = true;
      const models = [...observedModels].sort().join(",").slice(0, 128);
      const runtimes = [wantClaude && "claude", wantCodex && "codex"].filter(Boolean).join(",");
      telemetry?.emit({
        ...baseEvent(),
        event_type: "session_end",
        duration_s: Math.round((Date.now() - sessionStart) / 1e3),
        event_count: sessionEventCount,
        models: models || void 0,
        runtimes: runtimes || void 0
      });
      if (wantClaude) {
        removeDiscoveryFile();
        hookServer?.dispose();
        if (scanInterval)
          clearInterval(scanInterval);
        projectDirWatcher?.close();
        for (const session of sessions.values()) {
          session.fileWatcher?.close();
          if (session.pollTimer)
            clearInterval(session.pollTimer);
          if (session.inactivityTimer)
            clearTimeout(session.inactivityTimer);
        }
      }
      codexWatcher?.dispose();
    }
  };
}

// scripts/telemetry.ts
var fs7 = __toESM(require("fs"));
var path5 = __toESM(require("path"));

// scripts/telemetry/install-id.ts
var fs5 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var crypto2 = __toESM(require("crypto"));
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function getOrCreateInstallId(filePath) {
  if (fs5.existsSync(filePath)) {
    const existing = fs5.readFileSync(filePath, "utf-8").trim();
    if (UUID_REGEX.test(existing))
      return existing;
  }
  const dir = path4.dirname(filePath);
  if (!fs5.existsSync(dir))
    fs5.mkdirSync(dir, { recursive: true });
  const id = crypto2.randomUUID();
  fs5.writeFileSync(filePath, id + "\n", { mode: 384 });
  return id;
}

// scripts/telemetry/sanitize.ts
var DEFAULT_MAX = 200;
function sanitizeString(input, maxLen = DEFAULT_MAX) {
  if (typeof input !== "string")
    return "";
  const cleaned = input.replace(/["\\\x00-\x1F\x7F]/g, "");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

// scripts/telemetry/sync.ts
var fs6 = __toESM(require("fs"));
var MAX_BATCH = 100;
var MAX_BODY_BYTES = 50 * 1024;
async function syncOnce(opts) {
  const f = opts.fetch ?? fetch;
  if (!fs6.existsSync(opts.jsonlPath))
    return { sent: 0, reason: "no_events_file" };
  const content = fs6.readFileSync(opts.jsonlPath, "utf-8");
  const allLines = content.split("\n").filter((l) => l.length > 0);
  const totalLines = allLines.length;
  let cursor = 0;
  if (fs6.existsSync(opts.cursorPath)) {
    const n = parseInt(fs6.readFileSync(opts.cursorPath, "utf-8").trim(), 10);
    if (!Number.isNaN(n) && n >= 0 && n <= totalLines)
      cursor = n;
  }
  if (cursor >= totalLines)
    return { sent: 0, reason: "cursor_caught_up" };
  const batch = [];
  let bodyBytes = 2;
  for (let i = cursor; i < totalLines && batch.length < MAX_BATCH; i++) {
    const line = allLines[i];
    if (bodyBytes + line.length + 1 > MAX_BODY_BYTES)
      break;
    try {
      batch.push(JSON.parse(line));
      bodyBytes += line.length + 1;
    } catch {
    }
  }
  if (batch.length === 0)
    return { sent: 0, reason: "empty_batch" };
  let resp;
  try {
    resp = await f(`${opts.endpoint}/functions/v1/telemetry-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": opts.apiKey },
      body: JSON.stringify(batch)
    });
  } catch {
    return { sent: 0, reason: "network_error" };
  }
  if (!resp.ok)
    return { sent: 0, reason: "http_error" };
  let body = {};
  try {
    body = await resp.json();
  } catch {
    return { sent: 0, reason: "bad_response" };
  }
  if (!body.inserted || body.inserted <= 0)
    return { sent: 0, reason: "nothing_inserted" };
  const newCursor = cursor + batch.length;
  fs6.writeFileSync(opts.cursorPath, String(newCursor));
  return { sent: batch.length };
}

// scripts/telemetry.ts
var TELEMETRY_ENDPOINT = "https://dxwtgqdkyunfhbywqmrz.supabase.co";
var TELEMETRY_PUBLISHABLE_KEY = "sb_publishable_AgJ_DIUH9zm8E0yHC9KsRw_WsIv4qc8";
var FIRST_SYNC_DELAY_MS = 2 * 1e3;
var SYNC_SCHEDULE_MS = [2 * 60 * 1e3, 3 * 60 * 1e3];
var SYNC_REPEAT_MS = 5 * 60 * 1e3;
var FALSY_VALUES = /* @__PURE__ */ new Set(["false", "0", "disabled", ""]);
function isTelemetryEnabled(env) {
  const dnt = env.DO_NOT_TRACK;
  if (dnt !== void 0 && dnt !== "" && dnt !== "0" && dnt.toLowerCase() !== "false") {
    return false;
  }
  const flag = env.AGENT_FLOW_TELEMETRY;
  if (flag !== void 0 && FALSY_VALUES.has(flag.toLowerCase())) {
    return false;
  }
  return true;
}
function createTelemetryClient(opts) {
  const logDir = opts.logDir;
  const jsonlPath = path5.join(logDir, "events.jsonl");
  const cursorPath = path5.join(logDir, ".cursor");
  const endpoint = opts.endpoint ?? TELEMETRY_ENDPOINT;
  const apiKey = opts.apiKey ?? TELEMETRY_PUBLISHABLE_KEY;
  const getEnv = () => opts.env ?? process.env;
  let installId = "";
  let syncTimer = null;
  let disposed = false;
  let syncInFlight = null;
  function enabled() {
    return isTelemetryEnabled(getEnv());
  }
  function serialize(event) {
    return JSON.stringify({
      v: 1,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      event_type: event.event_type,
      installation_id: installId,
      session_id: sanitizeString(event.session_id),
      agent_flow_version: sanitizeString(event.agent_flow_version),
      os: sanitizeString(event.os, 16),
      arch: sanitizeString(event.arch, 16),
      source: sanitizeString(event.source ?? "npx", 32),
      duration_s: event.duration_s ?? null,
      event_count: event.event_count ?? null,
      error_class: event.error_class ? sanitizeString(event.error_class, 64) : null,
      models: event.models ? sanitizeString(event.models, 128) : null,
      runtimes: event.runtimes ? sanitizeString(event.runtimes, 32) : null
    });
  }
  function append(event) {
    if (!fs7.existsSync(logDir))
      fs7.mkdirSync(logDir, { recursive: true });
    fs7.appendFileSync(jsonlPath, serialize(event) + "\n", { mode: 384 });
  }
  function fireSync() {
    if (syncInFlight)
      return;
    syncInFlight = syncOnce({ jsonlPath, cursorPath, endpoint, apiKey }).catch(() => {
    }).finally(() => {
      syncInFlight = null;
    });
  }
  function scheduleNext(idx) {
    const delay = idx < SYNC_SCHEDULE_MS.length ? SYNC_SCHEDULE_MS[idx] : SYNC_REPEAT_MS;
    syncTimer = setTimeout(() => {
      fireSync();
      scheduleNext(idx + 1);
    }, delay);
    syncTimer.unref?.();
  }
  function startSync() {
    if (syncTimer)
      return;
    syncTimer = setTimeout(() => {
      fireSync();
      scheduleNext(0);
    }, FIRST_SYNC_DELAY_MS);
    syncTimer.unref?.();
  }
  function stopSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
  }
  return {
    async init() {
      if (!enabled())
        return;
      installId = getOrCreateInstallId(opts.installIdPath);
      startSync();
    },
    emit(event) {
      if (!enabled())
        return;
      if (!installId)
        installId = getOrCreateInstallId(opts.installIdPath);
      append(event);
    },
    isEnabled() {
      return enabled();
    },
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      stopSync();
      if (syncInFlight) {
        try {
          await syncInFlight;
        } catch {
        }
      }
      if (enabled()) {
        try {
          await syncOnce({ jsonlPath, cursorPath, endpoint, apiKey });
        } catch {
        }
      }
    }
  };
}

// app/src/static.ts
var fs8 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
var WEBVIEW_DIR = path6.join(__dirname, "webview");
var HTML_SHELL = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Flow</title>
  <link rel="stylesheet" href="/index.css">
  <style>html, body { height: 100%; margin: 0; padding: 0; }</style>
</head>
<body class="font-sans antialiased" style="background: #0a0a1a;">
  <div id="root" style="height: 100%;"></div>
  <script src="/index.js"></script>
</body>
</html>`;
var MIME_TYPES = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html"
};
function serveStatic(req, res) {
  const url = req.url || "/";
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_SHELL);
    return;
  }
  const basename5 = path6.basename(url);
  const ext = path6.extname(basename5);
  const mime = MIME_TYPES[ext];
  if (!mime) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path6.join(WEBVIEW_DIR, basename5);
  if (!filePath.startsWith(WEBVIEW_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = fs8.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// app/src/server.ts
async function startServer(options) {
  const { port, openBrowser, workspace } = options;
  const configDir = path7.join(os3.homedir(), ".agent-flow");
  const telemetry = createTelemetryClient({
    logDir: path7.join(configDir, "telemetry"),
    installIdPath: path7.join(configDir, "installation-id")
  });
  await telemetry.init();
  const relay = await createRelay({ workspace, verbose: options.verbose, telemetry });
  const server = http2.createServer((req, res) => {
    if (req.url === "/events") {
      return relay.handleSSE(req, res);
    }
    if (req.method === "GET") {
      return serveStatic(req, res);
    }
    res.writeHead(404);
    res.end("Not found");
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Server running at ${url}`);
    console.log("Waiting for agent events...\n");
    if (openBrowser) {
      openURL(url);
    }
  });
  let shuttingDown = false;
  function cleanup() {
    if (shuttingDown)
      return;
    shuttingDown = true;
    server.close();
    relay.dispose();
    void telemetry.dispose().finally(() => process.exit(0));
  }
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
}
function openURL(url) {
  if (process.platform === "win32") {
    (0, import_child_process.exec)(`start "" "${url}"`);
  } else {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    (0, import_child_process.execFile)(cmd, [url], () => {
    });
  }
}

// app/src/app.ts
var args = parseArgs(process.argv.slice(2));
console.log("Agent Flow\n");
(0, import_setup.ensureSetup)();
startServer({
  port: args.port,
  openBrowser: args.open,
  workspace: process.cwd(),
  verbose: args.verbose
});
