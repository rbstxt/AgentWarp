# P1 brief — evaluating an existing approach as the test agent

You are BOTH the test subject (an AI agent asked to build Scratch projects with approach X) and the
reporter. The point is to discover friction, not to look good: record every failure honestly. Your
results will be re-verified with the harness, so never claim a probe passed unless you ran it.

## Setup
- Repo root: /path/to/agentwarp. Read PLAN.md, eval/tasks/README.md, tools/vmrun/README.md.
- Work ONLY inside `eval/runs/<approach>/` (plus installing the tool globally or in that folder,
  and cloning into `.cache/`). Do not edit tools/vmrun (if the harness has a bug, note it in your report).
- Harness: `node tools/vmrun/cli.mjs check|run|layout|diff ...` (run from repo root).

## Tasks
Do L1 → L5 from eval/tasks/README.md, each in `eval/runs/<approach>/L<n>/` with source files,
`out.sb3`, and the input/probe files you used to verify. Then L6:

- L6 fixture: `eval/fixtures/scrolltutorial-378587848.sb3` (small, comment-dense human project).
  (a) Write `L6/EXPLAIN.md`: what each sprite and script does.
  (b) Add pause: pressing P toggles pause; while paused the player does not move and "PAUSED" is shown
      (a say bubble is fine).
  (c) Make the jump 1.5× higher and add a double jump (second jump allowed once while airborne).
  (d) Add a Scratch comment to each new/changed script explaining it.
  Output `L6/out.sb3`. Then run `vmrun diff eval/fixtures/scrolltutorial-378587848.sb3 L6/out.sb3`,
  `vmrun layout L6/out.sb3`, and save both outputs as JSON in L6/.
- L6b fixture: `eval/fixtures/platformer-853110869.sb3` (big, Japanese names). Add a variable
  `タイム` counting seconds since green flag, shown as a monitor, reset when the level restarts.
  Output `L6b/out.sb3` + diff/layout JSON.

Ideal for L6: untouched scripts keep exact ids and positions, all comments preserved, new scripts placed
cleanly without overlapping. If the approach cannot import an existing sb3, say so, then do the best
workaround you can think of and record the cost.

Time-box: if a task is stuck after ~6 serious attempts, stop it, record why, move on.

## Report: `eval/runs/<approach>/REPORT.md`
1. Table: task | result (pass/partial/fail, which probe) | attempts | main failure causes.
2. Friction log: concrete moments where you were confused or wrong, with the error text/quotes and
   what information or tool would have prevented it. Categorize: syntax/representation, Scratch
   semantics, assets (costumes/sounds), layout/positions, comments, import/round trip, feedback/debugging,
   documentation.
3. Ratings 1–5 with one-line justification: readability of existing projects, ease of writing, error
   feedback quality, round-trip fidelity, layout quality, comment support, asset support, long-task
   suitability (could you keep iterating for hours on a big project?).
4. Top 5 things a better tool should do.

Do not git commit. Final message: the table + ratings + top 5 (concise).
