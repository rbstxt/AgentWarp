# agentwarp — make Scratch agent-ready

Goal: AI coding agents (Claude Code, Codex, OpenCode, …) work on Scratch projects as comfortably as on
normal code, and a human can keep using Scratch/TurboWarp normally on the same project.
No custom LLM loop: existing CLI agents are used via subscriptions (CLI/skill/MCP, and ACP for the GUI panel).

## Hard requirements
1. **Lossless round trip**: `.sb3 ⇄ text project dir` must preserve everything (block IDs, comments,
   comment attachment, script positions, assets, monitors, extensions, metadata) when nothing changed,
   and change only what the agent edited otherwise.
2. **Clean layout**: scripts the agent adds/edits get tidy positions (like TurboWarp/Scratch "Clean up blocks":
   scripts stacked in a column, no overlaps), human-placed scripts that weren't touched stay where they were.
3. **Comments**: workspace comments and block-attached comments are readable and writable as text.
4. **Run & observe**: headless VM with deterministic virtual time, input injection, state dumps
   (sprite x/y/costume/size/visible, variables, lists, say/think bubbles, clones), screenshots via renderer.
5. **Live view**: changes show up in TurboWarp (desktop or web) without manual reloading.
6. **Long-horizon**: an agent must be able to iterate (edit → check → run → test → fix) for hours on big projects:
   fast feedback, precise error messages with file:line, small diffs, tests.
7. **GUI**: TurboWarp fork with a side panel that is an ACP client (Claude Code / Codex / OpenCode via ACP),
   so the user chats in the editor and the agent uses the same CLI tools.

## Repository layout
- `eval/tasks/` — task ladder used to evaluate approaches (L1 easy … L6 hard, existing-project edits)
- `eval/runs/<approach>/` — artifacts + REPORT.md (friction log) per approach
- `tools/vmrun/` — headless verification harness (Node, @turbowarp/scratch-vm)
- `formats/<name>/` — text-format prototypes (each with sb3→text→sb3 converter + round-trip tests)
- `packages/` — the real CLI (`agentwarp`) and the GUI panel, later

## Phases
- [x] P0 harness: `tools/vmrun` (validate / run / dump / layout metrics / diff)
- [x] P1 evaluate existing tools with Muse Spark 1.3 as the test agent (goboscript, hikkaku, raw project.json / scratch MCPs) on the task ladder → friction reports (`eval/runs/*/REPORT.md`), TurboWarp calibration (`eval/calibration/`). Design: `docs/P2-DESIGN.md`
- [x] P2a core: catalog (226 opcodes, en+ja), IR/extract/reconcile (byte-identical round trip), metrics (en+ja, holdout-validated), Clean up Plus replica, placeNew
- [x] P2b formats: `formats/{scratchblocks,ts,sbpy}` (38/38 byte-identical round trip each), prototype CLI `bin/agentwarp`
- [x] P2c fresh-agent evaluation of the 3 formats → `ts` chosen (`docs/P3-DECISION.md`)
- [x] P3 CLI: new/unpack/pack/check(validate+lint+tsc)/run/test/shot/tidy/layout/costumes/serve; skill `skill/agentwarp/`; sprite lifecycle, id minting, stable anchors; rendered runner `tools/render`
- [x] P4 TurboWarp live bridge (`docs/P4-DESIGN.md`), web e2e verified; Desktop userscript not yet verified (needs user's OK to touch real profile)
- [x] P5 ACP side panel (injected client, no fork; `docs/P5-DESIGN.md`): Claude/Codex/OpenCode via ACP, real Claude e2e on turbowarp.org (`packages/bridge/e2e/REAL-AGENT.md`)
- [x] P6 long-horizon evaluation (`eval/p6/`): new 3-stage game (12/12 tests) and Lightcube refactor (151 scripts untouched, 0 comments lost, 6/6 tests); friction fixed (glide virtual time, shot hang, probe shorthand, broadcast typing, tidy --dry-run)
- [x] TurboWarp Desktop 1.17.1: userscript installed in the real profile (user OK, 2026-11-14) and verified: sync both ways, panel + real Claude turn; fixed hide-stage button indexing, bridge-restart rev reset (hello.session), serve --token, ts one-line bodies

Model split: basic implementation/eval = Muse Spark 1.3 (OpenCode Go); browser-driven work = Codex GPT-6.1 Terra;
architecture/review = Claude.
