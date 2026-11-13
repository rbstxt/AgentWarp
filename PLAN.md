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
- [ ] P2 text-format prototypes (2–3 candidates) with lossless round trip + layout + comments; evaluate with Muse on the same ladder
- [ ] P3 pick format → `agentwarp` CLI (unpack/pack/check/run/test/screenshot/watch) + SKILL.md/AGENTS.md
- [ ] P4 TurboWarp live bridge (watch → TurboWarp reload preserving editor state)
- [ ] P5 TurboWarp fork + ACP side panel
- [ ] P6 long-horizon evaluation (multi-hour complex tasks), fix friction, docs

Model split: basic implementation/eval = Muse Spark 1.3 (OpenCode Go); browser-driven work = Codex GPT-6.1 Terra;
architecture/review = Claude.
