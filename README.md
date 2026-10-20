# Agent Control Room

**One screen to watch your Claude Code agents live.** The [Habblaud](https://github.com/marmottajr/habblaud) pixel-art office and the [Agent Flow](https://github.com/patoles/agent-flow) node graph, side by side, following the same sessions at the same time.

[Leia em português](README.pt-BR.md)

![Agent Control Room: Habblaud on the left, Agent Flow on the right](docs/screenshot.png)

- **Habblaud** shows *who* is working: each session is a character walking around an office, with an activity feed.
- **Agent Flow** shows *how* they work: every tool call, subagent and return as a live graph.
- **Agent Control Room** starts both, puts them on one screen and gives you layouts made for watching and for recording video.

This is an independent project. It does not include or modify the code of either tool: it runs your own local installs of both and shows them together.

## Features

- **One command** starts everything: Docker Desktop and the Habblaud container when they are off, Agent Flow when it is not running, and the browser.
- **Three layouts**: side by side, stacked (one above the other, made for 9:16 vertical video) and floating (one pane over the other, draggable and resizable).
- **Swap** the two panes, and **drag the divider** (double-click splits in half). Panes never reload when you change layouts.
- **Record mode** hides the bar and the footer. Hover the top edge, press `G` or `Esc` to bring the bar back.
- **Status lights** for both services; a pane shows a notice while its service is starting and reloads by itself when it comes up.
- English or Portuguese, following the browser language.

| Key | Action |
|---|---|
| `1` `2` `3` | side by side / stacked / floating |
| `T` | swap the panes |
| `G` | record mode (`Esc` leaves) |

Shortcuts work while the room has focus. After clicking inside a pane, click the top bar first.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- [Habblaud](https://habblaud.com) installed. Its guided install puts it in `~/habblaud` and runs it in Docker.
- [Claude Code](https://claude.com/claude-code)
- Agent Flow comes by itself through `npx agent-flow-app`, or from a local build (see below).

Tested on Windows 11 with Docker Desktop. macOS and Linux should work (`npm start`), but have not been tested yet.

## Install and run

```bash
git clone https://github.com/<your-user>/agent-control-room.git
cd agent-control-room
npm start
```

On Windows you can also double-click `start.cmd`. The room opens at `http://localhost:4800/control-room/`. Open a Claude Code session in another terminal and watch it show up on both sides.

`Ctrl+C` closes the room and the Agent Flow it started. The Habblaud container keeps running, as it does on its own.

### Agent Flow from a local build (optional)

If a folder `agent-flow` sits next to this one with a build in `agent-flow/app/dist/app.js`, the room uses it instead of `npx`:

```bash
git clone https://github.com/patoles/agent-flow.git
cd agent-flow && pnpm i && pnpm run build:app
```

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ACR_PORT` | `4800` | Port of the room |
| `HABBLAUD_PORT` | `4747` | Port where Habblaud listens |
| `HABBLAUD_DIR` | `~/habblaud` | Habblaud folder, used only when its container does not exist yet |
| `AGENT_FLOW_PORT` | `3001` | Port for Agent Flow |
| `AGENT_FLOW_APP` | `../agent-flow/app/dist/app.js` | Local Agent Flow build; when missing, `npx agent-flow-app` is used |
| `AGENT_FLOW_WORKSPACE` | your home folder | Folder Agent Flow watches: sessions opened in it or in its subfolders appear in the graph |
| `AGENT_FLOW_TELEMETRY` | `false` | Agent Flow's anonymous telemetry, off unless you turn it on |

`--no-open` starts the room without opening the browser.

## How it works

```
browser ── http://localhost:4800 ── Agent Control Room (Node, 127.0.0.1 only)
                                     ├── /control-room/  → the room page
                                     └── everything else → Habblaud (127.0.0.1:4747)
          iframe ─────────────────── Agent Flow (127.0.0.1:3001)
```

Habblaud forbids being embedded in other pages (`X-Frame-Options: DENY`). The room serves Habblaud through a small proxy on its own origin and turns that header into `SAMEORIGIN`. Only the room page itself, on the same origin, can embed it; third-party sites still can't. Everything else stays as Habblaud sends it. Its checks for actions that only your own computer may do (terminal, permission prompts, messages) still pass: the proxy keeps the original `Host` and the requests stay same-origin. Habblaud on its own port (4747) is untouched.

Agent Flow sends no frame restriction, so the room embeds it straight from its own address.

## What runs on your machine

- **Agent Control Room** listens on `127.0.0.1` only. It has no dependencies and sends nothing anywhere.
- **Agent Flow**, the first time it runs, adds hooks to `~/.claude/settings.json` so Claude Code streams events to it (this is Agent Flow's own setup; see its README). The room starts it with telemetry off.
- **Habblaud** runs in Docker with your Claude Code folders mounted read-only (Habblaud's own setup; see its README).

## Credits

- [Habblaud](https://github.com/marmottajr/habblaud) by Márcio Junior, MIT License.
- [Agent Flow](https://github.com/patoles/agent-flow) by Simon Patole, Apache License 2.0. "Agent Flow" is a trademark of Simon Patole.

Agent Control Room is not affiliated with or endorsed by either project. All credit for the office and the graph goes to their authors; this project only brings them together.

## License

[MIT](LICENSE), for the code in this repository.
