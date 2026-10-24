#!/usr/bin/env python3
"""Make the iOS app icon (1024x1024, no alpha) and launch splash (2732x2732, logo on white) from a brand logo.

    gen_assets.py <logo> <out_dir> <file_prefix> [auto|dark-tile|light]

Modes (auto picks by looking at the logo's border):
  dark-tile  the logo is artwork on a dark rounded tile (Smart AI Academy). Icon = the tile pushed to the
             corners; splash = the artwork lifted off the tile and placed on white.
  light      the logo is artwork on white (Sreedhar's TTS, Agilore). Icon = artwork at 76% width on white;
             splash = artwork at 56% of the short side on white. The mockup's drop shadow is dropped.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:  # keep the tool usable without scipy: no component cleanup
    ndimage = None


def detect_mode(rgb):
    # A dark rounded tile with artwork on it is ~40% near-black (Smart AI); artwork-on-white logos
    # are a few percent at most (Agilore's dark wordmark is 0.10), so the split sits at 0.25.
    return "dark-tile" if (rgb.max(axis=2) < 60).mean() > 0.25 else "light"


def flood_corners_black(a, thresh=200):
    h, w, _ = a.shape
    white = a.min(axis=2) > thresh
    seen = np.zeros((h, w), bool)
    for sy, sx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if not white[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and white[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
    a[seen] = 0
    return a


def largest_component(mask):
    if ndimage is None:
        return mask
    opened = ndimage.binary_opening(mask, iterations=2)
    lab, n = ndimage.label(opened)
    if n == 0:
        return mask
    sizes = ndimage.sum(opened, lab, range(1, n + 1))
    comp = lab == (1 + int(np.argmax(sizes)))
    return ndimage.binary_fill_holes(ndimage.binary_dilation(comp, iterations=4))


def place_on_white(logo_rgba, size, frac):
    canvas = Image.new("RGB", (size, size), "white")
    r = size * frac / max(logo_rgba.size)
    lg = logo_rgba.resize((max(1, round(logo_rgba.width * r)), max(1, round(logo_rgba.height * r))), Image.LANCZOS)
    canvas.paste(lg, ((size - lg.width) // 2, (size - lg.height) // 2), lg if lg.mode == "RGBA" else None)
    return canvas


def dark_tile(rgb, out, prefix):
    dark = rgb.max(axis=2) < 60
    ys, xs = np.where(dark)
    y0, y1, x0, x1 = ys.min() + 3, ys.max() - 3, xs.min() + 3, xs.max() - 3  # inset past the anti-aliased edge
    tile = rgb[y0 : y1 + 1, x0 : x1 + 1]
    h, w, _ = tile.shape
    s = max(h, w)
    sq = np.zeros((s, s, 3), np.float32)
    oy, ox = (s - h) // 2, (s - w) // 2
    sq[oy : oy + h, ox : ox + w] = tile
    mx = sq.max(axis=2)
    art = largest_component(mx > 90)
    sq[~art] = 0
    Image.fromarray(sq.astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(f"{out}/{prefix}-icon-1024.png")
    # lift the artwork off the black: alpha from brightness, un-premultiply, kill JPEG noise
    alpha = np.clip((mx - 40) / 60.0, 0, 1) * art
    if ndimage is not None:
        alpha = ndimage.median_filter(alpha, size=3)
    col = np.clip(sq / np.maximum(alpha[..., None], 1e-3), 0, 255)
    col[alpha < 0.05] = 255
    lifted = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), "RGBA")
    lifted = lifted.crop(lifted.getbbox())
    place_on_white(lifted, 2732, 0.40).save(f"{out}/{prefix}-splash-2732x2732.png")


def light(rgb, out, prefix):
    ink = rgb.min(axis=2) < 200  # drops a light-grey mockup shadow
    ys, xs = np.where(ink)
    art = Image.fromarray(rgb[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].astype(np.uint8))
    place_on_white(art, 1024, 0.76).save(f"{out}/{prefix}-icon-1024.png")
    place_on_white(art.convert("RGBA"), 2732, 0.56).save(f"{out}/{prefix}-splash-2732x2732.png")


def main():
    logo, out, prefix = sys.argv[1:4]
    mode = sys.argv[4] if len(sys.argv) > 4 else "auto"
    os.makedirs(out, exist_ok=True)
    rgb = np.array(Image.open(logo).convert("RGB")).astype(np.float32)
    if mode == "auto":
        mode = detect_mode(rgb)
    (dark_tile if mode == "dark-tile" else light)(rgb, out, prefix)
    icon = Image.open(f"{out}/{prefix}-icon-1024.png")
    assert icon.size == (1024, 1024) and icon.mode == "RGB", "icon must be 1024x1024 RGB (App Store rejects alpha)"
    print(f"{mode}: {out}/{prefix}-icon-1024.png, {out}/{prefix}-splash-2732x2732.png")


if __name__ == "__main__":
    main()
