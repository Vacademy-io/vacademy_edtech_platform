#!/usr/bin/env python3
"""
Post-process a generated icon into the felted-clay asset format.

Why this exists: the image models available on OpenRouter return JPEG, which has
no alpha channel. The shipped cleaner-play icon set is 200x200 RGBA with a
genuinely transparent background (verified: every icon-*.webp has corner pixel
(0,0,0,0)). A white-boxed icon dropped next to them shows a visible white square
on tinted cards and gradient surfaces, so the background has to be removed here.

Asking the model for a transparent background does NOT work — it paints a
literal checkerboard, which is exactly what scripts/generate-parent-icons.mjs
warns about in its header. So we generate on solid white and key it out.

The key is an EDGE-CONNECTED flood fill rather than a global "white -> alpha"
threshold: the palette itself contains cream and warm off-white, and a global
threshold punches holes straight through the middle of the artwork. Only
background-connected pixels are removed.

Usage:
    icon-postprocess.py <in> <out.webp> [--size 200] [--tol 32] [--fill 0.69] [--flatten]

--flatten keeps a solid white background (for character art that renders on a
white screen) and only resizes/encodes.
"""
import sys
from collections import deque

from PIL import Image, ImageFilter


def key_background(im: Image.Image, tol: int) -> Image.Image:
    """Flood fill from every edge pixel, clearing alpha on background-connected
    pixels that are within `tol` of their seed. Returns RGBA."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    # Seed from all four edges. A real icon is centred with padding, so the
    # border is background by construction.
    seeds = []
    for x in range(w):
        seeds.append((x, 0))
        seeds.append((x, h - 1))
    for y in range(h):
        seeds.append((0, y))
        seeds.append((w - 1, y))

    visited = bytearray(w * h)
    q = deque()
    for s in seeds:
        x, y = s
        i = y * w + x
        if not visited[i]:
            visited[i] = 1
            q.append(s)

    def near_white(p):
        r, g, b, _ = p
        return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol

    cleared = 0
    while q:
        x, y = q.popleft()
        p = px[x, y]
        if not near_white(p):
            continue
        px[x, y] = (p[0], p[1], p[2], 0)
        cleared += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not visited[i]:
                    visited[i] = 1
                    q.append((nx, ny))
    return im


def feather(im: Image.Image) -> Image.Image:
    """Soften the keyed edge by 1px so the cutout doesn't read as jagged, and
    pull residual white fringe out of semi-transparent pixels."""
    r, g, b, a = im.split()
    a = a.filter(ImageFilter.GaussianBlur(0.6))
    return Image.merge("RGBA", (r, g, b, a))


def trim_to_content(im: Image.Image, fill: float = 0.69) -> Image.Image:
    """Crop to the visible artwork, then re-pad so the artwork occupies exactly
    `fill` of the final frame.

    The models vary a lot in how much margin they leave, so without this, icons
    render at visibly different optical sizes in the same row. The default 0.69
    is measured from the shipped set: 7 of its 12 icons sit at 69% fill
    (announcement, badges, continue, help, points, progress, shop), which is the
    dominant cluster. Four others sit at ~87% and icon-streak at 59.5% — that
    pre-existing spread is a real inconsistency in the shipped art, not a target
    to reproduce."""
    bbox = im.split()[-1].getbbox()
    if not bbox:
        return im
    im = im.crop(bbox)
    w, h = im.size
    side = max(w, h)
    # side / (side + 2*pad) == fill  ->  pad = side * (1/fill - 1) / 2
    pad = int(side * (1.0 / fill - 1.0) / 2.0)
    canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, ((canvas.width - w) // 2, (canvas.height - h) // 2), im)
    return canvas


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    src, dst = args[0], args[1]
    size = 200
    tol = 32
    fill = 0.69
    flatten = "--flatten" in args
    if "--size" in args:
        size = int(args[args.index("--size") + 1])
    if "--tol" in args:
        tol = int(args[args.index("--tol") + 1])
    if "--fill" in args:
        fill = float(args[args.index("--fill") + 1])

    im = Image.open(src)

    if flatten:
        im = im.convert("RGB").resize((size, size), Image.LANCZOS)
        im.save(dst, "WEBP", quality=90, method=6)
    else:
        im = key_background(im, tol)
        im = feather(im)
        im = trim_to_content(im, fill)
        im = im.resize((size, size), Image.LANCZOS)
        im.save(dst, "WEBP", quality=90, method=6, lossless=False)

    out = Image.open(dst)
    alpha_corner = out.convert("RGBA").getpixel((0, 0))
    print(f"    -> {dst} {out.size} mode={out.mode} corner={alpha_corner}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
