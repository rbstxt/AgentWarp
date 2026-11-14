# P7 — Agent panel v2 (Cursor/Windsurf-grade, TurboWarp-native)

Goal: the agent panel inside TurboWarp should feel like it shipped with TurboWarp, while matching the
UX of Cursor / Windsurf agent panes. A Scratch user (often a kid or a teacher) must be able to ask,
watch, review and undo agent work without ever leaving the editor.

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| UI stack | React 19 + TypeScript + Tailwind v4 + **shadcn/ui** (Base UI or Radix flavour) with the **shadcn AI Elements** patterns (Oct 2026: Chat/Message Scroller, Message, Prompt Input, Reasoning, Tool, Task, Plan, Queue, Checkpoint, Confirmation, Context, Model Selector, Suggestion, Terminal, Test Results, File Tree) and base components (Trace, Code Block, Marker, Bubble, Attachment, shimmer, scroll-fade). | Copy-in code we own, accessible, matches the "agent IDE" vocabulary. **Not** Vercel's AI SDK Elements (deprecated end of Nov 2026). Components are presentational; we drive them from ACP state, no `useChat`. |
| Isolation | The panel renders inside a **Shadow DOM** root on a host element. Tailwind CSS is compiled and injected into the shadow root (no preflight leaks into TurboWarp, no TurboWarp CSS leaks in). Every portal (menus, popovers, tooltips, dialogs) targets a container **inside** the shadow root. | TurboWarp's GUI is React 16 + CSS modules; global CSS would break it. |
| Theme | shadcn tokens map onto TurboWarp's live CSS variables (they inherit through the shadow boundary). Follows TurboWarp accent colour and dark mode live, no reload. | "Looks like it was always there." |
| Delivery | `userscript.js` becomes a **tiny stable loader** (vanilla, ~3 KB): read saved `{url, token}`, show a minimal connect dialog if missing, then load `GET /client.js?token=…` from the bridge. The bridge serves the built bundle. A fully bundled single-file build is also produced for pasting into turbowarp.org devtools. | Updating the panel never requires touching the Desktop profile again. |
| Sync core | The existing sync logic (load/flush/revisions/session reset) stays vanilla JS, independent of React, exposed as a small API the panel consumes. A panel crash must never break sync. | Robustness. |

## 2. Theme mapping (TurboWarp vars → shadcn tokens)

Defined on `:host` inside the shadow root (values are `var(...)` so they track TurboWarp live):

```
--background:          var(--ui-primary)            /* same pane colour as sprite/stage area */
--foreground:          var(--text-primary)
--card:                var(--ui-modal-background)
--card-foreground:     var(--text-primary)
--popover:             var(--popover-background)
--popover-foreground:  var(--text-primary)
--primary:             var(--looks-secondary)        /* TurboWarp accent (red by default, user-selectable) */
--primary-foreground:  var(--ui-white)
--secondary:           var(--ui-secondary)
--muted:               var(--ui-tertiary)
--muted-foreground:    var(--text-primary-transparent)
--accent:              var(--looks-light-transparent)
--border:              var(--ui-black-transparent)
--input:               var(--ui-black-transparent)
--ring:                var(--looks-transparent)
--destructive:         var(--error-primary)
--radius:              0.5rem                        /* Scratch panes; buttons 4px like stage buttons */
--font-sans:           "Helvetica Neue", Helvetica, Arial, sans-serif
```

Dark mode: TurboWarp sets `--color-scheme` (`light`/`dark`); mirror it as `color-scheme` and as a
`.dark` class on the shadow container (observe `documentElement` style mutations). Verify every
screen in: default red light, default dark, "Scratch purple" accent, high-contrast-ish custom accent.
Block colours for previews come from `--editorTheme3-*` variables.

## 3. Layout

- Docked right column, full editor height below the menu bar, resizable (drag edge, arrow keys),
  min 300 / default 380 / max 720 px. Open state + width persisted. Opening switches to the small
  stage (skip `sa-hide-stage-button`), closing restores (existing behaviour).
- Menu bar toggle: looks exactly like TurboWarp's own menu items (icon + label, same hover/active
  treatment as "Addons"), not an outlined box. Shows a small activity dot while a turn runs and a
  badge when a permission is waiting while the panel is closed.
- Status pill (sync) moves into the panel header as a small dot + tooltip; the floating pill remains
  only while the panel is closed.

## 4. Screens and interactions

### 4.1 Header
Session title (from `session_info_update`, else first prompt, ellipsised) · history menu (past
sessions for this project: title, agent icon, relative time; selecting one loads it) · New chat (+) ·
close (×). Sync dot (connected/syncing/error) with tooltip containing the bridge diagnostics.

### 4.2 Empty state
Short friendly line ("What should we build?" / 「何を作りましょう？」), 3–4 Suggestion chips derived
from the project (e.g. "Explain this project", "Add a score counter", "Find bugs in <current sprite>",
"Make it playable with arrow keys"), and the agent picker if no agent was ever chosen.

### 4.3 Conversation (Message Scroller)
- User turn: Bubble (full width, subtle `--secondary` surface) with context chips it was sent with.
  Hover actions: copy, **Restore checkpoint** ("Undo everything after this message").
- Agent turn: plain markdown (no bubble), code via Code Block. Streaming uses `shimmer` status lines.
- Reasoning: collapsed by default, "Thinking…" shimmer while streaming, then "Thought for 12s".
- Tool calls → Trace lines with kind icon (read / edit / execute / search / fetch / think) and
  status (pending/running/done/error), humanised titles:
  - edits of `<Target>/scripts.ts` → "Edited Sprite1" (+N −M lines), expand → diff Code Block.
  - `agentwarp check` → "Checked project ✓ / 2 errors", expand → diagnostics list (file:line links
    that jump to the script in the workspace).
  - `agentwarp test` → **Test Results** pattern (passed/failed, failing expects with actual values).
  - `agentwarp shot` → inline thumbnails of the PNG/GIF (served by the bridge), click to enlarge.
  - other commands → Terminal pattern with streamed output.
- Plan (`plan` update) → Plan/Queue pattern pinned above the composer: "3 of 5", current step
  highlighted, collapsible.
- Permission request → Confirmation pattern inline and focused: Allow once / Always allow / Deny,
  keyboard: Enter = allow once, Esc = deny. Also reflected in the menu-bar badge.
- Errors → Marker (destructive) with Retry.

### 4.4 Change review (Scratch-native "files changed")
After each turn (and live while it runs) a **Changes bar** sits above the composer:
"Sprite1: +2 scripts, 1 changed · Stage: 1 changed   [Review] [Undo turn]".
Review expands a File-Tree-like list grouped by sprite; each script row shows a **rendered
scratchblocks preview** (scratch3 style, editor language, block colours from `--editorTheme3-*`)
with added/changed/deleted badges. Clicking a row **jumps**: switch editing target, scroll the
workspace to the script, flash a highlight (glow) for ~1.5 s. "Undo turn" restores the checkpoint
taken before that turn (confirm dialog; warns that human edits made during the turn are reverted).
"Keep" dismisses the bar.

### 4.5 Composer (Prompt Input)
- Auto-growing textarea; placeholder "Ask the agent… use @ to mention sprites, scripts, costumes".
- **@-mentions** menu (filter as you type, keyboard navigable): sprites, scripts of the current
  sprite (labelled by hat summary, e.g. "when ⚑ clicked · 12 blocks"), costumes, sounds, variables,
  lists, broadcasts. Mentions render as chips inside the prompt.
- **Context chips** above the textarea: current sprite (auto, removable), selected block (auto when a
  block is selected; removable), attached images.
- Attachments: camera button = attach current **stage snapshot** (PNG from the renderer); paste/drop
  images. Hidden if the agent lacks `promptCapabilities.image`.
- Footer row: **agent picker** (Claude / Codex / OpenCode with availability) · **model + effort**
  (Model Selector, from session config options) · **mode** (if the agent advertises modes) ·
  **Context** usage ring (from `usage_update`) · Send / Stop (round accent button).
- Enter sends, Shift+Enter newline, IME-safe; Esc stops a running turn; ↑ in an empty composer
  edits the last prompt. Messages typed during a running turn are **queued** (shown as pending
  chips, sent in order, removable).
- Slash commands from `available_commands_update` appear in a `/` menu.

### 4.6 Workspace integration
- Block context menu (right-click a block/script): "Ask agent about this" / 「エージェントに聞く」
  and "Fix with agent" / 「エージェントで直す」 → opens the panel with the script as a context chip
  (and a prefilled prompt for "Fix").
- While a turn edits a target, changed scripts flash briefly (existing) and the header shows
  "Editing Sprite1…".
- Shortcuts: Ctrl/Cmd+L toggle+focus the panel; Ctrl/Cmd+Shift+L add the selected block as context.
  Must not clash with TurboWarp/addon shortcuts (verify).

### 4.7 i18n, a11y, motion
- Language follows TurboWarp (`tw:language` / GUI locale): en + ja complete, others fall back to en.
- Full keyboard operation, visible focus rings (`--ring`), `aria-live` for streaming, labelled
  buttons, `prefers-reduced-motion` respected.

## 5. Protocol additions (bridge WebSocket, JSON)

Existing messages are unchanged (`acp/agents`, `acp/start`, `acp/prompt`, `acp/cancel`,
`acp/permission`, `acp/history`, `acp/set-config`, `acp/update`, `acp/done`, `acp/error`,
`acp/session`, `acp/config`, `acp/permission-request`, `hello{rev,name,session}`, `load`, `status`).

Client → bridge:

| type | fields | effect |
|---|---|---|
| `acp/prompt` (extended) | `sessionId, text, context, mentions?: Mention[], images?: {mimeType, data(base64)}[]` | host builds ACP prompt blocks: text, one `resource_link` per mention (file URI of `<Target>/scripts.ts`, with line range for script mentions), image blocks (only if the agent advertises image support; otherwise reply `acp/error`). Before forwarding, the host takes a **checkpoint** (§6) and emits `acp/turn-start`. |
| `acp/sessions` | – | reply `acp/sessions {list: [{sessionId, agentId, title, updatedAt, turns}]}` for this project (from `.agentwarp/sessions/*.jsonl`), newest first. |
| `acp/load` | `sessionId` | resume a past session: if the agent supports `session/load`/resume, attach to it (history replayed as `acp/update`s); otherwise replay the transcript read-only and say so in `acp/session {readOnly: true}`. |
| `acp/set-mode` | `sessionId, modeId` | ACP `session/set_mode`; reply `acp/mode {sessionId, currentModeId}`. |
| `acp/restore` | `sessionId, turnId` | restore the checkpoint taken before that turn (writes the snapshot back into the text dir → normal agent cycle → editor reloads). Reply `acp/restored {sessionId, turnId, rev}`. |
| `acp/changes` | `sessionId, turnId` | (re)compute and reply the change summary for a turn. |

Bridge → client:

| type | fields |
|---|---|
| `acp/session` (extended) | `sessionId, agentId, configOptions, modes?: {currentModeId, availableModes[]}, promptCapabilities?: {image, embeddedContext}, readOnly?` |
| `acp/turn-start` | `sessionId, turnId, rev` (rev before the agent acted) |
| `acp/changes` | `sessionId, turnId, final: boolean, targets: [{name, isStage, scripts: [{status: "added"\|"changed"\|"deleted", topBlockId, anchor, label, scratchblocks, file, line}]}]` — sent live (debounced ~1 s) after each bridge cycle during a turn (`final:false`) and once after `acp/done` (`final:true`). `scratchblocks` is the script printed by `formats/scratchblocks` (for previews); `label` is a one-line hat summary. |
| `acp/update` | ACP updates passed through unchanged, including `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `usage_update`, `session_info_update`, `tool_call(_update)` with `diff`/`terminal` content. |

`Mention = {kind: "sprite"|"script"|"costume"|"sound"|"variable"|"list"|"broadcast", target: string, name?: string, topBlockId?: string}`.

HTTP additions (token required, same as existing endpoints):
- `GET /client.js` — the built panel bundle (`packages/panel/dist/agentwarp-client.js`), `no-store`.
- `GET /file?path=<rel>` — serves **only** image files (`.png .gif .jpg .svg`) whose real path is
  inside the project dir (for `shot` thumbnails). Anything else → 404.

## 6. Checkpoints

At each `acp/prompt` the host snapshots the text state (all `<Target>/` files + `agentwarp.json`,
excluding `.agentwarp/` except what is needed to restore anchors) into
`.agentwarp/checkpoints/<sessionId>/<turnId>/` together with the current bridge `rev`. Restore copies
the snapshot back (removing target dirs created after it) and lets the normal agent cycle pack and
push it. Keep the last 50 checkpoints per session. Change summaries diff the checkpoint's packed
project against the current base with the existing preservation diff (unchanged/changed/added/
deleted scripts by anchor/top-block).

## 7. Packaging

```
packages/panel/            React app (Vite, library/IIFE build)
  src/sync-core.ts         vanilla sync logic moved from agentwarp-client.js (no React)
  src/panel/...            React + shadcn + AI Elements patterns (copied in, owned)
  src/mount.tsx            shadow root host, CSS injection, portal container, theme observer
  dist/agentwarp-client.js single IIFE bundle (sync core + panel + CSS string)
packages/bridge/client/
  userscript.js            tiny loader (connect dialog → load /client.js)
  agentwarp-client.js      kept = full single-file build (for devtools paste), generated
```

Budget: bundle ≤ 600 KB minified (gz ≤ 200 KB); first paint of the panel ≤ 150 ms after load.

## 8. Verification

- Playwright against the live web editor + extended mock: screenshots in light/dark × en/ja ×
  accent (red, purple), panel widths 300/380/600, window widths 1280 and 1920.
- Interaction tests: streaming, reasoning, tool trace with diff/test/shot, plan, permission keyboard
  flow, queue, @-mention selection, context chips, stage snapshot attach, changes bar + jump +
  undo turn, history load, IME, Ctrl/Cmd+L, block context menu.
- Real TurboWarp Desktop (CDP) once at the end, plus one real Claude turn.
