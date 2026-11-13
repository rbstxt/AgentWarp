---
name: agentwarp
description: Work on Scratch projects as text with the agentwarp CLI (unpack/new, check, run, test, serve). Use for any task that edits a Scratch project from its unpacked text directory — game features, bug fixes, multi-hour iterations, or live collaboration with a human in TurboWarp.
---

# agentwarp — Scratch as text

The project directory is a text mirror of an `.sb3`. Edit text, pack back
with the CLI. Never hand-edit `.agentwarp/` (machine-managed: base, anchors,
sourcemap) and never edit the packed `.sb3` directly.

## 0. Setup

```sh
bin/agentwarp unpack game.sb3 proj/     # existing project (default format: ts)
bin/agentwarp new proj/                 # fresh project (Stage + cat sprite)
cd proj
```

`new`/`unpack` write `AGENTS.md` + `CLAUDE.md` into the project dir. The
format reference lives in the agentwarp repo at `formats/<F>/AGENTS.md`
(`ts` is the default and primary format). `bin/agentwarp help` lists commands.

## 1. Orient first

- Read the project `AGENTS.md`, then `<Target>/scripts.ts` for the sprites you
  will touch, plus `agentwarp.json` (extensions, monitors) when UI state matters.
- Run `bin/agentwarp check` once before changing anything: it must be clean
  (or know exactly which warnings are pre-existing).

## 2. Plan with a todo list

Long tasks die without a plan. Keep an explicit todo list (your agent's
task tracker): one entry per feature/fix, each with its probe or test. Work
the list top to bottom; check items off only when a test proves them.

## 3. The loop: small edit → check → run/test → fix

Keep every edit small — one script or one feature at a time.

```sh
bin/agentwarp check                     # parse + validate + lint + tsc; file:line:col on stderr
bin/agentwarp run --frames 600 --probe Player.x --probe Stage.score
bin/agentwarp run --until "Player.variables.hp <= 0" --max-frames 1800
bin/agentwarp test                      # runs tests/*.test.json (see below)
```

- `check` failing means the sb3 is untrustworthy: fix before running.
- Prefer `run --until "<probe> <op> <value>"` over long fixed-frame runs;
  it stops early and reports the frame where the condition met.
- Probes read the final state (`Player.x`, `Stage.score`,
  `clones.Enemy`, `broadcasts.0.name`, `monitors.<id>.value`). Full input
  event + probe vocabulary: `references/probes.md`.
- Look at the result: `bin/agentwarp shot --frames 90 --at 0,45,89 [--input in.json] [--gif]`
  renders the stage with the real Scratch renderer and prints the PNG/GIF paths (stderr) — open
  them with your image-reading tool. `shot` also uses pixel-accurate `touching` (headless `run`
  uses bounding boxes), so when collision results matter, confirm with `shot`'s final state.
  Use probes for exact numbers, `shot` for "does it look right" (layout, overlap, bubbles, pen).
  If a probe disagrees with your mental model, believe the probe.

## 4. Write tests for every feature

Every feature or fix gets a scenario file `tests/<name>.test.json`:

```json
{
  "name": "player scores on click",
  "frames": 120,
  "input": [{"frame": 0, "type": "greenflag"}, {"frame": 10, "type": "click", "sprite": "Cookie"}],
  "expect": [
    {"probe": "Stage.variables.score", "op": "==", "value": 1},
    {"at": 5, "probe": "Cookie.x", "op": ">", "value": 0}
  ]
}
```

- `seconds` works instead of `frames`. `at: <frame>` checks state after that
  many frames (default `"end"`). `input` uses the same events as `run --input`.
- `agentwarp test [pattern]` packs once and runs all scenarios; failures show
  actual values and the `file:line` of the scripts that write the probed
  variable/list. Table to stderr, `--json` for machine JSON on stdout.
- Full schema: `references/tests.md`.

## 5. Scratch gotchas (will bite)

- `broadcast` with no receiver is a silent no-op; names must match exactly.
- `stop all` clears `say`/`think` bubbles.
- Key-press and broadcast hats also fire in **clones** (clone bombs): create
  clones from another sprite, or gate on `when I start as clone`.
- Hidden originals still collide with `touching`.
- A variable only decremented by `change by -n` can skip `= 0` — test `< 1`.
- Green-flag scripts all run concurrently; thread order is schedule-sensitive.
  Prefer edge detection (key held across frames) over single-frame taps.
- Custom blocks (`define`/`call`) are sprite-local. Variables/lists are
  visible only to their own sprite plus Stage globals — cross-sprite reads
  are `check` errors; use `attributeOf("x position", "Sprite")` for
  position/costume/size/volume reads.
- Menus use stored values (`"_myself_"`, `"_mouse_"`, `"_edge_"`), not labels.

## 6. Working with a human in TurboWarp (`serve`)

`bin/agentwarp serve` live-syncs the text dir with an open TurboWarp editor:

- Do **not** fight concurrent edits: keep diffs small, one script at a time.
- The bridge rewrites files under you (positions, anchors): **re-read a file
  after the bridge touches it** before your next edit.
- Never touch `.agentwarp/` while serving; never force-push a full rewrite.
- If the human is play-testing, use short `run --until` probes locally first,
  then let them confirm in the editor.
