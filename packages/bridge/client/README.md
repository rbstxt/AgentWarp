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

Edits are uploaded after one second of inactivity and after dragging ends. The bridge owns revisions and resolves concurrent edits as described in `docs/P4-DESIGN.md`. The client accepts an optional JSON `{ "rev": N }` response to an editor POST. Without it the next POST may use a stale base revision, which the protocol requires the bridge to handle. Keep the bridge listening on loopback and protect its token. Chromium may require Local Network Access permission for turbowarp.org. Allow it in the browser site settings if the connection is blocked. CORS, network policy, or a future TurboWarp release may also prevent connections; inspect the browser console and pill tooltip if they fail.

## Test

From this directory run `npm ci` and `npx playwright install chromium` if needed, then `node e2e.mjs`. Set `HEADED=1` to show Chromium. The test accesses the live TurboWarp editor, runs a loopback mock, and writes screenshots to `e2e-screens/`. To run the mock manually, use `node mock-server.mjs path/to/project.sb3 [port] [token]`; enter another sb3 path on stdin to push a revision. The mock is for local tests only, not production.
