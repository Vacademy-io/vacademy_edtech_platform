"""hand_render.py — natural red-pen marks for the copy checker.

Drop-in drawing layer: every function takes a PIL RGBA image (the page) and
draws directly on it. Replace the current font-based text/tick calls in the
renderer with these.

Why the old output looked AI-generated:
  * text was a bold condensed print font, not handwriting
  * every glyph identical, perfectly horizontal baseline, uniform red
  * ticks were straight two-segment lines of constant width
  * the circled total was a clean ellipse

What this does instead (all seeded per copy, so one copy = one teacher):
  * handwriting font (Kalam by default - made for Indian hands - or Caveat)
  * per-glyph jitter: size, baseline, rotation, letter spacing
  * ink model: variable stroke width, slight pressure gaps, ballpoint red with
    small darkness variation, 2-3 px bleed
  * ticks/crosses/underlines/circle as wobbly Bezier strokes with pen lift
  * whole annotation slightly rotated (-3..+3 deg) like a hand that isn't square
    to the page
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = Path(__file__).parent / "fonts"   # bundled with the copy checker
DEFAULT_FONT = "DawningofaNewDay.ttf"
# Set glyph by glyph as they are. Every other face goes through _natural_text.
CLASSIC_FONTS = frozenset({"Kalam.ttf", "PatrickHand.ttf", "ArchitectsDaughter.ttf"})
# Joined-up hands: written a whole word at a time, so the joins survive, and redrawn
# along their centre line with one round pen (see _joined_text).
JOINED_FONTS = frozenset({"DawningofaNewDay.ttf", "Cedarville-Cursive.ttf"})
# x-height / font size a joined hand is written at, whatever the face's own proportions.
_JOINED_X_HEIGHT = 0.50
# The pen's width against that x-height, and the gap between words, as a teacher's
# stylus remarks measure: a steady line, and words set well apart.
_JOINED_STROKE = 0.115
_JOINED_WORD_GAP = 1.25

INK = (214, 28, 40)                      # red ballpoint


def _thin(mask):
    """Zhang-Suen thinning of a 0/1 uint8 array: strokes down to a one-pixel centre line."""
    import numpy as np

    ys, xs = np.where(mask)
    if len(xs) == 0:
        return mask
    y0, y1, x0, x1 = max(ys.min() - 1, 0), ys.max() + 2, max(xs.min() - 1, 0), xs.max() + 2
    im = np.pad(mask[y0:y1, x0:x1].copy(), 1)
    while True:
        changed = False
        for step in (0, 1):
            p2, p3, p4, p5 = im[:-2, 1:-1], im[:-2, 2:], im[1:-1, 2:], im[2:, 2:]
            p6, p7, p8, p9 = im[2:, 1:-1], im[2:, :-2], im[1:-1, :-2], im[:-2, :-2]
            ring = np.stack([p2, p3, p4, p5, p6, p7, p8, p9, p2]).astype(np.int8)
            transitions = ((ring[:-1] == 0) & (ring[1:] == 1)).sum(axis=0)
            neighbours = ring[:-1].sum(axis=0)
            if step == 0:
                edge = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                edge = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            drop = (im[1:-1, 1:-1] == 1) & (transitions == 1) & (neighbours >= 2) & (neighbours <= 6) & edge
            if drop.any():
                im[1:-1, 1:-1][drop] = 0
                changed = True
        if not changed:
            break
    out = np.zeros_like(mask)
    out[y0:y1, x0:x1] = im[1:-1, 1:-1]
    return out


class Pen:
    """One teacher, one pen. Create once per copy with a fixed seed."""

    def __init__(self, seed: int, font: str = DEFAULT_FONT, slant_deg: float | None = None,
                 ink: tuple[int, int, int] | None = None):
        self.rng = random.Random(seed)
        self.font_path = str(FONT_DIR / font)
        self.natural = font not in CLASSIC_FONTS
        self.joined = font in JOINED_FONTS
        self._optical: float | None = None
        # The institute's / teacher's chosen ink; None = the usual red ballpoint.
        self.ink = tuple(ink) if ink else INK
        self.slant = slant_deg if slant_deg is not None else self.rng.uniform(-3.0, 2.0)
        self.darkness = self.rng.uniform(0.85, 1.0)     # this pen's ink strength

    # ------------------------------------------------------------ ink helpers
    def _colour(self, alpha: float = 1.0) -> tuple[int, int, int, int]:
        d = self.darkness * self.rng.uniform(0.9, 1.0)
        r, g, b = self.ink
        return (int(r * (0.92 + 0.08 * d)), int(g * d), int(b * d), int(255 * alpha))

    def _stroke(self, layer: Image.Image, pts: list[tuple[float, float]], width: float) -> None:
        """Polyline with width that swells and thins along the stroke."""
        draw = ImageDraw.Draw(layer)
        n = len(pts)
        for i in range(n - 1):
            t = i / max(1, n - 2)
            w = width * (0.75 + 0.5 * math.sin(math.pi * t) + self.rng.uniform(-0.12, 0.12))
            if self.rng.random() < 0.006:         # rare pressure skip
                continue
            draw.line([pts[i], pts[i + 1]], fill=self._colour(), width=max(1, int(round(w))))
            draw.ellipse([pts[i][0] - w / 2, pts[i][1] - w / 2, pts[i][0] + w / 2, pts[i][1] + w / 2],
                         fill=self._colour())

    @staticmethod
    def _bezier(p0, p1, p2, p3, n=28):
        out = []
        for i in range(n + 1):
            t = i / n
            x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
            y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
            out.append((x, y))
        return out

    def _wobble(self, pts, amp):
        return [(x + self.rng.uniform(-amp, amp), y + self.rng.uniform(-amp, amp)) for x, y in pts]

    def _blit(self, page: Image.Image, layer: Image.Image, rotate_deg: float, at: tuple[int, int]) -> None:
        layer = layer.filter(ImageFilter.GaussianBlur(0.55))         # ink bleed
        if abs(rotate_deg) > 0.05:
            layer = layer.rotate(rotate_deg, resample=Image.BICUBIC, expand=True)
        page.alpha_composite(layer, dest=(int(at[0]), int(at[1])))

    # ------------------------------------------------------------- handwriting
    def text(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> tuple[int, int]:
        """Write `s` with its baseline-left at xy. Returns (width, height) drawn."""
        if self.joined:
            drawn = self._joined_text(page, xy, s, size)
            if drawn is not None:
                return drawn
        if self.natural:
            return self._natural_text(page, xy, s, size)
        base = ImageFont.truetype(self.font_path, size)
        pad = size
        # measure roughly
        est_w = int(base.getlength(s) * 1.15) + 2 * pad
        est_h = int(size * 1.6) + 2 * pad
        layer = Image.new("RGBA", (est_w, est_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        x = float(pad)
        y0 = float(pad + size * 0.2)
        drift = 0.0
        for ch in s:
            if ch == " ":
                x += base.getlength(" ") * self.rng.uniform(0.8, 1.3)
                continue
            gs = int(size * self.rng.uniform(0.94, 1.06))
            f = ImageFont.truetype(self.font_path, gs)
            drift += self.rng.uniform(-0.6, 0.6)
            drift = max(-size * 0.08, min(size * 0.08, drift))
            gy = y0 + drift + self.rng.uniform(-size * 0.03, size * 0.03)
            rot = self.rng.uniform(-4, 4)
            gw = int(f.getlength(ch)) + gs
            g = Image.new("RGBA", (gw + gs, gs * 2), (0, 0, 0, 0))
            gd = ImageDraw.Draw(g)
            col = self._colour(self.rng.uniform(0.86, 1.0))
            # two slightly offset passes = ballpoint stroke weight without a bold font
            gd.text((gs // 2, gs // 4), ch, font=f, fill=col)
            gd.text((gs // 2 + self.rng.uniform(0.3, 0.9), gs // 4 + self.rng.uniform(0.2, 0.7)), ch, font=f, fill=col)
            g = g.rotate(rot, resample=Image.BICUBIC)
            layer.alpha_composite(g, dest=(int(x - gs // 2), int(gy - gs // 4)))
            x += f.getlength(ch) * self.rng.uniform(0.96, 1.04) + self.rng.uniform(-0.5, 1.0)
        self._blit(page, layer, self.slant + self.rng.uniform(-1.0, 1.0), (xy[0] - pad, xy[1] - pad - size * 0.2))
        return int(x - pad), int(size * 1.2)

    def fitted_px(self, px: int) -> int:
        """The font size that gives this hand the x-height of a `px` hand."""
        if not self.joined:
            return px
        if self._optical is None:
            box = ImageFont.truetype(self.font_path, 200).getbbox("x")
            self._optical = max(0.7, min(2.6, _JOINED_X_HEIGHT * 200.0 / max(1, box[3] - box[1])))
        return max(6, int(round(px * self._optical)))

    def text_width(self, s: str, px: int) -> float:
        """About how wide `s` comes out at font size `px`."""
        font = ImageFont.truetype(self.font_path, px)
        if not self.joined:
            return font.getlength(s) * 1.12
        words = s.split()
        gap = self._word_gap(px)
        return sum(font.getlength(w) for w in words) * 1.03 + gap * 1.1 * max(0, len(words) - 1)

    def _word_gap(self, px: int) -> float:
        return px / max(0.1, self._optical or 1.0) * _JOINED_X_HEIGHT * _JOINED_WORD_GAP

    def _joined_text(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> tuple[int, int] | None:
        """A remark in one steady pen line, its letters joined, the way a teacher writes.

        The word is drawn whole, bent, reduced to its centre line and redrawn with a
        round pen. A font's thick and thin strokes go, which is what made it read as a
        font, and the bend happens first so the line stays one width through it. No two
        words come out alike. None when the imaging libraries are missing.
        """
        try:
            import cv2
            import numpy as np
        except ImportError:
            return None
        self.fitted_px(size)    # settles the optical scale _word_gap uses
        # A teacher starts a remark in small letters ("long answer needs..."), and these
        # faces' capitals are ornate. "HCF" and "Q4:" keep theirs.
        first = s.split(" ", 1)[0]
        if len(first) > 1 and first[0].isupper() and first[1:].rstrip(",.:;?!").islower():
            s = s[0].lower() + s[1:]
        r = self.rng.uniform
        font = ImageFont.truetype(self.font_path, size)
        ascent, descent = font.getmetrics()
        pad = size
        width = int(self.text_width(s, size)) + 2 * pad
        height = ascent + descent + 2 * pad
        mask = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask)
        x = float(pad)
        gap = self._word_gap(size)
        for word in s.split():
            word_font = ImageFont.truetype(self.font_path, max(6, int(size * r(0.96, 1.04))))
            top = pad + ascent - word_font.getmetrics()[0] + r(-0.025, 0.025) * size
            draw.text((x, top), word, font=word_font, fill=255)
            x += word_font.getlength(word) + gap * r(0.85, 1.2)
        ink_w = max(1.0, x - pad)
        rs = np.random.RandomState(self.rng.getrandbits(32))

        def noise(scale: float) -> "np.ndarray":
            cells = rs.uniform(-1.0, 1.0, (max(2, int(height / scale) + 2), max(2, int(width / scale) + 2)))
            return cv2.resize(cells.astype(np.float32), (width, height), interpolation=cv2.INTER_CUBIC)

        xs, ys = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
        x_height = size / max(0.1, self._optical or 1.0) * _JOINED_X_HEIGHT
        slope = min(math.tan(math.radians(self.rng.uniform(1.5, 4.5))), x_height * r(0.3, 0.7) / ink_w)
        map_x = xs + noise(x_height * 1.0) * x_height * 0.05 + noise(x_height * 3.5) * x_height * 0.14
        map_y = (ys + noise(x_height * 1.0) * x_height * 0.05 + noise(x_height * 3.5) * x_height * 0.12
                 + slope * (xs - pad - ink_w / 2.0))
        bent = cv2.remap(np.asarray(mask, dtype=np.uint8), map_x, map_y, cv2.INTER_LINEAR, borderValue=0)
        # A blur first closes the font's hairline gaps, so the centre line stays in one piece.
        soft = cv2.GaussianBlur(bent, (0, 0), max(0.6, x_height * 0.018))
        centre = _thin((soft > 90).astype(np.uint8))
        radius = max(1, int(round(x_height * _JOINED_STROKE / 2.0)))
        nib = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
        pen_line = cv2.dilate(centre, nib).astype(np.float32)
        # Round off the skeleton's steps, then keep only a soft edge.
        pen_line = cv2.GaussianBlur(pen_line, (0, 0), max(0.8, radius * 0.7))
        alpha = np.clip((pen_line - 0.42) / 0.16, 0.0, 1.0) * r(0.94, 1.0)
        red, green, blue, _ = self._colour()
        out = np.zeros((height, width, 4), dtype=np.uint8)
        out[..., 0], out[..., 1], out[..., 2] = red, green, blue
        out[..., 3] = (alpha * 255.0 + 0.5).astype(np.uint8)
        page.alpha_composite(Image.fromarray(out, "RGBA"), dest=(max(0, int(xy[0] - pad)), max(0, int(xy[1] - pad))))
        return int(ink_w), int(size * 1.2)

    def _natural_text(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> tuple[int, int]:
        """A remark as a hand writes it in one go, not letters set in a row.

        The rhythm belongs to the word: each has its own size and height, letters
        crowd together, and the hand tightens towards the end of the line. The
        whole remark is then bent as one piece (_bend), so the same letter never
        comes out the same and the letters of a word move together.
        """
        r = self.rng.uniform
        base = ImageFont.truetype(self.font_path, size)
        pad = size
        layer = Image.new("RGBA", (int(base.getlength(s) * 1.3) + 2 * pad, int(size * 1.7) + 2 * pad), (0, 0, 0, 0))
        x = float(pad)
        y0 = float(pad + size * 0.2)
        n = max(1, len(s) - 1)
        word_scale, word_dy = r(0.94, 1.06), r(-0.05, 0.05) * size
        pressure = r(0.92, 1.0)
        for i, ch in enumerate(s):
            if ch == " ":
                x += base.getlength(" ") * r(0.65, 1.15)
                word_scale, word_dy = r(0.92, 1.07), r(-0.06, 0.06) * size
                continue
            gs = max(6, int(size * word_scale * (1.0 - 0.07 * i / n) * r(0.97, 1.03)))
            f = ImageFont.truetype(self.font_path, gs)
            g = Image.new("RGBA", (int(f.getlength(ch)) + 2 * gs, gs * 2), (0, 0, 0, 0))
            ImageDraw.Draw(g).text((gs // 2, gs // 4), ch, font=f, fill=self._colour(r(0.92, 1.0) * pressure))
            g = g.rotate(r(-2.0, 2.0), resample=Image.BICUBIC)
            layer.alpha_composite(g, dest=(max(0, int(x - gs // 2)), max(0, int(y0 + word_dy - gs // 4))))
            x += f.getlength(ch) * r(0.90, 0.99)
        layer = self._bend(layer, size, x - pad, pad)
        self._blit(page, layer, r(-0.6, 0.6), (xy[0] - pad, xy[1] - pad - size * 0.2))
        return int(x - pad), int(size * 1.2)

    def _bend(self, layer: Image.Image, size: int, ink_w: float, pad: int) -> Image.Image:
        """Warp a written layer: hand wobble, an uphill baseline, uneven pen pressure.

        The baseline climbs by shear rather than rotation, so the letters stay upright
        on a rising line, which is how the reference teacher's hand measured. It pivots
        on the middle of the line and the rise is capped, so the end of a long remark
        does not run into the row above it.
        """
        try:
            import cv2
            import numpy as np
        except ImportError:
            return layer
        rs = np.random.RandomState(self.rng.getrandbits(32))
        arr = np.asarray(layer, dtype=np.float32) / 255.0
        h, w = arr.shape[:2]

        def noise(scale: float) -> "np.ndarray":
            cells = rs.uniform(-1.0, 1.0, (max(2, int(h / scale) + 2), max(2, int(w / scale) + 2))).astype(np.float32)
            return cv2.resize(cells, (w, h), interpolation=cv2.INTER_CUBIC)

        xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        slope = min(math.tan(math.radians(self.rng.uniform(2.5, 6.0))),
                    size * self.rng.uniform(0.12, 0.30) / max(1.0, ink_w))
        bow = size * self.rng.uniform(-0.05, 0.05) * np.sin(np.pi * np.clip((xs - pad) / max(1.0, ink_w), 0.0, 1.0))
        map_x = xs + noise(size * 0.4) * size * 0.04 + noise(size * 1.5) * size * 0.08
        map_y = (ys + noise(size * 0.4) * size * 0.04 + noise(size * 1.5) * size * 0.07
                 + slope * (xs - pad - ink_w / 2.0) + bow)
        # Warped premultiplied, so the clear pixels' black does not fringe the strokes.
        alpha = arr[..., 3]
        prem = np.dstack([arr[..., c] * alpha for c in range(3)] + [alpha])
        out = cv2.remap(prem, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        out = np.clip(out, 0.0, 1.0)
        a = out[..., 3]
        safe = np.maximum(a, 1e-4)
        rgb = np.dstack([np.clip(out[..., c] / safe, 0.0, 1.0) for c in range(3)])
        # Heavy on the pull, light on the push: a thinner stroke through parts of the
        # line, and a ballpoint's slight grain. Too small to thin without losing letters
        # below about 28px.
        if size >= 28:
            def thin(radius: int) -> "np.ndarray":
                k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
                return cv2.erode(a, k)
            mix = np.clip(noise(size * 0.7) * 0.9 + 0.5, 0.0, 1.0)
            a = a * mix + thin(max(1, int(size * 0.014))) * (1.0 - mix)
        a = a * np.clip(0.93 + 0.09 * noise(max(3.0, size * 0.09)), 0.0, 1.0)
        result = np.dstack([rgb, a])
        return Image.fromarray((np.clip(result, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGBA")

    # -------------------------------------------------------------- pen marks
    def tick(self, page: Image.Image, xy: tuple[float, float], h: float) -> None:
        """Tick with its bottom vertex near xy. h = tick height (~1.5x line height)."""
        pad = int(h)
        layer = Image.new("RGBA", (int(h * 2) + 2 * pad, int(h * 1.6) + 2 * pad), (0, 0, 0, 0))
        ox, oy = pad, pad + h * 1.2
        r = self.rng.uniform
        # short down-stroke, then long up-stroke that overshoots
        p0 = (ox + r(0, h * 0.1), oy - h * r(0.35, 0.5))
        p1 = (ox + h * r(0.15, 0.25), oy - h * r(0.05, 0.15))
        p2 = (ox + h * r(0.3, 0.4), oy + h * r(-0.02, 0.05))
        p3 = (ox + h * r(0.36, 0.44), oy)
        q1 = (ox + h * r(0.55, 0.7), oy - h * r(0.35, 0.5))
        q2 = (ox + h * r(0.9, 1.1), oy - h * r(0.8, 1.0))
        q3 = (ox + h * r(1.1, 1.35), oy - h * r(1.05, 1.25))
        pts = self._wobble(self._bezier(p0, p1, p2, p3, 12) + self._bezier(p3, q1, q2, q3, 26), h * 0.012)
        self._stroke(layer, pts, h * 0.075)
        self._blit(page, layer, r(-6, 6), (xy[0] - pad - h * 0.4, xy[1] - oy))

    def cross(self, page: Image.Image, xy: tuple[float, float], h: float) -> None:
        """Cross centred at xy, two separate strokes."""
        pad = int(h)
        layer = Image.new("RGBA", (int(h) + 2 * pad, int(h) + 2 * pad), (0, 0, 0, 0))
        r = self.rng.uniform
        c = (pad + h / 2, pad + h / 2)
        for ang in (r(35, 55), r(125, 145)):
            a = math.radians(ang)
            d = h * r(0.42, 0.55)
            p0 = (c[0] - d * math.cos(a), c[1] - d * math.sin(a))
            p3 = (c[0] + d * math.cos(a), c[1] + d * math.sin(a))
            p1 = (p0[0] * 0.66 + p3[0] * 0.34 + r(-h * 0.06, h * 0.06), p0[1] * 0.66 + p3[1] * 0.34 + r(-h * 0.06, h * 0.06))
            p2 = (p0[0] * 0.34 + p3[0] * 0.66 + r(-h * 0.06, h * 0.06), p0[1] * 0.34 + p3[1] * 0.66 + r(-h * 0.06, h * 0.06))
            self._stroke(layer, self._wobble(self._bezier(p0, p1, p2, p3, 18), h * 0.01), h * 0.09)
        self._blit(page, layer, r(-5, 5), (xy[0] - c[0], xy[1] - c[1]))

    def underline(self, page: Image.Image, x0: float, x1: float, y: float, lh: float) -> None:
        pad = int(lh)
        layer = Image.new("RGBA", (int(x1 - x0) + 2 * pad, 2 * pad), (0, 0, 0, 0))
        r = self.rng.uniform
        p0 = (pad, pad + r(-lh * 0.05, lh * 0.05))
        p3 = (pad + (x1 - x0) + r(-lh * 0.1, lh * 0.15), pad + r(-lh * 0.05, lh * 0.08))
        p1 = (pad + (x1 - x0) * 0.3, pad + r(-lh * 0.12, lh * 0.12))
        p2 = (pad + (x1 - x0) * 0.7, pad + r(-lh * 0.12, lh * 0.12))
        self._stroke(layer, self._wobble(self._bezier(p0, p1, p2, p3, 30), lh * 0.008), lh * 0.09)
        self._blit(page, layer, 0, (x0 - pad, y - pad))

    def strike(self, page: Image.Image, x0: float, x1: float, y: float, lh: float) -> None:
        """Strike-through a word: same as underline but through the x-height."""
        self.underline(page, x0, x1, y - lh * 0.35, lh)

    def circled_total(self, page: Image.Image, xy: tuple[float, float], s: str, size: int) -> None:
        """Big obtained/total with a hand-drawn loop around it. xy = text baseline-left."""
        w, h = self.text(page, xy, s, size)
        cx, cy = xy[0] + w / 2, xy[1] + h * 0.35
        rx, ry = w * 0.72 + size * 0.25, h * 0.95
        pad = int(size)
        layer = Image.new("RGBA", (int(rx * 2) + 2 * pad, int(ry * 2) + 2 * pad), (0, 0, 0, 0))
        c = (pad + rx, pad + ry)
        r = self.rng.uniform
        start = r(0.6, 1.4)                           # starts lower-right like a real loop
        pts = []
        n = 70
        for i in range(n + 1):
            t = start + 2 * math.pi * 1.06 * i / n     # 6% overlap at the end
            wob = 1 + 0.04 * math.sin(3 * t + start) + r(-0.015, 0.015)
            pts.append((c[0] + rx * wob * math.cos(t), c[1] + ry * wob * math.sin(t)))
        self._stroke(layer, pts, size * 0.075)
        self._blit(page, layer, r(-4, 4), (cx - c[0], cy - c[1]))


# ---------------------------------------------------------------- self-test
if __name__ == "__main__":
    # Fake ruled page to preview the marks.
    W, H, LH = 1400, 960, 48
    page = Image.new("RGBA", (W, H), (250, 247, 240, 255))
    d = ImageDraw.Draw(page)
    for y in range(120, H, LH):
        d.line([(0, y), (W, y)], fill=(170, 190, 215, 255), width=2)
    d.line([(150, 0), (150, H)], fill=(220, 120, 150, 255), width=3)
    pen = Pen(seed=42)
    pen.circled_total(page, (760, 40), "30/36", int(LH * 2.3))
    y = 120
    for i, (label, kind) in enumerate([("1/1", "tick"), ("0/1", "cross"), ("2/3", "tick"), ("0.5/1", "tick"), ("4/5", "tick")]):
        yy = y + i * LH * 3
        d.text((170, yy + 10), f"Ans. sample student line {i+1}", fill=(40, 40, 140, 255))
        if kind == "tick":
            pen.tick(page, (860, yy + LH * 0.95), LH * 1.5)
        else:
            pen.cross(page, (860, yy + LH * 0.5), LH * 1.4)
        pen.text(page, (1180, yy + LH * 0.95), label, int(LH * 1.4))
    pen.text(page, (170, 120 + LH * 1.95), "Well explained.", int(LH * 1.1))
    pen.text(page, (170, 264 + LH * 1.95), "Wrong option. Correct: (c)", int(LH * 1.1))
    pen.text(page, (170, 408 + LH * 1.95), "Nature of image not stated: real, inverted.", int(LH * 1.1))
    pen.underline(page, 200, 330, 552 + LH * 0.85, LH)
    pen.text(page, (170, 552 + LH * 1.95), "Reasoning not given.", int(LH * 1.1))
    page.convert("RGB").save("preview.png")
    print("wrote preview.png")
