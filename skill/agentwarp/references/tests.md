# `agentwarp test` scenario files

One scenario (object) or several (array) per `tests/*.test.json`:

```json
{
  "name": "jump rises and lands",
  "seconds": 4,
  "seed": 1,
  "input": [{"frame": 5, "type": "keydown", "key": "space"},
            {"frame": 20, "type": "keyup", "key": "space"}],
  "until": "Player.y <= -100",
  "expect": [
    {"probe": "Player.y", "op": "<", "value": -60},
    {"at": 4, "probe": "Player.y", "op": "==", "value": 0},
    {"probe": "Stage.variables.level", "op": "==", "value": 2}
  ]
}
```

| field | meaning |
|---|---|
| `name` | shown in the table; `test <pattern>` matches `file + name` |
| `seconds` / `frames` | run length cap (`seconds` = `round(N*30)` frames; default 300) |
| `input` | array of input events (see `probes.md`) |
| `seed` | RNG seed (default 1; same seed = byte-identical run) |
| `until` | `--until` expression: stops the full-length run early |
| `expect` | list of `{at?, probe, op?, value}`; `op` defaults to `==` |

`at: <frame>` checks the state after exactly that many frames (a separate
short run); default `"end"` checks the final state (or where `until` stopped
the run — combine `until` only with `at: "end"` expects). A failing expect
prints `actual:` plus, for variable/list probes, the `file:line` of the
scripts that write it.

Run: `agentwarp test` (all), `agentwarp test clicker` (pattern),
`agentwarp test --json` (machine JSON on stdout; table still to stderr).
Exit 1 on any failure.
