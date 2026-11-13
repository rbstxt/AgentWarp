# P2c brief — evaluate a text format as a fresh agent

You are a coding agent who has just been handed the `agentwarp` tool and ONE text format. You are BOTH the
test subject and the reporter. Record friction honestly; results are re-verified.

## Rules
- Repo root: /path/to/agentwarp. Read ONLY: `formats/<format>/AGENTS.md`, the header of
  `packages/cli/agentwarp.ts` (usage), `tools/vmrun/README.md` (for run/probe/input options), and
  `eval/tasks/README.md`. Do NOT read format or core source code — a real user wouldn't. If AGENTS.md is
  insufficient, that is a finding: write it down, then you may look at `formats/<format>/examples/`.
- Tool: `bin/agentwarp` (`new`, `unpack`, `check`, `run`, `pack -o`, `layout`). Never edit `.agentwarp/`,
  never edit project.json by hand. Costumes/sounds/variables/sprites: follow AGENTS.md (target.json + files).
- Work only in `eval/p2c/<format>/`.

## Tasks
L1–L5 from eval/tasks/README.md: `bin/agentwarp new eval/p2c/<format>/L<n>/proj --format <format>`, write the
scripts, `check`, `run` with probes, then `bin/agentwarp pack eval/p2c/<format>/L<n>/proj -o eval/p2c/<format>/L<n>/out.sb3`.
L6 / L6b: `bin/agentwarp unpack eval/fixtures/scrolltutorial-378587848.sb3 eval/p2c/<format>/L6/proj --format <format>`
(L6b: platformer-853110869.sb3), do the edit tasks exactly as specified in eval/P1-BRIEF.md "L6"/"L6b"
(explain, pause with P, 1.5× jump + double jump, comments on new/changed scripts; タイム timer), pack to
`out.sb3`, then save `node tools/vmrun/cli.mjs diff <fixture> out.sb3` and `bin/agentwarp layout <proj>` as JSON.
Time-box: ~6 serious attempts per task.

## Report `eval/p2c/<format>/REPORT.md`
1. Table: task | result | attempts | main failure causes.
2. Friction log with quotes of errors (categories: syntax, Scratch semantics, assets, layout, comments,
   round trip, feedback/debugging, docs). Note every place where AGENTS.md was wrong/missing.
3. Ratings 1–5: readability of existing projects, ease of writing, error feedback, round-trip fidelity,
   layout, comments, assets, long-task suitability. Compare with what you'd expect from editing raw
   project.json.
4. Top 5 improvements to the FORMAT and top 5 to the TOOL.
Do not git commit. Final message: table + ratings + top improvements.
