#!/usr/bin/env python3
"""WORKAROUND (L6b): sb2gs re-exports every SVG/PNG on a 480x360 stage canvas
(viewBox 480x360), destroying original costume bounds. That breaks the
harness's AABB collision (and rotation centers/pixel-touching generally).

This restores the ORIGINAL asset bytes from the fixture sb3 into src/assets/,
matching per-sprite in declaration order (sb2gs preserves order and
disambiguates shared names with ' (2)' filename suffixes).

Must run once (or after re-decompile); rebuild after.
"""
import codecs
import json
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
FIX = "/path/to/agentwarp/eval/fixtures/platformer-853110869.sb3"


def unescape(s):
    return codecs.decode(s, "unicode_escape")


def stmt_strings(path, keyword):
    src = open(path, encoding="utf-8").read()
    m = re.search(keyword + r"\s+((?:\"(?:[^\"\\]|\\.)*\"(?:\s+as\s+\"(?:[^\"\\]|\\.)*\")?\s*,?\s*)+);", src)
    if not m:
        return []
    # take only the filenames, skipping `as "rename"` targets
    return [unescape(s) for s in re.findall(r'"((?:[^"\\]|\\.)*)"(?:\s+as\s+"(?:[^"\\]|\\.)*")?', m.group(1))]


def main():
    z = zipfile.ZipFile(FIX)
    project = json.loads(z.read("project.json"))
    targets = {t["name"]: t for t in project["targets"]}
    n = 0
    for gs in sorted(os.listdir(SRC)):
        if not gs.endswith(".gs"):
            continue
        name = gs[:-3]
        if name == "stage":
            name = "Stage"
        t = targets.get(name)
        if t is None:
            print(f"no fixture target for {gs}, skipping")
            continue
        for keyword, assets in (("costumes", t["costumes"]), ("sounds", t["sounds"])):
            files = stmt_strings(os.path.join(SRC, gs), keyword)
            if len(files) != len(assets):
                print(f"MISMATCH {gs} {keyword}: {len(files)} files vs {len(assets)} assets")
                continue
            for f, a in zip(files, assets):
                dest = os.path.join(SRC, f)
                data = z.read(a["md5ext"])
                cur = open(dest, "rb").read() if os.path.exists(dest) else None
                if cur != data:
                    open(dest, "wb").write(data)
                    n += 1
    print(f"restored {n} asset files")


if __name__ == "__main__":
    main()
