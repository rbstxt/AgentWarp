# P2C report — format `scratchblocks`

All tasks in `eval/p2c/scratchblocks/L<n>/` (`proj/` source, `out.sb3`,
`input*.json`, plus `EXPLAIN.md` / `diff.json` / `layout.json` for L6/L6b).
Every probe below was actually run (`bin/agentwarp check|run`, `vmrun diff|layout`).

## 1. Result table

| task | result | attempts | main failure causes |
|---|---|---|---|
| L1 hello | pass (x=10, bubble "Hello!") | 1 | — |
| L2 keyboard+bounce | pass (x=150 ≥ 100; Ball in-bounds 600f, max\|x\| 220, max\|y\| 160) | 1 | — |
| L3 clicker | pass (10 clicks → score=10, backdrop "win", monitor shows score) | 3 | no sprite rename/delete path (base target "kept verbatim"); monitor/list shapes learned via fixture unpack |
| L4 shooter | pass (score=15, clones ≤6 mid-run → 0 at end, GameOver shown, player moves) | 3 | kills luck-based at first (score 0); one unreproduced flake (score 2 once, then 0s); fixed via wider bullet, narrower spawn, slower fall |
| L5 platformer | pass (lands y=-70 grounded ≤120f; jump rises; level switch by broadcast; warp custom block; list levels; pen scroll; comments) | 6 | hand-counted parens in `item-of`/`go-to` (13 errors); `length of [empty list]` crashes `run`; list initial values silently dropped (wrong key) |
| L6 scrolltutorial edit | pass (P pauses/freezes + PAUSED bubble + clear on resume; jump 1.52× apex; double jump exactly once; diff: 0 moved, ids kept; layout 100) | 5 | probe-path learning; jump tuning 26→23; editing tick silently dropped untouched `/* */` comment; comment-form edit rebuilt unrelated script (fresh ids) and shifted startup timing |
| L6b タイム timer | pass (counts 1/s from イントロ完, monitor visible, resets on stage advance; diff: 1 script +1 line, 1 script added, 0 lost) | 2 | none (pattern mirrored from existing TIME loop) |

## 2. Friction log (with quotes)

- **Syntax — paren counting.** Deep `item ((((k) * (4)) - (3)) of [platforms v])`
  fails as `unknown block "set [rx v] to ..." (did you mean "set [... v] to (...)")?`.
  The diagnosis (file:line:col + did-you-mean) is good, but "unknown block" for a
  paren slip misleads. Fix used everywhere: shallow temp vars
  (`set [k4 v] to ((k) * (4))`, `set [hw v] to (((rw) + (40)) / (2))`). Generated
  arithmetic in this format is write-only without that discipline.
- **Scratch semantics — sprite identity.** Renaming `Sprite1`→`Cookie` (name edit in
  `target.json`) leaves `warning: target "Sprite1" not in directory; kept verbatim`
  and the stale sprite (with deleted costume files) breaks `check`. Deleting the dir
  does the same. There is no documented rename/delete path. Workaround (used 3×):
  restore the template sprite and hide it on green flag — ugly but probe-safe.
- **Assets.** Adding costumes/sounds = copy bytes + hand-edit `target.json`
  (rotation centers guessed). No tool help. `agentwarp.json` monitor shape and
  `target.json` list-initial-value shape are undocumented and AGENTS.md is wrong
  (`{name, id, value}`); real shape found by unpacking `tools/vmrun/test-fixtures/click.sb3`
  and `lists.sb3`: monitors need the full monitor object; lists need
  `{"name","id","items":[[v1,...]]}`. With the wrong key (`value`), pack silently
  drops the data (`"lists": {"list-platforms": ["platforms"]}` — no error).
- **Round trip.** Clean unpack→pack is lossless (all 8 player comments kept).
  But editing the tick script silently dropped an untouched reporter-attached
  comment (`/* [c3] ... */`); `diff` later reported it lost, pack gave no warning.
  I restored the text as a `//` comment. Also, that comment-form-only edit rebuilt
  the *unrelated* main-loop script with fresh block ids (visible in base.json),
  which changed thread scheduling and delayed game startup ~25 frames (jump fired
  post-release, apex measured 136 instead of 220 until I re-probed with a late
  keypress: true apex 220 = 1.52×). Same source packs deterministically
  (repA == repB behavior), so the fragility is id-order → schedule sensitivity.
- **Feedback/debugging.** `bin/agentwarp run` prints warnings to **stdout** before
  the JSON, so `... | python3 -c json.load` fails; had to `sed -n '/^{/,$p'`.
  `check ok` does not imply `run ok`: `length of [empty list]` at green-flag time
  kills the run with `Cannot read properties of undefined (reading 'length')`
  (real Scratch returns 0 — harness bug). Found by bisecting scripts, confirmed
  with a 1-line repro, worked around by prefilling the list + `replace item`.
- **Docs.** AGENTS.md never mentions: list init shape, monitor shape, sprite
  rename/delete, `([x] of [sprite])` sensing (works — L4 examples use it),
  cross-target var/list reads (work), `replace item` syntax (works). Examples/
  (`l1-*.sb`, `l4-*.sb`) were the real documentation for L4; the click/lists
  fixtures (via tool unpack) for L3/L5 shapes.
- **Unreproduced flake.** One L4 run reported score=2 with inputs that otherwise
  deterministically score 0 (5/5 identical reruns). Never explained; noted, not relied on.

## 3. Ratings (vs editing raw project.json)

- Readability of existing projects: **5** — anchors + English block text + comments
  (even Japanese projects read fine); `!`/mutation lines are honest escape hatches.
- Ease of writing: **3** — simple scripts flow, but nested reporters demand
  paren-counting; menus/fields must match exactly; assets/variables are hand-JSON.
- Error feedback: **4** — file:line:col + did-you-mean is genuinely good; minus one
  for silent drops (list values, reporter comments) and check-green/run-crash gaps.
- Round-trip fidelity: **4** — lossless when untouched; minus one for comment loss
  on edit + unrelated-script id churn.
- Layout: **3** — new scripts auto-placed with 0 new overlaps here (score 100/unchanged
  counts), but positions are not controllable from text.
- Comments: **4** — attach/preserve/print well; minus one for `/* */` fragility.
- Assets: **3** — files + target.json work, but everything manual (centers, ids,
  no validation that bytes match).
- Long-task suitability: **3** — anchors/ids/diff make multi-hour iteration viable
  (L6b on a 1500-block project worked), but silent drops and rename gaps erode trust.

## 4. Top 5 FORMAT improvements

1. Document `target.json` list initial values (`items: [[...]]`) and `agentwarp.json`
   monitor entries; fix AGENTS.md `{name, id, value}` (wrong for lists).
2. Document a sprite rename/delete workflow (or forbid + explain the verbatim-keep).
3. Keep reporter-attached (`/* */`) comments stable across script edits, or warn
   when one is dropped.
4. Document cross-target variable/list reads and `([x] of [sprite])` as supported.
5. Flatter expression syntax or paren-balance diagnostics (point at the paren, not
   "unknown block").

## 5. Top 5 TOOL improvements

1. Fix `length of [empty list]` runtime crash (return 0 like Scratch) — check passes
   today and run dies.
2. Don't rebuild unrelated scripts with fresh ids on pack (churns positions/labels
   and can shift thread scheduling/behavior).
3. Print `run` diagnostics to stderr so stdout stays parseable JSON.
4. Report new-script placement/overlaps at pack time (or accept position hints).
5. Add `rm`/`rename` for sprites (or make dir-removal mean removal) instead of
   silent "kept verbatim".
