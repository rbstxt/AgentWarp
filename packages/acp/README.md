# @agentwarp/acp — ACP host for the TurboWarp side panel (P5)

Spawns the user's coding agents (Claude / Codex / OpenCode) as ACP servers
over stdio and bridges them to the TurboWarp panel protocol from
`docs/P5-DESIGN.md`. Owned by the ACP sub-agent; the bridge (`packages/bridge`)
and the panel UI (`packages/bridge/client`) consume it via `createAcpHost` —
they do not reach into anything else here.

## Install / scripts

```sh
cd packages/acp
npm install
npm test        # node --test, fake ACP agent, no network / no real agents
npm run typecheck
```

Runtime needs Node 26 (erasable TS, explicit `.ts` imports, no build step).
Only runtime dependency is `@agentclientprotocol/sdk` (v2).

## API

```ts
import { createAcpHost } from "@agentwarp/acp"; // or ./src/index.ts

const host = createAcpHost({
  projectDir: "/abs/path/to/project", // session cwd; transcripts go to <dir>/.agentwarp/sessions/
  send: (msg) => ws.send(JSON.stringify(msg)), // host → panel messages
  agentsConfigPath: undefined, // optional JSON override (see below)
  log: console.log, // optional
  autoAllow: true, // default permission policy (default true)
  permissionTimeoutMs: 10 * 60 * 1000, // panel reply timeout → treated as reject
  agents: undefined, // test hook: fixed registry, skips on-disk config
  turnStore: undefined, // checkpoints/change summaries (the bridge provides one)
});
await host.handle(JSON.parse(wsMessage), reply => ws.send(JSON.stringify(reply))); // client→server acp/* messages
host.onBaseUpdated(); // after the bridge commits a new base (debounced live acp/changes)
host.isTurnRunning(sessionId); // e.g. to refuse restores during a turn
await host.dispose(); // kills agent processes, unblocks pending permissions
```

One host per project dir. Keep it alive as long as the bridge serves the
project; sessions and transcripts survive panel reloads (not bridge restarts).

### Client → server (`handle`)

| type | fields | effect |
|---|---|---|
| `acp/agents` | — | replies `acp/agents` |
| `acp/start` | `agentId` | spawns (or reuses) the agent, `initialize`, `session/new` with `cwd = projectDir`; replies `acp/session`. Respawn after a crash happens here. |
| `acp/prompt` | `sessionId`, `text`, `context?`, `mentions?`, `images?` | prepends the `[TurboWarp] …` context line, appends one `resource_link` block per resolvable mention (target scripts file, `#Lstart-Lend` for script mentions) and `image` blocks (only when the agent advertises `promptCapabilities.image`, else `acp/error`); snapshots a checkpoint and emits `acp/turn-start`; then calls `session/prompt`. Non-blocking: updates arrive via `acp/update`, completion via `acp/done` (+ final `acp/changes`). Errors if a turn is already running. |
| `acp/cancel` | `sessionId` | sends `session/cancel`; the turn ends with `acp/done {stopReason: "cancelled"}`. |
| `acp/permission` | `requestId`, `optionId` | answers a pending `acp/permission-request`. Unknown `optionId` → treated as reject. `allow_always` / `reject_always` kinds are remembered per session+tool. |
| `acp/set-config` | `sessionId`, `optionId`, `value` | calls `session/set_config_option` and broadcasts `acp/config` with the updated options. |
| `acp/set-mode` | `sessionId`, `modeId` | calls ACP `session/set_mode`; broadcasts `acp/mode {sessionId, currentModeId}` (the agent also reports mode switches via `current_mode_update`). |
| `acp/sessions` | — | replies (requester only) `acp/sessions {list: [{sessionId, agentId, title, updatedAt, turns}]}` from `.agentwarp/sessions/*.jsonl` + `*.meta.json`, newest first. |
| `acp/load` | `sessionId` | resume a past session: if the agent advertises `loadSession`/`sessionCapabilities.resume`, ensure the agent, `session/load` (history replays as `acp/update`s) or `session/resume` (transcript replayed to the requester), then broadcast live `acp/session`; otherwise replay the transcript to the requester and reply `acp/session {readOnly: true}`. |
| `acp/restore` | `sessionId`, `turnId` | writes the checkpoint back (refused with `acp/error` while a turn runs); the bridge cycle then packs + pushes. Broadcasts `acp/restored {sessionId, turnId, rev}`. |
| `acp/changes` | `sessionId`, `turnId` | replies (requester only) `acp/changes {sessionId, turnId, final, targets}` recomputed from the checkpoint diff. |
| `acp/history` | `sessionId` | replays the transcript as `acp/update…` + `acp/done` (user prompts as `user_message_chunk`). Unknown session → `acp/error`. |

`context` is a free-form object; known keys: `editingTarget`/`target`,
`scriptsPath`/`scripts`, `selectedBlock`/`selected`,
`selectedLocation`/`location`/`anchor`, `rev`, `running`, `stageSize`/`stage`.
Example: `[TurboWarp] editing: player (player/scripts.ts) · selected: a3 tick (player/scripts.ts:31) · rev 12`.

### Server → client (`send`)

`acp/agents {list: [{id, label, command, args, available, note?}]}`,
`acp/session {sessionId, agentId, configOptions?, modes?, promptCapabilities?, readOnly?}`,
`acp/turn-start {sessionId, turnId, rev}`, `acp/changes {sessionId, turnId, final, targets}`,
`acp/mode {sessionId, currentModeId}`, `acp/restored {sessionId, turnId, rev}`,
`acp/config {sessionId, configOptions}`, `acp/update {sessionId, update}` (raw ACP
`session/update`, incl. thoughts, tool calls, plans),
`acp/permission-request {requestId, sessionId, toolCall, options}`,
`acp/done {sessionId, stopReason}`, `acp/error {sessionId?, message}`.

## Agents registry (`src/agents.ts`)

Defaults: Claude via `npx -y @agentclientprotocol/claude-agent-acp`, Codex via
`npx -y @agentclientprotocol/codex-acp`, OpenCode via `opencode acp` (all reuse the
user's existing CLI logins). NOTE: `@zed-industries/codex-acp` is deprecated
upstream in favour of `@agentclientprotocol/codex-acp`; override via config
if you want the new package.

Merge order: defaults < `~/.config/agentwarp/agents.json` <
`<projectDir>/.agentwarp/agents.json` < `agentsConfigPath`. Format is either
`{agents: [...]}` or a bare array of `{id, label, command, args, env?}`.

Availability (`available: true | "unknown" | false`): direct `PATH` lookup for
plain binaries; for `npx -y <pkg>` adapters, also the adapter bin on `PATH` or
the package in the npx cache (`~/.npm/_npx`). `"unknown"` means npx exists but
the package isn't cached — first start will download it. Detection never
downloads anything.

## Default permission policy (`src/policy.ts`, on by default)

Auto-allow (returns an `allow_once` option, no panel prompt) when the tool call
provably only touches files inside `projectDir` (checked via `locations[].path`
plus path-like `rawInput` fields; symlinks resolved via `realpath`) or only
runs `agentwarp` / `bin/agentwarp` commands (tolerates `cd <dir> && …` and
`VAR=…` prefixes). Pure `think` calls are auto-allowed. Anything indeterminate
(no paths, outside paths, other commands) is forwarded to the panel. Disable
with `autoAllow: false`; the panel always stays authoritative for asks.

## Transcripts (`src/transcripts.ts`)

`<projectDir>/.agentwarp/sessions/<sessionId>.jsonl`, one JSON object per line
(`user` / `update` / `done` / `permission-auto`), writes serialized per file.
`acp/history` replays them; a bridge restart starts fresh sessions (agents may
support `session/load`, but the host does not resume — replay is display-only).

## Notes for the bridge integration

- Create the host in `agentwarp serve` (or lazily on first `acp/*` message) with
  `projectDir` = served dir; route every parsed WS message with
  `type.startsWith("acp/")` to `host.handle`, and `send()` straight to the WS.
  `handle` never throws out (it emits `acp/error` instead) but still `catch`
  defensively per socket.
- Client capabilities advertised: no `fs`, no `terminal` — agents use their own
  tools. Only `session/request_permission` is implemented.
- One ACP connection per agent per project; multiple sessions per agent share
  it. `dispose()` on server shutdown.
- Agent-advertised session configuration options are sent to the panel and can be changed using `acp/set-config`. Authentication remains the agent's responsibility.
- `session/cancel` is an ACP **notification**; cancellation is cooperative —
  `acp/done` still arrives and reports the real `stopReason`.

## Tests

`npm test` uses `test/fake-agent.ts` (SDK agent side over stdio):
start/prompt/stream, `[TurboWarp]` context, permission allow/reject/invalid,
policy auto-allow (project-local edit + `bin/agentwarp` command),
multi-turn, cancel → `cancelled`, history replay, agent crash → `acp/error` +
respawn on next start, registry merge, policy/context units. Real Claude/Codex
runs are intentionally skipped (they download adapters); both packages were
verified resolvable via `npm view` (`@agentclientprotocol/claude-agent-acp`,
bin `claude-agent-acp`; `@zed-industries/codex-acp`, bin `codex-acp`). A manual
smoke test against real `opencode acp` streamed `pong` → `end_turn`, plus
history replay — see final report.
