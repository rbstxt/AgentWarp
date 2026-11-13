# `run` input events and probes

Same vocabulary for `agentwarp run --input/--probe/--until` and for
`agentwarp test` scenario files (`input`, `expect[].probe`, `until`).

## Input events (`--input file.json` / scenario `input`)

A JSON array (or `{inputs: [...]}`) of events, applied at the given
0-based frame:

```json
[
  {"frame": 0, "type": "keydown", "key": "ArrowRight"},
  {"frame": 30, "type": "keyup", "key": "ArrowRight"},
  {"frame": 5, "type": "click", "sprite": "Cookie"},
  {"frame": 10, "type": "mouse", "x": 100, "y": -50, "isDown": true},
  {"frame": 20, "type": "broadcast", "name": "start"},
  {"frame": 30, "type": "greenflag"},
  {"frame": 40, "type": "stop"},
  {"frame": 2, "type": "answer", "text": "Ada"}
]
```

- `keydown`/`keyup`: `key` accepts Scratch menu names (`space`, `left arrow`,
  `right arrow`, `up arrow`, `down arrow`, single letters) or DOM names
  (`Enter`, `ArrowLeft`, …). Fires `when key pressed` hats and `<key pressed?>`.
- `click`: fires `when this sprite clicked` on `sprite` (original preferred;
  `"Stage"` clicks the stage). Optional `x`/`y` moves the mouse first.
- `mouse`: sets mouse position (Scratch coords) and/or button state; drives
  `mouse x/y`, `<mouse down?>`, `touching [mouse-pointer]`.
- `broadcast`: injects a delivery: every matching `when I receive` hat starts.
- `greenflag` / `stop`: click the flag / stop sign mid-run (the clock keeps
  stepping so later inputs still apply).
- `answer`: types into `ask … and wait` and confirms (without it, `ask`
  blocks forever).

Keys are held between `keydown` and `keyup`: single-frame taps are fragile
(the game tick may run every ~2nd frame); holds + edge detection are robust.

## Probes (`--probe A.B.C` / `expect[].probe` / `--until`)

Dot paths resolved against the run output JSON:

- `Sprite1.x`, `Sprite1.y`, `direction`, `size`, `visible`,
  `costumeIndex`, `costumeName`, `bubble.text`
- `Sprite1.variables.score`, `Stage.score` (Stage variables may omit
  `.variables`), `Sprite1.lists.items`
- `clones.Ball` (live clone count), `broadcasts.0.name`,
  `monitors.<id>.value`, `hats.0.hat`, `sayEvents.0.text`

Missing paths resolve to `null` (the test fails with `actual: null`).

## Comparisons (`expect[].op`, `--until`)

`==` (`=` also works), `!=`, `<`, `<=`, `>`, `>=`. Values are JSON:
numbers compare numerically, everything else by string equality.
`--until "<probe> <op> <value>"` needs `--max-frames N` (or
`--frames`/`--seconds`) as the cap and stops the run early when the probe
holds; the output gains `until: {expression, met, frame, value}`.
