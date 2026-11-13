# Research: ACP + TurboWarp side panel

Date: 2026-11-13. Sources read directly: ACP spec repo (`agentclientprotocol/agent-client-protocol`),
`@agentclientprotocol/sdk@2.6.0` + `@agentclientprotocol/claude-agent-acp@0.106.0` + `codex-acp@1.11.0`
(tarballs unpacked), `@zed-industries/claude-code-acp@0.16.2` README, TurboWarp `scratch-gui` / `desktop`
clones in `.cache/`, local CLI checks on this machine.

## 1. Agent Client Protocol (ACP)

Spec: https://agentclientprotocol.com — repo https://github.com/agentclientprotocol/agent-client-protocol
(moved from `zed-industries/agent-client-protocol`; old import path still redirects).
Machine-readable contract: `schema/v1/schema.json` (+ `schema/v1/meta.json` method-name maps) in the spec repo;
ACP v2 is an experimental draft (`schema/v2/`, served only if client asks protocol version ≥ 2).

### 1.1 Transport

JSON-RPC 2.0 over **stdio, newline-delimited (NDJSON)**. The client spawns the agent as a child process and
speaks to its stdin/stdout. The official TS SDK exposes this as
`ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>): Stream`
(`@agentclientprotocol/sdk`, `dist/v1/stable/acp.d.ts:28`). Node-side spawn pattern (from SDK docs/tests):

```js
import { spawn } from "node:child_process";
import { client, ndJsonStream } from "@agentclientprotocol/sdk";
const child = spawn("codex-acp", [], { stdio: ["pipe", "pipe", "inherit"] });
const app = client();
await app.connectWith(
  ndJsonStream(child.stdin, child.stdout), // WritableStream/ReadableStream wrappers
  async (ctx) => { /* ctx.initialize(), ctx.newSession(...) ... */ }
);
```

`$/cancel_request` (`PROTOCOL_METHODS` in `meta.json`) cancels in-flight requests.

### 1.2 Message flow (method names from `schema/v1/meta.json`)

Agent-side methods (client → agent), `agentMethods` in `meta.json`:

| Method | Purpose |
|---|---|
| `initialize` | Client sends `protocolVersion`, `clientCapabilities`, `clientInfo`; agent replies `agentCapabilities` (+ `authMethods` if it needs login) |
| `authenticate` | Runs an agent-declared auth method (e.g. terminal OAuth flow) |
| `session/new` | `{cwd (abs), mcpServers?, systemPrompt?, ...}` → `{sessionId, modes?, configOptions?}` |
| `session/prompt` | `{sessionId, prompt: ContentBlock[]}` → `{stopReason}` after streaming updates |
| `session/cancel` | Abort a running turn |
| `session/load`, `session/resume`, `session/list`, `session/close`, `session/delete` | Session lifecycle (load/resume support is agent-dependent) |
| `session/set_mode`, `session/set_config_option` | Model / effort / mode switching mid-session |
| `logout` | Revoke agent auth |

Client-side methods (agent → client), `clientMethods` in `meta.json`:

| Method | Purpose |
|---|---|
| `session/update` | Streaming notification `{sessionId, update}` — the whole real-time UI feed |
| `session/request_permission` | `{sessionId, toolCall, options: [{optionId, name, kind}]}` → client returns chosen `optionId`. Kinds (`PermissionOptionKind`): `allow_once`, `allow_always`, `reject_once`, `reject_always` |
| `fs/read_text_file`, `fs/write_text_file` | Agent reads/writes files **through the client**; only usable if the client advertised `fs` capability |
| `terminal/create|output|release|wait_for_exit|kill` | Agent runs commands on client-owned terminals (only if client advertised `terminal: true`); terminal output can be embedded in tool content (`{type:"terminal", terminalId}`) |
| `elicitation/create|complete` | Structured user input (forms/URLs, e.g. MCP OAuth) |

### 1.3 `session/update` variants (`SessionUpdate` in `schema/v1/schema.json`)

`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` (each a `ContentChunk`),
`tool_call` (`ToolCall`: `{toolCallId, title, name?, kind, status, content, locations}`),
`tool_call_update`, plus `plan`, `available_commands_update`, `current_mode_update`, and extension updates.
`ToolKind`: `read | edit | delete | move | search | execute | think | ...`;
`ToolCallStatus`: `pending | in_progress | completed | failed`;
`ToolCallContent`: `{type:"content"}` (text/image/resource), `{type:"diff"}` (unified diff of the edit),
`{type:"terminal"}`. `PromptResponse.stopReason`: `end_turn | max_tokens | max_turn_requests | refusal | cancelled`.
Agent advertises `AgentCapabilities`: `promptCapabilities {image, audio, embeddedContext}`,
`mcpCapabilities {http, sse}`, `loadSession`, session modes, etc.

### 1.4 Client capabilities (`ClientCapabilities`)

```json
{ "fs": {"readTextFile": false, "writeTextFile": false}, "terminal": false,
  "auth": {"terminal": false}, "session": null, "elicitation": null, ... }
```

Practical consequence: a minimal panel client can advertise **no fs/terminal at all** — the agents
(Claude/Codex/opencode) all do their own file edits and command execution inside their own CLIs.
`fs/*`/`terminal/*` exist for thin agents (e.g. Zed's own) that borrow the editor's machine access.
Our panel only *must* implement `session/update` rendering + `session/request_permission` UI.

### 1.5 Official TS client library

**`@agentclientprotocol/sdk` (v2.6.0, current).** The old `@zed-industries/agent-client-protocol`
(v0.4.5) is legacy — do not use. Import paths: `.` = v1 stable, `./unstable`, `./experimental/v2`.
Client-side API (`dist/v1/stable/acp.d.ts`):

```ts
import { client, ndJsonStream } from "@agentclientprotocol/sdk";
const app = client();                                   // ClientApp builder
app.onRequest("session/request_permission", (ctx) => {  // typed by method literal
  return { outcome: { outcome: "selected", optionId: "..." } };
});
app.onNotification("session/update", (ctx) => { /* render ctx.params.update */ });
await app.connectWith(stream, async (ctx: ClientContext) => {
  await ctx.initialize({ protocolVersion: 1, clientCapabilities: {...} });
  const session = await ctx.newSession({ cwd: "/abs/project/dir", mcpServers: [...] })
    .withAdditionalDirectories([...]).start();          // SessionBuilder → ActiveSession
  const res = await session.prompt("fix the jump script"); // string auto-wrapped to text block
  for (;;) { const msg = await session.nextUpdate(); /* ... until stop ... */ }
  // or: const text = await session.readText();
});
```

`ActiveSession` (`acp.d.ts:307`): `sessionId`, `prompt()`, `nextUpdate()`, `readText()`, `dispose()`.
`SessionBuilder` (`acp.d.ts:264`): `withAdditionalDirectories()`, `withMcpServer()`, `start()`/`withSession()`.

## 2. Launching ACP agents with the user's existing subscription login

All three adapters are **stdio ACP servers that wrap the real CLI**, so they inherit whatever login the
CLI already has on that machine (no separate API keys needed when the user is on a subscription plan).

### 2.1 Claude — `@agentclientprotocol/claude-agent-acp` (v0.106.0, current)

- npm: `@agentclientprotocol/claude-agent-acp`, bin `claude-agent-acp` (`dist/index.js`, ESM).
  Predecessor `@zed-industries/claude-code-acp` (v0.16.2, README: `ANTHROPIC_API_KEY=sk-... claude-code-acp`) is superseded.
- Standalone executables per OS/arch attached to GitHub releases bundle **both** `claude-agent-acp` and the
  `claude` CLI; override with `CLAUDE_CODE_EXECUTABLE` env to reuse an installed `claude`.
- **Auth: reuses the existing Claude Code login.** Code references: `dist/auth-status.js` (detects
  `ANTHROPIC_API_KEY` vs `OAuth` vs `apiKey`), `dist/auth-methods.js` (OAuth + subscription),
  `dist/agent-command.js:21-23` (terminal-auth reruns the agent with `--hide-claude-auth --cli auth login`,
  i.e. delegates to the native `claude login` flow). Subscription (Pro/Max) OAuth tokens in
  `~/.claude.json` are picked up automatically. Client launches the adapter with **no arguments** over stdio.
- Pro detail: serves ACP v1 by default and draft v2 when the client asks (`CLAUDE_AGENT_ACP_PROTOCOL` to pin).

### 2.2 Codex — `codex-acp` (v1.11.0, by baldaworks; successor of `normahq/codex-acp-bridge`)

- npm: `codex-acp` (bin `codex-acp` → platform Go binary ~4 MiB, `codex-acp-<os>-<arch>` optional deps).
  `npm i -g codex-acp`, or `npx -y codex-acp@latest`, or `go install github.com/baldaworks/codex-acp/cmd/codex-acp@latest`.
- Client launches **`codex-acp` with no arguments** over stdio (`docs/usage.md`).
- **Auth: reuses the existing Codex login.** `codex-acp login` delegates to native `codex login`
  ("ACP terminal authentication that delegates to the native `codex login` command without handling
  credentials in the bridge"). Requires the Codex CLI on `PATH` — the bridge spawns
  `codex --sandbox=<mode> app-server`, one backend process multiplexing all ACP sessions as Codex threads
  (`sessionId` = `thread.id`). `--defer-backend` lets `initialize` succeed before the backend is up.
- Session knobs relevant to us: `session/new {cwd}` → per-thread `thread/start`; `_meta.codex {sandbox,
  approvalPolicy, modelProvider, ...}`; `mcpServers` (stdio/http); model + `reasoning_effort` via
  `configOptions`/`session/set_config_option`. No `session/load` (no history replay).
- Debug tooling: `npx -y @baldaworks/acpchat -- npx -y codex-acp@latest` (interactive TUI),
  `npx -y @baldaworks/acpdump -- <agent-cmd>` (protocol trace).

### 2.3 OpenCode — `opencode acp`

- Built into the CLI: `opencode acp` starts an ACP server on stdio; `opencode acp --login` runs auth login
  instead (`opencode --help` / `opencode acp --help`, verified locally).
- **Auth: reuses opencode's stored auth** (`~/.config/opencode/`, `opencode auth login`). Local
  `opencode auth list` shows stored entries (Claude Agent, OpenAI, Google, …) — anything already
  authenticated (OAuth subscriptions, console plans, API keys) is usable over ACP with no extra step.
- Model selection is via opencode's model config rather than CLI flags.

### 2.4 Verified on this machine (2026-11-13)

- `opencode --help`: present (`opencode acp` subcommand confirmed). `codex --help`: present.
  `claude --help`: present (Claude Code CLI). `node v26.0.0`, `npm 11.12.1`.
- `codex login status` → **"Logged in using ChatGPT"** (subscription login present; `~/.codex/auth.json` exists).
- `~/.claude.json` exists (Claude login state present). `opencode auth list` shows stored providers.
- npm registry: `@agentclientprotocol/sdk@2.6.0`, `@agentclientprotocol/claude-agent-acp@0.106.0`,
  `@zed-industries/claude-code-acp@0.16.2`, `codex-acp@1.11.0` all resolve.

## 3. TurboWarp architecture (from `.cache/` clones)

### 3.1 scratch-gui: where a right-side panel goes

Top-level layout: `tw-scratch-gui/src/components/gui/gui.jsx:227-451` (`GUIComponent`):

```jsx
<Box className={styles.pageWrapper}>            {/* column */}
  <MenuBar ... />                                {/* gui.jsx:289-327 */}
  <Box className={styles.bodyWrapper}>
    <Box className={styles.flexWrapper}>          {/* row: editor | stage+targets */}
      <Box className={styles.editorWrapper}> ... <Blocks vm={vm}/> ... </Box>
      <Box className={styles.stageAndTargetWrapper}>
        <StageWrapper vm={vm} ... />             {/* gui.jsx:436-442 */}
        <Box className={styles.targetWrapper}><TargetPane vm={vm}/> ... </Box>
      </Box>
      {/* <-- PANEL: third child here (gui.jsx:449), new styles.rightPanelWrapper class */}
    </Box>
  </Box>
</Box>
```

CSS: `src/components/gui/gui.css:20-57` (`.flex-wrapper{display:flex;flex-direction:row}`, editor/stage
flex-basis rules); sizes in `src/lib/layout-constants.js:41-46`. Container wiring:
`src/containers/gui.jsx:112-119` renders `<GUIComponent>`. Panel open/closed state fits Redux:
add `src/reducers/right-panel.js` (or a key in `src/reducers/tw.js:21-56`) following the
`src/reducers/modals.js:1-40` (boolean flags + open/close actions) or `src/reducers/cards.js:15-24`
(richer `{visible, x, y, expanded, ...}`) pattern, register in `src/reducers/gui.js:145-177`,
read via `mapStateToProps` like `cardsVisible` (`src/containers/gui.jsx:165`). Overlay patterns to copy:
Cards (`src/containers/cards.jsx` + `src/components/cards/cards.jsx`, rendered `gui.jsx:266-268`),
extension library, `TWS
...[truncated 7375 chars]