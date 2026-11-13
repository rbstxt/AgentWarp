# proj — agentwarp text project (format: ts)

This directory is a text mirror of a Scratch project. Edit the text files; the tool packs them
back into an .sb3. Never hand-edit `.agentwarp/` (machine-managed).

Tool: `/path/to/agentwarp/bin/agentwarp` (call it `agentwarp` below; run from this directory).
Read BEFORE editing:
- Workflow guide: /path/to/agentwarp/skill/agentwarp/SKILL.md
- Format reference (ts): /path/to/agentwarp/formats/ts/AGENTS.md

Layout: `Stage/` + one dir per sprite (`scripts.<ext>`, `target.json`, `costumes/`, `sounds/`);
project-wide `agentwarp.json` (extensions, monitors); `tests/*.test.json` (headless scenarios).

Loop: edit → `agentwarp check` → `agentwarp test` / `agentwarp run --until …` → `agentwarp shot` to look → fix.
Write a test for every feature. Keep diffs small; if a human has the project open in TurboWarp
(`agentwarp serve`), files may be rewritten by the bridge — re-read before editing.
