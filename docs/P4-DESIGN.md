# P4 design — live sync between the text project dir and TurboWarp

Goal: an agent edits text files while a human has the same project open in TurboWarp (Desktop or web).
Agent edits appear in the editor within ~1 s; human edits in the editor flow back into the text files; both
can happen in the same session without losing either side's work.

## Pieces
- `packages/bridge/` — `agentwarp serve <dir> [--port N]`: HTTP + WebSocket server on 127.0.0.1, file watcher on
  the project dir (ignore `.agentwarp/`), sync engine. Prints the URL + a random token. Writes
  `<dir>/.agentwarp/serve.json` `{port, token, pid}` so other tools (CLI, ACP panel) can find it.
- `packages/bridge/client/agentwarp-client.js` — plain JS (no build) injected into the TurboWarp editor page:
  as TurboWarp Desktop `userscript.js` (in the app's userData dir) or via Playwright/devtools on
  turbowarp.org/editor. Finds `vm` (window.vm, or the React tree), connects to the bridge.

## Revisions and the base
The bridge owns `rev` (integer) and `base` = the project.json that both sides agree on (= `.agentwarp/base.json`).
The text dir is "clean" when its content hash equals `lastTextHash` (hash recorded right after the bridge last
(re)printed the text). Anchors in the text map to block ids in `base`.

### Agent edit (text changed, debounce 300 ms)
1. If hash == lastTextHash → nothing. Else `packDir` against `base`.
2. Errors → broadcast `{type:"status", ok:false, diagnostics}` (client shows a small toast); do not push.
3. Success → `base := result`, `rev++`, push `{type:"load", rev}` to clients; then re-unpack the text dir (canonical
   print, anchors for new scripts) ONLY if the text hash is still the one we packed (else retry the cycle; never
   clobber an edit that landed meanwhile). Update lastTextHash.

### Editor edit (client POSTs sb3)
Client debounces `PROJECT_CHANGED` (1 s, and after drag end), then `POST /editor.sb3` (header `X-Base-Rev`, body sb3).
1. If text is clean → `base := editor project`, `rev++`, re-unpack text (rewrites files; agent tools will see the
   change), no push back.
2. If text is dirty (agent has unsynced edits) → merge: `packDir(text)` against base = editor project with the
   current anchors (the editor preserves block ids, so anchors still resolve). Result → `base`, `rev++`, push
   `load` to the client, re-unpack text. If the same script was changed on both sides (compare against the old
   base), the agent's text wins for that script; report `{type:"status", conflicts:[…]}`.
3. Stale `X-Base-Rev` is fine (merge path handles it) but must be logged.

### Client load
On `{type:"load", rev}` the client fetches `GET /project.sb3?rev=N`, remembers the editing target name, the
workspace scroll/zoom (ScratchBlocks workspace metrics) and whether the project was running, calls
`vm.loadProject(buf)`, then restores editing target (`vm.setEditingTarget`), scroll/zoom, and does NOT echo
the PROJECT_CHANGED events caused by its own load (suppress until the workspace settles). Sends `{type:"ack", rev}`.

## Protocol (WebSocket JSON, `ws://127.0.0.1:<port>/ws?token=…`)
server→client: `hello {rev, name}`, `load {rev}`, `status {ok, diagnostics?, conflicts?, message?}`
client→server: `hello {client:"turbowarp", version}`, `ack {rev}`, `log {level, message}`
HTTP: `GET /project.sb3?token=…` (current base as sb3), `POST /editor.sb3?token=…` (editor state),
`GET /status?token=…`. All requests require the token. CORS: allow the TurboWarp origins
(`https://turbowarp.org`, `file://`/`null` for Desktop, `http://localhost:*`).

## Later (not P4)
- Hot patching instead of full `loadProject` (keeps undo history): apply block-level diffs via vm APIs.
- The ACP side panel (P5) reuses this client + bridge: the bridge also hosts the ACP client.
