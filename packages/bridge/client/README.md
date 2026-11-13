# AgentWarp TurboWarp client

The client connects an open TurboWarp editor to `agentwarp serve`. Start the bridge first and use the URL and token printed by the server. The bridge and editor should be on the same computer.

## Web editor

Open https://turbowarp.org/editor. In DevTools, paste the contents of `agentwarp-client.js` into the Console and run it. The connection dialog asks for the bridge URL, for example `http://127.0.0.1:8765`, and token. The connection is saved in this origin's local storage. Click the status pill to change it. Reloading the page removes the injected client; paste it again after reloading.

Alternatively, create a bookmarklet containing `javascript:` followed by the minified contents of `agentwarp-client.js`, then click it in the editor. Browser bookmarklets may be restricted by page policy. For a one-off session the DevTools paste is simpler. Do not load this script from an untrusted host: it has access to your project and bridge token.

For automated injection, set `window.AGENTWARP = {url: 'http://127.0.0.1:8765', token: 'YOUR_TOKEN'}` before loading the script. The client checks this object first, then the JSON object stored as `localStorage.agentwarp`, then opens the dialog. The token in local storage is readable by scripts running on the TurboWarp origin. Use a trusted editor and clear the entry when finished.

## TurboWarp Desktop on macOS

Copy `agentwarp-client.js` to `~/Library/Application Support/turbowarp-desktop/userscript.js`, then completely quit and restart all TurboWarp Desktop windows. For the Mac App Store version the folder is `~/Library/Containers/org.turbowarp.desktop/Data/Library/Application Support/turbowarp-desktop`. Desktop's Help > Desktop Settings > Open User Data also locates the folder. If you already have a userscript, append this file's contents instead of overwriting it. The dialog appears on first run; click the pill to change the connection later. To disable the client, remove or rename `userscript.js`, or remove the appended client code, and fully restart Desktop. To remove the saved connection, run `localStorage.removeItem('agentwarp')` in the editor developer console.

Desktop's source loads `userscript.js` into the editor after mounting the GUI. The client waits for `window.vm`. The checked Desktop source does not enforce a CSP on the editor and registers `tw-editor:` as a secure, fetch-capable scheme. The bridge must allow that origin if Electron sends it in CORS requests. Actual Desktop network behavior can vary by version and has not been verified by this test suite.

## Behavior and limits

The first connection loads the bridge project into the editor. Save any unrelated editor work before connecting. Incoming revisions replace the project, so editor undo history and currently executing scripts are lost. If scripts were running, the client restarts the project with a green flag; it cannot resume execution at the same point. It restores the selected target by ID or name, and restores workspace scale and scroll where possible. Changes made during the brief project replacement can be lost. The status pill shows errors and bridge diagnostics on hover.

Edits are uploaded after one second of inactivity and after dragging ends. The bridge owns revisions and resolves concurrent edits as described in `docs/P4-DESIGN.md`. The client uses TurboWarp's unoptimized serializer to retain block IDs across editor uploads. It accepts a JSON `{ "rev": N }` response to an editor POST. Without it the next POST may use a stale base revision, which the protocol requires the bridge to handle. Keep the bridge listening on loopback and protect its token. Chromium may require Local Network Access permission for turbowarp.org. Allow it in the browser site settings if the connection is blocked. CORS, network policy, or a future TurboWarp release may also prevent connections; inspect the browser console and pill tooltip if they fail.

## Test

From this directory run `npm ci` and `npx playwright install chromium` if needed, then `node e2e.mjs`. Set `HEADED=1` to show Chromium. The test accesses the live TurboWarp editor, runs a loopback mock, and writes screenshots to `e2e-screens/`. To run the mock manually, use `node mock-server.mjs path/to/project.sb3 [port] [token]`; enter another sb3 path on stdin to push a revision. The mock is for local tests only, not production.

The real-server fixture test and Desktop isolation findings are in `../e2e/REPORT.md`.

## Agent panel

Click **Agent** in the menu bar to open the chat column. Choose an available agent to start a session, or click **New chat** to start another session with the selected agent. Drag the panel's left edge to resize it; the separator also responds to the left and right arrow keys. The panel's width, open state, and last session ID are stored in this editor origin's local storage. The client asks for that session's history when it reconnects. Clear `agentwarp.panel.open`, `agentwarp.panel.width`, and `agentwarp.panel.session` to reset these preferences.

Enter sends a message, Shift+Enter inserts a newline, and Enter during IME composition does not send. The Stop button cancels the current turn. Tool calls and thoughts expand on click; thoughts start collapsed. Permission options are ordinary keyboard-accessible buttons. During a turn, incoming project loads briefly highlight changed top-level scripts in the current target. Markdown is rendered as text and safe DOM elements, so raw HTML is never executed.

The client sends `acp/agents` on connection, `acp/start` with `agentId`, `acp/prompt` with `sessionId`, `text`, and `context`, `acp/cancel` with `sessionId`, `acp/permission` with `requestId` and `optionId`, and `acp/history` with `sessionId`. Prompt context contains `editingTarget` (name), `selectedBlockId` (or null), `running`, `stageSize` when available, and `rev`. The host includes the selected block ID in its context line when available; source locations are not currently resolved. The client expects `acp/agents.list` entries with `id`, `label`, and `available`; `acp/session` with `sessionId` and `agentId`; and `acp/update.update` containing ACP `sessionUpdate` payloads. Tool updates use `toolCallId` to merge fields. Permission requests contain `toolCall` and `options` with `optionId` and `name`. `acp/done` ends the turn and `acp/error.message` appears in the transcript.

The real host sends history as a sequence of `acp/update` and `acp/done` messages only to the requesting socket. The mock returns `{type: 'acp/history', sessionId, messages: [...]}`, where `messages` contains recorded `acp/update` envelopes in order. The client also accepts update payloads directly or envelopes under `history` or `entries`. Both forms include user message updates. The panel does not infer an active turn from restored history.

Run `node panel-e2e.mjs` for the ACP panel test. It uses fresh Playwright browser contexts, a loopback mock, and the live web editor, never a Desktop profile. It covers English dark mode, Japanese light mode, streaming, a diff, permissions, stop, history after reload, and IME composition. Screenshots are written to `e2e-screens/panel-*.png`.

Session configuration selectors appear when the agent advertises options. Changes use `acp/set-config`; live session updates are broadcast to authenticated project sockets, while agent-list and history replies go only to the requester. The panel switches to the small stage when opened and restores the previous large stage on close if the user has not changed it.
