# P2C report — format sbpy

Agent: fresh session, allowed docs only (AGENTS.md, agentwarp.ts header,
vmrun README, tasks README; examples/ consulted twice, noted below).
All probes executed; every claim re-ran. Time-box respected (~6 attempts max).

## 1. Task table

| task | result | attempts | main failure causes |
|---|---|---|---|
| L1 hello | pass (x==10, bubble "Hello!") | 1 | none |
| L2 keyboard + bounce | pass (right 30f → x=150; Ball inside 600f) | 1 | none (copied bolt-SVG pattern from examples/l4) |
| L3 clicker | pass (10 clicks → score 10, backdrop win, monitor 10) | 4 | sprite rename impossible (stale `Sprite1` in base); monitor shape undocumented; `run` stdout mixes warnings+JSON |
| L4 shooter | pass (score 13/1800f, clones ≤4, Game Over shown) | 7 | broadcast-hat fires in clones (clone explosion ×300); bullet/enemy mutual-touch race (score 0 despite overlap); blind sweep inputs parked at clamp |
| L5 platformer | pass (lands y=-62 stable ≤120f; jump +99; level2 broadcast f107; warp `collide`) | 5 | `ITEM`→`INDEX`; multi-param define needs `(dx, dy)`; pack flattens non-empty lists (schema-invalid sb3) |
| L6 scrolltutorial edit | pass (pause P + PAUSED bubble + resume; jump 64→100; double jump apex 206; 0 comments lost; others untouched) | 4 | if/else restructure dropped a raw-nested comment (recovered via sibling-append) |
| L6b platformer タイム | pass (counts 6/200f, monitor live, resets 0 on 次のステージ, only ステージ +2 scripts) | 2 | none (mirrored existing TIME pattern) |

## 2. Friction log (with error quotes)

**Syntax — `data_itemoflist` arg name.** Wrote `ITEM=`, got:
`error: line 5: unknown argument "ITEM" for "data_itemoflist"; did you mean "INDEX", "LIST"?`
Fixed in one step. Exemplary message. (AGENTS.md never shows list-item reads.)

**Syntax — multi-param define.** Wrote `define "collide %n %n" (dx) (dy) [warp]:`, got:
`error: line 3: define needs the form define "label %n ..." (args) [warp]: e.g. define "jump %n" (height) [warp]:`
The two-param examples all use one group — `define "weird %b and %s" (<flag>, name="dflt")` — so `(dx, dy)` worked. Message shows only the 1-param shape; the comma form had to be inferred.

**Syntax — `raw` printer.** Unpacked L6 prints the left-arrow key test as `raw "control_if":` / `raw "sensing_keypressed":` because a `#` remark sits on the nested value. Round-trips fine, but reading it is harder than the normal form one line above.

**Scratch semantics — hats fire in clones.** L4 v1 used `on fire → goto ship → clone self` on Bullet: every clone re-received `fire`, teleported back and cloned again → `clones: {'Bullet': 300}`. AGENTS.md gotchas list this exact trap ("also fire in clones"); the fix (Player creates `CLONE_OPTION="Bullet"` directly) is standard but cost an attempt.

**Scratch semantics — mutual-touch race.** Bullet deleted on `touching Enemy` + Enemy scored on `touching Bullet`: whoever's thread ran first won, so 20 kills scored 3 and the rest vanished scoreless with lives intact. Fixed with a single kill path (only the enemy checks touch; bullets die only at edge). Verified by trace (closest approach dx=13/dy=14 with no score was the smoking gun).

**Assets — hand SVGs + sound metadata.** `rotationCenterX/Y` guessed from viewBox (worked; `costumes` check would have caught errors). `sampleCount`/`rate` for copied sounds were copied blind from the template — no AGENTS.md guidance; `check` passed so values were plausible. No way to validate audibly headless (documented harness limit, fine).

**Layout — auto-placement good, no control.** New scripts land at x=4 below existing ones (L5/L6b: 0 overlaps on new scripts). No syntax to request a position; fine for the eval, would want it for big edits.

**Comments — one loss on restructure.** Changing `control_if` → `control_if_else` in L6 tick dropped the raw-nested comment `this code needs the play game code…` (diff: `lost: 1`). Rewriting the double-jump as an appended sibling `if` kept all 8 original comments (`lost: []`). Rule learned: append, don't restructure, near `raw` blocks. `#` attach semantics otherwise behaved exactly as documented.

**Round trip — pristine is perfect; rename is impossible.** `unpack → pack` with zero edits diffs clean (`changed: 0`, all comments kept). But renaming `Sprite1`→`Cookie` by moving the dir fails: `warning: target "Sprite1" not in directory; kept verbatim` + missing-asset errors, because the name lives in `.agentwarp/` (off-limits per brief). Workaround: keep `Sprite1` parked hidden off-stage + add a real `Cookie` sprite (L3), same for L4/L5. A rename command (or dir-move detection) is missing.

**Round trip — pack bug with non-empty lists.** L5 `lists` packed as `["level1", "310420100", ...]` (array spread) → `loadProject failed: should NOT have more than 2 items`. Workaround: nest once (`items: [[...]]`) so the spread produces `[name, [...]]`. AGENTS.md documents the `items` shape I used, so this is a tool bug, not user error.

**Feedback/debugging — Stage-global warnings are noise at scale.** L5 prints 28 lines of `unknown variable "level" … if it is a Stage (global) variable, make sure it exists`. Documented and harmless, but it buries real errors and pollutes `run` stdout — which also breaks naive JSON parsing (`run` prints warnings to stdout before the JSON; had to strip to first `{`). Warnings belong on stderr.

**Docs — gaps actually hit.** AGENTS.md never mentions: monitors (`agentwarp.json`), `data_itemoflist(INDEX=)` / `data_lengthoflist`, `operator_subtract/divide/mod/mathop`, `data_showvariable/hidevariable`, letter `KEY_OPTION`s, `CLONE_OPTION` sprite names, list encodings, extensions/pen. The cheat sheet covered ~90% of L1–L4; L5+ needed guess-and-check (though `check` always corrected within one attempt).

## 3. Ratings (1–5; vs editing raw project.json)

| axis | sbpy | note (raw project.json comparison) |
|---|---|---|
| readability | 4 | opcodes greppable, anchors + `#` comments readable; `raw` regions and warp math chains are dense. Raw JSON (ids, nesting) is far worse. |
| ease of writing | 4 | L1–L4 in 1–4 attempts each; L5 decode math verbose but writable. Raw JSON writing is not realistic. |
| error feedback | 5 | best part: file:line:col + did-you-mean + valid-options listing. Raw JSON gives schema errors at best. |
| round-trip fidelity | 4 | pristine unpack→pack diffs zero; −1 for the raw-comment fragility and no rename path. Raw JSON round-trips trivially but is unreadable. |
| layout | 4 | new scripts auto-placed with 0 overlaps; no position control. Raw JSON exposes x/y but hand-editing them is miserable. |
| comments | 4 | attach semantics predictable; one loss on restructure, recoverable. Raw JSON comments are id-keyed objects. |
| assets | 3 | SVG authoring fine; sound metadata opaque; sprite rename blocked. Raw JSON same pain plus hash filenames. |
| long-task suitability | 4 | 1070-line L6b navigable (grep opcodes/broadcasts); warning noise is the main drag. Raw JSON at that size is hopeless. |

## 4. Top 5 improvements

Format (AGENTS.md / sbpy):
1. Document list ops (`data_itemoflist(INDEX=)`, `data_lengthoflist`), `operator_mathop/subtract/divide/mod`, `data_showvariable/hidevariable` — every L5 edit needed one of these and none are in the doc.
2. Document monitors (`agentwarp.json` shape) and the `visible` flag — required by L3/L6b task text, learned only by experiment.
3. Resolve cross-target names against all `target.json` files (or a `globals` declaration) instead of warning per use — 28 warnings in one L5 check.
4. Show the multi-param define form `(dx, dy)` in the cheat sheet, not just `(height)`.
5. Give scripts optional position control (e.g. trailing `# @xy`) so L6-style insertions can avoid overlap regions deliberately.

Tool (`bin/agentwarp` / pack / vmrun):
1. Fix pack spreading non-empty `lists.items` (produces schema-invalid sb3) — silent data corruption, worst bug found.
2. Support sprite rename (dir move or `agentwarp rename A B`) instead of `kept verbatim` + stale assets.
3. Print diagnostics to stderr; keep stdout pure JSON for `run`/`check`/`layout`/`diff`.
4. Document `vmrun diff` in tools/vmrun/README.md (it exists, works well, and the briefs depend on it).
5. Keep block/comment anchors stable across sibling insertions (the if→if/else comment loss) — or warn which comments will drop before packing.
