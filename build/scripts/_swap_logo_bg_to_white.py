#!/usr/bin/env python3
"""_swap_logo_bg_to_white.py -- swap the black icon background for white,
keeping the red "R" mark unchanged, then regenerate every derived icon file
the same way _regen_logo_icons.py originally did.

Requested 2026-08-30: the black-background app icon looks too dark/heavy on
a home screen; user wants a white background instead. Source logo is a
clean two-color image (opaque black bg, solid red mark, confirmed via pixel
sampling -- no gradients/anti-aliasing to worry about), so a simple
near-black-to-white pixel swap is safe and exact.

Run from repo root: python build/scripts/_swap_logo_bg_to_white.py
"""
from PIL import Image
import os

SRC = "relentless-web/public/logo-source.png"
OUT_DIR = "relentless-web/public"

# Near-black threshold, not exact (1,1,1) only, in case of any JPEG-artifact-
# style noise near the background -- but the red mark's channels are all
# >=10 apart from black in every direction, so this threshold can't
# misclassify red pixels as background.
BLACK_THRESHOLD = 30

SIZES = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
}


def main():
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size
    changed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r < BLACK_THRESHOLD and g < BLACK_THRESHOLD and b < BLACK_THRESHOLD:
                px[x, y] = (255, 255, 255, a)
                changed += 1
    print(f"swapped {changed} background pixels to white")

    im.save(os.path.join(OUT_DIR, "logo-source.png"))
    print(f"wrote {OUT_DIR}/logo-source.png ({w}x{h})")

    for filename, size in SIZES.items():
        resized = im.resize((size, size), Image.LANCZOS)
        path = os.path.join(OUT_DIR, filename)
        resized.save(path)
        print(f"wrote {path} ({size}x{size})")

    favicon_sizes = [16, 32, 48]
    favicon_path = os.path.join(OUT_DIR, "favicon.ico")
    im.save(favicon_path, sizes=[(s, s) for s in favicon_sizes])
    print(f"wrote {favicon_path} (sizes: {favicon_sizes})")


if __name__ == "__main__":
    main()
