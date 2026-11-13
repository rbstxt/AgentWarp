#!/usr/bin/env python3
"""WORKAROUND (L6 task d + comment preservation).

goboscript `#` comments are stripped at compile time and sb2gs drops all 11
human comments on import, so Scratch comments cannot be authored or preserved
in `.gs` source. This post-build patch injects them into out.sb3:

1. Restores the 11 original comments as workspace comments (blockId=None,
   since the blocks they were attached to no longer exist) at their original
   x/y coordinates.
2. Adds 5 new comments for the new/changed scripts (pause toggle, tick,
   landing reset, game_on reset, PAUSED sign), placed right of each script.

Idempotent: removes previously injected comments (id prefix `l6`) first.
Cost: must re-run after every build; positions hand-maintained; new-script
positions must be re-read from the build (see NEW_COMMENTS).
"""
import json
import os
import zipfile

SB3 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out.sb3")

ORIGINAL_COMMENTS = [
    # (target, x, y, w, h, text) — exact original rects, except l6restored8
    # nudged x -188.4 -> -210: the repositioned position-proc script would
    # otherwise overlap it (scripts moved, comments did not).
    ("player", 637.78, -42, 200, 200,
     "this code needs the play game code and the change player x by sx code to work"),
    ("player", 280.56, -86.48, 200, 200, "this makes everything run!"),
    ("player", 1007.01, -220.19, 200, 200, "this sets all the variables to 0"),
    ("player", 1394.37, -298.41, 200, 200, "this tells it to start"),
    ("player", 1537.52, 46.70, 200, 200, "this is the position"),
    ("player", 1228.61, 364.48, 200, 200, "this is wall detection"),
    ("player", 382.01, 526.74, 200, 200, "this is so it stays on top of the ground"),
    ("player", 586.97, 190, 200, 200, "this makes it move and gives it gravity!"),
    ("platforms", -210, 620, 200, 200, "this makes it scroll"),
    ("platforms", 594.75, 512, 200, 200,
     "this makes the level show when its on the screen and hide when its off"),
    ("platforms", 339.79, 279, 200, 200, "this is the position of the platforms"),
]

NEW_COMMENTS = [
    # (target, x, y, text) — x = script right edge + 20, y = script top.
    ("player", 356, 1240,
     "CHANGED (goboscript): pause gate + jump 17 -> 25.5 (1.5x) + double jump "
     "(max 2 air jumps, rising-edge triggered)."),
    ("player", 237, 2504,
     "CHANGED (goboscript): landing also resets the double-jump counter."),
    ("player", 223, 3288,
     "CHANGED (goboscript): also resets jumps, up_held and paused."),
    ("player", 244, 224,
     "NEW (goboscript): pressing P toggles pause; while paused the player "
     "does not move and the PAUSED sign is shown."),
    ("PausedSign", 200, 0,
     "NEW (goboscript): shows the PAUSED sign while paused == 1."),
]


def main():
    with zipfile.ZipFile(SB3) as z:
        names = z.namelist()
        project = json.loads(z.read("project.json"))
        others = {n: z.read(n) for n in names if n != "project.json"}
    for t in project["targets"]:
        t.setdefault("comments", {})
        t["comments"] = {cid: c for cid, c in t["comments"].items()
                         if not cid.startswith("l6")}
    # Strip goboscript's injected Stage boilerplate (logo + twconfig): they are
    # not part of the human project and would otherwise pollute the diff.
    stage = next(t for t in project["targets"] if t["name"] == "Stage")
    stage["comments"] = {cid: c for cid, c in stage["comments"].items()
                         if cid not in ("notes", "twconfig")}
    def add(target_name, cid, x, y, w, h, text):
        t = next(t for t in project["targets"] if t["name"] == target_name)
        t["comments"][cid] = {"blockId": None, "x": x, "y": y,
                              "width": w, "height": h,
                              "minimized": False, "text": text}
    for i, (target, x, y, w, h, text) in enumerate(ORIGINAL_COMMENTS):
        add(target, f"l6restored{i}", x, y, w, h, "[restored human comment] " + text)
    for i, (target, x, y, text) in enumerate(NEW_COMMENTS):
        add(target, f"l6new{i}", x, y, 280, 80, text)
    with zipfile.ZipFile(SB3, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in others.items():
            z.writestr(n, data)
        z.writestr("project.json", json.dumps(project).encode())
    print(f"injected {len(ORIGINAL_COMMENTS) + len(NEW_COMMENTS)} comments into {SB3}")


if __name__ == "__main__":
    main()
