# eval/fixtures — real-world Scratch projects

Downloaded from scratch.mit.edu via the public API (`project_token` flow) and
packed as `.sb3` with `node tools/vmrun/fetch-scratch.mjs <id> <out.sb3>`.
Used as L6 fixtures (explain / fix-an-injected-bug / add-a-feature) and to
exercise `vmrun check` / `run` on human-made projects.

All three are shared Scratch projects, licensed **CC BY-SA 2.0** per the
Scratch Terms of Use (all projects shared on the Scratch website are
distributed under Creative Commons Attribution-ShareAlike 2.0).

| file | id | title | author | sprites | blocks | comments |
| ---- | -- | ----- | ------ | ------- | ------ | -------- |
| `platformer-853110869.sb3` | 853110869 | PLATFORMER!! | goriraf0612 | 7 | ~1500 | 19 |
| `lightcube-134430880.sb3` | 134430880 | Lightcube Platformer | firstject | 24 | ~3000 | 7 |
| `scrolltutorial-378587848.sb3` | 378587848 | tutorial/game scrolling platform tutorial | unicorn9letsrock | 3 | ~140 | 11 |

Notes:

- `platformer-853110869` ("PLATFORMER!!", Japanese platformer): 8 targets,
  126 assets. Contains detached shadow blocks and dangling comment attachments
  (editor cruft) — `check` reports these as warnings, not errors.
- `lightcube-134430880` ("Lightcube Platformer", featured Dec 2016): 25
  targets, 177 assets, 67 monitors. Still runs headless (`run --seconds 5`
  exits 0).
- `scrolltutorial-378587848` (scrolling-platform tutorial, credits
  @griffpatch's tutorial series): small, comment-dense. Spawns clones
  aggressively at runtime (clone/broadcast spam) — `run` caps the event
  timeline at 20k entries (`hatsDropped`).

Verified: `node tools/vmrun/cli.mjs check eval/fixtures/*.sb3` → ok for all
three; `node tools/vmrun/cli.mjs run eval/fixtures/*.sb3 --seconds 5` →
exit 0 for all three.
