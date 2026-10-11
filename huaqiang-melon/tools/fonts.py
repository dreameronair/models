#!/usr/bin/env python3
"""Download the OFL fonts once and subset them to the characters this video uses.

The full CJK fonts are 1.5-8 MB; subsets keep page loads fast and the repo free of binaries.
Output: build/fonts/{kuaile,huangyou}.ttf
"""
import json
import re
import urllib.request
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "build" / "fonts"
FONTS = {
    "kuaile": "https://github.com/google/fonts/raw/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf",
    "huangyou": "https://github.com/google/fonts/raw/main/ofl/zcoolqingkehuangyou/ZCOOLQingKeHuangYou-Regular.ttf",
}


def used_text():
    chars = set((ROOT / "script.json").read_text("utf-8"))
    src = (ROOT / "scene" / "melon.js").read_text("utf-8")
    for s in re.findall(r"'([^'\n]*)'", src):
        chars |= set(s)
    chars |= set("0123456789.%+-:：·！？，。、“”()（）ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ")
    return "".join(sorted(c for c in chars if not c.isspace() or c == " "))


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    text = used_text()
    for name, url in FONTS.items():
        full = CACHE / f"{name}-full.ttf"
        if not full.exists():
            print(f"download {name}")
            urllib.request.urlretrieve(url, full)
        opts = subset.Options()
        opts.layout_features = ["*"]
        font = subset.load_font(str(full), opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        missing = [c for c in text if ord(c) not in font.getBestCmap() and c.strip()]
        subset.save_font(font, str(CACHE / f"{name}.ttf"), opts)
        print(f"{name}: {len(text)} chars, missing {''.join(missing) or 'none'}")


if __name__ == "__main__":
    main()
