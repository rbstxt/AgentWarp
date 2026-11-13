# P1 report — approach: agentic-scratch (typed-IR workbench)

Repo: `github.com/ggfincke/agentic-scratch`, cloned to `.cache/agentic-scratch`
(built with `npm install && npm run build`, Node 26). Work in this folder;
tool linked via `node_modules` symlink (no `tools/vmrun` changes).

**How the approach was actually used.** The workbench's documented path is an MCP
server plus revisioned edit sessions with semantic contracts. With no MCP client
available I worked one layer down, which the brief allows (CLI + IR ops):
`ProjectIR.fromSb3` (import), `blankProject` / `addSprite` / `addScript` /
`buildScript` / `Uids` (authoring), `toSb3` (export), `inspect`/`roundtrip`
scripts for reading. I did **not** use the MCP server, edit sessions, repair,
or browser lanes — the session/contract machinery was too heavyweight to drive
without a client and its docs assume agent-driven MCP use. Everything below is
IR import → (typed builder + small raw-JSON patches) → export, verified with
`tools/vmrun`. Raw-JSON patching was needed wherever the typed builder has no
API (procedures definition/prototype, comments, monitors, menu shadows).

## 1. Result table

| Task | Result | Attempts | Main failure causes |
|------|--------|----------|---------------------|
| L1 hello | pass (x==10, bubble "Hello!" @1s) | 1 | — |
| L2 keys+bounce | pass (x=150 ≥100; Ball inside ±240/±180 all 600 frames) | 1 | checked key/menu encoding from fixture first |
| L3 clicker | pass (score==10, backdrop "win", broadcast delivered, monitor 10) | 3 | brace typo; `BROADCAST_OPTION`→`BROADCAST_INPUT` (F2) |
| L4 shooter | pass (score 8>0, lives 0→GameOver shown, scripts stop, clones ≤4) | 8 | `control_create_clone_of` name (F1); broadcast must be stage-declared (F3); lives skip-0 (F5); say+stop-all clears bubble (F4) → GameOver sprite |
| L5 platformer | pass (lands y=-135 stable; jump +97px; 11 level-switch broadcasts; warp=true; comments) | 6+2 layout | 3× brace-balance debugging (F8); void-past-goal level fix; 2 layout iterations (F13) |
| L6 edit scrolltutorial | pass (EXPLAIN.md; pause freezes + PAUSED; jump 1.53×; double jump + 3rd blocked; diff 11 unchanged/0 moved/3 changed/1 added/11+4 comments; layout 100) | 7 | subtree search (F-chain); gate encoding (F6); OPERAND2 shape destruction; sibling-parent convention; holding-Up burns both jumps → edge-trigger redesign; jump tuning 17→21→23 |
| L6b edit platformer | pass (タイム==3 @95f, monitor visible; reset block in 次のステージ receiver; diff 89/0/1/1, 19+2 comments; layout 0 new overlaps) | 2 | level-flow archaeology to pick restart broadcast (F14) |

All `out.sb3` pass `vmrun check` with zero errors; L1–L5 layouts score 100
(L6b inherits the fixture's dense hand layout: 42 pre-existing overlaps, 0 new).

## 2. Friction log

- **F1 [representation, feedback] — builder accepts anything.** `control_createcloneof`
  (real: `control_create_clone_of`) and `BROADCAST_OPTION` as an input key built
  fine; only `vmrun check` warned (`unknown opcode`, `missing input BROADCAST_INPUT`).
  A builder-side opcode/input-name check against the workbench's own
  `standard-v2`/core catalog would have caught both instantly.
- **F2 [representation] — broadcast input key.** `event_broadcast` needs
  `BROADCAST_INPUT` (the VM maps it to `args.BROADCAST_OPTION` via the
  `event_broadcast_menu` shadow). Learned from the vmrun warning, then from
  `execute.js:332`. Nothing in the IR builder hints at this.
- **F3 [Scratch semantics, worst silent failure] — broadcasts resolve on Stage.**
  `broadcast()` does `getTargetForStage().lookupBroadcastMsg(id, name)`; a
  sprite-declared broadcast id used from a stage script silently never delivers
  (no warning; harness even records it as sent). Cost a full debug cycle in L4.
- **F4 [Scratch semantics] — `say` + `stop all` leaves no bubble.**
  `PROJECT_STOP_ALL` resets all bubbles (real VM behavior, `scratch3_looks.js:32`).
  Redesigned to a shown GameOver sprite carrying the message. Task wording
  ("Game Over shown") survives this; a say-only solution cannot.
- **F5 [Scratch semantics] — `lives == 0` skips.** Two enemies crossing the line
  in one frame take lives 1→−1, the `= 0` gate never fires. Used `< 1`.
- **F6 [representation, documentation] — custom-block/monitor/menu shapes.**
  Call-mutation (`proccode/argumentids/warp` string), definition/prototype/pill
  wiring, `data_*` field/input conventions, attached-comment encoding — all
  reverse-engineered from real fixtures (`scrolltutorial`, `platformer`), not
  from workbench docs. The IR builder has no procedure/comment/monitor API, so
  these were raw-JSON patches via `ir.uids` + `ir.json`.
- **F7 [representation] — same as F6, general form:** comments, monitors,
  menu shadows, procedures fall outside the typed ops; every L3–L6 build needed
  a `shadowifyMenus`/raw-patch helper. Round trip itself is perfect
  (byte-identical on both fixtures), so the gap is authoring API, not the IR.
- **F8 [syntax] — giant spec literals.** Three separate brace-balance hunts in
  L5 (one extra `}`, one missing `]`, five minutes each with a throwaway
  tokenizer). A `buildScript` dry-run validator (or composable helpers over
  literals) would remove this class entirely.
- **F9 [documentation] — hat matching.** Chased broadcast-hat matching through
  `blocks-runtime-cache.js` (uppercase cache) fearing a second silent failure;
  encoding was fine. A line in the docs ("hats match on uppercased names")
  would have saved the detour.
- **F10 [feedback, harness] — trace shape.** `--trace` returns a list of frames,
  not a per-sprite map; first two parses crashed. Minor; harness README could
  show one trace JSON.
- **F11 [feedback] — one unreproducible L4 run** (score 77/lives −30 vs 8/0 on
  identical inputs+sb3). Four subsequent runs are byte-deterministic (`--seed 1`
  default). Recorded honestly; no explanation found — possibly a stale build in
  the middle of an edit. Never recurred.
- **F12 [harness] — `sensing_of_*_menu` warns as unknown opcode** although valid
  (worked around with `go to [Player]`). Harness opcode list gap, not fatal.
- **F13 [layout] — positions are manual.** `addScript` defaults to (0,0); overlap
  is only visible via `vmrun layout`. Two L5 iterations + one L4 iteration to
  reach score 100. The workbench has layout ops (`layout.ts`) but nothing I
  could call cheaply from a script; a "place in clean column" helper is missing.
- **F14 [import/comprehension] — which broadcast restarts a level?**
  The platformer has 7 broadcasts across 8 targets; mapping
  次のステージ→counter+transition vs すてーじかわった/次！→player handlers took
  ~30 min of JSON archaeology. `inspect --text` + `summarizeProject` helped;
  a broadcast flow graph (who sends/receives what) would help more.

## 3. Ratings (1–5)

- **Readability of existing projects: 4** — `inspect` + per-target summaries are
  genuinely useful; one-line justification: full opcode detail still needs raw
  JSON walks.
- **Ease of writing: 3** — `BlockSpec` stacks are compact and pleasant for plain
  scripts; procedures/comments/monitors/menus drop to raw JSON.
- **Error feedback quality: 2** — the builder never rejects bad opcodes, bad
  input keys, or malformed shapes; all signal came from `vmrun` or runtime.
- **Round-trip fidelity: 5** — byte-identical `project.json` on both human
  fixtures (140-block tutorial, ~90-script platformer); untouched scripts kept
  exact ids/positions in L6/L6b diffs (18/18, 19/19, 7/7 kept).
- **Layout quality: 3** — hand-placed positions work and attached comments are
  (correctly) overlap-exempt; but no auto-layout assistance at build time.
- **Comment support: 2** — readable via IR, but no typed write API; attached via
  raw `{blockId,x,y,width,height,minimized,text}` (verified preserved: 11/11,
  19/19 kept).
- **Asset support: 3** — `addCostume`/`addSound` + asset sink work; you hand-roll
  every byte (SVG strings, WAV header, md5ext naming) with no helpers.
- **Long-task suitability: 3** — the import→edit→export loop carried a ~90-script
  project fine and I'd iterate this way for hours; the heavier session/repair/MCP
  layers were not practically usable without a client, which caps the score.

## 4. Top 5 things a better tool should do

1. **Validate at build time**: reject unknown opcodes and bad input/field names
   against the opcode catalog with file:line, instead of emitting silently
   broken projects (F1, F2).
2. **Typed builders for procedures, comments, monitors, menu shadows** so no
   task ever needs raw-JSON patching (F6, F7).
3. **Broadcast/variable cross-target rules in one place**: stage-declared
   broadcasts, hat name matching, monitor spriteName conventions (F3, F9).
4. **Script-aware layout help**: "append in a clean column, report overlaps"
   at build time, not as a separate CLI pass (F13).
5. **Project comprehension views**: broadcast send/receive graph + per-script
   scratchblocks dump for EXPLAIN-style edits of human projects (F14).
