# Real bridge integration report

Run from the repository root with `node packages/bridge/e2e/real.mjs`. Install the client dependencies and Playwright Chromium first as described in `../client/README.md`. The test creates and removes a temporary project, unpacks `scrolltutorial-378587848.sb3`, and starts the actual CLI server. It uses the live web editor, so network access is required.

On 2026-11-14, the web run passed:

- An agent changed the player jump literal and added a script with a comment. The editor showed the new block in 448 ms, retained the selected sprite, zoom and scroll, and placed it separately from the existing script. See `screens/web-agent.png`.
- A Playwright mouse drag reached the base project in 1,257 ms and kept the existing player anchor mappings. A numeric field edited through the Blockly input reached the text file in 1,097 ms. See `screens/web-drag.png` and `screens/web-human.png`.
- A pending editor number edit and a text edit to a different script both survived in the text and editor. The server received a stale editor revision and merged it. See `screens/web-concurrent.png`.
- A syntax error produced an error pill with a `player/scripts.ts:line` diagnostic and no revision change. Restoring the file cleared the error. See `screens/web-error.png`.

The fixture and timing checks run against the real network editor and may vary with machine load. The test checks the first agent edit, drag, and numeric edit against two-second deadlines; the concurrent merge has a five-second deadline.

## Desktop

Not verified. The installed app's `src-main/windows/editor.js` reads `userscript.js` from `app.getPath('userData')`; the bundled main-process code inspected did not set that path or provide a separate portable override. An isolated launch with `--user-data-dir=/tmp/agentwarp-desktop-isolated` created Chromium data in that directory, but that alone does not prove the Electron `userData` path used for the userscript. A macOS sandbox rule was added to deny writes under the real TurboWarp profile while testing. The app opened a DevTools port, but renderer processes reported `sandbox initialization failed: Operation not permitted`, including with `--no-sandbox`. The isolated userscript could not be verified and no Desktop scenarios were run. The real profile was not modified.

The client uses TurboWarp's private `_saveProjectZip()` and `toJSON(..., {allowOptimization:false})` APIs to retain block IDs. A TurboWarp update that changes those APIs will require a client update. The server retains the last 100 revision ancestors in memory; an editor upload older than that is rejected rather than silently overwriting newer work.
