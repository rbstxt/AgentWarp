# P1 report — approach: raw-json (hand-written sb3 project.json)

Method: no Scratch-specific tool. Each task built by a small ad-hoc node script
in its `L<n>/` folder that assembles `project.json` + assets (SVG costumes,
generated WAV) and zips `out.sb3`. Verified only with
`node tools/vmrun/cli.mjs check|run|layout|diff`. Block shapes were copied from
`tools/vmrun/make-fixtures.mjs` and from unzipped real projects.

## 1. Results

| task | result (probe) | attempts | main failure causes |
|------|----------------|----------|---------------------|
| L1 | pass (x==10, bubble "Hello!") | 2 | wrong CLI cwd once; then clean |
| L2 | pass (x=150 ≥ 100; Ball in stage 600f; layout 100) | 2 | workspace comment overlapped script (score 85 → moved it, 100) |
| L3 | pass (score==10, backdrop "win", monitor 10, layout 100) | 2 | my probe read `Cookie.variables` for a Stage-level var; project was correct |
| L4 | pass (score=3>0, clones ≤13<100, Game Over + backdrop, layout 100) | 5 | (a) `say`+`stop all` self-cancels; (b) game too hard (game over @f199, score 0); (c) chain/parent ordering crash; (d) 2 layout overlaps |
| L5 | pass (lands f22, y stable; jump rises; level2@f95 + backdrop; layout 100) | 8 | (a) missing `custom_block` input; (b) arithmetic ops need NUM1/NUM2; (c) list stored as compound strings vs flat items; (d) MY if/else logic bug (head-bump in wrong branch); (e) layout spacing; hold-to-jump burned double jump → added edge detection |
| L6 | pass (diff: 12 unchanged/0 moved/2 changed/1 added, 11 comments kept + 4 added; layout 100/100; pause freezes + PAUSED; jump 1.5× + double jump) | 4 | parent-link warning; two block-id collisions; hold-burns-double-jump (edge detect) |
| L6b | pass (diff: 90 unchanged/0 moved/0 changed/2 added, 19 comments kept + 2 added; overlaps 42→42; タイム=6@200f; reset verified) | 2 | none on deliverable (reset verified via temp key-hat copy) |

All `out.sb3` rebuild deterministically (rebuilt from scratch at the end, all
probes re-pass). L6b `check` shows 26 warnings — byte-identical count to the
pristine fixture (pre-existing editor cruft, e.g. detached shadow menus).

## 2. Friction log

**syntax/representation**
- Operator input names are inconsistent: comparisons/booleans use
  `OPERAND1/OPERAND2` (and `OPERAND` for not), but arithmetic uses
  `NUM1/NUM2`. Hand-writing `OPERAND1` for `operator_subtract` passes `check`
  silently and fails only at runtime with stderr
  `vm warn IR: operator_subtract: missing input NUM1`, all values NaN.
  Cost L5 ~2 cycles. A schema or a single example per opcode family would have
  prevented it.
- Procedure-call arg passing has two shapes: filled `{argId: [2, exprBlock]}`
  vs empty-default `{argId: [3, argId, [10, default]]}`. I guessed the inline
  `[3, [12,...], [10,...]]` form correctly only because a real project
  (scrolltutorial) happened to contain it. `check` does not validate
  arg-id/default consistency (dangling `[3, missingId, default]` passes).
- `data_itemoflist` INDEX `[1, [7, "1"]]` (tag 7 = list-index menu) is
  undiscoverable without an example; tag meanings (4/5/6/7/10/11/12/13) are
  tribal knowledge.
- `event_whenkeypressed` hat format was never confirmed (I avoided hats for
  keys entirely and used `<key pressed?>` sensing loops). Key *names* also
  split across two serializations: sensing menus (`sensing_keyoptions`,
  `['right arrow', null]`) vs raw strings in fixtures (`["right arrow"]`
  literal — both work).

**Scratch semantics** (biggest time sink)
- `looks_say` followed by `control_stop all` shows nothing: stop-all clears
  bubbles (as does the editor stop button). My L4 game-over was
  self-defeating by construction. Fix required a redesign (game-over backdrop
  + freeze via `lives = 0` gating). Nothing in the format hints at this; only
  a runtime probe caught it.
- `control_repeat_until` with *no* CONDITION input = infinite loop (seen in
  the wild, L6 fixture). I initially read the missing input as corruption.
- Harness dump quirk (not my bug, but confusing): Stage-owned *lists* appear
  under `variables` in `run` output (`Stage.variables.platforms`), with
  `lists: {}`. Cost one confused probe (L5).
- `say ""` clears the bubble (falsy text → null) — useful, undocumented; found
  by reading `harness.mjs#bubbleOf`, not docs.
- Warp (`warp: true`) custom blocks run atomically — I verified my L5
  collision math was still correct under warp, but only by testing.

**assets (costumes/sounds)**
- No friction writing them (md5-of-content naming is simple), but collision
  boxes derive from costume SVG viewBox, so every gameplay number I chose
  depended on asset dims I had just invented. No tooling connects the two;
  I tracked half-widths in my head (L4/L5). One honest collision-size source
  (e.g. harness reporting parsed dims) would remove the guesswork.
- WAV generation: copied 40 lines of PCM boilerplate out of
  `make-fixtures.mjs`. Fine once, annoying always.

**layout/positions**
- The layout size model exists only in `lib/layout.mjs` (hat 180×44, row 30,
  C-block header 32…). I guessed script heights, got 8 overlaps in L5
  (score 0), then re-spaced. Feedback (`layout` overlap pairs) is good;
  the model constants are not published where an author can see them.
- L6b baseline is score 0 with 42 overlaps (human mess) — "don't make it
  worse" is the only sane bar there; overlaps 42→42 verified.

**comments**
- No friction: `{blockId, x, y, width, height, minimized, text}` with
  `blockId: null` for workspace comments. Attached comments accept any
  block id. Round-trips perfectly (L6/L6b diffs: 11/11 and 19/19 kept).

**import/round trip**
- Real projects contain shapes a strict reader would reject: a block entry
  that is a raw list `[12, "(ﾟ∀ﾟ)", ...]` (platformer fixture), dangling
  `[3, missingArgId, default]` call args, detached shadow menus, an orphan
  non-shadow block (`!xS3J71RhS6f62|fQF91` + lone costume switch in L6
  fixture). `check` tolerates all of these (warnings/ignores) — correctly.
  My editor had to be equally tolerant on import: `typeof blocks[id] ===
  'object'` guards everywhere, never assume parent/next symmetry.
- Key preservation: my edits parse + `JSON.stringify` the whole project; all
  untouched ids/positions/comments survived (diff proves it). Doing this by
  hand for L6b's 1500-block project was scary but worked.

**feedback/debugging**
- `check` catches dangling refs/orphans/missing assets well (fast, precise).
- Runtime misbehavior gives no project-side location: the NUM1/NUM2 bug
  printed 30 identical VM warnings with *generated* ids (`id: 'e17'`),
  unmappable to my source without the dump round-trip (unzip → grep).
  No variable watchpoints; I verified physics by `--trace` + `--probe`
  frame arithmetic.
- `diff` is excellent: unchanged/moved/changed/added + comment accounting
  made L6/L6b verification one command each.

**documentation**
- Scratch wiki file-format page covers ~70% (blocks/inputs/fields); the
  rest (tag numbers, NUM1/NUM2, arg shapes, warp flags, monitor schema)
  came from reading `make-fixtures.mjs` + two real fixtures. Without those
  local examples this approach would have been 3× slower.

## 3. Ratings (1–5)

| axis | score | why |
|------|-------|-----|
| readability of existing projects | 2 | ids are random gibberish; structure emerges only after scripting summaries |
| ease of writing | 2 | every block is 8+ lines of JSON; ~140 blocks for L5; one wrong key name = silent NaN |
| error feedback quality | 3 | `check` is good; runtime errors are VM warnings with generated ids |
| round-trip fidelity | 5 | diff: 12/12 and 90/90 scripts untouched, all comments kept |
| layout quality | 2 | hand-estimated boxes; needed 1–2 `layout`-and-fix cycles per task |
| comment support | 5 | trivial format, perfect round-trip |
| asset support | 3 | simple to author, but dims silently drive collision with no link |
| long-task suitability | 2 | worked for hours here, but only via extreme care + harness; one slip corrupts silently |

## 4. Top 5 things a better tool should do

1. **A text format where one block = one line** (`set [score] to (0)`,
   `if <key [right arrow] pressed?>`), with ids/positions/comments managed,
   not hand-written.
2. **Validate semantics, not just references**: unknown input names
   (`OPERAND1` on `operator_add`), arg/default mismatches, and always-false
   branch structures should be `check` errors with file:line, not runtime
   NaNs/VM warnings.
3. **Round-trip guarantee as a command**: `unpack`/`pack` preserving every
   id, position, comment, and asset byte, with `diff` proving it — the one
   part of this approach that already works and must be kept.
4. **Layout assistance**: publish the size model and provide `cleanup`
   for new scripts (or check new-script overlaps), so authors never
   hand-estimate boxes.
5. **Semantic run feedback**: map a failing probe back to the responsible
   script/block (e.g. "wy never reached -110; collide ran 0 times"), plus
   variable watchpoints — frame-trace arithmetic does not scale to big
   projects.
