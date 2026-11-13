# P1 report — approach "hikkaku" (TypeScript authoring, `hikkaku@0.3.5` + `bun`)

Method: authored L1–L5 in TypeScript per the hikkaku skill rules
(`packages/skill/hikkaku/{SKILL.md,rules/**}` in `pnsk-lab/hikkaku`),
built with a hand-rolled packer (`shared/pack.ts`), verified with
`tools/vmrun`. hikkaku has **no sb3 import**, so L6/L6b are JSON surgery
(`L6/operate.ts`, `L6b/operate.ts`) with a throwaway disassembler
(`shared/disasm.ts`). No git commits made.

## 1. Result table

| task | result | attempts | main failure causes |
| ---- | ------ | -------- | ------------------- |
| L1 hello | pass (x==10, bubble "Hello!") | 1 | none |
| L2 keys+bounce | pass (x=150 ≥100; Ball in ±220/±160 over 600f) | 1 | none |
| L3 clicker | pass (score=10, backdrop win, monitor visible) | 3 | hikkaku emits undeclared broadcasts → `event_broadcast` silently no-ops (fix: `pack.ts` declares + rewrites ids) |
| L4 shooter | pass (fire run: score=57, clones ≤5; no-input: lives 0 → Game Over costume, stop) | 5 | hidden originals still collide; `say`+`stop all` clears bubble; key-hats fire on clones (clone bomb); needed aimed spawns + dense fire |
| L5 platformer | pass (lands y=-110 stable; jump rises; level list swaps; warp custom block; layout 100) | 4 | cross-sprite var refs pass hikkaku build but fail `check`; spawn clipped platform edge; fixed 260px layout stride → 9 overlaps (fix: `restack.ts`) |
| L6 scrolltutorial edit | pass (pause freezes + PAUSED; jump 1.5× + double jump; diff 0 moved/0 deleted; layout 100) | 4 | pause gate must sit inside the per-frame repeat, not just loop head; jump probes need tick-aware input timing |
| L6b platformer edit | pass (タイム 0→6 in 7s, monitor visible; reset on stage advance verified; diff Stage-only +2 scripts, 0 new overlaps) | 3 | reset-on-death design rejected after observing `huhh0` spam pins timer at 0 |

Layout scores (`vmrun layout`, hikkaku-native unless noted):
L1 100, L2 100, L3 100, L4 70 (2 overlaps, tall scripts), L5 0 → 100 via
`restack.ts` workaround, L6 100, L6b 42 overlaps = fixture's own 42 (0 added).

## 2. Friction log

**Syntax/representation**
- F1. Cross-sprite variable reads typecheck and build fine, emit plausible
  JSON, and only `vmrun check` complains:
  `{"target":"Painter","blockId":"124","opcode":"data_variable","message":"variable field references undeclared id \"asset-7\""}`.
  hikkaku should reject this at build time (Scratch forbids it). Cost: one
  wasted build + moving `cameraX` to Stage. (L5, attempt 2)
- F2. Reporter-type friction: `getItemOfList()` returns a `string|number`
  reporter, so arithmetic needs `as never` casts everywhere
  (`add(getVariable(rx), divide(getVariable(rw), 2))`). Bun doesn't typecheck
  so it runs, but `tsc` would refuse. The skill never mentions this. (L5)
- F3. `defineProcedure` must be called inside a hat in the skill examples, yet
  `procedures_definition` hats get **no position** (left at 0,0, overlapping
  everything) — the auto-layout skips them. (L5, layout 0)

**Scratch semantics (learned the hard way; same traps in any tool)**
- F4. Hidden originals still collide with `touching`. No-input L4 run scored
  46 with zero bullets fired — enemies died on the hidden Bullet parked at
  (0,0). Fix: park originals off-play ((230,200), (−230,200)). (L4, attempt 2)
- F5. `when key pressed` fires on clones too: 120 space presses → 5327
  `control_start_as_clone` starts, 203 live bullets (exponential fork bomb).
  Fix: fire button lives on the never-cloned Player. (L4, attempt 3)
- F6. `say` + `stop all` in one script → no bubble (minimal repro confirmed;
  matches real-Scratch stop-clears-bubbles). Fix: show a GAME OVER costume,
  probe that. (L4, attempt 2)

**Assets**
- F7. `toScratch()` references default costumes/sounds by assetId but ships
  zero bytes; the only assembler is `vite build`. Custom assets need
  hand-rolled md5 + `_data` (undocumented — found by reading the vite plugin
  source). My `pack.ts` fetches missing bytes from the Scratch CDN (build
  needs network) and rewrites assetId/md5ext. A costume-less sprite emits no
  `md5ext` at all (invalid sb3). (L2/L3, setup)
- F8. `rotationCenterX/Y` never set by hikkaku; I default them in
  `svgCostume()`. (setup)

**Layout/positions**
- F9. Auto-layout = fixed stride (x=64, y=72+260i) per `run()` call, no height
  awareness, no API to set positions, scripts from separate `run()` calls
  restart the counter. L4 scores 70 (2 overlaps), L5 scored 0 (9 overlaps,
  incl. the (0,0) procedure definition and my injected comments). Workaround:
  `shared/restack.ts` re-stacks using `vmrun layout` bboxes (→100). A real
  tool should do this itself. (L4/L5)

**Comments**
- F10. hikkaku always emits `comments: {}` — no comment API at all
  (workspace or block-attached). L5's "comments explaining each script" and
  L6's "add a comment to each new/changed script" were done by JSON injection
  in `pack.ts`/`operate.ts`. (L5/L6)

**Import/round trip**
- F11. No sb3 import (as the brief warned). L6/L6b cost: wrote a disassembler
  (`shared/disasm.ts`), hand-traced block ids/parents/SUBSTACK chains, managed
  id uniqueness and `parent`/`next` back-pointers by hand
  (`L6/operate.ts` ~150 lines, `L6b/operate.ts` ~120). One self-inflicted
  warning (`parent ... does not reference this block back`) caught by `check`.
  Round-trip fidelity is therefore 0% via hikkaku — every preserved
  id/position/comment in the diff is thanks to bypassing hikkaku. (L6/L6b)

**Feedback/debugging**
- F12. Silent broadcast drop (the worst one): `BROADCAST_INPUT: [1, [11,
  "win", "win"]]` with empty `broadcasts: {}` makes scratch-vm's
  `lookupBroadcastMsg(id)` fail, so `event_broadcast` **does nothing** — build
  ok, `check` ok, run ok, `hats`/`broadcasts` just show `name: ''`. Found only
  by diffing run output against a real fixture (`[11, name, real-id]` +
  declared map). `pack.ts` now declares every broadcast on the Stage and
  rewrites ids. hikkaku should do this or error. (L3, attempts 2–3)
- F13. Jump-timing confusion: a 1-frame keypress can fall between slow game
  ticks and be missed entirely; a 2-frame press double-fires. Probes must be
  designed around tick rate, and peak-height ratios (≈2.09× theory) don't
  match naively because of it. Verdicts below use shape evidence (second rise
  after frame 55, 287 vs 79/226) plus the exact 17→25.5 code change. (L6)

**Documentation**
- F14. Skill rules (`physics.md`, block refs) are genuinely good for L1–L5
  patterns, but undocumented: broadcast declaration requirement, `_data`/md5
  custom-asset flow, multi-`run()` layout behavior, `getItemOfList` typing,
  key-name conventions (DOM `'ArrowRight'` for harness input vs Scratch
  `'right arrow'` vs hat `'p'`).

## 3. Ratings (1–5, one line each)

- Readability of existing projects: **1** — no import; raw project.json only (+ my throwaway disassembler).
- Ease of writing: **4** — pleasant TS authoring, good skill recipes; operator-block math is verbose.
- Error feedback quality: **2** — `check` catches structural errors, but hikkaku itself fails silently (broadcasts, cross-sprite refs, layout).
- Round-trip fidelity: **1** — nothing round-trips; L6/L6b preservation is 100% manual surgery.
- Layout quality: **2** — fine for tiny scripts; fixed stride overlaps tall ones, definitions at (0,0), no API.
- Comment support: **1** — nonexistent.
- Asset support: **2** — built-ins by magic id (network at build); custom assets DIY.
- Long-task suitability: **2** — could iterate for hours on small from-scratch projects; big-project work is unmaintainable surgery with silent-failure risk.

## 4. Top 5 things a better tool should do

1. **Lossless sb3 import/export** (ids, positions, comments, assets,
   monitors, broadcast maps) — the single blocker for existing projects.
2. **Comments as first-class text** (workspace + block-attached, readable and
   writable).
3. **Build-time validation with file:line errors**: undeclared broadcasts,
   cross-sprite variable refs, orphan blocks — never emit silently-broken sb3.
4. **Height-aware auto-layout + position control**: keep human placements,
   stack new/edited scripts without overlap (fix the 260px stride, place
   procedure definitions).
5. **Offline asset pipeline**: `import ./cookie.svg` computing md5/bytes (like
   the vite `?scratch` plugin but for plain build scripts), custom WAVs
   without hand-rolled encoders.
