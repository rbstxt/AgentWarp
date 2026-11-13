# P6 brief — long-horizon task as a fresh agent

You are a coding agent asked by a user to build/modify Scratch projects with the `agentwarp` toolchain.
You are BOTH the worker and the reporter: work as long as needed (hours are fine), and keep an honest
friction log as you go. Results will be re-verified.

Read first (and only these docs; do not read core/format source code):
`skill/agentwarp/SKILL.md` (+ its references/), `formats/ts/AGENTS.md`, `bin/agentwarp help`.
Use only `bin/agentwarp` commands (new/unpack/check/test/run/shot/tidy/pack/layout/costumes).
Work only inside `eval/p6/<your-task>/`. Do not git commit.

Keep `eval/p6/<your-task>/LOG.md` updated while working: a todo list you maintain, and a timestamped
friction log (tool errors with quotes, doc gaps, confusing behaviour, things that cost >10 min).

Finish with `eval/p6/<your-task>/REPORT.md`: what was built (feature list vs request), tests
(`bin/agentwarp test` output), `bin/agentwarp check` output, final `shot` images (paths), total iterations,
the 10 worst friction points ranked by time lost, and concrete improvements (tool, docs, format).
