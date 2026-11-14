# P7 panel implementation status

This is an incomplete implementation and is not ready to replace the P5 panel in production.

## Implemented

The Vite/React 19 panel mounts in a shadow root and follows inherited TurboWarp theme variables. The sync loop was extracted into a vanilla module with guarded UI callbacks. The generated single-file client is copied into the bridge client directory by `npm run build`; a separate loader reads the saved bridge connection. The panel includes a resizable dock, session and agent controls, sanitized markdown, streamed messages, collapsible reasoning and tool diffs, permission buttons and keyboard response, plan and changes summaries, checkpoint restore requests, image attachment, a basic mention picker, queue, and Japanese labels. The mock provides a scripted session and serves the bundle and a fixed test image.

The named AI Elements CLI registry entries returned 404 when requested from `https://ui.shadcn.com/r/styles/new-york/message-scroller.json`. A shadcn Button was copied in via the CLI; the other patterns are currently custom UI and do not meet the requested component requirement.

## Verification

- `npm run build`: pass; 385,379 bytes minified and 122,497 bytes gzipped, below the specified 600 KB / 200 KB budget.
- `npx tsc --noEmit`: pass (the main panel and extracted sync module currently use `@ts-nocheck`).
- `node e2e.mjs`: pass for project load, target/scroll/zoom restoration, no echo, editor upload and reconnect.
- `node panel-v2-e2e.mjs`: pass for English and Japanese streaming, collapsed reasoning, tool diff expansion, keyboard permission response and editor context.
- Inspected `packages/bridge/client/e2e-screens/p7-en-conversation.png` and `p7-ja-conversation.png` alongside the live editor. Fixed a clipped composer and raw markdown after the initial review.

## Outstanding work and deviations

- The requested complete light/dark, red/purple, locale, panel-width and viewport screenshot grid has not been produced or inspected; first-paint timing is unmeasured.
- AI Elements base components and patterns, scratchblocks rendering and editor-theme block colours are not integrated. Change rows currently show text only; jumping and restore have not been verified against real changes.
- Mentions lack script/hat summaries, full keyboard navigation and chip editing. Slash-command selection, block context menu integration, permission/activity badges, tool title humanization, test results, shot thumbnails, terminal presentation, full usage ring and retry are incomplete.
- The mock does not exercise all specified tool forms, file-serving behavior, or every protocol message. Its restore is only an acknowledgement and its image endpoint serves a fixed fixture.
- The interaction script does not cover the full §8 matrix, including queue ordering, mentions, snapshot, changes jump/undo, history, IME and shortcuts. Dark mode and live theme changes need verification.
- The new client has not been validated with the parallel real bridge implementation. The legacy panel test expects the old light-DOM UI and has not been ported in full.
- Desktop and real agents were intentionally not used, as requested.

Protocol assumptions: mode options use `id` and `name`; config choices use `value` and `name`; permission option kinds/IDs containing `allow` or `deny` identify keyboard defaults. These need confirmation against the real bridge.

## Continuation in progress

The registry style is now `base-nova` and the requested registry components were installed. The TypeScript and Vite aliases are configured, and generated Base UI menu, popover, tooltip and dialog portals use a container inside the panel shadow root. The composer now uses Base UI dropdowns and the reasoning row uses the Trace recipe, with elapsed time calculated from streamed updates. The plan starts collapsed and the menu-bar toggle has an icon. Both `@ts-nocheck` directives were removed; `tsc --noEmit` passes, though the TurboWarp runtime boundary and much of the panel state still need more precise types. This is a partial migration: most of the requested AI Elements patterns and all remaining priority items still need work.

### Current verification and remaining work

- `npm run build`: pass, 594,344 bytes minified / 185,207 bytes gzip. The build is very close to the 600 KB limit, so adding scratchblocks or further UI requires size investigation.
- `npx tsc --noEmit`: pass. Several panel/ACP values and the externally supplied TurboWarp VM remain `any`; the typing migration is not complete.
- `node e2e.mjs`: pass. `node panel-v2-e2e.mjs`: pass after adapting it to the Base UI agent menu and Trace reasoning row.
- Inspected `p7-en-conversation.png` and `p7-ja-conversation.png` at 1280 px/light/red/380 px panel. The requested full screenshot matrix remains outstanding. Footer labels are still cramped and the UI needs further polish.
- Chat uses Message/Bubble, reasoning uses Trace, and agent/config/mode use Base UI dropdowns. The full AI Elements migration is incomplete. Trace tool diff titles use a target inferred from the change summary or current target and line counts based on common prefix/suffix, so more complex diffs need proper attribution and counting.
- The menu bar now has an icon and activity/permission dot. The plan defaults closed. Other outstanding items listed above remain, including a proper context ring, all other tool formats, scratchblocks, full mentions/commands/queue behavior, context menus, mock restore, and the full interaction and theme matrix. No Desktop or real agent was used.

## Change review and composer pass (2026-11-14)

This section supersedes the earlier notes about scratchblocks, restore, composer spacing, and the old bundle budget.

- Change review renders scratch3 SVG previews using `scratchblocks`, including Japanese translation and TurboWarp's inherited block colours. Scripts are grouped by target with status badges. A row switches targets, centers the block, and briefly highlights it unless reduced motion is requested. The list is a custom File Tree-style implementation; it does not use a registry File Tree component.
- The plan, changes, and composer share a border. Footer choices switch to icon-only buttons with native tooltips at narrow widths. Standard permission kinds have English and Japanese labels, and the project check title is humanized. Header titles have a tooltip and user context chips have their own spacing.
- Both restore actions use a Base UI confirmation dialog in the shadow root. A successful `acp/restored` creates a conversation Marker. The mock snapshots the pre-turn project, pushes a changed project during the turn, and pushes the snapshot on restore. Its fixture is intentionally scripted rather than a general project differ.
- `npm run build`: pass, 747,020 bytes minified / 232,719 bytes gzip, below the revised 1.2 MB / 350 KB limits. `npx tsc --noEmit`: pass.
- `node e2e.mjs`: pass. `node panel-v2-e2e.mjs`: pass for live-to-final preview replacement, target switch and scroll, both restore paths with editor project contents checked, permission keyboard and labels, and footer choices at 300/380/600 px. The test uses fresh Playwright contexts with the public editor and mock.
- Inspected all eight `e2e-screens/p7-changes-{en,ja}-{light,dark}-{300,600}.png` captures. Dark secondary text was too dim in the first pass and was corrected. The screenshots use the default accent at a 1280 px viewport.

Remaining limitations: this pass did not validate the real bridge or Desktop, non-default accents, all badge statuses, or the full P7 interaction matrix. Existing broader P7 gaps above remain. Preview styling is tied to known `--editorTheme3-*` categories; custom or extension block styles need additional coverage. The tooltip implementation uses native `title` tooltips. First-paint timing is still unmeasured.

## Composer and width continuation (2026-11-14)

This continuation is incomplete. Do not treat the requested composer/editor integration as verified.

- Measured the public editor in a fresh headless browser with the small stage selected and the editor flex container constrained. At 856 px the stage/target wrapper ended at the editor edge; at 850 px it extended 6 px past it. The dock now retains 856 px and switches to an overlay when the remaining width is below 300 px. The preferred panel width remains saved separately from its rendered clamp. This still needs an automated geometric assertion and verification at other zoom levels and addons.
- Change rows now put the label and status above the preview, and the count has English singular/plural and Japanese wording. The resize handle has hover, active and focus styling. The composer now offers fuzzy mention and slash menus with arrow, Tab, Enter and Escape handling, image thumbnails, and preserves mentions/images/context per queued prompt. A context-menu wrapper and selected-block shortcut were added, but have not been verified against the editor or addons. The existing mock already sends a help command.
- `npm run build` passes: 750,250 bytes minified / approximately 233,740 bytes gzip (Vite output). `npx tsc --noEmit` passes. `node e2e.mjs` passed. The original `node panel-v2-e2e.mjs` passed after the width assertion was adapted, but the extended test currently fails while clearing the composer after slash selection: the value returns to `/help `. The new test is left in place to expose this failure.
- Inspected `p7-composer-{mention,slash,queue}-en-light.png`. The stage and sprite pane fit and the menus and queue are visible. Dark captures, context-menu captures, and the remaining requested interaction checks were not completed. Queue ordering, pasted images, Escape cancellation, actual context-menu actions, shortcut conflicts and the live resize geometry remain unverified. No Desktop or real agent was used.

## Composer and workspace verification (2026-11-14)

This section supersedes the incomplete composer continuation above. The slash clearing failure was caused by TurboWarp's document-level Backspace handling: events from the shadow-root textarea are retargeted to the panel host, so the editor treated Backspace as a workspace shortcut and prevented the deletion. The composer now stops ordinary key events before they reach the editor, while allowing the panel's Ctrl/Cmd+L shortcuts through. The slash selection and clear regression remains in the test.

Blockly was not ready when the context-menu hook was installed. The hook now waits for the workspace and wraps Blockly's menu path, retaining the existing TurboWarp and addon actions. Mention type labels in the Japanese picker are translated. The mock now ignores scheduled updates after a canceled turn, preventing canceled turns from contaminating later tests. The legacy panel test was updated for the shadow-root panel.

`panel-v2-e2e.mjs` checks the bridge's received messages for ordered queued prompts and removal, pasted image inclusion and removal, cancellation, and a script mention from the block menu. It checks Escape in both picker types, empty-input history, both context menu actions, toggle/focus and selected-block shortcuts, editor width at the docked widths, and overlay at 1024 px. The existing live/final change, jump, restore and permission checks remain. These tests use fresh Playwright contexts, the public web editor, and the mock; no Desktop or real agent was used.

Shortcut review: searched the local TurboWarp GUI and scratch-blocks source and the bundled addon source for Ctrl/Meta+L, Ctrl/Meta+Shift+L, KeyL, key code 76, and equivalent key comparisons. In particular, checked the default-enabled find-bar (Ctrl/Cmd+F and navigation arrows), editor-devtools (navigation arrows and clipboard), block-switching, and middle-click-popup. No matching editor/addon binding was found in that source. Browser and OS address-bar shortcuts can still take precedence outside the synthetic Playwright key events; this was not tested in Desktop or across browsers.

Inspected all 20 `p7-composer-{mention,slash,queue,context,overlay}-{en,ja}-{light,dark}.png` screenshots. Menus and context items fit, with readable theme contrast. English agent-provided content, command descriptions, and mock script labels remain English in Japanese screenshots because they are supplied by the mock protocol, not panel translations. The captures use the default accent; the larger accent and viewport grid in the design remains outside this continuation.

Final checks:

- `npm run build` in `packages/panel`: pass; 750,832 bytes minified, 233,948 bytes gzip (`gzip -c`, including gzip header).
- `npx tsc --noEmit` in `packages/panel`: pass.
- `node e2e.mjs` in `packages/bridge/client`: pass.
- `node panel-e2e.mjs` in `packages/bridge/client`: pass.
- `node panel-v2-e2e.mjs` in `packages/bridge/client`: pass.

The earlier broader P7 limitations still apply where not superseded here, including real-bridge interoperability, Desktop, first-paint timing, and the remaining design verification matrix.

## Composer v2 continuation (2026-11-14)

Agent discovery was exercised in temporary project directories using initialize and `session/options` where advertised, or `session/new` otherwise. No prompts were sent. Observed `configOptions` are arrays of select records with `id`, `name`, optional `description`, `category`, `type`, `currentValue`, and `options` containing `{value,name,description?}`. Mode state also arrived as `{currentModeId, availableModes:[{id,name,description?}]}`.

- Claude: `mode` (category `mode`, current `auto`, 5 choices), `model` (`model`, current `haiku`, 14 choices), `effort` (`thought_level`, current `default`, 6 choices), and `agent` (no category, 2 choices). Example model `{value:"opus",name:"Opus 5.5",description:"For complex work and everyday tasks"}`.
- Codex: `mode` (`mode`, current `agent`, 4 choices), `collaboration_mode` (category `collaboration_mode`, 2 choices), `model` (`model`, current `gpt-6.1-sol`, 9 choices), `reasoning_effort` (`thought_level`, current `low`, 6 choices), and `fast-mode` (`model_config`, 2 choices). Example model `{value:"gpt-6.1-sol",name:"6.1 Sol",description:"Latest workhorse model for coding and everyday work."}`.
- OpenCode: `model` (`model`, current `opencode/gemini-4-hydrogen`, 1,401 choices), `effort` (`thought_level`, current `default`, 5 choices), and `mode` (`mode`, current `build`, 2 choices). Example model `{value:"claude-agent/claude-fable-5",name:"claude-agent/Fable 5"}`. The large list needs filtering.

Implementation is in progress. ACP and bridge test suites passed after adding discovery and initial configuration coverage. Further UI and browser verification is still required.

Composer v2 implementation and verification remain incomplete. The panel now requests options for the saved agent and on picker open, stores selections, starts a session on first send, and uses category-based model, effort, mode, and generic controls. The host accepts initial values, shares simultaneous connection attempts, and answers discovery to the requesting bridge client. The popup uses a searchable list because OpenCode returned 1,401 choices. Plan, changes, and permission requests share the composer outline; queued rows have edit, remove, and send-now controls. A 600 ms guard protects the send button after stop. Image capability is exposed with pre-session options.

The mock currently exercises representative model, effort, mode, and generic select records, rather than complete recorded catalogs for all three agents. The picker still lacks the requested segmented permissions chip, a model-picker shortcut and arrow-key navigation between the model and effort columns; Model-dependent option changes before session creation are not refreshed from the agent, standalone legacy mode state without a category is not exposed in the picker, and the saved model label is not shown until option discovery returns. The popup's generic controls are native selects rather than side menus, and the compact overflow menu and send/stop morph animation are not implemented. These are functional and design gaps, not verified equivalents to the complete T3 Code composer.

ACP tests (37), bridge tests (28), core tests (107), panel build and typecheck passed. The sync and panel mock browser suites passed; the expanded panel-v2 suite passed after the final screenshot-layout revision. The real-bridge flow passed three consecutive times after an earlier reconnect timeout. The test explicitly checks that the model picked before the first send reaches the fake agent session. The final 40 `p7-composer2-*` screenshots were inspected in montages against the supplied reference. Each image was checked to have its named 300 or 600 pixel panel width; they cover idle, typing, picker, running, and queued states in English and Japanese in light and dark themes. These captures use the mock; equivalent real-bridge composer matrix captures remain outstanding. No Desktop session or real-agent prompt was used.

## Composer v3 implementation attempt (2026-11-14)

This continuation is incomplete. Do not treat it as meeting the requested composer v3 design or verification matrix.

The picker now renders select options as rows, toggles two-choice records, translates known option headings, and shows provider glyphs, loading/unavailable group status, a searchable capped catalog, a permissions chip, and keyboard navigation. The mock exposes Codex and a 1,401-entry OpenCode catalog. The panel forwards pending selections when re-querying pre-session options and keeps a saved model label; the ACP host forwards these values to discovery or its session fallback. A compact attachment menu and an animated action glyph were added. Legacy mode records are represented in the picker.

Verification so far: ACP tests passed (37); bridge tests passed on rerun (28), after an initial temporary-directory cleanup failure. Panel build and typecheck passed; ACP typecheck passed. Client `e2e.mjs` and `panel-e2e.mjs` passed. The real-bridge regression passed three consecutive runs with its fake agent. The first `panel-v2-e2e.mjs` run timed out while resizing in the screenshot matrix. A rerun passed. Core tests passed (107).

Inspected `packages/bridge/client/e2e-screens/p7-composer3-picker-en-dark-300.png` against the supplied T3 reference. The narrow settings column clips labels and needs further layout work. This capture predates the last CSS adjustment and is not evidence of the final layout. The other requested composer v3 captures, real Claude/Codex/OpenCode picker verification, shortcut conflict review, and full keyboard and accessibility checks have not been completed. No real agents were spawned in this continuation.

Known gaps include the incomplete side-menu and permission interaction review, no recent/favourite model ordering, no robust handling of failed option discovery or out-of-order refresh replies, and the SDK fake agent strips the extra fields from `session/options`, so model-dependent discovery is only confirmed through the `session/new` fallback and needs verification with real agents. The mock is representative rather than a complete recording of each real agent's shapes. The compact layout and send/stop transition need visual and interaction verification. The saved default for legacy mode and sessions needs more work. Earlier P7 limitations still apply.
