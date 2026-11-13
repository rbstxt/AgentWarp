# P3 decision — primary text format: `ts`

Fresh Muse agents did L1–L6b with only AGENTS.md + `bin/agentwarp` (eval/p2c/*/REPORT.md). All three formats
passed every task; all outputs pass `check`.

| | ts | sbpy | scratchblocks |
|---|---|---|---|
| total attempts L1–L6b | **18** | 24 | 21 |
| readability (1–5) | **5** | 4 | **5** |
| ease of writing | **4** | **4** | 3 (paren counting) |
| error feedback | 3 | **5** | 4 |
| long-task suitability | **4** | **4** | 3 |
| extra | tsc type-check: costume/sound/var/broadcast typos are compile errors, editor completion | exact opcode names, verbose | closest to what humans see in Scratch |

Decision: **`ts` is the primary agent format** (default for `new`/`unpack`, documented in the skill).
`scratchblocks` stays supported as the human-facing view (diff previews in the side panel, explanations),
`sbpy` stays as a tested alternative. All share the same core, so fixes land once.

Cross-format friction to fix in P3 (from all three reports):
- id-less declarations: variables/lists/broadcasts declared in target.json without `id` → mint ids
- sprite lifecycle: add / rename / delete a sprite by directory + target.json
- monitors + lists documented (and list shape validated by `check`)
- CLI hygiene: diagnostics → stderr, JSON → stdout; run errors mapped to file:line via sourcemap
- pack reports NEW overlaps; explicit `tidy` (Clean up Plus) command
- core lint (say+stop all, hats in cloned sprites, unreceived broadcasts, `= 0` on decrementing counters…)
- core APIs the bridge had to wrap: pack against a given base, unpack into an existing dir, stable anchors
