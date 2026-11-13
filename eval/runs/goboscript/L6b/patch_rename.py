#!/usr/bin/env python3
"""WORKAROUND (L6b).

1. goboscript identifiers are ASCII-only, so a variable literally named
   タイム cannot be authored in `.gs`. The sources use `taimu`; this patch
   renames the variable (display name in `variables` + every VARIABLE field)
   to タイム after building. The variable id stays `taimu` (ids are opaque).
2. goboscript emits `show taimu` but no project.json `monitors` entry, so the
   monitor would stay hidden in the editor (same gap as L3). Inject it here.
3. goboscript `#` comments do not round-trip (same gap as L5/L6): attach the
   new/changed-script comments here.
4. Strip goboscript's Stage boilerplate comments (logo + twconfig).

Idempotent: skips work already applied. Must re-run after every build.
"""
import json
import os
import zipfile

SB3 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out.sb3")
SRC, DST = "taimu", "タイム"


ORIGINAL_COMMENTS = [
 [
  "いんとぅるえんぎね",
  181.36,
  -263.85,
  200,
  200,
  "FOR ALL SPRITES! This variable is used to change the direction of the camera (try changing the sliders)"
 ],
 [
  "いんとぅるえんぎね",
  178.1,
  -48.15,
  200,
  200,
  "FOR ALL SPRITES! This variable is used to set the x position of the camera (try changing the sliders)"
 ],
 [
  "いんとぅるえんぎね",
  173.65,
  174.96,
  200,
  200,
  "FOR ALL SPRITES! This variable is used to set the y position of the camera (try changing the sliders)"
 ],
 [
  "いんとぅるえんぎね",
  176.33,
  404,
  200,
  200,
  "FOR ALL SPRITES! This variable is used to set the Z position (size) of the camera (try changing the sliders)"
 ],
 [
  "いんとぅるえんぎね",
  180.78,
  627.11,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable is used to set the direction of each INDIVIDUAL clone."
 ],
 [
  "いんとぅるえんぎね",
  171.59,
  856.15,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable is used to set the x position of each INDIVIDUAL clone. Not according to the camera"
 ],
 [
  "いんとぅるえんぎね",
  177.52,
  1095.56,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable is used to set the y position of each INDIVIDUAL clone. Not according to the camera"
 ],
 [
  "いんとぅるえんぎね",
  172.78,
  1340.89,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable is used to set the z position (size) of each INDIVIDUAL clone. Not according to the camera"
 ],
 [
  "いんとぅるえんぎね",
  3750.93,
  794.37,
  434.073974609375,
  148.14813232421875,
  "This is the block that positions the clones. It uses some trigonometry, and I dont fully understand how it works, but you can view some of @MathMathMath's tutorials for more info"
 ],
 [
  "いんとぅるえんぎね",
  181.29,
  -264,
  200,
  200,
  "FOR ALL SPRITES! This variables controls the direction of the \"camera\"."
 ],
 [
  "いんとぅるえんぎね",
  177.62,
  -48,
  200,
  200,
  "FOR ALL SPRITES! This variables controls the x position of the \"camera\"."
 ],
 [
  "いんとぅるえんぎね",
  173.62,
  175,
  200,
  200,
  "FOR ALL SPRITES! This variables controls the y position of the \"camera\"."
 ],
 [
  "いんとぅるえんぎね",
  176.33,
  404,
  200,
  200,
  "FOR ALL SPRITES! This variables controls the z position (size) of the \"camera\"."
 ],
 [
  "いんとぅるえんぎね",
  180.67,
  627,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable controls the direction of each INDIVIDUAL clone"
 ],
 [
  "いんとぅるえんぎね",
  172,
  856,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable controls the x position of each INDIVIDUAL clone"
 ],
 [
  "いんとぅるえんぎね",
  178,
  1096,
  200,
  200,
  "FOR THIS SPRITE ONLY! This variable controls the y position of each INDIVIDUAL clone"
 ],
 [
  "いんとぅるえんぎね",
  172.71,
  1341,
  300.74072265625,
  168.888916015625,
  "FOR THIS SPRITE ONLY! This variable controls the z position (size) of each INDIVIDUAL clone. Unlike Camera Z, this value can from 0 to 100, not just 0 to 1"
 ],
 [
  "NEXTだお",
  -166.37,
  581.59,
  200,
  200,
  "この音は共有後に追加したので、付けるかつけないかはあなた次第です！"
 ],
 [
  "NEXTだお",
  -120.88,
  832.14,
  200,
  200,
  "⇧\nこの下に入れてください"
 ]
]


def main():
    with zipfile.ZipFile(SB3) as z:
        names = z.namelist()
        project = json.loads(z.read("project.json"))
        others = {n: z.read(n) for n in names if n != "project.json"}

    # 4. strip boilerplate
    stage = next(t for t in project["targets"] if t["name"] == "Stage")
    stage["comments"] = {cid: c for cid, c in stage.get("comments", {}).items()
                         if cid not in ("notes", "twconfig")}

    # 1. rename variable display name everywhere
    var_ids = set()
    for t in project["targets"]:
        for vid, v in t.get("variables", {}).items():
            if isinstance(v, list) and v[0] == SRC:
                v[0] = DST
                var_ids.add(vid)

    def walk(o):
        if isinstance(o, dict):
            f = o.get("fields", {})
            if isinstance(f, dict):
                for fname, fval in f.items():
                    if (isinstance(fval, list) and len(fval) == 2
                            and fval[0] == SRC and fval[1] in var_ids):
                        fval[0] = DST
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(project)
    assert var_ids, "taimu variable not found"

    # 2. monitor entry (visible, top-left)
    project.setdefault("monitors", [])
    project["monitors"] = [m for m in project["monitors"]
                           if m.get("id") not in var_ids]
    project["monitors"].append({"id": sorted(var_ids)[0], "mode": "default",
                                "opcode": "data_variable",
                                "params": {"VARIABLE": DST},
                                "spriteName": None, "value": 0,
                                "width": 0, "height": 0,
                                "x": 5, "y": 5, "visible": True})

    # 3. comments on new/changed scripts (positions read from this build)
    for t in project["targets"]:
        t.setdefault("comments", {})
        t["comments"] = {cid: c for cid, c in t["comments"].items()
                         if not (cid.startswith("l6b") or cid.startswith("l6brest"))}
    for i, (target, x, y, w, h, text) in enumerate(ORIGINAL_COMMENTS):
        t = next(t for t in project["targets"] if t["name"] == target)
        t["comments"][f"l6brest{i}"] = {"blockId": None, "x": x, "y": y,
                                        "width": w, "height": h,
                                        "minimized": False,
                                        "text": "[restored human comment] " + text}
    scripts = {}
    for t in project["targets"]:
        for bid, b in t["blocks"].items():
            if isinstance(b, dict) and b.get("topLevel"):
                scripts.setdefault(t["name"], []).append(b)
    def add(target, x, y, text):
        ts = [t for t in project["targets"] if t["name"] == target][0]
        cid = f"l6b{len([c for c in ts['comments'] if c.startswith('l6b')])}"
        ts["comments"][cid] = {"blockId": None, "x": x, "y": y,
                               "width": 280, "height": 80,
                               "minimized": False, "text": text}
    # new counter script in ステージ: the onflag script that sets タイム
    def subtree_has(blocks, bid, opcode, varname=None):
        seen, stack = set(), [bid]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            b = blocks.get(cur)
            if not isinstance(b, dict):
                continue
            if b.get("opcode") == opcode:
                if varname is None:
                    return True
                f = b.get("fields", {}).get("VARIABLE", [None])
                if f[0] == varname:
                    return True
            for k in ("next",):
                if b.get(k) in blocks:
                    stack.append(b[k])
            for v in list(b.get("inputs", {}).values()) + list(b.get("fields", {}).values()):
                if isinstance(v, list) and len(v) > 1 and isinstance(v[1], str) and v[1] in blocks:
                    stack.append(v[1])
        return False
    st = next(t for t in project["targets"] if t["name"] == "ステージ")
    counter = None
    for bid, b in st["blocks"].items():
        if (isinstance(b, dict) and b.get("topLevel")
                and b.get("opcode") == "event_whenflagclicked"
                and subtree_has(st["blocks"], bid, "data_setvariableto", DST)):
            counter = b
    if counter is None:  # fallback: lowest onflag script
        flags = [b for b in st["blocks"].values()
                 if isinstance(b, dict) and b.get("topLevel")
                 and b.get("opcode") == "event_whenflagclicked"]
        counter = max(flags, key=lambda b: b.get("y", 0)) if flags else {"x": 0, "y": 0}
    add("ステージ", counter.get("x", 0) + 260, counter.get("y", 0),
        "NEW (goboscript): タイム counts seconds since green flag "
        "(shown as a monitor; renamed from `taimu` post-build because "
        "goboscript identifiers are ASCII-only).")
    # changed handlers: locate precisely (post-rename names)
    NEXT = "次のステージ"
    def find_receiver(tname, bcast):
        t = next(t for t in project["targets"] if t["name"] == tname)
        for bid, b in t["blocks"].items():
            if (isinstance(b, dict)
                    and b.get("opcode") == "event_whenbroadcastreceived"
                    and b.get("fields", {}).get("BROADCAST_OPTION", [None])[0] == bcast):
                return b
        return None
    def find_proc(tname, proccode):
        t = next(t for t in project["targets"] if t["name"] == tname)
        for bid, b in t["blocks"].items():
            if (isinstance(b, dict)
                    and b.get("opcode") == "procedures_prototype"
                    and b.get("mutation", {}).get("proccode") == proccode):
                top = b.get("parent")
                while isinstance(t["blocks"].get(top), dict) and not t["blocks"][top].get("topLevel"):
                    top = t["blocks"][top].get("parent")
                return t["blocks"].get(top, {})
        return {}
    b = find_receiver("ステージ", NEXT)
    if b:
        add("ステージ", b.get("x", 0) + 260, b.get("y", 0),
            "CHANGED (goboscript): reset タイム when the next stage starts.")
    b = find_proc("海賊王になる男(((?", "_16")
    if b:
        add("海賊王になる男(((?", b.get("x", 0) + 260, b.get("y", 0),
            "CHANGED (goboscript): reset タイム on death respawn (_16).")

    with zipfile.ZipFile(SB3, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in others.items():
            z.writestr(n, data)
        z.writestr("project.json", json.dumps(project, ensure_ascii=False).encode("utf-8"))
    print(f"renamed {SRC} -> {DST}, added monitor + comments in {SB3}")


if __name__ == "__main__":
    main()
