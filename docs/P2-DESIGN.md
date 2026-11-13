# P2 design — lossless text projects for agents

Inputs: P1 reports (`eval/runs/*/REPORT.md`), calibration (`eval/calibration/`), ACP research.

## What P1 proved
- Only approaches that keep the original project.json as the base (raw-json, agentic-scratch) preserved
  human scripts/comments (diff: 0 moved, all comments kept). Compilers that regenerate everything
  (goboscript) destroyed ids, positions, comments, name case and even asset bytes.
- Writing is easiest in a code-like syntax (hikkaku/goboscript: L1/L2 first try), hardest in JSON
  (L5 = ~140 JSON blocks, brace hunts, wrong input names like OPERAND1 vs NUM1).
- Worst failures were SILENT: undeclared broadcasts no-op, broadcasts declared on a sprite never delivered,
  wrong input names → NaN at runtime, `$`-sigil miscompiles, cross-sprite variable refs.
- Recurring Scratch-semantics traps (lint material): `say` then `stop all` clears bubble; key/broadcast hats
  run in clones (clone bombs); hidden originals still collide; `= 0` checks skipped by multi-decrement;
  keypress timing vs game tick.
- Layout: everybody had to hand-place or post-process scripts; our size estimator is far off
  (mean err ~100–170 units).

## Architecture
```
packages/core/          (TypeScript, run directly by Node ≥ 23 type stripping; no build step)
  catalog/              opcode schema: shape, inputs (name, kind, shadow/menu opcode, default), fields, menus
  ir.ts                 format-independent tree IR (below)
  extract.ts            project.json target → IR (with source ids attached)
  reconcile.ts          IR + base project.json → new project.json (reuse ids/JSON of matched nodes)
  validate.ts           semantic checks → diagnostics with IR node → (file,line,col)
  lint.ts               Scratch-semantics warnings
  metrics.ts            rendered block size model (replicates scratch-blocks vertical renderer constants
                        + measured glyph widths); tested against eval/calibration/*.measured.json
  layout.ts             placement of new scripts/comments, overlap check, Clean-up-Plus replica
  assets.ts             costume/sound files ⇄ md5ext, never re-encode
  project-dir.ts        unpack/pack of the directory layout (format plug-in does script text)
formats/<name>/         print(IR) → text, parse(text) → IR + diagnostics   (prototypes: 3 candidates)
packages/cli/           `agentwarp` (later, P3)
```

### Project directory (format-independent except script files)
```
mygame/
  agentwarp.json            project meta: extensions, settings, monitors (only non-default), meta
  Stage/
    scripts.<ext>           every script + workspace comment of the target, in reading order
    target.json             variables, lists, broadcasts (Stage only), costumes/sounds list
                            (name, file, rotationCenterX/Y, bitmapResolution), layer/volume/tempo/etc
    costumes/<name>.<svg|png> sounds/<name>.<wav|mp3>     original bytes
  <SpriteName>/ … same, plus x/y/size/direction/visible/draggable/rotationStyle in target.json
  .agentwarp/               machine-managed, agents never edit
    base.json               last synced project.json (the reconcile base)
    anchors.json            per target: anchor label → top-level block id / comment id
    sourcemap.json          block id → file:line:col (written by pack, used by run/check output)
```
Unicode names are used verbatim for directories (sanitize only `/`, `\`, NUL, leading `.`; collisions →
suffix recorded in target.json `name`).

### IR
```ts
type Script = { anchor?: string; kind: 'stack'|'reporter'|'comment'; top?: Block; comment?: Comment; loc }
type Block  = { opcode: string; inputs: Record<string, Input>; fields: Record<string, Field>;
                mutation?: object; comment?: Comment; next?: Block; srcId?: string; loc }
type Input  = { kind:'literal', value: string|number, litType?: 4..10 }
            | { kind:'menu', value: string }                 // shadow menu block (e.g. motion_goto_menu)
            | { kind:'block', block: Block }                 // reporter/boolean dropped in
            | { kind:'stack', block?: Block }                // SUBSTACK etc
            | { kind:'var'|'list'|'broadcast', name: string }
type Comment = { text: string; anchor?: string; minimized?: boolean; loc }
```
Variables/lists are referenced by NAME in IR/text; resolution to ids happens in reconcile using target
then Stage tables. Broadcasts are always declared on the Stage (auto-create when new). Procedure calls
reference the proccode; definitions carry argument names and warp.

### Reconcile (the core of losslessness)
1. Parse text → IR scripts. Scripts with an anchor are matched to the base script with that anchor
   (anchors are short labels the printer emits; agents keep them, new scripts have none).
   Duplicate anchors: first wins, rest treated as new.
2. Match nodes top-down: same opcode (+ same proccode/menu for procedures) → reuse base id. Statement
   sequences matched with LCS on opcode so inserting/removing a block keeps the ids of the rest.
   Matched AND structurally identical subtree → copy base JSON verbatim (byte-preserving: literal
   types, obscured shadows, odd real-world cruft stay as they were).
3. Changed literals update the shadow in place; reporters dropped over a shadow keep the shadow
   (obscured shadow, like Scratch). Removed reporter → shadow becomes visible again.
4. New nodes get fresh ids (Scratch-style 20-char ids); shadows/menus are created from the catalog.
5. Comments: attached comment matched by (anchor | owning block) keeps id/x/y/size/minimized; new
   attached comments are placed right of the owning script's bbox at the block's y; workspace comments
   keep position by anchor; new ones are placed by layout.
6. Positions: untouched/edited anchored scripts keep x/y. New scripts are placed by layout in free space
   (below the lowest script of the target's main column, Clean-up-Plus spacing: 72 gap, x aligned), never
   overlapping. `cleanup` (explicit command) re-lays the whole target like TurboWarp's Clean up Plus.
7. Unchanged target → base target JSON copied verbatim. Unchanged project → output byte-identical.

### Validation (errors, with file:line:col)
unknown opcode / block text; wrong input names or arity; unknown variable/list (suggest nearest), variable
of another sprite; costume/sound/backdrop/sprite name in a menu that doesn't exist; procedure call that
doesn't match a definition; duplicate procedure definitions; reporter in a stack slot and vice versa.
### Lint (warnings)
broadcast never received / receiver for never-sent broadcast; `say`/`think` immediately followed by
`stop all`; key-press / broadcast hats in a sprite that clones itself; `when I start as a clone` without
`delete this clone` path in loops spawning clones; `= 0` test on a variable only changed by `change by -n`
(suggest `< 1`); hidden sprite used in `touching`.

### Readability aids (CLI later, cheap to do on IR)
`summary` (per target: scripts with first line, vars, broadcasts sent/received), broadcast graph,
`grep`-friendly text, block ids in runtime errors mapped to file:line.

## Format candidates (P2b, prototype all three on the same IR)
- **A scratchblocks** (`scripts.sb`): forum/Wiki scratchblocks syntax (English; translations possible later).
  `// text` after a block = attached comment. Script header line `@a3` style anchor. Hard part: parsing
  needs the block catalog's text templates; reuse the `scratchblocks` npm parser if suitable.
- **B TypeScript subset** (`scripts.ts` + generated `project.d.ts`): parsed with the TypeScript compiler
  API, never executed. Typed declarations give agents tsc errors + editor completion for free (costume
  names, variable names, broadcast names as string-literal unions). `//` comments attach to the statement.
  Anchors as `// @a3` before a script. Custom blocks as `define("jump %n", (h) => {...})` / functions.
- **C Python-like** (`scripts.sbpy`): indentation-based (no brace balancing), `when flag clicked:` style
  hats, `# text` comments attached to the line, `@a3` anchors.

Each prototype must pass: lossless round trip (unpack → pack with no edits == base, byte-identical) on all
fixtures in eval/fixtures, tools/vmrun/test-fixtures, eval/runs/*/L*/out.sb3; edit tests (change a literal,
insert a block, add a script, add a comment) preserving untouched ids/positions (vmrun diff); and all
L1–L6 tasks done by a fresh agent using only the format's AGENTS.md (P2c).
