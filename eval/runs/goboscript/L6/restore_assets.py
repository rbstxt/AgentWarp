#!/usr/bin/env python3
"""WORKAROUND (L6): sb2gs re-exports every SVG/PNG on a 480x360 stage canvas,
destroying original costume bounds (breaks AABB collision, rotation centers).

Restores the ORIGINAL asset bytes from the fixture sb3 into src/assets/.
Mapping is explicit (fixture md5ext -> src filename). Idempotent.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
FIX = "/path/to/agentwarp/eval/fixtures/scrolltutorial-378587848.sb3"

MAPPING = {
    "cd21514d0531fdffb22204e0ec5ed84a.svg": "assets/backdrop1.svg",
    "fdbc825d323dd32ed1b7dc147e6c8f95.svg": "assets/costume1.svg",
    "ad8ebf1bd3ea574cccaa0feb56425ba5.png": "assets/level 1 2.png",
    "89c332bef6c2ce94945e5567d63d086e.png": "assets/level 1 3.png",
    "25cff26454ce43a600f4c439ed6d0347.svg": "assets/costume1 (2).svg",
    "83a9787d4cb6f3b7632b4ddfebf74367.wav": "assets/pop.wav",
}


def main():
    z = zipfile.ZipFile(FIX)
    n = 0
    for md5ext, dest in MAPPING.items():
        data = z.read(md5ext)
        path = os.path.join(SRC, dest)
        if open(path, "rb").read() != data:
            open(path, "wb").write(data)
            n += 1
    print(f"restored {n} asset files")


if __name__ == "__main__":
    main()
