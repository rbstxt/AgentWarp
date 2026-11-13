# P2b brief — text format prototype

Read first: docs/P2-DESIGN.md, packages/core/ir.ts (IR + Format interface; `FormatCtx.targetJson` gives
the target's variables/lists/broadcasts/costumes/sounds), packages/core/catalog/index.ts (block specs with
`text.en` templates, inputs, fields, menus), formats/ir-json/index.ts (trivial reference Format),
packages/core/project-dir.ts (`unpackSb3`, `packDir`), packages/core/test/*.test.ts (how round trip is tested),
eval/runs/*/REPORT.md friction logs (what agents get wrong).

You own ONLY `formats/<name>/` (TypeScript run directly by Node 26: erasable syntax only, explicit `.ts`
imports; local package.json for any dependency). Never edit packages/core — if core has a bug or you need an
API change, describe it precisely in your final message. Do not git commit.

## The format must
1. Be pleasant for an LLM agent to read AND write: one block per line, nesting visible, names verbatim
   (Unicode, spaces, quotes escaped sensibly), no ids in the text. Anchors (`a1`, `c3`, from `Script.anchor`
   / `Comment.anchor`) must appear in a light, unobtrusive way the agent can leave alone; new scripts are
   written without anchors.
2. Cover the whole IR: every catalog opcode (plus a generic escape syntax for unknown/extension opcodes and
   opaque mutations so nothing is ever lost), literal inputs (keep `litType` when it differs from the
   catalog's default shadow, e.g. a number typed into a text slot), menus, variables/lists/broadcasts by
   name (a variable and a reporter block with the same text must be distinguishable), procedures
   (definition with args, boolean args, warp; calls; argument reporters), attached comments (multi-line
   text, minimized flag), workspace comments, top-level reporters, empty C-block bodies, if/else.
3. Round trip: for EVERY sb3 in eval/fixtures/, tools/vmrun/test-fixtures/, eval/runs/*/L*/out.sb3:
   `unpackSb3` with your format → `packDir` → project.json byte-identical to the original; and
   print(parse(print(ir))) === print(ir). This is non-negotiable; iterate until 100%.
4. Edit tests that manipulate the TEXT like an agent would (string edits on the scripts file, not IR):
   change a literal, insert a block, wrap blocks in `if`, delete a block, add a new script with an attached
   comment, add a workspace comment, add a custom block definition + call, in a Japanese-named sprite of
   eval/fixtures/platformer-853110869.sb3 → pack → `diffProjects` (tools/vmrun/lib/diff.mjs) shows only
   the edited script changed, comments kept; `node tools/vmrun/cli.mjs check` passes.
5. Parse errors are diagnostics with file/line/col and a helpful message: unknown block text →
   "did you mean …" (nearest catalog templates), unbalanced nesting, unknown variable (nearest names from
   targetJson), wrong input kind.
6. Tests: `formats/<name>/test/*.test.ts` (node:test). Run with `node --test "formats/<name>/test/*.test.ts"`.
7. `formats/<name>/AGENTS.md`: the complete guide an agent gets to work with this format — syntax with
   examples for every construct, how anchors/comments work, how to add sprites/costumes/sounds/variables
   (target.json + files), the Scratch gotchas list from docs/P2-DESIGN.md "Lint", and a cheat sheet of the
   most used blocks. Keep it compact (an agent should read it in one go).
8. `formats/<name>/examples/`: L1 and L4 (eval/tasks/README.md) written in the format, packed and verified with
   vmrun (put the sb3 next to them).

Final message: syntax summary (10 lines with a real example), round-trip results (n/n byte-identical),
edit test results, known ambiguities/limitations, any core changes needed.
