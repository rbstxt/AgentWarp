#!/usr/bin/env python3
"""WORKAROUND: goboscript emits `data_showvariable` but writes no entry in
project.json `monitors`, so the variable checkbox stays unchecked in the
editor and vmrun's monitors dump stays empty.

This post-build patch injects the monitor record into out.sb3.
Cost: must re-run after every build; hand-maintained ids/format that can
drift from what the Scratch editor writes.
"""
import json
import os
import sys
import zipfile

SB3 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out.sb3")


def main(var_name="score", sprite_name=None):
    with zipfile.ZipFile(SB3) as z:
        names = z.namelist()
        blob = z.read("project.json")
    project = json.loads(blob)
    var_id = None
    for t in project["targets"]:
        for vid, (name, _val) in t.get("variables", {}).items():
            if name == var_name and (sprite_name is None or t["name"] == sprite_name):
                var_id = vid
    if var_id is None:
        sys.exit(f"variable {var_name!r} not found")
    project.setdefault("monitors", [])
    project["monitors"] = [m for m in project["monitors"] if m.get("id") != var_id]
    project["monitors"].append({
        "id": var_id,
        "mode": "default",
        "opcode": "data_variable",
        "params": {"VARIABLE": var_name},
        "spriteName": None,
        "value": 0,
        "width": 0,
        "height": 0,
        "x": 5,
        "y": 5,
        "visible": True,
    })
    # rewrite preserving all other entries byte-for-byte
    with zipfile.ZipFile(SB3) as z:
        items = [(n, z.read(n)) for n in names if n != "project.json"]
    with zipfile.ZipFile(SB3, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in items:
            z.writestr(n, data)
        z.writestr("project.json", json.dumps(project).encode())
    print(f"injected monitor for variable {var_name!r} (id {var_id})")


if __name__ == "__main__":
    main(*sys.argv[1:])
