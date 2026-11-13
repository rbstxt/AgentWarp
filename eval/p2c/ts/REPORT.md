# P2C report — `ts` format

Subject + reporter: test sub-agent. Format: `ts`. All `out.sb3` re-verifiable via
`bin/agentwarp check/pack` + `node tools/vmrun/cli.mjs check|run|diff|layout`.

## 1. Task table

| task | result | attempts | main failure causes |
|------|--------|----------|---------------------|
| L1 hello | pass (x==10, bubble "Hello!") | 1 | none (copied `examples/l1.Sprite1.ts`) |
| L2 keyboard+bounce | pass (x==150 ≥ 100; Ball in stage 600f) | 1 | none |
| L3 clicker | pass (score==10, backdrop win, monitor visible) | 3 | (a) vars without `id` rejected; (b) renamed sprite leaves base ghost |
| L4 shooter | pass (score==4>0, clones bounded, Game-Over shown in sayEvents) | 1 | none (built on `examples/l4.*.ts` + parked originals) |
| L5 platformer | pass (lands y==-100 stable; jump rises; ground-only; 2 levels; warp `collide`; camera) | 5 | packer list-serialization bug crashed every run; workaround needed |
| L6 scrolltutorial edit | pass (pause freezes + PAUSED + resume clears; 1.5× jump; once-only double jump) | 5 | comment re-attach rules; tick runs every 2nd frame (inherent); hold-consumes-double → added edge detection |
| L6b タイム timer | pass (counts 2 @70f; reset on 次のステージ → 1 @100f; monitor visible) | 2 | none (plus pre-existing fixture warnings reviewed) |

Probes/inputs/diffs/layouts: `eval/p2c/ts/L<n>/` (`out.sb3`, `diff.json`, `layout.json`,
`EXPLAIN.md` for L6; inputs in `/tmp/l*.json`, rerunnable).

## 2. Friction log

Categories: S syntax, M semantics, A assets, L layout, C comments, R round trip,
F feedback/debugging, D docs.

- **F1 [D,F] ids mandatory but undocumented.** AGENTS.md: add
  `{"name": ..., "value": 0}` / `{"name": ..., "items": []}`. Reality: pack fails with
  `Stage/scripts.ts:3:3: error: unknown var "score" (declare it in target.json first)`
  because reconcile needs a truthy `id` (`decls` pushes `id: ''`, lookup `if (!id)`
  errors). Had to mint 20-char uid strings by hand for every var/list (L3/L4/L5/L6/L6b).
  No `id` helper in CLI.
- **F2 [R,F] list serialization doubly broken.** `reconcile.ts` packs
  `lists[d.id] = [d.name, ...d.items]` → hand-written `items: []` becomes
  `["platforms"]` (no items array). Every list access then crashes the harness:
  `ok: false, error: "Cannot read properties of undefined (reading 'length')"`.
  `check` passes the malformed sb3 (no list-shape validation). Unpack side:
  `items: arr.slice(1)` wraps (`items: [[...]]`), which accidentally round-trips
  through the pack bug. Workaround used: write `items: [[...]]` in target.json
  (verified sb3 then holds `["platforms", [...]]` and `lengthOf`/`itemOf` work).
  Natural edits (`items: [1,2]`) would emit `["n",1,2]` — also corrupt.
- **F3 [R,D] no sprite delete/rename.** Renaming `Sprite1/` → `Cookie/` keeps the base
  target verbatim (`warning: target "Sprite1" not in directory; kept verbatim`) and the
  ghost's missing assets fail `check`. L3/L4/L5 each carry a hidden idle `Sprite1`.
  No documented delete/rename path (AGENTS.md covers only adding).
- **F4 [C,F] stacked comments silently dropped.** Two `//` groups separated by a blank
  line: the first group vanishes with no diagnostic (mint test: `'second note'`
  missing from sb3). Rule discovered by experiment: every group needs its own
  following statement.
- **F5 [C,R] `withComment(..., {anchor})` did not survive an edit.** The `@c3`
  reporter comment was reported `commentsLost` after only prepending blocks to the
  same script. Converting to statement-level `// @c3` + text reclaimed it
  (final L6: `commentsLost: 0`). Structural reporter matching vs anchors unclear.
- **F6 [C] extending an anchored comment counts as "lost".** `diff` compares text, so
  appending one line to `@c4`/`@c5` shows `commentsLost`. Workaround: keep original
  text byte-identical, put new notes on adjacent statements.
- **F7 [L] growth overlaps unhandled.** Added blocks widened a script into its neighbor
  (L6: 3 px by the 4 px margin — zero visual overlap, but score 100→85). Packer places
  only *new* scripts; no reflow or warning at pack time.
- **F8 [D] monitors are hand-edited JSON.** `showVariable()` emits only the block; the
  monitor row must be crafted in `agentwarp.json` (shape learned from fixtures).
  Undocumented; typo-prone (params use the var NAME, `spriteName: null` for globals).
- **F9 [F] crash gave no block context.** The list-shape crash surfaced as bare
  `ok: false` from `run`; required ~6 bisect runs (empty-target + mint projects) to
  isolate to `lengthOfList`. A blockId/frame in the error would have cut this to one.
- **F10 [M] eager double-jump consumption (my bug, fixed).** First design let a held key
  spend the air jump on the way up. Fixed with an `upHeld` edge-detect var. Noted as
  positive: the format made the fix trivial.
- **Non-issue [F+] tick every ~2 frames is inherent.** `x += 10` per tick advances every
  other virtual frame — byte-identical in fixture and rebuild (fidelity win, but it
  makes 2-frame key taps phase-fragile; holds + edge detection are the robust pattern).

AGENTS.md wrong/missing, itemized: id-less var/list declarations (F1); natural list
`items` shape (F2); sprite delete/rename (F3); monitor rows (F8); comment stacking +
`withComment` anchor limits (F4/F5); everything else I used (hats, operators,
`define`/`call` incl. warp, `block()` escape hatch, `wait` strings, broadcast
auto-creation, `target.json` + files for assets) worked as documented.

## 3. Ratings (1–5; vs editing raw `project.json`)

| axis | rating | note |
|------|--------|------|
| readability of existing projects | 5 | L6/L6b unpacks genuinely readable incl. Japanese names, procs, human comments |
| ease of writing | 4 | one-statement-per-script + expressions map well; −1 for id-minting + list wrap |
| error feedback | 3 | good file:line diagnostics; silent comment drops, unchecked list shapes, bare run crashes |
| round-trip fidelity | 3 | anchors/positions/comments excellent untouched; rename/delete impossible; F2/F5 |
| layout | 3 | positions preserved exactly; new-script placement OK; no growth reflow; margin-sensitive score |
| comments | 4 | attach/minimized/workspace all work; −1 for F4/F5/F6 |
| assets | 4 | drop-file + declare works; rotation centers manual but explicit |
| long-task suitability | 4 | real-project edits (L6/L6b) were productive; delete/rename + monitors slow multi-hour work |

Vs raw `project.json`: `ts` wins decisively on readability, diffs, and error locality
(no block-id bookkeeping, anchors preserve identity). Raw JSON wins only on total
power (sprite deletion, exact monitor bytes) — gaps a better tool would close.

## 4. Top improvements

FORMAT (`formats/ts/*` + AGENTS.md):
1. Fix list shape both directions (pack `[name, [...]]`, unpack `arr[1]`) so natural
   `items: [...]` edits work; document with an example.
2. Accept id-less var/list/broadcast declarations and mint ids (document the format).
3. Document monitors: `showVariable` ≠ monitor row; give the `agentwarp.json` shape.
4. Document sprite lifecycle: add/rename/delete (or a supported delete marker).
5. Document comment attachment (one group per statement, no stacking; `withComment`
   anchor limits) and warn on drop.

TOOL (`packages/core/*`, CLI, `vmrun`):
1. Mint missing variable/list ids automatically (or `--fix`), instead of erroring.
2. `check` must validate list shapes (`[name, array]`) — never emit run-crashing sb3s.
3. Support sprite deletion/rename (match by directory, or `"deleted": true`).
4. Growth-aware layout: warn at pack on new overlaps; offer reflow for new scripts.
5. Include blockId/target/frame in `run` crash errors; warn on dropped comments.
