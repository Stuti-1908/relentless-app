#!/usr/bin/env python3
"""_regen_logo_icons.py -- regenerate all brand icon assets from the new logo.

Source: image.png (1254x1254, black bg, red "R" mark) at repo root, provided
2026-08-12 as the updated Relentless logo. Replaces the old logo-source.png
and every PNG/ICO derived from it, all of which relentless-web references by
fixed filename (dashboard sidebar, welcome page, PWA manifest.ts icons array).

Run from repo root: python build/scripts/_regen_logo_icons.py
"""
from PIL import Image
import os

SRC = "image.png"
OUT_DIR = "relentless-web/public"

SIZES = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
}

def main():
    im = Image.open(SRC).convert("RGBA")
    assert im.size[0] == im.size[1], "expected a square source image"

    # replace logo-source.png (full-res original, kept for future regen)
    im.save(os.path.join(OUT_DIR, "logo-source.png"))
    print(f"wrote {OUT_DIR}/logo-source.png ({im.size[0]}x{im.size[1]})")

    for filename, size in SIZES.items():
        resized = im.resize((size, size), Image.LANCZOS)
        path = os.path.join(OUT_DIR, filename)
        resized.save(path)
        print(f"wrote {path} ({size}x{size})")

    # favicon.ico: multi-size ICO (16/32/48) generated from the same source
    favicon_sizes = [16, 32, 48]
    favicon_path = os.path.join(OUT_DIR, "favicon.ico")
    im.save(favicon_path, sizes=[(s, s) for s in favicon_sizes])
    print(f"wrote {favicon_path} (sizes: {favicon_sizes})")

    # Next.js's app/favicon.ico file-route convention takes precedence over
    # public/favicon.ico -- discovered 2026-08-31 when the live site kept
    # serving a stale favicon despite public/favicon.ico being correct and
    # deployed. Must stay in sync or a future logo change repeats this bug.
    app_favicon_path = "relentless-web/src/app/favicon.ico"
    im.save(app_favicon_path, sizes=[(s, s) for s in favicon_sizes])
    print(f"wrote {app_favicon_path} (sizes: {favicon_sizes}) -- this is the one Next.js actually serves")

if __name__ == "__main__":
    main()
