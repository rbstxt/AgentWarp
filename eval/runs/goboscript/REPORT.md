# P1 report — approach: goboscript (+ sb2gs for import)

Tool versions: goboscript 3.3.0 (built from git 2026-11-13), sb2gs (uv tool),
docs at https://aspiz.uk/goboscript/docs. Work in `eval/runs/goboscript/`.
Each `L<n>/` holds `.gs` sources, `out.sb3`, the input/probe files used, and
`verify.sh` (exact rebuild + verify commands). Method: author in goboscript,
compile, verify with `vmrun check/run/layout/diff`, fix, repeat.

## 1. Result table

| task | result | attempts | main failure causes |
| ---- | ------ | -------- | ------------------- |
| L1 hello | **pass** (x==10, bubble "Hello!") | 1 build | none |
| L2 keys+bounce | **pass** (Cat.x=150 ≥ 100, Ball in bounds 600f) | 1 build | none (one `verify.sh` plumbing fix, harness-side) |
| L3 clicker | **pass** (score==10, backdrop "win") **with workaround** | 1 build + monitor workaround | `show` emits block but no `monitors` entry → monitor invisible; fixed by post-build `add_monitor.py` |
| L4 clones | **pass** (score 2>0, lives→0, Game Over shown, peak ~5 clones) **with workarounds** | 3 designs | (a) broadcast with no receiver silently delivers as empty name; (b) clones re-receive broadcasts → exponential clone bomb (300 clones); redesigned to shooter-side `clone` + muzzle teleport |
| L5 platformer | **behavior pass, task partial** (lands y=36 stable, jump 129.6, level var 2; **comments requirement fails**) | 2 builds | (a) `$`-sigil: locals referenced as `$x` compile silently wrong — only "unused variable" warnings hinted; (b) `#` comments are stripped at compile, so "comments explaining each script" is impossible in-source |
| L6 edit scrolltutorial | **partial** (EXPLAIN ✓, pause ✓, 1.5×+double jump ✓, comments only via post-patch; **0 scripts keep id/position, 11 comments + 2 strays dropped on import**) | ~6 | sb2gs drops comments/detached scripts/empty scripts; goboscript regenerates all ids, stacks all scripts at x=0, normalizes var names, re-renders assets to 480×360 canvas (broke physics until worked around) |
| L6b edit platformer | **partial** (タイム counts/resets, monitor shown; **import didn't compile, ids/positions/comments lost**) | ~8 | decompiled source has duplicate `var` decls (real dup-name vars) → build fails; ASCII-only identifiers (タイム impossible); broadcast/var id collision; 18 empty scripts dropped; asset mangling (60 files) |

"Attempts" = serious build/test iterations (the brief's ~6-attempt budget was never
exceeded; nothing was abandoned).

## 2. Friction log

### Syntax / representation
- **L5: `$` sigil confusion (my error, tool-assisted recovery).** I wrote
  `$hw`, `$i`, `$px` for *locals*; in goboscript `$` means *proc argument*.
  The compiler accepted them silently (compiled to wrong/empty values) and the
  only clue was `warning: unused variable hw` (`Player.gs:6:11`). A use of an
  undeclared `$name` should be an error, not a warning-plus-miscompile.
- **L6b: ASCII-only identifiers.** `var タイム = 0;` fails:
  `error: invalid token` / `unrecognized token, expected one of 'NAME'`.
  Workaround: author as `taimu`, post-build rename to タイム (`patch_rename.py`).
  Cost: every rebuild needs the patch; sources don't show the real name.
- **L6b: duplicate variable declarations from import don't compile.**
  The original project really contains two same-named vars (`k`, `mgi`, `hid`,
  `h`, `player.y` — all dead, 0 references). sb2gs emits both `var k` lines and
  the build fails (`error: variable 'k' is already defined`, precise file:line).
  Fix was manual deletion after verifying zero uses via project.json analysis.
  An importer should dedupe/rename dead vars itself (or warn, not emit
  uncompilable code).
- **L6b: goboscript uses the *name* as the block/variable/broadcast id.**
  The player has scalar var `i` and broadcast `i`; at compile time irgen
  resolves the broadcast against the *sprite* (`this.target.lookupBroadcastMsg`)
  and logs `Found variable with id: i, but its type did not match expected
  type broadcast_msg`. Delivery accidentally still works (names coincide), but
  any run prints VM errors. Renamed the broadcast to `respawn` (2 lines).
  Ids should be unique per namespace (or opaque), never name-derived.

### Scratch semantics
- **L4: unregistered broadcasts fail silently.** `broadcast "game over"` with no
  `on "game over"` receiver produced hats with `BROADCAST_OPTION: ''`
  (stage `broadcasts` dict lacked the entry). Only adding a receiver fixed it.
  A broadcast to nothing should still register/deliver cleanly, or warn.
- **L4: clones inherit broadcast hats → clone bomb.** `on "fire"` in the Bullet
  sprite re-fired in every clone (1, 2, 4, … clones/frame, 300 stuck clones,
  spawner starved, score 0). This is correct Scratch semantics, but as a
  goboscript user I had no warning; fix was the standard pattern (shooter-side
  `clone "Bullet"` + muzzle teleport in `onclone`). Worth one docs paragraph.
- Positive: `stop_all` disposing clones, `broadcast_and_wait` no-op with no
  receiver, redraw-gating — all matched the harness and real Scratch.

### Assets (costumes/sounds)
- **L6+L6b: sb2gs re-renders every image onto a 480×360 canvas**
  (`viewBox="0,0,480,360"`; PNGs 722×22 → 960×720). Sounds survive byte-identical;
  images don't. Effects: (1) harness AABB collision breaks — player walked to
  y=361 instead of resting (took a while to trace to asset bounds, not logic);
  (2) rotation centers/pixel-touching change. Workaround: `restore_assets.py`
  (L6: 6 files explicit map; L6b: 87 files, order-matched per sprite, `as`
  renames excluded) copies original bytes over `src/assets/`. After that all
  134 L6b assets are byte-identical. An importer must never re-render assets.
- Minor: `bitmap_resolution = 2` in the decompiled toml is load-bearing and
  unexplained; shared costume names get ` (2)` filename suffixes (works, but
  the mapping is implicit).

### Layout / positions
- The compiler stacks **every** script at x=0 with computed gaps (L6 player:
  y = 0, 224, 568, 1240, …). `vmrun layout` reports zero overlaps — clean, but
  all human placement is destroyed (L6 diff: 0 unchanged scripts; L6b: 90
  deleted / 71 added / 0 unchanged). There is no "keep untouched scripts where
  they are" mode.
- New-script comment placement (right of script bbox) worked and stayed
  overlap-free in L6; in L6b I kept faithful (overlapping) human comment coords
  instead — resulting overlaps (26 pairs) are still fewer than the original's
  own 42 pairs.

### Comments
- `#` comments are stripped at compile (verified: only goboscript's own logo +
  twconfig comments land in project.json). sb2gs drops all human comments
  (11/11 in L6, 19/19 in L6b), both detached scripts, and all 18 empty scripts
  in L6b. Task (d) ("a Scratch comment on each new/changed script") and comment
  preservation are impossible in-language; both levels use a post-build patch
  (`patch_comments.py` / `patch_rename.py`: workspace comments at original or
  computed coords, idempotent, boilerplate stripped). Comment support is the
  single biggest gap for edit tasks.

### Import / round trip
- sb2gs is fast (216 ms for 1506 blocks) and its `.gs` output is genuinely
  readable (procs, `nowarp`, unicode strings, `as` renames, top-level sprite
  defaults). But round trip is lossy on every axis that matters for editing:
  block ids, script x/y, comment text/attachment/position, variable name case
  (`SCROLL X` → `scroll_x`, `LEVEL` → `level`), broadcast dict entries without
  receivers (`green flag`, `Reset` dropped), detached scripts, empty scripts,
  asset bytes. Baseline `diff.json` (saved as `L6/diff_baseline.json`) shows
  the damage for an *unmodified* rebuild.

### Feedback / debugging
- Good: precise `file:line` errors with expected-token lists (`show` used at top
  level); `unused variable` warnings flagged both dead tutorial vars and my
  `$`-sigil bug; builds take <1 s even at 1618 blocks.
- Bad: silent miscompiles (`$unknown` args, unregistered broadcasts as `''`);
  orphan shadow blocks (`looks_costume`, `sound_sounds_menu`) are emitted as
  `check` warnings (10 in L6b) — tolerated, but diff noise.
- Harness-side (not goboscript, noted for completeness): `Stage.score` probe
  returns None (only `Stage.variables.score` works); 1-frame keypresses are
  unreliable in input scripts (use ≥6-frame holds); `clones.X` probes are None
  after `stop_all` (correct — clones are disposed); huge `run` outputs can
  EAGAIN a pipe (redirect to file).

### Documentation
- Docs are accurate and example-rich (blocks/reporters pages give exact
  syntax); `goboscript new` drops an `AGENTS.md` pointing at the docs, which is
  how I found the `$`-arg convention — after misusing it. Missing: a "broadcast
  registration", "clone-hat inheritance", and "import limitations" page would
  have saved ~40% of my L4/L6 time.

## 3. Ratings (1–5, one line each)

- Readability of existing projects (decompiled .gs): **4** — faithful,
  well-structured; decompiler names (`_16`, `_5`) and `\uXXXX` escapes are ugly
  but honest.
- Ease of writing: **4** — C-like, predictable, fast builds; minus one for
  `$`-sigil and ASCII-only identifiers.
- Error feedback quality: **4** — precise file:line errors and useful
  warnings; minus one for silent miscompiles.
- Round-trip fidelity: **1** — ids, positions, comments, name case, asset
  bytes, empty/detached scripts all lost.
- Layout quality: **4** — auto-stack is clean and overlap-free; destroys human
  layout, no preservation mode.
- Comment support: **1** — stripped on compile, dropped on import; JSON
  surgery is the only path.
- Asset support: **2** — sounds fine; images re-rendered to stage canvas
  (game-breaking for physics), must restore by hand.
- Long-task suitability: **2** — great for greenfield small/medium builds;
  on a big existing project every rebuild needs patch scripts and manual
  id/name mapping — too fragile to iterate on for hours.

## 4. Top 5 things a better tool should do

1. **Lossless project model**: `sb3 ⇄ text` must preserve block ids, script
   x/y, comments (+attachment), variable/broadcast ids *and* display names, and
   asset bytes when untouched; diffs limited to edited scripts.
2. **First-class comments** in the text format (workspace + block-attached),
   round-tripped exactly.
3. **Never re-render assets**; keep original files byte-identical and preserve
   costume bounds/centers (or make the size model explicit and safe).
4. **Unicode identifiers and name preservation** (no case/space normalization,
   no name-as-id collisions across namespaces).
5. **An import that compiles and warns instead of dropping**: dedupe dead
   same-name vars, keep (or explicitly flag) empty/detached scripts, register
   all broadcasts, and document the semantic gotchas (clone-hat inheritance,
   unregistered-broadcast behavior).
